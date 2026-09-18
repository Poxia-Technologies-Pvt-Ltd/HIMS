import db from '../config/db.js';

async function clearData() {
  const connection = await db.getConnection();
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    const tables = [
      'patients',
      'appointments',
      'bills',
      'bill_items',
      'consultations',
      'vitals',
      'digital_prescriptions',
      'doctor_lab_orders',
    ];

    for (const table of tables) {
      try {
        await connection.query(`TRUNCATE TABLE ${table}`);
        console.log(`✅ Cleared ${table}`);
      } catch (e) {
        console.log(`ℹ️  Skipped ${table} (${e.message.split('\n')[0]})`);
      }
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('\n🎉 All data cleared successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await connection.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    process.exit(1);
  } finally {
    connection.release();
  }
}

clearData();
