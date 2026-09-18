import db from '../config/db.js';
import { sendPOEmail } from '../services/emailService.js';
import { sendPOWhatsApp } from '../services/whatsappService.js';

// -----------------------------------------
// PURCHASE REQUISITIONS (PR)
// -----------------------------------------

export const getPRs = async (req, res) => {
  try {
    const { branch_id, role_level } = req.query;
    let query = `SELECT pr.*, 
        inf.branch_name as branch_name,
        u.first_name as requested_by_name
       FROM inventory_purchase_requisitions pr
       LEFT JOIN branches inf ON pr.branch_id = inf.id
       LEFT JOIN users u ON pr.requested_by = u.id
       WHERE 1=1`;
    const params = [];

    if (role_level === 'Branch' && branch_id) {
      query += ` AND pr.branch_id = ?`;
      params.push(branch_id);
    }

    query += ` ORDER BY pr.created_at DESC`;
    const [prs] = await db.query(query, params);

    const [items] = await db.query(
      `SELECT pri.*, i.item_name, i.item_code, i.unit
       FROM inventory_pr_items pri
       JOIN inventory_item_master i ON pri.item_id = i.id`
    );

    const enrichedPRs = prs.map(pr => ({
      ...pr,
      items: items.filter(i => i.pr_id === pr.id)
    }));

    res.json({ success: true, data: enrichedPRs });
  } catch (error) {
    console.error('Error fetching PRs:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createPR = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { branch_id, items, requested_by } = req.body;

    if (!branch_id) {
      throw new Error('Branch/Department is required');
    }

    if (!items || items.length === 0) {
      throw new Error('No items provided for requisition');
    }

    const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
    const [countRes] = await connection.query(`SELECT COUNT(*) as cnt FROM inventory_purchase_requisitions WHERE DATE(created_at) = CURDATE()`);
    const count = (countRes[0].cnt + 1).toString().padStart(3, '0');
    const prNumber = `PR-${dateStr}-${count}`;

    const [prRes] = await connection.query(
      `INSERT INTO inventory_purchase_requisitions (pr_number, branch_id, requested_by) VALUES (?, ?, ?)`,
      [prNumber, branch_id, requested_by || 1]
    );
    const prId = prRes.insertId;

    for (const item of items) {
      if (!item.item_id || !item.quantity) {
        throw new Error('Item ID and Quantity are required for all line items');
      }
      await connection.query(
        `INSERT INTO inventory_pr_items (pr_id, item_id, quantity, remarks) VALUES (?, ?, ?, ?)`,
        [prId, parseInt(item.item_id), parseInt(item.quantity), item.remarks || '']
      );
    }

    await connection.commit();
    res.status(201).json({ success: true, message: 'Purchase Requisition created successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating PR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};

export const updatePRStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, approved_by } = req.body;

    await db.query(
      `UPDATE inventory_purchase_requisitions SET status = ?, approved_by = ? WHERE id = ?`,
      [status, approved_by || 1, id]
    );

    res.json({ success: true, message: `PR status updated to ${status}` });
  } catch (error) {
    console.error('Error updating PR status:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// -----------------------------------------
// PURCHASE ORDERS (PO)
// -----------------------------------------

export const getPOs = async (req, res) => {
  try {
    const { branch_id, role_level } = req.query;
    let query = `SELECT po.*, v.vendor_name, u.first_name as created_by_name
       FROM inventory_purchase_orders po
       LEFT JOIN vendors v ON po.vendor_id = v.id
       LEFT JOIN users u ON po.created_by = u.id
       WHERE 1=1`;
    const params = [];

    // Note: POs are global documents but often requested for a branch via a PR.
    // For now, if we want to scope POs that were generated from a branch's PR:
    if (role_level === 'Branch' && branch_id) {
      query += ` AND (EXISTS (SELECT 1 FROM inventory_po_items poi JOIN inventory_pr_items pri ON poi.pr_item_id = pri.id JOIN inventory_purchase_requisitions ipr ON pri.pr_id = ipr.id WHERE poi.po_id = po.id AND ipr.branch_id = ?))`;
      params.push(branch_id);
    }

    query += ` ORDER BY po.created_at DESC`;
    const [pos] = await db.query(query, params);

    const [items] = await db.query(
      `SELECT poi.*, i.item_name, i.item_code, i.unit
       FROM inventory_po_items poi
       JOIN inventory_item_master i ON poi.item_id = i.id`
    );

    const enrichedPOs = pos.map(po => ({
      ...po,
      items: items.filter(i => i.po_id === po.id)
    }));

    res.json({ success: true, data: enrichedPOs });
  } catch (error) {
    console.error('Error fetching POs:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createPO = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { vendor_id, expected_delivery_date, items, created_by, pr_id } = req.body;

    if (!vendor_id) {
      throw new Error('Vendor is required for a Purchase Order');
    }

    if (!items || items.length === 0) {
      throw new Error('No items provided for Purchase Order');
    }

    const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
    const [countRes] = await connection.query(`SELECT COUNT(*) as cnt FROM inventory_purchase_orders WHERE DATE(created_at) = CURDATE()`);
    const count = (countRes[0].cnt + 1).toString().padStart(3, '0');
    const poNumber = `PO-${dateStr}-${count}`;

    let totalAmount = 0;
    for (const item of items) {
      if (!item.item_id || !item.quantity) {
        throw new Error('Item ID and Quantity are required for all line items');
      }
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unit_price) || 0;
      totalAmount += qty * price;
    }

    const [poRes] = await connection.query(
      `INSERT INTO inventory_purchase_orders (po_number, vendor_id, expected_delivery_date, total_amount, created_by) 
       VALUES (?, ?, ?, ?, ?)`,
      [poNumber, vendor_id, expected_delivery_date || null, totalAmount, created_by || 1]
    );
    const poId = poRes.insertId;

    for (const item of items) {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unit_price) || 0;
      const subtotal = qty * price;
      await connection.query(
        `INSERT INTO inventory_po_items (po_id, pr_item_id, item_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?, ?)`,
        [poId, item.pr_item_id || null, parseInt(item.item_id), qty, price, subtotal]
      );
    }

    if (pr_id) {
      await connection.query(`UPDATE inventory_purchase_requisitions SET status = 'PO_CREATED' WHERE id = ?`, [pr_id]);
    }

    await connection.commit();

    // Note: Email and WhatsApp are now triggered from the frontend via the /send-email endpoint
    // to ensure the PDF is generated and attached correctly.

    res.status(201).json({ success: true, message: 'Purchase Order created successfully', po_id: poId });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating PO:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    connection.release();
  }
};

export const updatePOStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    await db.query(
      `UPDATE inventory_purchase_orders SET status = ? WHERE id = ?`,
      [status, id]
    );

    res.json({ success: true, message: `PO status updated to ${status}` });
  } catch (error) {
    console.error('Error updating PO status:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Send existing PO email with frontend-generated PDF attached
export const sendPOByEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { pdf_base64 } = req.body; // base64 PDF string from frontend

    // Fetch full PO with items
    const [poRows] = await db.query(
      `SELECT po.*, v.vendor_name, v.email as vendor_email, v.phone as vendor_phone,
              u.first_name as created_by_name, u.email as user_email
       FROM inventory_purchase_orders po
       LEFT JOIN vendors v ON po.vendor_id = v.id
       LEFT JOIN users u ON po.created_by = u.id
       WHERE po.id = ?`, [id]
    );
    if (!poRows.length) return res.status(404).json({ success: false, message: 'PO not found' });

    const [poItems] = await db.query(
      `SELECT poi.*, i.item_name, i.item_code, i.unit
       FROM inventory_po_items poi JOIN inventory_item_master i ON poi.item_id = i.id
       WHERE poi.po_id = ?`, [id]
    );

    const po = { ...poRows[0], items: poItems };
    const vendorEmail = po.vendor_email;
    const userEmail = po.user_email;

    if (!vendorEmail) {
      return res.status(400).json({ success: false, message: 'Vendor does not have an email address configured' });
    }

    // Convert base64 PDF to Buffer
    const pdfBuffer = pdf_base64 ? Buffer.from(pdf_base64, 'base64') : null;

    await sendPOEmail(po, vendorEmail, userEmail, pdfBuffer);

    // Also send WhatsApp notification to vendor (fire-and-forget)
    const vendorPhone = poRows[0].vendor_phone;
    if (vendorPhone) {
      const [settingsRows] = await db.query(`SELECT hospital_name FROM hospital_settings LIMIT 1`);
      const hospitalName = settingsRows[0]?.hospital_name || 'HIMS';
      sendPOWhatsApp(po, vendorPhone, hospitalName, pdf_base64)
        .catch(e => console.error('WhatsApp error:', e.message));
    } else {
      console.log('No vendor phone number — WhatsApp skipped');
    }

    res.json({ success: true, message: `Email sent to ${vendorEmail}` });
  } catch (error) {
    console.error('Error sending PO email:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

