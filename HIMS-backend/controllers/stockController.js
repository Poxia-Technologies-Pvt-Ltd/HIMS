import db from '../config/db.js';

// Generate unique transfer number
const generateTransferNumber = async () => {
  const [rows] = await db.execute(
    "SELECT MAX(CAST(SUBSTRING(transfer_number, 4) AS UNSIGNED)) as max_num FROM stock_transfers WHERE transfer_number LIKE 'ST-%'"
  );
  const maxNum = rows[0].max_num || 0;
  return `ST-${String(maxNum + 1).padStart(5, '0')}`;
};

// ============================================
// STOCK SUMMARY & LEVELS
// ============================================

export const getStockLevels = async (req, res) => {
  try {
    const { item_id, department_id, low_stock, branch_id, role_level } = req.query;
    
    // Use batches as the source of truth for branch-specific stock
    let sql = `
      SELECT i.id, i.item_name, i.item_code, i.category, i.unit, i.min_stock_level, i.reorder_level,
        COALESCE(SUM(b.quantity_available), 0) as available_stock,
        COALESCE(SUM(b.quantity_available), 0) as current_stock,
        br.branch_name
      FROM inventory_item_master i
      LEFT JOIN inventory_batches b ON i.id = b.item_id AND b.status = 'Active'
      LEFT JOIN branches br ON b.branch_id = br.id
      WHERE i.status = 'Active'
    `;
    const params = [];

    if (item_id) {
      sql += ' AND i.id = ?';
      params.push(item_id);
    }
    if (department_id) {
      sql += ' AND s.department_id = ?';
      params.push(department_id);
    }
    
    // Branch role isolation
    if (role_level === 'Branch' && branch_id) {
      sql += ' AND b.branch_id = ?';
      params.push(branch_id);
    }
    
    sql += ' GROUP BY i.id ORDER BY i.category, i.item_name';

    const [stock] = await db.execute(sql, params);
    
    // Filter low stock in memory if requested
    let result = stock;
    if (low_stock === 'true') {
      result = stock.filter(s => s.available_stock <= s.reorder_level);
    }
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching stock levels:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getBatchStock = async (req, res) => {
  try {
    const { item_id, status, expiring_soon, branch_id, role_level } = req.query;
    let sql = `
      SELECT b.*, i.item_name, i.item_code, i.unit, v.vendor_name,
        DATEDIFF(b.expiry_date, CURDATE()) as days_until_expiry,
        br.branch_name
      FROM inventory_batches b
      JOIN inventory_item_master i ON b.item_id = i.id
      LEFT JOIN vendors v ON b.vendor_id = v.id
      LEFT JOIN branches br ON b.branch_id = br.id
      WHERE b.status = 'Active'
    `;
    const params = [];

    if (item_id) {
      sql += ' AND b.item_id = ?';
      params.push(item_id);
    }
    if (status) {
      sql += ' AND b.status = ?';
      params.push(status);
    }
    if (expiring_soon === 'true') {
      sql += ' AND b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND b.quantity_available > 0';
    }
    
    // Branch role isolation
    if (role_level === 'Branch' && branch_id) {
      sql += ' AND b.branch_id = ?';
      params.push(branch_id);
    }

    sql += ' ORDER BY b.expiry_date ASC';

    const [batches] = await db.execute(sql, params);
    res.json({ success: true, data: batches });
  } catch (error) {
    console.error('Error fetching batch stock:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// STOCK TRANSACTIONS
// ============================================

export const getStockTransactions = async (req, res) => {
  try {
    const { item_id, type, start_date, end_date, limit = 100, branch_id, role_level } = req.query;
    let sql = `
      SELECT t.*, i.item_name, i.item_code,
        b.batch_number, b.lot_number,
        u.first_name as performed_by_name,
        br.branch_name
      FROM inventory_transactions t
      JOIN inventory_item_master i ON t.item_id = i.id
      LEFT JOIN inventory_batches b ON t.batch_id = b.id
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN branches br ON t.branch_id = br.id
      WHERE 1=1
    `;
    const params = [];

    if (item_id) {
      sql += ' AND t.item_id = ?';
      params.push(item_id);
    }
    if (type) {
      sql += ' AND t.type = ?';
      params.push(type);
    }
    if (start_date && end_date) {
      sql += ' AND DATE(t.created_at) BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }
    
    // Branch role isolation
    if (role_level === 'Branch' && branch_id) {
      sql += ' AND t.branch_id = ?';
      params.push(branch_id);
    }

    sql += ' ORDER BY t.created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const [transactions] = await db.query(sql, params);
    res.json({ success: true, data: transactions });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// STOCK ADJUSTMENT
// ============================================

export const adjustStock = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    
    const { item_id, batch_id, adjustment_qty, reason, performed_by } = req.body;
    
    if (adjustment_qty === 0) {
      return res.status(400).json({ success: false, message: 'Adjustment quantity cannot be zero' });
    }

    // Get current stock
    const [stock] = await connection.execute(
      'SELECT * FROM inventory_stock WHERE item_id = ? AND department_id IS NULL',
      [item_id]
    );

    if (stock.length === 0 && adjustment_qty < 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Cannot reduce stock below zero' });
    }

    // Create transaction record
    await connection.execute(
      `INSERT INTO inventory_transactions (
        type, item_id, batch_id, quantity,
        reference_type, created_by, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['ADJUSTMENT', item_id, batch_id || null, adjustment_qty, 'Manual Adjustment', performed_by, reason]
    );

    // Update stock summary
    await connection.execute(
      `INSERT INTO inventory_stock (item_id, current_stock, available_stock, department_id)
       VALUES (?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
       current_stock = current_stock + ?,
       available_stock = available_stock + ?`,
      [item_id, adjustment_qty, adjustment_qty, adjustment_qty, adjustment_qty]
    );

    // Update batch if specified
    if (batch_id) {
      await connection.execute(
        'UPDATE inventory_batches SET quantity_available = quantity_available + ? WHERE id = ?',
        [adjustment_qty, batch_id]
      );
    }

    await connection.commit();
    res.json({ success: true, message: 'Stock adjusted successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Error adjusting stock:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};

// ============================================
// STOCK TRANSFERS
// ============================================

export const getStockTransfers = async (req, res) => {
  try {
    const { status, from_department, to_department } = req.query;
    let sql = `
      SELECT st.*, 
        fd.name as from_department_name,
        td.name as to_department_name,
        u1.first_name as requested_by_name,
        u2.first_name as approved_by_name,
        u3.first_name as received_by_name,
        (SELECT COUNT(*) FROM stock_transfer_items WHERE transfer_id = st.id) as item_count
      FROM stock_transfers st
      LEFT JOIN infrastructure fd ON st.from_department = fd.id
      LEFT JOIN infrastructure td ON st.to_department = td.id
      LEFT JOIN users u1 ON st.requested_by = u1.id
      LEFT JOIN users u2 ON st.approved_by = u2.id
      LEFT JOIN users u3 ON st.received_by = u3.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ' AND st.status = ?';
      params.push(status);
    }
    if (from_department) {
      sql += ' AND st.from_department = ?';
      params.push(from_department);
    }
    if (to_department) {
      sql += ' AND st.to_department = ?';
      params.push(to_department);
    }

    sql += ' ORDER BY st.created_at DESC';

    const [transfers] = await db.execute(sql, params);
    res.json({ success: true, data: transfers });
  } catch (error) {
    console.error('Error fetching transfers:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getStockTransferById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const [transfers] = await db.execute(`
      SELECT st.*, 
        fd.name as from_department_name,
        td.name as to_department_name,
        u1.first_name as requested_by_name,
        u2.first_name as approved_by_name,
        u3.first_name as received_by_name
      FROM stock_transfers st
      LEFT JOIN infrastructure fd ON st.from_department = fd.id
      LEFT JOIN infrastructure td ON st.to_department = td.id
      LEFT JOIN users u1 ON st.requested_by = u1.id
      LEFT JOIN users u2 ON st.approved_by = u2.id
      LEFT JOIN users u3 ON st.received_by = u3.id
      WHERE st.id = ?
    `, [id]);

    if (transfers.length === 0) {
      return res.status(404).json({ success: false, message: 'Transfer not found' });
    }

    // Get items
    const [items] = await db.execute(`
      SELECT sti.*, i.item_name, i.item_code, i.unit, 
        b.batch_number, b.lot_number, b.expiry_date
      FROM stock_transfer_items sti
      JOIN inventory_item_master i ON sti.item_id = i.id
      LEFT JOIN inventory_batches b ON sti.batch_id = b.id
      WHERE sti.transfer_id = ?
    `, [id]);

    res.json({ success: true, data: { ...transfers[0], items } });
  } catch (error) {
    console.error('Error fetching transfer:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createStockTransfer = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    
    const transferNumber = await generateTransferNumber();
    const { from_department, to_department, transfer_date, notes, items, requested_by } = req.body;

    // Check stock availability
    for (const item of items) {
      const [stock] = await connection.execute(
        `SELECT available_stock FROM inventory_stock 
         WHERE item_id = ? AND (department_id = ? OR department_id IS NULL)
         ORDER BY department_id DESC LIMIT 1`,
        [item.item_id, from_department]
      );

      const availableStock = stock.length > 0 ? stock[0].available_stock : 0;
      if (availableStock < item.quantity) {
        await connection.rollback();
        return res.status(400).json({ 
          success: false, 
          message: `Insufficient stock for item ${item.item_id}. Available: ${availableStock}` 
        });
      }
    }

    const [result] = await connection.execute(
      `INSERT INTO stock_transfers (
        transfer_number, from_department, to_department, transfer_date,
        status, requested_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [transferNumber, from_department, to_department, transfer_date, 
       'Pending', requested_by, notes]
    );

    const transferId = result.insertId;

    // Insert items
    for (const item of items) {
      await connection.execute(
        `INSERT INTO stock_transfer_items (
          transfer_id, item_id, batch_id, quantity, notes
        ) VALUES (?, ?, ?, ?, ?)`,
        [transferId, item.item_id, item.batch_id || null, item.quantity, item.notes]
      );
    }

    await connection.commit();
    res.status(201).json({ 
      success: true, 
      message: 'Transfer created successfully', 
      data: { id: transferId, transfer_number: transferNumber } 
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating transfer:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};

export const approveStockTransfer = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    
    const { id } = req.params;
    const { status, approved_by } = req.body;

    const [transfer] = await connection.execute(
      'SELECT * FROM stock_transfers WHERE id = ?',
      [id]
    );

    if (transfer.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Transfer not found' });
    }

    await connection.execute(
      'UPDATE stock_transfers SET status = ?, approved_by = ? WHERE id = ?',
      [status, approved_by, id]
    );

    if (status === 'In Transit') {
      const [items] = await connection.execute(
        'SELECT * FROM stock_transfer_items WHERE transfer_id = ?',
        [id]
      );

      for (const item of items) {
        // Deduct from source
        await connection.execute(
          `UPDATE inventory_stock 
           SET current_stock = current_stock - ?, available_stock = available_stock - ?
           WHERE item_id = ? AND (department_id = ? OR department_id IS NULL)`,
          [item.quantity, item.quantity, item.item_id, transfer[0].from_department]
        );

        // Reserve at destination
        await connection.execute(
          `INSERT INTO inventory_stock (item_id, current_stock, available_stock, reserved_stock, department_id)
           VALUES (?, 0, 0, ?, ?)
           ON DUPLICATE KEY UPDATE reserved_stock = reserved_stock + ?`,
          [item.item_id, item.quantity, transfer[0].to_department, item.quantity]
        );

        // Create transaction record
        await connection.execute(
          `INSERT INTO inventory_transactions (
            type, item_id, batch_id, quantity,
            reference_type, reference_id, branch_id, created_by, remarks
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ['OUT', item.item_id, item.batch_id, -item.quantity,
           'Transfer', id, transfer[0].from_department, approved_by, 
           `Transfer ${transfer[0].transfer_number} to Branch ${transfer[0].to_department}`]
        );
      }
    }

    await connection.commit();
    res.json({ success: true, message: `Transfer ${status.toLowerCase()} successfully` });
  } catch (error) {
    await connection.rollback();
    console.error('Error approving transfer:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};

export const receiveStockTransfer = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    
    const { id } = req.params;
    const { received_by, items } = req.body;

    const [transfer] = await connection.execute(
      'SELECT * FROM stock_transfers WHERE id = ?',
      [id]
    );

    if (transfer.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Transfer not found' });
    }

    // Update received quantities
    for (const item of items) {
      await connection.execute(
        `UPDATE stock_transfer_items 
         SET received_quantity = ?, damaged_quantity = ?
         WHERE transfer_id = ? AND item_id = ?`,
        [item.received_quantity, item.damaged_quantity || 0, id, item.item_id]
      );

      // Move from reserved to available
      const goodQty = item.received_quantity - (item.damaged_quantity || 0);
      
      await connection.execute(
        `UPDATE inventory_stock 
         SET reserved_stock = reserved_stock - ?, current_stock = current_stock + ?, available_stock = available_stock + ?
         WHERE item_id = ? AND department_id = ?`,
        [item.quantity, goodQty, goodQty, item.item_id, transfer[0].to_department]
      );

      // Add damaged to damaged_stock
      if (item.damaged_quantity > 0) {
        await connection.execute(
          `UPDATE inventory_stock SET damaged_stock = damaged_stock + ? WHERE item_id = ? AND department_id = ?`,
          [item.damaged_quantity, item.item_id, transfer[0].to_department]
        );
      }

      // Create transaction record
      await connection.execute(
        `INSERT INTO inventory_transactions (
          type, item_id, quantity,
          reference_type, reference_id, branch_id, created_by, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['IN', item.item_id, goodQty,
         'Transfer', id, transfer[0].to_department, received_by, 
         `Received from transfer ${transfer[0].transfer_number}`]
      );
    }

    await connection.execute(
      'UPDATE stock_transfers SET status = ?, received_by = ? WHERE id = ?',
      ['Received', received_by, id]
    );

    await connection.commit();
    res.json({ success: true, message: 'Transfer received successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Error receiving transfer:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};

// ============================================
// AUTO CONSUMPTION (Linked to Tests)
// ============================================

export const consumeReagentsForTest = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    
    const { test_result_id, bill_item_id, sample_id, test_id, performed_by } = req.body;

    // Get reagent mappings for this test
    const [mappings] = await connection.execute(
      `SELECT m.*, i.item_name, i.unit as storage_unit
      FROM inventory_test_mapping m
      JOIN inventory_item_master i ON m.item_id = i.id
      WHERE m.test_id = ?`,
      [test_id]
    );

    if (mappings.length === 0) {
      await connection.rollback();
      return res.json({ success: true, message: 'No reagents configured for this test', consumed: [] });
    }

    const consumedItems = [];

    for (const mapping of mappings) {
      // Find available batch using FEFO (First Expiry First Out)
      const [batches] = await connection.execute(
        `SELECT * FROM inventory_batches 
         WHERE item_id = ? AND status = 'Active' AND quantity_available >= ?
         ORDER BY expiry_date ASC, created_at ASC
         LIMIT 1`,
        [mapping.item_id, mapping.quantity_required]
      );

      if (batches.length === 0) {
        await connection.rollback();
        return res.status(400).json({ 
          success: false, 
          message: `Insufficient stock for ${mapping.item_name}` 
        });
      }

      const batch = batches[0];

      // Deduct from batch
      await connection.execute(
        'UPDATE inventory_batches SET quantity_available = quantity_available - ? WHERE id = ?',
        [mapping.quantity_required, batch.id]
      );

      // Update stock summary
      await connection.execute(
        `UPDATE inventory_stock 
         SET current_stock = current_stock - ?, consumed_stock = consumed_stock + ?
         WHERE item_id = ?`,
        [mapping.quantity_required, mapping.quantity_required, mapping.item_id]
      );

      // Create consumption log
      const [logResult] = await connection.execute(
        `INSERT INTO inventory_consumption_logs (
          test_result_id, bill_item_id, sample_id, item_id, batch_id,
          quantity_consumed, consumed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [test_result_id, bill_item_id, sample_id, mapping.item_id, batch.id,
         mapping.quantity_required, performed_by]
      );

      // Create transaction record
      await connection.execute(
        `INSERT INTO inventory_transactions (
          type, item_id, batch_id, quantity,
          reference_type, reference_id, created_by, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['OUT', mapping.item_id, batch.id, mapping.quantity_required,
         'Test', test_result_id, performed_by, 
         `Consumed for test result ${test_result_id}, sample ${sample_id}`]
      );

      consumedItems.push({
        item_id: mapping.item_id,
        item_name: mapping.item_name,
        batch_id: batch.id,
        batch_number: batch.batch_number,
        quantity_consumed: mapping.quantity_per_test,
        unit: mapping.unit,
        consumption_log_id: logResult.insertId
      });
    }

    await connection.commit();
    res.json({ 
      success: true, 
      message: 'Reagents consumed successfully', 
      data: { consumed_items: consumedItems } 
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error consuming reagents:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};

export const getConsumptionLogs = async (req, res) => {
  try {
    const { test_result_id, sample_id, item_id, start_date, end_date } = req.query;
    let sql = `
      SELECT c.*, i.item_name, i.item_code, i.unit,
        b.batch_number, b.lot_number,
        u.first_name as consumed_by_name
      FROM inventory_consumption_logs c
      JOIN inventory_item_master i ON c.item_id = i.id
      LEFT JOIN inventory_batches b ON c.batch_id = b.id
      LEFT JOIN users u ON c.consumed_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (test_result_id) {
      sql += ' AND c.test_result_id = ?';
      params.push(test_result_id);
    }
    if (sample_id) {
      sql += ' AND c.sample_id = ?';
      params.push(sample_id);
    }
    if (item_id) {
      sql += ' AND c.item_id = ?';
      params.push(item_id);
    }
    if (start_date && end_date) {
      sql += ' AND DATE(c.consumed_at) BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    sql += ' ORDER BY c.consumed_at DESC';

    const [logs] = await db.execute(sql, params);
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('Error fetching consumption logs:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// QC / CONTROL INVENTORY
// ============================================

export const getQCInventory = async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT b.*, i.item_name, i.item_code, i.category, i.unit,
        v.vendor_name,
        DATEDIFF(b.expiry_date, CURDATE()) as days_until_expiry,
        DATEDIFF(CURDATE(), b.open_vial_date) as days_since_opened,
        CASE 
          WHEN b.open_vial_date IS NOT NULL AND b.stability_days IS NOT NULL
          THEN GREATEST(0, b.stability_days - DATEDIFF(CURDATE(), b.open_vial_date))
          ELSE NULL
        END as remaining_usable_days
      FROM inventory_batches b
      JOIN inventory_item_master i ON b.item_id = i.id
      LEFT JOIN vendors v ON b.vendor_id = v.id
      WHERE i.category IN ('Controls', 'Calibrators', 'QC Materials')
    `;
    const params = [];

    if (status) {
      sql += ' AND b.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY b.expiry_date ASC';

    const [qcItems] = await db.execute(sql, params);
    res.json({ success: true, data: qcItems });
  } catch (error) {
    console.error('Error fetching QC inventory:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const openVial = async (req, res) => {
  try {
    const { id } = req.params;
    const { open_vial_date, stability_days } = req.body;

    await db.execute(
      'UPDATE inventory_batches SET open_vial_date = ?, stability_days = ? WHERE id = ?',
      [open_vial_date, stability_days, id]
    );

    res.json({ success: true, message: 'Vial opened successfully' });
  } catch (error) {
    console.error('Error opening vial:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
