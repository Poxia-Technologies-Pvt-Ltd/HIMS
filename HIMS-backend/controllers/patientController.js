import db from '../config/db.js';
import { PUBLIC_API_URL } from '../config/publicUrl.js';
import jwt from 'jsonwebtoken';
import { generateLabReportPDFStream } from '../utils/pdfGenerator.js';
import { createCaptcha, verifyCaptcha } from '../utils/captchaStore.js';
import { getBlockedUntil, recordLoginFailure, recordLoginSuccess } from '../utils/bruteForceGuard.js';

// Generate patient token
const generatePatientToken = (id, phone) => {
  return jwt.sign({ id, phone, type: 'patient' }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
};

// Patient Portal: Login by Phone + DOB
export const loginByPhone = async (req, res) => {
  const clientIp = req.ip;

  const blockedUntil = getBlockedUntil(clientIp);
  if (blockedUntil) {
    res.setHeader('Retry-After', Math.ceil((blockedUntil - Date.now()) / 1000));
    return res.status(429).json({
      success: false,
      message: 'Too many failed login attempts from this network. Try again in 24 hours.',
      blockedUntil: new Date(blockedUntil).toISOString(),
    });
  }

  try {
    const { phone, dob, captchaId, captchaText } = req.body;

    if (!phone || !dob) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and date of birth are required'
      });
    }

    if (!verifyCaptcha(captchaId, captchaText)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired captcha',
        captcha: createCaptcha()
      });
    }

    const [patients] = await db.query(
      'SELECT * FROM patients WHERE telephone = ? AND dob = ?',
      [phone, dob]
    );

    if (patients.length === 0) {
      recordLoginFailure(clientIp);
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or date of birth',
        captcha: createCaptcha()
      });
    }

    const patient = patients[0];
    recordLoginSuccess(clientIp);

    res.json({
      success: true,
      message: 'Login successful',
      patient: {
        id: patient.id,
        reg_no: patient.reg_no,
        first_name: patient.first_name,
        last_name: patient.last_name,
        phone: patient.telephone,
        email: patient.email_id,
        dob: patient.dob,
        gender: patient.gender
      },
      token: generatePatientToken(patient.id, patient.telephone)
    });

  } catch (error) {
    console.error('Error during patient login:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login',
      captcha: createCaptcha()
    });
  }
};

// Patient Portal: Get profile by phone
export const getPatientProfile = async (req, res) => {
  try {
    const { phone } = req.params;

    const [patients] = await db.query(
      `SELECT
        id, reg_no, reg_date, is_new_born,
        title, first_name, middle_name, last_name,
        dob, gender, aadhar_number,
        marital_status, occupation, language, education_level, religion,
        citizen, email_id, telephone,
        address, suburb, city, country, postal_code,
        kin_name, kin_relation, kin_telephone,
        payer_type, insurance_provider, policy_number
      FROM patients WHERE telephone = ?`,
      [phone]
    );

    if (patients.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    res.json({
      success: true,
      patient: patients[0]
    });

  } catch (error) {
    console.error('Error fetching patient profile:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching profile'
    });
  }
};

// Patient Portal: Get patient's lab reports by phone
export const getPatientReports = async (req, res) => {
  try {
    const { phone } = req.params;

    const [reports] = await db.query(
      `SELECT
        tr.id,
        tr.sample_id,
        tr.test_name,
        tr.tested_at,
        tr.verified_at,
        tr.verified_by,
        tr.status,
        CONCAT(p.first_name, ' ', p.last_name) as patient_name,
        p.reg_no as patient_reg_no,
        CONCAT(u.first_name, ' ', u.last_name) as verified_by_name
      FROM lab_test_result tr
      JOIN bill_items bi ON tr.sample_id = bi.sample_id
      JOIN bills b ON bi.bill_id = b.id
      JOIN patients p ON b.patient_id = p.id
      LEFT JOIN users u ON tr.verified_by = u.id
      WHERE p.telephone = ? AND tr.status = 'Approved'
      ORDER BY tr.verified_at DESC`,
      [phone]
    );

    res.json({
      success: true,
      count: reports.length,
      reports
    });

  } catch (error) {
    console.error('Error fetching patient reports:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching reports'
    });
  }
};

