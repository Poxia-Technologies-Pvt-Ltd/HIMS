import db from '../config/db.js';

export const getTransfers = async (req, res) => {
  try {
    const [transfers] = await db.query(
      `SELECT t.*, 
        f.branch_name as from_branch_name, 
        to_b.branch_name as to_branch_name,
        u.first_name as created_by_name
       FROM inventory_stock_transfers t
       JOIN branches f ON t.from_branch_id = f.id
       JOIN branches to_b ON t.to_branch_id = to_b.id
       LEFT JOIN users u ON t.created_by = u.id
       ORDER BY t.created_at DESC`
    );

    const [items] = await db.query(
      `SELECT ti.*, i.item_name, i.item_code, i.unit, b.batch_number, b.expiry_date
       FROM inventory_stock_transfer_items ti
       JOIN inventory_item_master i ON ti.item_id = i.id
       JOIN inventory_batches b ON ti.batch_id = b.id`
    );

    // Attach items to transfers
    const enrichedTransfers = transfers.map(t => ({
      ...t,
      items: items.filter(i => i.transfer_id === t.id)
    }));

    res.json({ success: true, data: enrichedTransfers });
  } catch (error) {
    console.error('Error fetching transfers:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createTransfer = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { from_branch_id, to_branch_id, notes, items, created_by } = req.body;

    if (from_branch_id == to_branch_id) {
      throw new Error('Source and destination branches cannot be the same');
    }

    if (!items || items.length === 0) {
      throw new Error('No items provided for transfer');
    }

    // Generate Transfer Number
    const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
    const [countRes] = await connection.query(`SELECT COUNT(*) as cnt FROM inventory_stock_transfers WHERE DATE(created_at) = CURDATE()`);
    const count = (countRes[0].cnt + 1).toString().padStart(3, '0');
    const transferNumber = `TRF-${dateStr}-${count}`;

    // Validate quantities
    for (const item of items) {
      const [batchRes] = await connection.query(`SELECT quantity_available, expiry_date FROM inventory_batches WHERE id = ? AND branch_id = ?`, [item.batch_id, from_branch_id]);
      if (batchRes.length === 0) {
        throw new Error(`Batch not found in source branch for item ${item.item_id}`);
      }
      if (batchRes[0].quantity_available < item.quantity) {
        throw new Error(`Insufficient quantity in source batch for item ${item.item_id}. Requested: ${item.quantity}, Available: ${batchRes[0].quantity_available}`);
      }
      if (new Date(batchRes[0].expiry_date) < new Date()) {
        throw new Error(`Cannot transfer expired stock for item ${item.item_id}`);
      }
    }

    // Insert Transfer
    const [transferRes] = await connection.query(
      `INSERT INTO inventory_stock_transfers (transfer_number, from_branch_id, to_branch_id, notes, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [transferNumber, from_branch_id, to_branch_id, notes || '', created_by || 1]
    );

    const transferId = transferRes.insertId;

    // Insert Items
    for (const item of items) {
      await connection.query(
        `INSERT INTO inventory_stock_transfer_items (transfer_id, item_id, batch_id, quantity)
         VALUES (?, ?, ?, ?)`,
        [transferId, item.item_id, item.batch_id, item.quantity]
      );
    }

    await connection.commit();
    res.status(201).json({ success: true, message: 'Transfer request created successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating transfer:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};

export const updateTransferStatus = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const { status, user_id } = req.body; // user_id is the person performing the action

    const [transferRes] = await connection.query(`SELECT * FROM inventory_stock_transfers WHERE id = ?`, [id]);
    if (transferRes.length === 0) throw new Error('Transfer not found');
    const transfer = transferRes[0];

    // Status State Machine Logic
    if (status === 'IN_TRANSIT' && transfer.status === 'APPROVED') {
      // Deduct stock from source branch
      const [items] = await connection.query(`SELECT * FROM inventory_stock_transfer_items WHERE transfer_id = ?`, [id]);
      for (const item of items) {
        // Double check qty
        const [batchRes] = await connection.query(`SELECT quantity_available FROM inventory_batches WHERE id = ? FOR UPDATE`, [item.batch_id]);
        if (batchRes[0].quantity_available < item.quantity) {
          throw new Error(`Insufficient quantity for item ${item.item_id} during dispatch`);
        }

        // Deduct
        await connection.query(`UPDATE inventory_batches SET quantity_available = quantity_available - ? WHERE id = ?`, [item.quantity, item.batch_id]);
        
        // Log Transaction (TRANSFER_OUT)
        await connection.query(
          `INSERT INTO inventory_transactions (item_id, batch_id, type, quantity, reference_type, reference_id, remarks, branch_id, created_by)
           VALUES (?, ?, 'OUT', ?, 'Transfer', ?, 'Dispatched transfer to other branch', ?, ?)`,
          [item.item_id, item.batch_id, item.quantity, transfer.transfer_number, transfer.from_branch_id, user_id || 1]
        );
      }
    } 
    else if (status === 'COMPLETED' && transfer.status === 'IN_TRANSIT') {
      // Add stock to destination branch
      const [items] = await connection.query(`SELECT * FROM inventory_stock_transfer_items WHERE transfer_id = ?`, [id]);
      for (const item of items) {
        // Get source batch details
        const [srcBatchRes] = await connection.query(`SELECT * FROM inventory_batches WHERE id = ?`, [item.batch_id]);
        const srcBatch = srcBatchRes[0];

        // Check if destination branch already has this batch
        const [destBatchRes] = await connection.query(
          `SELECT id FROM inventory_batches WHERE item_id = ? AND batch_number = ? AND branch_id = ?`,
          [item.item_id, srcBatch.batch_number, transfer.to_branch_id]
        );

        let destBatchId;
        if (destBatchRes.length > 0) {
          destBatchId = destBatchRes[0].id;
          await connection.query(`UPDATE inventory_batches SET quantity_available = quantity_available + ? WHERE id = ?`, [item.quantity, destBatchId]);
        } else {
          // Create new batch for destination branch
          const [newBatch] = await connection.query(
            `INSERT INTO inventory_batches (item_id, vendor_id, batch_number, expiry_date, quantity_available, quantity_received, status, branch_id)
             VALUES (?, ?, ?, ?, ?, ?, 'Active', ?)`,
            [srcBatch.item_id, srcBatch.vendor_id, srcBatch.batch_number, srcBatch.expiry_date, item.quantity, item.quantity, transfer.to_branch_id]
          );
          destBatchId = newBatch.insertId;
        }

        // Log Transaction (TRANSFER_IN)
        await connection.query(
          `INSERT INTO inventory_transactions (item_id, batch_id, type, quantity, reference_type, reference_id, remarks, branch_id, created_by)
           VALUES (?, ?, 'IN', ?, 'Transfer', ?, 'Received transfer from other branch', ?, ?)`,
          [item.item_id, destBatchId, item.quantity, transfer.transfer_number, transfer.to_branch_id, user_id || 1]
        );
      }
    }
    else if (status === 'CANCELLED' && (transfer.status === 'PENDING' || transfer.status === 'APPROVED')) {
      // Allowed.
    } 
    else if (status === 'APPROVED' && transfer.status === 'PENDING') {
      // Allowed.
      await connection.query(`UPDATE inventory_stock_transfers SET approved_by = ? WHERE id = ?`, [user_id || 1, id]);
    }
    else {
      throw new Error(`Invalid state transition from ${transfer.status} to ${status}`);
    }

    // Update status
    await connection.query(`UPDATE inventory_stock_transfers SET status = ? WHERE id = ?`, [status, id]);

    await connection.commit();
    res.json({ success: true, message: `Transfer status updated to ${status}` });
  } catch (error) {
    await connection.rollback();
    console.error('Error updating transfer status:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};
