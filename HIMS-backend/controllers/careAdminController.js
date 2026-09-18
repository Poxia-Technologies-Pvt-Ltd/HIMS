/**
 * Staff-facing admin surface for the Care HIMS (CARE) integration — LOINC
 * mapping tools, call logs, diagnostic device listing. Mirrors
 * cdacController.js's test/parameter-mapping endpoints. Distinct from
 * careController.js, which is the protocol surface CARE itself calls.
 */
import db from '../config/db.js';
import { getLabAnalyzerDevices, getBranchCareConfig } from '../services/careService.js';
import {
  autoMapLoincTests,
  confirmLoincTestMapping,
  upsertLoincParameterMapping,
  bulkImportLoincParameterMap,
} from '../services/careAutoMapper.js';

// GET /api/care/logs — paginated read of the call audit log.
export const getCareLogs = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;

    const filters = [];
    const params = [];
    if (req.query.operation) { filters.push('operation = ?'); params.push(req.query.operation); }
    if (req.query.direction) { filters.push('direction = ?'); params.push(req.query.direction); }
    if (req.query.success !== undefined) { filters.push('success = ?'); params.push(req.query.success === 'true' ? 1 : 0); }
    if (req.query.branch_id) { filters.push('branch_id = ?'); params.push(req.query.branch_id); }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT id, operation, direction, care_lab_order_id, bill_item_id, filler_order_number,
              branch_id, http_status, success, error_message, duration_ms, created_at
       FROM care_integration_logs ${whereClause}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM care_integration_logs ${whereClause}`,
      params
    );

    res.json({ success: true, data: rows, page, limit, total });
  } catch (error) {
    console.error('CARE get-logs error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch CARE logs' });
  }
};

// GET /api/care/devices — API4, diagnostic: list devices linked to our gateway.
export const listDevices = async (req, res) => {
  try {
    const { branch_id } = req.query;
    if (!branch_id) return res.status(400).json({ success: false, message: 'branch_id is required' });

    const branchConfig = await getBranchCareConfig(branch_id);
    if (!branchConfig || branchConfig.integration_type !== 'CARE') {
      return res.status(400).json({ success: false, message: `Branch ${branch_id} is not configured for CARE` });
    }

    const response = await getLabAnalyzerDevices(branchConfig);
    res.json({ success: true, data: response });
  } catch (error) {
    console.error('CARE list-devices error:', error);
    res.status(error.status || 500).json({ success: false, message: 'Failed to list CARE devices' });
  }
};

// ── LOINC test/panel mapping ─────────────────────────────────────────────────

// GET /api/care/loinc-mappings
export const getLoincMappings = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT clm.*, lt.test_name as mapped_test_name, lt.test_code as mapped_test_code
       FROM care_loinc_test_map clm
       LEFT JOIN lab_tests lt ON lt.id = clm.lab_test_id
       ORDER BY clm.mapping_status = 'Mapped', clm.loinc_name`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('CARE get-loinc-mappings error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch LOINC test mappings' });
  }
};

// POST /api/care/loinc-mappings/auto-map
export const runAutoMapLoincTests = async (req, res) => {
  try {
    const result = await autoMapLoincTests();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('CARE auto-map-loinc-tests error:', error);
    res.status(500).json({ success: false, message: 'Failed to auto-map LOINC tests' });
  }
};

// POST /api/care/loinc-mappings/:id/confirm — body { lab_test_id }
export const confirmLoincMappingRow = async (req, res) => {
  try {
    const { id } = req.params;
    const { lab_test_id } = req.body;
    if (!lab_test_id) return res.status(400).json({ success: false, message: 'lab_test_id is required' });

    const test = await confirmLoincTestMapping(id, lab_test_id);
    res.json({ success: true, message: `Mapped to "${test.test_name}"`, test });
  } catch (error) {
    console.error('CARE confirm-loinc-mapping error:', error);
    res.status(400).json({ success: false, message: 'Failed to confirm mapping' });
  }
};

// ── LOINC parameter/component mapping ────────────────────────────────────────

// GET /api/care/loinc-parameter-mappings?loinc_code=Y
export const getLoincParameterMappings = async (req, res) => {
  try {
    const { loinc_code } = req.query;

    if (loinc_code) {
      const [[testMap]] = await db.query(
        `SELECT loinc_name FROM care_loinc_test_map WHERE loinc_code = ? AND mapping_status = 'Mapped' LIMIT 1`,
        [loinc_code]
      );
      if (!testMap) {
        return res.json({ success: true, testName: null, data: [], testMapped: false });
      }

      const [rows] = await db.query(
        `SELECT id as mapping_id, parameter_name, parameter_loinc_code, uom, notes
         FROM care_loinc_parameter_map
         WHERE loinc_code = ?
         ORDER BY parameter_name`,
        [loinc_code]
      );
      return res.json({ success: true, testMapped: true, testName: testMap.loinc_name, data: rows });
    }

    const [rows] = await db.query(
      `SELECT clm.loinc_code, clm.loinc_name, clm.lab_test_id, lt.test_name,
              COUNT(cpm.id) as mapped_parameters
       FROM care_loinc_test_map clm
       JOIN lab_tests lt ON lt.id = clm.lab_test_id
       LEFT JOIN care_loinc_parameter_map cpm ON cpm.loinc_code = clm.loinc_code
       WHERE clm.mapping_status = 'Mapped'
       GROUP BY clm.loinc_code, clm.loinc_name, clm.lab_test_id, lt.test_name
       ORDER BY lt.test_name`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('CARE get-loinc-parameter-mappings error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch LOINC parameter mappings' });
  }
};

// POST /api/care/loinc-parameter-mappings — single manual upsert
export const upsertLoincParameterMappingRow = async (req, res) => {
  try {
    const { loinc_code, parameter_loinc_code, parameter_name, uom } = req.body;
    if (!loinc_code || !parameter_name || !parameter_loinc_code) {
      return res.status(400).json({ success: false, message: 'loinc_code, parameter_name, and parameter_loinc_code are required' });
    }

    await upsertLoincParameterMapping({
      loincCode: loinc_code,
      parameterLoincCode: parameter_loinc_code,
      parameterName: parameter_name,
      uom,
      notes: 'Manually mapped',
    });

    res.json({ success: true, message: 'LOINC parameter mapping saved' });
  } catch (error) {
    console.error('CARE upsert-loinc-parameter-mapping error:', error);
    res.status(500).json({ success: false, message: 'Failed to save parameter mapping' });
  }
};

// POST /api/care/loinc-parameter-mappings/import — body { rows: [...] }
export const importLoincParameterMappings = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ success: false, message: 'A non-empty rows array is required' });
    }

    const result = await bulkImportLoincParameterMap(rows);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('CARE import-loinc-parameter-mappings error:', error);
    res.status(500).json({ success: false, message: 'Failed to import parameter mappings' });
  }
};