// Patient Portal: Download specific report
export const downloadPatientReport = async (req, res) => {
  try {
    const { phone, sampleId } = req.params;

    const [rows] = await db.query(
      `SELECT
        tr.id,
        tr.sample_id,
        tr.machine_no,
        tr.test_name,
        tr.results_json,
        tr.tested_by,
        tr.tested_at,
        tr.verified_by,
        tr.verified_at,
        tr.notes,
        tr.status,
        CONCAT(p.first_name, ' ', p.last_name) as patient_name,
        p.reg_no as patient_reg_no,
        p.dob as patient_dob,
        p.gender as patient_gender,
        CONCAT(ut.first_name, ' ', ut.last_name) as tested_by_name,
        CONCAT(uv.first_name, ' ', uv.last_name) as verified_by_name
      FROM lab_test_result tr
      JOIN bill_items bi ON tr.bill_item_id = bi.id
      JOIN bills b ON bi.bill_id = b.id
      JOIN patients p ON b.patient_id = p.id
      LEFT JOIN users ut ON tr.tested_by = ut.id
      LEFT JOIN users uv ON tr.verified_by = uv.id
      WHERE tr.sample_id = ? AND p.telephone = ? AND tr.status = 'Approved'`,
      [sampleId, phone]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Report not found or not approved'
      });
    }

    const report = rows[0];

    let results = [];
    try {
      results = typeof report.results_json === 'string'
        ? JSON.parse(report.results_json)
        : report.results_json;
    } catch (e) {
      results = [];
    }

    res.json({
      success: true,
      report: {
        id: report.id,
        sample_id: report.sample_id,
        test_name: report.test_name,
        patient_name: report.patient_name,
        patient_reg_no: report.patient_reg_no,
        patient_dob: report.patient_dob,
        patient_gender: report.patient_gender,
        tested_by_name: report.tested_by_name,
        tested_at: report.tested_at,
        verified_by_name: report.verified_by_name,
        verified_at: report.verified_at,
        results,
        notes: report.notes
      }
    });

  } catch (error) {
    console.error('Error downloading patient report:', error);
    res.status(500).json({
      success: false,
      message: 'Server error downloading report'
    });
  }
};

