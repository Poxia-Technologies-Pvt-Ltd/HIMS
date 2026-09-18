/**
 * Auto-mapping for the Care HIMS (CARE) integration's two mapping tables.
 * Mirrors services/cdacAutoMapper.js, sharing its name-similarity logic via
 * utils/nameSimilarity.js. LOINC being a public standard (unlike CDAC's
 * proprietary codes) means care_loinc_test_map/care_loinc_parameter_map ship
 * partially pre-seeded (see scripts/run_care_migration.js), but lab_test_id/
 * lab_test_parameter_id links are still installation-specific and go through
 * the same auto-map/confirm flow as CDAC.
 */
import db from '../config/db.js';
import { bestMatch, SUGGEST_THRESHOLD, AUTO_APPLY_THRESHOLD } from '../utils/nameSimilarity.js';

// ── LOINC test/panel mapping ─────────────────────────────────────────────────

export async function autoMapLoincTests() {
  const [pending] = await db.query(
    `SELECT * FROM care_loinc_test_map WHERE mapping_status IN ('Unmapped', 'Placeholder')`
  );

  const [candidates] = await db.query(
    `SELECT id, test_name, test_code FROM lab_tests
     WHERE status = 'Active' AND test_code NOT LIKE 'CDAC-%' AND test_code NOT LIKE 'LOINC-%' AND test_code NOT LIKE 'EXT-%'`
  );

  const autoMapped = [];
  const suggestions = [];
  const noMatch = [];

  for (const row of pending) {
    const result = candidates.length ? bestMatch(row.loinc_name || '', candidates, (c) => c.test_name) : null;

    if (!result || result.score < SUGGEST_THRESHOLD) {
      noMatch.push({ id: row.id, loinc_code: row.loinc_code, loinc_name: row.loinc_name });
      continue;
    }

    if (result.score >= AUTO_APPLY_THRESHOLD) {
      await db.query(
        `UPDATE care_loinc_test_map SET lab_test_id = ?, mapping_status = 'Mapped', updated_at = NOW() WHERE id = ?`,
        [result.match.id, row.id]
      );
      autoMapped.push({
        id: row.id, loinc_code: row.loinc_code, loinc_name: row.loinc_name,
        matchedTo: result.match.test_name, labTestId: result.match.id, score: result.score,
      });
    } else {
      suggestions.push({
        id: row.id, loinc_code: row.loinc_code, loinc_name: row.loinc_name,
        suggestedLabTestId: result.match.id, suggestedTestName: result.match.test_name, score: result.score,
      });
    }
  }

  return { autoMapped, suggestions, noMatch };
}

export async function confirmLoincTestMapping(id, labTestId) {
  const [[test]] = await db.query(`SELECT id, test_name FROM lab_tests WHERE id = ? LIMIT 1`, [labTestId]);
  if (!test) throw new Error(`lab_tests id ${labTestId} not found`);

  await db.query(
    `UPDATE care_loinc_test_map SET lab_test_id = ?, mapping_status = 'Mapped', updated_at = NOW() WHERE id = ?`,
    [labTestId, id]
  );
  return test;
}

// ── LOINC parameter/component mapping ────────────────────────────────────────
// Flat and global, keyed by (panel loinc_code, parameter_name), same reasoning
// as CDAC's parameter mapping — matching against whatever the analyzer/lab
// actually reported happens at push time in careMapper.buildResultOruPayload
// via findLoincParameterMapping() below.

export async function upsertLoincParameterMapping({
  loincCode, parameterLoincCode, parameterName, uom, notes,
}) {
  await db.query(
    `INSERT INTO care_loinc_parameter_map
       (loinc_code, parameter_loinc_code, parameter_name, uom, mapping_status, notes)
     VALUES (?, ?, ?, ?, 'Mapped', ?)
     ON DUPLICATE KEY UPDATE
       parameter_loinc_code = VALUES(parameter_loinc_code),
       uom = VALUES(uom),
       mapping_status = 'Mapped',
       notes = VALUES(notes),
       updated_at = NOW()`,
    [loincCode, parameterLoincCode || null, parameterName, uom || null, notes || null]
  );
}

/**
 * Bulk import a LOINC parameter list (CSV upload, pasted JSON). Rows for a
 * panel that isn't mapped to a lab_tests row yet are skipped (map the panel
 * first) since there's no loinc_code -> lab_tests link to hang anything off.
 */
export async function bulkImportLoincParameterMap(rows) {
  const result = { mapped: 0, skippedNoTest: 0, errors: [] };

  for (const row of rows) {
    try {
      const loincCode = String(row.loinc_code || '').trim();
      const parameterName = String(row.parameter_name || '').trim();
      const parameterLoincCode = String(row.parameter_loinc_code || '').trim();
      if (!loincCode || !parameterName || !parameterLoincCode) {
        result.errors.push({ row, error: 'missing loinc_code, parameter_name, or parameter_loinc_code' });
        continue;
      }

      const [[testMap]] = await db.query(
        `SELECT 1 FROM care_loinc_test_map WHERE loinc_code = ? AND mapping_status = 'Mapped' LIMIT 1`,
        [loincCode]
      );
      if (!testMap) {
        result.skippedNoTest++;
        continue;
      }

      await upsertLoincParameterMapping({
        loincCode,
        parameterLoincCode,
        parameterName,
        uom: row.uom,
        notes: 'Imported LOINC parameter list',
      });
      result.mapped++;
    } catch (err) {
      result.errors.push({ row, error: err.message });
    }
  }

  return result;
}

/**
 * Given whatever parameter name the lab actually reported
 * (results_json[].parameter_name), find the best-matching LOINC component
 * code for this panel. Returns null if nothing scores high enough to trust.
 */
export async function findLoincParameterMapping(loincCode, parameterName) {
  const [candidates] = await db.query(
    `SELECT * FROM care_loinc_parameter_map WHERE loinc_code = ? AND mapping_status = 'Mapped'`,
    [loincCode]
  );
  if (!candidates.length) return null;

  const result = bestMatch(parameterName, candidates, (c) => c.parameter_name);
  return result && result.score >= SUGGEST_THRESHOLD ? result.match : null;
}
