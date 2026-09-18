import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'meril-hims',
  port:     process.env.DB_PORT     || 8889,
  multipleStatements: true,
});

// lab_machines.status was defined as ENUM('Active','Inactive','Maintenance'),
// but every place that actually writes/reads it (labMachineController.js's
// logAnalyzerEvent and getMachineStats) treats it as connectivity —
// 'Online'/'Offline'. Every attempt to record a machine going online/offline
// has been throwing "Data truncated for column 'status'" against the old
// enum, silently caught, which is why analyzer stats always showed 0
// online/0 offline even for genuinely connected machines.
async function run() {
  const conn = await pool.getConnection();
  try {
    const [statusCol] = await conn.query(`SHOW COLUMNS FROM lab_machines LIKE 'status'`);
    const hasOnlineOffline = statusCol.length > 0 && statusCol[0].Type.includes("'Online'") && statusCol[0].Type.includes("'Offline'");
    if (!hasOnlineOffline) {
      await conn.query(
        `ALTER TABLE lab_machines MODIFY COLUMN status ENUM('Active','Inactive','Maintenance','Online','Offline') DEFAULT 'Active'`
      );
      console.log("✅ lab_machines.status now includes 'Online'/'Offline'");
    } else {
      console.log("⏩ lab_machines.status already includes 'Online'/'Offline'");
    }

    console.log('\n✅ lab_machines status fix complete.');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
