import db from '../config/db.js';
import QRCode from 'qrcode';
import http from 'http';
import { generateInvoicePDFStream } from '../utils/invoiceGenerator.js';
import { sendWhatsAppMessage } from '../services/whatsappService.js';
import { generateSampleIdForItem } from '../utils/sampleId.js';
import { actorFromReq } from '../utils/sampleLifecycle.js';
import { issueToken, getOrIssueSampleToken } from '../utils/queueTokens.js';
import { priceLabItems } from '../utils/testPricing.js';
import { recordBillPayment, PaymentError } from '../utils/billPayments.js';
import { getPaymentSettings, applyRegistrationRule } from '../utils/paymentSettings.js';
import { razorpayEnabled, cancelPaymentLink, closeUpiQr } from '../services/razorpayService.js';
import { chargeToItem, assignInvoiceNo, recomputeBill, createDeskCharges } from '../utils/charges.js';

// Checks an order against the hospital's payment settings. Returns an error
// message, or null when the order is allowed.
function paymentRuleError(settings, { billing_type, payment_method, discount_amount, total_amount, counterPayment, net_amount }) {
  if (billing_type === 'Free_Scheme') return null;
  if (!settings.methods.includes(payment_method)) return `${payment_method} payments are not accepted at this hospital.`;
  if (payment_method === 'Online' && (!settings.online_counter || !razorpayEnabled())) return 'Online payment is not enabled for billing at this hospital.';
  const disc = Number(discount_amount) || 0;
  if (disc > 0 && !settings.allow_discount) return 'Discounts are not allowed at this hospital.';
  if (disc > 0 && disc > (total_amount * settings.max_discount_percent) / 100 + 0.01) return `The discount cannot exceed ${settings.max_discount_percent}% at this hospital.`;
  if (!settings.allow_part_payment && payment_method !== 'Online' && counterPayment > 0 && counterPayment < net_amount - 0.005) {
    return 'Part payment is not allowed at this hospital — collect the full amount.';
  }
  return null;
}

// Generate unique bill number using the branch's hospital code
export const generateBillNumber = (hospital_code = 'BILL') => {
  const timestamp = Date.now().toString(36).toUpperCase();
  // 8 base36 chars (~2.8e12 combinations) — bill numbers double as a public,
  // unauthenticated lookup key (trackTestStatus), so this needs to resist
  // guessing, not just avoid collisions.
  const random = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `${hospital_code}-${timestamp}-${random}`;
};

// Generate lab barcode with lab name and test name
// Format: LAB-{labName}-{testName}-{random}-{random}
const generateLabBarcode = (labName, testName) => {
  const random1 = Math.random().toString(36).substring(2, 6).toUpperCase();
  const random2 = Math.random().toString(36).substring(2, 6).toUpperCase();
  // Clean names - remove spaces and special chars, limit length
  const cleanLabName = (labName || 'UNKNOWN').replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase();
  const cleanTestName = (testName || 'TEST').replace(/[^a-zA-Z0-9]/g, '').substring(0, 15).toUpperCase();
  return `LAB-${cleanLabName}-${cleanTestName}-${random1}-${random2}`;
};

