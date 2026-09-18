import db from '../config/db.js';

// Generate unique document numbers
const generatePRNumber = async () => {
  const [rows] = await db.execute(
    "SELECT MAX(CAST(SUBSTRING(pr_number, 4) AS UNSIGNED)) as max_num FROM purchase_requisitions WHERE pr_number LIKE 'PR-%'"
  );
  const maxNum = rows[0].max_num || 0;
  return `PR-${String(maxNum + 1).padStart(5, '0')}`;
};

const generatePONumber = async () => {
  const [rows] = await db.execute(
    "SELECT MAX(CAST(SUBSTRING(po_number, 4) AS UNSIGNED)) as max_num FROM purchase_orders WHERE po_number LIKE 'PO-%'"
  );
  const maxNum = rows[0].max_num || 0;
  return `PO-${String(maxNum + 1).padStart(5, '0')}`;
};

const generateGRNNumber = async () => {
  const [rows] = await db.execute(
    "SELECT MAX(CAST(SUBSTRING(grn_number, 5) AS UNSIGNED)) as max_num FROM goods_receipts WHERE grn_number LIKE 'GRN-%'"
  );
  const maxNum = rows[0].max_num || 0;
  return `GRN-${String(maxNum + 1).padStart(5, '0')}`;
};

// ============================================
// PURCHASE REQUISITIONS (PR)
// ============================================

