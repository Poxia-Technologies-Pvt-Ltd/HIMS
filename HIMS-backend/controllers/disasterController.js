import pool from '../config/db.js';

export const getSurveillanceData = async (req, res) => {
  try {
    const { timeFilter } = req.query;
    
    // In a real scenario, timeFilter would change the date range.
    // For now, we fetch the latest data per district/disease.
    
    const [rows] = await pool.query(`
      SELECT district, disease, cases, trend, risk_level 
      FROM disease_surveillance 
      WHERE recorded_date = (SELECT MAX(recorded_date) FROM disease_surveillance)
    `);

    // Map to the format expected by the frontend
    const data = rows.map(row => ({
      district: row.district,
      disease: row.disease,
      cases: row.cases,
      trend: row.trend,
      risk_level: row.risk_level
    }));

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching surveillance data:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getAlerts = async (req, res) => {
  try {
    // Mock alerts or fetch from a dedicated alerts table
    const alerts = [
      { id: 1, type: "CRITICAL", msg: "Dengue spike detected in Ranchi (Zone 4)", time: "10 mins ago" },
      { id: 2, type: "WARNING", msg: "Malaria diagnostic kits low in Dhanbad", time: "1 hour ago" },
      { id: 3, type: "INFO", msg: "Mobile health unit deployed to Hazaribagh", time: "2 hours ago" },
      { id: 4, type: "CRITICAL", msg: "Unusual Typhoid clustering in Palamu North", time: "4 hours ago" }
    ];
    res.json({ success: true, data: alerts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
