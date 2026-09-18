import db from '../config/db.js';
import * as cdacService from '../services/cdacService.js';
import { mapCdacOrderToLocalBill } from '../services/cdacMapper.js';
import {
  autoMapTestCodes,
  confirmTestMapping,
  upsertParameterMapping,
  bulkImportParameterMap,
} from '../services/cdacAutoMapper.js';

// GET /api/cdac/branch-config?branch_id=X — read a branch's CDAC/Care routing
// config, regardless of its current state (unlike requireCdacBranch below,
// which throws — this is for the settings UI to show/edit whatever's there).
export const getBranchConfig = async (req, res) => {
  try {
    const { branch_id } = req.query;
    if (!branch_id) return res.status(400).json({ success: false, message: 'branch_id is required' });

    const config = await cdacService.getBranchCdacConfig(branch_id);
    res.json({ success: true, data: config || { branch_id: Number(branch_id), integration_type: 'NONE', hmis_hosp_mapping_code: null, is_active: false } });
  } catch (error) {
    console.error('CDAC get-branch-config error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch branch config' });
  }
};

// POST /api/cdac/branch-config — set/update a branch's routing + hospital code.
// Despite the CDAC-specific filename, this endpoint generically administers
// branch_hmis_config for all three integration_type values — including the
// CARE-specific columns (care_gateway_external_id/care_sender_ip/care_oru_port/
// care_orm_mode), so CARE's admin extends this rather than forking a
// duplicate CRUD surface writing the same table/row.
export const setBranchConfig = async (req, res) => {
  try {
    const {
      branch_id, integration_type, hmis_hosp_mapping_code, is_active,
      care_gateway_external_id, care_sender_ip, care_oru_port, care_orm_mode,
    } = req.body;
    if (!branch_id || !integration_type) {
      return res.status(400).json({ success: false, message: 'branch_id and integration_type are required' });
    }
    if (!['CDAC', 'CARE', 'NONE'].includes(integration_type)) {
      return res.status(400).json({ success: false, message: "integration_type must be 'CDAC', 'CARE', or 'NONE'" });
    }

    await db.query(
      `INSERT INTO branch_hmis_config
         (branch_id, integration_type, hmis_hosp_mapping_code, is_active,
          care_gateway_external_id, care_sender_ip, care_oru_port, care_orm_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         integration_type = VALUES(integration_type),
         hmis_hosp_mapping_code = VALUES(hmis_hosp_mapping_code),
         is_active = VALUES(is_active),
         care_gateway_external_id = VALUES(care_gateway_external_id),
         care_sender_ip = VALUES(care_sender_ip),
         care_oru_port = VALUES(care_oru_port),
         care_orm_mode = VALUES(care_orm_mode),
         updated_at = NOW()`,
      [
        branch_id, integration_type, hmis_hosp_mapping_code || null, is_active === false ? 0 : 1,
        care_gateway_external_id || null, care_sender_ip || null, care_oru_port || null, care_orm_mode || null,
      ]
    );

    res.json({ success: true, message: 'Branch HMIS config saved' });
  } catch (error) {
    console.error('CDAC set-branch-config error:', error);
    res.status(500).json({ success: false, message: 'Failed to save branch config' });
  }
};

async function requireCdacBranch(branchId) {
  const config = await cdacService.getBranchCdacConfig(branchId);
  if (!config || config.integration_type !== 'CDAC') {
    const err = new Error(`Branch ${branchId} is not configured for CDAC`);
    err.status = 400;
    throw err;
  }
  if (!config.is_active) {
    const err = new Error(`CDAC integration is inactive for branch ${branchId}`);
    err.status = 400;
    throw err;
  }
  return config;
}

