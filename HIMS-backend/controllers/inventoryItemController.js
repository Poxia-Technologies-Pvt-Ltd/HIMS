import db from '../config/db.js';

// Generate unique item code
const generateItemCode = async () => {
  const [rows] = await db.execute(
    "SELECT MAX(CAST(SUBSTRING(item_code, 6) AS UNSIGNED)) as max_num FROM inventory_item_master WHERE item_code LIKE 'ITEM-%'"
  );
  const maxNum = rows[0].max_num || 0;
  return `ITEM-${String(maxNum + 1).padStart(3, '0')}`;
};

export const getItems = async (req, res) => {
  try {
    const { status, category, search } = req.query;
    let sql = `
      SELECT im.*, v.vendor_name as default_vendor_name 
      FROM inventory_item_master im
      LEFT JOIN vendors v ON im.default_vendor_id = v.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ' AND im.status = ?';
      params.push(status);
    }
    if (category) {
      sql += ' AND im.category = ?';
      params.push(category);
    }
    if (search) {
      sql += ' AND (im.item_name LIKE ? OR im.item_code LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY im.created_at DESC';

    const [items] = await db.execute(sql, params);
    res.json({ success: true, data: items });
  } catch (error) {
    console.error('Error fetching inventory items:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getItemById = async (req, res) => {
  try {
    const { id } = req.params;
    const [items] = await db.execute(`
      SELECT im.*, v.vendor_name as default_vendor_name 
      FROM inventory_item_master im
      LEFT JOIN vendors v ON im.default_vendor_id = v.id
      WHERE im.id = ?
    `, [id]);

    if (items.length === 0) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    res.json({ success: true, data: items[0] });
  } catch (error) {
    console.error('Error fetching item:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createItem = async (req, res) => {
  try {
    const {
      item_code, item_name, category, unit, min_stock_level, reorder_level, status, default_vendor_id, delivery_lead_time_days, unit_price
    } = req.body;

    // Use provided item_code or generate one
    const finalItemCode = item_code && item_code.trim() !== '' 
      ? item_code 
      : await generateItemCode();

    const [result] = await db.execute(
      `INSERT INTO inventory_item_master (
        item_code, item_name, category, unit, min_stock_level, reorder_level, status, default_vendor_id, delivery_lead_time_days, unit_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [finalItemCode, item_name, category, unit, min_stock_level || 0, reorder_level || 0, status || 'Active', default_vendor_id || null, delivery_lead_time_days || 3, unit_price || 0]
    );

    res.status(201).json({ 
      success: true, 
      message: 'Item created successfully', 
      data: { id: result.insertId, item_code: finalItemCode } 
    });
  } catch (error) {
    console.error('Error adding item:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      item_code, item_name, category, unit, min_stock_level, reorder_level, status, default_vendor_id, delivery_lead_time_days, unit_price
    } = req.body;

    await db.execute(
      `UPDATE inventory_item_master SET
        item_code = ?, item_name = ?, category = ?, unit = ?, min_stock_level = ?, reorder_level = ?, status = ?, default_vendor_id = ?, delivery_lead_time_days = ?, unit_price = ?
      WHERE id = ?`,
      [item_code, item_name, category, unit, min_stock_level, reorder_level, status, default_vendor_id || null, delivery_lead_time_days || 3, unit_price || 0, id]
    );

    res.json({ success: true, message: 'Item updated successfully' });
  } catch (error) {
    console.error('Error updating item:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    
    // In a real system, you'd check for dependencies (stock, batches). Since we are building fresh, just delete.
    await db.execute('DELETE FROM inventory_item_master WHERE id = ?', [id]);
    res.json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Error deleting item:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