// Create a new bill
export const createBill = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const {
      patient_id,
      patient_name,
      patient_phone,
      items,
      discount_amount = 0,
      payment_method = 'Cash',
      payment_status = 'Pending',
      paid_amount = 0,
      notes,
      hospital_code = 'BILL',
      overwrite_duplicates = false,
      user_id,
      appointment_booking = null,
      priority = 'Routine',
      referring_facility = null,
      referring_clinician = null,
      clinical_notes = null,
      billing_type = 'Standard',
      scheme_name = null,
    } = req.body;

    const VALID_PRIORITIES = ['Routine', 'Urgent', 'STAT'];
    if (!VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({ success: false, message: 'priority must be Routine, Urgent, or STAT.' });
    }
    if (!['Standard', 'Free_Scheme'].includes(billing_type)) {
      return res.status(400).json({ success: false, message: 'billing_type must be Standard or Free_Scheme.' });
    }
    if (billing_type === 'Free_Scheme' && !scheme_name?.trim()) {
      return res.status(400).json({ success: false, message: 'scheme_name is required for a free-scheme order (e.g. "NFDS").' });
    }

    // Enforce branch from JWT; Central admins may pass branch_id in body.
    // No hardcoded numeric fallback here — `id = 1` doesn't exist in every
    // deployment (this one was seeded from a differently-numbered dump), and
    // silently billing against a nonexistent branch surfaced as an opaque
    // crash three levels down in sample-ID generation instead of a clear
    // error here. Falls back to whichever single branch actually exists
    // when the caller sent none, which covers the common single-facility
    // deployment case without guessing a specific ID.
    const callerBranch = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    let branch_id = callerBranch || req.body.branch_id || null;
    if (!branch_id) {
      const [branchRows] = await connection.query('SELECT id FROM branches LIMIT 2');
      if (branchRows.length === 1) branch_id = branchRows[0].id;
    }
    if (!branch_id) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'No branch specified and none could be inferred — please select a branch.' });
    }

    // Pending charges (consultation fee, doctor's lab / imaging orders) are
    // billed by id and priced from the charge, never from the browser.
    const chargeIds = [...new Set([...(Array.isArray(req.body.charge_ids) ? req.body.charge_ids : []),
      ...(items || []).filter((i) => i.charge_id).map((i) => i.charge_id)].map(Number).filter(Boolean))];
    // Imaging and procedures come only from the price list, priced on the server.
    const tariffItems = (items || []).filter((i) => !i.charge_id && i.tariff_id);
    if ((items || []).some((i) => !i.charge_id && !i.tariff_id && ['Imaging', 'Procedure'].includes(i.service_type))) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Choose X-ray, scan and procedure items from the price list.' });
    }
    if (tariffItems.length && patient_id) {
      try {
        chargeIds.push(...await createDeskCharges(connection, { branchId: branch_id, patientId: patient_id, items: tariffItems, userId: req.user?.id }));
      } catch (e) {
        if (!e.status) throw e;
        await connection.rollback();
        return res.status(e.status).json({ success: false, message: e.message });
      }
    }
    const plainItems = (items || []).filter((i) => !i.charge_id && !i.tariff_id);
    if (!patient_id || (plainItems.length === 0 && chargeIds.length === 0)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Patient and at least one service item are required'
      });
    }
    let chargeItems = [];
    if (chargeIds.length) {
      const [charges] = await connection.query('SELECT * FROM patient_charges WHERE id IN (?) FOR UPDATE', [chargeIds]);
      const stale = charges.filter((c) => c.status !== 'Unbilled' || Number(c.patient_id) !== Number(patient_id));
      if (charges.length !== chargeIds.length || stale.length) {
        await connection.rollback();
        return res.status(409).json({ success: false, message: 'Some of the selected charges were already billed or cancelled. Refresh and try again.' });
      }
      chargeItems = charges.map(chargeToItem);
      // Lab lines go to the facility's lab, as lines added at the counter do.
      if (chargeItems.some((i) => i.service_type === 'Laboratory')) {
        const [[lab]] = await connection.query(
          `SELECT id, name FROM infrastructure WHERE type = 'Lab' AND branch_id = ? AND is_active = 1 ORDER BY id LIMIT 1`, [branch_id]);
        chargeItems = chargeItems.map((i) => (i.service_type === 'Laboratory' ? { ...i, lab_id: lab?.id || null, lab_name: lab?.name || null } : i));
      }
    }

    // The hospital's payment settings decide the registration fee (only when
    // due — e.g. first registration) and what payment is acceptable.
    const paySettings = await getPaymentSettings(connection, branch_id);
    const { items: ruledItems, registration } = await applyRegistrationRule(connection, { items: [...chargeItems, ...plainItems], patientId: patient_id, settings: paySettings });
    if (ruledItems.length === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: `Nothing to bill: ${registration.reason}` });
    }

    // Free-scheme charges are zeroed server-side, not trusted from the
    // client — a scheme order is meant to never carry a real charge, and
    // this is what keeps that true even if the billing screen sent stale
    // prices. Standard orders are unaffected.
    // Lab tests are priced from the billing facility's price list
    // (lab_test_branch_prices, else the state default) — never from the
    // price the browser sent.
    const effectiveItems = billing_type === 'Free_Scheme'
      ? ruledItems.map(item => ({ ...item, unit_price: 0, total_price: 0 }))
      : await priceLabItems(connection, branch_id, ruledItems);

    // Calculate totals
    const total_amount = effectiveItems.reduce((sum, item) => sum + (item.total_price || 0), 0);
    const net_amount = billing_type === 'Free_Scheme' ? 0 : total_amount - discount_amount;

    // A free-scheme order carries no charge to collect, so there is no
    // "payment" step to gate the lab workflow on — mark it settled at
    // creation instead of leaving it sitting as a Pending balance against a
    // scheme patient (which would otherwise show up in cash-desk dues).
    const effectivePaymentStatus = billing_type === 'Free_Scheme' ? 'Paid' : payment_status;
    const effectivePaidAmount = billing_type === 'Free_Scheme' ? 0 : paid_amount;
    const effectivePaymentMethod = billing_type === 'Free_Scheme' ? 'Other' : payment_method;
    // Money taken at the counter right now is written as a receipt below (so
    // every payment is in bill_payments); an Online order starts unpaid and is
    // settled only when Razorpay confirms the payment.
    const counterPayment = billing_type !== 'Free_Scheme' && payment_method !== 'Online'
      ? Math.min(Math.max(Number(effectivePaidAmount) || 0, 0), Math.max(net_amount, 0)) : 0;
    const ruleError = paymentRuleError(paySettings, { billing_type, payment_method, discount_amount, total_amount, counterPayment, net_amount });
    if (ruleError) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: ruleError });
    }

    // Online orders get a provisional ORD- reference; the BILL- invoice number
    // is issued when the payment is confirmed.
    const deferred = billing_type !== 'Free_Scheme' && payment_method === 'Online' && net_amount > 0;

    // Pay-later credit, approved beforehand by Admin / Accounts Manager.
    let creditApproval = null;
    if (req.body.credit_approval_id) {
      [[creditApproval]] = await connection.query(
        `SELECT * FROM billing_approvals WHERE id = ? AND kind = 'Credit' AND status = 'Approved' AND patient_id = ? AND branch_id = ? FOR UPDATE`,
        [req.body.credit_approval_id, patient_id, branch_id]);
      if (!creditApproval) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'That pay-later approval is not valid for this patient (not approved, already used, or for someone else).' });
      }
    }

    // Lab tests and X-ray / scans are paid before they are done (hospital
    // setting). The consultation part of the same bill may stay due.
    const diagnosticTotal = effectiveItems
      .filter((i) => ['Laboratory', 'Imaging'].includes(i.service_type))
      .reduce((n, i) => n + Number(i.total_price || 0), 0);
    if (paySettings.prepaid_diagnostics && billing_type === 'Standard' && !deferred && !creditApproval && diagnosticTotal > 0) {
      const otherTotal = total_amount - diagnosticTotal;
      const required = Math.max(0, Math.round((net_amount - otherTotal) * 100) / 100);
      if (counterPayment < required - 0.005) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          code: 'PREPAID_DIAGNOSTICS',
          message: `Lab tests and X-ray/scans must be paid before they are done. Collect at least ₹${required.toFixed(2)}, or get a pay-later approval.`,
          required,
        });
      }
    }
    const bill_number = deferred ? generateBillNumber('ORD') : generateBillNumber(hospital_code);

    // Fetch patient details if not provided
    let final_patient_name = patient_name;
    let final_patient_phone = patient_phone;

    if (!final_patient_name || !final_patient_phone) {
      const [patientRows] = await connection.query(
        'SELECT first_name, last_name, telephone FROM patients WHERE id = ?',
        [patient_id]
      );
      if (patientRows.length > 0) {
        if (!final_patient_name || final_patient_name.startsWith('REG-')) {
          final_patient_name = `${patientRows[0].first_name} ${patientRows[0].last_name}`;
        }
        if (!final_patient_phone) {
          final_patient_phone = patientRows[0].telephone;
        }
      }
    }

    // Insert bill
    const [billResult] = await connection.query(
      `INSERT INTO bills (
        bill_number, patient_id, patient_name, patient_phone, total_amount, discount_amount,
        net_amount, payment_method, payment_status, paid_amount, status, notes, branch_id, created_by,
        priority, referring_facility, referring_clinician, clinical_notes, billing_type, scheme_name, order_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bill_number,
        patient_id,
        final_patient_name,
        final_patient_phone,
        total_amount,
        billing_type === 'Free_Scheme' ? 0 : discount_amount,
        net_amount,
        effectivePaymentMethod,
        billing_type === 'Free_Scheme' ? effectivePaymentStatus : (net_amount > 0 ? 'Pending' : 'Paid'),
        0,
        'Active',
        notes || null,
        branch_id,
        user_id || null,
        priority,
        referring_facility || null,
        referring_clinician || null,
        clinical_notes || null,
        billing_type,
        billing_type === 'Free_Scheme' ? scheme_name.trim() : null,
        deferred ? 'Awaiting payment' : 'Confirmed',
      ]
    );
    const bill_id = billResult.insertId;
    if (creditApproval) {
      await connection.query('UPDATE bills SET on_credit = 1, credit_approval_id = ? WHERE id = ?', [creditApproval.id, bill_id]);
      await connection.query(`UPDATE billing_approvals SET status = 'Used', result = JSON_OBJECT('bill_id', ?) WHERE id = ?`, [bill_id, creditApproval.id]);
    }
    // The charges now belong to this bill (also while an online order waits
    // for payment, so they can't be billed twice meanwhile).
    if (chargeIds.length) {
      await connection.query(`UPDATE patient_charges SET status = 'Billed', bill_id = ? WHERE id IN (?)`, [bill_id, chargeIds]);
      await connection.query(
        `UPDATE doctor_lab_orders d JOIN patient_charges pc ON pc.source_type = 'Laboratory' AND pc.source_id = d.id
            SET d.status = 'Billed' WHERE pc.id IN (?)`, [chargeIds]);
    }
    if (counterPayment > 0) {
      await recordBillPayment(connection, {
        bill_id, amount: counterPayment, method: effectivePaymentMethod, channel: 'Counter', actor_id: req.user?.id || user_id || null,
      });
    }

    // A bill paid online is only an order until Razorpay confirms payment:
    // no invoice number, test lines, sample IDs or queue token until then
    // (fulfilOrder runs from payment settlement). Everything else is a real
    // order straight away.
    const orderCtx = {
      bill_id, bill_number, branch_id, patient_id, items: effectiveItems, overwrite_duplicates, user_id, priority,
      notes: notes || null, appointment_booking, patient_name, final_patient_name, final_patient_phone,
      sampleActor: actorFromReq(req, { id: req.user?.id || user_id || null }),
    };
    if (deferred) {
      // Surface an already-booked test now, while staff can still decide.
      if (!overwrite_duplicates) {
        const labIds = effectiveItems.filter(i => i.service_type === 'Laboratory' && i.service_id).map(i => i.service_id);
        if (labIds.length) {
          const [dups] = await connection.query(
            `SELECT DISTINCT bi.service_name FROM bill_items bi JOIN bills b ON bi.bill_id = b.id
              WHERE b.patient_id = ? AND bi.service_type = 'Laboratory' AND bi.service_id IN (?) AND bi.status = 'Pending'`,
            [patient_id, labIds]);
          if (dups.length) throw new DuplicateTestsError(`Patient already booked ${dups.map(d => d.service_name).join(', ')} and sample is not yet collected. Do you want to overwrite?`);
        }
      }
      await connection.query('UPDATE bills SET pending_order = ? WHERE id = ?', [JSON.stringify({ ...orderCtx, hospital_code, bill_id: undefined, bill_number: undefined }), bill_id]);
      await connection.commit();
      return res.status(201).json({
        success: true,
        message: 'Order created — awaiting online payment',
        data: {
          bill_id, bill_number: null, order_ref: bill_number, awaiting_payment: true, total_amount, net_amount, billing_type,
          payment_status: 'Pending', paid_amount: 0, registration_fee: registration, balance_due: Math.max(0, Math.round(net_amount * 100) / 100),
          lab_samples: [], queue_token: null,
        },
      });
    }
    const { lab_samples, queue_token, labBarcodes, lab_qr_code, hasLabItems } = await fulfilOrder(connection, orderCtx);


    const [[saved]] = await connection.query('SELECT payment_status, paid_amount, net_amount FROM bills WHERE id = ?', [bill_id]);
    await connection.commit();

    res.status(201).json({
      success: true,
      message: 'Bill created successfully',
      data: {
        bill_id,
        bill_number,
        lab_barcode: hasLabItems ? labBarcodes[0]?.barcode : null,
        lab_barcode_details: hasLabItems ? labBarcodes : null,
        lab_qr_code,
        lab_samples,
        queue_token,
        total_amount,
        net_amount,
        billing_type,
        scheme_name: billing_type === 'Free_Scheme' ? scheme_name.trim() : null,
        payment_status: saved.payment_status,
        paid_amount: Number(saved.paid_amount),
        registration_fee: registration,
        balance_due: Math.max(0, Math.round((Number(saved.net_amount) - Number(saved.paid_amount)) * 100) / 100),
      }
    });

  } catch (error) {
    await connection.rollback();
    if (error instanceof DuplicateTestsError) {
      return res.status(409).json({ success: false, message: error.message, requires_confirmation: true });
    }
    console.error('Error creating bill:', error);
    res.status(500).json({ success: false, message: 'Server error creating bill' });
  } finally {
    connection.release();
  }
};


// A lab-test duplicate the caller has to confirm (HTTP 409 at the counter).
export class DuplicateTestsError extends Error {}

/**
 * Turns a bill into a real order: its test lines, sample IDs (marked
 * Collected so labels print at once), lab barcodes and QR, the Sample
 * Collection queue token, the "booked" WhatsApp message and the day's
 * appointment. Runs inside the caller's transaction — straight from
 * createBill for a bill paid at the counter, or from payment settlement
 * (paymentController) once an online order is paid. Nothing here reads the
 * HTTP request, since settlement may come from a webhook or reconciliation.
 * duplicatePolicy 'ignore' skips the already-booked check — a paid order is
 * never refused.
 */
export async function fulfilOrder(connection, {
  bill_id, bill_number, branch_id, patient_id, items: effectiveItems, overwrite_duplicates = false, duplicatePolicy = 'reject',
  user_id = null, priority = 'Routine', notes = null, appointment_booking = null, patient_name = null,
  final_patient_name = null, final_patient_phone = null, sampleActor = {}, notifyBooked = true,
}) {
  // A confirmed order gets the next gap-free invoice number.
  await assignInvoiceNo(connection, bill_id, branch_id);
  const hasLabItems = effectiveItems.some(item => item.service_type === 'Laboratory');
  // Deduplicate lab tests to prevent accidental double-billing of the same test
  const uniqueItems = [];
  const seenLabTests = new Set();
  for (const item of effectiveItems) {
    if (item.service_type === 'Laboratory') {
      if (seenLabTests.has(item.service_id)) {
        continue; // skip duplicate lab test
      }
      seenLabTests.add(item.service_id);
    }
    uniqueItems.push(item);
  }

  // Check for existing pending tests if we are not explicitly overwriting
  if (hasLabItems) {
    const labServiceIds = uniqueItems.filter(i => i.service_type === 'Laboratory' && i.service_id).map(i => i.service_id);

    if (labServiceIds.length > 0) {
      if (!overwrite_duplicates && duplicatePolicy !== 'ignore') {
        const [pendingTests] = await connection.query(
          `SELECT bi.service_name 
           FROM bill_items bi
           JOIN bills b ON bi.bill_id = b.id
           WHERE b.patient_id = ? 
             AND bi.service_type = 'Laboratory' 
             AND bi.service_id IN (?) 
             AND bi.status = 'Pending'`,
          [patient_id, labServiceIds]
        );

        if (pendingTests.length > 0) {
          const testNames = [...new Set(pendingTests.map(t => t.service_name))].join(', ');
          throw new DuplicateTestsError(`Patient already booked ${testNames} and sample is not yet collected. Do you want to overwrite?`);
        }
      } else if (overwrite_duplicates) {
        // Replacing an earlier booking of the same test: only unpaid lines
        // are withdrawn (marked Cancelled, their bill re-totalled). A line the
        // patient already paid for is never removed here — that needs an
        // approved cancellation and refund.
        const [old] = await connection.query(
          `SELECT bi.id, bi.bill_id, bi.service_name, b.paid_amount, b.invoice_no, b.bill_number
             FROM bill_items bi JOIN bills b ON bi.bill_id = b.id
            WHERE b.patient_id = ? AND bi.service_type = 'Laboratory' AND bi.service_id IN (?) AND bi.status = 'Pending' AND b.id <> ?`,
          [patient_id, labServiceIds, bill_id]
        );
        const paidOld = old.filter((o) => Number(o.paid_amount) > 0);
        if (paidOld.length) {
          throw new DuplicateTestsError(`${[...new Set(paidOld.map((o) => o.service_name))].join(', ')} is already paid on ${paidOld[0].invoice_no || paidOld[0].bill_number}. Use that booking, or ask for that bill to be cancelled first.`);
        }
        if (old.length) {
          await connection.query(`UPDATE bill_items SET status = 'Cancelled' WHERE id IN (?)`, [old.map((o) => o.id)]);
          for (const billId of new Set(old.map((o) => o.bill_id))) await recomputeBill(connection, billId);
        }
      }
    }
  }

  // Insert bill items — capture each row's id so lab items can be
  // stamped with a sample_id/short_id right below, in the same insert pass.
  const insertedBillItemIds = [];
  for (const item of uniqueItems) {
    const [itemResult] = await connection.query(
      `INSERT INTO bill_items (bill_id, service_type, service_id, service_name,
        service_code, lab_id, quantity, unit_price, total_price, charge_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bill_id, item.service_type, item.service_id, item.service_name,
        item.service_code, item.lab_id || null, item.quantity || 1, item.unit_price, item.total_price, item.charge_id || null]
    );
    insertedBillItemIds.push(itemResult.insertId);
  }

  // Auto-acknowledge every lab item right at billing time: generate its
  // sample_id/short_id and mark it Collected immediately, instead of
  // waiting for a separate manual "Acknowledge" click in the Lab
  // Worklist. This is what lets the barcode label be printed straight off
  // the billing screen — previously sample_id/short_id stayed NULL until
  // someone acknowledged the sample later, so there was nothing real to
  // encode yet. generateSampleIdForItem uses the same
  // lab_sample_sequences counter (and therefore the same LAB-{hospital
  // code}-{date}-{seq} format) as the Worklist's own generate-sample-id
  // endpoint, so a barcode printed here and one printed from the Worklist
  // are indistinguishable in format.
  //
  // Department drives which sequence range a test's short_id comes from
  // (see generateSampleIdForItem) — looked up via lab_tests.category_id,
  // same join the Worklist uses to show department.
  const lab_samples = [];
  if (hasLabItems) {
    let patientFirstName = final_patient_name;
    const [[patientRow]] = await connection.query(
      'SELECT first_name FROM patients WHERE id = ?',
      [patient_id]
    );
    if (patientRow?.first_name) patientFirstName = patientRow.first_name;

    for (let i = 0; i < uniqueItems.length; i++) {
      const item = uniqueItems[i];
      if (item.service_type !== 'Laboratory') continue;
      const billItemId = insertedBillItemIds[i];

      let department = null;
      if (item.service_id) {
        const [[testRow]] = await connection.query(
          `SELECT lc.name AS department
           FROM lab_tests lt
           LEFT JOIN lab_categories lc ON lt.category_id = lc.id
           WHERE lt.id = ?`,
          [item.service_id]
        );
        department = testRow?.department || null;
      }

      const { sampleId, shortId } = await generateSampleIdForItem(connection, branch_id, department, { ...sampleActor });

      await connection.query(
        `UPDATE bill_items SET sample_id = ?, short_id = ?, status = 'Collected', collected_by = ?, updated_at = NOW()
         WHERE id = ?`,
        [sampleId, shortId, user_id || null, billItemId]
      );

      lab_samples.push({
        bill_item_id: billItemId,
        sample_id: sampleId,
        short_id: shortId,
        test_name: item.service_name,
        department,
        patient_first_name: patientFirstName,
      });
    }
  }

  // One persisted Sample Collection token per bill with lab tests — replaces
  // the old on-the-fly queue number (a COUNT that shifted as the day's list
  // changed and was never stored). Same transaction as the bill, so a
  // rolled-back bill can't leave an orphan token behind.
  let queue_token = null;
  if (hasLabItems) {
    const [[tokenPatient]] = await connection.query(
      'SELECT reg_no, first_name, last_name FROM patients WHERE id = ?',
      [patient_id]
    );
    queue_token = await issueToken(connection, {
      branch_id,
      service_point: 'Sample Collection',
      patient_reg_no: tokenPatient?.reg_no || null,
      patient_name: tokenPatient ? `${tokenPatient.first_name} ${tokenPatient.last_name}` : final_patient_name,
      bill_id,
      priority,
      issued_by: sampleActor.id || user_id || null,
      actor_role: sampleActor.role || null,
      ip: sampleActor.ip || null,
    });
  }

  // Generate lab barcodes and QR for lab items
  let lab_qr_code = null;
  const labBarcodes = [];

  if (hasLabItems) {
    // Get lab names for lab items
    const labItems = uniqueItems.filter(item => item.service_type === 'Laboratory');

    for (const item of labItems) {
      // Generate unique barcode for each lab item
      const barcode = generateLabBarcode(item.lab_name, item.service_name);
      labBarcodes.push({
        service_id: item.service_id,
        barcode: barcode,
        lab_name: item.lab_name,
        test_name: item.service_name
      });
    }

    // Generate QR code data with all barcodes
    const qrData = JSON.stringify({
      bill_number,
      patient_id,
      patient_name,
      type: 'LAB_BILL',
      lab_barcodes: labBarcodes
    });

    // Generate QR code as base64
    lab_qr_code = await QRCode.toDataURL(qrData, {
      width: 256,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    // Update bill items with their individual barcodes
    for (const barcodeInfo of labBarcodes) {
      await connection.query(
        'UPDATE bill_items SET lab_barcode = ? WHERE bill_id = ? AND service_id = ? AND service_type = ?',
        [barcodeInfo.barcode, bill_id, barcodeInfo.service_id, 'Laboratory']
      );
    }

    // Update bill with QR code and first lab barcode for reference
    await connection.query(
      'UPDATE bills SET lab_barcode = ?, lab_qr_code = ? WHERE id = ?',
      [labBarcodes[0]?.barcode || null, lab_qr_code, bill_id]
    );

    // WhatsApp Notification: Lab Test Scheduled
    if (final_patient_phone && notifyBooked) {
      try {
        // Persisted token issued above (was a per-request COUNT that could shift)
        const queueNumber = queue_token?.token_number || '-';

        let formattedPhone = final_patient_phone.replace(/[^0-9]/g, '');
        if (formattedPhone.length === 10) formattedPhone = '91' + formattedPhone;

        const assignedLabName = labBarcodes[0]?.lab_name || 'the Main Laboratory';
        const testNames = labItems.map(item => item.service_name).join(', ');
        const referenceNumber = labBarcodes[0]?.barcode || bill_number;

        const msgData = JSON.stringify({
          phone: formattedPhone,
          text: `Hi, ${final_patient_name},\nYour ${testNames} Has been sucessfully booked. \nPlease Visit ${assignedLabName} Lab for your sample collection. 
          \nYour Reference Number is ${referenceNumber}.\n\nYour Queue Token Number is: *${queueNumber}*.`
        });

        const botUrl = new URL(process.env.WHATSAPP_BOT_URL || 'http://localhost:3000');
        const req = http.request({
          hostname: botUrl.hostname,
          port: botUrl.port || (botUrl.protocol === 'https:' ? 443 : 80),
          path: '/send-message',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(msgData)
          }
        });
        req.on('error', e => console.log('WhatsApp HTTP error:', e.message));
        req.write(msgData);
        req.end();
      } catch (err) {
        console.error('Error sending lab scheduled notification:', err);
      }
    }
  }

  // --- Auto-create appointment if none exists for this patient today ---
  try {
    // Use the appointment date from booking form (local IST), fall back to today
    const today = appointment_booking?.apptDate || (() => {
      const d = new Date();
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      return d.toISOString().split('T')[0];
    })();
    const [patForAppt] = await connection.query(
      'SELECT reg_no, first_name, middle_name, last_name FROM patients WHERE id = ?',
      [patient_id]
    );
    if (patForAppt.length > 0) {
      const regNo = patForAppt[0].reg_no;
      const [existingAppt] = await connection.query(
        'SELECT id FROM appointments WHERE reg_no = ? AND appt_date = ? LIMIT 1',
        [regNo, today]
      );
      if (existingAppt.length === 0) {
        const hasConsult = uniqueItems.some(i => i.service_type === 'Consultation' || i.service_type === 'OPD');
        const dept = appointment_booking?.department || (hasConsult ? 'OPD' : (hasLabItems ? 'Laboratory' : 'OPD'));
        const apptDoctor = appointment_booking?.doctor || null;
        const apptDoctorId = appointment_booking?.doctor_id || null;
        const apptTime = appointment_booking?.apptTime || new Date().toTimeString().substring(0, 5);
        // Tie it to the doctor's OPD session when there is one, so it takes
        // its place in that session's slots, queue and room.
        const [[session]] = apptDoctorId ? await connection.query(
          `SELECT r.id, r.consultation_fee, COALESCE(r.department_id, e.department_id) AS department_id
             FROM roster_entries r JOIN employees e ON e.id = r.employee_id
            WHERE e.user_id = ? AND r.duty_date = ? AND r.duty_type = 'OPD' AND r.status = 'Scheduled'
              AND ? >= r.start_time AND ? < r.end_time LIMIT 1`,
          [apptDoctorId, today, apptTime, apptTime]
        ) : [[null]];
        const [[patBranch]] = await connection.query('SELECT branch_id FROM patients WHERE reg_no = ?', [regNo]);
        await connection.query(
          `INSERT INTO appointments (reg_no, department, department_id, doctor, doctor_id, roster_entry_id, priority, appt_date, appt_time,
                                     reason, branch_id, booking_source, consultation_fee)
           VALUES (?, ?, ?, ?, ?, ?, 'Routine', ?, ?, ?, ?, 'Billing', ?)`,
          [regNo, dept, session?.department_id || null, apptDoctor, apptDoctorId, session?.id || null, today, apptTime,
            notes || 'Walk-in', patBranch?.branch_id || null, session?.consultation_fee ?? null]
        );
        console.log(`[Billing] Auto-created appointment for ${regNo} on ${today}`);
      } else if (appointment_booking?.doctor_id && existingAppt[0].doctor_id == null) {
        // Appointment exists but has no doctor — update it with the booking's doctor
        await connection.query(
          `UPDATE appointments SET doctor = ?, doctor_id = ? WHERE id = ?`,
          [appointment_booking.doctor || null, appointment_booking.doctor_id, existingAppt[0].id]
        );
      }
    }
  } catch (apptErr) {
    console.error('[Billing] Auto-appointment creation failed (non-fatal):', apptErr.message);
  }
  // -----------------------------------------------------------------

  return { lab_samples, queue_token, labBarcodes, lab_qr_code, hasLabItems };
}

