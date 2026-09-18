import pool from '../config/db.js';

async function check() {
  try {
    const [rows] = await pool.query("SELECT * FROM infrastructure WHERE type = 'Lab'");
    console.log('Infrastructure Labs:', rows);
    
    const [branches] = await pool.query("SELECT id, branch_name, hospital_code FROM branches");
    console.log('Branches:', branches);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

check();
