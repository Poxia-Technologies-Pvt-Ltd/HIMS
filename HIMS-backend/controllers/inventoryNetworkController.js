import db from '../config/db.js';

// ─── Helper ──────────────────────────────────────────────────────────────────
const baseKpis = async (whereClause = '', params = []) => {
  // Total items in catalog
  const [itemCount] = await db.query(`SELECT COUNT(*) as c FROM inventory_item_master WHERE status='Active'`);

  // Total stock value (global batches)
  const [valueRow] = await db.query(
    `SELECT COALESCE(SUM(b.quantity_available * b.unit_cost), 0) as v 
     FROM inventory_batches b 
     JOIN inventory_item_master im ON b.item_id = im.id
     WHERE b.status='Active'`
  );

  // Low stock items (calculated from batches)
  const [lowRow] = await db.query(
    `SELECT COUNT(*) as c FROM (
      SELECT im.id
      FROM inventory_item_master im
      LEFT JOIN inventory_batches b ON im.id = b.item_id AND b.status = 'Active'
      WHERE im.status='Active'
      GROUP BY im.id, im.reorder_level
      HAVING COALESCE(SUM(b.quantity_available), 0) <= im.reorder_level
    ) as low_stock_items`
  );

  // Expiring within 30 days
  const [expiryRow] = await db.query(
    `SELECT COUNT(*) as c FROM inventory_batches b
     WHERE b.status='Active' AND b.quantity_available > 0
     AND b.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)`
  );

  // Expired batches
  const [expiredRow] = await db.query(
    `SELECT COUNT(*) as c FROM inventory_batches b
     WHERE b.status='Expired' AND b.quantity_available > 0`
  );

  return {
    total_items:  itemCount[0].c,
    total_value:  parseFloat(valueRow[0].v),
    low_stock:    lowRow[0].c,
    expiring_30:  expiryRow[0].c,
    expired:      expiredRow[0].c,
  };
};

