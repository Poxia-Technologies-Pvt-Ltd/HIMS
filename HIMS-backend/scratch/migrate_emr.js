import db from '../config/db.js';

async function runEMRMigrations() {
  try {
    console.log('✅ Connected to database');

    const createConsultations = `
      CREATE TABLE IF NOT EXISTS consultations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        appointment_id INT NOT NULL,
        doctor_id INT,
        patient_reg_no VARCHAR(100),
        chief_complaints TEXT,
        diagnosis TEXT,
        notes TEXT,
        status ENUM('Pending', 'Completed') DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;

    const createVitals = `
      CREATE TABLE IF NOT EXISTS vitals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        consultation_id INT NOT NULL,
        height DECIMAL(5,2),
        weight DECIMAL(5,2),
        bp_systolic INT,
        bp_diastolic INT,
        pulse INT,
        temperature DECIMAL(5,2),
        spo2 INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;

    const createPrescriptions = `
      CREATE TABLE IF NOT EXISTS digital_prescriptions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        consultation_id INT NOT NULL,
        medicine_name VARCHAR(255) NOT NULL,
        dosage VARCHAR(100),
        frequency VARCHAR(100),
        duration VARCHAR(100),
        instructions TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;

    await db.query(createConsultations);
    console.log('🎉 consultations table ready');

    await db.query(createVitals);
    console.log('🎉 vitals table ready');

    await db.query(createPrescriptions);
    console.log('🎉 digital_prescriptions table ready');

    console.log('✅ All EMR migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    process.exit(1);
  }
}

runEMRMigrations();