// GET /api/billing/:id/order-status — where an order stands; after an online
// payment the billing screen reads the invoice number and samples from here.
export const getOrderStatus = async (req, res) => {
  try {
    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    const [[bill]] = await db.query(
      `SELECT id, bill_number, order_state, payment_status, net_amount, paid_amount FROM bills WHERE id = ? ${scope ? 'AND branch_id = ?' : ''}`,
      scope ? [req.params.id, scope] : [req.params.id]);
    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found' });
    const confirmed = bill.order_state === 'Confirmed';
    const [samples] = confirmed ? await db.query(
      `SELECT service_name AS test_name, sample_id, short_id FROM bill_items
        WHERE bill_id = ? AND service_type = 'Laboratory' AND sample_id IS NOT NULL ORDER BY id`, [bill.id]) : [[]];
    const [[token]] = confirmed ? await db.query(
      "SELECT id, token_number, service_point, status FROM patient_queue_tokens WHERE bill_id = ? AND service_point = 'Sample Collection' ORDER BY id DESC LIMIT 1",
      [bill.id]) : [[]];
    res.json({
      success: true,
      data: {
        bill_id: bill.id,
        bill_number: confirmed ? bill.bill_number : null,
        order_ref: confirmed ? null : bill.bill_number,
        order_state: bill.order_state,
        payment_status: bill.payment_status,
        paid_amount: Number(bill.paid_amount || 0),
        balance_due: Math.max(0, Math.round((Number(bill.net_amount) - Number(bill.paid_amount || 0)) * 100) / 100),
        lab_samples: samples,
        queue_token: token || null,
      },
    });
  } catch (error) {
    console.error('Error reading order status:', error);
    res.status(500).json({ success: false, message: 'Server error reading the order' });
  }
};

