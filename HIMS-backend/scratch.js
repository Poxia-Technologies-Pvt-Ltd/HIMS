import db from './db/database.js';
async function run() {
  const connection = await db.getConnection();
  const [bills] = await connection.query("SELECT * FROM bills ORDER BY id DESC LIMIT 1");
  console.log("BILL:", bills[0]);
  const [items] = await connection.query("SELECT * FROM bill_items WHERE bill_id = ?", [bills[0].id]);
  console.log("ITEMS:", items);

  const [worklist] = await connection.query(`
      SELECT bi.id as bill_item_id, bi.service_id, lt.id as lt_id, lt.test_name
      FROM bill_items bi
      LEFT JOIN lab_tests lt ON bi.service_id = lt.id
      WHERE bi.bill_id = ?
  `, [bills[0].id]);
  console.log("WORKLIST JOIN:", worklist);
  process.exit(0);
}
run();
