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

async function run() {
  const conn = await pool.getConnection();
  try {
    // cdac_parameter_map needs a unique key on lab_test_parameter_id so
    // upsertParameterMapping's ON DUPLICATE KEY UPDATE can target "one CDAC
    // mapping per our parameter". Multiple NULLs (unmatched rows) are fine —
    // MySQL only enforces uniqueness among non-NULL values.
    const [idx] = await conn.query(
      `SELECT 1 FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'cdac_parameter_map' AND index_name = 'uq_cdac_param_lab_test_parameter'`
    );
    if (idx.length === 0) {
      await conn.query(
        `ALTER TABLE cdac_parameter_map ADD UNIQUE KEY uq_cdac_param_lab_test_parameter (lab_test_parameter_id)`
      );
      console.log('✅ cdac_parameter_map.lab_test_parameter_id unique key added');
    } else {
      console.log('⏩ cdac_parameter_map unique key already exists');
    }

    console.log('\n✅ CDAC mapping migration complete.');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
