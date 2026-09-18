import db from '../config/db.js';

// Get all billing packages — scoped to branch
const getAllPackages = async (req, res) => {
  try {
    const { department, is_active, branch_id } = req.query;
    let query = 'SELECT * FROM billing_packages WHERE 1=1';
    const params = [];

    if (branch_id) {
      query += ' AND branch_id = ?';
      params.push(branch_id);
    }

    if (department) {
      query += ' AND department = ?';
      params.push(department);
    }

    if (is_active !== undefined) {
      query += ' AND is_active = ?';
      params.push(is_active === 'true' ? 1 : 0);
    }

    query += ' ORDER BY created_at DESC';

    const [packages] = await db.query(query, params);

    res.json({
      success: true,
      packages: packages.map(pkg => ({
        ...pkg,
        items: typeof pkg.items === 'string' ? JSON.parse(pkg.items) : pkg.items
      }))
    });
  } catch (error) {
    console.error('Error fetching billing packages:', error);
    res.status(500).json({ success: false, message: 'Error fetching billing packages' });
  }
};

// Get single package by ID
const getPackageById = async (req, res) => {
  try {
    const { id } = req.params;
    const [packages] = await db.query(
      'SELECT * FROM billing_packages WHERE package_id = ? OR id = ?',
      [id, id]
    );

    if (packages.length === 0) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }

    const pkg = packages[0];
    res.json({
      success: true,
      package: {
        ...pkg,
        items: typeof pkg.items === 'string' ? JSON.parse(pkg.items) : pkg.items
      }
    });
  } catch (error) {
    console.error('Error fetching billing package:', error);
    res.status(500).json({ success: false, message: 'Error fetching billing package' });
  }
};

// Create new package — stores branch_id
const createPackage = async (req, res) => {
  try {
    const { package_id, name, department, description, items, discount_percent, is_active, branch_id } = req.body;

    if (!name || !department || !items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'Name, department, and items array are required' });
    }

    const pkgId = package_id || 'PKG-' + Math.floor(1000 + Math.random() * 9000);

    const [result] = await db.query(
      `INSERT INTO billing_packages (package_id, name, department, description, items, discount_percent, is_active, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [pkgId, name, department, description || '', JSON.stringify(items), discount_percent || 0, is_active !== undefined ? is_active : true, branch_id || null]
    );

    res.status(201).json({
      success: true,
      message: 'Billing package created successfully',
      packageId: pkgId,
      id: result.insertId
    });
  } catch (error) {
    console.error('Error creating billing package:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Package with this ID already exists' });
    }
    res.status(500).json({ success: false, message: 'Error creating billing package' });
  }
};

// Update package
const updatePackage = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, department, description, items, discount_percent, is_active } = req.body;

    const updateFields = [];
    const values = [];

    if (name !== undefined) { updateFields.push('name = ?'); values.push(name); }
    if (department !== undefined) { updateFields.push('department = ?'); values.push(department); }
    if (description !== undefined) { updateFields.push('description = ?'); values.push(description); }
    if (items !== undefined) { updateFields.push('items = ?'); values.push(JSON.stringify(items)); }
    if (discount_percent !== undefined) { updateFields.push('discount_percent = ?'); values.push(discount_percent); }
    if (is_active !== undefined) { updateFields.push('is_active = ?'); values.push(is_active ? 1 : 0); }

    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    values.push(id, id);
    const [result] = await db.query(
      `UPDATE billing_packages SET ${updateFields.join(', ')} WHERE package_id = ? OR id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }

    res.json({ success: true, message: 'Billing package updated successfully' });
  } catch (error) {
    console.error('Error updating billing package:', error);
    res.status(500).json({ success: false, message: 'Error updating billing package' });
  }
};

// Delete package
const deletePackage = async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query(
      'DELETE FROM billing_packages WHERE package_id = ? OR id = ?',
      [id, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }

    res.json({ success: true, message: 'Billing package deleted successfully' });
  } catch (error) {
    console.error('Error deleting billing package:', error);
    res.status(500).json({ success: false, message: 'Error deleting billing package' });
  }
};

// Get packages by department — scoped to branch
const getPackagesByDepartment = async (req, res) => {
  try {
    const { department } = req.params;
    const { branch_id } = req.query;

    let query = 'SELECT * FROM billing_packages WHERE department = ? AND is_active = true';
    const params = [department];

    if (branch_id) {
      query += ' AND branch_id = ?';
      params.push(branch_id);
    }

    query += ' ORDER BY name';

    const [packages] = await db.query(query, params);

    res.json({
      success: true,
      packages: packages.map(pkg => ({
        ...pkg,
        items: typeof pkg.items === 'string' ? JSON.parse(pkg.items) : pkg.items
      }))
    });
  } catch (error) {
    console.error('Error fetching department packages:', error);
    res.status(500).json({ success: false, message: 'Error fetching department packages' });
  }
};

export default { getAllPackages, getPackageById, createPackage, updatePackage, deletePackage, getPackagesByDepartment };
