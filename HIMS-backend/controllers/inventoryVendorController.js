import db from '../config/db.js';

// Generate unique vendor code
const generateVendorCode = async () => {
  const [rows] = await db.execute(
    "SELECT MAX(CAST(SUBSTRING(vendor_code, 5) AS UNSIGNED)) as max_num FROM vendors WHERE vendor_code LIKE 'IVND%'"
  );
  const maxNum = rows[0].max_num || 0;
  return `IVND${String(maxNum + 1).padStart(3, '0')}`;
};

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

    sql += ' ORDER BY created_at DESC';

    const [vendors] = await db.execute(sql, params);
    res.json({ success: true, data: vendors });
  } catch (error) {
    console.error('Error fetching inventory vendors:', error);
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
    res.json({ success: true, data: vendors[0] });
  } catch (error) {
    console.error('Error fetching vendor:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createVendor = async (req, res) => {
  try {
    const vendorCode = await generateVendorCode();
    const {
      vendor_name, contact_person, phone, email, address,
      tax_id, payment_terms, lead_time_days, bank_name, account_number, ifsc_code, status, rating
    } = req.body;

    const [result] = await db.execute(
      `INSERT INTO vendors (
        vendor_code, vendor_name, contact_person, phone, email, address,
        tax_id, payment_terms, lead_time_days, bank_name, account_number, ifsc_code, status, rating
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [vendorCode, vendor_name, contact_person, phone, email, address,
       tax_id, payment_terms, lead_time_days || 7, bank_name, account_number, ifsc_code, status || 'Active', rating || 0.00]
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
      tax_id, payment_terms, lead_time_days, bank_name, account_number, ifsc_code, status, rating
    } = req.body;

    await db.execute(
      `UPDATE vendors SET
        vendor_name = ?, contact_person = ?, phone = ?, email = ?, address = ?,
        tax_id = ?, payment_terms = ?, lead_time_days = ?, bank_name = ?, account_number = ?, ifsc_code = ?, status = ?, rating = ?
      WHERE id = ?`,
      [vendor_name, contact_person, phone, email, address,
       tax_id, payment_terms, lead_time_days, bank_name, account_number, ifsc_code, status, rating, id]
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
    
    // Check if the vendor is referenced in any Purchase Orders
    const [poCheck] = await db.execute('SELECT COUNT(*) as cnt FROM inventory_purchase_orders WHERE vendor_id = ?', [id]);
    
    if (poCheck[0].cnt > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete vendor because they have associated Purchase Orders. Please mark the vendor as "Inactive" instead to maintain historical records.' 
      });
    }

    await db.execute('DELETE FROM vendors WHERE id = ?', [id]);
    res.json({ success: true, message: 'Vendor deleted successfully' });
  } catch (error) {
    console.error('Error deleting vendor:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
