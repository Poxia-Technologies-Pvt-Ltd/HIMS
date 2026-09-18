/**
 * Auto-mapping for the CDAC integration's two mapping tables.
 *
 * Test codes (cdac_test_code_map -> lab_tests): CDAC's API 7 gives us
 * hmis_test_name, so we can genuinely name-match against our own catalog.
 * Exact normalized matches auto-apply; near-matches are returned as
 * suggestions for one-click human confirmation rather than applied silently
 * (a wrong auto-map here means a lab result gets filed against the wrong
 * test, which is not a place to guess).
 *
 * Parameter codes (cdac_parameter_map): CDAC does not expose a
 * parameter-code list through any documented endpoint (confirmed in
 * Meril_CDAC_LIS_Integration_API_Docs.md / cdac-integration.md — this is an
 * open item directed at CDAC, not something we can query for). There is
 * nothing to auto-match against until CDAC supplies that data out of band
 * (typically a spreadsheet at onboarding). bulkImportParameterMap is the
 * "auto-map" for that case: feed it CDAC's list once you have it, and it
 * name-matches each row against our lab_test_parameters automatically.
 */
import db from '../config/db.js';
import { bestMatch, AUTO_APPLY_THRESHOLD, SUGGEST_THRESHOLD } from '../utils/nameSimilarity.js';

// ── Test-code mapping ────────────────────────────────────────────────────────
// Global, not per-hospital: lab_tests has no branch_id at all (one shared
// catalog), and CDAC's test codes are presumably a national registry, not
// hospital-specific — so a mapping confirmed by any one branch's sync
// applies to every other branch too. See run_cdac_global_mapping_migration.js.

export async function autoMapTestCodes() {
  const [pending] = await db.query(
    `SELECT * FROM cdac_test_code_map WHERE mapping_status IN ('Unmapped', 'Placeholder')`
  );

  const [candidates] = await db.query(
    `SELECT id, test_name, test_code FROM lab_tests
     WHERE status = 'Active' AND test_code NOT LIKE 'CDAC-%' AND test_code NOT LIKE 'EXT-%'`
  );

  const autoMapped = [];
  const suggestions = [];
  const noMatch = [];

  for (const row of pending) {
    const result = candidates.length ? bestMatch(row.hmis_test_name || '', candidates, (c) => c.test_name) : null;

    if (!result || result.score < SUGGEST_THRESHOLD) {
      noMatch.push({ id: row.id, hmis_test_code: row.hmis_test_code, hmis_test_name: row.hmis_test_name });
      continue;
    }

    if (result.score >= AUTO_APPLY_THRESHOLD) {
      await db.query(
        `UPDATE cdac_test_code_map SET lab_test_id = ?, mapping_status = 'Mapped', updated_at = NOW() WHERE id = ?`,
        [result.match.id, row.id]
      );
      autoMapped.push({
        id: row.id, hmis_test_code: row.hmis_test_code, hmis_test_name: row.hmis_test_name,
        matchedTo: result.match.test_name, labTestId: result.match.id, score: result.score,
      });
    } else {
      suggestions.push({
        id: row.id, hmis_test_code: row.hmis_test_code, hmis_test_name: row.hmis_test_name,
        suggestedLabTestId: result.match.id, suggestedTestName: result.match.test_name, score: result.score,
      });
    }
  }

  return { autoMapped, suggestions, noMatch };
}

export async function confirmTestMapping(id, labTestId) {
  const [[test]] = await db.query(`SELECT id, test_name FROM lab_tests WHERE id = ? LIMIT 1`, [labTestId]);
  if (!test) throw new Error(`lab_tests id ${labTestId} not found`);

  await db.query(
    `UPDATE cdac_test_code_map SET lab_test_id = ?, mapping_status = 'Mapped', updated_at = NOW() WHERE id = ?`,
    [labTestId, id]
  );
  return test;
}

