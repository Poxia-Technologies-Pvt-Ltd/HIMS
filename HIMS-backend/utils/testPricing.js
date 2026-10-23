// Facility price list for lab tests: the facility's own price when it has one
// (lab_test_branch_prices), otherwise the state default (lab_tests.price).
// Bills, the billing screen and the kiosk all price through here.

export async function labPrices(conn, branchId, testIds) {
  const ids = [...new Set((testIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return new Map();
  const [rows] = await conn.query(
    `SELECT lt.id, lt.price AS default_price, p.price AS facility_price
       FROM lab_tests lt
       LEFT JOIN lab_test_branch_prices p ON p.test_id = lt.id AND p.branch_id = ? AND p.is_active = 1
      WHERE lt.id IN (?)`, [branchId || 0, ids]);
  return new Map(rows.map((r) => [r.id, Number(r.facility_price ?? r.default_price ?? 0)]));
}

// Re-prices the Laboratory lines of an order from the facility price list.
// Other lines (consultations, registration fee) are left as sent.
export async function priceLabItems(conn, branchId, items) {
  const prices = await labPrices(conn, branchId, items.filter((i) => i.service_type === 'Laboratory').map((i) => i.service_id));
  return items.map((item) => {
    if (item.service_type !== 'Laboratory' || !prices.has(Number(item.service_id))) return item;
    const unit = prices.get(Number(item.service_id));
    const qty = Number(item.quantity) || 1;
    return { ...item, unit_price: unit, total_price: Math.round(unit * qty * 100) / 100 };
  });
}
