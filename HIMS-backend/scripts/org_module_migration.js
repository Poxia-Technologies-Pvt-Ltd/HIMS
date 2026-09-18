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
    // ── 1. states ─────────────────────────────────────────────────────────────
    const [statesCols] = await conn.query("SHOW TABLES LIKE 'states'");
    if (statesCols.length === 0) {
      await conn.query(`
        CREATE TABLE states (
          id         INT AUTO_INCREMENT PRIMARY KEY,
          name       VARCHAR(100) NOT NULL,
          code       VARCHAR(10)  NOT NULL,
          is_active  TINYINT(1)   DEFAULT 1,
          created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_state_name (name),
          UNIQUE KEY uq_state_code (code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await conn.query(`INSERT IGNORE INTO states (id, name, code) VALUES (1, 'Jharkhand', 'JH'), (2, 'Odisha', 'OD')`);
      console.log('✅ states table created + seeded');
    } else {
      console.log('⏩ states table already exists');
    }

    // ── 2. state_id on districts ───────────────────────────────────────────────
    const [distStateCols] = await conn.query("SHOW COLUMNS FROM districts LIKE 'state_id'");
    if (distStateCols.length === 0) {
      await conn.query(`ALTER TABLE districts ADD COLUMN state_id INT DEFAULT 1 AFTER id`);
      await conn.query(`UPDATE districts SET state_id = 1 WHERE state_id IS NULL`);
      console.log('✅ districts.state_id added');
    } else {
      console.log('⏩ districts.state_id already exists');
    }

    // ── 3. blocks ─────────────────────────────────────────────────────────────
    const [blocksTbl] = await conn.query("SHOW TABLES LIKE 'blocks'");
    if (blocksTbl.length === 0) {
      await conn.query(`
        CREATE TABLE blocks (
          id          INT AUTO_INCREMENT PRIMARY KEY,
          name        VARCHAR(150) NOT NULL,
          district_id INT          NOT NULL,
          is_active   TINYINT(1)   DEFAULT 1,
          created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_block_district (name, district_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('✅ blocks table created');
    } else {
      console.log('⏩ blocks table already exists');
    }

    // ── 4. block_id + facility_type on branches ───────────────────────────────
    const [blockIdCol] = await conn.query("SHOW COLUMNS FROM branches LIKE 'block_id'");
    if (blockIdCol.length === 0) {
      await conn.query(`ALTER TABLE branches ADD COLUMN block_id INT DEFAULT NULL AFTER district_id`);
      console.log('✅ branches.block_id added');
    } else {
      console.log('⏩ branches.block_id already exists');
    }

    const [ftCol] = await conn.query("SHOW COLUMNS FROM branches LIKE 'facility_type'");
    if (ftCol.length === 0) {
      await conn.query(`
        ALTER TABLE branches ADD COLUMN facility_type
          ENUM('PHC','CHC','UPHC','SDH','DHH','Medical College','Cancer Hub','Hospital','Clinic','Lab','Other')
          DEFAULT 'Other' AFTER category
      `);
      console.log('✅ branches.facility_type added');
    } else {
      console.log('⏩ branches.facility_type already exists');
    }

    // ── 5. specialties ────────────────────────────────────────────────────────
    const [specTbl] = await conn.query("SHOW TABLES LIKE 'specialties'");
    if (specTbl.length === 0) {
      await conn.query(`
        CREATE TABLE specialties (
          id          INT AUTO_INCREMENT PRIMARY KEY,
          name        VARCHAR(150) NOT NULL,
          code        VARCHAR(20)  DEFAULT NULL,
          description TEXT,
          is_active   TINYINT(1)   DEFAULT 1,
          branch_id   INT          DEFAULT NULL,
          created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_specialty_code (code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await conn.query(`
        INSERT IGNORE INTO specialties (name, code) VALUES
          ('General Medicine','GM'), ('Surgery','SUR'), ('Gynaecology & Obstetrics','GYNOB'),
          ('Paediatrics','PED'), ('Orthopaedics','ORTH'), ('ENT','ENT'),
          ('Ophthalmology','OPTH'), ('Dermatology','DERM'), ('Psychiatry','PSY'),
          ('Radiology','RAD'), ('Anaesthesia','ANES'), ('Pathology','PATH'),
          ('Cardiology','CARD'), ('Neurology','NEURO'), ('Oncology','ONCO')
      `);
      console.log('✅ specialties table created + 15 defaults seeded');
    } else {
      console.log('⏩ specialties table already exists');
    }

    // ── 6. beds ───────────────────────────────────────────────────────────────
    const [bedsTbl] = await conn.query("SHOW TABLES LIKE 'beds'");
    if (bedsTbl.length === 0) {
      await conn.query(`
        CREATE TABLE beds (
          id         INT AUTO_INCREMENT PRIMARY KEY,
          bed_number VARCHAR(20)  NOT NULL,
          ward_id    INT          NOT NULL,
          branch_id  INT          NOT NULL,
          bed_type   ENUM('General','Semi-Private','Private','ICU','HDU','NICU','PICU','Day Care') DEFAULT 'General',
          status     ENUM('Available','Occupied','Under Maintenance','Reserved') DEFAULT 'Available',
          created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_bed_ward (bed_number, ward_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('✅ beds table created');
    } else {
      console.log('⏩ beds table already exists');
    }

    // ── 7. working_hours ──────────────────────────────────────────────────────
    const [whTbl] = await conn.query("SHOW TABLES LIKE 'working_hours'");
    if (whTbl.length === 0) {
      await conn.query(`
        CREATE TABLE working_hours (
          id            INT AUTO_INCREMENT PRIMARY KEY,
          branch_id     INT      NOT NULL,
          department_id INT      DEFAULT NULL,
          day_of_week   TINYINT  NOT NULL,
          open_time     TIME     NOT NULL DEFAULT '09:00:00',
          close_time    TIME     NOT NULL DEFAULT '17:00:00',
          is_closed     TINYINT(1) DEFAULT 0,
          created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_wh (branch_id, department_id, day_of_week)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('✅ working_hours table created');
    } else {
      console.log('⏩ working_hours table already exists');
    }

    // ── 8. holidays ───────────────────────────────────────────────────────────
    const [holTbl] = await conn.query("SHOW TABLES LIKE 'holidays'");
    if (holTbl.length === 0) {
      await conn.query(`
        CREATE TABLE holidays (
          id           INT AUTO_INCREMENT PRIMARY KEY,
          branch_id    INT          DEFAULT NULL,
          holiday_name VARCHAR(200) NOT NULL,
          holiday_date DATE         NOT NULL,
          holiday_type ENUM('National','State','Local','Hospital') DEFAULT 'Hospital',
          is_recurring TINYINT(1)   DEFAULT 0,
          created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('✅ holidays table created');
    } else {
      console.log('⏩ holidays table already exists');
    }

    console.log('\n✅ Module 1 migration complete.');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
