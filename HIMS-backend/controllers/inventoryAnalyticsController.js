import db from '../config/db.js';

export const getSmartAnalytics = async (req, res) => {
  try {
    const { branch_id } = req.query;
    const branchFilter = branch_id ? 'AND branch_id = ?' : '';
    const branchParam  = branch_id ? [branch_id] : [];

    // 1. Basic KPI metrics
    const [totalValueRes] = await db.query(
      `SELECT SUM(quantity) as total_quantity FROM inventory_batches WHERE status = 'Available' ${branchFilter}`,
      branchParam
    );

    const [lowStockRes] = await db.query(
      `SELECT COUNT(*) as count
       FROM inventory_item_master i
       LEFT JOIN (SELECT item_id, SUM(quantity) as total_qty FROM inventory_batches WHERE status = 'Available' ${branchFilter} GROUP BY item_id) b ON i.id = b.item_id
       WHERE COALESCE(b.total_qty, 0) <= i.reorder_level`,
      branchParam
    );

    const [expiringRes] = await db.query(
      `SELECT COUNT(*) as count FROM inventory_batches WHERE status = 'Available' AND expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) ${branchFilter}`,
      branchParam
    );

    const [expiredRes] = await db.query(
      `SELECT COUNT(*) as count FROM inventory_batches WHERE status = 'Expired' ${branchFilter}`,
      branchParam
    );

    // 2. Weekly Trend
    const [thisWeekRes] = await db.query(
      `SELECT SUM(quantity) as total FROM inventory_transactions WHERE type = 'OUT' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) ${branchFilter}`,
      branchParam
    );
    const [lastWeekRes] = await db.query(
      `SELECT SUM(quantity) as total FROM inventory_transactions WHERE type = 'OUT' AND created_at BETWEEN DATE_SUB(NOW(), INTERVAL 14 DAY) AND DATE_SUB(NOW(), INTERVAL 7 DAY) ${branchFilter}`,
      branchParam
    );

    const thisWeek = parseFloat(thisWeekRes[0].total || 0);
    const lastWeek = parseFloat(lastWeekRes[0].total || 0);
    let trendPercent = 0;
    if (lastWeek > 0) {
      trendPercent = ((thisWeek - lastWeek) / lastWeek) * 100;
    } else if (thisWeek > 0) {
      trendPercent = 100;
    }

    // 3. Top Consumed Items (Last 30 Days)
    const [topConsumed] = await db.query(
      `SELECT i.id, i.item_code, i.item_name, i.category, i.unit, SUM(t.quantity) as total_consumed
       FROM inventory_transactions t
       JOIN inventory_item_master i ON t.item_id = i.id
       WHERE t.type = 'OUT' AND t.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) ${branchFilter ? 'AND t.' + branchFilter.slice(4) : ''}
       GROUP BY i.id, i.item_code, i.item_name, i.category, i.unit
       ORDER BY total_consumed DESC LIMIT 5`,
      branchParam
    );

    // 4. Test-wise Consumption (Last 30 Days)
    const [testConsumption] = await db.query(
      `SELECT t.test_id, lt.test_name, t.item_id, i.item_name, i.unit, SUM(t.quantity) as test_consumed
       FROM inventory_transactions t
       JOIN lab_tests lt ON t.test_id = lt.id
       JOIN inventory_item_master i ON t.item_id = i.id
       WHERE t.type = 'OUT' AND t.test_id IS NOT NULL AND t.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) ${branch_id ? 'AND t.branch_id = ?' : ''}
       GROUP BY t.test_id, lt.test_name, t.item_id, i.item_name, i.unit
       ORDER BY test_consumed DESC`,
      branchParam
    );

    // 5. Total item OUT volume
    const [itemTotals] = await db.query(
      `SELECT item_id, SUM(quantity) as total_out FROM inventory_transactions
       WHERE type = 'OUT' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) ${branch_id ? 'AND branch_id = ?' : ''}
       GROUP BY item_id`,
      branchParam
    );

    // 6. Auto Reorder Prediction
    const [predictionsRes] = await db.query(
      `SELECT
        i.id, i.item_name, i.item_code, i.unit,
        COALESCE(i.lead_time_days, 3) as lead_time_days,
        COALESCE(i.safety_stock_buffer, 20) as safety_stock_buffer,
        COALESCE(b.total_qty, 0) as current_stock,
        COALESCE(t.total_out_30_days, 0) as total_out_30_days,
        (COALESCE(t.total_out_30_days, 0) / 30) as adu
      FROM inventory_item_master i
      LEFT JOIN (
        SELECT item_id, SUM(quantity) as total_qty FROM inventory_batches
        WHERE status = 'Available' ${branch_id ? 'AND branch_id = ?' : ''}
        GROUP BY item_id
      ) b ON i.id = b.item_id
      LEFT JOIN (
        SELECT item_id, SUM(quantity) as total_out_30_days FROM inventory_transactions
        WHERE type = 'OUT' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) ${branch_id ? 'AND branch_id = ?' : ''}
        GROUP BY item_id
      ) t ON i.id = t.item_id`,
      [...branchParam, ...branchParam]
    );

    const reorder_predictions = predictionsRes.map(item => {
      const adu = parseFloat(item.adu);
      const reorderPoint = Math.ceil((adu * item.lead_time_days) + item.safety_stock_buffer);
      const needsReorder = item.current_stock <= reorderPoint;
      const daysUntilStockOut = adu > 0 ? Math.floor(item.current_stock / adu) : 999;
      return { ...item, adu: adu.toFixed(2), reorder_point: reorderPoint, needs_reorder: needsReorder, days_until_stockout: daysUntilStockOut };
    }).filter(item => item.needs_reorder).sort((a, b) => a.days_until_stockout - b.days_until_stockout);

    // Generate Insights
    const insights = [];
    if (trendPercent > 0) insights.push(`Overall inventory consumption increased by ${trendPercent.toFixed(1)}% this week compared to last week.`);
    else if (trendPercent < 0) insights.push(`Overall inventory consumption decreased by ${Math.abs(trendPercent).toFixed(1)}% this week.`);
    if (topConsumed.length > 0) insights.push(`${topConsumed[0].item_name} is the most consumed item in the last 30 days (${topConsumed[0].total_consumed} ${topConsumed[0].unit}).`);
    if (testConsumption.length > 0) {
      const topTest = testConsumption[0];
      const itemTotal = itemTotals.find(it => it.item_id === topTest.item_id)?.total_out || 1;
      insights.push(`The ${topTest.test_name} test accounts for ${((topTest.test_consumed / itemTotal) * 100).toFixed(1)}% of all ${topTest.item_name} usage.`);
    }
    if (reorder_predictions.length > 0 && reorder_predictions[0].days_until_stockout <= 7) {
      const c = reorder_predictions[0];
      insights.push(`URGENT: ${c.item_name} will stock out in ${c.days_until_stockout} days based on its ADU of ${c.adu} units.`);
    }

    // 7. Test Profitability
    const [profitabilityRes] = await db.query(
      `SELECT lt.id, lt.test_name, COALESCE(lt.price, 0) as revenue,
              COALESCE(SUM(itm.quantity_required * i.estimated_cost), 0) as total_cost
       FROM lab_tests lt
       JOIN inventory_test_mapping itm ON lt.id = itm.test_id
       JOIN inventory_item_master i ON itm.item_id = i.id
       GROUP BY lt.id, lt.test_name, lt.price ORDER BY total_cost DESC`
    );

    const test_profitability = profitabilityRes.map(test => {
      const revenue = parseFloat(test.revenue);
      const cost = parseFloat(test.total_cost);
      const profit = revenue - cost;
      return { ...test, profit, margin: revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : '0.0' };
    });

    res.json({
      success: true,
      data: {
        total_value: totalValueRes[0].total_quantity || 0,
        low_stock_count: lowStockRes[0].count || 0,
        expiring_30_days: expiringRes[0].count || 0,
        expired_count: expiredRes[0].count || 0,
        trend: { this_week: thisWeek, last_week: lastWeek, percentage: trendPercent },
        top_consumed_items: topConsumed,
        test_consumption: testConsumption,
        reorder_predictions,
        test_profitability,
        insights
      }
    });
  } catch (error) {
    console.error('Error fetching smart analytics:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
