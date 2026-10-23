// One-off: stamps the reagent lots that were on the analyzer at the time onto
// results saved before lots were captured, using the reagent change log.
// A result can only be filled if the analyzer had a reagent change recorded
// BEFORE it was produced; earlier results genuinely have no lot information
// and are left empty. Safe to re-run. Usage: node scripts/backfillReagentLots.js
import db from '../config/db.js';
import { reagentLotsAt } from '../utils/reagents.js';

const [rows] = await db.query(
  `SELECT r.id, r.machine_no, r.tested_at, r.created_at, m.id AS machine_id
   FROM lab_test_result r JOIN lab_machines m ON m.name = r.machine_no
   WHERE r.reagent_lots IS NULL AND r.machine_no IS NOT NULL`
);
let filled = 0;
for (const r of rows) {
  // Use the moment the result was first recorded (tested_at moves on later edits).
  const at = r.created_at || r.tested_at;
  const lots = await reagentLotsAt(db, r.machine_id, at);
  if (!lots) continue;
  await db.query('UPDATE lab_test_result SET reagent_lots = ? WHERE id = ?', [JSON.stringify(lots), r.id]);
  filled += 1;
}
console.log(`Stamped reagent lots on ${filled} of ${rows.length} results without them (the rest predate any recorded reagent change).`);
process.exit(0);