export const getPurchaseRequisitions = async (req, res) => {
  try {
    const { status, department_id, branch_id, role_level, district_id } = req.query;
    let sql = `
      SELECT pr.*, 
        u.first_name as requester_name,
        i.name as department_name,
        b.branch_name,
        (SELECT COUNT(*) FROM purchase_requisition_items WHERE pr_id = pr.id) as item_count
      FROM purchase_requisitions pr
      LEFT JOIN users u ON pr.requested_by = u.id
      LEFT JOIN infrastructure i ON pr.department_id = i.id
      LEFT JOIN branches b ON pr.branch_id = b.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ' AND pr.status = ?';
      params.push(status);
    }
    if (department_id) {
      sql += ' AND pr.department_id = ?';
      params.push(department_id);
    }
    
    // Role-based branch filtering
    if (role_level === 'Branch' && branch_id) {
      sql += ' AND pr.branch_id = ?';
      params.push(branch_id);
    } else if (role_level === 'Sub-Central' && district_id) {
      sql += ' AND pr.branch_id IN (SELECT id FROM branches WHERE district_id = ?)';
      params.push(district_id);
    }

    sql += ' ORDER BY pr.created_at DESC';

    const [prs] = await db.execute(sql, params);
    res.json({ success: true, data: prs });
  } catch (error) {
    console.error('Error fetching PRs:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getPurchaseRequisitionById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const [prs] = await db.execute(`
      SELECT pr.*, 
        u.first_name as requester_name,
        i.name as department_name
      FROM purchase_requisitions pr
      LEFT JOIN users u ON pr.requested_by = u.id
      LEFT JOIN infrastructure i ON pr.department_id = i.id
      WHERE pr.id = ?
    `, [id]);

    if (prs.length === 0) {
      return res.status(404).json({ success: false, message: 'PR not found' });
    }

    // Get items
    const [items] = await db.execute(`
      SELECT pri.*, i.item_name, i.item_code, i.unit
      FROM purchase_requisition_items pri
      JOIN inventory_item_master i ON pri.item_id = i.id
      WHERE pri.pr_id = ?
    `, [id]);

    res.json({ success: true, data: { ...prs[0], items } });
  } catch (error) {
    console.error('Error fetching PR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createPurchaseRequisition = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    
    const prNumber = await generatePRNumber();
    const { department_id, request_date, required_date, priority, notes, items, requested_by, branch_id } = req.body;

    // Calculate total
    let totalAmount = 0;
    items.forEach(item => {
      totalAmount += (item.quantity_requested * (item.unit_price || 0));
    });

    const [result] = await connection.execute(
      `INSERT INTO purchase_requisitions (
        pr_number, department_id, requested_by, request_date, required_date,
        priority, total_amount, notes, status, branch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prNumber, department_id, requested_by, request_date, required_date,
       priority || 'Normal', totalAmount, notes, 'Draft', branch_id || 1]
    );

    const prId = result.insertId;

    // Insert items
    for (const item of items) {
      await connection.execute(
        `INSERT INTO purchase_requisition_items (
          pr_id, item_id, quantity_requested, unit_price, total_price, notes
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [prId, item.item_id, item.quantity_requested, 
         item.unit_price || 0, 
         item.quantity_requested * (item.unit_price || 0),
         item.notes]
      );
    }

    await connection.commit();
    res.status(201).json({ success: true, message: 'PR created successfully', data: { id: prId, pr_number: prNumber } });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating PR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};

export const updatePurchaseRequisition = async (req, res) => {
  try {
    const { id } = req.params;
    const { priority, required_date, notes, status } = req.body;

    await db.execute(
      'UPDATE purchase_requisitions SET priority = ?, required_date = ?, notes = ?, status = ? WHERE id = ?',
      [priority, required_date, notes, status, id]
    );

    res.json({ success: true, message: 'PR updated successfully' });
  } catch (error) {
    console.error('Error updating PR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const approvePurchaseRequisition = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    await db.execute(
      'UPDATE purchase_requisitions SET status = ?, notes = CONCAT(IFNULL(notes, ""), "\nApproval: ", ?) WHERE id = ?',
      [status, notes, id]
    );

    res.json({ success: true, message: `PR ${status.toLowerCase()} successfully` });
  } catch (error) {
    console.error('Error approving PR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// PURCHASE ORDERS (PO)
// ============================================

export const getPurchaseOrders = async (req, res) => {
  try {
    const { status, vendor_id, branch_id, role_level, district_id } = req.query;
    let sql = `
      SELECT po.*, 
        v.vendor_name, v.vendor_code,
        u.first_name as created_by_name,
        i.name as delivery_location_name,
        b.branch_name,
        (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) as item_count
      FROM purchase_orders po
      LEFT JOIN vendors v ON po.vendor_id = v.id
      LEFT JOIN users u ON po.created_by = u.id
      LEFT JOIN infrastructure i ON po.delivery_location = i.id
      LEFT JOIN branches b ON po.branch_id = b.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ' AND po.status = ?';
      params.push(status);
    }
    if (vendor_id) {
      sql += ' AND po.vendor_id = ?';
      params.push(vendor_id);
    }
    
    // Role-based branch filtering
    if (role_level === 'Branch' && branch_id) {
      sql += ' AND po.branch_id = ?';
      params.push(branch_id);
    } else if (role_level === 'Sub-Central' && district_id) {
      sql += ' AND po.branch_id IN (SELECT id FROM branches WHERE district_id = ?)';
      params.push(district_id);
    }

    sql += ' ORDER BY po.created_at DESC';

    const [pos] = await db.execute(sql, params);
    res.json({ success: true, data: pos });
  } catch (error) {
    console.error('Error fetching POs:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getPurchaseOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const [pos] = await db.execute(`
      SELECT po.*, 
        v.vendor_name, v.vendor_code, v.contact_person, v.phone, v.email, v.address,
        u.first_name as created_by_name,
        i.name as delivery_location_name
      FROM purchase_orders po
      LEFT JOIN vendors v ON po.vendor_id = v.id
      LEFT JOIN users u ON po.created_by = u.id
      LEFT JOIN infrastructure i ON po.delivery_location = i.id
      WHERE po.id = ?
    `, [id]);

    if (pos.length === 0) {
      return res.status(404).json({ success: false, message: 'PO not found' });
    }

    // Get items with received quantities
    const [items] = await db.execute(`
      SELECT poi.*, i.item_name, i.item_code, i.unit,
        COALESCE((SELECT SUM(quantity_received) FROM goods_receipt_items gri 
         JOIN goods_receipts gr ON gri.grn_id = gr.id 
         WHERE gr.po_id = ? AND gri.po_item_id = poi.id), 0) as received_qty
      FROM purchase_order_items poi
      JOIN inventory_item_master i ON poi.item_id = i.id
      WHERE poi.po_id = ?
    `, [id, id]);

    res.json({ success: true, data: { ...pos[0], items } });
  } catch (error) {
    console.error('Error fetching PO:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createPurchaseOrder = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    
    const poNumber = await generatePONumber();
    const { pr_id, vendor_id, order_date, expected_delivery, delivery_location, 
            terms_conditions, items, created_by, branch_id } = req.body;

    // Calculate totals
    let subtotal = 0;
    items.forEach(item => {
      subtotal += item.total_price;
    });
    const taxAmount = subtotal * 0.18; // 18% GST
    const totalAmount = subtotal + taxAmount;

    const [result] = await connection.execute(
      `INSERT INTO purchase_orders (
        po_number, pr_id, vendor_id, order_date, expected_delivery, delivery_location,
        subtotal, tax_amount, total_amount, terms_conditions, status, created_by, branch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [poNumber, pr_id || null, vendor_id, order_date, expected_delivery, delivery_location,
       subtotal, taxAmount, totalAmount, terms_conditions, 'Draft', created_by, branch_id || 1]
    );

    const poId = result.insertId;

    // Insert items
    for (const item of items) {
      await connection.execute(
        `INSERT INTO purchase_order_items (
          po_id, item_id, quantity_ordered, unit_price, total_price, notes
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [poId, item.item_id, item.quantity, item.unit_price, item.total_price, item.notes]
      );
    }

    // Update PR status if applicable
    if (pr_id) {
      await connection.execute(
        'UPDATE purchase_requisitions SET status = ? WHERE id = ?',
        ['Converted to PO', pr_id]
      );
    }

    await connection.commit();
    res.status(201).json({ success: true, message: 'PO created successfully', data: { id: poId, po_number: poNumber } });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating PO:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};

export const updatePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { expected_delivery, terms_conditions, status } = req.body;

    await db.execute(
      'UPDATE purchase_orders SET expected_delivery = ?, terms_conditions = ?, status = ? WHERE id = ?',
      [expected_delivery, terms_conditions, status, id]
    );

    res.json({ success: true, message: 'PO updated successfully' });
  } catch (error) {
    console.error('Error updating PO:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// GOODS RECEIPT NOTES (GRN)
// ============================================

export const getGoodsReceipts = async (req, res) => {
  try {
    const { status, po_id, branch_id, role_level, district_id } = req.query;
    let sql = `
      SELECT gr.*, 
        v.vendor_name, v.vendor_code,
        u.first_name as received_by_name,
        u2.first_name as approved_by_name,
        po.po_number,
        b.branch_name
      FROM goods_receipts gr
      LEFT JOIN vendors v ON gr.vendor_id = v.id
      LEFT JOIN users u ON gr.received_by = u.id
      LEFT JOIN users u2 ON gr.approved_by = u2.id
      LEFT JOIN purchase_orders po ON gr.po_id = po.id
      LEFT JOIN branches b ON gr.branch_id = b.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ' AND gr.status = ?';
      params.push(status);
    }
    if (po_id) {
      sql += ' AND gr.po_id = ?';
      params.push(po_id);
    }
    
    // Role-based branch filtering
    if (role_level === 'Branch' && branch_id) {
      sql += ' AND gr.branch_id = ?';
      params.push(branch_id);
    } else if (role_level === 'Sub-Central' && district_id) {
      sql += ' AND gr.branch_id IN (SELECT id FROM branches WHERE district_id = ?)';
      params.push(district_id);
    }

    sql += ' ORDER BY gr.created_at DESC';

    const [grns] = await db.execute(sql, params);
    res.json({ success: true, data: grns });
  } catch (error) {
    console.error('Error fetching GRNs:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getGoodsReceiptById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const [grns] = await db.execute(`
      SELECT gr.*, 
        v.vendor_name, v.vendor_code,
        u.first_name as received_by_name,
        u2.first_name as approved_by_name,
        po.po_number
      FROM goods_receipts gr
      LEFT JOIN vendors v ON gr.vendor_id = v.id
      LEFT JOIN users u ON gr.received_by = u.id
      LEFT JOIN users u2 ON gr.approved_by = u2.id
      LEFT JOIN purchase_orders po ON gr.po_id = po.id
      WHERE gr.id = ?
    `, [id]);

    if (grns.length === 0) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    // Get items
    const [items] = await db.execute(`
      SELECT gri.*, i.item_name, i.item_code, i.unit, i.expiry_required
      FROM goods_receipt_items gri
      JOIN inventory_item_master i ON gri.item_id = i.id
      WHERE gri.grn_id = ?
    `, [id]);

    res.json({ success: true, data: { ...grns[0], items } });
  } catch (error) {
    console.error('Error fetching GRN:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createGoodsReceipt = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    
    const grnNumber = await generateGRNNumber();
    const { po_id, vendor_id, receipt_date, invoice_number, invoice_date, 
            notes, items, received_by, branch_id } = req.body;

    // Calculate totals
    let subtotal = 0;
    items.forEach(item => {
      subtotal += item.total_cost;
    });
    const taxAmount = subtotal * 0.18;
    const totalAmount = subtotal + taxAmount;

    const [result] = await connection.execute(
      `INSERT INTO goods_receipts (
        grn_number, po_id, vendor_id, receipt_date, invoice_number, invoice_date,
        subtotal, tax_amount, total_amount, received_by, status, notes, branch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [grnNumber, po_id || null, vendor_id, receipt_date, invoice_number, invoice_date,
       subtotal, taxAmount, totalAmount, received_by, 'Pending', notes, branch_id || 1]
    );

    const grnId = result.insertId;

    // Insert items
    for (const item of items) {
      await connection.execute(
        `INSERT INTO goods_receipt_items (
          grn_id, po_item_id, item_id, quantity_received, quantity_damaged,
          unit_cost, total_cost, batch_number, lot_number, manufacturing_date, expiry_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [grnId, item.po_item_id || null, item.item_id, item.quantity_received, 
         item.quantity_damaged || 0, item.unit_cost, item.total_cost,
         item.batch_number, item.lot_number, item.manufacturing_date, item.expiry_date]
      );
    }

    await connection.commit();
    res.status(201).json({ 
      success: true, 
      message: 'GRN created successfully', 
      data: { id: grnId, grn_number: grnNumber } 
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating GRN:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};

export const approveGoodsReceipt = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    
    const { id } = req.params;
    const { status, approved_by } = req.body;

    const [grn] = await connection.execute(
      'SELECT * FROM goods_receipts WHERE id = ?',
      [id]
    );

    if (grn.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    await connection.execute(
      'UPDATE goods_receipts SET status = ?, approved_by = ? WHERE id = ?',
      [status, approved_by, id]
    );

    // If approved, update stock and create batches
    if (status === 'Approved') {
      const [items] = await connection.execute(
        'SELECT * FROM goods_receipt_items WHERE grn_id = ?',
        [id]
      );

      for (const item of items) {
        // Create or update batch
        const [batchResult] = await connection.execute(
          `INSERT INTO inventory_batches (
            item_id, batch_number, lot_number, manufacturing_date, expiry_date,
            vendor_id, quantity_received, quantity_available, unit_cost, grn_id, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [item.item_id, item.batch_number, item.lot_number, 
           item.manufacturing_date, item.expiry_date,
           grn[0].vendor_id, item.quantity_received, 
           item.quantity_received - (item.quantity_damaged || 0),
           item.unit_cost, id, 'Active']
        );

        // Create stock transaction
        await connection.execute(
          `INSERT INTO inventory_transactions (
            type, item_id, batch_id, quantity,
            reference_type, reference_id, to_department, created_by, remarks
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ['IN', item.item_id, batchResult.insertId, 
           item.quantity_received - (item.quantity_damaged || 0),
           'GRN', id, null, approved_by, 
           `GRN ${grn[0].grn_number}`]
        );

        // Update stock summary
        await connection.execute(
          `INSERT INTO inventory_stock (item_id, current_stock, available_stock, department_id)
           VALUES (?, ?, ?, NULL)
           ON DUPLICATE KEY UPDATE
           current_stock = current_stock + ?,
           available_stock = available_stock + ?`,
          [item.item_id, 
           item.quantity_received - (item.quantity_damaged || 0),
           item.quantity_received - (item.quantity_damaged || 0),
           item.quantity_received - (item.quantity_damaged || 0),
           item.quantity_received - (item.quantity_damaged || 0)]
        );

        // Update damaged stock if applicable
        if (item.quantity_damaged > 0) {
          await connection.execute(
            `UPDATE inventory_stock SET damaged_stock = damaged_stock + ? WHERE item_id = ?`,
            [item.quantity_damaged, item.item_id]
          );
        }

        // Update PO received quantities
        if (item.po_item_id) {
          await connection.execute(
            'UPDATE purchase_order_items SET quantity_received = quantity_received + ? WHERE id = ?',
            [item.quantity_received, item.po_item_id]
          );
        }
      }

      // Update PO status
      if (grn[0].po_id) {
        const [poItems] = await connection.execute(
          'SELECT quantity_ordered, quantity_received FROM purchase_order_items WHERE po_id = ?',
          [grn[0].po_id]
        );
        
        const allReceived = poItems.every(item => item.quantity_received >= item.quantity_ordered);
        const someReceived = poItems.some(item => item.quantity_received > 0);
        
        const poStatus = allReceived ? 'Fully Received' : (someReceived ? 'Partially Received' : 'Sent');
        
        await connection.execute(
          'UPDATE purchase_orders SET status = ? WHERE id = ?',
          [poStatus, grn[0].po_id]
        );
      }
    }

    await connection.commit();
    res.json({ success: true, message: `GRN ${status.toLowerCase()} successfully` });
  } catch (error) {
    await connection.rollback();
    console.error('Error approving GRN:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};

// ============================================
// PENDING FOR GRN (PO items awaiting receipt)
// ============================================

export const getPendingForGRN = async (req, res) => {
  try {
    const [items] = await db.execute(`
      SELECT 
        poi.id as po_item_id,
        poi.item_id,
        poi.quantity_ordered,
        poi.quantity_received,
        (poi.quantity_ordered - poi.quantity_received) as pending_qty,
        poi.unit_price,
        i.item_name, i.item_code, i.unit,
        po.id as po_id, po.po_number, po.vendor_id, po.status as po_status,
        v.vendor_name
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.po_id = po.id
      JOIN inventory_item_master i ON poi.item_id = i.id
      JOIN vendors v ON po.vendor_id = v.id
      WHERE po.status IN ('Sent', 'Partially Received')
      AND poi.quantity_ordered > poi.quantity_received
      ORDER BY po.order_date DESC
    `);

    res.json({ success: true, data: items });
  } catch (error) {
    console.error('Error fetching pending items:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
