import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function migrate() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'meril-hims',
    port: process.env.DB_PORT || 8889
  });

  try {
    console.log("Checking for short_id column...");
    const [columns] = await db.query("SHOW COLUMNS FROM bill_items LIKE 'short_id'");
    
    if (columns.length === 0) {
      console.log("Adding short_id column to bill_items...");
      await db.query("ALTER TABLE bill_items ADD COLUMN short_id varchar(10) DEFAULT NULL AFTER sample_id");
      console.log("✅ Column added successfully!");
    } else {
      console.log("✅ short_id column already exists.");
    }
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  } finally {
    await db.end();
  }
}

migrate();
