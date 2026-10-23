import { priceLabItems } from './testPricing.js';

// Patient charges: every service the hospital gives creates a charge where it
// happens, so nothing reaches the patient without reaching the billing desk.
//   Consultation  — when an OP appointment is booked (doctor's session fee)
//   Laboratory    — when the doctor orders a test (doctor_lab_orders)
//   Imaging       — when the doctor orders an X-ray / scan (radiology_orders)
// The desk turns charges into bills (createBill with charge ids). A billed
// charge is never dropped or changed here: undoing it goes through a
// cancellation approval.

export const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// Price of an imaging study: the exact study, else the modality's general price.
export async function imagingPrice(conn, modality, study) {
  const [[row]] = await conn.query(
    `SELECT price FROM service_tariffs
      WHERE category = 'Imaging' AND modality = ? AND is_active = 1 AND (name = ? OR name = '*')
      ORDER BY name = '*' LIMIT 1`,
    [modality, study || '']
  );
  return row ? Number(row.price) : 0;
}

async function insertCharge(conn, c) {
  const [r] = await conn.query(
    `INSERT INTO patient_charges (branch_id, patient_id, reg_no, source_type, source_id, appointment_id, consultation_id,
                                  service_id, description, quantity, unit_price, amount, ordered_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [c.branch_id, c.patient_id, c.reg_no, c.source_type, c.source_id, c.appointment_id || null, c.consultation_id || null,
      c.service_id || null, String(c.description).slice(0, 255), round2(c.amount), round2(c.amount), c.ordered_by || null]
  );
  return r.insertId;
}

// Services added at the billing desk from the price list (a walk-in X-ray on
// an outside prescription, a dressing): each becomes a charge priced from the
// list, and an X-ray / scan also goes to the imaging desk's worklist. Returns
// the new charge ids, which the bill then takes like any other charge.
export async function createDeskCharges(conn, { branchId, patientId, items, userId }) {
  const [[pt]] = await conn.query('SELECT id, reg_no FROM patients WHERE id = ?', [patientId]);
  if (!pt) throw Object.assign(new Error('Patient not found'), { status: 404 });
  const ids = [];
  for (const it of items) {
    const [[t]] = await conn.query('SELECT * FROM service_tariffs WHERE id = ? AND is_active = 1', [it.tariff_id]);
    if (!t) throw Object.assign(new Error(`"${it.service_name || 'Service'}" is not on the price list`), { status: 400 });
    const qty = Math.max(1, Math.min(50, Number.parseInt(it.quantity, 10) || 1));
    let sourceId = null;
    let description = t.name;
    if (t.category === 'Imaging') {
      const study = t.name === '*' ? String(it.body_part || '').trim().slice(0, 100) : t.name;
      const [ro] = await conn.query(
        `INSERT INTO radiology_orders (patient_reg_no, modality, body_part, clinical_indication, urgency, status)
         VALUES (?, ?, ?, ?, 'Routine', 'Ordered')`,
        [pt.reg_no, t.modality, study || null, it.clinical_notes ? String(it.clinical_notes).slice(0, 1000) : 'Billed at the desk']
      );
      sourceId = ro.insertId;
      description = `${t.modality} — ${study || 'as advised'}`;
    }
    const price = round2(Number(t.price) * qty);
    const [r] = await conn.query(
      `INSERT INTO patient_charges (branch_id, patient_id, reg_no, source_type, source_id, service_id, description, quantity, unit_price, amount, ordered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [branchId, pt.id, pt.reg_no, t.category === 'Imaging' ? 'Imaging' : t.category === 'Procedure' ? 'Procedure' : 'Other', sourceId, t.id,
        description.slice(0, 255), qty, round2(t.price), price, userId || null]
    );
    ids.push(r.insertId);
  }
  return ids;
}

