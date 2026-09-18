import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'meril-hims',
    port: process.env.DB_PORT || 8889
  });

  try {
    const [rows] = await db.query("SELECT * FROM lab_machines");
    console.log("LAB MACHINES IN DB:", JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await db.end();
  }
}

check();