// POST /api/billing/:id/cancel-order — withdraws an order still waiting for
// online payment (e.g. the patient will pay by cash instead). Open Razorpay
// orders/links for it are closed so a late payment is flagged for refund.
export const cancelPendingOrder = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    const [[bill]] = await conn.query(
      `SELECT id, order_state, paid_amount FROM bills WHERE id = ? ${scope ? 'AND branch_id = ?' : ''} FOR UPDATE`,
      scope ? [req.params.id, scope] : [req.params.id]);
    if (!bill) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Bill not found' }); }
    if (bill.order_state !== 'Awaiting payment' || Number(bill.paid_amount || 0) > 0) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'Only an unpaid order waiting for online payment can be withdrawn.' });
    }
    await conn.query(
      "UPDATE bills SET order_state = 'Cancelled', payment_status = 'Cancelled', status = 'Inactive', pending_order = NULL WHERE id = ?", [bill.id]);
    // Its charges go back to the billing desk.
    await conn.query("UPDATE patient_charges SET status = 'Unbilled', bill_id = NULL WHERE bill_id = ? AND status = 'Billed'", [bill.id]);
    const [open] = await conn.query(
      "SELECT id, kind, gateway_ref FROM payment_gateway_transactions WHERE bill_id = ? AND status = 'Created'", [bill.id]);
    await conn.query(
      "UPDATE payment_gateway_transactions SET status = 'Cancelled', error = 'Order withdrawn at the counter' WHERE bill_id = ? AND status = 'Created'", [bill.id]);
    await conn.commit();
    for (const t of open.filter((x) => x.kind !== 'Checkout' && !x.gateway_ref.startsWith('pending-'))) {
      // eslint-disable-next-line no-await-in-loop
      await (t.kind === 'UPI QR' ? closeUpiQr(t.gateway_ref) : cancelPaymentLink(t.gateway_ref))
        .catch((e) => console.error(`could not withdraw ${t.kind} ${t.gateway_ref}:`, e.message));
    }
    res.json({ success: true, message: 'Order withdrawn' });
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('Error withdrawing order:', error);
    res.status(500).json({ success: false, message: 'Server error withdrawing the order' });
  } finally {
    conn.release();
  }
};

