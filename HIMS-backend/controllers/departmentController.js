import db from '../config/db.js';

const getAllDepartments = async (req, res) => {
  try {
    const { is_active } = req.query;
    let query = 'SELECT * FROM departments WHERE 1=1';
    const params = [];

    if (is_active !== undefined) {
      query += ' AND is_active = ?';
      params.push(is_active === 'true' ? 1 : 0);
    }

    query += ' ORDER BY name';

    const [departments] = await db.query(query, params);

    res.json({
      success: true,
      departments: departments.map(dept => ({
        id: dept.id,
        name: dept.name,
        code: dept.code,
        description: dept.description,
        isActive: dept.is_active === 1,
        createdAt: dept.created_at
      }))
    });
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({ success: false, message: 'Error fetching departments' });
  }
};

// Get single department by ID
const getDepartmentById = async (req, res) => {
  try {
    const { id } = req.params;
    const [departments] = await db.query('SELECT * FROM departments WHERE id = ?', [id]);

    if (departments.length === 0) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    const dept = departments[0];
    res.json({
      success: true,
      department: {
        id: dept.id,
        name: dept.name,
        code: dept.code,
        description: dept.description,
        isActive: dept.is_active === 1,
        createdAt: dept.created_at
      }
    });
  } catch (error) {
    console.error('Error fetching department:', error);
    res.status(500).json({ success: false, message: 'Error fetching department' });
  }
};

// Create new department — stores branch_id
const createDepartment = async (req, res) => {
  try {
    const { name, code, description, is_active, branch_id } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Department name is required' });
    }

    const [result] = await db.query(
      `INSERT INTO departments (name, code, description, is_active, branch_id) VALUES (?, ?, ?, ?, ?)`,
      [
        name.trim(),
        code || null,
        description || '',
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
        branch_id || null
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Department created successfully',
      departmentId: result.insertId
    });
  } catch (error) {
    console.error('Error creating department:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Department with this name already exists' });
    }
    res.status(500).json({ success: false, message: 'Error creating department' });
  }
};

// Update department
const updateDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description, is_active } = req.body;

    const updateFields = [];
    const values = [];

    if (name !== undefined) { updateFields.push('name = ?'); values.push(name.trim()); }
    if (code !== undefined) { updateFields.push('code = ?'); values.push(code); }
    if (description !== undefined) { updateFields.push('description = ?'); values.push(description); }
    if (is_active !== undefined) { updateFields.push('is_active = ?'); values.push(is_active ? 1 : 0); }

    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    values.push(id);
    const [result] = await db.query(
      `UPDATE departments SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    res.json({ success: true, message: 'Department updated successfully' });
  } catch (error) {
    console.error('Error updating department:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Department with this name already exists' });
    }
    res.status(500).json({ success: false, message: 'Error updating department' });
  }
};

// Delete department
const deleteDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM departments WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    res.json({ success: true, message: 'Department deleted successfully' });
  } catch (error) {
    console.error('Error deleting department:', error);
    res.status(500).json({ success: false, message: 'Error deleting department' });
  }
};

export default { getAllDepartments, getDepartmentById, createDepartment, updateDepartment, deleteDepartment };
