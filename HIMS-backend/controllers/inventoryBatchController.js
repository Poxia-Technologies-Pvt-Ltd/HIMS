import db from '../config/db.js';

export const getBatches = async (req, res) => {
  try {
    const { status, item_id, branch_id, search } = req.query;
    
    let sql = `
      SELECT b.*, 
             i.item_code, i.item_name, i.unit, i.category,
             v.vendor_name,
             inf.branch_name as branch_name
      FROM inventory_batches b
      LEFT JOIN inventory_item_master i ON b.item_id = i.id
      LEFT JOIN vendors v ON b.vendor_id = v.id
      LEFT JOIN branches inf ON b.branch_id = inf.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ' AND b.status = ?';
      params.push(status);
    }
    if (item_id) {
      sql += ' AND b.item_id = ?';
      params.push(item_id);
    }
    if (branch_id) {
      sql += ' AND b.branch_id = ?';
      params.push(branch_id);
    }
    if (search) {
      sql += ' AND (b.batch_number LIKE ? OR i.item_name LIKE ? OR i.item_code LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY b.expiry_date ASC, b.created_at DESC';

    const [batches] = await db.execute(sql, params);
    
    // Automatically update status if expired
    const currentDate = new Date().toISOString().split('T')[0];
    const updatedBatches = batches.map(batch => {
      // If the batch has an expiry date that has passed, and it's not already depleted/expired
      if (batch.expiry_date) {
        const expiryDate = new Date(batch.expiry_date).toISOString().split('T')[0];
        if (expiryDate < currentDate && (batch.status === 'Available' || batch.status === 'Active')) {
           // We can dynamically flag it as Expired in the response (a cron job should do this in the DB normally)
           batch.status = 'Expired';
        }
      }
      return batch;
    });

    res.json({ success: true, data: updatedBatches });
  } catch (error) {
    console.error('Error fetching inventory batches:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getBatchById = async (req, res) => {
  try {
    const { id } = req.params;
    const [batches] = await db.execute(`
      SELECT b.*, i.item_name, v.vendor_name 
      FROM inventory_batches b
      LEFT JOIN inventory_item_master i ON b.item_id = i.id
      LEFT JOIN vendors v ON b.vendor_id = v.id
      WHERE b.id = ?
    `, [id]);

    if (batches.length === 0) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }
    res.json({ success: true, data: batches[0] });
  } catch (error) {
    console.error('Error fetching batch:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createBatch = async (req, res) => {
  try {
    const {
      item_id, vendor_id, branch_id, batch_number, expiry_date, quantity_available, quantity_received, purchase_date, status
    } = req.body;

    const [result] = await db.execute(
      `INSERT INTO inventory_batches (
        item_id, vendor_id, branch_id, batch_number, expiry_date, quantity_available, quantity_received, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [item_id, vendor_id || null, branch_id || null, batch_number, expiry_date || null, quantity_available || 0, quantity_received || quantity_available || 0, status || 'Active']
    );

    res.status(201).json({ 
      success: true, 
      message: 'Batch added successfully', 
      data: { id: result.insertId, batch_number } 
    });
  } catch (error) {
    console.error('Error adding batch:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      item_id, vendor_id, branch_id, batch_number, expiry_date, quantity_available, status
    } = req.body;

    await db.execute(
      `UPDATE inventory_batches SET
        item_id = ?, vendor_id = ?, branch_id = ?, batch_number = ?, expiry_date = ?, quantity_available = ?, status = ?
      WHERE id = ?`,
      [item_id, vendor_id || null, branch_id || null, batch_number, expiry_date || null, quantity_available, status, id]
    );

    res.json({ success: true, message: 'Batch updated successfully' });
  } catch (error) {
    console.error('Error updating batch:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const deleteBatch = async (req, res) => {
  try {
    const { id } = req.params;
    
    await db.execute('DELETE FROM inventory_batches WHERE id = ?', [id]);
    res.json({ success: true, message: 'Batch deleted successfully' });
  } catch (error) {
    console.error('Error deleting batch:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
