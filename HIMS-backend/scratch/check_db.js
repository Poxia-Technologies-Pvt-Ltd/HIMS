import pool from '../config/db.js';

async function check() {
  try {
    const [tables] = await pool.query('SHOW TABLES');
    console.log('Tables:', tables);
    
    // Check patients table for district info
    const [patientCols] = await pool.query('DESCRIBE patients');
    console.log('Patients Columns:', patientCols);

    // Check lab_tests or results
    const [testCols] = await pool.query('DESCRIBE lab_tests');
    console.log('Lab Tests Columns:', testCols);
    
    // Check if there is a disease_surveillance table
    const [hasTable] = await pool.query("SHOW TABLES LIKE 'disease_surveillance'");
    if (hasTable.length === 0) {
      console.log('Disease surveillance table NOT FOUND. Need to create it or aggregate from lab results.');
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

check();
