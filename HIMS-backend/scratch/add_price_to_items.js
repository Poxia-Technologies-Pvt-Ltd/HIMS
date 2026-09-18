import db from '../config/db.js';

async function migrate() {
  try {
    console.log('Adding unit_price to inventory_item_master...');
    await db.execute(`
      ALTER TABLE inventory_item_master 
      ADD COLUMN unit_price DECIMAL(12,2) DEFAULT 0.00
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
