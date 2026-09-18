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

// Lets a Lab Head/verifying doctor kick a result back to the lab tech for a
// rerun instead of only Verify/Approve. Adds a new lab_test_result.status
// value plus a small reason/audit trail, kept as separate columns (not
// overloaded onto `notes`) so it can be cleared automatically once the tech
// re-submits results, rather than lingering as a stale note.
async function run() {
  const conn = await pool.getConnection();
  try {
    const [statusCol] = await conn.query(`SHOW COLUMNS FROM lab_test_result LIKE 'status'`);
    const hasRerun = statusCol.length > 0 && statusCol[0].Type.includes("'Rerun Requested'");
    if (!hasRerun) {
      await conn.query(
        `ALTER TABLE lab_test_result MODIFY COLUMN status ENUM('Pending','Test Done','Verified','Approved','Rerun Requested') DEFAULT 'Pending'`
      );
      console.log('✅ lab_test_result.status now includes "Rerun Requested"');
    } else {
      console.log('⏩ lab_test_result.status already includes "Rerun Requested"');
    }

    const [reasonCol] = await conn.query(`SHOW COLUMNS FROM lab_test_result LIKE 'rerun_reason'`);
    if (reasonCol.length === 0) {
      await conn.query(`ALTER TABLE lab_test_result ADD COLUMN rerun_reason VARCHAR(500) DEFAULT NULL AFTER notes`);
      console.log('✅ lab_test_result.rerun_reason added');
    } else {
      console.log('⏩ lab_test_result.rerun_reason already exists');
    }

    const [reqByCol] = await conn.query(`SHOW COLUMNS FROM lab_test_result LIKE 'rerun_requested_by'`);
    if (reqByCol.length === 0) {
      await conn.query(`ALTER TABLE lab_test_result ADD COLUMN rerun_requested_by INT DEFAULT NULL AFTER rerun_reason`);
      console.log('✅ lab_test_result.rerun_requested_by added');
    } else {
      console.log('⏩ lab_test_result.rerun_requested_by already exists');
    }

    const [reqAtCol] = await conn.query(`SHOW COLUMNS FROM lab_test_result LIKE 'rerun_requested_at'`);
    if (reqAtCol.length === 0) {
      await conn.query(`ALTER TABLE lab_test_result ADD COLUMN rerun_requested_at TIMESTAMP NULL DEFAULT NULL AFTER rerun_requested_by`);
      console.log('✅ lab_test_result.rerun_requested_at added');
    } else {
      console.log('⏩ lab_test_result.rerun_requested_at already exists');
    }

    console.log('\n✅ Rerun-request migration complete.');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
