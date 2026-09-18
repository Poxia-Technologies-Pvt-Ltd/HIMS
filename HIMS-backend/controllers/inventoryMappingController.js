import db from '../config/db.js';

export const getMappings = async (req, res) => {
  try {
    const { test_id } = req.query;
    
    let sql = `
      SELECT m.*, 
             t.test_name, t.test_code,
             i.item_name, i.item_code, i.unit, i.category
      FROM inventory_test_mapping m
      JOIN lab_tests t ON m.test_id = t.id
      JOIN inventory_item_master i ON m.item_id = i.id
      WHERE 1=1
    `;
    const params = [];

    if (test_id) {
      sql += ' AND m.test_id = ?';
      params.push(test_id);
    }

    sql += ' ORDER BY t.test_name ASC, i.item_name ASC';

    const [mappings] = await db.execute(sql, params);
    res.json({ success: true, data: mappings });
  } catch (error) {
    console.error('Error fetching test mappings:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createMapping = async (req, res) => {
  try {
    const { test_id, item_id, quantity_required } = req.body;

    const [result] = await db.execute(
      `INSERT INTO inventory_test_mapping (test_id, item_id, quantity_required) 
       VALUES (?, ?, ?)`,
      [test_id, item_id, quantity_required || 1]
    );

    res.status(201).json({ 
      success: true, 
      message: 'Mapping added successfully', 
      data: { id: result.insertId } 
    });
  } catch (error) {
    console.error('Error creating mapping:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const deleteMapping = async (req, res) => {
  try {
    const { id } = req.params;
    
    await db.execute('DELETE FROM inventory_test_mapping WHERE id = ?', [id]);
    
    res.json({ success: true, message: 'Mapping deleted successfully' });
  } catch (error) {
    console.error('Error deleting mapping:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
