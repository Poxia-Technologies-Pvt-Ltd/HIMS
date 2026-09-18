import db from '../config/db.js';
import { checkAndTriggerAutoReorder } from '../services/inventoryReorderService.js';

export const getTransactions = async (req, res) => {
  try {
    const { item_id, batch_id, type, start_date, end_date, branch_id } = req.query;
    let sql = `
      SELECT t.*, 
             i.item_code, i.item_name, i.unit,
             b.batch_no, b.expiry_date,
             inf.branch_name as branch_name,
             u.first_name, u.last_name,
             lt.test_name
      FROM inventory_transactions t
      JOIN inventory_item_master i ON t.item_id = i.id
      JOIN inventory_batches b ON t.batch_id = b.id
      LEFT JOIN branches inf ON t.branch_id = inf.id
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN lab_tests lt ON t.test_id = lt.id
      WHERE 1=1
    `;
    const params = [];

    if (item_id) {
      sql += ' AND t.item_id = ?';
      params.push(item_id);
    }
    if (batch_id) {
      sql += ' AND t.batch_id = ?';
      params.push(batch_id);
    }
    if (type) {
      sql += ' AND t.type = ?';
      params.push(type);
    }
    if (branch_id) {
      sql += ' AND t.branch_id = ?';
      params.push(branch_id);
    }
    if (start_date && end_date) {
      sql += ' AND DATE(t.created_at) BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    sql += ' ORDER BY t.created_at DESC';

    const [transactions] = await db.execute(sql, params);
    res.json({ success: true, data: transactions });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createTransaction = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const {
      item_id, batch_id, type, quantity, reference_type, reference_id, remarks, created_by, branch_id
    } = req.body;

    // 1. Insert Transaction
    const [result] = await connection.execute(
      `INSERT INTO inventory_transactions (
        item_id, batch_id, type, quantity, reference_type, reference_id, remarks, created_by, branch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item_id, batch_id, type, quantity, reference_type || 'Manual', reference_id || null, remarks || '', created_by || null, branch_id || null]
    );

    // 2. Update Batch Quantity
    // If OUT, we subtract. If IN, we add. If ADJUSTMENT, we assume the quantity provided is the delta (+ or -).
    let qtyDelta = parseInt(quantity, 10);
    if (type === 'OUT') {
      qtyDelta = -Math.abs(qtyDelta); // Ensure it's negative
    } else if (type === 'IN') {
      qtyDelta = Math.abs(qtyDelta); // Ensure it's positive
    }
    // For ADJUSTMENT, qtyDelta is used as-is (+ to add, - to subtract)

    await connection.execute(
      `UPDATE inventory_batches SET quantity_available = quantity_available + ? WHERE id = ?`,
      [qtyDelta, batch_id]
    );

    // 3. Optional: Check if batch is depleted and update status
    await connection.execute(
      `UPDATE inventory_batches SET status = 'Empty' WHERE id = ? AND quantity_available <= 0 AND status != 'Expired'`,
      [batch_id]
    );

    await connection.commit();

    // 4. Trigger Auto-Reorder Check (Fire and forget or wait, here we wait for consistency)
    // We pass the main pool or a new connection if needed, but since the transaction is committed, 
    // we can use the main db or the released connection's parent. 
    // Let's use the db object to be safe as the connection is about to be released.
    await checkAndTriggerAutoReorder(db, item_id);

    res.status(201).json({ 
      success: true, 
      message: 'Transaction logged and stock updated successfully', 
      data: { id: result.insertId } 
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating transaction:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};
