import db from '../config/db.js';

async function checkSchema() {
  try {
    const [rows] = await db.execute('DESCRIBE inventory_purchase_orders');
    console.log('Columns in inventory_purchase_orders:');
    console.table(rows.map(r => ({ Field: r.Field, Type: r.Type })));
  } catch (error) {
    console.error('Error fetching schema:', error);
  } finally {
    process.exit(0);
  }
}

checkSchema();
