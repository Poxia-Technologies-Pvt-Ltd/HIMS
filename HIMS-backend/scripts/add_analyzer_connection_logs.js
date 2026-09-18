import db from '../config/db.js';

const sql = `
  CREATE TABLE IF NOT EXISTS analyzer_connection_logs (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    machine_id  VARCHAR(100)  NOT NULL,
    machine_name VARCHAR(200),
    model       VARCHAR(200),
    lab_id      INT           DEFAULT NULL,
    port        VARCHAR(100),
    event       ENUM('ONLINE','OFFLINE') NOT NULL,
    ip_address  VARCHAR(45)   DEFAULT NULL,
    created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_machine_id  (machine_id),
    INDEX idx_lab_id      (lab_id),
    INDEX idx_created_at  (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

(async () => {
  try {
    await db.query(sql);
    console.log('✅ analyzer_connection_logs table created (or already exists).');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    process.exit(0);
  }
})();
