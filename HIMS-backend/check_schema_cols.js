import db from './config/db.js';

async function checkSchema() {
  try {
    const [batches] = await db.query('DESCRIBE inventory_batches');
    console.log('--- inventory_batches ---');
    console.table(batches.map(c => ({ Field: c.Field, Type: c.Type })));

    const [items] = await db.query('SHOW TABLES LIKE "inventory_item_master"');
    console.log('inventory_item_master exists:', items.length > 0);

    const [stock] = await db.query('SHOW TABLES LIKE "inventory_stock"');
    console.log('inventory_stock exists:', stock.length > 0);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkSchema();
