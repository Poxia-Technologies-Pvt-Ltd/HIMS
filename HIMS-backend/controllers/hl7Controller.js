import db from '../config/db.js';

/**
 * HL7 Patient Search API
 * Supports searching by: Phone, Name, Aadhar, UHID (reg_no)
 * Returns a format easily mappable to HL7 PID segment
 */
export const getPatientHL7 = async (req, res) => {
  try {
    const { phone, name, aadhar, uhid } = req.query;

    if (!phone && !name && !aadhar && !uhid) {
      return res.status(400).json({
        success: false,
        message: 'At least one search parameter (phone, name, aadhar, uhid) is required'
      });
    }

    let query = `SELECT * FROM patients WHERE 1=0`;
    let params = [];

    if (phone) { query += ` OR telephone = ?`; params.push(phone); }
    if (aadhar) { query += ` OR aadhar_number = ?`; params.push(aadhar); }
    if (uhid) { query += ` OR reg_no = ?`; params.push(uhid); }
    if (name) { 
      query += ` OR first_name LIKE ? OR last_name LIKE ?`; 
      params.push(`%${name}%`, `%${name}%`); 
    }

    const [rows] = await db.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    // Map to HL7-friendly structure
    const patients = rows.map(p => ({
      pid_3_uhid: p.reg_no,
      pid_5_name: {
        family_name: p.last_name,
        given_name: p.first_name,
        middle_name: p.middle_name
      },
      pid_7_dob: p.dob,
      pid_8_gender: p.gender === 'Male' ? 'M' : p.gender === 'Female' ? 'F' : 'O',
      pid_13_phone: p.telephone,
      pid_19_ssn: p.aadhar_number,
      address: {
        street: p.address,
        city: p.city,
        zip: p.postal_code,
        country: p.country
      }
    }));

    res.json({
      success: true,
      count: patients.length,
      data: patients
    });

  } catch (error) {
    console.error('HL7 Patient Search Error:', error);
    res.status(500).json({ success: false, message: 'Internal HL7 Search Error' });
  }
};

/**
 * HL7 Patient Registration API
 * Accepts HL7-structured data to register a patient
 * Typically called by HMIS (CDAC) when a patient is registered there
 */
export const registerPatientHL7 = async (req, res) => {
  try {
    const data = req.body;
    
    // Auto-generate Reg No if not provided by HMIS
    const regNo = data.uhid || `HL7-${Date.now()}`;
    
    const query = `
      INSERT INTO patients (
        reg_no, reg_date, title, first_name, middle_name, last_name,
        dob, gender, telephone, email_id, address, city, postal_code,
        aadhar_number, branch_id
      ) VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      regNo,
      data.title || 'Mr.',
      data.first_name,
      data.middle_name || '',
      data.last_name,
      data.dob || null,
      data.gender || 'Other',
      data.phone,
      data.email || '',
      data.address || '',
      data.city || '',
      data.zip || '',
      data.aadhar || null,
      data.branch_id || null
    ];

    const [result] = await db.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Patient registered via HL7 sync',
      meril_id: result.insertId,
      uhid: regNo
    });

  } catch (error) {
    console.error('HL7 Patient Registration Error:', error);
    res.status(500).json({ success: false, message: 'Failed to sync HL7 patient' });
  }
};
