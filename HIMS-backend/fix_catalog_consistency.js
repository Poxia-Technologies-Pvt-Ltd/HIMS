import db from './config/db.js';

async function migrate() {
  try {
    console.log('Starting migration to unify item catalog...');
    
    // 1. Check if inventory_batches_ibfk_1 exists and drop it
    // We use a try-catch for the drop in case it's already gone or named differently
    try {
      await db.query('ALTER TABLE inventory_batches DROP FOREIGN KEY inventory_batches_ibfk_1');
      console.log('Dropped old foreign key inventory_batches_ibfk_1');
    } catch (e) {
      console.log('Foreign key inventory_batches_ibfk_1 not found or already dropped');
    }

    // 2. Add the new foreign key pointing to inventory_item_master
    await db.query(`
      ALTER TABLE inventory_batches 
      ADD CONSTRAINT fk_inventory_batches_item 
      FOREIGN KEY (item_id) REFERENCES inventory_item_master(id) 
      ON DELETE CASCADE
    `);
    console.log('Added new foreign key fk_inventory_batches_item pointing to inventory_item_master');

    console.log('Migration successful!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
