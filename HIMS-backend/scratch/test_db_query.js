import db from '../config/db.js';

async function testQuery() {
  try {
    const query = `
      SELECT 
        bi.id as bill_item_id,
        bi.sample_id,
        bi.service_name as test_name,
        bi.status as current_status,
        bi.created_at as billed_at,
        p.first_name as patient_first_name
      FROM bill_items bi
      JOIN bills b ON bi.bill_id = b.id
      JOIN patients p ON b.patient_id = p.id
      WHERE bi.service_type = 'Laboratory'
      LIMIT 1
    `;
    const [rows] = await db.query(query);
    console.log('Query successful:', rows);
  } catch (err) {
    console.error('Query failed:', err.message);
    
    // Check billing table
    try {
        const [cols] = await db.query('SHOW COLUMNS FROM billing');
        console.log('Billing columns:', cols.map(c => c.Field));
    } catch (e) {}

    // Check bills table
    try {
        const [cols] = await db.query('SHOW COLUMNS FROM bills');
        console.log('Bills columns:', cols.map(c => c.Field));
    } catch (e) {}
  }
  process.exit();
}

testQuery();
``