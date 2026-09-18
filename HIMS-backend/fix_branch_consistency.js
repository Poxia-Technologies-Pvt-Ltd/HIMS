import db from './config/db.js';

async function migrate() {
  try {
    console.log('Starting migration to unify branch references...');

    const tasks = [
      { table: 'inventory_purchase_requisitions', fk: 'inventory_purchase_requisitions_ibfk_1', col: 'branch_id' },
      { table: 'inventory_stock', fk: 'inventory_stock_ibfk_2', col: 'department_id' },
      { table: 'inventory_stock_transfers', fk: 'inventory_stock_transfers_ibfk_1', col: 'from_branch_id' },
      { table: 'inventory_stock_transfers', fk: 'inventory_stock_transfers_ibfk_2', col: 'to_branch_id' },
      { table: 'purchase_orders', fk: 'purchase_orders_ibfk_3', col: 'delivery_location' },
      { table: 'purchase_requisitions', fk: 'purchase_requisitions_ibfk_2', col: 'department_id' },
      { table: 'stock_transfers', fk: 'stock_transfers_ibfk_1', col: 'from_department' },
      { table: 'stock_transfers', fk: 'stock_transfers_ibfk_2', col: 'to_department' }
    ];

    for (const task of tasks) {
      try {
        console.log(`Processing ${task.table}.${task.col}...`);
        // Drop old FK
        try {
          await db.query(`ALTER TABLE ${task.table} DROP FOREIGN KEY ${task.fk}`);
          console.log(`  Dropped ${task.fk}`);
        } catch (e) {
          console.log(`  ${task.fk} not found, skipping drop.`);
        }

        // Add new FK pointing to branches
        await db.query(`
          ALTER TABLE ${task.table} 
          ADD CONSTRAINT fk_${task.table}_${task.col}_branches 
          FOREIGN KEY (${task.col}) REFERENCES branches(id) 
          ON DELETE RESTRICT
        `);
        console.log(`  Linked to branches(id)`);
      } catch (err) {
        console.error(`  Error processing ${task.table}:`, err.message);
      }
    }

    console.log('Migration completed!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
