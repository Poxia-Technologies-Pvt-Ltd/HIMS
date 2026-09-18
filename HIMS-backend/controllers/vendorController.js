import db from '../config/db.js';

// Generate unique vendor code
const generateVendorCode = async () => {
  const [rows] = await db.execute(
    "SELECT MAX(CAST(SUBSTRING(vendor_code, 4) AS UNSIGNED)) as max_num FROM vendors WHERE vendor_code LIKE 'VEN%'"
  );
  const maxNum = rows[0].max_num || 0;
  return `VEN${String(maxNum + 1).padStart(3, '0')}`;
};

// ============================================
// VENDOR CRUD
// ============================================

export const getVendors = async (req, res) => {
  try {
    const { status, search } = req.query;
    let sql = 'SELECT * FROM vendors WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (search) {
      sql += ' AND (vendor_name LIKE ? OR vendor_code LIKE ? OR contact_person LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY vendor_name ASC';

    const [vendors] = await db.execute(sql, params);
    res.json({ success: true, data: vendors });
  } catch (error) {
    console.error('Error fetching vendors:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getVendorById = async (req, res) => {
  try {
    const { id } = req.params;
    const [vendors] = await db.execute('SELECT * FROM vendors WHERE id = ?', [id]);

    if (vendors.length === 0) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    // Get purchase history
    const [purchaseHistory] = await db.execute(`
      SELECT po.*, 
        (SELECT SUM(quantity_received) FROM goods_receipts gr 
         JOIN goods_receipt_items gri ON gr.id = gri.grn_id 
         WHERE gr.po_id = po.id) as received_qty
      FROM purchase_orders po
      WHERE po.vendor_id = ?
      ORDER BY po.order_date DESC
      LIMIT 10
    `, [id]);

    res.json({ success: true, data: { ...vendors[0], purchase_history: purchaseHistory } });
  } catch (error) {
    console.error('Error fetching vendor:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const addVendor = async (req, res) => {
  try {
    const vendorCode = await generateVendorCode();
    const {
      vendor_name, contact_person, phone, email, address,
      gst_number, payment_terms, lead_time_days
    } = req.body;

    const [result] = await db.execute(
      `INSERT INTO vendors (
        vendor_code, vendor_name, contact_person, phone, email, address,
        gst_number, payment_terms, lead_time_days, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [vendorCode, vendor_name, contact_person, phone, email, address,
       gst_number, payment_terms, lead_time_days || 7, 'Active']
    );

    res.status(201).json({ 
      success: true, 
      message: 'Vendor created successfully', 
      data: { id: result.insertId, vendor_code: vendorCode } 
    });
  } catch (error) {
    console.error('Error adding vendor:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateVendor = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      vendor_name, contact_person, phone, email, address,
      gst_number, payment_terms, lead_time_days, status
    } = req.body;

    await db.execute(
      `UPDATE vendors SET
        vendor_name = ?, contact_person = ?, phone = ?, email = ?, address = ?,
        gst_number = ?, payment_terms = ?, lead_time_days = ?, status = ?
      WHERE id = ?`,
      [vendor_name, contact_person, phone, email, address,
       gst_number, payment_terms, lead_time_days, status, id]
    );

    res.json({ success: true, message: 'Vendor updated successfully' });
  } catch (error) {
    console.error('Error updating vendor:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const deleteVendor = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if vendor has purchase orders
    const [pos] = await db.execute(
      'SELECT COUNT(*) as count FROM purchase_orders WHERE vendor_id = ?',
      [id]
    );
    
    if (pos[0].count > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete vendor with existing purchase orders. Set status to Inactive instead.' 
      });
    }

    await db.execute('DELETE FROM vendors WHERE id = ?', [id]);
    res.json({ success: true, message: 'Vendor deleted successfully' });
  } catch (error) {
    console.error('Error deleting vendor:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// VENDOR PURCHASE SUMMARY
// ============================================

export const getVendorPurchaseSummary = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    let sql = `
      SELECT 
        v.id, v.vendor_code, v.vendor_name, v.contact_person,
        COUNT(DISTINCT po.id) as total_orders,
        COALESCE(SUM(po.total_amount), 0) as total_purchase_amount,
        COALESCE(AVG(po.total_amount), 0) as avg_order_value
      FROM vendors v
      LEFT JOIN purchase_orders po ON v.id = po.vendor_id
    `;
    
    const params = [];
    if (start_date && end_date) {
      sql += ' AND po.order_date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }
    
    sql += ' WHERE v.status = Active GROUP BY v.id ORDER BY total_purchase_amount DESC';

    const [summary] = await db.execute(sql, params);
    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('Error fetching vendor summary:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
