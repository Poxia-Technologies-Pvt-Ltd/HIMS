import db from '../config/db.js';

// Facility price lists for lab tests. Central admins manage any facility;
// facility admins only their own. A blank price removes the facility's own
// price, so that test falls back to the state default (lab_tests.price).

const pinned = (req) => (req.user?.role_level !== 'Central' && req.user?.branch_id ? req.user.branch_id : null);

const branchFor = (req) => pinned(req) || Number(req.query.branch_id || req.body?.branch_id) || null;

// GET /api/test-prices?branch_id=
export const listTestPrices = async (req, res) => {
  try {
    const branchId = branchFor(req);
    const [branches] = pinned(req)
      ? await db.query('SELECT id, branch_name FROM branches WHERE id = ?', [branchId])
      : await db.query("SELECT id, branch_name FROM branches WHERE status = 'Active' ORDER BY branch_name");
    if (!branchId) return res.json({ success: true, branches, tests: [] });
    const [tests] = await db.query(
      `SELECT lt.id, lt.test_code, lt.test_name, lc.name AS department, lt.price AS default_price,
              p.price AS facility_price, p.updated_at
         FROM lab_tests lt
         LEFT JOIN lab_categories lc ON lc.id = lt.category_id
         LEFT JOIN lab_test_branch_prices p ON p.test_id = lt.id AND p.branch_id = ? AND p.is_active = 1
        WHERE lt.status = 'Active'
        ORDER BY lc.name, lt.test_name`, [branchId]);
    res.json({ success: true, branch_id: branchId, branches, tests });
  } catch (error) {
    console.error('listTestPrices error:', error);
    res.status(500).json({ success: false, message: 'Server error loading prices' });
  }
};

// PUT /api/test-prices { branch_id, prices: [{ test_id, price }] } — price null/'' clears it.
export const saveTestPrices = async (req, res) => {
  const branchId = branchFor(req);
  const prices = Array.isArray(req.body?.prices) ? req.body.prices : [];
  if (!branchId) return res.status(400).json({ success: false, message: 'Choose a facility.' });
  if (!prices.length) return res.status(400).json({ success: false, message: 'No prices to save.' });
  for (const p of prices) {
    const blank = p.price === null || p.price === '' || p.price === undefined;
    if (!Number(p.test_id) || (!blank && !(Number(p.price) >= 0 && Number(p.price) <= 1000000))) {
      return res.status(400).json({ success: false, message: 'Prices must be amounts between ₹0 and ₹10,00,000.' });
    }
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let set = 0; let cleared = 0;
    for (const p of prices) {
      if (p.price === null || p.price === '' || p.price === undefined) {
        // eslint-disable-next-line no-await-in-loop
        const [r] = await conn.query('DELETE FROM lab_test_branch_prices WHERE branch_id = ? AND test_id = ?', [branchId, p.test_id]);
        cleared += r.affectedRows;
      } else {
        // eslint-disable-next-line no-await-in-loop
        await conn.query(
          `INSERT INTO lab_test_branch_prices (branch_id, test_id, price, is_active, updated_by) VALUES (?, ?, ?, 1, ?)
           ON DUPLICATE KEY UPDATE price = VALUES(price), is_active = 1, updated_by = VALUES(updated_by)`,
          [branchId, p.test_id, Math.round(Number(p.price) * 100) / 100, req.user?.id || null]);
        set += 1;
      }
    }
    await conn.commit();
    res.json({ success: true, message: `Saved ${set} price${set === 1 ? '' : 's'}${cleared ? `, ${cleared} reset to the state default` : ''}.` });
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('saveTestPrices error:', error);
    res.status(500).json({ success: false, message: 'Server error saving prices' });
  } finally {
    conn.release();
  }
};
