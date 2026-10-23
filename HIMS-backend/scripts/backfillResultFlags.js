// One-off: applies the flagging rules to results saved before they existed, so
// old results show the same Normal / High / Low / Critical / Invalid / Delta
// markers as new ones. Safe to re-run. Usage: node scripts/backfillResultFlags.js
import db from '../config/db.js';
import { evaluateResults } from '../utils/resultFlags.js';

const [rows] = await db.query(
  `SELECT r.id, r.patient_id, r.test_id, r.results_json, r.tested_at, bi.service_id
   FROM lab_test_result r LEFT JOIN bill_items bi ON bi.id = r.bill_item_id ORDER BY r.id`
);
let done = 0;
for (const r of rows) {
  const list = typeof r.results_json === 'string' ? JSON.parse(r.results_json || '[]') : (r.results_json || []);
  if (!Array.isArray(list) || list.length === 0) continue;
  const ev = await evaluateResults(db, {
    results: list, test_id: r.test_id || r.service_id || null, patient_id: r.patient_id,
    exclude_result_id: r.id, before: r.tested_at,
  });
  await db.query(
    'UPDATE lab_test_result SET results_json = ?, test_id = COALESCE(test_id, ?), has_abnormal = ?, has_critical = ?, has_invalid = ?, has_delta = ? WHERE id = ?',
    [JSON.stringify(ev.results), r.service_id || null, ev.summary.abnormal > 0 ? 1 : 0, ev.summary.critical > 0 ? 1 : 0, ev.summary.invalid > 0 ? 1 : 0, ev.summary.delta > 0 ? 1 : 0, r.id]
  );
  done += 1;
}
console.log(`Re-evaluated ${done} of ${rows.length} results.`);
process.exit(0);
