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

async function addColumnIfMissing(conn, table, column, definition) {
  const [rows] = await conn.query(`SHOW COLUMNS FROM ${table} LIKE '${column}'`);
  if (rows.length === 0) {
    await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`✅ ${table}.${column} added`);
  } else {
    console.log(`⏩ ${table}.${column} already exists`);
  }
}

async function run() {
  const conn = await pool.getConnection();
  try {
    // ── 1. branch_hmis_config — additive CARE columns ────────────────────────
    await addColumnIfMissing(conn, 'branch_hmis_config', 'care_gateway_external_id', 'VARCHAR(100) DEFAULT NULL');
    await addColumnIfMissing(conn, 'branch_hmis_config', 'care_sender_ip', 'VARCHAR(100) DEFAULT NULL');
    await addColumnIfMissing(conn, 'branch_hmis_config', 'care_oru_port', 'INT DEFAULT NULL');
    await addColumnIfMissing(conn, 'branch_hmis_config', 'care_orm_mode', 'VARCHAR(20) DEFAULT NULL');

    // ── 2. care_lab_orders ────────────────────────────────────────────────────
    const [ordersTbl] = await conn.query("SHOW TABLES LIKE 'care_lab_orders'");
    if (ordersTbl.length === 0) {
      await conn.query(`
        CREATE TABLE care_lab_orders (
          id                    INT AUTO_INCREMENT PRIMARY KEY,
          bill_item_id          INT NOT NULL,
          branch_id             INT NOT NULL,
          placer_order_number   VARCHAR(50) NOT NULL,
          filler_order_number   VARCHAR(50) NOT NULL,
          loinc_code            VARCHAR(20) NOT NULL,
          loinc_name            VARCHAR(200) DEFAULT NULL,
          coding_system         VARCHAR(255) DEFAULT NULL,
          message_control_id    VARCHAR(50) DEFAULT NULL,
          device_ip             VARCHAR(50) DEFAULT NULL,
          device_port           INT DEFAULT NULL,
          orm_mode              VARCHAR(20) DEFAULT NULL,
          last_pushed_status    VARCHAR(30) DEFAULT NULL,
          last_pushed_at        TIMESTAMP NULL DEFAULT NULL,
          last_push_error       TEXT DEFAULT NULL,
          created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_care_order_bill_item (bill_item_id),
          UNIQUE KEY uq_care_order_filler (filler_order_number),
          KEY idx_care_order_branch (branch_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('✅ care_lab_orders table created');
    } else {
      console.log('⏩ care_lab_orders table already exists');
    }
    // Widen coding_system on pre-existing tables — VARCHAR(20) is too narrow
    // for full URIs like http://snomed.info/sct (23 chars), which CARE's
    // Activity Definitions can legitimately use. Idempotent — safe to re-run.
    await conn.query(`ALTER TABLE care_lab_orders MODIFY COLUMN coding_system VARCHAR(255) DEFAULT NULL`);

    // ── 3. care_loinc_test_map ────────────────────────────────────────────────
    const [testMapTbl] = await conn.query("SHOW TABLES LIKE 'care_loinc_test_map'");
    if (testMapTbl.length === 0) {
      await conn.query(`
        CREATE TABLE care_loinc_test_map (
          id             INT AUTO_INCREMENT PRIMARY KEY,
          loinc_code     VARCHAR(20) NOT NULL,
          loinc_name     VARCHAR(200) DEFAULT NULL,
          lab_test_id    INT DEFAULT NULL,
          mapping_status ENUM('Mapped','Placeholder','Unmapped') NOT NULL DEFAULT 'Unmapped',
          created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_care_loinc_test (loinc_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('✅ care_loinc_test_map table created');
    } else {
      console.log('⏩ care_loinc_test_map table already exists');
    }

    // ── 4. care_loinc_parameter_map ───────────────────────────────────────────
    const [paramMapTbl] = await conn.query("SHOW TABLES LIKE 'care_loinc_parameter_map'");
    if (paramMapTbl.length === 0) {
      await conn.query(`
        CREATE TABLE care_loinc_parameter_map (
          id                    INT AUTO_INCREMENT PRIMARY KEY,
          loinc_code            VARCHAR(20) NOT NULL,
          parameter_loinc_code  VARCHAR(20) NOT NULL,
          parameter_name        VARCHAR(200) NOT NULL,
          uom                   VARCHAR(50) DEFAULT NULL,
          lab_test_parameter_id INT DEFAULT NULL,
          mapping_status        ENUM('Mapped','Unmapped') NOT NULL DEFAULT 'Unmapped',
          notes                 VARCHAR(255) DEFAULT NULL,
          created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_care_param (loinc_code, parameter_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('✅ care_loinc_parameter_map table created');
    } else {
      console.log('⏩ care_loinc_parameter_map table already exists');
    }

    // ── 5. care_integration_logs ──────────────────────────────────────────────
    const [logsTbl] = await conn.query("SHOW TABLES LIKE 'care_integration_logs'");
    if (logsTbl.length === 0) {
      await conn.query(`
        CREATE TABLE care_integration_logs (
          id                  INT AUTO_INCREMENT PRIMARY KEY,
          operation           VARCHAR(50) NOT NULL,
          direction           ENUM('INBOUND','OUTBOUND') NOT NULL,
          care_lab_order_id   INT DEFAULT NULL,
          bill_item_id        INT DEFAULT NULL,
          filler_order_number VARCHAR(50) DEFAULT NULL,
          branch_id           INT DEFAULT NULL,
          request_payload     JSON DEFAULT NULL,
          response_payload    JSON DEFAULT NULL,
          http_status         INT DEFAULT NULL,
          success             TINYINT(1) NOT NULL DEFAULT 0,
          error_message       TEXT DEFAULT NULL,
          duration_ms         INT DEFAULT NULL,
          created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          KEY idx_care_logs_bill_item (bill_item_id),
          KEY idx_care_logs_operation (operation, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('✅ care_integration_logs table created');
    } else {
      console.log('⏩ care_integration_logs table already exists');
    }

    // ── 6. starter LOINC seed ─────────────────────────────────────────────────
    const [testSeed] = await conn.query(`
      INSERT IGNORE INTO care_loinc_test_map (loinc_code, loinc_name, mapping_status) VALUES
        ('58410-2', 'CBC panel', 'Unmapped'),
        ('24323-8', 'Comprehensive metabolic panel', 'Unmapped'),
        ('24331-1', 'Lipid panel', 'Unmapped')
    `);
    console.log(`✅ care_loinc_test_map seeded (${testSeed.affectedRows} row(s) inserted)`);

    const [paramSeed] = await conn.query(`
      INSERT IGNORE INTO care_loinc_parameter_map (loinc_code, parameter_loinc_code, parameter_name, mapping_status) VALUES
        ('58410-2', '718-7',   'Hemoglobin',        'Unmapped'),
        ('58410-2', '6690-2',  'Leukocytes',        'Unmapped'),
        ('58410-2', '777-3',   'Platelets',         'Unmapped'),
        ('58410-2', '789-8',   'Erythrocytes',      'Unmapped'),
        ('58410-2', '4544-3',  'Hematocrit',        'Unmapped'),
        ('24323-8', '2345-7',  'Glucose',           'Unmapped'),
        ('24323-8', '3094-0',  'Urea Nitrogen',     'Unmapped'),
        ('24323-8', '2160-0',  'Creatinine',        'Unmapped'),
        ('24323-8', '2951-2',  'Sodium',            'Unmapped'),
        ('24323-8', '2823-3',  'Potassium',         'Unmapped'),
        ('24323-8', '2075-0',  'Chloride',          'Unmapped'),
        ('24323-8', '2028-9',  'Carbon Dioxide',    'Unmapped'),
        ('24323-8', '17861-6', 'Calcium',           'Unmapped'),
        ('24323-8', '2885-2',  'Total Protein',     'Unmapped'),
        ('24323-8', '1751-7',  'Albumin',           'Unmapped'),
        ('24323-8', '1975-2',  'Total Bilirubin',   'Unmapped'),
        ('24323-8', '6768-6',  'Alkaline Phosphatase', 'Unmapped'),
        ('24323-8', '1920-8',  'AST',               'Unmapped'),
        ('24323-8', '1742-6',  'ALT',               'Unmapped'),
        ('24331-1', '2093-3',  'Total Cholesterol', 'Unmapped'),
        ('24331-1', '2571-8',  'Triglycerides',     'Unmapped'),
        ('24331-1', '2085-9',  'HDL Cholesterol',   'Unmapped'),
        ('24331-1', '13457-7', 'LDL Cholesterol',   'Unmapped')
    `);
    console.log(`✅ care_loinc_parameter_map seeded (${paramSeed.affectedRows} row(s) inserted)`);

    console.log('\n✅ Care HIMS integration migration complete.');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