// Get all bills
export const getAllBills = async (req, res) => {
  try {
    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    const filterBranch = scope || req.query.branch_id || null;

    let where = "WHERE b.status = 'Active'";
    const params = [];
    if (filterBranch) {
      where += ' AND b.branch_id = ?';
      params.push(filterBranch);
    }

    const [bills] = await db.query(
      `SELECT b.*,
        (SELECT COUNT(*) FROM bill_items WHERE bill_id = b.id) as item_count
       FROM bills b
       ${where}
       ORDER BY b.created_at DESC`,
      params
    );

    res.json({ success: true, data: bills });
  } catch (error) {
    console.error('Error fetching bills:', error);
    res.status(500).json({ success: false, message: 'Server error fetching bills' });
  }
};

// Get bill by ID with items
export const getBillById = async (req, res) => {
  try {
    const { id } = req.params;
    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;

    const [bills] = await db.query(
      `SELECT * FROM bills WHERE id = ? AND status = "Active" ${scope ? 'AND branch_id = ?' : ''}`,
      scope ? [id, scope] : [id]
    );

    if (bills.length === 0) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    const [items] = await db.query(
      // Every line on the bill, including cancelled ones (shown struck through).
      `SELECT * FROM bill_items WHERE bill_id = ? AND status <> 'Inactive' ORDER BY id`,
      [id]
    );

    res.json({
      success: true,
      data: { ...bills[0], items }
    });
  } catch (error) {
    console.error('Error fetching bill:', error);
    res.status(500).json({ success: false, message: 'Server error fetching bill' });
  }
};

