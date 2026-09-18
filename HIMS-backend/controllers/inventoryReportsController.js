import db from '../config/db.js';
import PDFDocument from 'pdfkit';

// ============================================
// REPORTS
// ============================================

// Stock Ledger Report
export const getStockLedger = async (req, res) => {
  try {
    const { item_id, start_date, end_date, format = 'json', branch_id } = req.query;

    let sql = `
      SELECT t.*, i.item_name, i.item_code, i.category, i.unit,
        b.batch_number, b.lot_number,
        u.first_name as performed_by_name
      FROM inventory_transactions t
      JOIN inventory_item_master i ON t.item_id = i.id
      LEFT JOIN inventory_batches b ON t.batch_id = b.id
      LEFT JOIN users u ON t.created_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (branch_id) { sql += ' AND t.branch_id = ?'; params.push(branch_id); }
    if (item_id) {
      sql += ' AND t.item_id = ?';
      params.push(item_id);
    }
    if (start_date && end_date) {
      sql += ' AND DATE(t.created_at) BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    sql += ' ORDER BY t.created_at DESC';

    const [transactions] = await db.query(sql, params);

    if (format === 'pdf') {
      return generateStockLedgerPDF(res, transactions, { start_date, end_date, item_id });
    }

    res.json({ success: true, data: transactions });
  } catch (error) {
    console.error('Error generating stock ledger:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Consumption Report
export const getConsumptionReport = async (req, res) => {
  try {
    const { item_id, test_id, start_date, end_date, format = 'json', branch_id } = req.query;

    let sql = `
      SELECT c.*, i.item_name, i.item_code, i.unit, i.category,
        b.batch_number, b.lot_number,
        t.test_name, t.test_code,
        u.first_name as consumed_by_name,
        DATE(c.consumed_at) as consumption_date
      FROM inventory_consumption_logs c
      JOIN inventory_item_master i ON c.item_id = i.id
      LEFT JOIN inventory_batches b ON c.batch_id = b.id
      LEFT JOIN lab_tests t ON c.test_result_id IN (
        SELECT id FROM lab_test_result WHERE test_id = t.id
      )
      LEFT JOIN users u ON c.consumed_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (branch_id) { sql += ' AND c.branch_id = ?'; params.push(branch_id); }
    if (item_id) {
      sql += ' AND c.item_id = ?';
      params.push(item_id);
    }
    if (start_date && end_date) {
      sql += ' AND DATE(c.consumed_at) BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    sql += ' ORDER BY c.consumed_at DESC';

    const [logs] = await db.execute(sql, params);

    // Summary by item
    const [summary] = await db.execute(`
      SELECT i.id, i.item_name, i.item_code, i.unit,
        SUM(c.quantity_consumed) as total_consumed,
        COUNT(DISTINCT c.sample_id) as total_tests
      FROM inventory_consumption_logs c
      JOIN inventory_item_master i ON c.item_id = i.id
      WHERE DATE(c.consumed_at) BETWEEN ? AND ?
      ${item_id ? 'AND c.item_id = ?' : ''}
      GROUP BY i.id
      ORDER BY total_consumed DESC
    `, [start_date, end_date, ...(item_id ? [item_id] : [])]);

    if (format === 'pdf') {
      return generateConsumptionPDF(res, logs, summary, { start_date, end_date });
    }

    res.json({ success: true, data: { details: logs, summary } });
  } catch (error) {
    console.error('Error generating consumption report:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Expiry Report
export const getExpiryReport = async (req, res) => {
  try {
    const { days = 30, category, format = 'json', branch_id } = req.query;

    let sql = `
      SELECT b.*, i.item_name, i.item_code, i.category, i.unit,
        v.vendor_name,
        DATEDIFF(b.expiry_date, CURDATE()) as days_until_expiry,
        CASE
          WHEN b.expiry_date < CURDATE() THEN 'Expired'
          WHEN b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY) THEN 'Expiring Soon'
          ELSE 'Valid'
        END as expiry_status
      FROM inventory_batches b
      JOIN inventory_item_master i ON b.item_id = i.id
      LEFT JOIN vendors v ON b.vendor_id = v.id
      WHERE b.status = 'Active'
      AND b.quantity_available > 0
      AND (b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY) OR b.expiry_date < CURDATE())
    `;
    const params = [days, days];

    if (branch_id) { sql += ' AND b.branch_id = ?'; params.push(branch_id); }
    if (category) {
      sql += ' AND i.category = ?';
      params.push(category);
    }

    sql += ' ORDER BY b.expiry_date ASC';

    const [items] = await db.execute(sql, params);

    // Summary
    const expired = items.filter(i => i.expiry_status === 'Expired');
    const expiringSoon = items.filter(i => i.expiry_status === 'Expiring Soon');

    const summary = {
      total_items: items.length,
      expired_count: expired.length,
      expiring_soon_count: expiringSoon.length,
      total_value: items.reduce((sum, item) => sum + (item.quantity_available * item.unit_cost), 0)
    };

    if (format === 'pdf') {
      return generateExpiryPDF(res, items, summary, { days });
    }

    res.json({ success: true, data: { items, summary } });
  } catch (error) {
    console.error('Error generating expiry report:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Purchase Report
export const getPurchaseReport = async (req, res) => {
  try {
    const { vendor_id, start_date, end_date, format = 'json', branch_id } = req.query;

    let sql = `
      SELECT gr.*, v.vendor_name, v.vendor_code,
        u.first_name as received_by_name,
        (SELECT SUM(quantity_received) FROM goods_receipt_items WHERE grn_id = gr.id) as total_items_received
      FROM goods_receipts gr
      LEFT JOIN vendors v ON gr.vendor_id = v.id
      LEFT JOIN users u ON gr.received_by = u.id
      WHERE gr.status = 'Approved'
    `;
    const params = [];

    if (branch_id) { sql += ' AND gr.branch_id = ?'; params.push(branch_id); }
    if (vendor_id) {
      sql += ' AND gr.vendor_id = ?';
      params.push(vendor_id);
    }
    if (start_date && end_date) {
      sql += ' AND DATE(gr.receipt_date) BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    sql += ' ORDER BY gr.receipt_date DESC';

    const [receipts] = await db.execute(sql, params);

    // Summary by vendor
    const [vendorSummary] = await db.execute(`
      SELECT v.id, v.vendor_name, v.vendor_code,
        COUNT(gr.id) as total_receipts,
        SUM(gr.total_amount) as total_purchase_value
      FROM goods_receipts gr
      JOIN vendors v ON gr.vendor_id = v.id
      WHERE gr.status = 'Approved'
      ${start_date && end_date ? 'AND DATE(gr.receipt_date) BETWEEN ? AND ?' : ''}
      GROUP BY v.id
      ORDER BY total_purchase_value DESC
    `, [...(start_date && end_date ? [start_date, end_date] : [])]);

    // Monthly summary
    const [monthlySummary] = await db.execute(`
      SELECT 
        DATE_FORMAT(gr.receipt_date, '%Y-%m') as month,
        COUNT(*) as receipt_count,
        SUM(gr.total_amount) as total_amount
      FROM goods_receipts gr
      WHERE gr.status = 'Approved'
      ${start_date && end_date ? 'AND DATE(gr.receipt_date) BETWEEN ? AND ?' : ''}
      GROUP BY DATE_FORMAT(gr.receipt_date, '%Y-%m')
      ORDER BY month DESC
    `, [...(start_date && end_date ? [start_date, end_date] : [])]);

    if (format === 'pdf') {
      return generatePurchasePDF(res, receipts, vendorSummary, monthlySummary, { start_date, end_date });
    }

    res.json({ 
      success: true, 
      data: { 
        receipts, 
        vendor_summary: vendorSummary,
        monthly_summary: monthlySummary
      } 
    });
  } catch (error) {
    console.error('Error generating purchase report:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Reagent Usage by Test Report
export const getReagentUsageByTest = async (req, res) => {
  try {
    const { start_date, end_date, format = 'json' } = req.query;
    
    const [usage] = await db.execute(`
      SELECT 
        t.test_name, t.test_code,
        i.item_name, i.item_code, i.unit,
        m.quantity_per_test,
        COUNT(c.id) as total_tests_performed,
        SUM(c.quantity_consumed) as total_quantity_consumed,
        AVG(c.quantity_consumed) as avg_per_test
      FROM inventory_consumption_logs c
      JOIN inventory_item_master i ON c.item_id = i.id
      JOIN reagent_test_mapping m ON c.item_id = m.item_id
      JOIN lab_tests t ON m.test_id = t.id
      WHERE DATE(c.consumed_at) BETWEEN ? AND ?
      GROUP BY t.id, i.id
      ORDER BY t.test_name, total_quantity_consumed DESC
    `, [start_date, end_date]);

    // Summary by test
    const [testSummary] = await db.execute(`
      SELECT 
        t.id, t.test_name, t.test_code,
        COUNT(DISTINCT c.item_id) as reagents_used,
        COUNT(DISTINCT c.sample_id) as tests_performed,
        SUM(c.quantity_consumed * (
          SELECT unit_cost FROM inventory_batches WHERE id = c.batch_id
        )) as total_cost
      FROM inventory_consumption_logs c
      JOIN lab_tests t ON c.test_result_id IN (
        SELECT id FROM lab_test_result WHERE test_id = t.id
      )
      WHERE DATE(c.consumed_at) BETWEEN ? AND ?
      GROUP BY t.id
      ORDER BY tests_performed DESC
    `, [start_date, end_date]);

    if (format === 'pdf') {
      return generateReagentUsagePDF(res, usage, testSummary, { start_date, end_date });
    }

    res.json({ success: true, data: { usage, test_summary: testSummary } });
  } catch (error) {
    console.error('Error generating reagent usage report:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Low Stock Report
export const getLowStockReport = async (req, res) => {
  try {
    const { format = 'json' } = req.query;
    
    const [lowStock] = await db.execute(`
      SELECT i.*, 
        COALESCE(s.current_stock, 0) as current_stock,
        COALESCE(s.available_stock, 0) as available_stock,
        (i.reorder_level - COALESCE(s.available_stock, 0)) as shortage_qty,
        CASE 
          WHEN COALESCE(s.available_stock, 0) = 0 THEN 'Out of Stock'
          WHEN COALESCE(s.available_stock, 0) <= i.min_stock_level THEN 'Critical'
          WHEN COALESCE(s.available_stock, 0) <= i.reorder_level THEN 'Low Stock'
          ELSE 'Normal'
        END as stock_status
      FROM inventory_item_master i
      LEFT JOIN inventory_stock s ON i.id = s.item_id AND s.department_id IS NULL
      WHERE i.status = 'Active'
      AND COALESCE(s.available_stock, 0) <= i.reorder_level
      ORDER BY 
        CASE 
          WHEN COALESCE(s.available_stock, 0) = 0 THEN 1
          WHEN COALESCE(s.available_stock, 0) <= i.min_stock_level THEN 2
          ELSE 3
        END,
        i.category, i.item_name
    `);

    // Summary by status
    const outOfStock = lowStock.filter(i => i.stock_status === 'Out of Stock');
    const critical = lowStock.filter(i => i.stock_status === 'Critical');
    const low = lowStock.filter(i => i.stock_status === 'Low Stock');

    const summary = {
      total_items: lowStock.length,
      out_of_stock: outOfStock.length,
      critical: critical.length,
      low_stock: low.length
    };

    if (format === 'pdf') {
      return generateLowStockPDF(res, lowStock, summary);
    }

    res.json({ success: true, data: { items: lowStock, summary } });
  } catch (error) {
    console.error('Error generating low stock report:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// PDF GENERATORS
// ============================================

function generateStockLedgerPDF(res, data, filters) {
  const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=stock_ledger_${Date.now()}.pdf`);
  
  doc.pipe(res);
  
  // Header
  doc.fontSize(18).text('Stock Ledger Report', 30, 30);
  doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, 30, 55);
  if (filters.start_date && filters.end_date) {
    doc.text(`Period: ${filters.start_date} to ${filters.end_date}`, 30, 70);
  }
  
  // Table
  let y = 100;
  const headers = ['Date', 'Type', 'Item', 'Batch/Lot', 'Qty', 'Dept From', 'Dept To', 'Reference', 'By'];
  const colWidths = [70, 70, 120, 80, 50, 80, 80, 100, 80];
  
  // Header row
  doc.fontSize(8).font('Helvetica-Bold');
  let x = 30;
  headers.forEach((h, i) => {
    doc.text(h, x, y);
    x += colWidths[i];
  });
  
  // Data rows
  doc.font('Helvetica');
  y += 20;
  
  data.forEach((row, idx) => {
    if (y > 500) {
      doc.addPage();
      y = 30;
    }
    
    x = 30;
    const values = [
      new Date(row.created_at).toLocaleDateString(),
      row.type,
      row.item_name,
      `${row.batch_number || '-'}/${row.lot_number || '-'}`,
      row.quantity.toString(),
      row.from_department_name || '-',
      row.to_department_name || '-',
      `${row.reference_type}-${row.reference_id}`,
      row.performed_by_name || '-'
    ];
    
    values.forEach((v, i) => {
      doc.text(v, x, y);
      x += colWidths[i];
    });
    
    y += 15;
  });
  
  doc.end();
}

function generateConsumptionPDF(res, details, summary, filters) {
  const doc = new PDFDocument({ margin: 30 });
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=consumption_report_${Date.now()}.pdf`);
  
  doc.pipe(res);
  
  doc.fontSize(18).text('Reagent Consumption Report', 30, 30);
  doc.fontSize(10).text(`Period: ${filters.start_date} to ${filters.end_date}`, 30, 55);
  
  // Summary
  doc.fontSize(12).text('Summary by Item', 30, 80);
  doc.fontSize(8);
  let y = 100;
  
  summary.forEach((item, idx) => {
    doc.text(`${item.item_name} (${item.item_code}): ${item.total_consumed} ${item.unit} consumed across ${item.total_tests} tests`, 30, y);
    y += 15;
  });
  
  doc.end();
}

function generateExpiryPDF(res, items, summary, filters) {
  const doc = new PDFDocument({ margin: 30 });
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=expiry_report_${Date.now()}.pdf`);
  
  doc.pipe(res);
  
  doc.fontSize(18).text('Expiry Report', 30, 30);
  doc.fontSize(10).text(`Items expiring within ${filters.days} days`, 30, 55);
  
  doc.fontSize(12).text(`Total Items: ${summary.total_items}`, 30, 80);
  doc.text(`Expired: ${summary.expired_count}`, 30, 95);
  doc.text(`Expiring Soon: ${summary.expiring_soon_count}`, 30, 110);
  doc.text(`Total Value at Risk: Rs. ${summary.total_value.toFixed(2)}`, 30, 125);
  
  doc.end();
}

function generatePurchasePDF(res, receipts, vendorSummary, monthlySummary, filters) {
  const doc = new PDFDocument({ margin: 30 });
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=purchase_report_${Date.now()}.pdf`);
  
  doc.pipe(res);
  
  doc.fontSize(18).text('Purchase Report', 30, 30);
  if (filters.start_date && filters.end_date) {
    doc.fontSize(10).text(`Period: ${filters.start_date} to ${filters.end_date}`, 30, 55);
  }
  
  doc.fontSize(12).text('Vendor Summary', 30, 80);
  let y = 100;
  doc.fontSize(8);
  
  vendorSummary.forEach(v => {
    doc.text(`${v.vendor_name}: ${v.total_receipts} receipts, Rs. ${v.total_purchase_value.toFixed(2)}`, 30, y);
    y += 15;
  });
  
  doc.end();
}

function generateReagentUsagePDF(res, usage, testSummary, filters) {
  const doc = new PDFDocument({ margin: 30 });
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=reagent_usage_${Date.now()}.pdf`);
  
  doc.pipe(res);
  
  doc.fontSize(18).text('Reagent Usage by Test Report', 30, 30);
  doc.fontSize(10).text(`Period: ${filters.start_date} to ${filters.end_date}`, 30, 55);
  
  doc.fontSize(12).text('Usage Summary', 30, 80);
  let y = 100;
  doc.fontSize(8);
  
  testSummary.forEach(t => {
    doc.text(`${t.test_name}: ${t.tests_performed} tests, ${t.reagents_used} reagents used`, 30, y);
    y += 15;
  });
  
  doc.end();
}

function generateLowStockPDF(res, items, summary) {
  const doc = new PDFDocument({ margin: 30 });
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=low_stock_${Date.now()}.pdf`);
  
  doc.pipe(res);
  
  doc.fontSize(18).text('Low Stock Report', 30, 30);
  
  doc.fontSize(12).text('Summary', 30, 60);
  doc.text(`Total Low Stock Items: ${summary.total_items}`, 30, 80);
  doc.text(`Out of Stock: ${summary.out_of_stock}`, 30, 95);
  doc.text(`Critical Level: ${summary.critical}`, 30, 110);
  doc.text(`Low Stock: ${summary.low_stock}`, 30, 125);
  
  doc.end();
}
