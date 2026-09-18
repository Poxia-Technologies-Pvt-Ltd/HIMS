
import db from '../config/db.js';

async function check() {
  try {
    const [rows] = await db.query('SELECT logo_url FROM hospital_settings LIMIT 1');
    if (rows.length > 0) {
      const logo = rows[0].logo_url;
      console.log('Logo URL length:', logo?.length);
      console.log('Starts with:', logo?.substring(0, 50));
    } else {
      console.log('No settings found');
    }
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