// Process payment
export const processPayment = async (req, res) => {
  const { id } = req.params;
  const { paid_amount, payment_method, reference } = req.body;
  const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
  if (!['Cash', 'Card', 'UPI', 'Insurance', 'Other'].includes(payment_method)) {
    return res.status(400).json({ success: false, message: 'Choose a payment method. Online payments go through Razorpay.' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[billRow]] = await conn.query(
      `SELECT branch_id, net_amount, paid_amount, order_state FROM bills WHERE id = ? ${scope ? 'AND branch_id = ?' : ''}`, scope ? [id, scope] : [id]);
    if (billRow?.order_state !== undefined && billRow.order_state !== 'Confirmed') {
      throw new PaymentError(billRow.order_state === 'Cancelled' ? 'This order has been cancelled.' : 'This order is waiting for online payment. Use “Change payment method” to collect it another way.', 409);
    }
    if (billRow) {
      const settings = await getPaymentSettings(conn, billRow.branch_id);
      const balance = Math.max(0, Number(billRow.net_amount) - Number(billRow.paid_amount || 0));
      if (!settings.methods.includes(payment_method)) throw new PaymentError(`${payment_method} payments are not accepted at this hospital.`);
      if (!settings.allow_part_payment && Number(paid_amount) < balance - 0.005) {
        throw new PaymentError(`Part payment is not allowed at this hospital — collect the full balance of ₹${balance.toFixed(2)}.`);
      }
    }
    const r = await recordBillPayment(conn, {
      bill_id: id, amount: paid_amount, method: payment_method, channel: 'Counter',
      reference: reference ? String(reference).trim().slice(0, 120) : null, actor_id: req.user?.id || null, branchScope: scope,
    });
    await conn.commit();
    res.json({
      success: true,
      message: `Payment recorded — receipt ${r.receipt_no}. Status: ${r.payment_status}`,
      data: { paid_amount: r.paid_amount, payment_status: r.payment_status, receipt_no: r.receipt_no, balance: r.balance },
    });
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error instanceof PaymentError) return res.status(error.status).json({ success: false, message: error.message });
    console.error('Error processing payment:', error);
    res.status(500).json({ success: false, message: 'Server error processing payment' });
  } finally {
    conn.release();
  }
};

// Get available services (lab tests and appointments)
export const getAvailableServices = async (req, res) => {
  try {
    // Get lab tests
    // The billing facility's own prices (else the state default) — the same
    // figures createBill charges, so the screen and the bill always agree.
    const branchId = (req.user?.role_level !== 'Central' ? req.user?.branch_id : null) || req.query.branch_id || null;
    const [labTests] = await db.query(
      `SELECT lt.id, lt.test_code as code, lt.test_name as name, COALESCE(p.price, lt.price) AS price, lt.price AS default_price
       FROM lab_tests lt
       LEFT JOIN lab_test_branch_prices p ON p.test_id = lt.id AND p.branch_id = ? AND p.is_active = 1
       WHERE lt.status = 'Active'`,
      [branchId || 0]
    );

    // X-ray / scans, procedures and other services from the hospital price
    // list. Consultations are not sold here: they come from OP bookings.
    const [tariffs] = await db.query(
      `SELECT id, category, modality, name, code, price FROM service_tariffs WHERE is_active = 1 ORDER BY category, modality, name`
    );

    res.json({
      success: true,
      data: {
        laboratory: labTests.map(t => ({ ...t, service_type: 'Laboratory' })),
        appointments: [],
        services: tariffs.map(t => ({
          tariff_id: t.id, code: t.code, price: t.price, modality: t.modality, any_study: t.name === '*',
          name: t.category === 'Imaging' ? `${t.modality} — ${t.name === '*' ? 'other study' : t.name}` : t.name,
          service_type: t.category === 'Imaging' ? 'Imaging' : t.category === 'Procedure' ? 'Procedure' : 'Other',
        })),
      }
    });
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ success: false, message: 'Server error fetching services' });
  }
};

// Get patients list
export const getPatients = async (req, res) => {
  try {
    const [patients] = await db.query(
      `SELECT id, reg_no,
       CONCAT(first_name, ' ', last_name) as name,
       telephone as phone, email_id as email, dob, gender
       FROM patients
       ORDER BY first_name ASC`
    );

    res.json({ success: true, data: patients || [] });
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ success: false, message: 'Server error fetching patients' });
  }
};

// Legacy function for backward compatibility
export const generateInvoice = async (req, res) => {
  return createBill(req, res);
};
// Send WhatsApp message via bot
export const sendWhatsApp = async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ success: false, message: 'Phone and message are required' });
    }

    // Was hardcoded to a LAN address (172.16.11.160:3000) that exists on
    // nobody's network but the original developer's, so this endpoint could
    // never have worked in production. The bot's address is deployment
    // configuration, and sendWhatsAppMessage already normalises the number and
    // handles the country code.
    await sendWhatsAppMessage(phone, message);
    res.json({ success: true, message: 'WhatsApp message sent successfully' });
  } catch (error) {
    console.error('WhatsApp send error:', error);
    res.status(500).json({ success: false, message: 'Server error calling WhatsApp bot' });
  }
};

