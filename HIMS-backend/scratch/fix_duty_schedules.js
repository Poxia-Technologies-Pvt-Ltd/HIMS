import db from '../config/db.js';

async function fixDutySchedules() {
  try {
    console.log('✅ Connected to database');

    // Add branch_id column if it doesn't exist
    const addColumnQuery = `
      ALTER TABLE duty_schedules 
      ADD COLUMN branch_id INT DEFAULT NULL;
    `;

    try {
      await db.query(addColumnQuery);
      console.log('🎉 branch_id column added to duty_schedules');
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log('Column branch_id already exists.');
      } else {
        throw err;
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixDutySchedules();
