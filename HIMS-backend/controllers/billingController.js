import db from '../config/db.js';
import QRCode from 'qrcode';
import http from 'http';
import { generateInvoicePDFStream } from '../utils/invoiceGenerator.js';
import { sendWhatsAppMessage } from '../services/whatsappService.js';
import { generateSampleIdForItem } from '../utils/sampleId.js';

// Generate unique bill number using the branch's hospital code
const generateBillNumber = (hospital_code = 'BILL') => {
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

    // Enforce branch from JWT; Central admins may pass branch_id in body
    const callerBranch = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    const branch_id = callerBranch || req.body.branch_id || 1;

    if (!patient_id || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Patient and at least one service item are required'
      });
    }

    // Free-scheme charges are zeroed server-side, not trusted from the
    // client — a scheme order is meant to never carry a real charge, and
    // this is what keeps that true even if the billing screen sent stale
    // prices. Standard orders are unaffected.
    const effectiveItems = billing_type === 'Free_Scheme'
      ? items.map(item => ({ ...item, unit_price: 0, total_price: 0 }))
      : items;

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

    // Generate bill number dynamically prefixing hospital code
    const bill_number = generateBillNumber(hospital_code);

    // Check if any lab items exist
    const hasLabItems = items.some(item => item.service_type === 'Laboratory');

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
        priority, referring_facility, referring_clinician, clinical_notes, billing_type, scheme_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bill_number,
        patient_id,
        final_patient_name,
        final_patient_phone,
        total_amount,
        billing_type === 'Free_Scheme' ? 0 : discount_amount,
        net_amount,
        effectivePaymentMethod,
        effectivePaymentStatus,
        effectivePaidAmount,
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
      ]
    );
    const bill_id = billResult.insertId;

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
        if (!overwrite_duplicates) {
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
            await connection.rollback();
            const testNames = [...new Set(pendingTests.map(t => t.service_name))].join(', ');
            return res.status(409).json({
              success: false,
              message: `Patient already booked ${testNames} and sample is not yet collected. Do you want to overwrite?`,
              requires_confirmation: true
            });
          }
        } else {
          // If overwriting, delete the old pending tests entirely to keep the DB clean
          await connection.query(
            `DELETE bi
             FROM bill_items bi
             JOIN bills b ON bi.bill_id = b.id
             WHERE b.patient_id = ? 
               AND bi.service_type = 'Laboratory' 
               AND bi.service_id IN (?) 
               AND bi.status = 'Pending'`,
            [patient_id, labServiceIds]
          );
        }
      }
    }

    // Insert bill items — capture each row's id so lab items can be
    // stamped with a sample_id/short_id right below, in the same insert pass.
    const insertedBillItemIds = [];
    for (const item of uniqueItems) {
      const [itemResult] = await connection.query(
        `INSERT INTO bill_items (bill_id, service_type, service_id, service_name,
          service_code, lab_id, quantity, unit_price, total_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [bill_id, item.service_type, item.service_id, item.service_name,
          item.service_code, item.lab_id || null, item.quantity || 1, item.unit_price, item.total_price]
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

        const { sampleId, shortId } = await generateSampleIdForItem(connection, branch_id, department);

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
      if (final_patient_phone) {
        try {
          // Get the daily lab queue number for this bill
          const [queueResult] = await connection.query(
            `SELECT COUNT(DISTINCT b.id) as count 
             FROM bills b
             JOIN bill_items bi ON b.id = bi.bill_id
             WHERE DATE(b.created_at) = CURDATE() AND bi.service_type = 'Laboratory' AND b.id <= ?`,
            [bill_id]
          );
          const queueNumber = queueResult[0]?.count || 1;

          let formattedPhone = final_patient_phone.replace(/[^0-9]/g, '');
          if (formattedPhone.length === 10) formattedPhone = '91' + formattedPhone;

          const assignedLabName = labBarcodes[0]?.lab_name || 'the Main Laboratory';
          const testNames = labItems.map(item => item.service_name).join(', ');
          const referenceNumber = labBarcodes[0]?.barcode || bill_number;

          const msgData = JSON.stringify({
            phone: formattedPhone,
            text: `Hi, ${final_patient_name},\nYour ${testNames} Has been sucessfully booked. \nPlease Visit ${assignedLabName} Lab for your sample collection. 
            \nYour Reference Number is ${referenceNumber}.\n\nYour Queue Token Number is: *#${queueNumber}*.`
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
          await connection.query(
            `INSERT INTO appointments (reg_no, department, doctor, doctor_id, priority, appt_date, appt_time, reason)
             VALUES (?, ?, ?, ?, 'Normal', ?, ?, ?)`,
            [regNo, dept, apptDoctor, apptDoctorId, today, apptTime, notes || 'Walk-in']
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
        total_amount,
        net_amount,
        billing_type,
        scheme_name: billing_type === 'Free_Scheme' ? scheme_name.trim() : null,
        payment_status: effectivePaymentStatus
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error creating bill:', error);
    res.status(500).json({ success: false, message: 'Server error creating bill' });
  } finally {
    connection.release();
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
      'SELECT * FROM bill_items WHERE bill_id = ? AND status = "Active"',
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
  try {
    const { id } = req.params;
    const { paid_amount, payment_method } = req.body;
    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;

    if (!paid_amount || paid_amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid paid amount is required' });
    }

    const [bills] = await db.query(
      `SELECT net_amount, paid_amount FROM bills WHERE id = ? ${scope ? 'AND branch_id = ?' : ''}`,
      scope ? [id, scope] : [id]
    );

    if (bills.length === 0) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    const bill = bills[0];
    const new_paid = parseFloat(bill.paid_amount || 0) + parseFloat(paid_amount);
    const net_amount = parseFloat(bill.net_amount);

    let payment_status = 'Partial';
    if (new_paid >= net_amount) {
      payment_status = 'Paid';
    }

    await db.query(
      `UPDATE bills SET paid_amount = ?, payment_status = ?, payment_method = ? WHERE id = ? ${scope ? 'AND branch_id = ?' : ''}`,
      scope ? [new_paid, payment_status, payment_method, id, scope] : [new_paid, payment_status, payment_method, id]
    );

    res.json({
      success: true,
      message: `Payment processed. Status: ${payment_status}`,
      data: { paid_amount: new_paid, payment_status }
    });
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({ success: false, message: 'Server error processing payment' });
  }
};

// Get available services (lab tests and appointments)
export const getAvailableServices = async (req, res) => {
  try {
    // Get lab tests
    const [labTests] = await db.query(
      `SELECT id, test_code as code, test_name as name, price
       FROM lab_tests WHERE status = 'Active'`
    );

    // Get appointment types (if you have a table for this)
    // For now, returning static appointment types
    const appointmentTypes = [
      { id: 1, code: 'GEN-OPD', name: 'General OPD Consultation', price: 200 },
      { id: 2, code: 'SP-OPD', name: 'Specialist OPD Consultation', price: 500 },
      { id: 3, code: 'FOLLOWUP', name: 'Follow-up Consultation', price: 100 },
      { id: 4, code: 'EMERGENCY', name: 'Emergency Consultation', price: 300 }
    ];

    res.json({
      success: true,
      data: {
        laboratory: labTests.map(t => ({ ...t, service_type: 'Laboratory' })),
        appointments: appointmentTypes.map(t => ({ ...t, service_type: 'Appointment' }))
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

// Delete bill
export const deleteBill = async (req, res) => {
  try {
    const { id } = req.params;
    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;

    const [result] = await db.query(
      `UPDATE bills SET status = "Inactive" WHERE id = ? ${scope ? 'AND branch_id = ?' : ''}`,
      scope ? [id, scope] : [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    res.json({ success: true, message: 'Bill deleted successfully' });
  } catch (error) {
    console.error('Error deleting bill:', error);
    res.status(500).json({ success: false, message: 'Server error deleting bill' });
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

    const [items] = await db.query('SELECT service_name as name, quantity, unit_price as amount, total_price FROM bill_items WHERE bill_id = ? AND status != "Inactive"', [bill.id]);

    let patientRegNo = 'N/A', age = '', gender = '';
    if (bill.patient_id) {
      const [patients] = await db.query('SELECT reg_no, dob, gender FROM patients WHERE id = ?', [bill.patient_id]);
      if (patients.length > 0) {
        patientRegNo = patients[0].reg_no;
        if (patients[0].dob) {
          const birthDate = new Date(patients[0].dob);
          const diffMs = Date.now() - birthDate.getTime();
          const ageDate = new Date(diffMs);
          age = Math.abs(ageDate.getUTCFullYear() - 1970).toString();
        }
        gender = patients[0].gender;
      }
    }

    const invoiceData = {
      bill_number: bill.bill_number,
      date: new Date(bill.created_at).toLocaleString(),
      patient_name: bill.patient_name,
      patient_reg_no: patientRegNo,
      age, gender, doctor_name: '', payment_method: bill.payment_method,
      discount_amount: bill.discount_amount, items
    };

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
      `SELECT id, bill_number, billing_type FROM bills WHERE (bill_number = ? OR id = ?) ${scope ? 'AND branch_id = ?' : ''}`,
      scope ? [id, id, scope] : [id, id]
    );
    if (billRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Bill not found' });
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

    const effectiveItems = effectiveBillingType === 'Free_Scheme'
      ? items.map(item => ({ ...item, unit_price: 0, total_price: 0 }))
      : items;

    const total_amount = effectiveItems.reduce((sum, item) => sum + (item.total_price || 0), 0);
    const net_amount = effectiveBillingType === 'Free_Scheme' ? 0 : total_amount - discount_amount;
    const effectivePaymentStatus = effectiveBillingType === 'Free_Scheme' ? 'Paid' : payment_status;
    const effectivePaidAmount = effectiveBillingType === 'Free_Scheme' ? 0 : paid_amount;
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
        effectivePaymentMethod, effectivePaymentStatus, effectivePaidAmount, notes || null,
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

    await connection.commit();

    res.status(200).json({
      success: true,
      message: 'Bill updated successfully',
      data: {
        bill_id: internal_bill_id,
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
