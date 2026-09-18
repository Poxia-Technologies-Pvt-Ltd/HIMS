import db from '../config/db.js';

async function migrate() {
  try {
    console.log('Adding default_vendor_id to inventory_item_master...');
    await db.execute(`
      ALTER TABLE inventory_item_master 
      ADD COLUMN default_vendor_id INT NULL
    `);
    
    console.log('Adding foreign key constraint...');
    await db.execute(`
      ALTER TABLE inventory_item_master
      ADD CONSTRAINT fk_item_vendor FOREIGN KEY (default_vendor_id) REFERENCES vendors(id) ON DELETE SET NULL
    `);
    
    console.log('Column and constraint added successfully!');
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
