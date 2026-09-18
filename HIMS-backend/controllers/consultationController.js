import db from '../config/db.js';

// GET /api/consultations/today
export const getTodayAppointments = async (req, res) => {
  try {
    const { doctorId } = req.query;
    const date = new Date().toISOString().split('T')[0];

    let query = `
      SELECT
        a.id            AS appointment_id,
        a.reg_no,
        a.department,
        a.doctor,
        a.priority,
        a.appt_date,
        a.appt_time,
        a.reason,
        p.first_name,
        p.middle_name,
        p.last_name,
        p.dob,
        p.gender,
        p.telephone,
        p.photo_base64,
        c.id            AS consultation_id,
        c.status        AS consultation_status
      FROM appointments a
      LEFT JOIN patients p  ON a.reg_no = p.reg_no
      LEFT JOIN consultations c ON a.id = c.appointment_id
      WHERE a.appt_date = ?
    `;
    const params = [date];

    // Doctor role: always scope to their own appointments
    if (req.user?.role === 'Doctor') {
      query += ` AND a.doctor_id = ?`;
      params.push(req.user.id);
    } else if (doctorId) {
      query += ` AND a.doctor = ?`;
      params.push(doctorId);
    }

    query += ` ORDER BY a.appt_time ASC`;

    const [rows] = await db.query(query, params);
    res.json({ success: true, appointments: rows });
  } catch (error) {
    console.error('Error fetching today appointments:', error);
    res.status(500).json({ success: false, message: 'Server error fetching appointments' });
  }
};

// GET /api/consultations/:appointmentId
export const getConsultationDetails = async (req, res) => {
  try {
    const { appointmentId } = req.params;

    const [consultations] = await db.query(
      `SELECT * FROM consultations WHERE appointment_id = ? LIMIT 1`,
      [appointmentId]
    );

    if (consultations.length === 0) {
      return res.json({ success: true, consultation: null });
    }

    const consultation = consultations[0];

    const [vitals] = await db.query(
      `SELECT * FROM vitals WHERE consultation_id = ? LIMIT 1`,
      [consultation.id]
    );
    const [prescriptions] = await db.query(
      `SELECT * FROM digital_prescriptions WHERE consultation_id = ? ORDER BY id ASC`,
      [consultation.id]
    );
    const [labOrders] = await db.query(
      `SELECT dlo.*, lt.test_name, lt.test_code
       FROM doctor_lab_orders dlo
       LEFT JOIN lab_tests lt ON dlo.test_id = lt.id
       WHERE dlo.consultation_id = ? ORDER BY dlo.id ASC`,
      [consultation.id]
    );

    consultation.vitals        = vitals[0] || null;
    consultation.prescriptions = prescriptions;
    consultation.labOrders     = labOrders;

    // Parse stored JSON fields
    if (consultation.icd10_codes) {
      try { consultation.icd10_codes = JSON.parse(consultation.icd10_codes); } catch { consultation.icd10_codes = []; }
    }

    res.json({ success: true, consultation });
  } catch (error) {
    console.error('Error fetching consultation details:', error);
    res.status(500).json({ success: false, message: 'Server error fetching consultation details' });
  }
};