// POST /api/cdac/pull-order — API1: pull a patient's CDAC-ordered investigations
// and materialize them as a local bill/bill_items, ready for the normal worklist.
export const pullCdacOrder = async (req, res) => {
  try {
    const { branch_id, hmis_patCrNo } = req.body;
    if (!branch_id || !hmis_patCrNo) {
      return res.status(400).json({ success: false, message: 'branch_id and hmis_patCrNo are required' });
    }

    const branchConfig = await requireCdacBranch(branch_id);
    const hospMappingCode = branchConfig.hmis_hosp_mapping_code;
    if (!hospMappingCode) {
      return res.status(400).json({ success: false, message: `Branch ${branch_id} has no hmis_hosp_mapping_code configured yet` });
    }

    const response = await cdacService.getPatDemographicInvestigationDtls(
      { hospMappingCode, patCrNo: hmis_patCrNo },
      branchConfig
    );

    if (!response?.data) {
      return res.status(502).json({ success: false, message: 'CDAC returned no data for this patient/CR number' });
    }

    const result = await mapCdacOrderToLocalBill(response.data, branch_id, branchConfig);
    const invalidCount = result.invalidItems?.length || 0;

    if (!result.billId) {
      // Nothing new was actually pulled — either every line was already
      // pulled before, or CDAC's response had no usable lines at all.
      const message = invalidCount > 0
        ? `No investigations pulled — ${invalidCount} line(s) from CDAC were missing required fields (see invalidItems)`
        : 'All investigations for this patient were already pulled';
      return res.json({ success: invalidCount === 0, message, ...result });
    }

    const message = invalidCount > 0
      ? `CDAC order pulled, but ${invalidCount} investigation line(s) were skipped (missing required fields — see invalidItems)`
      : 'CDAC order pulled successfully';
    res.status(201).json({ success: true, message, ...result });
  } catch (error) {
    console.error('CDAC pull-order error:', error);
    // Our own thrown errors (no investigations found, branch not configured,
    // etc. — anything with a .status already set) have a clean, safe-to-show
    // message. Only fall back to the generic one for unexpected errors
    // (network failures, CDAC 5xx) where error.message might be noisy/raw.
    const message = error.status ? error.message : 'Failed to pull CDAC order';
    res.status(error.status || 500).json({ success: false, message });
  }
};

// POST /api/cdac/sync-master-data — API7: refresh lab/sample/test/UOM code cache.
export const syncCdacMasterData = async (req, res) => {
  try {
    const { branch_id } = req.body;
    if (!branch_id) {
      return res.status(400).json({ success: false, message: 'branch_id is required' });
    }

    const branchConfig = await requireCdacBranch(branch_id);
    const hospMappingCode = branchConfig.hmis_hosp_mapping_code;
    if (!hospMappingCode) {
      return res.status(400).json({ success: false, message: `Branch ${branch_id} has no hmis_hosp_mapping_code configured yet` });
    }

    const response = await cdacService.getHmisHospMapDataRowData(hospMappingCode, branchConfig);
    const data = response?.data || {};

    const categories = [
      ['LAB', data.hmis_lab_data, (r) => ({ code: String(r.hmis_lab_code), name: r.hmis_lab_name })],
      ['SAMPLE', data.hmis_sample_data, (r) => ({ code: String(r.hmis_sample_code), name: r.hmis_sample_name })],
      ['TEST', data.hmis_test_data, (r) => ({ code: String(r.hmis_test_code), name: r.hmis_test_name })],
      ['SAMPLE_MAPPING', data.hmis_lab_test_sample_mapping_data, (r) => ({ code: String(r.hmis_test_code), name: r.hmis_test_name })],
      // The real, CDAC-issued per-parameter codes needed for API31
      // (patInvestigationStatusUpdateDtlsRowData) — hmis_parameter_code /
      // hmis_parent_parameter_code — live in this field and were previously
      // never parsed, so every parameter_map row got a fabricated LOINC
      // placeholder instead. `code` is composite (test_code:parameter_code)
      // since a bare hmis_parameter_code isn't unique across tests.
      ['PARAMETER', data.hmis_test_parameter_mapping_data, (r) => ({
        code: `${r.hmis_test_code}:${r.hmis_parameter_code}`,
        name: r.hmis_parameter_name,
      })],
    ];

    let cached = 0;
    let seededTestCodes = 0;
    for (const [category, rows, toCodeName] of categories) {
      for (const row of rows || []) {
        const { code, name } = toCodeName(row);
        await db.query(
          `INSERT INTO cdac_master_data_cache (hmis_hosp_mapping_code, category, code, name, raw_json, synced_at)
           VALUES (?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE name = VALUES(name), raw_json = VALUES(raw_json), synced_at = NOW()`,
          [hospMappingCode, category, code, name, JSON.stringify(row)]
        );
        cached++;
      }
    }

    // Seed unmapped rows into cdac_test_code_map so they're visible for manual mapping
    for (const row of data.hmis_test_data || []) {
      const [result] = await db.query(
        `INSERT IGNORE INTO cdac_test_code_map (hmis_hosp_mapping_code, hmis_test_code, hmis_test_name, mapping_status)
         VALUES (?, ?, ?, 'Unmapped')`,
        [hospMappingCode, String(row.hmis_test_code), row.hmis_test_name]
      );
      if (result.affectedRows > 0) seededTestCodes++;
    }

    res.json({ success: true, message: 'CDAC master data synced', cachedRows: cached, newTestCodesSeeded: seededTestCodes });
  } catch (error) {
    console.error('CDAC sync-master-data error:', error);
    res.status(error.status || 500).json({ success: false, message: 'Failed to sync CDAC master data' });
  }
};

