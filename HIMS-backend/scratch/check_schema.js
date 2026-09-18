
import db from '../config/db.js';

async function checkSchema() {
  try {
    const [columns] = await db.query('SHOW COLUMNS FROM lab_test_result');
    console.log("Columns in lab_test_result:", columns.map(c => c.Field));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkSchema();
