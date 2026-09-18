import db from '../config/db.js';

// Generate unique item code
const generateItemCode = async () => {
  const [rows] = await db.execute(
    "SELECT MAX(CAST(SUBSTRING(item_code, 4) AS UNSIGNED)) as max_num FROM inventory_item_master WHERE item_code LIKE 'ITM%'"
  );
  const maxNum = rows[0].max_num || 0;
  return `ITM${String(maxNum + 1).padStart(5, '0')}`;
};

// ============================================
// INVENTORY ITEMS CRUD
// ============================================

export const getInventoryItems = async (req, res) => {
  try {
    const { category, status, search, branch_id, role_level } = req.query;
    
    // Base query - for Branch role, show items with stock at their branch
    let sql = `
      SELECT i.*, 
        COALESCE(SUM(b.quantity_available), 0) as current_stock,
        COALESCE(SUM(b.quantity_available), 0) as available_stock,
        COALESCE(branch_stock.branch_qty, 0) as branch_stock
      FROM inventory_item_master i
      LEFT JOIN inventory_batches b ON i.id = b.item_id AND b.status = 'Active'
      LEFT JOIN (
        SELECT item_id, SUM(quantity_available) as branch_qty 
        FROM inventory_batches 
        WHERE status = 'Active' AND branch_id = ?
        GROUP BY item_id
      ) branch_stock ON i.id = branch_stock.item_id
      WHERE 1=1
    `;
    const params = [branch_id || 1];

    if (category) {
      sql += ' AND i.category = ?';
      params.push(category);
    }
    if (status) {
      sql += ' AND i.status = ?';
      params.push(status);
    }
    if (search) {
      sql += ' AND (i.item_name LIKE ? OR i.item_code LIKE ? OR i.brand LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Branch role isolation - only show items that have stock at their branch
    if (role_level === 'Branch' && branch_id) {
      sql += ' AND branch_stock.branch_qty > 0';
    }

    sql += ' GROUP BY i.id ORDER BY i.created_at DESC';

    const [items] = await db.execute(sql, params);
    res.json({ success: true, data: items });
  } catch (error) {
    console.error('Error fetching inventory items:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getInventoryItemById = async (req, res) => {
  try {
    const { id } = req.params;
    const { branch_id, role_level } = req.query;
    
    const [items] = await db.execute(
      `SELECT i.*, 
        COALESCE(SUM(b.quantity_available), 0) as current_stock,
        COALESCE(SUM(b.quantity_available), 0) as available_stock
      FROM inventory_item_master i
      LEFT JOIN inventory_batches b ON i.id = b.item_id AND b.status = 'Active'
      WHERE i.id = ?`,
      [id]
    );

    if (items.length === 0) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    // Get batches for this item - filtered by branch for Branch role
    let batchQuery = `
      SELECT b.*, v.vendor_name 
      FROM inventory_batches b
      LEFT JOIN vendors v ON b.vendor_id = v.id
      WHERE b.item_id = ? AND b.status = 'Active'
    `;
    const batchParams = [id];
    
    if (role_level === 'Branch' && branch_id) {
      batchQuery += ' AND b.branch_id = ?';
      batchParams.push(branch_id);
    }
    batchQuery += ' ORDER BY b.expiry_date ASC';
    
    const [batches] = await db.execute(batchQuery, batchParams);

    res.json({ success: true, data: { ...items[0], batches } });
  } catch (error) {
    console.error('Error fetching inventory item:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const addInventoryItem = async (req, res) => {
  try {
    const itemCode = await generateItemCode();
    const {
      item_name, category, brand, manufacturer, unit,
      min_stock_level, reorder_level, storage_condition,
      cost_price, selling_cost, expiry_required, lot_tracking,
      status
    } = req.body;

    const [result] = await db.execute(
      `INSERT INTO inventory_item_master (
        item_code, item_name, category, brand, manufacturer, unit,
        min_stock_level, reorder_level, storage_condition,
        cost_price, selling_cost, expiry_required, lot_tracking, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [itemCode, item_name, category, brand, manufacturer, unit,
       min_stock_level || 0, reorder_level || 0, storage_condition,
       cost_price || 0, selling_cost || 0, expiry_required ? 1 : 0, lot_tracking ? 1 : 0, status || 'Active']
    );

    // Create initial stock record
    await db.execute(
      'INSERT INTO inventory_stock (item_id, current_stock, available_stock, department_id) VALUES (?, 0, 0, NULL)',
      [result.insertId]
    );

    res.status(201).json({ success: true, message: 'Item created successfully', data: { id: result.insertId, item_code: itemCode } });
  } catch (error) {
    console.error('Error adding inventory item:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      item_name, category, brand, manufacturer, unit,
      min_stock_level, reorder_level, storage_condition,
      cost_price, selling_cost, expiry_required, lot_tracking,
      status
    } = req.body;

    await db.execute(
      `UPDATE inventory_item_master SET
        item_name = ?, category = ?, brand = ?, manufacturer = ?, unit = ?,
        min_stock_level = ?, reorder_level = ?, storage_condition = ?,
        cost_price = ?, selling_cost = ?, expiry_required = ?, lot_tracking = ?,
        status = ?
      WHERE id = ?`,
      [item_name, category, brand, manufacturer, unit,
       min_stock_level, reorder_level, storage_condition,
       cost_price, selling_cost, expiry_required ? 1 : 0, lot_tracking ? 1 : 0, status, id]
    );

    res.json({ success: true, message: 'Item updated successfully' });
  } catch (error) {
    console.error('Error updating inventory item:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const deleteInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if item has stock
    const [stock] = await db.execute(
      'SELECT SUM(current_stock) as total_stock FROM inventory_stock WHERE item_id = ?',
      [id]
    );
    
    if (stock[0].total_stock > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete item with existing stock' });
    }

    await db.execute('DELETE FROM inventory_item_master WHERE id = ?', [id]);
    res.json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Error deleting inventory item:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// ITEM CATEGORIES
// ============================================

export const getItemCategories = async (req, res) => {
  try {
    const categories = [
      'Reagents', 'Consumables', 'Test Kits', 'Calibrators', 
      'Controls', 'Glassware', 'General Lab Supplies'
    ];
    res.json({ success: true, data: categories });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// BATCH MANAGEMENT
// ============================================

export const getBatches = async (req, res) => {
  try {
    const { item_id, status, expiring_soon, branch_id, role_level } = req.query;
    let sql = `
      SELECT b.*, i.item_name, i.item_code, i.unit, v.vendor_name,
        br.branch_name as branch_name
      FROM inventory_batches b
      JOIN inventory_item_master i ON b.item_id = i.id
      LEFT JOIN vendors v ON b.vendor_id = v.id
      LEFT JOIN branches br ON b.branch_id = br.id
      WHERE 1=1
    `;
    const params = [];

    if (item_id) {
      sql += ' AND b.item_id = ?';
      params.push(item_id);
    }
    if (status) {
      sql += ' AND b.status = ?';
      params.push(status);
    }
    if (expiring_soon === 'true') {
      sql += ' AND b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND b.expiry_date >= CURDATE()';
    }
    
    // Branch role isolation
    if (role_level === 'Branch' && branch_id) {
      sql += ' AND b.branch_id = ?';
      params.push(branch_id);
    }

    sql += ' ORDER BY b.expiry_date ASC';

    const [batches] = await db.execute(sql, params);
    res.json({ success: true, data: batches });
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const addBatch = async (req, res) => {
  try {
    const {
      item_id, batch_number, lot_number, manufacturing_date, expiry_date,
      vendor_id, quantity_received, unit_cost, grn_id, open_vial_date, stability_days,
      branch_id
    } = req.body;

    const [result] = await db.execute(
      `INSERT INTO inventory_batches (
        item_id, batch_number, lot_number, manufacturing_date, expiry_date,
        vendor_id, quantity_received, quantity_available, unit_cost, grn_id,
        open_vial_date, stability_days, status, branch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item_id, batch_number, lot_number, manufacturing_date, expiry_date,
       vendor_id, quantity_received, quantity_received, unit_cost, grn_id,
       open_vial_date, stability_days, 'Active', branch_id || 1]
    );

    res.status(201).json({ success: true, message: 'Batch added successfully', data: { id: result.insertId } });
  } catch (error) {
    console.error('Error adding batch:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, open_vial_date, stability_days } = req.body;

    await db.execute(
      'UPDATE inventory_batches SET status = ?, open_vial_date = ?, stability_days = ? WHERE id = ?',
      [status, open_vial_date, stability_days, id]
    );

    res.json({ success: true, message: 'Batch updated successfully' });
  } catch (error) {
    console.error('Error updating batch:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// LOW STOCK & EXPIRY ALERTS
// ============================================

export const getLowStockAlerts = async (req, res) => {
  try {
    const { branch_id, role_level } = req.query;
    
    let sql = `
      SELECT i.*, COALESCE(SUM(b.quantity_available), 0) as available_stock,
        br.branch_name
      FROM inventory_item_master i
      LEFT JOIN inventory_batches b ON i.id = b.item_id AND b.status = 'Active'
      LEFT JOIN branches br ON b.branch_id = br.id
      WHERE i.status = 'Active'
    `;
    const params = [];
    
    // Branch role isolation
    if (role_level === 'Branch' && branch_id) {
      sql += ' AND b.branch_id = ?';
      params.push(branch_id);
    }
    
    sql += `
      GROUP BY i.id
      HAVING COALESCE(SUM(b.quantity_available), 0) <= i.reorder_level
      ORDER BY i.category, i.item_name
    `;
    
    const [alerts] = await db.execute(sql, params);
    res.json({ success: true, data: alerts });
  } catch (error) {
    console.error('Error fetching low stock alerts:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getExpiryAlerts = async (req, res) => {
  try {
    const { days = 30, branch_id, role_level } = req.query;
    
    let sql = `
      SELECT b.*, i.item_name, i.item_code, i.unit, v.vendor_name,
        DATEDIFF(b.expiry_date, CURDATE()) as days_until_expiry,
        br.branch_name
      FROM inventory_batches b
      JOIN inventory_item_master i ON b.item_id = i.id
      LEFT JOIN vendors v ON b.vendor_id = v.id
      LEFT JOIN branches br ON b.branch_id = br.id
      WHERE b.status = 'Active'
      AND b.quantity_available > 0
      AND b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
    `;
    const params = [days];
    
    // Branch role isolation
    if (role_level === 'Branch' && branch_id) {
      sql += ' AND b.branch_id = ?';
      params.push(branch_id);
    }
    
    sql += ' ORDER BY b.expiry_date ASC';
    
    const [alerts] = await db.execute(sql, params);
    
    res.json({ success: true, data: alerts });
  } catch (error) {
    console.error('Error fetching expiry alerts:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getExpiredStock = async (req, res) => {
  try {
    const { branch_id, role_level } = req.query;
    
    let sql = `
      SELECT b.*, i.item_name, i.item_code, i.unit, v.vendor_name,
        br.branch_name
      FROM inventory_batches b
      JOIN inventory_item_master i ON b.item_id = i.id
      LEFT JOIN vendors v ON b.vendor_id = v.id
      LEFT JOIN branches br ON b.branch_id = br.id
      WHERE b.status = 'Active'
      AND b.expiry_date < CURDATE()
      AND b.quantity_available > 0
    `;
    const params = [];
    
    // Branch role isolation
    if (role_level === 'Branch' && branch_id) {
      sql += ' AND b.branch_id = ?';
      params.push(branch_id);
    }
    
    sql += ' ORDER BY b.expiry_date DESC';
    
    const [expired] = await db.execute(sql, params);
    
    res.json({ success: true, data: expired });
  } catch (error) {
    console.error('Error fetching expired stock:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// DASHBOARD STATS
// ============================================

export const getInventoryDashboard = async (req, res) => {
  try {
    const { branch_id, role_level, district_id } = req.query;
    
    // Build branch filter clause based on role
    let branchFilter = '';
    let branchParams = [];
    
    if (role_level === 'Branch' && branch_id) {
      // Single branch - strict isolation
      branchFilter = 'AND b.branch_id = ?';
      branchParams = [branch_id];
    } else if (role_level === 'Sub-Central' && district_id) {
      // District scope - join with branches
      branchFilter = 'AND b.branch_id IN (SELECT id FROM branches WHERE district_id = ?)';
      branchParams = [district_id];
    }
    // Central role has no branch filter (views all)

    // Total inventory value
    const [valueResult] = await db.execute(`
      SELECT SUM(b.quantity_available * b.unit_cost) as total_value
      FROM inventory_batches b
      WHERE b.status = 'Active'
      ${branchFilter}
    `, branchParams);

    // Low stock count - calculated from batches
    const [lowStockResult] = await db.execute(`
      SELECT COUNT(*) as count
      FROM inventory_item_master i
      WHERE i.status = 'Active'
      AND (
        SELECT COALESCE(SUM(b.quantity_available), 0)
        FROM inventory_batches b
        WHERE b.item_id = i.id AND b.status = 'Active'
        ${branchFilter}
      ) <= i.reorder_level
    `, branchParams);

    // Expiring in 30 days
    const [expiringResult] = await db.execute(`
      SELECT COUNT(*) as count
      FROM inventory_batches b
      WHERE b.status = 'Active'
      AND b.quantity_available > 0
      AND b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
      AND b.expiry_date >= CURDATE()
      ${branchFilter}
    `, branchParams);

    // Expired items
    const [expiredResult] = await db.execute(`
      SELECT COUNT(*) as count
      FROM inventory_batches b
      WHERE b.status = 'Active'
      AND b.expiry_date < CURDATE()
      AND b.quantity_available > 0
      ${branchFilter}
    `, branchParams);

    // Monthly consumption
    const [consumptionResult] = await db.execute(`
      SELECT SUM(quantity) as total_consumed
      FROM inventory_transactions
      WHERE transaction_type = 'Consumption'
      AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      ${branchFilter.replace('b.branch_id', 'branch_id')}
    `, branchParams);

    // Top consumed items
    const [topConsumed] = await db.execute(`
      SELECT i.item_name, i.item_code, SUM(t.quantity) as total_consumed
      FROM inventory_transactions t
      JOIN inventory_item_master i ON t.item_id = i.id
      WHERE t.transaction_type = 'Consumption'
      AND t.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      ${branchFilter.replace('b.branch_id', 't.branch_id')}
      GROUP BY t.item_id
      ORDER BY total_consumed DESC
      LIMIT 10
    `, branchParams);

    // Stock by category
    const [categoryStock] = await db.execute(`
      SELECT i.category, COUNT(DISTINCT i.id) as item_count, SUM(b.quantity_available) as total_quantity
      FROM inventory_item_master i
      LEFT JOIN inventory_batches b ON i.id = b.item_id AND b.status = 'Active'
      ${branchFilter}
      WHERE i.status = 'Active'
      GROUP BY i.category
    `, branchParams);

    res.json({
      success: true,
      role: role_level || 'Central',
      data: {
        total_value: valueResult[0].total_value || 0,
        low_stock_count: lowStockResult[0].count,
        expiring_30_days: expiringResult[0].count,
        expired_count: expiredResult[0].count,
        monthly_consumption: consumptionResult[0].total_consumed || 0,
        top_consumed_items: topConsumed,
        stock_by_category: categoryStock
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// REAGENT-TEST MAPPING
// ============================================

export const getReagentTestMappings = async (req, res) => {
  try {
    const { test_id, item_id } = req.query;
    let sql = `
      SELECT m.*, i.item_name, i.item_code, i.unit as item_unit,
        t.test_name, t.test_code, lt.name as category_name
      FROM reagent_test_mapping m
      JOIN inventory_item_master i ON m.item_id = i.id
      JOIN lab_tests t ON m.test_id = t.id
      LEFT JOIN lab_categories lt ON t.category_id = lt.id
      WHERE m.status = 'Active'
    `;
    const params = [];

    if (test_id) {
      sql += ' AND m.test_id = ?';
      params.push(test_id);
    }
    if (item_id) {
      sql += ' AND m.item_id = ?';
      params.push(item_id);
    }

    const [mappings] = await db.execute(sql, params);
    res.json({ success: true, data: mappings });
  } catch (error) {
    console.error('Error fetching mappings:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const addReagentTestMapping = async (req, res) => {
  try {
    const { test_id, item_id, quantity_per_test, unit, notes } = req.body;

    const [result] = await db.execute(
      `INSERT INTO reagent_test_mapping (test_id, item_id, quantity_per_test, unit, notes, status)
       VALUES (?, ?, ?, ?, ?, 'Active')`,
      [test_id, item_id, quantity_per_test, unit, notes]
    );

    res.status(201).json({ success: true, message: 'Mapping created successfully', data: { id: result.insertId } });
  } catch (error) {
    console.error('Error adding mapping:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateReagentTestMapping = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity_per_test, unit, notes, status } = req.body;

    await db.execute(
      'UPDATE reagent_test_mapping SET quantity_per_test = ?, unit = ?, notes = ?, status = ? WHERE id = ?',
      [quantity_per_test, unit, notes, status, id]
    );

    res.json({ success: true, message: 'Mapping updated successfully' });
  } catch (error) {
    console.error('Error updating mapping:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const deleteReagentTestMapping = async (req, res) => {
  try {
    const { id } = req.params;
    await db.execute('DELETE FROM reagent_test_mapping WHERE id = ?', [id]);
    res.json({ success: true, message: 'Mapping deleted successfully' });
  } catch (error) {
    console.error('Error deleting mapping:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get reagents needed for a test (for auto-consumption)
export const getTestReagents = async (req, res) => {
  try {
    const { test_id } = req.params;
    
    const [reagents] = await db.execute(`
      SELECT m.*, i.item_name, i.item_code, i.unit as storage_unit
      FROM reagent_test_mapping m
      JOIN inventory_item_master i ON m.item_id = i.id
      WHERE m.test_id = ? AND m.status = 'Active'
    `, [test_id]);

    res.json({ success: true, data: reagents });
  } catch (error) {
    console.error('Error fetching test reagents:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
