import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  try {
    const sqlPath = path.join(__dirname, '../db.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Simple split by ';' - this assumes no complex semicolons in strings/comments, 
    // which is fine for our schema definitions
    const queries = sql.split(';').map(q => q.trim()).filter(q => q.length > 0);
    
    for (const query of queries) {
      if (query.startsWith('--')) continue; // skip pure comments
      try {
        await db.query(query);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME') {
          // ignore duplicate column errors from ALTER TABLE
        } else {
          console.error("Query Failed: ", query.substring(0, 50) + "...");
          console.error(err.message);
        }
      }
    }
    console.log("Migration finished successfully.");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