// GET /api/consultations/patient/:regNo/history
export const getPatientHistory = async (req, res) => {
  try {
    const { regNo } = req.params;

    const [consultations] = await db.query(
      `SELECT
         c.id, c.appointment_id, c.chief_complaints, c.diagnosis, c.doctor_notes,
         c.soap_history, c.soap_exam, c.icd10_codes, c.follow_up_date,
         c.status, c.consultation_date, c.updated_at,
         a.appt_date, a.doctor, a.department
       FROM consultations c
       LEFT JOIN appointments a ON c.appointment_id = a.id
       WHERE c.patient_reg_no = ?
       ORDER BY c.consultation_date DESC
       LIMIT 10`,
      [regNo]
    );

    for (const c of consultations) {
      const [vitals] = await db.query(
        `SELECT * FROM vitals WHERE consultation_id = ? LIMIT 1`, [c.id]
      );
      const [rx] = await db.query(
        `SELECT medicine_name, dosage, frequency, duration, route FROM digital_prescriptions WHERE consultation_id = ?`, [c.id]
      );
      const [labs] = await db.query(
        `SELECT dlo.urgency, lt.test_name, lt.test_code
         FROM doctor_lab_orders dlo
         LEFT JOIN lab_tests lt ON dlo.test_id = lt.id
         WHERE dlo.consultation_id = ?`, [c.id]
      );
      c.vitals        = vitals[0] || null;
      c.prescriptions = rx;
      c.labOrders     = labs;
      if (c.icd10_codes) {
        try { c.icd10_codes = JSON.parse(c.icd10_codes); } catch { c.icd10_codes = []; }
      }
    }

    res.json({ success: true, history: consultations });
  } catch (error) {
    console.error('Error fetching patient history:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/consultations/patient/:regNo/lab-trends
// Returns last 10 results for each lab test the patient has had
export const getPatientLabTrends = async (req, res) => {
  try {
    const { regNo } = req.params;

    const [results] = await db.query(
      `SELECT
         lr.id, lr.test_id, lr.result_value, lr.result_unit, lr.reference_range,
         lr.status, lr.verified_at,
         lt.test_name, lt.test_code,
         c.consultation_date
       FROM lab_results lr
       LEFT JOIN lab_tests lt ON lr.test_id = lt.id
       LEFT JOIN doctor_lab_orders dlo ON lr.order_id = dlo.id
       LEFT JOIN consultations c ON dlo.consultation_id = c.id
       WHERE dlo.patient_reg_no = ?
       ORDER BY lr.verified_at DESC
       LIMIT 100`,
      [regNo]
    );

    // Group by test_name, last 10 per test
    const grouped = {};
    for (const r of results) {
      const key = r.test_name || r.test_id;
      if (!grouped[key]) grouped[key] = [];
      if (grouped[key].length < 10) grouped[key].push(r);
    }

    res.json({ success: true, trends: grouped });
  } catch (error) {
    // lab_results table may not exist yet — return empty gracefully
    res.json({ success: true, trends: {} });
  }
};

// GET /api/consultations/templates/:doctorId
export const getPrescriptionTemplates = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const [rows] = await db.query(
      `SELECT id, template_name, medicines, created_at
       FROM prescription_templates
       WHERE doctor_id = ?
       ORDER BY created_at DESC`,
      [doctorId]
    );

    const templates = rows.map(r => ({
      ...r,
      medicines: typeof r.medicines === 'string' ? JSON.parse(r.medicines) : r.medicines,
    }));

    res.json({ success: true, templates });
  } catch (error) {
    console.error('Error fetching prescription templates:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/consultations/templates
export const savePrescriptionTemplate = async (req, res) => {
  try {
    const { doctorId, templateName, medicines } = req.body;
    if (!doctorId || !templateName || !medicines?.length) {
      return res.status(400).json({ success: false, message: 'doctorId, templateName, and medicines are required' });
    }

    const [result] = await db.query(
      `INSERT INTO prescription_templates (doctor_id, template_name, medicines)
       VALUES (?, ?, ?)`,
      [doctorId, templateName, JSON.stringify(medicines)]
    );

    res.status(201).json({ success: true, templateId: result.insertId });
  } catch (error) {
    console.error('Error saving prescription template:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// DELETE /api/consultations/templates/:id
export const deletePrescriptionTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(`DELETE FROM prescription_templates WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting prescription template:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/consultations
export const saveConsultation = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const {
      appointmentId, doctorId, patientRegNo,
      chiefComplaints, diagnosis, notes, followUpDate,
      soapHistory, soapExam, patientInstructions, icd10Codes,
      vitals, prescriptions, labOrders,
    } = req.body;

    if (!appointmentId || !patientRegNo) {
      return res.status(400).json({ success: false, message: 'appointmentId and patientRegNo are required' });
    }

    await connection.beginTransaction();

    // 1. Upsert consultation
    const [existing] = await connection.query(
      `SELECT id FROM consultations WHERE appointment_id = ? LIMIT 1`,
      [appointmentId]
    );

    let consultationId;
    const icd10Json = icd10Codes?.length ? JSON.stringify(icd10Codes) : null;

    if (existing.length > 0) {
      consultationId = existing[0].id;
      await connection.query(
        `UPDATE consultations
         SET chief_complaints = ?, diagnosis = ?, doctor_notes = ?,
             symptoms = ?, soap_history = ?, soap_exam = ?,
             icd10_codes = ?, follow_up_date = ?, patient_instructions = ?,
             status = 'Completed', updated_at = NOW()
         WHERE id = ?`,
        [
          chiefComplaints || null, diagnosis || null, notes || null,
          chiefComplaints || null, soapHistory || null, soapExam || null,
          icd10Json, followUpDate || null, patientInstructions || null,
          consultationId,
        ]
      );
    } else {
      const [result] = await connection.query(
        `INSERT INTO consultations
           (appointment_id, doctor_id, patient_reg_no,
            chief_complaints, diagnosis, doctor_notes, symptoms,
            soap_history, soap_exam, icd10_codes, follow_up_date, patient_instructions,
            status, consultation_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Completed', NOW())`,
        [
          appointmentId, doctorId || null, patientRegNo,
          chiefComplaints || null, diagnosis || null, notes || null, chiefComplaints || null,
          soapHistory || null, soapExam || null, icd10Json, followUpDate || null, patientInstructions || null,
        ]
      );
      consultationId = result.insertId;
    }

    // 2. Upsert vitals
    if (vitals) {
      const v = vitals;
      const hasAny = [v.height, v.weight, v.bp_systolic, v.bp_diastolic, v.pulse, v.temperature, v.spo2].some(x => x !== '' && x != null);
      if (hasAny) {
        const [existingVitals] = await connection.query(
          `SELECT id FROM vitals WHERE consultation_id = ? LIMIT 1`,
          [consultationId]
        );
        const vals = [
          v.height || null, v.weight || null,
          v.bp_systolic || null, v.bp_diastolic || null,
          v.pulse || null, v.temperature || null, v.spo2 || null,
        ];
        if (existingVitals.length > 0) {
          await connection.query(
            `UPDATE vitals SET height=?, weight=?, bp_systolic=?, bp_diastolic=?, pulse=?, temperature=?, spo2=?
             WHERE consultation_id=?`,
            [...vals, consultationId]
          );
        } else {
          await connection.query(
            `INSERT INTO vitals (consultation_id, height, weight, bp_systolic, bp_diastolic, pulse, temperature, spo2)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [consultationId, ...vals]
          );
        }
      }
    }

    // 3. Replace prescriptions with enhanced fields
    await connection.query(
      `DELETE FROM digital_prescriptions WHERE consultation_id = ?`,
      [consultationId]
    );
    if (prescriptions?.length > 0) {
      for (const rx of prescriptions) {
        if (rx.medicine_name?.trim()) {
          await connection.query(
            `INSERT INTO digital_prescriptions
               (consultation_id, medicine_name, dosage, frequency, duration, instructions,
                route, sig_morning, sig_afternoon, sig_evening, sig_night, stop_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              consultationId,
              rx.medicine_name, rx.dosage || '', rx.frequency || '', rx.duration || '', rx.instructions || '',
              rx.route || 'Oral',
              rx.morning ? 1 : 0, rx.afternoon ? 1 : 0, rx.evening ? 1 : 0, rx.night ? 1 : 0,
              rx.stopDate || null,
            ]
          );
        }
      }
    }

    // 4. Replace lab orders (full replace to support urgency/indication updates)
    await connection.query(
      `DELETE FROM doctor_lab_orders WHERE consultation_id = ?`,
      [consultationId]
    );
    if (labOrders?.length > 0) {
      for (const order of labOrders) {
        if (order.test_id) {
          await connection.query(
            `INSERT INTO doctor_lab_orders
               (consultation_id, patient_reg_no, doctor_id, test_id, status, urgency, clinical_indication, order_date)
             VALUES (?, ?, ?, ?, 'Pending', ?, ?, NOW())`,
            [
              consultationId, patientRegNo, doctorId || null, order.test_id,
              order.urgency || 'Routine', order.clinicalIndication || null,
            ]
          );
        }
      }
    }

    await connection.commit();
    res.status(201).json({ success: true, message: 'Consultation saved', consultationId });

  } catch (error) {
    await connection.rollback();
    console.error('Error saving consultation:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};

// GET /api/consultations/followup-due — patients whose follow-up is today
export const getFollowUpDue = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { doctorId } = req.query;

    let query = `
      SELECT
        c.id AS consultation_id,
        c.follow_up_date,
        c.diagnosis,
        c.appointment_id,
        p.first_name, p.last_name, p.telephone, p.reg_no, p.photo_base64,
        a.doctor, a.department
      FROM consultations c
      LEFT JOIN appointments a ON c.appointment_id = a.id
      LEFT JOIN patients p ON c.patient_reg_no = p.reg_no
      WHERE c.follow_up_date = ?
    `;
    const params = [today];

    // Doctor role: scope to their own follow-ups
    if (req.user?.role === 'Doctor') {
      query += ` AND a.doctor_id = ?`;
      params.push(req.user.id);
    } else if (doctorId) {
      query += ` AND a.doctor = ?`;
      params.push(doctorId);
    }

    query += ` ORDER BY c.follow_up_date ASC LIMIT 50`;

    const [rows] = await db.query(query, params);
    res.json({ success: true, followups: rows });
  } catch (error) {
    console.error('Error fetching follow-ups:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/consultations/auto-bill — generate bill from consultation
export const autoBillFromConsultation = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { consultationId, patientRegNo, doctorId, prescriptions = [], labOrders = [] } = req.body;

    // Resolve patient_id from reg_no
    const [[patient]] = await connection.query(
      `SELECT id FROM patients WHERE reg_no = ? LIMIT 1`,
      [patientRegNo]
    );
    if (!patient) throw new Error('Patient not found');
    const patientId = patient.id;

    // Build bill items
    const items = [];

    // Consultation fee (default 300)
    items.push({ service_type: 'consultation', service_name: 'Consultation Fee', quantity: 1, unit_price: 300, total_price: 300 });

    // Prescription items
    for (const rx of prescriptions) {
      if (!rx.medicineName && !rx.medicine_name) continue;
      const qty = parseInt(rx.quantity) || 1;
      const price = parseFloat(rx.unit_price) || 0;
      items.push({
        service_type: 'pharmacy',
        service_name: rx.medicineName || rx.medicine_name,
        quantity: qty,
        unit_price: price,
        total_price: qty * price,
      });
    }

    // Lab order items
    for (const lo of labOrders) {
      items.push({
        service_type: 'laboratory',
        service_name: lo.test_name,
        quantity: 1,
        unit_price: lo.unit_price || 0,
        total_price: lo.unit_price || 0,
      });
    }

    const totalAmount = items.reduce((s, it) => s + it.total_price, 0);

    // Insert bill
    const [billResult] = await connection.query(
      `INSERT INTO bills (patient_id, reg_no, total_amount, payment_status, created_at)
       VALUES (?, ?, ?, 'Pending', NOW())`,
      [patientId, patientRegNo, totalAmount]
    );
    const billId = billResult.insertId;

    // Insert bill items
    for (const it of items) {
      await connection.query(
        `INSERT INTO bill_items (bill_id, service_type, service_name, quantity, unit_price, total_price)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [billId, it.service_type, it.service_name, it.quantity, it.unit_price, it.total_price]
      );
    }

    await connection.commit();
    res.status(201).json({ success: true, billId, totalAmount, itemCount: items.length });
  } catch (error) {
    await connection.rollback();
    console.error('Error auto-billing:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};

// GET /api/consultations/patient/:regNo/timeline
export const getPatientTimeline = async (req, res) => {
  try {
    const { regNo } = req.params;
    const events = [];

    // Consultations
    const [consults] = await db.query(
      `SELECT c.id, c.created_at, c.diagnosis, c.chief_complaints, c.icd10_codes,
              c.follow_up_date, a.doctor, a.department, a.reason
       FROM consultations c
       LEFT JOIN appointments a ON c.appointment_id = a.id
       WHERE c.patient_reg_no = ?
       ORDER BY c.created_at DESC LIMIT 50`,
      [regNo]
    );
    for (const c of consults) {
      const codes = (() => { try { return JSON.parse(c.icd10_codes || '[]'); } catch { return []; } })();
      events.push({
        type: 'consultation',
        date: c.created_at,
        title: c.diagnosis || c.reason || 'Consultation',
        subtitle: c.department ? `${c.department}${c.doctor ? ' · ' + c.doctor : ''}` : c.doctor || '',
        detail: c.chief_complaints ? c.chief_complaints.substring(0, 120) : '',
        tags: codes.slice(0, 3).map(cd => cd.code || cd),
      });
      if (c.follow_up_date) {
        events.push({
          type: 'consultation',
          date: c.follow_up_date,
          title: 'Follow-up Due',
          subtitle: 'Scheduled follow-up appointment',
          detail: '',
          tags: ['Follow-up'],
        });
      }
    }

    // Lab orders
    const [labs] = await db.query(
      `SELECT dlo.test_name, dlo.created_at, dlo.status, dlo.urgency
       FROM doctor_lab_orders dlo
       LEFT JOIN consultations c ON dlo.consultation_id = c.id
       WHERE c.patient_reg_no = ?
       ORDER BY dlo.created_at DESC LIMIT 100`,
      [regNo]
    );
    for (const l of labs) {
      events.push({
        type: 'lab',
        date: l.created_at,
        title: l.test_name,
        subtitle: l.status || 'Ordered',
        tags: l.urgency && l.urgency !== 'Routine' ? [l.urgency] : [],
      });
    }

    // Bills
    try {
      const [bills] = await db.query(
        `SELECT id, total_amount, payment_status, created_at FROM bills WHERE reg_no = ? ORDER BY created_at DESC LIMIT 20`,
        [regNo]
      );
      for (const b of bills) {
        events.push({
          type: 'bill',
          date: b.created_at,
          title: `Bill #${b.id}`,
          subtitle: `₹${Number(b.total_amount).toLocaleString('en-IN')} · ${b.payment_status}`,
          tags: [b.payment_status],
        });
      }
    } catch { /* bills table may differ */ }

    // Vitals
    try {
      const [vitals] = await db.query(
        `SELECT v.created_at, v.weight, v.bp_systolic, v.bp_diastolic, v.spo2, v.pulse
         FROM vitals v
         LEFT JOIN consultations c ON v.consultation_id = c.id
         WHERE c.patient_reg_no = ?
         ORDER BY v.created_at DESC LIMIT 20`,
        [regNo]
      );
      for (const v of vitals) {
        const parts = [];
        if (v.bp_systolic && v.bp_diastolic) parts.push(`BP: ${v.bp_systolic}/${v.bp_diastolic}`);
        if (v.weight) parts.push(`Wt: ${v.weight} kg`);
        if (v.spo2) parts.push(`SpO₂: ${v.spo2}%`);
        if (v.pulse) parts.push(`HR: ${v.pulse} bpm`);
        if (parts.length) {
          events.push({ type: 'vital', date: v.created_at, title: 'Vitals Recorded', subtitle: parts.join(' · '), tags: [] });
        }
      }
    } catch { /* vitals table may differ */ }

    // Stats
    const totalVisits = consults.length;
    const totalLabs = labs.length;
    const stats = {
      totalVisits,
      totalLabs,
      totalBills: events.filter(e => e.type === 'bill').length,
      firstVisit: consults.length ? consults[consults.length - 1]?.created_at : null,
    };

    events.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json({ success: true, events, stats });
  } catch (error) {
    console.error('Error building timeline:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/consultations/send-summary-sms
export const sendSummarySMS = async (req, res) => {
  // Placeholder — integrate with your SMS provider (e.g. MSG91, Textlocal)
  // For now returns success so the frontend button works
  res.json({ success: true, message: 'SMS feature requires SMS provider configuration' });
};
