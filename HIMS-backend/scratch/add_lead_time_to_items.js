import db from '../config/db.js';

async function migrate() {
  try {
    console.log('Adding delivery_lead_time_days to inventory_item_master...');
    await db.execute(`
      ALTER TABLE inventory_item_master 
      ADD COLUMN delivery_lead_time_days INT DEFAULT 3
    `);
    console.log('Column added successfully!');
  } catch (error) {
    if (error.code === 'ER_DUP_COLUMN') {
      console.log('Column already exists.');
    } else {
      console.error('Migration failed:', error);
    }
  } finally {
    process.exit(0);
  }
}

migrate();