// Consultation fee for a booked appointment. Free consultations carry no charge.
export async function createConsultationCharge(conn, appointmentId) {
  const [[a]] = await conn.query(
    `SELECT a.id, a.reg_no, a.branch_id, a.doctor, a.doctor_id, a.consultation_fee, a.department, p.id AS patient_id
       FROM appointments a JOIN patients p ON p.reg_no = a.reg_no WHERE a.id = ?`,
    [appointmentId]
  );
  if (!a || !(Number(a.consultation_fee) > 0)) return;
  await insertCharge(conn, {
    branch_id: a.branch_id, patient_id: a.patient_id, reg_no: a.reg_no, source_type: 'Consultation', source_id: a.id,
    appointment_id: a.id, description: `Consultation — ${a.doctor}${a.department ? ` (${a.department})` : ''}`,
    amount: a.consultation_fee, ordered_by: a.doctor_id,
  });
}

// A rescheduled appointment keeps its consultation charge (paid or not).
export async function moveConsultationCharge(conn, fromAppointmentId, toAppointmentId) {
  await conn.query(
    `UPDATE patient_charges SET source_id = ?, appointment_id = ?
      WHERE source_type = 'Consultation' AND source_id = ?`,
    [toAppointmentId, toAppointmentId, fromAppointmentId]
  );
}

// Cancelled / no-show appointment: its unbilled fee goes too. A paid fee stays
// (a refund needs an approved cancellation).
export async function cancelConsultationCharge(conn, appointmentId, reason, userId) {
  await conn.query(
    `UPDATE patient_charges SET status = 'Cancelled', cancel_reason = ?, cancelled_by = ?
      WHERE source_type = 'Consultation' AND source_id = ? AND status = 'Unbilled'`,
    [String(reason || 'Appointment cancelled').slice(0, 255), userId || null, appointmentId]
  );
}

