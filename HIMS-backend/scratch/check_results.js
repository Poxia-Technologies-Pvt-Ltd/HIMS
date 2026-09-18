import pool from '../config/db.js';

async function check() {
  try {
    const [resultCols] = await pool.query('DESCRIBE lab_test_result');
    console.log('Lab Test Result Columns:', resultCols);
    
    // Check some sample data to see how findings are stored
    const [samples] = await pool.query('SELECT * FROM lab_test_result LIMIT 5');
    console.log('Sample Results:', samples);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

check();
