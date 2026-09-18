import db from '../config/db.js';

export const bookAppointment = async (req, res) => {
  try {
    const { regNo, department, doctor, doctor_id, priority, apptDate, apptTime, reason } = req.body;

    if (!regNo || !department || !apptDate) {
      return res.status(400).json({ success: false, message: 'RegNo, Department, and Date are required' });
    }

    // Enforce branch from JWT; Central admins may pass branch_id in body
    const branch_id = req.user?.role_level !== 'Central'
      ? req.user?.branch_id
      : (req.body.branch_id || null);

    const [result] = await db.query(
      `INSERT INTO appointments (reg_no, department, doctor, doctor_id, priority, appt_date, appt_time, reason, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [regNo, department, doctor, doctor_id || null, priority || 'Routine', apptDate, apptTime, reason, branch_id || null]
    );

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully',
      appointmentId: result.insertId
    });

  } catch (error) {
    console.error('Error booking appointment:', error);
    res.status(500).json({ success: false, message: 'Server error booking appointment' });
  }
};

export const getAppointments = async (req, res) => {
  try {
    const { date } = req.query;
    // Enforce branch from JWT; Central admins may filter via query param
    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    const filterBranch = scope || req.query.branch_id || null;

    let query = 'SELECT * FROM appointments WHERE 1=1';
    const params = [];

    if (filterBranch) {
      query += ' AND branch_id = ?';
      params.push(filterBranch);
    }

    if (date) {
      query += ' AND appt_date = ?';
      params.push(date);
    }

    query += ' ORDER BY appt_date ASC, appt_time ASC';

    const [rows] = await db.query(query, params);
    res.json({ success: true, appointments: rows });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ success: false, message: 'Server error fetching appointments' });
  }
};
