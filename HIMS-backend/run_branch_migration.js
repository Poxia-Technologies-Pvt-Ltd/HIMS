import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const runMigration = async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'meril-hims',
    port: process.env.DB_PORT || 8889,
    multipleStatements: true
  });

  const sql = `
    -- 1. Create Districts Table
    CREATE TABLE IF NOT EXISTS districts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      state VARCHAR(100) DEFAULT 'Jharkhand',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Create Branches Table
    CREATE TABLE IF NOT EXISTS branches (
      id INT AUTO_INCREMENT PRIMARY KEY,
      district_id INT NOT NULL,
      branch_name VARCHAR(255) NOT NULL,
      hospital_code VARCHAR(50) NOT NULL UNIQUE,
      address TEXT,
      contact_number VARCHAR(50),
      status ENUM('Active', 'Inactive') DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (district_id) REFERENCES districts(id)
    );

    -- 3. Insert Default Data (Ensures existing data maps to a default 'Ranchi' branch)
    INSERT IGNORE INTO districts (id, name, state) VALUES (1, 'Ranchi', 'Jharkhand');
    INSERT IGNORE INTO branches (id, district_id, branch_name, hospital_code, address) VALUES (1, 1, 'Ranchi Central Hospital', 'RCH', 'Ranchi Main Area');

    -- 4. Alter Core Tables (Safely add branch_id to existing tables)
    
    SET @dbname = DATABASE();

    -- Add to users
    SET @preparedStatement = (SELECT IF(
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'branch_id') > 0,
      "SELECT 1",
      "ALTER TABLE users ADD COLUMN branch_id INT DEFAULT 1, ADD COLUMN role_level ENUM('Central', 'Sub-Central', 'Branch') DEFAULT 'Branch', ADD CONSTRAINT fk_user_branch FOREIGN KEY (branch_id) REFERENCES branches(id);"
    ));
    PREPARE alterIfNotExists FROM @preparedStatement;
    EXECUTE alterIfNotExists;
    DEALLOCATE PREPARE alterIfNotExists;

    -- Add to patients
    SET @preparedStatement = (SELECT IF(
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'patients' AND COLUMN_NAME = 'branch_id') > 0,
      "SELECT 1",
      "ALTER TABLE patients ADD COLUMN branch_id INT DEFAULT 1, ADD CONSTRAINT fk_patient_branch FOREIGN KEY (branch_id) REFERENCES branches(id);"
    ));
    PREPARE alterIfNotExists FROM @preparedStatement;
    EXECUTE alterIfNotExists;
    DEALLOCATE PREPARE alterIfNotExists;

    -- Add to bills
    SET @preparedStatement = (SELECT IF(
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'bills' AND COLUMN_NAME = 'branch_id') > 0,
      "SELECT 1",
      "ALTER TABLE bills ADD COLUMN branch_id INT DEFAULT 1, ADD CONSTRAINT fk_bill_branch FOREIGN KEY (branch_id) REFERENCES branches(id);"
    ));
    PREPARE alterIfNotExists FROM @preparedStatement;
    EXECUTE alterIfNotExists;
    DEALLOCATE PREPARE alterIfNotExists;

    -- Add to lab_test_result
    SET @preparedStatement = (SELECT IF(
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'lab_test_result' AND COLUMN_NAME = 'branch_id') > 0,
      "SELECT 1",
      "ALTER TABLE lab_test_result ADD COLUMN branch_id INT DEFAULT 1, ADD CONSTRAINT fk_lab_result_branch FOREIGN KEY (branch_id) REFERENCES branches(id);"
    ));
    PREPARE alterIfNotExists FROM @preparedStatement;
    EXECUTE alterIfNotExists;
    DEALLOCATE PREPARE alterIfNotExists;

    -- Add to infrastructure
    SET @preparedStatement = (SELECT IF(
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'infrastructure' AND COLUMN_NAME = 'branch_id') > 0,
      "SELECT 1",
      "ALTER TABLE infrastructure ADD COLUMN branch_id INT DEFAULT 1, ADD CONSTRAINT fk_infra_branch FOREIGN KEY (branch_id) REFERENCES branches(id);"
    ));
    PREPARE alterIfNotExists FROM @preparedStatement;
    EXECUTE alterIfNotExists;
    DEALLOCATE PREPARE alterIfNotExists;
  `;

  try {
    console.log('Executing multi-branch migration...');
    await connection.query(sql);
    console.log('✅ Migration successful! Database is now strictly Multi-Branch enabled.');
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    await connection.end();
  }
};

runMigration();