// Brings the doctor's lab and imaging orders for a consultation in line with
// what the doctor just saved. Orders already billed are kept even if the
// doctor removed them — returned in `kept` so the doctor is told why.
export async function syncConsultationOrders(conn, { consultationId, appointmentId, patientRegNo, doctorId, labOrders = [], imagingOrders = [] }) {
  const [[pt]] = await conn.query('SELECT id, branch_id FROM patients WHERE reg_no = ?', [patientRegNo]);
  const [[ap]] = await conn.query('SELECT branch_id FROM appointments WHERE id = ?', [appointmentId]);
  const branchId = ap?.branch_id || pt?.branch_id;
  const kept = [];

  // ── Lab ──
  const [existingLab] = await conn.query(
    `SELECT dlo.id, dlo.test_id, pc.status AS charge_status, lt.test_name
       FROM doctor_lab_orders dlo
       LEFT JOIN patient_charges pc ON pc.source_type = 'Laboratory' AND pc.source_id = dlo.id
       LEFT JOIN lab_tests lt ON lt.id = dlo.test_id
      WHERE dlo.consultation_id = ?`,
    [consultationId]
  );
  const wantLab = new Map(labOrders.filter((o) => o.test_id).map((o) => [Number(o.test_id), o]));
  for (const row of existingLab) {
    const want = wantLab.get(Number(row.test_id));
    if (want) {
      await conn.query('UPDATE doctor_lab_orders SET urgency = ?, clinical_indication = ? WHERE id = ?',
        [want.urgency || 'Routine', want.clinicalIndication || null, row.id]);
      wantLab.delete(Number(row.test_id));
    } else if (row.charge_status === 'Billed') {
      kept.push(row.test_name || `Test #${row.test_id}`);
    } else {
      await conn.query(`UPDATE patient_charges SET status = 'Cancelled', cancel_reason = 'Removed by the doctor'
                         WHERE source_type = 'Laboratory' AND source_id = ? AND status = 'Unbilled'`, [row.id]);
      await conn.query('DELETE FROM doctor_lab_orders WHERE id = ?', [row.id]);
    }
  }
  if (pt && wantLab.size) {
    const priced = await priceLabItems(conn, branchId, [...wantLab.keys()].map((id) => ({ service_type: 'Laboratory', service_id: id, quantity: 1 })));
    const [tests] = await conn.query('SELECT id, test_name FROM lab_tests WHERE id IN (?)', [[...wantLab.keys()]]);
    for (const [testId, o] of wantLab) {
      const [ins] = await conn.query(
        `INSERT INTO doctor_lab_orders (consultation_id, patient_reg_no, doctor_id, test_id, status, urgency, clinical_indication, order_date)
         VALUES (?, ?, ?, ?, 'Pending', ?, ?, NOW())`,
        [consultationId, patientRegNo, doctorId || null, testId, o.urgency || 'Routine', o.clinicalIndication || null]
      );
      const price = priced.find((p) => Number(p.service_id) === testId);
      await insertCharge(conn, {
        branch_id: branchId, patient_id: pt.id, reg_no: patientRegNo, source_type: 'Laboratory', source_id: ins.insertId,
        appointment_id: appointmentId, consultation_id: consultationId, service_id: testId,
        description: tests.find((t) => t.id === testId)?.test_name || o.test_name || `Lab test #${testId}`,
        amount: price ? price.unit_price : 0, ordered_by: doctorId,
      });
    }
  }

  // ── Imaging ──
  const [existingImg] = await conn.query(
    `SELECT ro.id, ro.modality, ro.body_part, ro.status, pc.status AS charge_status
       FROM radiology_orders ro
       LEFT JOIN patient_charges pc ON pc.source_type = 'Imaging' AND pc.source_id = ro.id
      WHERE ro.consultation_id = ? AND ro.status <> 'Cancelled'`,
    [consultationId]
  );
  const key = (o) => `${o.modality}|${o.body_part || ''}`;
  const wantImg = new Map(imagingOrders.map((o) => [key(o), o]));
  for (const row of existingImg) {
    const want = wantImg.get(key(row));
    if (want) {
      await conn.query('UPDATE radiology_orders SET urgency = ?, clinical_indication = ? WHERE id = ?',
        [['Routine', 'Urgent', 'STAT'].includes(want.urgency) ? want.urgency : 'Routine', want.clinical_indication || null, row.id]);
      wantImg.delete(key(row));
    } else if (row.charge_status === 'Billed' || row.status !== 'Ordered') {
      kept.push(`${row.modality} ${row.body_part || ''}`.trim());
    } else {
      await conn.query(`UPDATE patient_charges SET status = 'Cancelled', cancel_reason = 'Removed by the doctor'
                         WHERE source_type = 'Imaging' AND source_id = ? AND status = 'Unbilled'`, [row.id]);
      await conn.query(`UPDATE radiology_orders SET status = 'Cancelled' WHERE id = ?`, [row.id]);
    }
  }
  for (const o of wantImg.values()) {
    const [ins] = await conn.query(
      `INSERT INTO radiology_orders (consultation_id, appointment_id, patient_reg_no, doctor_id, modality, body_part, clinical_indication, urgency, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Ordered')`,
      [consultationId, appointmentId, patientRegNo, doctorId || null, o.modality, String(o.body_part || '').slice(0, 100) || null,
        o.clinical_indication || null, ['Routine', 'Urgent', 'STAT'].includes(o.urgency) ? o.urgency : 'Routine']
    );
    if (pt) {
      await insertCharge(conn, {
        branch_id: branchId, patient_id: pt.id, reg_no: patientRegNo, source_type: 'Imaging', source_id: ins.insertId,
        appointment_id: appointmentId, consultation_id: consultationId,
        description: `${o.modality} — ${o.body_part || 'as advised'}`, amount: await imagingPrice(conn, o.modality, o.body_part), ordered_by: doctorId,
      });
    }
  }
  return { kept };
}

// Charge -> bill line.
export const chargeToItem = (c) => ({
  service_type: { Consultation: 'Appointment', Laboratory: 'Laboratory', Imaging: 'Imaging', Procedure: 'Procedure' }[c.source_type] || 'Other',
  service_id: c.source_type === 'Laboratory' ? c.service_id : null,
  service_name: c.description,
  service_code: null,
  quantity: c.quantity || 1,
  unit_price: Number(c.unit_price),
  total_price: Number(c.amount),
  charge_id: c.id,
});

// ── Invoice numbers ──────────────────────────────────────────────────────────
// Gap-free per facility per Indian financial year (April–March): an auditor
// can see at once if an invoice is missing.
const financialYear = (d = new Date()) => {
  const y = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(d));
  const m = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', month: 'numeric' }).format(d));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

