import db from '../config/db.js';

// Get all infrastructure items
export const getInfraList = async (req, res) => {
  try {
    const { type } = req.query;
    // Enforce branch from JWT; Central admins may filter via query param
    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    const filterBranch = scope || (req.query.branch_id !== 'all' ? req.query.branch_id : null) || null;

    let query = 'SELECT * FROM infrastructure';
    let params = [];
    let conditions = [];

    if (type) {
      conditions.push('type = ?');
      params.push(type);
    }

    if (filterBranch) {
      conditions.push('branch_id = ?');
      params.push(filterBranch);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY floor ASC, block ASC';
    const [rows] = await db.query(query, params);
    
    res.json({ success: true, items: rows });
  } catch (error) {
    console.error('Error fetching infra list:', error);
    res.status(500).json({ success: false, message: 'Server error fetching infrastructure' });
  }
};

// Add new infrastructure item
export const addInfra = async (req, res) => {
  try {
    const { name, type, block, floor, capacity, status } = req.body;

    if (!name || !type) {
      return res.status(400).json({ success: false, message: 'Name and Type are required' });
    }

    const callerBranch = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    const branch_id = callerBranch || req.body.branch_id || null;

    const query = `
      INSERT INTO infrastructure (name, type, block, floor, capacity, status, branch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
      name,
      type,
      block,
      floor !== undefined && floor !== '' ? parseInt(floor) : null,
      capacity !== undefined && capacity !== '' ? parseInt(capacity) : null,
      status || 'Available',
      branch_id || null
    ];

    const [result] = await db.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Infrastructure item added successfully',
      id: result.insertId
    });
  } catch (error) {
    console.error('Error adding infra:', error);
    res.status(500).json({ success: false, message: 'Server error adding infrastructure' });
  }
};

// Update infrastructure item
export const updateInfra = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, block, floor, capacity, status } = req.body;

    // Enforce branch from JWT, not the client-supplied query string.
    const callerBranch = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;

    const query = `
      UPDATE infrastructure
      SET name = ?, type = ?, block = ?, floor = ?, capacity = ?, status = ?
      WHERE id = ? ${callerBranch ? 'AND branch_id = ?' : ''}
    `;
    const values = [
      name,
      type,
      block,
      floor !== undefined && floor !== '' ? parseInt(floor) : null,
      capacity !== undefined && capacity !== '' ? parseInt(capacity) : null,
      status,
      id
    ];
    if (callerBranch) values.push(callerBranch);

    const [result] = await db.query(query, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Infrastructure item not found' });
    }

    res.json({ success: true, message: 'Infrastructure item updated successfully' });
  } catch (error) {
    console.error('Error updating infra:', error);
    res.status(500).json({ success: false, message: 'Server error updating infrastructure' });
  }
};

// Delete infrastructure item
export const deleteInfra = async (req, res) => {
  try {
    const { id } = req.params;
    let query = 'DELETE FROM infrastructure WHERE id = ?';
    let values = [id];

    // Enforce branch from JWT, not the client-supplied query string.
    const callerBranch = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    if (callerBranch) {
      query += ' AND branch_id = ?';
      values.push(callerBranch);
    }

    const [result] = await db.query(query, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Infrastructure item not found' });
    }

    res.json({ success: true, message: 'Infrastructure item deleted successfully' });
  } catch (error) {
    console.error('Error deleting infra:', error);
    res.status(500).json({ success: false, message: 'Server error deleting infrastructure' });
  }
};
