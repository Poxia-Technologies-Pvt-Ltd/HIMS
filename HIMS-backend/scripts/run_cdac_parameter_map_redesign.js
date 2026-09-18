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

// cdac_parameter_map was originally keyed on lab_test_parameter_id, requiring
// a parameter to be pre-configured in our catalog before it could get a CDAC
// code. That's too rigid: a CDAC order can say "CBC" while the lab only
// actually runs/reports Platelet off a POCT analyzer for that order. This
// migration re-keys the table as a flat CDAC-name -> CDAC-code lookup per
// test, independent of our internal parameter catalog, so pushing matches
// directly against whatever the analyzer produced (results_json), not
// against a pre-configured parameter list.
async function run() {
  const conn = await pool.getConnection();
  try {
    const [nameCol] = await conn.query(`SHOW COLUMNS FROM cdac_parameter_map LIKE 'parameter_name'`);
    if (nameCol.length === 0) {
      await conn.query(`ALTER TABLE cdac_parameter_map ADD COLUMN parameter_name VARCHAR(200) NOT NULL DEFAULT '' AFTER hmis_sample_code`);
      console.log('✅ cdac_parameter_map.parameter_name added');
    } else {
      console.log('⏩ cdac_parameter_map.parameter_name already exists');
    }

    // Backfill parameter_name from lab_test_parameters for any pre-existing
    // rows that still have a lab_test_parameter_id set (harmless no-op if empty).
    await conn.query(`
      UPDATE cdac_parameter_map cpm
      JOIN lab_test_parameters ltp ON ltp.id = cpm.lab_test_parameter_id
      SET cpm.parameter_name = ltp.parameter_name
      WHERE cpm.parameter_name = '' AND cpm.lab_test_parameter_id IS NOT NULL
    `);

    const [oldIdx] = await conn.query(
      `SELECT 1 FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'cdac_parameter_map' AND index_name = 'uq_cdac_param_lab_test_parameter'`
    );
    if (oldIdx.length > 0) {
      await conn.query(`ALTER TABLE cdac_parameter_map DROP INDEX uq_cdac_param_lab_test_parameter`);
      console.log('✅ old lab_test_parameter_id unique key dropped');
    } else {
      console.log('⏩ old unique key already absent');
    }

    const [newIdx] = await conn.query(
      `SELECT 1 FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'cdac_parameter_map' AND index_name = 'uq_cdac_param_name'`
    );
    if (newIdx.length === 0) {
      await conn.query(
        `ALTER TABLE cdac_parameter_map ADD UNIQUE KEY uq_cdac_param_name (hmis_hosp_mapping_code, hmis_test_code, parameter_name)`
      );
      console.log('✅ new (hosp_code, test_code, parameter_name) unique key added');
    } else {
      console.log('⏩ new unique key already exists');
    }

    // lab_test_parameter_id is now purely informational (optional link back
    // to our catalog, if one happens to exist) — make it explicitly nullable,
    // matching how it's actually used going forward.
    await conn.query(`ALTER TABLE cdac_parameter_map MODIFY COLUMN lab_test_parameter_id INT DEFAULT NULL`);

    console.log('\n✅ cdac_parameter_map redesign complete.');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
