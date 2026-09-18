import db from '../config/db.js';

async function migrate() {
  try {
    console.log('Adding remarks to inventory_purchase_orders...');
    await db.execute(`
      ALTER TABLE inventory_purchase_orders 
      ADD COLUMN remarks TEXT NULL
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