// Everything the printed invoice shows for one bill row: its lines with
// sample IDs, the facility, the patient and every receipt. Used for the PDF
// download and for the copy sent to the patient's WhatsApp.
export async function buildInvoiceData(bill) {
  const [items] = await db.query(
    `SELECT service_name AS name, service_type, sample_id, quantity, unit_price AS amount, total_price
       FROM bill_items WHERE bill_id = ? AND status != 'Inactive' ORDER BY id`, [bill.id]);
  const [[patient]] = bill.patient_id
    ? await db.query('SELECT reg_no, dob, gender, telephone FROM patients WHERE id = ?', [bill.patient_id]) : [[]];
  const [[facility]] = await db.query(
    `SELECT COALESCE(NULLIF(hs.hospital_name, ''), br.branch_name) AS name, br.hospital_code AS code,
            COALESCE(NULLIF(hs.address, ''), br.address) AS address, COALESCE(NULLIF(hs.phone, ''), br.contact_number) AS phone,
            hs.email, hs.website, hs.logo_url
       FROM branches br LEFT JOIN (SELECT * FROM hospital_settings ORDER BY id LIMIT 1) hs ON 1 = 1
      WHERE br.id = ?`, [bill.branch_id]);
  const [payments] = await db.query(
    'SELECT receipt_no, amount, method, channel, reference, received_by_name, created_at FROM bill_payments WHERE bill_id = ? ORDER BY id', [bill.id]);
  const [[biller]] = bill.created_by
    ? await db.query("SELECT CONCAT_WS(' ', first_name, last_name) AS name FROM users WHERE id = ?", [bill.created_by]) : [[]];

  let age = '';
  if (patient?.dob) {
    const dob = new Date(patient.dob); const now = new Date();
    age = String(now.getFullYear() - dob.getFullYear() - (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0));
  }

  const invoiceData = {
    bill_number: bill.bill_number,
    date: bill.created_at,
    patient_name: bill.patient_name,
    patient_reg_no: patient?.reg_no || 'N/A',
    patient_phone: bill.patient_phone || patient?.telephone,
    age, gender: patient?.gender || '',
    facility,
    priority: bill.priority,
    referring_clinician: bill.referring_clinician,
    referring_facility: bill.referring_facility,
    billing_type: bill.billing_type,
    scheme_name: bill.scheme_name,
    payment_method: bill.payment_method,
    billed_by: biller?.name || payments[0]?.received_by_name || null,
    total_amount: bill.total_amount,
    discount_amount: bill.discount_amount,
    net_amount: bill.net_amount,
    paid_amount: bill.paid_amount,
    registration_fee: items.filter((i) => i.service_type === 'Registration').reduce((t, i) => t + Number(i.total_price || 0), 0),
    payments,
    items,
  };
  return invoiceData;
}

export const downloadInvoicePdf = async (req, res) => {
  try {
    const { id } = req.params;
    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    const [bills] = await db.query(
      `SELECT * FROM bills WHERE (bill_number = ? OR id = ?) ${scope ? 'AND branch_id = ?' : ''}`,
      scope ? [id, id, scope] : [id, id]
    );
    if (bills.length === 0) return res.status(404).json({ success: false, message: 'Bill not found' });
    const bill = bills[0];
    // An online order becomes an invoice only once Razorpay confirms the payment.
    if (bill.order_state !== 'Confirmed' || (bill.payment_method === 'Online' && bill.payment_status !== 'Paid' && bill.billing_type !== 'Free_Scheme')) {
      return res.status(409).json({ success: false, message: 'The invoice is issued once the online payment is received.' });
    }

    const invoiceData = await buildInvoiceData(bill);

    const doc = await generateInvoicePDFStream(invoiceData);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice-${invoiceData.bill_number}.pdf"`);
    doc.pipe(res);
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ success: false, message: 'Server error generating PDF' });
  }
};

