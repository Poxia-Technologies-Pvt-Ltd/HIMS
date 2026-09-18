import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'meril-hims',
  port: process.env.DB_PORT || 8889,
});

async function updateDB() {
  try {
    console.log("Checking for machine_parameter_code column...");
    const [columns] = await pool.query("SHOW COLUMNS FROM lab_test_parameters LIKE 'machine_parameter_code'");
    
    if (columns.length === 0) {
      console.log("Adding machine_parameter_code column to lab_test_parameters...");
      await pool.query("ALTER TABLE lab_test_parameters ADD COLUMN machine_parameter_code VARCHAR(100) DEFAULT NULL");
      console.log("Column added successfully!");
    } else {
      console.log("machine_parameter_code column already exists.");
    }

    console.log("Checking for analyzer_name column in lab_tests...");
    const [ltColumns] = await pool.query("SHOW COLUMNS FROM lab_tests LIKE 'analyzer_name'");
    if (ltColumns.length === 0) {
      console.log("Adding analyzer_name column to lab_tests...");
      await pool.query("ALTER TABLE lab_tests ADD COLUMN analyzer_name VARCHAR(100) DEFAULT NULL");
      console.log("Column added successfully!");
    } else {
      console.log("analyzer_name column already exists.");
    }
    
    process.exit(0);
  } catch (err) {
    console.error("Database update failed:", err.message);
    process.exit(1);
  }
}

updateDB();
