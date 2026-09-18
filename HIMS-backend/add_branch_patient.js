import db from './config/db.js';

async function alterTable() {
  try {
    await db.query(`ALTER TABLE patients ADD COLUMN branch_id INT DEFAULT NULL;`);
    console.log('Added branch_id to patients table.');
    
    // Optional: add foreign key
    // await db.query(`ALTER TABLE patients ADD CONSTRAINT fk_patient_branch FOREIGN KEY (branch_id) REFERENCES branches(id);`);
    
    process.exit(0);
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('branch_id already exists in patients table.');
      process.exit(0);
    }
    console.error('Error altering table:', err);
    process.exit(1);
  }
}

alterTable();