export async function assignInvoiceNo(conn, billId, branchId) {
  const [[b]] = await conn.query('SELECT invoice_no FROM bills WHERE id = ?', [billId]);
  if (b?.invoice_no) return b.invoice_no;
  const fy = financialYear();
  await conn.query(
    `INSERT INTO invoice_counters (branch_id, fy, last_no) VALUES (?, ?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_no = LAST_INSERT_ID(last_no + 1)`,
    [branchId, fy]
  );
  const [[{ n }]] = await conn.query('SELECT LAST_INSERT_ID() AS n');
  const invoiceNo = `INV/${fy}/${String(n).padStart(6, '0')}`;
  await conn.query('UPDATE bills SET invoice_no = ? WHERE id = ?', [invoiceNo, billId]);
  return invoiceNo;
}

// ── Bill totals ──────────────────────────────────────────────────────────────
export const statusFor = (net, paid) => {
  if (round2(paid) >= round2(net)) return 'Paid';
  return round2(paid) > 0 ? 'Partial' : 'Pending';
};

// Recomputes a bill from its live (not cancelled) lines. Returns the new totals.
export async function recomputeBill(conn, billId) {
  const [[b]] = await conn.query('SELECT id, discount_amount, paid_amount, billing_type FROM bills WHERE id = ? FOR UPDATE', [billId]);
  const [[{ total }]] = await conn.query(
    `SELECT COALESCE(SUM(total_price), 0) AS total FROM bill_items WHERE bill_id = ? AND status NOT IN ('Cancelled', 'Inactive')`,
    [billId]
  );
  const discount = Math.min(Number(b.discount_amount || 0), Number(total));
  const net = b.billing_type === 'Free_Scheme' ? 0 : round2(Number(total) - discount);
  await conn.query('UPDATE bills SET total_amount = ?, discount_amount = ?, net_amount = ?, payment_status = ? WHERE id = ?',
    [round2(total), round2(discount), net, statusFor(net, b.paid_amount), billId]);
  return { total: round2(total), discount: round2(discount), net, paid: round2(b.paid_amount) };
}

// Money back to the patient: its own receipt row (kind Refund), never an edit.
export async function recordRefund(conn, { bill_id, amount, method, actor_id, approval_id = null, reason = null }) {
  const amt = round2(amount);
  if (!(amt > 0)) return null;
  const [[bill]] = await conn.query('SELECT id, branch_id, net_amount, paid_amount FROM bills WHERE id = ? FOR UPDATE', [bill_id]);
  if (amt > round2(bill.paid_amount) + 0.005) throw new Error('Refund is more than what was paid');
  const [[u]] = actor_id ? await conn.query("SELECT CONCAT_WS(' ', first_name, last_name) AS name FROM users WHERE id = ?", [actor_id]) : [[null]];
  const [ins] = await conn.query(
    `INSERT INTO bill_payments (bill_id, branch_id, kind, amount, method, channel, reference, received_by, received_by_name, approval_id)
     VALUES (?, ?, 'Refund', ?, ?, 'Counter', ?, ?, ?, ?)`,
    [bill.id, bill.branch_id, amt, method || 'Cash', reason ? String(reason).slice(0, 120) : null, actor_id || null, u?.name || null, approval_id]
  );
  const refundNo = `RFND-${String(ins.insertId).padStart(6, '0')}`;
  await conn.query('UPDATE bill_payments SET receipt_no = ? WHERE id = ?', [refundNo, ins.insertId]);
  const paid = round2(Number(bill.paid_amount) - amt);
  await conn.query('UPDATE bills SET paid_amount = ?, payment_status = ? WHERE id = ?', [paid, statusFor(bill.net_amount, paid), bill.id]);
  return { refund_no: refundNo, amount: amt };
}

// A bill whose tests may go ahead: on approved credit, a free scheme, or with
// the diagnostics part paid — money is applied to tests before the consultation
// fee, so a bill with only the doctor's fee outstanding still clears its tests.
// `non_diagnostic` is the bill's consultation/other total, when the caller has it.
export const isCleared = (bill) => {
  if (!bill || bill.payment_status === 'Cancelled' || bill.order_state !== 'Confirmed') return false;
  if (bill.payment_status === 'Paid' || bill.on_credit || bill.billing_type === 'Free_Scheme') return true;
  if (bill.non_diagnostic === undefined || bill.non_diagnostic === null) return false;
  return round2(bill.paid_amount) + 0.005 >= round2(Number(bill.net_amount) - Number(bill.non_diagnostic));
};