// ─── Central ─────────────────────────────────────────────────────────────────
export const getCentralInventoryStats = async (req, res) => {
  try {
    const kpis = await baseKpis();

    // Stock by category
    const [byCategory] = await db.query(`
      SELECT im.category, COUNT(DISTINCT im.id) as item_count,
        COALESCE(SUM(b.quantity_available), 0) as total_qty,
        COALESCE(SUM(b.quantity_available * b.unit_cost), 0) as total_value
      FROM inventory_item_master im
      LEFT JOIN inventory_batches b ON im.id = b.item_id AND b.status = 'Active'
      WHERE im.status = 'Active'
      GROUP BY im.category ORDER BY total_value DESC
    `);

    // Top consumed (last 30 days) - using 'OUT' type
    const [topConsumed] = await db.query(`
      SELECT im.item_name, im.item_code, im.unit, im.category,
        SUM(ABS(t.quantity)) as total_consumed
      FROM inventory_transactions t
      JOIN inventory_item_master im ON t.item_id = im.id
      WHERE t.type = 'OUT'
        AND t.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY t.item_id ORDER BY total_consumed DESC LIMIT 10
    `);

    // Per-branch stock summary (via branches)
    const [perBranch] = await db.query(`
      SELECT br.id, br.branch_name, br.hospital_code as branch_code, br.category as facility_category,
        COUNT(DISTINCT b.item_id) as item_count,
        COALESCE(SUM(b.quantity_available), 0) as total_units,
        COUNT(DISTINCT CASE WHEN b.quantity_available <= im.reorder_level THEN im.id END) as low_stock_items,
        COALESCE(SUM(b.quantity_available * b.unit_cost), 0) as stock_value
      FROM branches br
      LEFT JOIN inventory_batches b ON b.branch_id = br.id AND b.status = 'Active'
      LEFT JOIN inventory_item_master im ON b.item_id = im.id AND im.status = 'Active'
      WHERE br.status = 'Active'
      GROUP BY br.id, br.branch_name, br.hospital_code, br.category ORDER BY br.branch_name
    `);

    // Low stock items list
    const [lowStockList] = await db.query(`
      SELECT im.item_name, im.item_code, im.category, im.unit, im.reorder_level,
        COALESCE(SUM(b.quantity_available), 0) as available_stock
      FROM inventory_item_master im
      LEFT JOIN inventory_batches b ON im.id = b.item_id AND b.status = 'Active'
      WHERE im.status = 'Active'
      GROUP BY im.id, im.item_name, im.item_code, im.category, im.unit, im.reorder_level
      HAVING available_stock <= im.reorder_level
      ORDER BY available_stock ASC LIMIT 15
    `);

    // Recent POs (using actual PO table)
    const [recentPO] = await db.query(`
      SELECT po.po_number, po.created_at as receipt_date, po.total_amount, po.status,
        v.vendor_name
      FROM purchase_orders po
      LEFT JOIN vendors v ON po.vendor_id = v.id
      ORDER BY po.created_at DESC LIMIT 8
    `);

    // 30-day consumption trend
    const [consumptionTrend] = await db.query(`
      SELECT DATE(created_at) as day, SUM(ABS(quantity)) as consumed
      FROM inventory_transactions
      WHERE type = 'OUT'
        AND created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
      GROUP BY DATE(created_at) ORDER BY day ASC
    `);

    res.json({
      success: true, role: 'Central',
      kpis, byCategory, topConsumed, perBranch, lowStockList, recentGrn: recentPO, consumptionTrend
    });
  } catch (err) {
    console.error('Central inventory stats error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── Sub-Central (district-scoped) ───────────────────────────────────────────
export const getSubCentralInventoryStats = async (req, res) => {
  try {
    const { district_id } = req.query;
    const kpis = await baseKpis();

    // Stock by category
    const [byCategory] = await db.query(`
      SELECT im.category, COUNT(DISTINCT im.id) as item_count,
        COALESCE(SUM(b.quantity_available), 0) as total_qty,
        COALESCE(SUM(b.quantity_available * b.unit_cost), 0) as total_value
      FROM inventory_item_master im
      LEFT JOIN inventory_batches b ON im.id = b.item_id AND b.status = 'Active'
      WHERE im.status = 'Active'
      GROUP BY im.category ORDER BY total_value DESC
    `);

    // Top consumed in this district
    const [topConsumed] = await db.query(`
      SELECT im.item_name, im.item_code, im.unit, im.category,
        SUM(ABS(t.quantity)) as total_consumed
      FROM inventory_transactions t
      JOIN inventory_item_master im ON t.item_id = im.id
      JOIN branches br ON t.branch_id = br.id
      WHERE t.type = 'OUT'
        AND br.district_id = ?
        AND t.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY t.item_id ORDER BY total_consumed DESC LIMIT 10
    `, [district_id]);

    // Per-branch stock in district
    const [perBranch] = await db.query(`
      SELECT br.id, br.branch_name, br.hospital_code as branch_code, br.category as facility_category,
        COUNT(DISTINCT b.item_id) as item_count,
        COALESCE(SUM(b.quantity_available), 0) as total_units,
        COUNT(DISTINCT CASE WHEN b.quantity_available <= im.reorder_level THEN im.id END) as low_stock_items
      FROM branches br
      LEFT JOIN inventory_batches b ON b.branch_id = br.id AND b.status = 'Active'
      LEFT JOIN inventory_item_master im ON b.item_id = im.id AND im.status = 'Active'
      WHERE br.status = 'Active' AND br.district_id = ?
      GROUP BY br.id, br.branch_name, br.hospital_code, br.category ORDER BY br.branch_name
    `, [district_id]);

    // Low stock list
    const [lowStockList] = await db.query(`
      SELECT im.item_name, im.item_code, im.category, im.unit, im.reorder_level,
        COALESCE(SUM(b.quantity_available), 0) as available_stock
      FROM inventory_item_master im
      LEFT JOIN inventory_batches b ON im.id = b.item_id AND b.status = 'Active'
      WHERE im.status = 'Active'
      GROUP BY im.id, im.item_name, im.item_code, im.category, im.unit, im.reorder_level
      HAVING available_stock <= im.reorder_level
      ORDER BY available_stock ASC LIMIT 15
    `);

    // Consumption trend
    const [consumptionTrend] = await db.query(`
      SELECT DATE(t.created_at) as day, SUM(ABS(t.quantity)) as consumed
      FROM inventory_transactions t
      WHERE t.type = 'OUT'
        AND t.created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
      GROUP BY DATE(t.created_at) ORDER BY day ASC
    `);

    res.json({
      success: true, role: 'Sub-Central',
      kpis, byCategory, topConsumed, perBranch, lowStockList, consumptionTrend
    });
  } catch (err) {
    console.error('Sub-Central inventory stats error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── Branch/Center ────────────────────────────────────────────────────────────
export const getBranchInventoryStats = async (req, res) => {
  try {
    const { branch_id } = req.query;
    const kpis = await baseKpis();

    // Stock items in this branch
    const [stockItems] = await db.query(`
      SELECT im.item_name, im.item_code, im.category, im.unit,
        im.min_stock_level, im.reorder_level,
        COALESCE(SUM(b.quantity_available), 0) as available_stock,
        COUNT(DISTINCT b.id) as batch_count,
        MIN(b.expiry_date) as nearest_expiry
      FROM inventory_item_master im
      LEFT JOIN inventory_batches b ON b.item_id = im.id AND b.status = 'Active' AND b.branch_id = ?
      WHERE im.status = 'Active'
      GROUP BY im.id, im.item_name, im.item_code, im.category, im.unit, im.min_stock_level, im.reorder_level
      HAVING available_stock > 0
      ORDER BY im.category, im.item_name
    `, [branch_id]);

    // Global stock items (where branch_id IS NULL or specifically for this branch)
    const [globalStock] = await db.query(`
      SELECT im.item_name, im.item_code, im.category, im.unit,
        im.min_stock_level, im.reorder_level,
        COALESCE(SUM(b.quantity_available), 0) as available_stock,
        COUNT(DISTINCT b.id) as batch_count,
        MIN(b.expiry_date) as nearest_expiry
      FROM inventory_item_master im
      LEFT JOIN inventory_batches b ON b.item_id = im.id AND b.status = 'Active'
      WHERE im.status = 'Active'
      GROUP BY im.id, im.item_name, im.item_code, im.category, im.unit, im.min_stock_level, im.reorder_level
      HAVING available_stock > 0
      ORDER BY im.category, im.item_name
    `);

    // Consumption by this branch last 30 days
    const [consumption] = await db.query(`
      SELECT im.item_name, im.item_code, im.unit, SUM(ABS(t.quantity)) as consumed
      FROM inventory_transactions t
      JOIN inventory_item_master im ON t.item_id = im.id
      WHERE t.type = 'OUT' AND t.branch_id = ?
        AND t.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY t.item_id ORDER BY consumed DESC LIMIT 10
    `, [branch_id]);

    // Low stock list
    const [lowStockList] = await db.query(`
      SELECT im.item_name, im.item_code, im.category, im.unit, im.reorder_level,
        COALESCE(SUM(b.quantity_available), 0) as available_stock
      FROM inventory_item_master im
      LEFT JOIN inventory_batches b ON im.id = b.item_id AND b.status = 'Active'
      WHERE im.status = 'Active'
      GROUP BY im.id, im.item_name, im.item_code, im.category, im.unit, im.reorder_level
      HAVING available_stock <= im.reorder_level
      ORDER BY available_stock ASC LIMIT 15
    `);

    // Consumption trend
    const [consumptionTrend] = await db.query(`
      SELECT DATE(created_at) as day, SUM(ABS(quantity)) as consumed
      FROM inventory_transactions
      WHERE type = 'OUT' AND branch_id = ?
        AND created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
      GROUP BY DATE(created_at) ORDER BY day ASC
    `, [branch_id]);

    res.json({
      success: true, role: 'Branch',
      kpis, stockItems: stockItems.length > 0 ? stockItems : globalStock, consumption, lowStockList, consumptionTrend
    });
  } catch (err) {
    console.error('Branch inventory stats error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── Overall Stock List (all roles) ──────────────────────────────────────────
export const getOverallStock = async (req, res) => {
  try {
    const { district_id, branch_id, role_level } = req.query;

    // All items with stock, category, batch info
    const [items] = await db.query(`
      SELECT im.id, im.item_name, im.item_code, im.category, im.unit,
        im.min_stock_level, im.reorder_level,
        COALESCE(SUM(DISTINCT b_sum.total_available), 0) as available_stock,
        COALESCE(SUM(DISTINCT t_sum.total_consumed), 0) as consumed_stock,
        COUNT(DISTINCT b.id) as active_batches,
        MIN(b.expiry_date) as nearest_expiry,
        DATEDIFF(MIN(b.expiry_date), CURDATE()) as days_to_expiry,
        COALESCE(SUM(b.quantity_available * b.unit_cost), 0) as stock_value,
        CASE
          WHEN COALESCE(SUM(DISTINCT b_sum.total_available), 0) = 0 THEN 'Out of Stock'
          WHEN COALESCE(SUM(DISTINCT b_sum.total_available), 0) <= im.min_stock_level THEN 'Critical'
          WHEN COALESCE(SUM(DISTINCT b_sum.total_available), 0) <= im.reorder_level THEN 'Low'
          ELSE 'OK'
        END as stock_status
      FROM inventory_item_master im
      LEFT JOIN inventory_batches b ON im.id = b.item_id AND b.status = 'Active'
      LEFT JOIN (
        SELECT item_id, SUM(quantity_available) as total_available 
        FROM inventory_batches WHERE status = 'Active' GROUP BY item_id
      ) b_sum ON im.id = b_sum.item_id
      LEFT JOIN (
        SELECT item_id, SUM(ABS(quantity)) as total_consumed 
        FROM inventory_transactions WHERE type = 'OUT' GROUP BY item_id
      ) t_sum ON im.id = t_sum.item_id
      WHERE im.status = 'Active'
      GROUP BY im.id, im.item_name, im.item_code, im.category, im.unit, im.min_stock_level, im.reorder_level
      ORDER BY im.category, im.item_name
    `);

    // Per-facility breakdown
    let facilityStock = [];
    if (role_level === 'Central') {
      const [rows] = await db.query(`
        SELECT br.id as branch_id, br.branch_name, br.hospital_code as branch_code, br.category as facility_category,
          im.item_name, im.item_code, im.category, im.unit,
          COALESCE(SUM(b.quantity_available), 0) as available_stock
        FROM branches br
        JOIN inventory_batches b ON b.branch_id = br.id AND b.status = 'Active'
        JOIN inventory_item_master im ON b.item_id = im.id AND im.status = 'Active'
        WHERE br.status = 'Active'
        GROUP BY br.id, im.id ORDER BY br.branch_name, im.category, im.item_name
      `);
      facilityStock = rows;
    } else if (role_level === 'Sub-Central' && district_id) {
      const [rows] = await db.query(`
        SELECT br.id as branch_id, br.branch_name, br.hospital_code as branch_code, br.category as facility_category,
          im.item_name, im.item_code, im.category, im.unit,
          COALESCE(SUM(b.quantity_available), 0) as available_stock
        FROM branches br
        JOIN inventory_batches b ON b.branch_id = br.id AND b.status = 'Active'
        JOIN inventory_item_master im ON b.item_id = im.id AND im.status = 'Active'
        WHERE br.status = 'Active' AND br.district_id = ?
        GROUP BY br.id, im.id ORDER BY br.branch_name, im.category, im.item_name
      `, [district_id]);
      facilityStock = rows;
    }

    res.json({ success: true, items, facilityStock });
  } catch (err) {
    console.error('Overall stock error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