// GET /api/cdac/logs — paginated read of the call audit log.
export const getCdacLogs = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;

    const filters = [];
    const params = [];
    if (req.query.operation) { filters.push('operation = ?'); params.push(req.query.operation); }
    if (req.query.success !== undefined) { filters.push('success = ?'); params.push(req.query.success === 'true' ? 1 : 0); }
    if (req.query.branch_id) { filters.push('branch_id = ?'); params.push(req.query.branch_id); }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT id, operation, hmis_request_type, bill_item_id, hmis_req_no, hmis_req_dno, hmis_patCrNo,
              branch_id, http_status, success, error_message, duration_ms, created_at
       FROM cdac_integration_logs ${whereClause}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM cdac_integration_logs ${whereClause}`,
      params
    );

    res.json({ success: true, data: rows, page, limit, total });
  } catch (error) {
    console.error('CDAC get-logs error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch CDAC logs' });
  }
};

// ── Test-code mapping ────────────────────────────────────────────────────────

// GET /api/cdac/test-mappings?branch_id=X
export const getTestMappings = async (req, res) => {
  try {
    const { branch_id } = req.query;
    if (!branch_id) return res.status(400).json({ success: false, message: 'branch_id is required' });

    // Gate on being a CDAC-configured branch, but the mapping data itself is
    // global (shared lab_tests catalog, national CDAC codes) — not filtered
    // to this branch's own hospital code.
    await requireCdacBranch(branch_id);
    const [rows] = await db.query(
      `SELECT ctm.*, lt.test_name as mapped_test_name, lt.test_code as mapped_test_code
       FROM cdac_test_code_map ctm
       LEFT JOIN lab_tests lt ON lt.id = ctm.lab_test_id
       ORDER BY ctm.mapping_status = 'Mapped', ctm.hmis_test_name`
    );

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('CDAC get-test-mappings error:', error);
    res.status(error.status || 500).json({ success: false, message: 'Failed to fetch test mappings' });
  }
};

// POST /api/cdac/test-mappings/auto-map — body { branch_id }
export const runAutoMapTestCodes = async (req, res) => {
  try {
    const { branch_id } = req.body;
    if (!branch_id) return res.status(400).json({ success: false, message: 'branch_id is required' });

    // Auto-mapping is global (see cdacAutoMapper.js) — no need for this
    // branch to have its own hmis_hosp_mapping_code set, just to be a
    // CDAC-configured branch at all.
    await requireCdacBranch(branch_id);

    const result = await autoMapTestCodes();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('CDAC auto-map-test-codes error:', error);
    res.status(error.status || 500).json({ success: false, message: 'Failed to auto-map test codes' });
  }
};

// POST /api/cdac/test-mappings/:id/confirm — body { lab_test_id }
export const confirmTestMappingRow = async (req, res) => {
  try {
    const { id } = req.params;
    const { lab_test_id } = req.body;
    if (!lab_test_id) return res.status(400).json({ success: false, message: 'lab_test_id is required' });

    const test = await confirmTestMapping(id, lab_test_id);
    res.json({ success: true, message: `Mapped to "${test.test_name}"`, test });
  } catch (error) {
    console.error('CDAC confirm-test-mapping error:', error);
    res.status(400).json({ success: false, message: 'Failed to confirm mapping' });
  }
};

// ── Parameter-code mapping ───────────────────────────────────────────────────

// GET /api/cdac/parameter-mappings?branch_id=X&hmis_test_code=Y
export const getParameterMappings = async (req, res) => {
  try {
    const { branch_id, hmis_test_code } = req.query;
    if (!branch_id) return res.status(400).json({ success: false, message: 'branch_id is required' });

    // Gate on being a CDAC-configured branch; the mapping data itself is
    // global, not filtered to this branch's own hospital code.
    await requireCdacBranch(branch_id);

    if (hmis_test_code) {
      // CDAC's own parameter list for this test, stored as given — not tied
      // to any pre-configured catalog. Empty is normal for a test that's
      // never had a result pushed for it yet.
      const [[testMap]] = await db.query(
        `SELECT hmis_test_name FROM cdac_test_code_map WHERE hmis_test_code = ? AND mapping_status = 'Mapped' LIMIT 1`,
        [hmis_test_code]
      );
      if (!testMap) {
        return res.json({ success: true, testName: null, data: [], testMapped: false });
      }

      const [rows] = await db.query(
        `SELECT id as mapping_id, parameter_name, hmis_parameter_code, hmis_parent_parameter_code, hmis_str_uom, notes
         FROM cdac_parameter_map
         WHERE hmis_test_code = ?
         ORDER BY parameter_name`,
        [hmis_test_code]
      );
      return res.json({ success: true, testMapped: true, testName: testMap.hmis_test_name, data: rows });
    }

    // Overview: per mapped test, how many CDAC parameter codes are on file.
    const [rows] = await db.query(
      `SELECT ctm.hmis_test_code, ctm.hmis_test_name, ctm.lab_test_id, lt.test_name,
              COUNT(cpm.id) as mapped_parameters
       FROM cdac_test_code_map ctm
       JOIN lab_tests lt ON lt.id = ctm.lab_test_id
       LEFT JOIN cdac_parameter_map cpm ON cpm.hmis_test_code = ctm.hmis_test_code
       WHERE ctm.mapping_status = 'Mapped'
       GROUP BY ctm.hmis_test_code, ctm.hmis_test_name, ctm.lab_test_id, lt.test_name
       ORDER BY lt.test_name`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('CDAC get-parameter-mappings error:', error);
    res.status(error.status || 500).json({ success: false, message: 'Failed to fetch parameter mappings' });
  }
};

// POST /api/cdac/parameter-mappings — single manual upsert (add or edit a
// CDAC parameter code for this test, by name — no catalog entry required)
export const upsertParameterMappingRow = async (req, res) => {
  try {
    const {
      branch_id, hmis_test_code, hmis_lab_code, hmis_sample_code, parameter_name,
      hmis_parameter_code, hmis_parent_parameter_code, hmis_str_uom,
    } = req.body;
    if (!branch_id || !hmis_test_code || !parameter_name) {
      return res.status(400).json({ success: false, message: 'branch_id, hmis_test_code, and parameter_name are required' });
    }

    const branchConfig = await requireCdacBranch(branch_id);
    await upsertParameterMapping({
      hospMappingCode: branchConfig.hmis_hosp_mapping_code,
      hmisTestCode: hmis_test_code,
      hmisLabCode: hmis_lab_code,
      hmisSampleCode: hmis_sample_code,
      parameterName: parameter_name,
      hmisParameterCode: hmis_parameter_code,
      hmisParentParameterCode: hmis_parent_parameter_code,
      hmisStrUom: hmis_str_uom,
      notes: 'Manually mapped',
    });

    res.json({ success: true, message: 'Parameter mapping saved' });
  } catch (error) {
    console.error('CDAC upsert-parameter-mapping error:', error);
    res.status(error.status || 500).json({ success: false, message: 'Failed to save parameter mapping' });
  }
};

// POST /api/cdac/parameter-mappings/import — body { branch_id, rows: [...] }
// Bulk-imports CDAC's parameter-code master list (however it was supplied —
// CSV, spreadsheet export) and name-matches each row automatically.
export const importParameterMappings = async (req, res) => {
  try {
    const { branch_id, rows } = req.body;
    if (!branch_id || !Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ success: false, message: 'branch_id and a non-empty rows array are required' });
    }

    const branchConfig = await requireCdacBranch(branch_id);
    const result = await bulkImportParameterMap(rows, branchConfig.hmis_hosp_mapping_code);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('CDAC import-parameter-mappings error:', error);
    res.status(error.status || 500).json({ success: false, message: 'Failed to import parameter mappings' });
  }
};
