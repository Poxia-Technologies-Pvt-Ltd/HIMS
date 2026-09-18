import db from './config/db.js';

async function runMigrations() {
  try {
    console.log('✅ Connected to database');

    // Create duty_schedules table (if not exists)
    const dutyQuery = `
      CREATE TABLE IF NOT EXISTS duty_schedules (
        id INT(11) NOT NULL AUTO_INCREMENT,
        doctor_id INT(11) NOT NULL,
        room_id INT(11) NOT NULL,
        duty_date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        price DECIMAL(10,2) DEFAULT 0.00,
        notes TEXT,
        status VARCHAR(50) DEFAULT 'Scheduled',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (room_id) REFERENCES infrastructure(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;

    await db.query(dutyQuery);
    console.log('🎉 duty_schedules table ready');

    // Create lab_machines table
    const labMachinesQuery = `
      CREATE TABLE IF NOT EXISTS lab_machines (
        id INT(11) NOT NULL AUTO_INCREMENT,
        lab_id INT(11) NOT NULL,
        machine_id VARCHAR(50) NOT NULL,
        name VARCHAR(100) NOT NULL,
        model VARCHAR(100),
        manufacturer VARCHAR(100),
        status ENUM('Active', 'Inactive', 'Maintenance') DEFAULT 'Active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        FOREIGN KEY (lab_id) REFERENCES infrastructure(id) ON DELETE CASCADE,
        UNIQUE KEY unique_machine_id (lab_id, machine_id),
        INDEX lab_id (lab_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    
    await db.query(labMachinesQuery);
    console.log('🎉 lab_machines table ready');

    console.log('✅ All migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

runMigrations();