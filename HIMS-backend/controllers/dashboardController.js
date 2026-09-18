import db from '../config/db.js';

// ─── Central Admin Dashboard ──────────────────────────────────────────────────
export const getCentralDashboardStats = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

    // 1. Network counts
    const [networkRows] = await db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN branch_level = 'Central' THEN 1 ELSE 0 END) as central_count,
        SUM(CASE WHEN branch_level = 'Sub-Central' THEN 1 ELSE 0 END) as sub_central_count,
        SUM(CASE WHEN branch_level = 'Center' OR branch_level IS NULL THEN 1 ELSE 0 END) as center_count
      FROM branches WHERE status = 'Active'
    `);
    const network = networkRows[0];

    // 2. Total patients today vs yesterday
    const [patToday] = await db.query(`SELECT COUNT(*) as c FROM patients WHERE DATE(reg_date) = ?`, [today]);
    const [patYest]  = await db.query(`SELECT COUNT(*) as c FROM patients WHERE DATE(reg_date) = ?`, [yesterday]);

    // 3. Total tests done today vs yesterday
    const [testToday] = await db.query(`SELECT COUNT(*) as c FROM lab_test_result WHERE DATE(tested_at) = ?`, [today]);
    const [testYest]  = await db.query(`SELECT COUNT(*) as c FROM lab_test_result WHERE DATE(tested_at) = ?`, [yesterday]);

    // 4. Pending tests
    const [pendingRows] = await db.query(`
      SELECT COUNT(*) as c FROM bill_items 
      WHERE service_type = 'Laboratory' AND status IN ('Pending','Collected','In Progress')
    `);

    // 5. Revenue — today, this month, overall
    const [revToday] = await db.query(`SELECT COALESCE(SUM(total_amount),0) as r FROM bills WHERE DATE(created_at) = ?`, [today]);
    const [revMonth] = await db.query(`SELECT COALESCE(SUM(total_amount),0) as r FROM bills WHERE DATE(created_at) >= ?`, [monthStart]);
    const [revTotal] = await db.query(`SELECT COALESCE(SUM(total_amount),0) as r FROM bills`);

    // 6. Per-branch lab stats
    const [perBranch] = await db.query(`
      SELECT 
        br.id, br.branch_name, br.hospital_code, br.branch_level,
        COUNT(DISTINCT CASE WHEN DATE(b.created_at) = ? THEN b.patient_id END) as today_patients,
        COUNT(DISTINCT CASE WHEN DATE(ltr.tested_at) = ? THEN ltr.id END) as today_tests,
        COUNT(DISTINCT CASE WHEN bi.service_type = 'Laboratory' AND bi.status IN ('Pending','Collected','In Progress') THEN bi.id END) as pending_tests,
        COALESCE(SUM(CASE WHEN DATE(b.created_at) = ? THEN b.total_amount ELSE 0 END), 0) as today_revenue
      FROM branches br
      LEFT JOIN bills b ON b.branch_id = br.id
      LEFT JOIN bill_items bi ON bi.bill_id = b.id AND bi.service_type = 'Laboratory'
      LEFT JOIN lab_test_result ltr ON ltr.bill_item_id = bi.id
      WHERE br.status = 'Active'
      GROUP BY br.id, br.branch_name, br.hospital_code, br.branch_level
      ORDER BY today_tests DESC
    `, [today, today, today]);

    // 7. Test category breakdown — use bill_items directly (captures all ordered tests)
    const [testBreakdown] = await db.query(`
      SELECT 
        COALESCE(lc.name, 'Uncategorized') as category,
        COUNT(*) as count
      FROM bill_items bi
      JOIN lab_tests lt ON bi.service_id = lt.id
      LEFT JOIN lab_categories lc ON lt.category_id = lc.id
      WHERE bi.service_type = 'Laboratory'
      GROUP BY lc.name
      ORDER BY count DESC
      LIMIT 10
    `);

    // 8. 7-day tests trend
    const [trend7] = await db.query(`
      SELECT 
        DATE(tested_at) as day,
        COUNT(*) as tests
      FROM lab_test_result
      WHERE tested_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(tested_at)
      ORDER BY day ASC
    `);

    // 9. Revenue 7-day trend
    const [revTrend] = await db.query(`
      SELECT 
        DATE(created_at) as day,
        COALESCE(SUM(total_amount), 0) as revenue
      FROM bills
      WHERE DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `);

    // 10. Recent activity
    const [recentAct] = await db.query(`
      SELECT 
        ltr.test_name, ltr.status,
        ltr.tested_at, ltr.verified_at,
        CONCAT(p.first_name,' ',p.last_name) as patient_name,
        p.reg_no, br.branch_name
      FROM lab_test_result ltr
      JOIN bill_items bi ON ltr.bill_item_id = bi.id
      JOIN bills b ON bi.bill_id = b.id
      JOIN patients p ON b.patient_id = p.id
      LEFT JOIN branches br ON b.branch_id = br.id
      ORDER BY ltr.updated_at DESC
      LIMIT 12
    `);

    const pctChange = (a, b) => b > 0 ? Math.round(((a - b) / b) * 100) : 0;

    res.json({
      success: true,
      network: {
        total: network.total,
        central: network.central_count,
        subCentral: network.sub_central_count,
        centers: network.center_count
      },
      kpis: {
        patients:  { today: patToday[0].c,   change: pctChange(patToday[0].c, patYest[0].c) },
        tests:     { today: testToday[0].c,  change: pctChange(testToday[0].c, testYest[0].c) },
        pending:   { value: pendingRows[0].c },
        revenue: {
          today: parseFloat(revToday[0].r),
          month: parseFloat(revMonth[0].r),
          total: parseFloat(revTotal[0].r)
        }
      },
      perBranch,
      testBreakdown,
      trend: { tests: trend7, revenue: revTrend },
      activity: recentAct.map(r => ({
        label: `${r.test_name} — ${r.patient_name}`,
        branch: r.branch_name,
        status: r.status,
        time: formatTimeAgo(new Date(r.verified_at || r.tested_at))
      }))
    });

  } catch (err) {
    console.error('Central dashboard error:', err);
    res.status(500).json({ success: false, message: 'Error fetching central dashboard stats' });
  }
};

// Get dashboard statistics
// ─── Sub-Central Dashboard ────────────────────────────────────────────────────
export const getSubCentralDashboardStats = async (req, res) => {
  try {
    const { district_id } = req.query;
    const today      = new Date().toISOString().split('T')[0];
    const yesterday  = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

    // Centers in this district
    const [centersRow] = await db.query(
      `SELECT COUNT(*) as c FROM branches WHERE district_id = ? AND status = 'Active'`, [district_id]
    );

    // KPIs scoped to this district
    const [patToday] = await db.query(
      `SELECT COUNT(*) as c FROM patients p JOIN bills b ON b.patient_id = p.id JOIN branches br ON b.branch_id = br.id WHERE br.district_id = ? AND DATE(p.reg_date) = ?`, [district_id, today]
    );
    const [patYest] = await db.query(
      `SELECT COUNT(*) as c FROM patients p JOIN bills b ON b.patient_id = p.id JOIN branches br ON b.branch_id = br.id WHERE br.district_id = ? AND DATE(p.reg_date) = ?`, [district_id, yesterday]
    );
    const [testToday] = await db.query(
      `SELECT COUNT(*) as c FROM lab_test_result ltr JOIN bill_items bi ON ltr.bill_item_id = bi.id JOIN bills b ON bi.bill_id = b.id JOIN branches br ON b.branch_id = br.id WHERE br.district_id = ? AND DATE(ltr.tested_at) = ?`, [district_id, today]
    );
    const [testYest] = await db.query(
      `SELECT COUNT(*) as c FROM lab_test_result ltr JOIN bill_items bi ON ltr.bill_item_id = bi.id JOIN bills b ON bi.bill_id = b.id JOIN branches br ON b.branch_id = br.id WHERE br.district_id = ? AND DATE(ltr.tested_at) = ?`, [district_id, yesterday]
    );
    const [pendingRow] = await db.query(
      `SELECT COUNT(*) as c FROM bill_items bi JOIN bills b ON bi.bill_id = b.id JOIN branches br ON b.branch_id = br.id WHERE br.district_id = ? AND bi.service_type = 'Laboratory' AND bi.status IN ('Pending','Collected','In Progress')`, [district_id]
    );
    const [revToday] = await db.query(
      `SELECT COALESCE(SUM(b.total_amount),0) as r FROM bills b JOIN branches br ON b.branch_id = br.id WHERE br.district_id = ? AND DATE(b.created_at) = ?`, [district_id, today]
    );
    const [revMonth] = await db.query(
      `SELECT COALESCE(SUM(b.total_amount),0) as r FROM bills b JOIN branches br ON b.branch_id = br.id WHERE br.district_id = ? AND DATE(b.created_at) >= ?`, [district_id, monthStart]
    );
    const [revTotal] = await db.query(
      `SELECT COALESCE(SUM(b.total_amount),0) as r FROM bills b JOIN branches br ON b.branch_id = br.id WHERE br.district_id = ?`, [district_id]
    );

    // Per-center breakdown
    const [perBranch] = await db.query(`
      SELECT br.id, br.branch_name, br.hospital_code, br.branch_level,
        COUNT(DISTINCT CASE WHEN DATE(b.created_at) = ? THEN b.patient_id END) as today_patients,
        COUNT(DISTINCT CASE WHEN DATE(ltr.tested_at) = ? THEN ltr.id END) as today_tests,
        COUNT(DISTINCT CASE WHEN bi.service_type = 'Laboratory' AND bi.status IN ('Pending','Collected','In Progress') THEN bi.id END) as pending_tests,
        COALESCE(SUM(CASE WHEN DATE(b.created_at) = ? THEN b.total_amount ELSE 0 END),0) as today_revenue
      FROM branches br
      LEFT JOIN bills b ON b.branch_id = br.id
      LEFT JOIN bill_items bi ON bi.bill_id = b.id AND bi.service_type = 'Laboratory'
      LEFT JOIN lab_test_result ltr ON ltr.bill_item_id = bi.id
      WHERE br.district_id = ? AND br.status = 'Active'
      GROUP BY br.id ORDER BY today_tests DESC
    `, [today, today, today, district_id]);

    // Test category breakdown — use bill_items (captures all ordered tests)
    const [testBreakdown] = await db.query(`
      SELECT COALESCE(lc.name,'Uncategorized') as category, COUNT(*) as count
      FROM bill_items bi
      JOIN bills b ON bi.bill_id = b.id
      JOIN branches br ON b.branch_id = br.id
      JOIN lab_tests lt ON bi.service_id = lt.id
      LEFT JOIN lab_categories lc ON lt.category_id = lc.id
      WHERE bi.service_type = 'Laboratory' AND br.district_id = ?
      GROUP BY lc.name ORDER BY count DESC LIMIT 10
    `, [district_id]);

    // 7-day trend
    const [trend7] = await db.query(`
      SELECT DATE(ltr.tested_at) as day, COUNT(*) as tests
      FROM lab_test_result ltr
      JOIN bill_items bi ON ltr.bill_item_id = bi.id
      JOIN bills b ON bi.bill_id = b.id
      JOIN branches br ON b.branch_id = br.id
      WHERE br.district_id = ? AND ltr.tested_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(ltr.tested_at) ORDER BY day ASC
    `, [district_id]);

    const [revTrend] = await db.query(`
      SELECT DATE(b.created_at) as day, COALESCE(SUM(b.total_amount),0) as revenue
      FROM bills b JOIN branches br ON b.branch_id = br.id
      WHERE br.district_id = ? AND DATE(b.created_at) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(b.created_at) ORDER BY day ASC
    `, [district_id]);

    // Activity
    const [recentAct] = await db.query(`
      SELECT ltr.test_name, ltr.status, ltr.tested_at, ltr.verified_at,
        CONCAT(p.first_name,' ',p.last_name) as patient_name, p.reg_no, br.branch_name
      FROM lab_test_result ltr
      JOIN bill_items bi ON ltr.bill_item_id = bi.id
      JOIN bills b ON bi.bill_id = b.id
      JOIN patients p ON b.patient_id = p.id
      JOIN branches br ON b.branch_id = br.id
      WHERE br.district_id = ?
      ORDER BY ltr.updated_at DESC LIMIT 12
    `, [district_id]);

    const pct = (a, b) => b > 0 ? Math.round(((a - b) / b) * 100) : 0;

    res.json({
      success: true,
      network: { total: centersRow[0].c, centers: centersRow[0].c },
      kpis: {
        patients: { today: patToday[0].c, change: pct(patToday[0].c, patYest[0].c) },
        tests:    { today: testToday[0].c, change: pct(testToday[0].c, testYest[0].c) },
        pending:  { value: pendingRow[0].c },
        revenue:  { today: parseFloat(revToday[0].r), month: parseFloat(revMonth[0].r), total: parseFloat(revTotal[0].r) }
      },
      perBranch,
      testBreakdown,
      trend: { tests: trend7, revenue: revTrend },
      activity: recentAct.map(r => ({
        label: `${r.test_name} — ${r.patient_name}`,
        branch: r.branch_name,
        status: r.status,
        time: formatTimeAgo(new Date(r.verified_at || r.tested_at))
      }))
    });
  } catch (err) {
    console.error('Sub-central dashboard error:', err);
    res.status(500).json({ success: false, message: 'Error fetching sub-central dashboard' });
  }
};

// ─── Branch / Center Dashboard ───────────────────────────────────────────────
export const getBranchDashboardStats = async (req, res) => {
  try {
    const { branch_id } = req.query;
    const today      = new Date().toISOString().split('T')[0];
    const yesterday  = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

    const [patToday]  = await db.query(`SELECT COUNT(*) as c FROM patients WHERE branch_id = ? AND DATE(reg_date) = ?`, [branch_id, today]);
    const [patYest]   = await db.query(`SELECT COUNT(*) as c FROM patients WHERE branch_id = ? AND DATE(reg_date) = ?`, [branch_id, yesterday]);
    const [testToday] = await db.query(`SELECT COUNT(*) as c FROM lab_test_result ltr JOIN bill_items bi ON ltr.bill_item_id = bi.id JOIN bills b ON bi.bill_id = b.id WHERE b.branch_id = ? AND DATE(ltr.tested_at) = ?`, [branch_id, today]);
    const [testYest]  = await db.query(`SELECT COUNT(*) as c FROM lab_test_result ltr JOIN bill_items bi ON ltr.bill_item_id = bi.id JOIN bills b ON bi.bill_id = b.id WHERE b.branch_id = ? AND DATE(ltr.tested_at) = ?`, [branch_id, yesterday]);
    const [pendingRow]= await db.query(`SELECT COUNT(*) as c FROM bill_items bi JOIN bills b ON bi.bill_id = b.id WHERE b.branch_id = ? AND bi.service_type='Laboratory' AND bi.status IN ('Pending','Collected','In Progress')`, [branch_id]);
    const [revToday]  = await db.query(`SELECT COALESCE(SUM(total_amount),0) as r FROM bills WHERE branch_id = ? AND DATE(created_at) = ?`, [branch_id, today]);
    const [revMonth]  = await db.query(`SELECT COALESCE(SUM(total_amount),0) as r FROM bills WHERE branch_id = ? AND DATE(created_at) >= ?`, [branch_id, monthStart]);
    const [revTotal]  = await db.query(`SELECT COALESCE(SUM(total_amount),0) as r FROM bills WHERE branch_id = ?`, [branch_id]);

    // Branch info
    const [branchInfo] = await db.query(`SELECT branch_name, hospital_code, branch_level, district_id FROM branches WHERE id = ?`, [branch_id]);

    // Test category breakdown — use bill_items (captures all ordered tests)
    const [testBreakdown] = await db.query(`
      SELECT COALESCE(lc.name,'Uncategorized') as category, COUNT(*) as count
      FROM bill_items bi
      JOIN bills b ON bi.bill_id = b.id
      JOIN lab_tests lt ON bi.service_id = lt.id
      LEFT JOIN lab_categories lc ON lt.category_id = lc.id
      WHERE bi.service_type = 'Laboratory' AND b.branch_id = ?
      GROUP BY lc.name ORDER BY count DESC LIMIT 10
    `, [branch_id]);

    // Top tests by volume — use bill_items directly
    const [topTests] = await db.query(`
      SELECT lt.test_name, COUNT(*) as count
      FROM bill_items bi
      JOIN bills b ON bi.bill_id = b.id
      JOIN lab_tests lt ON bi.service_id = lt.id
      WHERE bi.service_type = 'Laboratory' AND b.branch_id = ?
      GROUP BY lt.test_name ORDER BY count DESC LIMIT 8
    `, [branch_id]);

    // 7-day trend
    const [trend7] = await db.query(`
      SELECT DATE(ltr.tested_at) as day, COUNT(*) as tests
      FROM lab_test_result ltr
      JOIN bill_items bi ON ltr.bill_item_id = bi.id
      JOIN bills b ON bi.bill_id = b.id
      WHERE b.branch_id = ? AND ltr.tested_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(ltr.tested_at) ORDER BY day ASC
    `, [branch_id]);

    const [revTrend] = await db.query(`
      SELECT DATE(created_at) as day, COALESCE(SUM(total_amount),0) as revenue
      FROM bills WHERE branch_id = ? AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(created_at) ORDER BY day ASC
    `, [branch_id]);

    // Recent activity
    const [recentAct] = await db.query(`
      SELECT ltr.test_name, ltr.status, ltr.tested_at, ltr.verified_at,
        CONCAT(p.first_name,' ',p.last_name) as patient_name, p.reg_no
      FROM lab_test_result ltr
      JOIN bill_items bi ON ltr.bill_item_id = bi.id
      JOIN bills b ON bi.bill_id = b.id
      JOIN patients p ON b.patient_id = p.id
      WHERE b.branch_id = ?
      ORDER BY ltr.updated_at DESC LIMIT 15
    `, [branch_id]);

    const pct = (a, b) => b > 0 ? Math.round(((a - b) / b) * 100) : 0;

    res.json({
      success: true,
      branch: branchInfo[0] || {},
      kpis: {
        patients: { today: patToday[0].c,  change: pct(patToday[0].c,  patYest[0].c) },
        tests:    { today: testToday[0].c, change: pct(testToday[0].c, testYest[0].c) },
        pending:  { value: pendingRow[0].c },
        revenue:  { today: parseFloat(revToday[0].r), month: parseFloat(revMonth[0].r), total: parseFloat(revTotal[0].r) }
      },
      testBreakdown,
      topTests,
      trend: { tests: trend7, revenue: revTrend },
      activity: recentAct.map(r => ({
        label: `${r.test_name} — ${r.patient_name}`,
        branch: null,
        status: r.status,
        time: formatTimeAgo(new Date(r.verified_at || r.tested_at))
      }))
    });
  } catch (err) {
    console.error('Branch dashboard error:', err);
    res.status(500).json({ success: false, message: 'Error fetching branch dashboard' });
  }
};

// Get dashboard statistics (legacy)
export const getDashboardStats = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Total tests (all time)
    const [totalTestsResult] = await db.query(
      'SELECT COUNT(*) as count FROM lab_test_result'
    );
    const totalTests = totalTestsResult[0].count;

    // Today's tests
    const [todayTestsResult] = await db.query(
      `SELECT COUNT(*) as count FROM lab_test_result WHERE DATE(tested_at) = ?`,
      [today]
    );
    const todayTests = todayTestsResult[0].count;

    // Yesterday's tests (for comparison)
    const [yesterdayTestsResult] = await db.query(
      `SELECT COUNT(*) as count FROM lab_test_result WHERE DATE(tested_at) = ?`,
      [yesterday]
    );
    const yesterdayTests = yesterdayTestsResult[0].count;
    const testsChange = yesterdayTests > 0
      ? Math.round(((todayTests - yesterdayTests) / yesterdayTests) * 100)
      : 0;

    // Today's patients
    const [todayPatientsResult] = await db.query(
      `SELECT COUNT(*) as count FROM patients WHERE DATE(reg_date) = ?`,
      [today]
    );
    const todayPatients = todayPatientsResult[0].count;

    // Yesterday's patients
    const [yesterdayPatientsResult] = await db.query(
      `SELECT COUNT(*) as count FROM patients WHERE DATE(reg_date) = ?`,
      [yesterday]
    );
    const yesterdayPatients = yesterdayPatientsResult[0].count;
    const patientsChange = yesterdayPatients > 0
      ? Math.round(((todayPatients - yesterdayPatients) / yesterdayPatients) * 100)
      : 0;

    // Pending reports (Pending or Test Done status)
    const [pendingResult] = await db.query(
      `SELECT COUNT(*) as count FROM lab_test_result WHERE status IN ('Pending', 'Test Done')`
    );
    const pendingReports = pendingResult[0].count;

    // Pending from yesterday (for trend)
    const [yesterdayPendingResult] = await db.query(
      `SELECT COUNT(*) as count FROM lab_test_result 
       WHERE status IN ('Pending', 'Test Done') AND DATE(created_at) <= ?`,
      [yesterday]
    );
    const yesterdayPending = yesterdayPendingResult[0].count;
    const pendingChange = yesterdayPending > 0
      ? Math.round(((pendingReports - yesterdayPending) / yesterdayPending) * 100)
      : 0;

    // Today's revenue
    const [revenueResult] = await db.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM bills WHERE DATE(bill_date) = ?`,
      [today]
    );
    const todayRevenue = parseFloat(revenueResult[0].total);

    // Yesterday's revenue
    const [yesterdayRevenueResult] = await db.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM bills WHERE DATE(bill_date) = ?`,
      [yesterday]
    );
    const yesterdayRevenue = parseFloat(yesterdayRevenueResult[0].total);
    const revenueChange = yesterdayRevenue > 0
      ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100)
      : 0;

    // Recent activity (last 10 events)
    const [recentTests] = await db.query(
      `SELECT 
        tr.sample_id,
        tr.test_name,
        tr.status,
        tr.verified_at,
        tr.tested_at,
        CONCAT(p.first_name, ' ', p.last_name) as patient_name,
        p.reg_no
      FROM lab_test_result tr
      JOIN bill_items bi ON tr.bill_item_id = bi.id
      JOIN bills b ON bi.bill_id = b.id
      JOIN patients p ON b.patient_id = p.id
      ORDER BY tr.updated_at DESC
      LIMIT 10`
    );

    const activity = recentTests.map(test => {
      const time = test.verified_at || test.tested_at;
      let label = '';
      let dotColor = '';
      let bgColor = '';

      if (test.status === 'Approved') {
        label = `${test.test_name} result ready — Patient #${test.reg_no}`;
        dotColor = '#2E9E6B';
        bgColor = '#E6F7F1';
      } else if (test.status === 'Test Done') {
        label = `${test.test_name} tested — ${test.patient_name}`;
        dotColor = '#1A4B9C';
        bgColor = '#EBF4FF';
      } else {
        label = `${test.test_name} pending — Patient #${test.reg_no}`;
        dotColor = '#F59E0B';
        bgColor = '#FEF3C7';
      }

      return {
        label,
        time: time ? formatTimeAgo(new Date(time)) : 'Just now',
        dotColor,
        bgColor
      };
    });

    res.json({
      success: true,
      stats: {
        totalTests: {
          value: totalTests,
          today: todayTests,
          change: testsChange,
          positive: testsChange >= 0
        },
        todayPatients: {
          value: todayPatients,
          change: patientsChange,
          positive: patientsChange >= 0
        },
        pendingReports: {
          value: pendingReports,
          change: pendingChange,
          positive: pendingChange <= 0 // Lower pending is positive
        },
        revenue: {
          value: todayRevenue,
          change: revenueChange,
          positive: revenueChange >= 0
        }
      },
      activity
    });

  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard statistics'
    });
  }
};

// Helper function to format time ago
function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hr ago`;
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays} days ago`;
}
