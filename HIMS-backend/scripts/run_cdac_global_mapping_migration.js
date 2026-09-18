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

// Test-code and parameter-code mappings were originally scoped per hospital
// (hmis_hosp_mapping_code), requiring every branch to redo the same manual
// mapping work. That's unnecessary: lab_tests has no branch_id at all (it's
// one shared catalog across every branch), and CDAC's own docs describe
// hmis_parameter_code/hmis_parent_parameter_code/hmis_str_uom as "CDAC will
// provide" — i.e. centrally issued codes, not hospital-specific ones. This
// migration drops the per-hospital scoping so a mapping done once for any
// branch applies to every branch. hmis_hosp_mapping_code columns are kept
// (informational — which hospital's pull first produced/confirmed the
// mapping) but are no longer part of the lookup key.
async function run() {
  const conn = await pool.getConnection();
  try {
    // ── cdac_test_code_map: (hmis_hosp_mapping_code, hmis_test_code) -> (hmis_test_code) ──
    const [oldTestIdx] = await conn.query(
      `SELECT 1 FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'cdac_test_code_map' AND index_name = 'uq_cdac_test_code'`
    );
    if (oldTestIdx.length > 0) {
      await conn.query(`ALTER TABLE cdac_test_code_map DROP INDEX uq_cdac_test_code`);
      console.log('✅ old (hosp_code, test_code) unique key dropped from cdac_test_code_map');
    } else {
      console.log('⏩ old cdac_test_code_map unique key already absent');
    }

    const [newTestIdx] = await conn.query(
      `SELECT 1 FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'cdac_test_code_map' AND index_name = 'uq_cdac_test_code_global'`
    );
    if (newTestIdx.length === 0) {
      // Dedupe first — if the same hmis_test_code was ever seeded under two
      // different hosp codes, keep the one that's actually Mapped.
      await conn.query(`
        DELETE t1 FROM cdac_test_code_map t1
        JOIN cdac_test_code_map t2
          ON t1.hmis_test_code = t2.hmis_test_code AND t1.id < t2.id
        WHERE (t1.mapping_status != 'Mapped' OR t2.mapping_status = 'Mapped')
      `);
      await conn.query(`ALTER TABLE cdac_test_code_map ADD UNIQUE KEY uq_cdac_test_code_global (hmis_test_code)`);
      console.log('✅ new global (test_code) unique key added to cdac_test_code_map');
    } else {
      console.log('⏩ global cdac_test_code_map unique key already exists');
    }

    // ── cdac_parameter_map: (hmis_hosp_mapping_code, hmis_test_code, parameter_name) -> (hmis_test_code, parameter_name) ──
    const [oldParamIdx] = await conn.query(
      `SELECT 1 FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'cdac_parameter_map' AND index_name = 'uq_cdac_param_name'`
    );
    if (oldParamIdx.length > 0) {
      await conn.query(`ALTER TABLE cdac_parameter_map DROP INDEX uq_cdac_param_name`);
      console.log('✅ old (hosp_code, test_code, parameter_name) unique key dropped from cdac_parameter_map');
    } else {
      console.log('⏩ old cdac_parameter_map unique key already absent');
    }

    const [newParamIdx] = await conn.query(
      `SELECT 1 FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'cdac_parameter_map' AND index_name = 'uq_cdac_param_name_global'`
    );
    if (newParamIdx.length === 0) {
      await conn.query(`
        DELETE p1 FROM cdac_parameter_map p1
        JOIN cdac_parameter_map p2
          ON p1.hmis_test_code = p2.hmis_test_code AND p1.parameter_name = p2.parameter_name AND p1.id < p2.id
        WHERE (p1.mapping_status != 'Mapped' OR p2.mapping_status = 'Mapped')
      `);
      await conn.query(`ALTER TABLE cdac_parameter_map ADD UNIQUE KEY uq_cdac_param_name_global (hmis_test_code, parameter_name)`);
      console.log('✅ new global (test_code, parameter_name) unique key added to cdac_parameter_map');
    } else {
      console.log('⏩ global cdac_parameter_map unique key already exists');
    }

    console.log('\n✅ CDAC global-mapping migration complete.');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