// Patient Portal: Generate and download PDF report
export const downloadPatientReportPDF = async (req, res) => {
  try {
    const { phone, sampleId } = req.params;

    // Verify patient owns this report
    const [verifyRows] = await db.query(
      `SELECT tr.id
      FROM lab_test_result tr
      JOIN bill_items bi ON tr.sample_id = bi.sample_id
      JOIN bills b ON bi.bill_id = b.id
      JOIN patients p ON b.patient_id = p.id
      WHERE tr.sample_id = ? AND p.telephone = ? AND tr.status = 'Approved'`,
      [sampleId, phone]
    );

    if (!verifyRows || verifyRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Report not found or access denied'
      });
    }

    // Fetch full report data
    const [rows] = await db.query(
      `SELECT
        tr.id,
        tr.sample_id,
        tr.machine_no,
        tr.test_name,
        tr.results_json,
        tr.tested_by,
        tr.tested_at,
        tr.verified_by,
        tr.verified_at,
        tr.notes,
        CONCAT(p.first_name, ' ', p.last_name) as patient_name,
        p.reg_no as patient_reg_no,
        p.gender,
        p.dob,
        CONCAT(ut.first_name, ' ', ut.last_name) as tested_by_name,
        CONCAT(uv.first_name, ' ', uv.last_name) as verified_by_name,
        i.name as lab_name,
        br.branch_name, br.address as branch_address, br.contact_number as branch_contact
      FROM lab_test_result tr
      JOIN bill_items bi ON tr.sample_id = bi.sample_id
      JOIN bills b ON bi.bill_id = b.id
      JOIN patients p ON b.patient_id = p.id
      LEFT JOIN branches br ON b.branch_id = br.id
      LEFT JOIN users ut ON tr.tested_by = ut.id
      LEFT JOIN users uv ON tr.verified_by = uv.id
      LEFT JOIN infrastructure i ON bi.lab_id = i.id
      WHERE tr.sample_id = ? AND tr.status = 'Approved'
      LIMIT 1`,
      [sampleId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    const report = rows[0];

    // Parse JSON results
    let results = [];
    try {
      results = typeof report.results_json === 'string'
        ? JSON.parse(report.results_json)
        : report.results_json;
    } catch {
      results = [];
    }

    // Calculate age from DOB
    let age = 'N/A';
    if (report.dob) {
      const birthDate = new Date(report.dob);
      const today = new Date();
      let ageYears = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        ageYears--;
      }
      age = ageYears + ' Y';
    }

    // Format dates
    const formatDate = (date) => {
      if (!date) return 'N/A';
      const d = new Date(date);
      return d.toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: '2-digit',
        hour: '2-digit', minute: '2-digit'
      }).replace(',', '');
    };

    // Build report URL for QR code
    const reportUrl = `${PUBLIC_API_URL}/api/lab/report-details/${sampleId}`;

    // Transform to PDF format
    const reportData = {
      branch_name: report.branch_name,
      branch_address: report.branch_address,
      branch_contact: report.branch_contact,
      patient_name: report.patient_name || 'Unknown',
      patient_reg_no: report.patient_reg_no || 'N/A',
      sample_id: report.sample_id,
      gender: report.gender || 'N/A',
      age: age,
      referred_by: 'Self',
      centre: report.lab_name || report.branch_name || 'MERIL HIMS',
      registration_date: formatDate(report.tested_at),
      tested_by_name: report.tested_by_name || 'N/A',
      tested_at: formatDate(report.tested_at),
      verified_by_name: report.verified_by_name || 'N/A',
      verified_at: formatDate(report.verified_at),
      report_url: reportUrl,
      tests: [{
        test_name: report.test_name || 'Lab Test',
        sample_type: 'Blood Sample',
        accession_no: report.sample_id,
        collected_on: formatDate(report.tested_at),
        received_on: formatDate(report.tested_at),
        approved_on: formatDate(report.verified_at),
        remarks: report.notes || 'Please correlate results clinically.',
        parameters: results.map(r => ({
          parameter_name: r.parameter_name || r.parameter_code || 'Unknown',
          result_value: r.value || r.result_value || '',
          unit: r.unit || r.parameter_unit || '',
          reference_range: r.reference_range || (r.min_value && r.max_value ? `${r.min_value} - ${r.max_value}` : ''),
          result_flag: (r.result_flag || 'normal').toLowerCase(),
          is_subheader: r.is_subheader || false
        }))
      }]
    };

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="lab-report-${sampleId}.pdf"`);

    // Generate and stream PDF
    const doc = await generateLabReportPDFStream(reportData);
    doc.pipe(res);

  } catch (error) {
    console.error('Error generating patient PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Server error generating PDF'
    });
  }
};

export const registerPatient = async (req, res) => {
  try {
    const data = req.body;
    
    // Extract fields matching the DB schema
    const {
      regNo, regDate, isNewBorn, patientType, consultantName, photo_base64,
      title, firstName, middleName, lastName, dob, gender,
      aadharNumber,
      maritalStatus, occupation, language, educationLevel, religion,
      citizen, emailId, telephone, fileRequired,
      address, suburb, city, country, postalCode, postalAddress,
      kinSameAddress, kinName, kinRelation, kinTelephone,
      kinAddress, kinSuburb, kinCity, kinCountry, kinCode,
      payerType, insuranceProvider, policyNumber,
      branch_id
    } = data;

    const query = `
      INSERT INTO patients (
        reg_no, reg_date, is_new_born, patient_type, consultant_name, photo_base64,
        title, first_name, middle_name, last_name, dob, gender,
        aadhar_number,
        marital_status, occupation, language, education_level, religion,
        citizen, email_id, telephone, file_required,
        address, suburb, city, country, postal_code, postal_address_check,
        kin_same_address, kin_name, kin_relation, kin_telephone,
        kin_address, kin_suburb, kin_city, kin_country, kin_code,
        payer_type, insurance_provider, policy_number, branch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      regNo, regDate, isNewBorn || false, patientType || 'OP', consultantName || null, photo_base64 || null,
      title, firstName, middleName, lastName, dob || null, gender,
      aadharNumber || null,
      maritalStatus, occupation, language, educationLevel, religion,
      citizen, emailId, telephone, fileRequired || false,
      address, suburb, city, country, postalCode, postalAddress || false,
      kinSameAddress || false, kinName, kinRelation, kinTelephone,
      kinAddress, kinSuburb, kinCity, kinCountry, kinCode,
      payerType, insuranceProvider, policyNumber, branch_id || null
    ];

    const [result] = await db.query(query, values);

    res.status(201).json({ 
      success: true, 
      message: 'Patient registered successfully', 
      patientId: result.insertId,
      regNo 
    });

  } catch (error) {
    console.error('Error saving patient:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Registration number already exists' });
    }
    res.status(500).json({ success: false, message: 'Server error saving patient' });
  }
};