export const updateBill = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params; // this is the bill_number or id
    const {
      patient_id,
      items,
      discount_amount = 0,
      payment_method = 'Cash',
      payment_status = 'Pending',
      paid_amount = 0,
      notes,
      overwrite_duplicates = false,
      priority,
      referring_facility,
      referring_clinician,
      clinical_notes,
      billing_type,
      scheme_name,
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one service item is required' });
    }
    if (priority !== undefined && !['Routine', 'Urgent', 'STAT'].includes(priority)) {
      return res.status(400).json({ success: false, message: 'priority must be Routine, Urgent, or STAT.' });
    }
    if (billing_type !== undefined && !['Standard', 'Free_Scheme'].includes(billing_type)) {
      return res.status(400).json({ success: false, message: 'billing_type must be Standard or Free_Scheme.' });
    }

    // Get the bill
    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    const [billRows] = await connection.query(
      `SELECT id, bill_number, billing_type, branch_id, paid_amount, order_state FROM bills WHERE (bill_number = ? OR id = ?) ${scope ? 'AND branch_id = ?' : ''}`,
      scope ? [id, id, scope] : [id, id]
    );
    if (billRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    if (billRows[0].order_state !== 'Confirmed') {
      await connection.rollback();
      return res.status(409).json({ success: false, message: billRows[0].order_state === 'Cancelled' ? 'This order has been cancelled.' : 'This order is waiting for online payment. Use “Change payment method” to collect it another way.' });
    }
    // A bill that has taken money, or carries the doctor's orders, is final:
    // corrections go through an approved cancellation or concession, never an edit.
    const [[guard]] = await connection.query(
      `SELECT (SELECT COUNT(*) FROM bill_payments WHERE bill_id = ?) AS receipts,
              (SELECT COUNT(*) FROM bill_items WHERE bill_id = ? AND charge_id IS NOT NULL) AS linked`,
      [billRows[0].id, billRows[0].id]);
    if (guard.receipts > 0 || guard.linked > 0) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'This bill already has a payment or the doctor’s orders on it and can no longer be changed. Ask for a cancellation or concession approval from Billing > Approvals instead.' });
    }
    const internal_bill_id = billRows[0].id;
    const bill_number = billRows[0].bill_number;
    // Whether THIS update turns the order into/keeps it as free-scheme —
    // falls back to whatever's already on the bill if the caller doesn't
    // resend billing_type, same COALESCE spirit as the other optional fields.
    const effectiveBillingType = billing_type || billRows[0].billing_type;
    if (effectiveBillingType === 'Free_Scheme' && billing_type === 'Free_Scheme' && !scheme_name?.trim()) {
      return res.status(400).json({ success: false, message: 'scheme_name is required for a free-scheme order (e.g. "NFDS").' });
    }

    const paySettings = await getPaymentSettings(connection, billRows[0].branch_id);
    const { items: ruledItems } = await applyRegistrationRule(connection, {
      items, patientId: patient_id || null, settings: paySettings, excludeBillId: internal_bill_id,
    });
    if (ruledItems.length === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'At least one service item is required' });
    }
    const effectiveItems = effectiveBillingType === 'Free_Scheme'
      ? ruledItems.map(item => ({ ...item, unit_price: 0, total_price: 0 }))
      : await priceLabItems(connection, billRows[0].branch_id, ruledItems);

    const total_amount = effectiveItems.reduce((sum, item) => sum + (item.total_price || 0), 0);
    const net_amount = effectiveBillingType === 'Free_Scheme' ? 0 : total_amount - discount_amount;
    // An Online order keeps exactly what has already been received (Razorpay
    // settles the rest); a counter order takes the amount the cashier entered.
    const alreadyPaid = Number(billRows[0].paid_amount) || 0;
    const effectivePaidAmount = effectiveBillingType === 'Free_Scheme' ? 0 : (payment_method === 'Online' ? alreadyPaid : paid_amount);
    const effectivePaymentStatus = effectiveBillingType === 'Free_Scheme' ? 'Paid'
      : payment_method === 'Online' ? (alreadyPaid >= net_amount ? 'Paid' : alreadyPaid > 0 ? 'Partial' : 'Pending')
      : payment_status;
    const updateRuleError = paymentRuleError(paySettings, {
      billing_type: effectiveBillingType, payment_method, discount_amount, total_amount,
      counterPayment: payment_method === 'Online' ? 0 : Number(effectivePaidAmount) || 0, net_amount,
    });
    if (updateRuleError) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: updateRuleError });
    }
    const effectivePaymentMethod = effectiveBillingType === 'Free_Scheme' ? 'Other' : payment_method;

    // Update bill. priority/referring_*/clinical_notes/billing_type/
    // scheme_name are only touched when the caller actually sends them
    // (COALESCE), so a PUT that doesn't know about these fields yet can't
    // accidentally wipe them.
    await connection.query(
      `UPDATE bills SET total_amount = ?, discount_amount = ?, net_amount = ?, payment_method = ?, payment_status = ?, paid_amount = ?, notes = ?,
         priority = COALESCE(?, priority),
         referring_facility = COALESCE(?, referring_facility),
         referring_clinician = COALESCE(?, referring_clinician),
         clinical_notes = COALESCE(?, clinical_notes),
         billing_type = COALESCE(?, billing_type),
         scheme_name = CASE WHEN ? = 'Free_Scheme' THEN COALESCE(?, scheme_name) ELSE NULL END
       WHERE id = ?`,
      [total_amount, effectiveBillingType === 'Free_Scheme' ? 0 : discount_amount, net_amount,
        effectivePaymentMethod, effectiveBillingType === 'Free_Scheme' ? 'Paid' : (net_amount > 0 ? 'Pending' : 'Paid'), 0, notes || null,
        priority || null, referring_facility || null, referring_clinician || null, clinical_notes || null,
        billing_type || null, effectiveBillingType, scheme_name || null,
        internal_bill_id]
    );

    // Delete existing items
    await connection.query('DELETE FROM bill_items WHERE bill_id = ?', [internal_bill_id]);

    // Insert new items
    // Deduplicate lab tests
    const uniqueItems = [];
    const seenLabTests = new Set();
    for (const item of effectiveItems) {
      if (item.service_type === 'Laboratory') {
        if (seenLabTests.has(item.service_id)) continue;
        seenLabTests.add(item.service_id);
      }
      uniqueItems.push(item);
    }

    for (const item of uniqueItems) {
      await connection.query(
        `INSERT INTO bill_items (bill_id, service_type, service_id, service_name,
          service_code, lab_id, quantity, unit_price, total_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [internal_bill_id, item.service_type, item.service_id, item.service_name,
          item.service_code, item.lab_id || null, item.quantity || 1, item.unit_price, item.total_price]
      );
    }

    const hasLabItems = uniqueItems.some(item => item.service_type === 'Laboratory');

    let lab_qr_code = null;
    const labBarcodes = [];

    if (hasLabItems) {
      const labItems = uniqueItems.filter(item => item.service_type === 'Laboratory');
      for (const item of labItems) {
        const barcode = generateLabBarcode(item.lab_name, item.service_name);
        labBarcodes.push({
          service_id: item.service_id,
          barcode: barcode,
          lab_name: item.lab_name,
          test_name: item.service_name
        });
        await connection.query(
          'UPDATE bill_items SET lab_barcode = ? WHERE bill_id = ? AND service_id = ? AND service_type = ?',
          [barcode, internal_bill_id, item.service_id, 'Laboratory']
        );
      }

      const qrData = JSON.stringify({
        bill_number,
        patient_id,
        type: 'LAB_BILL',
        lab_barcodes: labBarcodes
      });

      lab_qr_code = await QRCode.toDataURL(qrData, { width: 256, margin: 2, color: { dark: '#000000', light: '#ffffff' } });

      await connection.query(
        'UPDATE bills SET lab_barcode = ?, lab_qr_code = ? WHERE id = ?',
        [labBarcodes[0]?.barcode || null, lab_qr_code, internal_bill_id]
      );
    } else {
      await connection.query('UPDATE bills SET lab_barcode = NULL, lab_qr_code = NULL WHERE id = ?', [internal_bill_id]);
    }

    const queue_token = await getOrIssueSampleToken(connection, internal_bill_id, {
      has_lab_items: hasLabItems,
      issued_by: req.user?.id || null,
      actor_role: req.user?.role || null,
      ip: req.ip,
    });

    // Money taken now is a receipt like any other (never a figure typed onto the bill).
    const counterNow = effectiveBillingType === 'Free_Scheme' || payment_method === 'Online' ? 0
      : Math.min(Math.max(Number(effectivePaidAmount) || 0, 0), Math.max(net_amount, 0));
    if (counterNow > 0) {
      await recordBillPayment(connection, { bill_id: internal_bill_id, amount: counterNow, method: effectivePaymentMethod, channel: 'Counter', actor_id: req.user?.id || null });
    }

    await connection.commit();

    res.status(200).json({
      success: true,
      message: 'Bill updated successfully',
      data: {
        bill_id: internal_bill_id,
        queue_token,
        bill_number,
        lab_barcode: hasLabItems ? labBarcodes[0]?.barcode : null,
        lab_barcode_details: hasLabItems ? labBarcodes : null,
        lab_qr_code,
        // Modifying an existing invoice doesn't (yet) regenerate sample IDs
        // for its lab items — those were already stamped when the bill was
        // first created. Left empty here rather than omitted, so the
        // frontend's lab_samples handling doesn't need an undefined check.
        lab_samples: [],
        total_amount,
        net_amount,
        payment_status
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error updating bill:', error);
    res.status(500).json({ success: false, message: 'Server error updating bill' });
  } finally {
    connection.release();
  }
};

export const getPatientBills = async (req, res) => {
  try {
    const { regNo } = req.params;
    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    const [[patient]] = await db.query(
      `SELECT id FROM patients WHERE reg_no = ? ${scope ? 'AND branch_id = ?' : ''} LIMIT 1`,
      scope ? [regNo, scope] : [regNo]
    );
    if (!patient) return res.json({ success: true, bills: [] });
    const [bills] = await db.query(
      `SELECT id, bill_number, total_amount, discount_amount, paid_amount, payment_status, payment_method, created_at
       FROM bills WHERE patient_id = ? ORDER BY created_at DESC LIMIT 30`,
      [patient.id]
    );
    for (const b of bills) {
      const [items] = await db.query(
        `SELECT service_type, service_name, quantity, unit_price, total_price FROM bill_items WHERE bill_id = ?`,
        [b.id]
      );
      b.items = items;
    }
    res.json({ success: true, bills });
  } catch (error) {
    console.error('Error fetching patient bills:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