// ── Parameter-code mapping ───────────────────────────────────────────────────
//
// Deliberately flat and global: (CDAC test code, parameter name) -> CDAC's
// parameter/parent/UOM codes, same reasoning as the test-code mapping above —
// map "WBC" once and it applies to every branch, not just whichever one
// happened to enter it. No dependency on lab_test_parameters either — an
// order can say "CBC" while the lab only actually runs Platelet off a POCT
// analyzer for that particular sample, and that alone should be pushable.
// This table is just CDAC's own parameter list, stored as given; matching
// against whatever the analyzer actually reported happens at push time in
// cdacMapper.buildResultRowDataPayload, via findParameterMapping() below.
// hmis_hosp_mapping_code is still recorded per row (which branch's pull first
// produced it) but is purely informational, not part of the lookup key.

export async function upsertParameterMapping({
  hospMappingCode, hmisTestCode, hmisLabCode, hmisSampleCode, parameterName,
  hmisParameterCode, hmisParentParameterCode, hmisStrUom, notes,
}) {
  await db.query(
    `INSERT INTO cdac_parameter_map
       (hmis_hosp_mapping_code, hmis_lab_code, hmis_test_code, hmis_sample_code, parameter_name,
        hmis_parameter_code, hmis_parent_parameter_code, hmis_str_uom, mapping_status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Mapped', ?)
     ON DUPLICATE KEY UPDATE
       hmis_lab_code = VALUES(hmis_lab_code),
       hmis_sample_code = VALUES(hmis_sample_code),
       hmis_parameter_code = VALUES(hmis_parameter_code),
       hmis_parent_parameter_code = VALUES(hmis_parent_parameter_code),
       hmis_str_uom = VALUES(hmis_str_uom),
       mapping_status = 'Mapped',
       notes = VALUES(notes),
       updated_at = NOW()`,
    [
      hospMappingCode, hmisLabCode || null, hmisTestCode, hmisSampleCode || null, parameterName,
      hmisParameterCode || null, hmisParentParameterCode || null, hmisStrUom || null, notes || null,
    ]
  );
}

/**
 * Bulk import CDAC's parameter-code master list (CSV upload, pasted JSON).
 * No matching happens here — this is just CDAC's own list, stored as given,
 * keyed by (test code, parameter name). Rows for a test that isn't mapped
 * yet are skipped (map the test first in the Test Mapping tab) since there's
 * no hmis_test_code -> lab_tests link to hang anything off otherwise.
 */
export async function bulkImportParameterMap(rows, hospMappingCode) {
  const result = { mapped: 0, skippedNoTest: 0, errors: [] };

  for (const row of rows) {
    try {
      const testCode = String(row.hmis_test_code || '').trim();
      const parameterName = String(row.parameter_name || '').trim();
      if (!testCode || !parameterName) {
        result.errors.push({ row, error: 'missing hmis_test_code or parameter_name' });
        continue;
      }

      const [[testMap]] = await db.query(
        `SELECT 1 FROM cdac_test_code_map WHERE hmis_test_code = ? AND mapping_status = 'Mapped' LIMIT 1`,
        [testCode]
      );
      if (!testMap) {
        result.skippedNoTest++;
        continue;
      }

      await upsertParameterMapping({
        hospMappingCode,
        hmisTestCode: testCode,
        hmisLabCode: row.hmis_lab_code,
        hmisSampleCode: row.hmis_sample_code,
        parameterName,
        hmisParameterCode: row.hmis_parameter_code,
        hmisParentParameterCode: row.hmis_parent_parameter_code,
        hmisStrUom: row.hmis_str_uom,
        notes: 'Imported from CDAC parameter list',
      });
      result.mapped++;
    } catch (err) {
      result.errors.push({ row, error: err.message });
    }
  }

  return result;
}

/**
 * Given whatever parameter name an analyzer/lab actually reported for a
 * result (results_json[].parameter_name), find the best-matching CDAC
 * parameter code for this test — independent of any pre-configured
 * parameter catalog, and independent of which branch is pushing (global
 * mapping — see the file-level comment above). Returns null if nothing
 * scores high enough to trust.
 */
export async function findParameterMapping(hmisTestCode, parameterName) {
  const [candidates] = await db.query(
    `SELECT * FROM cdac_parameter_map WHERE hmis_test_code = ? AND mapping_status = 'Mapped'`,
    [hmisTestCode]
  );
  if (!candidates.length) return null;

  const result = bestMatch(parameterName, candidates, (c) => c.parameter_name);
  return result && result.score >= SUGGEST_THRESHOLD ? result.match : null;
}