export const searchPatients = async (req, res) => {
  try {
    const { type, q } = req.query;
    if (!q) return res.status(400).json({ success: false, message: 'Search query required' });

    // Enforce branch from the JWT — Central staff can search network-wide.
    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    const branchClause = scope ? ' AND branch_id = ?' : '';

    let query = '';
    let params = [];

    // Allow targeting specific fields from the dropdown
    if (type === 'telephone') {
      query = `SELECT * FROM patients WHERE telephone LIKE ?${branchClause} LIMIT 20`;
      params = [`%${q}%`];
    } else if (type === 'email_id') {
      query = `SELECT * FROM patients WHERE email_id LIKE ?${branchClause} LIMIT 20`;
      params = [`%${q}%`];
    } else if (type === 'aadhar_number') {
      query = `SELECT * FROM patients WHERE aadhar_number LIKE ?${branchClause} LIMIT 20`;
      params = [`%${q}%`];
    } else {
      // Fallback global search
      query = `
        SELECT * FROM patients
        WHERE (telephone LIKE ?
           OR email_id LIKE ?
           OR aadhar_number LIKE ?
           OR first_name LIKE ?
           OR last_name LIKE ?)
           ${branchClause}
        LIMIT 20
      `;
      params = [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`];
    }

    if (scope) params.push(scope);

    const [rows] = await db.query(query, params);

    res.json({ success: true, patients: rows });
  } catch (error) {
    console.error('Error searching patient:', error);
    res.status(500).json({ success: false, message: 'Server error searching patient' });
  }
};

// GET /api/patients/consultants?q=... — autocomplete source for the
// Consultant Name field on registration. Deliberately not a separate
// doctors/consultants master table — just the distinct values already
// typed into patients.consultant_name, so the list grows organically from
// real usage instead of needing separate registration/maintenance.
export const searchConsultants = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();

    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    const branchClause = scope ? ' AND branch_id = ?' : '';
    const params = [];
    if (q) params.push(`%${q}%`);
    if (scope) params.push(scope);

    const [rows] = await db.query(
      `SELECT DISTINCT consultant_name
       FROM patients
       WHERE consultant_name IS NOT NULL AND consultant_name <> ''
         ${q ? 'AND consultant_name LIKE ?' : ''}
         ${branchClause}
       ORDER BY consultant_name
       LIMIT 20`,
      params
    );

    res.json({ success: true, consultants: rows.map(r => r.consultant_name) });
  } catch (error) {
    console.error('Error searching consultants:', error);
    res.status(500).json({ success: false, message: 'Server error searching consultants' });
  }
};

// GET /api/patients/:regNo/chart — full demographics for doctor's patient chart view
export const getPatientChart = async (req, res) => {
  try {
    const { regNo } = req.params;
    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    const [[patient]] = await db.query(
      `SELECT id, reg_no, reg_date, title, first_name, middle_name, last_name,
              dob, gender, telephone, email_id, aadhar_number,
              photo_base64, payer_type, insurance_provider, policy_number,
              address, suburb, city, country, postal_code,
              kin_name, kin_relation, kin_telephone, branch_id
         FROM patients WHERE reg_no = ? ${scope ? 'AND branch_id = ?' : ''} LIMIT 1`,
      scope ? [regNo, scope] : [regNo]
    );
    if (!patient) return res.status(404).json({ success: false, error: 'Patient not found' });
    return res.json({ success: true, patient });
  } catch (error) {
    console.error('Error fetching patient chart:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/patients/check-duplicate — find potential duplicates by phone, name, or DOB
// Deliberately network-wide (not branch-scoped): this runs during registration
// specifically to catch the same patient already registered at a different
// branch, so scoping it would just create more duplicates across the network.
export const checkDuplicate = async (req, res) => {
  try {
    const { telephone, firstName, lastName, dob } = req.query;
    if (!telephone && !firstName) return res.json({ success: true, duplicates: [] });

    let query = `SELECT id, reg_no, first_name, middle_name, last_name, dob, gender,
                        telephone, photo_base64, reg_date
                   FROM patients WHERE `;
    const conditions = [], params = [];

    if (telephone) {
      conditions.push('telephone = ?');
      params.push(telephone);
    }
    if (firstName && lastName) {
      conditions.push('(first_name = ? AND last_name = ?)');
      params.push(firstName, lastName);
    }
    if (dob && telephone) {
      conditions.push('(dob = ? AND telephone LIKE ?)');
      params.push(dob, `%${telephone.slice(-6)}%`);
    }

    query += conditions.join(' OR ') + ' ORDER BY reg_date DESC LIMIT 10';
    const [rows] = await db.query(query, params);
    res.json({ success: true, duplicates: rows });
  } catch (error) {
    console.error('Error checking duplicate:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/patients/merge — merge secondaryId into primaryId
export const mergePatients = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { primaryRegNo, secondaryRegNo } = req.body;
    if (!primaryRegNo || !secondaryRegNo || primaryRegNo === secondaryRegNo)
      return res.status(400).json({ success: false, message: 'primaryRegNo and secondaryRegNo are required and must differ' });

    await conn.beginTransaction();

    const [[primary]]   = await conn.query('SELECT id, reg_no FROM patients WHERE reg_no = ? LIMIT 1', [primaryRegNo]);
    const [[secondary]] = await conn.query('SELECT id, reg_no FROM patients WHERE reg_no = ? LIMIT 1', [secondaryRegNo]);

    if (!primary || !secondary)
      return res.status(404).json({ success: false, message: 'One or both patients not found' });

    // Migrate all linked records from secondary → primary
    await conn.query('UPDATE appointments SET reg_no = ? WHERE reg_no = ?', [primary.reg_no, secondary.reg_no]);
    await conn.query('UPDATE consultations SET patient_reg_no = ? WHERE patient_reg_no = ?', [primary.reg_no, secondary.reg_no]);
    await conn.query('UPDATE bills SET patient_id = ? WHERE patient_id = ?', [primary.id, secondary.id]);

    // Delete secondary patient
    await conn.query('DELETE FROM patients WHERE id = ?', [secondary.id]);
    await conn.commit();

    res.json({ success: true, message: `Patient ${secondaryRegNo} merged into ${primaryRegNo} and deleted` });
  } catch (error) {
    await conn.rollback();
    console.error('Error merging patients:', error);
    res.status(500).json({ success: false, message: 'Server error during merge' });
  } finally {
    conn.release();
  }
};

// GET /api/patients/phone-lookup/:phone — full patient demographics + history for phone demographic panel
export const getPatientByPhone = async (req, res) => {
  try {
    const { phone } = req.params;
    const [[patient]] = await db.query(
      `SELECT id, reg_no, reg_date, title, first_name, middle_name, last_name,
              dob, gender, telephone, email_id, aadhar_number,
              photo_base64, payer_type, insurance_provider, policy_number,
              address, suburb, city, country, postal_code,
              kin_name, kin_relation, kin_telephone,
              marital_status, occupation, language, education_level, religion
         FROM patients WHERE telephone = ? LIMIT 1`,
      [phone]
    );
    if (!patient) return res.status(404).json({ success: false, message: 'No patient found with this phone number' });

    const [consultations] = await db.query(
      `SELECT c.id, c.chief_complaints, c.diagnosis, c.doctor_notes, c.status, c.consultation_date AS created_at,
              a.doctor, a.department, a.appt_time
         FROM consultations c
         LEFT JOIN appointments a ON c.appointment_id = a.id
        WHERE c.patient_reg_no = ?
        ORDER BY c.consultation_date DESC LIMIT 5`,
      [patient.reg_no]
    );

    const [bills] = await db.query(
      `SELECT id, bill_number, total_amount, paid_amount, payment_status, payment_method, created_at
         FROM bills WHERE patient_id = ?
        ORDER BY created_at DESC LIMIT 5`,
      [patient.id]
    );

    const [labs] = await db.query(
      `SELECT ltr.id, ltr.sample_id, ltr.test_name, ltr.result_value, ltr.unit,
              ltr.reference_range, ltr.status, ltr.created_at
         FROM lab_test_result ltr
         JOIN bill_items bi ON ltr.bill_item_id = bi.id
         JOIN bills b ON bi.bill_id = b.id
        WHERE b.patient_id = ?
          AND ltr.status IN ('Verified', 'Approved')
        ORDER BY ltr.created_at DESC LIMIT 10`,
      [patient.id]
    );

    res.json({ success: true, patient, consultations, bills, labs });
  } catch (error) {
    console.error('Error fetching patient by phone:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

