import db from '../config/db.js';
import { identifierSearchClause } from '../utils/identifierSearch.js';
import crypto from 'crypto';
import { PUBLIC_API_URL } from '../config/publicUrl.js';
import http from 'http';
import { generateLabReportPDFStream } from '../utils/pdfGenerator.js';
import * as cdacService from '../services/cdacService.js';
import { buildSampleCollectionPayload, buildStatusUpdatePayload, buildResultRowDataPayload, buildReportPayload } from '../services/cdacMapper.js';
import * as careService from '../services/careService.js';
import { buildResultOruPayload } from '../services/careMapper.js';
import { generateSampleIdForItem } from '../utils/sampleId.js';
import { effectiveTat, tatStatus } from '../utils/worklistTat.js';
import { PUBLIC_APP_URL } from '../config/publicUrl.js';
import { diffResults, logResultAudit, snapshotVersion } from '../utils/resultAudit.js';
import { syncCriticalAlert } from '../utils/criticalAlerts.js';
import { currentReagents, reagentSnapshot, loadedInventoryItemIds } from '../utils/reagents.js';
import { canonicalReportContent, contentHash, sealFor, confirmPassword, verifyKey, checkSignature } from '../utils/reportSignature.js';
import { loadWorkflows, nextAction, TECHNICAL_ROLE_CHOICES, CLINICAL_ROLE_CHOICES } from '../utils/verificationWorkflow.js';
import { evaluateResults, externalFlag, getFlagSettings, clearFlagSettingsCache } from '../utils/resultFlags.js';
import { worklistVersion } from '../utils/worklistSignal.js';
import { advanceSampleInOwnTransaction, advanceSampleQuietly, actorFromReq } from '../utils/sampleLifecycle.js';
import { dispatchReport, recordDelivery, updateDelivery, maskPhone, DeliveryError } from '../utils/reportDelivery.js';
import { manualEntryCheck, MANUAL_REASONS, canEnterManually } from '../utils/manualEntry.js';
import { prepareDscForApproval, saveSignedReport } from '../utils/doctorDsc.js';
import { verifyPdfSignature } from '../utils/dscSigner.js';

const pdfToBuffer = (doc) => new Promise((resolve, reject) => {
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
});

// Lab Categories Management
export const getLabCategories = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM lab_categories WHERE status = ? ORDER BY name',
      ['Active']
    );
    res.json({ success: true, categories: rows });
  } catch (error) {
    console.error('Error fetching lab categories:', error);
    res.status(500).json({ success: false, message: 'Server error fetching categories' });
  }
};

export const addLabCategory = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    const [result] = await db.query(
      'INSERT INTO lab_categories (name, description) VALUES (?, ?)',
      [name, description]
    );

    res.status(201).json({
      success: true,
      message: 'Lab category added successfully',
      data: { id: result.insertId, name, description }
    });
  } catch (error) {
    console.error('Error adding lab category:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ success: false, message: 'Category name already exists' });
    } else {
      res.status(500).json({ success: false, message: 'Server error adding category' });
    }
  }
};

export const updateLabCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    const [result] = await db.query(
      'UPDATE lab_categories SET name = ?, description = ? WHERE id = ?',
      [name, description, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Lab category not found' });
    }

    res.json({ success: true, message: 'Lab category updated successfully' });
  } catch (error) {
    console.error('Error updating lab category:', error);
    res.status(500).json({ success: false, message: 'Server error updating lab category' });
  }
};

export const deleteLabCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      'UPDATE lab_categories SET status = ? WHERE id = ?',
      ['Inactive', id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Lab category not found' });
    }

    res.json({ success: true, message: 'Lab category deleted successfully' });
  } catch (error) {
    console.error('Error deleting lab category:', error);
    res.status(500).json({ success: false, message: 'Server error deleting lab category' });
  }
};

// Sample Containers Management
export const getSampleContainers = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM sample_containers WHERE status = ? ORDER BY container_name',
      ['Active']
    );
    res.json({ success: true, containers: rows });
  } catch (error) {
    console.error('Error fetching sample containers:', error);
    res.status(500).json({ success: false, message: 'Server error fetching containers' });
  }
};

export const addSampleContainer = async (req, res) => {
  try {
    const { container_name, tube_color, volume_ml, additives, storage_temperature, special_instructions } = req.body;

    if (!container_name) {
      return res.status(400).json({ success: false, message: 'Container name is required' });
    }

    const [result] = await db.query(
      'INSERT INTO sample_containers (container_name, tube_color, volume_ml, additives, storage_temperature, special_instructions) VALUES (?, ?, ?, ?, ?, ?)',
      [container_name, tube_color, volume_ml, additives, storage_temperature, special_instructions]
    );

    res.status(201).json({
      success: true,
      message: 'Sample container added successfully',
      data: { id: result.insertId, container_name, tube_color, volume_ml, additives, storage_temperature, special_instructions }
    });
  } catch (error) {
    console.error('Error adding sample container:', error);
    res.status(500).json({ success: false, message: 'Server error adding sample container' });
  }
};

export const updateSampleContainer = async (req, res) => {
  try {
    const { id } = req.params;
    const { container_name, tube_color, volume_ml, additives, storage_temperature, special_instructions } = req.body;

    if (!container_name) {
      return res.status(400).json({ success: false, message: 'Container name is required' });
    }

    const [result] = await db.query(
      'UPDATE sample_containers SET container_name = ?, tube_color = ?, volume_ml = ?, additives = ?, storage_temperature = ?, special_instructions = ? WHERE id = ?',
      [container_name, tube_color, volume_ml, additives, storage_temperature, special_instructions, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Sample container not found' });
    }

    res.json({ success: true, message: 'Sample container updated successfully' });
  } catch (error) {
    console.error('Error updating sample container:', error);
    res.status(500).json({ success: false, message: 'Server error updating sample container' });
  }
};

export const deleteSampleContainer = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      'UPDATE sample_containers SET status = ? WHERE id = ?',
      ['Inactive', id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Sample container not found' });
    }

    res.json({ success: true, message: 'Sample container deleted successfully' });
  } catch (error) {
    console.error('Error deleting sample container:', error);
    res.status(500).json({ success: false, message: 'Server error deleting sample container' });
  }
};

// Sample Types Management
export const getSampleTypes = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM sample_types WHERE status = ? ORDER BY type_name',
      ['Active']
    );
    res.json({ success: true, sampleTypes: rows });
  } catch (error) {
    console.error('Error fetching sample types:', error);
    res.status(500).json({ success: false, message: 'Server error fetching sample types' });
  }
};

export const addSampleType = async (req, res) => {
  try {
    const { type_name, description } = req.body;

    if (!type_name) {
      return res.status(400).json({ success: false, message: 'Sample type name is required' });
    }

    const [result] = await db.query(
      'INSERT INTO sample_types (type_name, description) VALUES (?, ?)',
      [type_name, description]
    );

    res.status(201).json({
      success: true,
      message: 'Sample type added successfully',
      data: { id: result.insertId, type_name, description }
    });
  } catch (error) {
    console.error('Error adding sample type:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ success: false, message: 'Sample type name already exists' });
    } else {
      res.status(500).json({ success: false, message: 'Server error adding sample type' });
    }
  }
};

export const updateSampleType = async (req, res) => {
  try {
    const { id } = req.params;
    const { type_name, description } = req.body;

    if (!type_name) {
      return res.status(400).json({ success: false, message: 'Sample type name is required' });
    }

    const [result] = await db.query(
      'UPDATE sample_types SET type_name = ?, description = ? WHERE id = ?',
      [type_name, description, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Sample type not found' });
    }

    res.json({ success: true, message: 'Sample type updated successfully' });
  } catch (error) {
    console.error('Error updating sample type:', error);
    res.status(500).json({ success: false, message: 'Server error updating sample type' });
  }
};

export const deleteSampleType = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      'UPDATE sample_types SET status = ? WHERE id = ?',
      ['Inactive', id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Sample type not found' });
    }

    res.json({ success: true, message: 'Sample type deleted successfully' });
  } catch (error) {
    console.error('Error deleting sample type:', error);
    res.status(500).json({ success: false, message: 'Server error deleting sample type' });
  }
};

// Lab Tests Management
export const getLabTests = async (req, res) => {
  try {
    const { category_id } = req.query;
    let query = `
      SELECT lt.*, lc.name as category_name, i.name as lab_name
      FROM lab_tests lt
      LEFT JOIN lab_categories lc ON lt.category_id = lc.id
      LEFT JOIN infrastructure i ON lt.lab_id = i.id
      WHERE lt.status = ?
    `;
    let params = ['Active'];

    if (category_id) {
      query += ' AND lt.category_id = ?';
      params.push(category_id);
    }

    query += ' ORDER BY lt.test_name';

    const [rows] = await db.query(query, params);
    res.json({ success: true, tests: rows });
  } catch (error) {
    console.error('Error fetching lab tests:', error);
    res.status(500).json({ success: false, message: 'Server error fetching tests' });
  }
};

export const getLabTestById = async (req, res) => {
  try {
    const { id } = req.params;

    const [testRows] = await db.query(
      `SELECT lt.*, lc.name as category_name, i.name as lab_name
       FROM lab_tests lt
       LEFT JOIN lab_categories lc ON lt.category_id = lc.id
       LEFT JOIN infrastructure i ON lt.lab_id = i.id
       WHERE lt.id = ?`,
      [id]
    );

    if (testRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Lab test not found' });
    }

    const [parameterRows] = await db.query(
      'SELECT * FROM lab_test_parameters WHERE test_id = ? AND status = ? ORDER BY display_order',
      [id, 'Active']
    );

    res.json({
      success: true,
      test: testRows[0],
      parameters: parameterRows
    });
  } catch (error) {
    console.error('Error fetching lab test:', error);
    res.status(500).json({ success: false, message: 'Server error fetching test' });
  }
};

export const addLabTest = async (req, res) => {
  try {
    const {
      test_code,
      test_name,
      category_id,
      lab_id,
      sample_type,
      tube_color,
      storage_conditions,
      methodology,
      price,
      analyzer_name,
      tat_minutes,
      parameters
    } = req.body;

    if (!test_code || !test_name || !category_id || !sample_type) {
      return res.status(400).json({
        success: false,
        message: 'Test code, name, category, and sample type are required'
      });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Check if test code exists
      const [existing] = await connection.query(
        'SELECT id FROM lab_tests WHERE test_code = ?',
        [test_code]
      );

      if (existing.length > 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: `Test code '${test_code}' already exists.`
        });
      }

      // Insert lab test
      const [testResult] = await connection.query(
        `INSERT INTO lab_tests
         (test_code, test_name, category_id, lab_id, sample_type, tube_color, storage_conditions, methodology, price, analyzer_name, tat_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [test_code, test_name, category_id, lab_id || null, sample_type, tube_color, storage_conditions, methodology, price, analyzer_name || null, tat_minutes ? Number(tat_minutes) : null]
      );

      const testId = testResult.insertId;

      // Insert parameters if provided
      if (parameters && parameters.length > 0) {
        for (let i = 0; i < parameters.length; i++) {
          const param = parameters[i];
          await connection.query(
            `INSERT INTO lab_test_parameters 
             (test_id, parameter_code, parameter_name, parameter_unit, result_type, min_value, max_value,
              men_min_value, men_max_value, women_min_value, women_max_value,
              kids_min_value, kids_max_value, use_demographic_ranges, display_order, is_calculated, formula, options, machine_parameter_code,
              critical_low, critical_high, measurable_min, measurable_max, delta_percent, delta_absolute, delta_days) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              testId,
              param.parameter_code || null,
              param.parameter_name,
              param.parameter_unit,
              param.result_type || 'numeric',
              param.min_value || null,
              param.max_value || null,
              param.men_min_value || null,
              param.men_max_value || null,
              param.women_min_value || null,
              param.women_max_value || null,
              param.kids_min_value || null,
              param.kids_max_value || null,
              param.use_demographic_ranges ? 1 : 0,
              param.display_order || i + 1,
              param.is_calculated ? 1 : 0,
              param.formula || null,
              param.options || null,
              param.machine_parameter_code || null,
              ruleNum(param.critical_low), ruleNum(param.critical_high), ruleNum(param.measurable_min), ruleNum(param.measurable_max),
              ruleNum(param.delta_percent), ruleNum(param.delta_absolute), ruleNum(param.delta_days)
            ]
          );
        }
      }

      await connection.commit();

      res.status(201).json({
        success: true,
        message: 'Lab test added successfully',
        id: testId
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error adding lab test:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ success: false, message: 'Test code already exists' });
    } else if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      res.status(400).json({ success: false, message: 'Invalid category selected' });
    } else {
      res.status(500).json({ success: false, message: 'Server error adding lab test' });
    }
  }
};

export const updateLabTest = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      test_code,
      test_name,
      category_id,
      lab_id,
      sample_type,
      tube_color,
      storage_conditions,
      methodology,
      price,
      analyzer_name,
      tat_minutes,
      parameters
    } = req.body;

    if (!test_code || !test_name || !category_id || !sample_type) {
      return res.status(400).json({
        success: false,
        message: 'Test code, name, category, and sample type are required'
      });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Update lab test
      const [result] = await connection.query(
        `UPDATE lab_tests
         SET test_code = ?, test_name = ?, category_id = ?, lab_id = ?, sample_type = ?, tube_color = ?,
             storage_conditions = ?, methodology = ?, price = ?, analyzer_name = ?, tat_minutes = ?
         WHERE id = ?`,
        [test_code, test_name, category_id, lab_id || null, sample_type, tube_color, storage_conditions, methodology, price, analyzer_name || null, tat_minutes ? Number(tat_minutes) : null, id]
      );

      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: 'Lab test not found' });
      }

      // Update parameters if provided
      if (parameters && parameters.length > 0) {
        // Delete existing parameters
        await connection.query('DELETE FROM lab_test_parameters WHERE test_id = ?', [id]);

        // Insert new parameters
        for (let i = 0; i < parameters.length; i++) {
          const param = parameters[i];
          await connection.query(
            `INSERT INTO lab_test_parameters 
             (test_id, parameter_code, parameter_name, parameter_unit, result_type, min_value, max_value,
              men_min_value, men_max_value, women_min_value, women_max_value,
              kids_min_value, kids_max_value, use_demographic_ranges, display_order, is_calculated, formula, options, machine_parameter_code,
              critical_low, critical_high, measurable_min, measurable_max, delta_percent, delta_absolute, delta_days) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              param.parameter_code || null,
              param.parameter_name,
              param.parameter_unit,
              param.result_type || 'numeric',
              param.min_value || null,
              param.max_value || null,
              param.men_min_value || null,
              param.men_max_value || null,
              param.women_min_value || null,
              param.women_max_value || null,
              param.kids_min_value || null,
              param.kids_max_value || null,
              param.use_demographic_ranges ? 1 : 0,
              param.display_order || i + 1,
              param.is_calculated ? 1 : 0,
              param.formula || null,
              param.options || null,
              param.machine_parameter_code || null,
              ruleNum(param.critical_low), ruleNum(param.critical_high), ruleNum(param.measurable_min), ruleNum(param.measurable_max),
              ruleNum(param.delta_percent), ruleNum(param.delta_absolute), ruleNum(param.delta_days)
            ]
          );
        }
      }

      await connection.commit();

      res.json({ success: true, message: 'Lab test updated successfully' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error updating lab test:', error);
    res.status(500).json({ success: false, message: 'Server error updating lab test' });
  }
};

export const deleteLabTest = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      'UPDATE lab_tests SET status = ? WHERE id = ?',
      ['Inactive', id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Lab test not found' });
    }

    res.json({ success: true, message: 'Lab test deleted successfully' });
  } catch (error) {
    console.error('Error deleting lab test:', error);
    res.status(500).json({ success: false, message: 'Server error deleting lab test' });
  }
};

export const mapAnalyzerTests = async (req, res) => {
  try {
    const { lab_id, analyzer_name } = req.body;
    
    if (!lab_id || !analyzer_name) {
      return res.status(400).json({ success: false, message: 'Lab ID and Analyzer Name are required' });
    }

    const HDC_LYTE_TEMPLATE = [
      {
        test_code: 'ELYTES', test_name: 'Electrolyte Panel', department: 'Biochemistry', sample_type: 'Serum / Plasma',
        parameters: [
          { parameter_code: 'NA', parameter_name: 'Sodium', machine_parameter_code: 'Na', parameter_unit: 'mmol/L', min_value: 135, max_value: 145 },
          { parameter_code: 'K', parameter_name: 'Potassium', machine_parameter_code: 'K', parameter_unit: 'mmol/L', min_value: 3.5, max_value: 5.5 },
          { parameter_code: 'CL', parameter_name: 'Chloride', machine_parameter_code: 'Cl', parameter_unit: 'mmol/L', min_value: 98, max_value: 107 }
        ]
      },
      {
        test_code: 'SE', test_name: 'Serum Electrolytes', department: 'Biochemistry', sample_type: 'Serum',
        parameters: [
          { parameter_code: 'NA', parameter_name: 'Sodium', machine_parameter_code: 'Na', parameter_unit: 'mmol/L', min_value: 135, max_value: 145 },
          { parameter_code: 'K', parameter_name: 'Potassium', machine_parameter_code: 'K', parameter_unit: 'mmol/L', min_value: 3.5, max_value: 5.5 },
          { parameter_code: 'CL', parameter_name: 'Chloride', machine_parameter_code: 'Cl', parameter_unit: 'mmol/L', min_value: 98, max_value: 107 }
        ]
      },
      {
        test_code: 'ELCA', test_name: 'Electrolyte with iCa', department: 'Biochemistry', sample_type: 'Whole Blood / Serum',
        parameters: [
          { parameter_code: 'NA', parameter_name: 'Sodium', machine_parameter_code: 'Na', parameter_unit: 'mmol/L', min_value: 135, max_value: 145 },
          { parameter_code: 'K', parameter_name: 'Potassium', machine_parameter_code: 'K', parameter_unit: 'mmol/L', min_value: 3.5, max_value: 5.5 },
          { parameter_code: 'CL', parameter_name: 'Chloride', machine_parameter_code: 'Cl', parameter_unit: 'mmol/L', min_value: 98, max_value: 107 },
          { parameter_code: 'ICA', parameter_name: 'Ionized Calcium', machine_parameter_code: 'iCa', parameter_unit: 'mmol/L', min_value: 1.10, max_value: 1.35 }
        ]
      },
      {
        test_code: 'ICA', test_name: 'Ionized Calcium', department: 'Biochemistry', sample_type: 'Whole Blood',
        parameters: [
          { parameter_code: 'ICA', parameter_name: 'Ionized Calcium', machine_parameter_code: 'iCa', parameter_unit: 'mmol/L', min_value: 1.10, max_value: 1.35 }
        ]
      },
      {
        test_code: 'LI', test_name: 'Serum Lithium', department: 'Biochemistry', sample_type: 'Serum',
        parameters: [
          { parameter_code: 'LI', parameter_name: 'Lithium', machine_parameter_code: 'Li', parameter_unit: 'mmol/L' }
        ]
      },
      {
        test_code: 'BGE', test_name: 'Blood Gas Electrolytes', department: 'Critical Care', sample_type: 'Arterial Blood',
        parameters: [
          { parameter_code: 'PH', parameter_name: 'pH', machine_parameter_code: 'pH', parameter_unit: 'pH', min_value: 7.35, max_value: 7.45 },
          { parameter_code: 'NA', parameter_name: 'Sodium', machine_parameter_code: 'Na', parameter_unit: 'mmol/L', min_value: 135, max_value: 145 },
          { parameter_code: 'K', parameter_name: 'Potassium', machine_parameter_code: 'K', parameter_unit: 'mmol/L', min_value: 3.5, max_value: 5.5 },
          { parameter_code: 'CL', parameter_name: 'Chloride', machine_parameter_code: 'Cl', parameter_unit: 'mmol/L', min_value: 98, max_value: 107 },
          { parameter_code: 'ICA', parameter_name: 'Ionized Calcium', machine_parameter_code: 'iCa', parameter_unit: 'mmol/L', min_value: 1.10, max_value: 1.35 }
        ]
      }
    ];

    // Predefined tests for Auto-Mapping
    const ANALYZER_TEST_TEMPLATES = {
      'HDC-Lyte Plus': HDC_LYTE_TEMPLATE,
      'HDC-LYTE PRO': HDC_LYTE_TEMPLATE,
      'CelQuant Edge': [
        {
          test_code: 'CBC', test_name: 'Complete Blood Count (CBC)', department: 'Hematology', sample_type: 'Whole Blood',
          parameters: [
            { parameter_code: 'WBC', parameter_name: 'WBC', machine_parameter_code: '6690-2', parameter_unit: '10^3/µL' },
            { parameter_code: 'RBC', parameter_name: 'RBC', machine_parameter_code: '789-8', parameter_unit: '10^6/µL' },
            { parameter_code: 'HGB', parameter_name: 'HGB', machine_parameter_code: '718-7', parameter_unit: 'g/dL' },
            { parameter_code: 'HCT', parameter_name: 'HCT', machine_parameter_code: '4544-3', parameter_unit: '%' },
            { parameter_code: 'MCH', parameter_name: 'MCH', machine_parameter_code: '785-6', parameter_unit: 'pg' },
            { parameter_code: 'MCHC', parameter_name: 'MCHC', machine_parameter_code: '786-4', parameter_unit: 'g/dL' },
            { parameter_code: 'RDW-CV', parameter_name: 'RDW-CV', machine_parameter_code: '788-0', parameter_unit: '%' },
            { parameter_code: 'PLT', parameter_name: 'PLT', machine_parameter_code: '777-3', parameter_unit: '10^3/µL' },
            { parameter_code: 'MPV', parameter_name: 'MPV', machine_parameter_code: '32623-1', parameter_unit: 'fL' },
            { parameter_code: 'LYMPH_PCT', parameter_name: 'Lymph%', machine_parameter_code: '736-9', parameter_unit: '%' },
            { parameter_code: 'MID_PCT', parameter_name: 'Mid%', machine_parameter_code: '10029', parameter_unit: '%' },
            { parameter_code: 'GRAN_PCT', parameter_name: 'Gran%', machine_parameter_code: '10030', parameter_unit: '%' }
          ]
        }
      ],
      'CliniQuant Micro': [
        {
          test_code: 'LFT', test_name: 'Liver Function Test', department: 'Biochemistry', sample_type: 'Serum',
          parameters: [
            { parameter_code: 'TBIL', parameter_name: 'TBIL', machine_parameter_code: '15', parameter_unit: 'mg/dL' },
            { parameter_code: 'DBIL', parameter_name: 'DBIL', machine_parameter_code: '20', parameter_unit: 'mg/dL' },
            { parameter_code: 'AST', parameter_name: 'AST', machine_parameter_code: '4', parameter_unit: 'U/L' },
            { parameter_code: 'ALT', parameter_name: 'ALT', machine_parameter_code: '2', parameter_unit: 'U/L' },
            { parameter_code: 'ALP', parameter_name: 'ALP', machine_parameter_code: '1', parameter_unit: 'U/L' },
            { parameter_code: 'TP', parameter_name: 'TP', machine_parameter_code: '23', parameter_unit: 'g/dL' },
            { parameter_code: 'ALB', parameter_name: 'ALB', machine_parameter_code: '14', parameter_unit: 'g/dL' }
          ]
        },
        {
          test_code: 'KFT', test_name: 'Kidney Function Test', department: 'Biochemistry', sample_type: 'Serum',
          parameters: [
            { parameter_code: 'UREA', parameter_name: 'UREA', machine_parameter_code: '12', parameter_unit: 'mg/dL' },
            { parameter_code: 'CREAT', parameter_name: 'CREAT', machine_parameter_code: '19', parameter_unit: 'mg/dL' },
            { parameter_code: 'URIC-ACID', parameter_name: 'URIC-ACID', machine_parameter_code: '13', parameter_unit: 'mg/dL' }
          ]
        },
        {
          test_code: 'LIPID', test_name: 'Lipid Profile', department: 'Biochemistry', sample_type: 'Serum',
          parameters: [
            { parameter_code: 'CHO', parameter_name: 'CHO', machine_parameter_code: '5', parameter_unit: 'mg/dL' },
            { parameter_code: 'TRIG', parameter_name: 'TRIG', machine_parameter_code: '11', parameter_unit: 'mg/dL' },
            { parameter_code: 'HDL', parameter_name: 'HDL', machine_parameter_code: '21', parameter_unit: 'mg/dL' }
          ]
        },
        {
          test_code: 'BS', test_name: 'Blood Sugar (F/PP/R)', department: 'Biochemistry', sample_type: 'Plasma',
          parameters: [
            { parameter_code: 'GLU', parameter_name: 'GLU', machine_parameter_code: '9', parameter_unit: 'mg/dL' }
          ]
        }
      ],
      'LAURA Smart': [
        {
          test_code: 'URM', test_name: 'Urine Routine & Microscopy (URM)', department: 'Clinical Pathology', sample_type: 'Urine',
          parameters: [
            { parameter_code: 'GLU', parameter_name: 'Glucose', machine_parameter_code: 'GLU', parameter_unit: '' },
            { parameter_code: 'BIL', parameter_name: 'Bilirubin', machine_parameter_code: 'BIL', parameter_unit: '' },
            { parameter_code: 'KET', parameter_name: 'Ketone', machine_parameter_code: 'KET', parameter_unit: '' },
            { parameter_code: 'SG', parameter_name: 'Specific Gravity', machine_parameter_code: 'SG', parameter_unit: '' },
            { parameter_code: 'BLD', parameter_name: 'Blood', machine_parameter_code: 'BLD', parameter_unit: '' },
            { parameter_code: 'PH', parameter_name: 'pH', machine_parameter_code: 'pH', parameter_unit: 'pH' },
            { parameter_code: 'PRO', parameter_name: 'Protein', machine_parameter_code: 'PRO', parameter_unit: '' },
            { parameter_code: 'UBG', parameter_name: 'Urobilinogen', machine_parameter_code: 'UBG', parameter_unit: '' },
            { parameter_code: 'NIT', parameter_name: 'Nitrite', machine_parameter_code: 'NIT', parameter_unit: '' },
            { parameter_code: 'LEU', parameter_name: 'Leukocytes', machine_parameter_code: 'LEU', parameter_unit: '' }
          ]
        },
        {
          test_code: 'URE', test_name: 'Urine Routine Examination (URE)', department: 'Clinical Pathology', sample_type: 'Urine',
          parameters: [
            { parameter_code: 'SG', parameter_name: 'Specific Gravity', machine_parameter_code: 'SG', parameter_unit: '' },
            { parameter_code: 'LEU', parameter_name: 'Leukocytes', machine_parameter_code: 'LEU', parameter_unit: '' },
            { parameter_code: 'NIT', parameter_name: 'Nitrite', machine_parameter_code: 'NIT', parameter_unit: '' },
            { parameter_code: 'PH', parameter_name: 'pH', machine_parameter_code: 'pH', parameter_unit: 'pH' },
            { parameter_code: 'PRO', parameter_name: 'Protein', machine_parameter_code: 'PRO', parameter_unit: '' },
            { parameter_code: 'GLU', parameter_name: 'Glucose', machine_parameter_code: 'GLU', parameter_unit: '' },
            { parameter_code: 'KET', parameter_name: 'Ketone', machine_parameter_code: 'KET', parameter_unit: '' },
            { parameter_code: 'UBG', parameter_name: 'Urobilinogen', machine_parameter_code: 'UBG', parameter_unit: '' },
            { parameter_code: 'BIL', parameter_name: 'Bilirubin', machine_parameter_code: 'BIL', parameter_unit: '' },
            { parameter_code: 'BLD', parameter_name: 'Blood', machine_parameter_code: 'BLD', parameter_unit: '' }
          ]
        },
        {
          test_code: 'UTI', test_name: 'UTI Screening', department: 'Clinical Pathology', sample_type: 'Urine',
          parameters: [
            { parameter_code: 'LEU', parameter_name: 'Leukocytes', machine_parameter_code: 'LEU', parameter_unit: '' },
            { parameter_code: 'NIT', parameter_name: 'Nitrite', machine_parameter_code: 'NIT', parameter_unit: '' }
          ]
        },
        {
          test_code: 'DUS', test_name: 'Diabetes Urine Screening', department: 'Clinical Pathology', sample_type: 'Urine',
          parameters: [
            { parameter_code: 'GLU', parameter_name: 'Glucose', machine_parameter_code: 'GLU', parameter_unit: '' },
            { parameter_code: 'KET', parameter_name: 'Ketone', machine_parameter_code: 'KET', parameter_unit: '' }
          ]
        },
        {
          test_code: 'KIDNEY', test_name: 'Kidney Screening', department: 'Clinical Pathology', sample_type: 'Urine',
          parameters: [
            { parameter_code: 'PRO', parameter_name: 'Protein', machine_parameter_code: 'PRO', parameter_unit: '' },
            { parameter_code: 'SG', parameter_name: 'Specific Gravity', machine_parameter_code: 'SG', parameter_unit: '' },
            { parameter_code: 'BLD', parameter_name: 'Blood', machine_parameter_code: 'BLD', parameter_unit: '' }
          ]
        },
        {
          test_code: 'LIVER', test_name: 'Liver Screening', department: 'Clinical Pathology', sample_type: 'Urine',
          parameters: [
            { parameter_code: 'UBG', parameter_name: 'Urobilinogen', machine_parameter_code: 'UBG', parameter_unit: '' },
            { parameter_code: 'BIL', parameter_name: 'Bilirubin', machine_parameter_code: 'BIL', parameter_unit: '' }
          ]
        }
      ],
      'ALTA Hematology': [
        {
          test_code: 'CBC', test_name: 'Complete Blood Count (CBC)', department: 'Hematology', sample_type: 'Whole Blood',
          parameters: [
            { parameter_code: 'WBC', parameter_name: 'WBC', machine_parameter_code: '2006', parameter_unit: '10^3/µL' },
            { parameter_code: 'NEU_PCT', parameter_name: 'NEU%', machine_parameter_code: '2007', parameter_unit: '%' },
            { parameter_code: 'LYM_PCT', parameter_name: 'LYM%', machine_parameter_code: '2008', parameter_unit: '%' },
            { parameter_code: 'MON_PCT', parameter_name: 'MON%', machine_parameter_code: '2009', parameter_unit: '%' },
            { parameter_code: 'EOS_PCT', parameter_name: 'EOS%', machine_parameter_code: '2010', parameter_unit: '%' },
            { parameter_code: 'BAS_PCT', parameter_name: 'BAS%', machine_parameter_code: '2011', parameter_unit: '%' },
            { parameter_code: 'NEU_ABS', parameter_name: 'NEU#', machine_parameter_code: '2012', parameter_unit: '10^3/µL' },
            { parameter_code: 'LYM_ABS', parameter_name: 'LYM#', machine_parameter_code: '2013', parameter_unit: '10^3/µL' },
            { parameter_code: 'MON_ABS', parameter_name: 'MON#', machine_parameter_code: '2014', parameter_unit: '10^3/µL' },
            { parameter_code: 'EOS_ABS', parameter_name: 'EOS#', machine_parameter_code: '2015', parameter_unit: '10^3/µL' },
            { parameter_code: 'BAS_ABS', parameter_name: 'BAS#', machine_parameter_code: '2016', parameter_unit: '10^3/µL' },
            { parameter_code: 'RBC', parameter_name: 'RBC', machine_parameter_code: '2017', parameter_unit: '10^6/µL' },
            { parameter_code: 'HGB', parameter_name: 'HGB', machine_parameter_code: '2018', parameter_unit: 'g/dL' },
            { parameter_code: 'MCV', parameter_name: 'MCV', machine_parameter_code: '2019', parameter_unit: 'fL' },
            { parameter_code: 'HCT', parameter_name: 'HCT', machine_parameter_code: '2020', parameter_unit: '%' },
            { parameter_code: 'MCH', parameter_name: 'MCH', machine_parameter_code: '2021', parameter_unit: 'pg' },
            { parameter_code: 'MCHC', parameter_name: 'MCHC', machine_parameter_code: '2022', parameter_unit: 'g/dL' },
            { parameter_code: 'RDW_SD', parameter_name: 'RDW-SD', machine_parameter_code: '2023', parameter_unit: 'fL' },
            { parameter_code: 'RDW_CV', parameter_name: 'RDW-CV', machine_parameter_code: '2024', parameter_unit: '%' },
            { parameter_code: 'PLT', parameter_name: 'PLT', machine_parameter_code: '2025', parameter_unit: '10^3/µL' },
            { parameter_code: 'MPV', parameter_name: 'MPV', machine_parameter_code: '2026', parameter_unit: 'fL' },
            { parameter_code: 'PCT', parameter_name: 'PCT', machine_parameter_code: '2027', parameter_unit: '%' },
            { parameter_code: 'PDW', parameter_name: 'PDW', machine_parameter_code: '2028', parameter_unit: '%' },
            { parameter_code: 'P_LCR', parameter_name: 'P-LCR', machine_parameter_code: '2029', parameter_unit: '%' },
            { parameter_code: 'P_LCC', parameter_name: 'P-LCC', machine_parameter_code: '2030', parameter_unit: '10^3/µL' },
            { parameter_code: 'CRP', parameter_name: 'CRP', machine_parameter_code: '2031', parameter_unit: 'mg/L' }
          ]
        }
      ]
    };

    const templates = ANALYZER_TEST_TEMPLATES[analyzer_name];
    if (!templates) {
      return res.status(400).json({ success: false, message: 'Unsupported analyzer for auto-mapping' });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    let createdCount = 0;
    try {
      // Get all categories to match department name
      const [categories] = await connection.query('SELECT * FROM lab_categories');

      for (const tpl of templates) {
        // Ensure category exists
        let category = categories.find(c => c.name === tpl.department);
        if (!category) {
          const [catRes] = await connection.query('INSERT INTO lab_categories (name, description) VALUES (?, ?)', [tpl.department, tpl.department]);
          category = { id: catRes.insertId, name: tpl.department };
          categories.push(category);
        }

        // Check if test already exists for this exact lab AND analyzer AND test_code
        const [existing] = await connection.query(
          'SELECT id FROM lab_tests WHERE test_code = ? AND lab_id = ?',
          [tpl.test_code, lab_id]
        );

        let testId;
        if (existing.length === 0) {
          // If a global test with same code exists, we might suffix it, but usually test_code is unique per hospital. 
          // However, the schema might enforce test_code uniqueness globally. 
          // Let's try to insert, and handle duplicate test_code gracefully by suffixing Lab ID.
          
          let finalTestCode = tpl.test_code;
          const [globalExisting] = await connection.query('SELECT id FROM lab_tests WHERE test_code = ?', [finalTestCode]);
          if (globalExisting.length > 0) {
            finalTestCode = `${tpl.test_code}_${lab_id}`; 
          }

          const [testResult] = await connection.query(
            `INSERT INTO lab_tests
             (test_code, test_name, category_id, lab_id, sample_type, analyzer_name)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [finalTestCode, tpl.test_name, category.id, lab_id, tpl.sample_type, analyzer_name]
          );
          testId = testResult.insertId;
          createdCount++;

          // Insert parameters
          if (tpl.parameters && tpl.parameters.length > 0) {
            for (let i = 0; i < tpl.parameters.length; i++) {
              const param = tpl.parameters[i];
              await connection.query(
                `INSERT INTO lab_test_parameters 
                 (test_id, parameter_code, parameter_name, parameter_unit, result_type, min_value, max_value, display_order, machine_parameter_code) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  testId,
                  param.parameter_code || null,
                  param.parameter_name,
                  param.parameter_unit,
                  'numeric',
                  param.min_value || null,
                  param.max_value || null,
                  i + 1,
                  param.machine_parameter_code || null
                ]
              );
            }
          }
        }
      }

      await connection.commit();
      res.json({ success: true, message: `Successfully mapped ${createdCount} tests for ${analyzer_name} to the selected lab.`, count: createdCount });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error mapping analyzer tests:', error);
    res.status(500).json({ success: false, message: 'Server error mapping tests' });
  }
};

// GET /api/lab/tests-general — common/general tests not tied to any specific analyzer
export const getGeneralTests = async (req, res) => {
  try {
    const [tests] = await db.query(`
      SELECT t.*, lc.name AS category_name,
             COUNT(p.id)  AS parameter_count
      FROM lab_tests t
      LEFT JOIN lab_categories     lc ON lc.id = t.category_id
      LEFT JOIN lab_test_parameters p  ON p.test_id = t.id AND p.status = 'Active'
      WHERE (t.analyzer_name IS NULL OR t.analyzer_name = '') AND t.status = 'Active' AND t.lab_id IS NULL
      GROUP BY t.id
      ORDER BY t.test_name
    `);

    const testsWithParams = await Promise.all(tests.map(async (test) => {
      const [params] = await db.query(
        'SELECT * FROM lab_test_parameters WHERE test_id = ? AND status = ? ORDER BY display_order',
        [test.id, 'Active']
      );
      return { ...test, parameters: params };
    }));

    res.json({ success: true, tests: testsWithParams });
  } catch (error) {
    console.error('Error fetching general tests:', error);
    res.status(500).json({ success: false, message: 'Server error fetching general tests' });
  }
};

// Get labs from infrastructure (type = 'Lab') with workload
export const getLabs = async (req, res) => {
  try {
    // Get labs with their machine count and current workload
    const [labs] = await db.query(
      `SELECT i.id, i.name, i.block, i.floor, i.status, i.machines_count,
        (SELECT COUNT(*)
         FROM bill_items bi
         JOIN bills b ON bi.bill_id = b.id
         JOIN lab_tests lt ON bi.service_id = lt.id AND bi.service_type = 'Laboratory'
         WHERE lt.lab_id = i.id
         AND b.payment_status IN ('Pending', 'Partial')
         AND bi.status = 'Active') as pending_tasks
       FROM infrastructure i
       WHERE i.type = 'Lab' AND i.status = 'Available'
       ORDER BY i.name`
    );

    // Calculate workload score (pending_tasks / machines_count)
    const labsWithWorkload = labs.map(lab => ({
      ...lab,
      workload_score: lab.machines_count > 0
        ? (lab.pending_tasks / lab.machines_count).toFixed(2)
        : lab.pending_tasks,
      is_available: lab.status === 'Available'
    }));

    res.json({ success: true, labs: labsWithWorkload || [] });
  } catch (error) {
    console.error('Error fetching labs:', error);
    res.status(500).json({ success: false, message: 'Server error fetching labs' });
  }
};

// Get suggested lab for a test (fastest/least loaded)
export const getSuggestedLab = async (req, res) => {
  try {
    const { test_id } = req.query;

    // Get the test's default lab if set
    let defaultLabId = null;
    if (test_id) {
      const [testRows] = await db.query(
        'SELECT lab_id FROM lab_tests WHERE id = ?',
        [test_id]
      );
      if (testRows.length > 0) {
        defaultLabId = testRows[0].lab_id;
      }
    }

    // Get all available labs with workload
    const [labs] = await db.query(
      `SELECT i.id, i.name, i.block, i.floor, i.machines_count,
        (SELECT COUNT(*)
         FROM bill_items bi
         JOIN bills b ON bi.bill_id = b.id
         JOIN lab_tests lt ON bi.service_id = lt.id AND bi.service_type = 'Laboratory'
         WHERE lt.lab_id = i.id
         AND b.payment_status IN ('Pending', 'Partial')
         AND bi.status = 'Active') as pending_tasks
       FROM infrastructure i
       WHERE i.type = 'Lab' AND i.status = 'Available'
       ORDER BY i.name`
    );

    if (labs.length === 0) {
      return res.json({ success: true, suggested_lab: null, all_labs: [] });
    }

    // Calculate workload and find fastest lab
    const labsWithScore = labs.map(lab => {
      const workloadScore = lab.machines_count > 0
        ? lab.pending_tasks / lab.machines_count
        : lab.pending_tasks;
      return {
        ...lab,
        workload_score: workloadScore,
        estimated_wait_minutes: Math.round(workloadScore * 15) // 15 min per task estimate
      };
    });

    // Sort by workload score (ascending - least loaded first)
    labsWithScore.sort((a, b) => a.workload_score - b.workload_score);

    // If test has default lab and it's available, use it; otherwise use fastest
    let suggestedLab = labsWithScore[0]; // Fastest by default
    const defaultLab = defaultLabId ? labsWithScore.find(l => l.id === defaultLabId) : null;

    res.json({
      success: true,
      suggested_lab: defaultLab || suggestedLab,
      fastest_lab: labsWithScore[0],
      all_labs: labsWithScore,
      default_lab: defaultLab || null
    });
  } catch (error) {
    console.error('Error getting suggested lab:', error);
    res.status(500).json({ success: false, message: 'Server error getting suggested lab' });
  }
};

// ============================================
// LAB WORKLIST & SAMPLE COLLECTION
// ============================================

// Get worklist for lab technicians (pending tests by department)
// Machine Master departments are free text ("Hematology Analyzers",
// "Electrolyte Analyzers"); test departments are lab_categories names. A
// machine serves a department when its text contains the name or a known alias.
const DEPT_ALIASES = {
  biochemistry: ['clinical chemistry', 'chemistry', 'electrolyte'],
  hematology: ['haematology', 'coagulation'],
  immunology: ['immunoassay'],
  serology: ['immunoassay'],
  'clinical pathology': ['urine', 'urinalysis'],
  microbiology: ['culture'],
};
const machineServes = (machineDept, category) => {
  const m = String(machineDept || '').toLowerCase();
  const c = String(category || '').toLowerCase();
  if (!m || !c) return false;
  return m.includes(c) || (DEPT_ALIASES[c] || []).some((a) => m.includes(a));
};

// results_json is a JSON column: the driver hands back a parsed array, but older
// rows / other drivers may give a string.
const asResultArray = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? JSON.parse(v || '[]') : []);

// GET /api/lab/verification-workflows — the facility default and each
// discipline's effective workflow (own or inherited).
export const getVerificationWorkflows = async (req, res) => {
  try {
    const wf = await loadWorkflows(db);
    const [cats] = await db.query("SELECT id, name FROM lab_categories WHERE status = 'Active' ORDER BY name");
    res.json({
      success: true,
      default: wf.defaultWorkflow,
      disciplines: cats.map((c) => ({ id: c.id, name: c.name, inherited: !wf.map.has(c.id), workflow: wf.forCategory(c.id) })),
      role_choices: { technical: TECHNICAL_ROLE_CHOICES, clinical: CLINICAL_ROLE_CHOICES },
    });
  } catch (error) {
    console.error('Error reading verification workflows:', error);
    res.status(500).json({ success: false, message: 'Server error reading workflows' });
  }
};

// PUT /api/lab/verification-workflows/:category_id   (0 = facility default)
//   body: { levels, technical_roles[], clinical_roles[], enforce_segregation, auto_verify_normal } or { inherit: true }
export const saveVerificationWorkflow = async (req, res) => {
  try {
    const categoryId = Number(req.params.category_id);
    if (!Number.isInteger(categoryId) || categoryId < 0) return res.status(400).json({ success: false, message: 'Invalid discipline.' });
    if (categoryId > 0) {
      const [[cat]] = await db.query('SELECT id FROM lab_categories WHERE id = ?', [categoryId]);
      if (!cat) return res.status(404).json({ success: false, message: 'Discipline not found.' });
    }
    if (req.body.inherit) {
      if (categoryId === 0) return res.status(400).json({ success: false, message: 'The facility default cannot inherit.' });
      await db.query('DELETE FROM lab_verification_workflows WHERE category_id = ?', [categoryId]);
      return res.json({ success: true, message: 'Discipline now follows the facility default.' });
    }
    const { levels } = req.body;
    const tech = (req.body.technical_roles || []).filter((r) => TECHNICAL_ROLE_CHOICES.includes(r));
    const clin = (req.body.clinical_roles || []).filter((r) => CLINICAL_ROLE_CHOICES.includes(r));
    if (!['Two-level', 'Single'].includes(levels)) return res.status(400).json({ success: false, message: 'Choose Two-level or Single.' });
    if (levels === 'Two-level' && tech.length === 0) return res.status(400).json({ success: false, message: 'Select who may technically validate.' });
    if (clin.length === 0) return res.status(400).json({ success: false, message: 'Select who may authorize (doctor / lab head).' });
    await db.query(
      `INSERT INTO lab_verification_workflows (category_id, levels, technical_roles, clinical_roles, enforce_segregation, auto_verify_normal, updated_by,
                                               critical_notify, critical_notify_minutes, critical_block_approval)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE levels = VALUES(levels), technical_roles = VALUES(technical_roles), clinical_roles = VALUES(clinical_roles),
         enforce_segregation = VALUES(enforce_segregation), auto_verify_normal = VALUES(auto_verify_normal), updated_by = VALUES(updated_by),
         critical_notify = VALUES(critical_notify), critical_notify_minutes = VALUES(critical_notify_minutes), critical_block_approval = VALUES(critical_block_approval)`,
      [categoryId, levels, tech.join(','), clin.join(','), req.body.enforce_segregation ? 1 : 0, levels === 'Two-level' && req.body.auto_verify_normal ? 1 : 0, req.user?.id || null,
       req.body.critical_notify === false ? 0 : 1, Math.min(Math.max(parseInt(req.body.critical_notify_minutes, 10) || 30, 5), 1440), req.body.critical_block_approval === false || req.body.critical_notify === false ? 0 : 1]
    );
    res.json({ success: true, message: 'Workflow saved.' });
  } catch (error) {
    console.error('Error saving verification workflow:', error);
    res.status(500).json({ success: false, message: 'Server error saving workflow' });
  }
};

const ruleNum = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

// GET/PUT /api/lab/result-flag-settings — facility-wide defaults for the
// flagging rules (per-parameter rules are edited with the test itself).
export const getResultFlagSettings = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT setting_key, setting_value, description FROM result_flag_settings ORDER BY setting_key');
    res.json({ success: true, settings: rows });
  } catch (error) {
    console.error('Error reading flag settings:', error);
    res.status(500).json({ success: false, message: 'Server error reading settings' });
  }
};

export const updateResultFlagSettings = async (req, res) => {
  try {
    const incoming = req.body?.settings || {};
    const [known] = await db.query('SELECT setting_key FROM result_flag_settings');
    const allowed = new Set(known.map((k) => k.setting_key));
    for (const [key, value] of Object.entries(incoming)) {
      if (!allowed.has(key)) continue;
      const v = String(value ?? '').trim().slice(0, 500);
      if (['delta_enabled', 'trust_analyzer_alerts'].includes(key) && !['0', '1'].includes(v)) {
        return res.status(400).json({ success: false, message: `${key} must be 0 or 1.` });
      }
      if (['delta_default_days', 'kids_max_age_years'].includes(key) && !(Number(v) > 0)) {
        return res.status(400).json({ success: false, message: `${key} must be a positive number.` });
      }
      if (key === 'delta_default_percent' && v !== '' && !(Number(v) > 0)) {
        return res.status(400).json({ success: false, message: 'Default delta % must be a positive number or blank.' });
      }
      await db.query('UPDATE result_flag_settings SET setting_value = ? WHERE setting_key = ?', [v, key]);
    }
    clearFlagSettingsCache();
    res.json({ success: true, message: 'Flagging rules saved.' });
  } catch (error) {
    console.error('Error saving flag settings:', error);
    res.status(500).json({ success: false, message: 'Server error saving settings' });
  }
};

// GET /api/lab/worklist/version — the facility's change counter; screens poll
// this and reload the worklist only when it moves.
export const getWorklistVersion = (req, res) => {
  const scope = req.user?.role_level !== 'Central' && req.user?.branch_id ? req.user.branch_id
    : (req.query.branch_id && req.query.branch_id !== 'all' ? req.query.branch_id : null);
  res.json({ success: true, version: worklistVersion(scope) });
};

// GET /api/lab/worklist — the smart worklist.
//   Scope:   staff pinned to a facility only ever see that facility; the
//            branch_id param is honoured only for unpinned (central) users.
//   Window:  today's orders, plus any OPEN work (not yet resulted) from the
//            last `days` days (default 7) — pending work must not vanish at
//            midnight, or age and TAT breach could never be seen.
//   Filters: department, priority, test_id, status, analyzer, min_age (hours
//            of open work), tat (breached | at_risk), search.
export const getWorklist = async (req, res) => {
  try {
    const { department, search, priority, test_id, status, analyzer, tat } = req.query;
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
    const minAgeHours = Number(req.query.min_age) > 0 ? Number(req.query.min_age) : 0;
    const scope = req.user?.role_level !== 'Central' && req.user?.branch_id ? req.user.branch_id
      : (req.query.branch_id && req.query.branch_id !== 'all' ? req.query.branch_id : null);

    const params = [];
    let query = `
      SELECT
        bi.id as bill_item_id,
        b.id as bill_id,
        b.bill_number,
        b.branch_id,
        p.id as patient_id,
        p.reg_no,
        CONCAT(p.first_name, ' ', p.last_name) as patient_name,
        lt.id as test_id,
        lt.test_name,
        lt.test_code,
        lt.sample_type,
        lt.tube_color,
        lt.tat_minutes as test_tat,
        lc.tat_minutes as category_tat,
        lc.name as category_name,
        lc.name as department,
        CASE
          WHEN tr.status = 'Rerun Requested' THEN 'Rerun Requested'
          WHEN tr.id IS NOT NULL THEN 'Test Done'
          ELSE bi.status
        END as status,
        bi.sample_id,
        bi.short_id,
        bi.merged_at,
        bi.lab_barcode,
        COALESCE(hl.name, i.name) as current_lab_name,
        lsh.stage as sample_stage,
        b.created_at as bill_date,
        TIMESTAMPDIFF(MINUTE, b.created_at, NOW()) as age_minutes,
        TIMESTAMPDIFF(MINUTE, b.created_at, tr.tested_at) as turnaround_minutes,
        b.priority,
        b.referring_facility,
        b.referring_clinician,
        b.clinical_notes,
        b.billing_type,
        b.scheme_name,
        qt.token_number,
        qt.status as token_status,
        ri.id as referral_id,
        CASE WHEN ri.from_branch_id <> ri.to_branch_id THEN rfb.branch_name END as referred_from,
        rj.reason_label as recollection_reason,
        rj.status as recollection_status,
        tr.id as result_id,
        tr.machine_no as processed_on,
        tr.has_abnormal, tr.has_critical, tr.has_invalid, tr.has_delta,
        tr.results_json,
        tr.tested_at as result_tested_at,
        tr.rerun_reason,
        tr.rerun_requested_at
      FROM bill_items bi
      JOIN bills b ON bi.bill_id = b.id
      JOIN patients p ON b.patient_id = p.id
      JOIN lab_tests lt ON bi.service_id = lt.id
      LEFT JOIN lab_categories lc ON lt.category_id = lc.id
      LEFT JOIN infrastructure i ON bi.lab_id = i.id
      LEFT JOIN lab_test_result tr ON bi.sample_id = tr.sample_id
      LEFT JOIN patient_queue_tokens qt ON qt.bill_id = b.id AND qt.service_point = 'Sample Collection'
      LEFT JOIN sample_rejections rj ON rj.recollect_sample_id = bi.sample_id
      LEFT JOIN lab_samples lsh ON lsh.sample_id = bi.sample_id
      LEFT JOIN infrastructure hl ON hl.id = lsh.holder_lab_id
      LEFT JOIN sample_referrals ri ON ri.sample_id = bi.sample_id AND ri.status = 'Received'
             ${scope ? 'AND ri.to_branch_id = ?' : ''}
             AND lsh.holder_branch_id = ri.to_branch_id
      LEFT JOIN branches rfb ON rfb.id = ri.from_branch_id
      WHERE bi.service_type = 'Laboratory'
      AND bi.status IN ('Pending', 'Collected', 'In Progress', 'Test Done')
      AND b.payment_status IN ('Pending', 'Partial', 'Paid')
      AND (DATE(b.created_at) = CURDATE() OR b.created_at >= CURDATE() - INTERVAL ? DAY OR ri.id IS NOT NULL)
      AND (lsh.stage IS NULL OR lsh.stage <> 'In Transit')
    `;
    if (scope) params.push(scope);
    params.push(days);

    // A sample referred in from another facility is this lab's work too; one
    // referred OUT is no longer on this lab's bench.
    if (scope) {
      query += ` AND ((b.branch_id = ? AND (lsh.holder_branch_id IS NULL OR lsh.holder_branch_id = b.branch_id)) OR ri.id IS NOT NULL)`;
      params.push(scope);
    }
    if (department && department !== 'all') { query += ` AND LOWER(lc.name) = LOWER(?)`; params.push(department); }
    if (priority && priority !== 'all') { query += ` AND b.priority = ?`; params.push(priority); }
    if (test_id) { query += ` AND lt.id = ?`; params.push(test_id); }

    // One box, any identifier the operator happens to be holding — see utils/identifierSearch.js.
    if (search) {
      const { clause, params: searchParams } = identifierSearchClause(search, {
        patients: 'p', billItems: 'bi', sampleId: 'bi.sample_id', testName: 'lt.test_name',
      });
      query += clause;
      params.push(...searchParams);
    }

    query += ` GROUP BY bi.bill_id, bi.service_id, bi.id, b.id, p.id, lt.id, lc.name, tr.id, qt.id, rj.id, ri.id, rfb.branch_name, hl.name, ri.from_branch_id, ri.to_branch_id`;
    // STAT/Urgent first; within a priority, oldest first.
    query += ` ORDER BY FIELD(b.priority, 'STAT', 'Urgent', 'Routine'), b.created_at ASC`;
    const [rows] = await db.query(query, params);

    // Analyzers at this facility, joined to the department each model serves
    // (Machine Master) — gives every row an analyzer status without a
    // per-row lookup.
    const [machines] = await db.query(
      `SELECT m.id, m.name, m.model, m.status, i.branch_id, LOWER(mm.department) AS department
       FROM lab_machines m
       JOIN infrastructure i ON i.id = m.lab_id
       LEFT JOIN machine_models mm ON mm.manufacturer = m.manufacturer AND mm.model = m.model
       ${scope ? 'WHERE i.branch_id = ?' : ''}`,
      scope ? [scope] : []
    );
    const isLive = (m) => ['Online', 'Active'].includes(m.status);

    // Overdue preventive maintenance — a WARNING on the rows the equipment
    // serves. It never changes whether a test can be run.
    const [overdueTasks] = machines.length
      ? await db.query(
          `SELECT machine_id, task_name, DATEDIFF(CURDATE(), next_due_at) AS days_overdue
           FROM equipment_pm_schedules WHERE active = 1 AND next_due_at < CURDATE() AND machine_id IN (?)`, [machines.map((m) => m.id)])
      : [[]];

    // Parameter counts for tests mid-run, in one query rather than one per row.
    const runningIds = [...new Set(rows.filter((r) => r.status === 'In Progress').map((r) => r.test_id))];
    const paramsByTest = {};
    if (runningIds.length) {
      const [pr] = await db.query('SELECT test_id, parameter_name FROM lab_test_parameters WHERE test_id IN (?)', [runningIds]);
      for (const r of pr) (paramsByTest[r.test_id] ||= []).push(r.parameter_name);
    }

    const expiredReagents = (await currentReagents({ scopeBranch: scope })).filter((r) => r.state !== 'OK');

    let queueNo = 1;
    const billQueueMap = {};
    let worklist = rows.map((item) => {
      if (!billQueueMap[item.bill_id]) billQueueMap[item.bill_id] = queueNo++;

      // Progress through the lab: ordered → collected → received → processing → resulted.
      const done = item.status === 'Test Done' || item.status === 'Rerun Requested';
      const step = done ? 5
        : (item.status === 'In Progress' || item.sample_stage === 'Processing') ? 4
        : item.sample_stage === 'Received' ? 3
        : (item.status === 'Collected' || item.sample_stage === 'Collected') ? 2 : 1;

      let pending_params = [];
      let parameters_total = 0;
      let parameters_received = 0;
      if (item.status === 'In Progress') {
        let receivedNames = [];
        try { receivedNames = asResultArray(item.results_json).map((r) => String(r.parameter_name || '').toLowerCase()); } catch { receivedNames = []; }
        const all = paramsByTest[item.test_id] || [];
        pending_params = all.filter((n) => !receivedNames.includes(n.toLowerCase()));
        parameters_total = all.length;
        parameters_received = all.length - pending_params.length;
      }

      const dept = String(item.department || '').toLowerCase();
      const candidates = machines.filter((m) => machineServes(m.department, dept));
      const online = candidates.filter(isLive).length;
      const maintenance_overdue = overdueTasks
        .filter((t) => candidates.some((m) => m.id === t.machine_id))
        .map((t) => ({ analyzer: candidates.find((m) => m.id === t.machine_id).name, task: t.task_name, days_overdue: Number(t.days_overdue) }));
      const reagent_warnings = expiredReagents
        .filter((r) => candidates.some((m) => m.id === r.machine_id))
        .map((r) => ({ analyzer: r.machine_name, reagent: r.reagent_name, lot: r.lot_no, state: r.state, days_left: r.days_left }));
      const analyzer_status = candidates.length === 0 ? 'Not mapped'
        : online > 0 ? 'Online'
        : candidates.some((m) => m.status === 'Maintenance') ? 'Maintenance' : 'Offline';

      const tatTarget = effectiveTat({ testTat: item.test_tat, categoryTat: item.category_tat, priority: item.priority });
      const elapsed = done && item.turnaround_minutes != null ? Number(item.turnaround_minutes) : Number(item.age_minutes);
      const tat_status = tatStatus({ elapsedMinutes: elapsed, tat: tatTarget, done });

      return {
        ...item,
        lab_queue_number: billQueueMap[item.bill_id],
        pending_params,
        parameters_total,
        parameters_received,
        progress_step: step,
        analyzer: item.processed_on || null,
        analyzer_status,
        maintenance_overdue,
        reagent_warnings,
        analyzers_online: online,
        analyzers_total: candidates.length,
        tat_minutes: tatTarget,
        tat_status,
        tat_remaining_minutes: done ? null : tatTarget - elapsed,
        is_open: !done,
      };
    });

    // Filters that depend on the computed fields.
    if (['Pending', 'Collected', 'In Progress', 'Test Done', 'Rerun Requested'].includes(status)) worklist = worklist.filter((w) => w.status === status);
    if (analyzer && analyzer !== 'all') {
      const target = machines.find((m) => m.name === analyzer);
      worklist = worklist.filter((w) => w.analyzer === analyzer || (target && machineServes(target.department, w.department)));
    }
    if (minAgeHours) worklist = worklist.filter((w) => w.is_open && w.age_minutes >= minAgeHours * 60);
    if (tat === 'breached') worklist = worklist.filter((w) => w.tat_status === 'Breached');
    else if (tat === 'at_risk') worklist = worklist.filter((w) => w.tat_status === 'At risk' || w.tat_status === 'Breached');

    const open = worklist.filter((w) => w.is_open);
    res.json({
      success: true,
      worklist,
      count: worklist.length,
      summary: {
        open: open.length,
        breached: open.filter((w) => w.tat_status === 'Breached').length,
        at_risk: open.filter((w) => w.tat_status === 'At risk').length,
        stat: open.filter((w) => w.priority === 'STAT').length,
        urgent: open.filter((w) => w.priority === 'Urgent').length,
        awaiting_verification: worklist.filter((w) => w.status === 'Test Done').length,
      },
      analyzers: machines.map((m) => ({ name: m.name, model: m.model, status: m.status, department: m.department })),
      version: worklistVersion(scope),
    });
  } catch (error) {
    console.error('Error fetching worklist:', error);
    res.status(500).json({ success: false, message: 'Server error fetching worklist' });
  }
};

export const getWorklistById = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();

    // The analyzer reports either the full sample ID (globally unique — safe
    // to match on any day) or just the running number the technician keyed in
    // (the last four digits). That short number is only unique within ONE
    // facility on ONE day, so it is matched against today's samples at the
    // caller's own branch only. Without that, a number not yet billed today
    // could resolve to an old unfinished sample with the same four digits —
    // or to another facility's — and the result would land on the wrong
    // patient.
    const shortPart = id.slice(-4);
    const scopeBranch = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;

    const [rows] = await db.query(`
      SELECT
        bi.id as bill_item_id,
        b.id as bill_id,
        p.id as patient_id,
        CONCAT(p.first_name, ' ', p.last_name) as patient_name,
        lt.id as test_id,
        lt.test_name,
        bi.sample_id,
        bi.short_id,
        bi.merged_at,
        bi.status
      FROM bill_items bi
      JOIN bills b ON bi.bill_id = b.id
      JOIN patients p ON b.patient_id = p.id
      JOIN lab_tests lt ON bi.service_id = lt.id
      WHERE (
              bi.sample_id = ?
              OR (bi.short_id = ? AND DATE(b.created_at) = CURDATE() ${scopeBranch ? `AND b.branch_id = ? AND NOT EXISTS (SELECT 1 FROM lab_samples x WHERE x.sample_id = bi.sample_id AND x.holder_branch_id IS NOT NULL AND x.holder_branch_id <> b.branch_id)` : ''})
              ${scopeBranch ? `OR (bi.short_id = ? AND EXISTS (SELECT 1 FROM sample_referrals r
                    WHERE r.sample_id = bi.sample_id AND r.to_branch_id = ? AND r.status = 'Received' AND DATE(r.received_at) = CURDATE()))` : ''}
            )
      AND bi.status IN ('Pending', 'Collected', 'In Progress')
      ORDER BY (bi.sample_id = ?) DESC, bi.id DESC
      LIMIT 1
    `, scopeBranch ? [id, shortPart, scopeBranch, shortPart, scopeBranch, id] : [id, shortPart, id]);

    if (rows.length === 0) {
      return res.json({ success: false, message: 'No active test found' });
    }

    // ?all=1 — everything still to be run on this specimen, with the details an analyzer needs
    // when it asks the LIS what to do with a sample (host query / worklist download).
    if (req.query.all) {
      const [tests] = await db.query(
        `SELECT bi.id AS bill_item_id, lt.id AS test_id, lt.test_name, lt.test_code, lt.loinc_code, lt.sample_type
           FROM bill_items bi JOIN lab_tests lt ON bi.service_id = lt.id
          WHERE bi.sample_id = ? AND bi.status IN ('Pending', 'Collected', 'In Progress') ORDER BY bi.id`, [rows[0].sample_id]);
      const [[pt]] = await db.query(
        `SELECT p.reg_no, p.first_name, p.last_name, p.gender, p.dob, b.priority FROM bills b JOIN patients p ON p.id = b.patient_id WHERE b.id = ?`, [rows[0].bill_id]);
      return res.json({ success: true, test: rows[0], tests, patient: pt || null });
    }

    res.json({ success: true, test: rows[0] });
  } catch (error) {
    console.error('Error fetching worklist by id:', error);
    res.status(500).json({ success: false });
  }
};

// Generate sample ID sequence — atomic per branch+department per day, race-condition-proof
export const generateSampleId = async (req, res) => {
  try {
    const { branch_id, department } = req.body;

    if (!branch_id) {
      return res.status(400).json({ success: false, message: 'branch_id is required' });
    }

    const { sampleId, shortId, sequence } = await generateSampleIdForItem(db, branch_id, department, {
      id: req.user?.id || null, role: req.user?.role || null, ip: req.ip,
    });

    res.json({
      success: true,
      sequence,
      sampleId,
      shortId
    });
  } catch (error) {
    console.error('Error generating sample ID:', error);
    res.status(500).json({ success: false, message: 'Server error generating sample ID' });
  }
};

// Track Test Status by Reference Number
export const trackTestStatus = async (req, res) => {
  try {
    const { referenceNumber } = req.params;
    
    // The referenceNumber could be the bill_number or lab_barcode.
    const [rows] = await db.query(
      `SELECT bi.id, bi.service_name as test_name, bi.status as current_status,
              bi.created_at as billed_at, bi.updated_at,
              b.patient_name, b.bill_number,
              lr.status as report_status, lr.created_at as report_generated_at, lr.verified_at
       FROM bill_items bi
       JOIN bills b ON bi.bill_id = b.id
       LEFT JOIN lab_reports lr ON bi.id = lr.bill_item_id
       WHERE bi.lab_barcode = ? OR b.bill_number = ?`,
      [referenceNumber, referenceNumber]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invalid reference number. No tests found.' });
    }

    const test = rows[0];

    // Build the status tracking history
    const timeline = [];

    timeline.push({
      status: 'Billed',
      completed: true,
      timestamp: test.billed_at,
      description: 'Your lab test has been successfully booked.'
    });

    // Acknowledged
    const isAcknowledged = ['Collected', 'In Progress', 'Test Done', 'Completed'].includes(test.current_status);
    timeline.push({
      status: 'Acknowledged',
      completed: isAcknowledged,
      timestamp: isAcknowledged ? (test.current_status === 'Collected' ? test.updated_at : null) : null,
      description: 'Sample collection confirmed by the laboratory.'
    });

    // Test Done
    const isTestDone = ['Test Done', 'Completed'].includes(test.current_status);
    timeline.push({
      status: 'Test Done',
      completed: isTestDone,
      timestamp: isTestDone ? (test.current_status === 'Test Done' ? test.updated_at : null) : null,
      description: 'Laboratory analysis has been completed.'
    });

    // Waiting for doctor to verify
    const isWaitingVerify = !!test.report_status || test.current_status === 'Completed';
    timeline.push({
      status: 'Waiting for doctor to verify',
      completed: isWaitingVerify,
      timestamp: isWaitingVerify ? test.report_generated_at : null,
      description: 'Report generated and awaiting medical verification.'
    });

    // Test completed (Verified)
    const isCompleted = test.report_status === 'Verified';
    timeline.push({
      status: 'Test Completed',
      completed: isCompleted,
      timestamp: isCompleted ? test.verified_at : null,
      description: 'Report verified and ready for download.'
    });

    res.json({
      success: true,
      data: {
        patient_name: test.patient_name,
        test_name: test.test_name,
        reference_number: referenceNumber,
        current_status: test.current_status,
        timeline
      }
    });

  } catch (error) {
    console.error('Error tracking test:', error);
    res.status(500).json({ success: false, message: 'Server error tracking test status' });
  }
};

// Book lab tests for a patient
export const bookLabTests = async (req, res) => {
  try {
    const { regNo, tests, appointmentDate, appointmentTime, priority } = req.body;

    if (!regNo || !tests || !Array.isArray(tests) || tests.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Patient registration number and tests are required'
      });
    }

    // Get patient by registration number
    const [patients] = await db.query(
      'SELECT id FROM patients WHERE reg_no = ?',
      [regNo]
    );

    if (patients.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    const patientId = patients[0].id;

    // Calculate total amount
    const totalAmount = tests.reduce((sum, test) => sum + (test.price || 0), 0);

    // Generate bill number
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const [billCount] = await db.query(
      'SELECT COUNT(*) as count FROM bills WHERE DATE(created_at) = CURDATE()'
    );
    const billNumber = `BILL-${date}-${(billCount[0].count + 1).toString().padStart(4, '0')}`;

    // Create bill
    const [billResult] = await db.query(
      `INSERT INTO bills (patient_id, bill_number, total_amount, payment_status, created_at, updated_at) 
       VALUES (?, ?, ?, 'Pending', NOW(), NOW())`,
      [patientId, billNumber, totalAmount]
    );

    const billId = billResult.insertId;

    // Create bill items for each test
    const billItems = [];
    for (const test of tests) {
      const price = test.price || 0;
      const [result] = await db.query(
        `INSERT INTO bill_items (bill_id, service_type, service_id, service_name, unit_price, total_price, status, created_at, updated_at)
         VALUES (?, 'Laboratory', ?, ?, ?, ?, 'Pending', NOW(), NOW())`,
        [billId, test.test_id, test.test_name, price, price]
      );
      billItems.push({
        id: result.insertId,
        test_name: test.test_name,
        price: price
      });
    }

    res.json({
      success: true,
      message: 'Lab tests booked successfully',
      bill: {
        id: billId,
        bill_number: billNumber,
        total_amount: totalAmount,
        items: billItems
      }
    });
  } catch (error) {
    console.error('Error booking lab tests:', error);
    res.status(500).json({ success: false, message: 'Server error booking lab tests' });
  }
};

// Acknowledge test and update status
export const acknowledgeTest = async (req, res) => {
  try {
    const { bill_item_id, sample_id, short_id, status, collected_by } = req.body;

    if (!bill_item_id) {
      return res.status(400).json({
        success: false,
        message: 'Bill item ID is required'
      });
    }

    // Fetch existing row so we can keep its sample_id / short_id if the caller didn't supply them
    const [[existing]] = await db.query(
      `SELECT sample_id, short_id FROM bill_items WHERE id = ? LIMIT 1`,
      [bill_item_id]
    );

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Bill item not found' });
    }

    const effectiveSampleId = sample_id || existing.sample_id;
    const effectiveShortId  = short_id  || existing.short_id;

    // Update bill item with sample ID, status and collector
    const [result] = await db.query(
      `UPDATE bill_items
       SET sample_id = ?, short_id = ?, status = ?, collected_by = ?, updated_at = NOW()
       WHERE id = ?`,
      [effectiveSampleId, effectiveShortId, status || 'Collected', collected_by || null, bill_item_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bill item not found'
      });
    }

    // Sample lifecycle: acknowledging at the worklist is the collection step.
    // Best-effort — tracking must never block recording the collection itself.
    if ((status || 'Collected') === 'Collected' && effectiveSampleId) {
      await advanceSampleInOwnTransaction(db, {
        sample_id: effectiveSampleId, to: 'Collected', note: 'Acknowledged at the worklist',
        actor: actorFromReq(req, { id: req.user?.id || collected_by || null }),
      });
    }

    // --- CDAC SAMPLE COLLECTED PUSH ---
    // Only fires for bill_items that originated from a CDAC pull (most don't).
    // Never throws into the main response — a failed/slow CDAC call must not
    // block sample collection from being recorded locally.
    try {
      const [[cdacReq]] = await db.query(
        `SELECT * FROM cdac_lab_requisitions WHERE bill_item_id = ? LIMIT 1`,
        [bill_item_id]
      );

      if (cdacReq && (status || 'Collected') === 'Collected') {
        const branchConfig = await cdacService.getBranchCdacConfig(cdacReq.branch_id);

        if (branchConfig?.integration_type === 'CDAC' && branchConfig.is_active) {
          try {
            await cdacService.pushSampleCollectionAndRequisitionDtls(
              buildSampleCollectionPayload(cdacReq),
              branchConfig
            );
            await db.query(
              `UPDATE cdac_lab_requisitions SET last_pushed_status = 'SAMPLE_COLLECTED', last_pushed_at = NOW(), last_push_error = NULL WHERE id = ?`,
              [cdacReq.id]
            );
          } catch (cdacErr) {
            console.error('CDAC sample-collected push failed:', cdacErr.message);
            await db.query(
              `UPDATE cdac_lab_requisitions SET last_push_error = ? WHERE id = ?`,
              [String(cdacErr.message).slice(0, 1000), cdacReq.id]
            );
          }
        }
      }
    } catch (cdacLookupErr) {
      console.error('CDAC sample-collected lookup error:', cdacLookupErr.message);
    }
    // --- END CDAC SAMPLE COLLECTED PUSH ---

    // Automated WhatsApp Notification: Ping the NEXT two patients in line
    try {
      const [nextPatientsResult] = await db.query(
        `SELECT 
        b.patient_name,
        p.telephone as patient_phone,
        b.id as bill_id,
        MIN(i.name) as lab_name
        FROM bill_items bi
        JOIN bills b ON bi.bill_id = b.id
        JOIN patients p ON b.patient_id = p.id
         LEFT JOIN infrastructure i ON bi.lab_id = i.id
         WHERE bi.service_type = 'Laboratory'
           AND bi.status = 'Pending'
           AND DATE(b.created_at) = CURDATE()
           AND b.id != (SELECT bill_id FROM bill_items WHERE id = ?)
         GROUP BY b.id, b.patient_name, p.telephone
         ORDER BY MIN(b.created_at) ASC
         LIMIT 2`,
         [bill_item_id]
      );

      for (let idx = 0; idx < nextPatientsResult.length; idx++) {
        const nextPatient = nextPatientsResult[idx];
        if (nextPatient.patient_phone) {
          // Find their queue number
          const [queueResult] = await db.query(
            `SELECT COUNT(DISTINCT b.id) as count 
             FROM bills b
             JOIN bill_items bi ON b.id = bi.bill_id
             WHERE DATE(b.created_at) = CURDATE() AND bi.service_type = 'Laboratory' AND b.id <= ?`,
            [nextPatient.bill_id]
          );
          const queueNumber = queueResult[0]?.count || 1;

          let formattedPhone = nextPatient.patient_phone.replace(/[^0-9]/g, '');
          if (formattedPhone.length === 10) formattedPhone = '91' + formattedPhone;

          const assignedLabName = nextPatient.lab_name || 'the Main Laboratory';

          let textMsg = '';
          if (idx === 0) {
            textMsg = `🏥 *HIMS Lab Notification*\nHello ${nextPatient.patient_name}, the patient before you has just been called.\n\n*Now it's your turn!* Please proceed to *${assignedLabName} LAB*. Your Token is *#${queueNumber}*.`;
          } else if (idx === 1) {
            textMsg = `🏥 *HIMS Lab Notification*\nHello ${nextPatient.patient_name}, there is *1 more patient* ahead of you.\n\nPlease make sure you have reached *${assignedLabName} LAB* so you are ready when called. Your Token is *#${queueNumber}*.`;
          }

          const msgData = JSON.stringify({
            phone: formattedPhone,
            text: textMsg
          });

          const botUrl = new URL(process.env.WHATSAPP_BOT_URL || 'http://localhost:3000');
          const req = http.request({
            hostname: botUrl.hostname,
            port: botUrl.port || (botUrl.protocol === 'https:' ? 443 : 80),
            path: '/send-message',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(msgData)
            }
          });
          req.on('error', e => console.log('WhatsApp HTTP error:', e.message));
          req.write(msgData);
          req.end();
        }
      }
    } catch (notifyErr) {
      console.error('Error sending next patient notification:', notifyErr);
    }

    res.json({
      success: true,
      message: 'Test acknowledged successfully',
      sample_id: effectiveSampleId,
      short_id: effectiveShortId,
      status: status || 'Collected'
    });
  } catch (error) {
    console.error('Error acknowledging test:', error);
    res.status(500).json({ success: false, message: 'Server error acknowledging test' });
  }
};

// Update test status (for In Progress, Completed)
export const updateTestStatus = async (req, res) => {
  try {
    const { bill_item_id, status } = req.body;

    if (!bill_item_id || !status) {
      return res.status(400).json({
        success: false,
        message: 'Bill item ID and status are required'
      });
    }

    const validStatuses = ['Pending', 'Collected', 'In Progress', 'Test Done', 'Completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
      });
    }

    const [result] = await db.query(
      `UPDATE bill_items 
       SET status = ?, updated_at = NOW()
       WHERE id = ?`,
      [status, bill_item_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bill item not found'
      });
    }

    res.json({
      success: true,
      message: 'Status updated successfully',
      status
    });
  } catch (error) {
    console.error('Error updating test status:', error);
    res.status(500).json({ success: false, message: 'Server error updating status' });
  }
};

/**
 * Get Lab Activity Logs (Audit Trail)
 */
export const getActivityLogs = async (req, res) => {
  const { branch_id, search, limit = 50 } = req.query;
  try {
    let query = `
      SELECT 
        bi.id as bill_item_id,
        bi.sample_id,
        bi.service_name as test_name,
        bi.status as current_status,
        bi.created_at as billed_at,
        bi.updated_at as status_updated_at,
        p.id as patient_id,
        p.first_name as patient_first_name,
        p.last_name as patient_last_name,
        ltr.tested_at,
        ltr.verified_at,
        ltr.machine_no,
        ltr.status as result_status,
        -- Billed By
        CONCAT(bu.first_name, ' ', bu.last_name) as billed_by_name,
        -- Acknowledged By
        CONCAT(cu.first_name, ' ', cu.last_name) as acknowledged_by_name,
        -- Run By
        CONCAT(tu.first_name, ' ', tu.last_name) as technician_name,
        -- Verified By
        CONCAT(vu.first_name, ' ', vu.last_name) as verifier_name,
        -- Approved By
        CONCAT(au.first_name, ' ', au.last_name) as approver_name
      FROM bill_items bi
      JOIN bills b ON bi.bill_id = b.id
      JOIN patients p ON b.patient_id = p.id
      LEFT JOIN lab_test_result ltr ON bi.id = ltr.bill_item_id
      LEFT JOIN users bu ON b.created_by = bu.id
      LEFT JOIN users cu ON bi.collected_by = cu.id
      LEFT JOIN users tu ON ltr.tested_by = tu.id
      LEFT JOIN users vu ON ltr.verified_by = vu.id
      LEFT JOIN users au ON ltr.approved_by = au.id
      WHERE bi.service_type = 'Laboratory'
    `;
    const params = [];

    if (search) {
      query += ` AND (bi.sample_id LIKE ? OR p.first_name LIKE ? OR bi.service_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY bi.created_at DESC LIMIT ?`;
    params.push(parseInt(limit));

    const [logs] = await db.query(query, params);
    res.json({ success: true, logs });
  } catch (err) {
    console.error('getActivityLogs error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// TEST RESULTS - PARAMETER BASED
// ============================================

// Save test results from lab machine
// GET /api/lab/manual-entry/reasons — the reasons offered when a result is typed by hand.
export const getManualEntryReasons = (req, res) => res.json({ success: true, reasons: MANUAL_REASONS, allowed: canEnterManually(req.user) });

// GET /api/lab/manual-entry/form/:billItemId — what a technician needs to type a
// result in by hand: the test, who it is for, each parameter with unit and
// reference range, and anything already entered.
export const getManualEntryForm = async (req, res) => {
  try {
    if (!canEnterManually(req.user)) return res.status(403).json({ success: false, message: 'Your role cannot enter results by hand.' });
    const scope = req.user?.role_level !== 'Central' ? req.user?.branch_id : null;
    const [[item]] = await db.query(
      `SELECT bi.id AS bill_item_id, bi.service_id AS test_id, bi.service_name AS test_name, bi.sample_id, bi.status, b.branch_id,
              CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name, p.gender, p.dob, lt.analyzer_name
         FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
         LEFT JOIN patients p ON p.id = b.patient_id LEFT JOIN lab_tests lt ON lt.id = bi.service_id
        WHERE bi.id = ? AND bi.service_type = 'Laboratory' ${scope ? 'AND b.branch_id = ?' : ''}`,
      scope ? [req.params.billItemId, scope] : [req.params.billItemId]);
    if (!item) return res.status(404).json({ success: false, message: 'Test not found.' });

    const [params] = await db.query(
      "SELECT * FROM lab_test_parameters WHERE test_id = ? AND status = 'Active' ORDER BY display_order, id", [item.test_id]);
    const years = item.dob ? (Date.now() - new Date(item.dob).getTime()) / (365.25 * 24 * 3600 * 1000) : null;
    const gender = String(item.gender || '').toLowerCase();
    const range = (p) => {
      let lo = p.min_value; let hi = p.max_value;
      if (p.use_demographic_ranges) {
        if (years !== null && years < 12 && p.kids_min_value !== null) { lo = p.kids_min_value; hi = p.kids_max_value; }
        else if (gender.startsWith('m') && p.men_min_value !== null) { lo = p.men_min_value; hi = p.men_max_value; }
        else if (gender.startsWith('f') && p.women_min_value !== null) { lo = p.women_min_value; hi = p.women_max_value; }
      }
      return lo !== null && hi !== null ? `${Number(lo)} - ${Number(hi)}` : '';
    };

    const [[existing]] = await db.query(
      'SELECT results_json, status FROM lab_test_result WHERE bill_item_id = ? ORDER BY id DESC LIMIT 1', [item.bill_item_id]);
    let entered = [];
    try { entered = existing ? (typeof existing.results_json === 'string' ? JSON.parse(existing.results_json) : existing.results_json) || [] : []; } catch { entered = []; }
    const valueOf = (name) => entered.find((r) => String(r.parameter_name || '').toLowerCase() === String(name).toLowerCase())?.result_value ?? '';

    res.json({
      success: true,
      reasons: MANUAL_REASONS,
      test: {
        bill_item_id: item.bill_item_id, test_id: item.test_id, test_name: item.test_name, sample_id: item.sample_id, status: item.status,
        patient_name: item.patient_name, gender: item.gender, age: years !== null ? Math.floor(years) : null,
        interfaced: !!String(item.analyzer_name || '').trim(),
        result_status: existing?.status || null,
      },
      parameters: params.map((p) => ({
        parameter_name: p.parameter_name, unit: p.parameter_unit || '', reference_range: range(p), result_type: p.result_type,
        options: p.result_type === 'select' ? String(p.options || '').split(/[\n,;|]+/).map((o) => o.trim()).filter(Boolean) : [],
        calculated: !!p.is_calculated, value: valueOf(p.parameter_name),
      })),
    });
  } catch (error) {
    console.error('Error building manual entry form:', error);
    res.status(500).json({ success: false, message: 'Server error loading the entry form' });
  }
};

export const saveTestResults = async (req, res) => {
  // A result typed or changed by hand needs an authorised role and a reason —
  // decided before anything is touched (tender #33).
  const manual = manualEntryCheck(req);
  if (manual.error) return res.status(manual.error.status).json({ success: false, code: manual.error.code, message: manual.error.message });

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const {
      sample_id,
      machine_no,
      bill_item_id,
      test_id,
      test_name,
      results, // Array of parameter results
      tested_by,
      patient_id,
      status: requestedStatus,
    } = req.body;

    // Only allow machine-facing statuses; default to 'Test Done' so results
    // always land in the verification queue rather than being auto-approved.
    const resultStatus = ['Test Done', 'In Progress'].includes(requestedStatus)
      ? requestedStatus
      : 'Test Done';

    // Validate required fields
    if (!sample_id || !results || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'sample_id and results array are required'
      });
    }

    const testedAt = new Date();

    // Look up patient_id and lab_id from bill_items if not provided
    let resolvedPatientId = patient_id;
    let labId = null;
    
    const [billItem] = await connection.query(
      `SELECT b.patient_id, bi.lab_id, bi.service_id, b.branch_id AS bill_branch_id FROM bill_items bi 
       JOIN bills b ON bi.bill_id = b.id 
       WHERE bi.sample_id = ? OR bi.id = ? LIMIT 1`,
      [sample_id, bill_item_id || null]
    );
    
    if (billItem && billItem.length > 0) {
      if (!resolvedPatientId) resolvedPatientId = billItem[0].patient_id;
      labId = billItem[0].lab_id;
      var stockBranchId = billItem[0].bill_branch_id;
    }
    const rulesTestId = test_id || billItem?.[0]?.service_id || null;
    let flagSummary = { abnormal: 0, critical: 0, invalid: 0, delta: 0 };

    // Flags are computed here, on the server, from the configured rules — an
    // analyzer's own H/L is only an input. Never lets a rules problem block
    // saving a result.
    const applyRules = async (rows, excludeId) => {
      try {
        const ev = await evaluateResults(connection, { results: rows, test_id: rulesTestId, patient_id: resolvedPatientId, exclude_result_id: excludeId, before: testedAt });
        flagSummary = ev.summary;
        return ev.results;
      } catch (err) {
        console.error('Result flag evaluation failed:', err.message);
        return rows;
      }
    };

    // CHECK IF RESULTS ALREADY EXIST — prefer bill_item_id lookup, fall back to sample_id
    const [existing] = await connection.query(
      bill_item_id
        ? `SELECT id, results_json, status, report_version, verified_by, approved_by, approved_at, branch_id FROM lab_test_result WHERE bill_item_id = ? ORDER BY id DESC LIMIT 1`
        : `SELECT id, results_json, status, report_version, verified_by, approved_by, approved_at, branch_id FROM lab_test_result WHERE sample_id   = ? ORDER BY id DESC LIMIT 1`,
      [bill_item_id || sample_id]
    );

    // Editing a result that has already been validated or authorized is an
    // amendment: it needs a reason, keeps the old version, revokes the old
    // signature and sends the result back for validation and authorization.
    const auditActor = actorFromReq(req, { id: req.user?.id || tested_by || null, station: machine_no ? `Analyzer ${machine_no}` : undefined });
    const editReason = String(req.body.edit_reason || req.body.amend_reason || '').trim();
    let amendment = null;
    if (existing && existing.length > 0) {
      const prev = existing[0];
      if (prev.status === 'Cancelled') {
        await connection.rollback();
        return res.status(409).json({ success: false, code: 'REPORT_CANCELLED', message: 'This report was cancelled. Reissue it before changing results.' });
      }
      if (['Verified', 'Approved'].includes(prev.status)) {
        if (editReason.length < 5) {
          await connection.rollback();
          return res.status(409).json({
            success: false, code: 'AMENDMENT_REASON_REQUIRED',
            message: `This result is already ${prev.status}. Give a reason (at least 5 characters) to amend it — it will need validation and authorization again.`,
          });
        }
        amendment = { reason: editReason, from: prev.status, version: Number(prev.report_version || 1) };
      }
    }
    const oldSnapshot = existing && existing.length > 0 ? JSON.parse(JSON.stringify(asResultArray(existing[0].results_json))) : null;
    if (amendment) await snapshotVersion(connection, { result: existing[0], reason: amendment.reason, actor: auditActor });

    if (existing && existing.length > 0) {
      // APPEND LOGIC
      let currentResults = [];
      try {
        currentResults = asResultArray(existing[0].results_json);
      } catch (e) {
        currentResults = [];
      }

      // Merge new results into existing (overwrite if same parameter name)
      results.forEach(newRes => {
        const idx = currentResults.findIndex(r => r.parameter_name === newRes.parameter_name);
        if (idx !== -1) {
          currentResults[idx] = newRes;
        } else {
          currentResults.push(newRes);
        }
      });

      // Re-submitting results (e.g. after a doctor's rerun request) clears
      // the rerun fields — a fresh result no longer needs the old flag/reason.
      currentResults = await applyRules(currentResults, existing[0].id);
      await connection.query(
        `UPDATE lab_test_result
         SET results_json = ?, machine_no = COALESCE(?, machine_no), tested_at = NOW(), status = ?,
             rerun_reason = NULL, rerun_requested_by = NULL, rerun_requested_at = NULL,
             has_abnormal = ?, has_critical = ?, has_invalid = ?, has_delta = ?
         WHERE id = ?`,
        [JSON.stringify(currentResults), machine_no || null, resultStatus,
         flagSummary.abnormal > 0 ? 1 : 0, flagSummary.critical > 0 ? 1 : 0, flagSummary.invalid > 0 ? 1 : 0, flagSummary.delta > 0 ? 1 : 0, existing[0].id]
      );
      var finalResultId = existing[0].id;
      var finalResultsForAuto = currentResults;

      const diff = diffResults(oldSnapshot, currentResults);
      if (amendment) {
        await connection.query(
          `UPDATE lab_test_result SET verified_by = NULL, verified_at = NULL, approved_by = NULL, approved_at = NULL,
                  report_version = report_version + 1 WHERE id = ?`, [finalResultId]);
        await connection.query("UPDATE bill_items SET status = 'Test Done', updated_at = NOW() WHERE sample_id = ? AND status = 'Completed'", [sample_id]);
        await logResultAudit(connection, {
          result_id: finalResultId, sample_id, branch_id: existing[0].branch_id, action: 'Edited after authorization — re-verification required',
          from_status: amendment.from, to_status: 'Test Done', actor: auditActor, reason: amendment.reason, version: amendment.version + 1, details: diff,
          note: 'Previous signature revoked; previous version kept',
        });
      } else if (existing[0].status === 'Rerun Requested') {
        await logResultAudit(connection, { result_id: finalResultId, sample_id, branch_id: existing[0].branch_id, action: 'Rerun result received',
          from_status: 'Rerun Requested', to_status: resultStatus, actor: auditActor, reason: editReason || null, version: existing[0].report_version, details: diff });
      } else if (diff.changes.length > 0) {
        await logResultAudit(connection, { result_id: finalResultId, sample_id, branch_id: existing[0].branch_id, action: 'Result edited',
          from_status: existing[0].status, to_status: resultStatus, actor: auditActor, reason: editReason || null, version: existing[0].report_version, details: diff });
      } else if (diff.added.length > 0) {
        await logResultAudit(connection, { result_id: finalResultId, sample_id, branch_id: existing[0].branch_id, action: 'Parameters received',
          from_status: existing[0].status, to_status: resultStatus, actor: auditActor, version: existing[0].report_version, details: { added: diff.added },
          note: machine_no ? `From ${machine_no}` : 'Manual entry' });
      }
    } else {
      // INSERT LOGIC (First parameter for this test)
      // branch_id was never set here, so every insert fell back to the column
      // default of 1 — which silently worked only while a branch with id 1
      // happened to exist. Once the facility list was rebuilt (ids 25/26), the
      // foreign key rejected every result with "Cannot add or update a child
      // row", surfacing to the agent as a bare HTTP 500 after a test had
      // already run. Derive it from the bill this sample belongs to, which is
      // the branch that actually did the work.
      const [[branchRow]] = await connection.query(
        `SELECT b.branch_id
           FROM bill_items bi
           JOIN bills b ON b.id = bi.bill_id
          WHERE bi.sample_id = ?
          LIMIT 1`,
        [sample_id]
      );
      const resolvedBranchId = branchRow?.branch_id || null;

      const evaluated = await applyRules(results, null);
      const [insertResult] = await connection.query(
        `INSERT INTO lab_test_result
         (bill_item_id, patient_id, sample_id, machine_no, test_id, test_name,
          results_json, tested_by, tested_at, status, branch_id,
          has_abnormal, has_critical, has_invalid, has_delta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bill_item_id || null,
          resolvedPatientId || null,
          sample_id,
          machine_no || null,
          test_id || rulesTestId || null,
          test_name || null,
          JSON.stringify(evaluated),
          tested_by || null,
          testedAt,
          resultStatus,
          resolvedBranchId,
          flagSummary.abnormal > 0 ? 1 : 0, flagSummary.critical > 0 ? 1 : 0, flagSummary.invalid > 0 ? 1 : 0, flagSummary.delta > 0 ? 1 : 0,
        ]
      );
      var finalResultId = insertResult.insertId;
      var finalResultsForAuto = evaluated;
      // Which reagent lots were on the analyzer when this result was produced.
      const lotsOnBoard = await reagentSnapshot(connection, machine_no).catch(() => null);
      if (lotsOnBoard) await connection.query('UPDATE lab_test_result SET reagent_lots = ? WHERE id = ?', [JSON.stringify(lotsOnBoard), finalResultId]);
      await logResultAudit(connection, { result_id: finalResultId, sample_id, branch_id: resolvedBranchId, action: 'Result recorded', to_status: resultStatus,
        actor: auditActor, version: 1, details: { parameters: evaluated.length, reagents: lotsOnBoard }, note: machine_no ? `From ${machine_no}` : (req.user?.isDeviceKey ? 'LIS-Agent entry' : 'Manual entry') });
    }

    // The checksum of the request an agent sent this result in (tender #111), kept with the result.
    if (req.bodySha256 && req.user?.isDeviceKey) {
      await connection.query('UPDATE lab_test_result SET capture_sha256 = ? WHERE id = ?', [req.bodySha256, finalResultId]);
    }

    // Manual entry: the reason stays with the result, and the audit trail says who
    // typed or changed what, and why.
    if (manual.manual) {
      await connection.query(
        'UPDATE lab_test_result SET entry_mode = ?, manual_reason_code = ?, manual_reason = ? WHERE id = ?',
        [manual.mode, manual.code, manual.text.slice(0, 500), finalResultId]);
      const [[mrow]] = await connection.query('SELECT branch_id, report_version, status FROM lab_test_result WHERE id = ?', [finalResultId]);
      await logResultAudit(connection, {
        result_id: finalResultId, sample_id, branch_id: mrow?.branch_id, action: manual.mode === 'edited' ? 'Captured value changed by hand' : 'Result typed manually',
        to_status: mrow?.status, actor: auditActor, reason: manual.text, version: mrow?.report_version,
        details: { reason_code: manual.code, parameters: results.map((r) => r.parameter_name) },
        note: 'Manual entry — reason recorded',
      });
    }

    // Auto technical validation: a discipline can let fully-received, unflagged
    // results skip manual technical validation (Two-level workflows only).
    // Never for a hand-typed value: a person must validate it.
    try {
      const [[cat]] = rulesTestId ? await connection.query('SELECT category_id FROM lab_tests WHERE id = ?', [rulesTestId]) : [[null]];
      const wf = (await loadWorkflows(connection)).forCategory(cat?.category_id);
      const noFlags = flagSummary.abnormal + flagSummary.critical + flagSummary.invalid + flagSummary.delta === 0;
      if (wf.levels === 'Two-level' && wf.auto_verify_normal && noFlags && rulesTestId && !manual.manual) {
        const [[need]] = await connection.query("SELECT COUNT(*) AS n FROM lab_test_parameters WHERE test_id = ? AND status = 'Active' AND is_calculated = 0", [rulesTestId]);
        const got = new Set(finalResultsForAuto.map((r) => String(r.parameter_name || '').toLowerCase()));
        if (Number(need.n) > 0 && got.size >= Number(need.n)) {
          const [upd] = await connection.query("UPDATE lab_test_result SET status = 'Verified', verified_at = NOW(), verified_by = NULL WHERE id = ? AND status = 'Test Done'", [finalResultId]);
          if (upd.affectedRows) {
            await connection.query(
              `INSERT INTO lab_result_audit (result_id, sample_id, branch_id, action, from_status, to_status, actor_role, note)
               VALUES (?, ?, (SELECT branch_id FROM lab_test_result WHERE id = ?), 'Auto-validated', 'Test Done', 'Verified', 'System', 'All parameters received and no flags raised')`,
              [finalResultId, sample_id, finalResultId]
            );
          }
        }
      }
    } catch (autoErr) {
      console.error('Auto technical validation skipped:', autoErr.message);
    }

    // Critical values raise an alert (or clear one if an edit removed them).
    try {
      const [[meta]] = await connection.query('SELECT branch_id, report_version FROM lab_test_result WHERE id = ?', [finalResultId]);
      const [[cat3]] = rulesTestId ? await connection.query('SELECT category_id FROM lab_tests WHERE id = ?', [rulesTestId]) : [[null]];
      const wf3 = (await loadWorkflows(connection)).forCategory(cat3?.category_id);
      await syncCriticalAlert(connection, { result_id: finalResultId, sample_id, branch_id: meta?.branch_id, patient_id: resolvedPatientId,
        report_version: meta?.report_version, results: finalResultsForAuto, workflow: wf3, actor: auditActor });
    } catch (critErr) {
      console.error('Critical alert sync failed:', critErr.message);
    }

    // Sample lifecycle: a result arriving means the specimen is on the bench.
    // Same transaction as the result, and best-effort — never blocks saving it.
    if (sample_id) {
      await advanceSampleQuietly(connection, {
        sample_id, to: 'Processing', note: machine_no ? `Result received from ${machine_no}` : 'Result saved',
        actor: actorFromReq(req, { id: tested_by || req.user?.id || null, station: machine_no ? `Analyzer ${machine_no}` : undefined }),
      });
    }

    // Update bill item to 'Test Done' so it appears in the verification queue.
    // Do NOT mark as Completed here — that requires explicit doctor verification/approval.
    // Always update by sample_id first (authoritative — comes from the machine/worklist).
    await connection.query(
      `UPDATE bill_items SET status = 'Test Done', updated_at = NOW()
       WHERE sample_id = ? AND status IN ('Pending', 'Collected', 'In Progress')`,
      [sample_id]
    );
    // Also update by bill_item_id if provided, in case sample_id lookup misses due to short ID.
    if (bill_item_id) {
      await connection.query(
        `UPDATE bill_items SET status = 'Test Done', updated_at = NOW()
         WHERE id = ? AND status IN ('Pending', 'Collected', 'In Progress')`,
        [bill_item_id]
      );
    }

    // ============================================
    // AUTO-DEDUCT INVENTORY LOGIC
    // ============================================
    if (test_id && stockBranchId) {
      // Reagents issued to this analyzer when their pack was loaded are already
      // deducted (Reagent Changes) — skip them here so they are not counted twice.
      const issuedOnLoad = await loadedInventoryItemIds(connection, machine_no);
      // Find mappings
      const [mappings] = await connection.query(
        'SELECT item_id, quantity_required FROM inventory_test_mapping WHERE test_id = ?',
        [test_id]
      );

      for (const mapping of mappings) {
        if (issuedOnLoad.has(mapping.item_id)) continue;
        let remainingToDeduct = parseFloat(mapping.quantity_required);

        // Fetch available batches for this item at this lab (branch), ordered by expiry (FIFO)
        const [batches] = await connection.query(
          `SELECT id, quantity_available FROM inventory_batches 
           WHERE item_id = ? AND branch_id = ? AND quantity_available > 0 AND status = 'Active'
           ORDER BY expiry_date ASC`,
          [mapping.item_id, stockBranchId]
        );

        for (const batch of batches) {
          if (remainingToDeduct <= 0) break;

          const deductQty = Math.min(batch.quantity_available, remainingToDeduct);
          
          // Deduct from batch
          await connection.query(
            `UPDATE inventory_batches SET quantity_available = quantity_available - ? WHERE id = ?`,
            [deductQty, batch.id]
          );

          // Log transaction
          await connection.query(
            `INSERT INTO inventory_transactions (item_id, batch_id, type, quantity, reference_type, reference_id, remarks, branch_id, created_by, test_id)
             VALUES (?, ?, 'OUT', ?, 'Test', ?, 'Auto-deducted for test execution', ?, ?, ?)`,
            [mapping.item_id, batch.id, deductQty, sample_id, stockBranchId, tested_by || null, test_id]
          );

          // Update batch status if depleted
          await connection.query(
            `UPDATE inventory_batches SET status = 'Empty' WHERE id = ? AND quantity_available <= 0`,
            [batch.id]
          );

          remainingToDeduct -= deductQty;
        }
      }
    }

    await connection.commit();

    res.status(201).json({
      success: true,
      message: 'Test results saved successfully',
      data: {
        result_id: finalResultId,
        sample_id,
        machine_no,
        results_count: results.length,
        tested_at: testedAt
      }
    });

  } catch (error) {
    await connection.rollback();
    // VAPT #8 (Improper Error Handling): log the real error server-side only
    // — the client shouldn't see raw DB/driver error text.
    console.error('Error saving test results:', error);
    res.status(500).json({
      success: false,
      message: 'Server error saving test results'
    });
  } finally {
    connection.release();
  }
};

// Get test results by sample_id
export const getTestResultsBySampleId = async (req, res) => {
  try {
    const { sampleId } = req.params;

    const [rows] = await db.query(
      `SELECT 
        tr.id,
        tr.sample_id,
        tr.machine_no,
        tr.test_name,
        tr.results_json,
        tr.tested_by,
        tr.tested_at,
        tr.status,
        CONCAT(p.first_name, ' ', p.last_name) as patient_name,
        p.reg_no
      FROM lab_test_result tr
      LEFT JOIN bill_items bi ON tr.bill_item_id = bi.id
      LEFT JOIN bills b ON bi.bill_id = b.id
      LEFT JOIN patients p ON b.patient_id = p.id
      WHERE tr.sample_id = ?
      ORDER BY tr.created_at DESC
      LIMIT 1`,
      [sampleId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No results found for this sample ID'
      });
    }

    const result = rows[0];

    // Parse JSON results
    let resultsArray = [];
    try {
      resultsArray = typeof result.results_json === 'string'
        ? JSON.parse(result.results_json)
        : result.results_json;
    } catch (e) {
      resultsArray = [];
    }

    res.json({
      success: true,
      sample_id: sampleId,
      machine_no: result.machine_no,
      test_name: result.test_name,
      patient_name: result.patient_name,
      patient_reg_no: result.reg_no,
      tested_at: result.tested_at,
      status: result.status,
      results_count: resultsArray.length,
      results: resultsArray
    });

  } catch (error) {
    console.error('Error fetching test results:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching test results'
    });
  }
};

// Get pending verifications for Lab Head Doctor
export const getPendingVerifications = async (req, res) => {
  try {
    const { status, search } = req.query;

    // Same one-box identifier search as the worklist and reports list, so the
    // verifying doctor can find a case by UHID, ABHA, phone or CARE id rather
    // than only by name. See utils/identifierSearch.js.
    const searchSql = identifierSearchClause(search, {
      patients: 'p', billItems: 'bi', sampleId: 'tr.sample_id', testName: 'tr.test_name',
    });

    // Staff pinned to a facility only see that facility's results.
    const verifyScope = req.user?.role_level !== 'Central' && req.user?.branch_id ? req.user.branch_id : null;
    let statusFilter = "tr.status IN ('Test Done', 'Verified', 'Completed')";
    if (status && status !== 'all') {
      statusFilter = "tr.status = ?";
    }

    const [tests] = await db.query(
      `SELECT
        tr.id,
        tr.bill_item_id,
        tr.sample_id,
        tr.machine_no,
        lt.test_name as test_name,
        tr.results_json,
        tr.tested_by,
        tr.tested_at,
        tr.verified_by,
        tr.verified_at,
        tr.status,
        tr.notes,
        tr.has_abnormal, tr.has_critical, tr.has_invalid, tr.has_delta,
        tr.entry_mode, tr.manual_reason,
        tr.approved_by, tr.approved_at, tr.branch_id, tr.report_version, lt.category_id,
        (SELECT COUNT(*) FROM critical_alerts ca WHERE ca.result_id = tr.id AND ca.status = 'Open') AS critical_open,
        CONCAT(p.first_name, ' ', p.last_name) as patient_name,
        p.reg_no,
        CONCAT(u.first_name, ' ', u.last_name) as tested_by_name

      FROM lab_test_result tr
      JOIN bill_items bi ON tr.sample_id = bi.sample_id
      LEFT JOIN lab_tests lt ON bi.service_id = lt.id
      LEFT JOIN bills b ON bi.bill_id = b.id
      LEFT JOIN patients p ON b.patient_id = p.id
      LEFT JOIN users u ON tr.tested_by = u.id

      WHERE ${statusFilter} AND (p.reg_no NOT LIKE 'ANL-%' OR p.reg_no IS NULL)
      ${verifyScope ? 'AND tr.branch_id = ?' : ''}
      ${searchSql.clause}

      ORDER BY tr.has_critical DESC, tr.tested_at DESC`,
      // Status param first (it appears earlier in the SQL), then scope, then the
      // search params in the order identifierSearchClause emitted them.
      [...(status && status !== 'all' ? [status] : []), ...(verifyScope ? [verifyScope] : []), ...searchSql.params]
    );
    const workflows = await loadWorkflows(db);

    // Parse JSON results for each test
    const formattedTests = tests.map(test => {
      let results = [];
      try {
        results = typeof test.results_json === 'string'
          ? JSON.parse(test.results_json)
          : test.results_json;
      } catch (e) {
        results = [];
      }

      const workflow = workflows.forCategory(test.category_id);
      const action = nextAction(workflow, test.status, req.user, test);
      const critBlocked = action.allowed && action.step === 'clinical' && workflow.critical_block_approval && Number(test.critical_open) > 0;
      return {
        ...test,
        results,
        workflow_levels: workflow.levels,
        next_step: action.step,            // 'technical' | 'clinical' | null
        can_act: action.allowed && !critBlocked && !req.user?.isDeviceKey,
        blocked_reason: critBlocked ? 'Critical value not yet acknowledged by the clinician — record the notification first.' : (action.allowed ? null : action.reason || null),
      };
    });

    res.json({
      success: true,
      count: formattedTests.length,
      tests: formattedTests
    });

  } catch (error) {
    console.error('Error fetching pending verifications:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching pending verifications'
    });
  }
};



// Verify test by Lab Head Doctor
export const verifyTest = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { test_result_id, sample_id, status, notes, password } = req.body; // status: 'Verified' (technical) | 'Approved' (clinical)
    // Set only by the server itself when a doctor's USB-token signature (Poxia DSC
    // Agent) completes — never from the request: { agent, dryRun, passwordVerified,
    // approvedAt, signatureId, signedPdf, dscId }.
    const internal = req.internal || null;

    // Identity comes from the session, never from the request body.
    const actor = req.user;
    if (!actor?.id || actor.isDeviceKey) {
      return res.status(403).json({ success: false, message: 'Sign in as a staff member to validate or authorize results.' });
    }
    if (!test_result_id || !sample_id || !status) {
      return res.status(400).json({ success: false, message: 'test_result_id, sample_id and status are required' });
    }
    if (!['Verified', 'Approved'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be Verified or Approved' });
    }

    await connection.beginTransaction();
    const [[row]] = await connection.query(
      `SELECT tr.id, tr.status, tr.tested_by, tr.verified_by, tr.branch_id, tr.has_invalid, tr.report_version, lt.category_id
       FROM lab_test_result tr
       LEFT JOIN bill_items bi ON bi.id = tr.bill_item_id
       LEFT JOIN lab_tests lt ON lt.id = COALESCE(tr.test_id, bi.service_id)
       WHERE tr.id = ? AND tr.sample_id = ? FOR UPDATE`,
      [test_result_id, sample_id]
    );
    const pinned = actor.role_level !== 'Central' && actor.branch_id;
    if (!row || (pinned && row.branch_id && Number(row.branch_id) !== Number(actor.branch_id))) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Test result not found' });
    }

    // The discipline's own workflow decides the steps, who may do them, and
    // whether the same person may do both.
    const workflows = await loadWorkflows(connection);
    const workflow = workflows.forCategory(row.category_id);
    const decision = nextAction(workflow, row.status, actor, row);
    const wantStep = status === 'Verified' ? 'technical' : 'clinical';
    if (!decision.step || decision.step !== wantStep) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: workflow.levels === 'Two-level' && row.status === 'Test Done' && wantStep === 'clinical'
          ? 'Technical validation is required before authorization.'
          : decision.step ? `This result is waiting for ${decision.step === 'technical' ? 'technical validation' : 'authorization'}.`
          : `This result is already ${row.status}.`,
      });
    }
    if (!decision.allowed) {
      await connection.rollback();
      return res.status(403).json({ success: false, message: decision.reason });
    }
    if (wantStep === 'clinical' && workflow.critical_block_approval) {
      const [[openCrit]] = await connection.query("SELECT COUNT(*) AS n FROM critical_alerts WHERE result_id = ? AND status = 'Open'", [row.id]);
      if (Number(openCrit.n) > 0) {
        await connection.rollback();
        return res.status(409).json({ success: false, code: 'CRITICAL_UNACKNOWLEDGED', message: 'This result has a critical value that the clinician has not acknowledged. Record the notification (Critical Alerts) before authorizing.' });
      }
    }
    if (row.has_invalid) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'This result has invalid readings. Rerun or correct them before validating.' });
    }

    // Authorization is an electronic signature: the doctor re-enters their own
    // login password, and must have a registration number + signature on file.
    let signer = null;
    if (wantStep === 'clinical') {
      const pw = internal?.passwordVerified ? { ok: true } : await confirmPassword(connection, actor.id, password);
      if (!pw.ok) {
        await connection.rollback();
        return res.status(pw.status).json({ success: false, code: 'PASSWORD_REQUIRED', message: password ? pw.message : 'Enter your password to sign this report.' });
      }
      [[signer]] = await connection.query("SELECT CONCAT(first_name, ' ', last_name) AS name, registration_no, designation, signature_image FROM users WHERE id = ?", [actor.id]);
      if (!signer?.registration_no || !signer?.signature_image) {
        await connection.rollback();
        return res.status(409).json({ success: false, code: 'SIGNATURE_PROFILE_INCOMPLETE', message: 'Add your registration number and signature (My Signature) before authorizing reports.' });
      }
    }

    // The doctor's Digital Signature Certificate, when they have one (or the
    // hospital requires one): opened here with the password they just typed,
    // before anything is committed. The password is used in memory only.
    let dsc = { signer: null };
    let signedPdfBuf = null;
    if (wantStep === 'clinical' && !internal?.agent) {
      dsc = await prepareDscForApproval(connection, actor, row.branch_id, req.body.dsc_password);
      if (dsc.error) {
        await connection.rollback();
        return res.status(dsc.error.status).json({ success: false, code: dsc.error.code, message: dsc.error.message });
      }
    }
    // A check only: would this approval be accepted? (used before a signing job is created)
    if (internal?.dryRun) {
      await connection.rollback();
      return res.json({ success: true, dry_run: true });
    }

    const verified_by = actor.id;
    const verifiedAt = internal?.approvedAt || new Date();
    if (wantStep === 'technical') {
      await connection.query(
        `UPDATE lab_test_result SET verified_by = ?, verified_at = ?, status = 'Verified', notes = COALESCE(?, notes), updated_at = NOW() WHERE id = ?`,
        [actor.id, verifiedAt, notes || null, row.id]
      );
    } else {
      await connection.query(
        `UPDATE lab_test_result SET approved_by = ?, approved_at = ?, status = 'Approved',
                verified_by = COALESCE(verified_by, ?), verified_at = COALESCE(verified_at, ?),
                notes = COALESCE(?, notes), updated_at = NOW() WHERE id = ?`,
        [actor.id, verifiedAt, actor.id, verifiedAt, notes || null, row.id]
      );
    }
    let signatureId = null;
    if (wantStep === 'clinical') {
      const canonical = await canonicalReportContent(connection, row.id);
      const hash = contentHash(canonical);
      if (internal?.agent) {
        // The signature row was created when the signing job started; it takes effect now,
        // provided the report is still exactly what the doctor's token signed.
        const [upd] = await connection.query(
          `UPDATE report_signatures SET status = 'Valid', signer_name = ?, signer_role = ?, registration_no = ?, designation = ?, signature_image = ?,
                  seal = ?, signed_at = ?, ip_address = ?, method = ?
            WHERE id = ? AND result_id = ? AND status = 'Pending' AND content_hash = ?`,
          [signer.name, actor.role || null, signer.registration_no, signer.designation || null, signer.signature_image,
           sealFor({ hash, signerId: actor.id, signedAt: verifiedAt }), verifiedAt, req.ip || null, 'Login password + Digital Signature Certificate (USB token)',
           internal.signatureId, row.id, hash]);
        if (!upd.affectedRows) {
          await connection.rollback();
          return res.status(409).json({ success: false, code: 'REPORT_CHANGED', message: 'The report changed while it was being signed, so nothing was approved. Please approve it again.' });
        }
        signatureId = internal.signatureId;
        await saveSignedReport(connection, {
          signatureId, resultId: row.id, sampleId: sample_id, branchId: row.branch_id, dscId: internal.dscId, signerId: actor.id, pdf: internal.signedPdf,
        });
        signedPdfBuf = internal.signedPdf;
      } else {
        const [ins] = await connection.query(
          `INSERT INTO report_signatures (result_id, sample_id, branch_id, signer_id, signer_name, signer_role, registration_no, designation, signature_image,
                                          content_hash, seal, signed_at, ip_address)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [row.id, sample_id, row.branch_id, actor.id, signer.name, actor.role || null, signer.registration_no, signer.designation || null, signer.signature_image,
           hash, sealFor({ hash, signerId: actor.id, signedAt: verifiedAt }), verifiedAt, req.ip || null]
        );
        signatureId = ins.insertId;
      }

      if (dsc.signer) {
        // Build the final report exactly as it will be issued, sign it with the
        // doctor's certificate and keep that signed file. Same transaction: if
        // it cannot be signed, the report is not authorised.
        try {
          await connection.query('UPDATE report_signatures SET method = ? WHERE id = ?', ['Login password + Digital Signature Certificate', signatureId]);
          const data = await buildLabReportData(sample_id, connection);
          if (!data || data.authentication?.state !== 'Authentic') throw new Error('the report could not be prepared for signing');
          data.dscSigner = dsc.signer;
          signedPdfBuf = await pdfToBuffer(await generateLabReportPDFStream(data));
          const check = verifyPdfSignature(signedPdfBuf);
          if (!check.valid) throw new Error('the signed PDF did not verify');
          await saveSignedReport(connection, {
            signatureId, resultId: row.id, sampleId: sample_id, branchId: row.branch_id, dscId: dsc.row.id, signerId: actor.id, pdf: signedPdfBuf,
          });
        } catch (signErr) {
          console.error('DSC signing at approval failed:', signErr);
          await connection.rollback();
          return res.status(500).json({ success: false, code: 'DSC_SIGNING_FAILED', message: `The report was not approved: it could not be digitally signed (${signErr.message}).` });
        }
      }
    }
    const [[who]] = await connection.query("SELECT CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id = ?", [actor.id]);
    await connection.query(
      `INSERT INTO lab_result_audit (version, result_id, sample_id, branch_id, action, from_status, to_status, actor_id, actor_name, actor_role, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.report_version, row.id, sample_id, row.branch_id, wantStep === 'technical' ? 'Technically validated' : 'Authorized and e-signed', row.status, status,
       actor.id, who?.name || null, actor.role || null, [notes, signatureId ? `Signature #${signatureId}` : ''].filter(Boolean).join(' — ').slice(0, 500) || null]
    );

    // Also update bill_items status if status is Approved
    if (status === 'Approved') {
      await connection.query(
        `UPDATE bill_items 
         SET status = 'Completed', 
             updated_at = NOW() 
         WHERE sample_id = ?`,
        [sample_id]
      );

      // --- AUTOMATED WHATSAPP PDF SEND ---
      try {
        const query = `
          SELECT 
            tr.id,
            tr.sample_id,
            tr.test_name,
            tr.results_json,
            tr.tested_at,
            tr.verified_at,
            tr.notes,
            CONCAT(p.first_name, ' ', p.last_name) as patient_name,
            p.reg_no as patient_reg_no,
            p.gender,
            p.dob,
            p.telephone as patient_phone,
            doc_user.phone as doctor_phone,
            CONCAT(doc_user.first_name, ' ', doc_user.last_name) as doctor_name,
            CONCAT(ut.first_name, ' ', ut.last_name) as tested_by_name,
            CONCAT(uv.first_name, ' ', uv.last_name) as verified_by_name,
            i.name as lab_name,
            br.branch_name, br.address as branch_address, br.contact_number as branch_contact,
        d.name as branch_district
          FROM lab_test_result tr
          LEFT JOIN bill_items bi ON tr.sample_id = bi.sample_id
          LEFT JOIN bills b ON bi.bill_id = b.id
          LEFT JOIN patients p ON b.patient_id = p.id
          LEFT JOIN branches br ON b.branch_id = br.id
        LEFT JOIN districts d ON d.id = br.district_id
          LEFT JOIN doctor_lab_orders dlo ON dlo.test_id = bi.service_id AND dlo.patient_reg_no = p.reg_no
          LEFT JOIN doctors doc_ref ON dlo.doctor_id = doc_ref.id
          LEFT JOIN users doc_user ON doc_ref.user_id = doc_user.id
          LEFT JOIN users ut ON tr.tested_by = ut.id
          LEFT JOIN users uv ON tr.verified_by = uv.id
          LEFT JOIN infrastructure i ON bi.lab_id = i.id
          WHERE tr.sample_id = ?
          LIMIT 1
        `;
        const [rows] = await connection.query(query, [sample_id]);
        
        if (rows && rows.length > 0) {
          const report = rows[0];
          // We prioritize the doctor's phone, but if not available (e.g. unsolicited tests), we silently skip or fallback based on preference
          if (report.doctor_phone) {
             let formattedPhone = report.doctor_phone.replace(/[^0-9]/g, '');
             if (formattedPhone.length === 10) formattedPhone = '91' + formattedPhone;
             
             let results = [];
             try { results = typeof report.results_json === 'string' ? JSON.parse(report.results_json) : report.results_json; } catch(e){}
             
             let age = 'N/A';
             if (report.dob) {
               const birthDate = new Date(report.dob);
               const today = new Date();
               let ageYears = today.getFullYear() - birthDate.getFullYear();
               age = ageYears + ' Y';
             }
             
             const formatDate = (date) => {
               if (!date) return 'N/A';
               return new Date(date).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit'}).replace(',', '');
             };
             
             // UHID rather than an authenticated URL — see generateLabReportPDF.
             const reportUrl = String(report.patient_reg_no || sample_id).replace(/^CARE-/, '');
             
             // Fetch hospital settings for branding
             const [mergedRows] = await db.query(
               `SELECT service_name FROM bill_items
                 WHERE sample_id = ? AND service_type = 'Laboratory'
                 ORDER BY id`,
               [report.sample_id]
             );
             const mergedTestName = mergedRows.length > 1
               ? mergedRows.map(r => r.service_name).join(' & ')
               : null;

             const [settingsRows] = await db.query(`SELECT * FROM hospital_settings LIMIT 1`);
             const hospitalSettings = settingsRows.length > 0 ? settingsRows[0] : null;

             const reportData = {
               hospital_settings: hospitalSettings,
               branch_name: report.branch_name,
              branch_district: report.branch_district,
               branch_address: report.branch_address,
               branch_contact: report.branch_contact,
               patient_name: report.patient_name || 'Unknown',
               patient_reg_no: report.patient_reg_no || 'N/A',
               sample_id: report.sample_id,
               gender: report.gender || 'N/A',
               age: age,
               referred_by: 'Self',
               centre: report.lab_name || report.branch_name || hospitalSettings?.hospital_name || 'MERIL HIMS',
               registration_date: formatDate(report.tested_at),
               tested_by_name: report.tested_by_name || 'N/A',
               tested_at: formatDate(report.tested_at),
               verified_by_name: report.verified_by_name || 'N/A',
               verified_at: formatDate(report.verified_at),
               report_url: reportUrl,
               tests: [{
                 // A merged sample runs several tests from one tube, so the
                 // report is titled with all of them — "LFT & KFT" — rather
                 // than whichever name the analyzer happened to send.
                 test_name: mergedTestName || report.test_name || 'Lab Test',
                 sample_type: 'Blood Sample',
                 accession_no: report.sample_id,
                 collected_on: formatDate(report.tested_at),
                 received_on: formatDate(report.tested_at),
                 approved_on: formatDate(report.verified_at),
                 remarks: report.notes || 'Please correlate results clinically.',
                 parameters: results.map(r => ({
                   parameter_name: r.parameter_name || r.parameter_code || 'Unknown',
                   result_value: r.result_value || '',
                   unit: r.unit || '',
                   reference_range: r.reference_range || '',
                   result_flag: externalFlag(r.result_flag),
                   is_subheader: r.is_subheader || false
                 }))
               }]
             };
             
             const doc = await generateLabReportPDFStream({ ...reportData, signed_pdf: signedPdfBuf });
             const chunks = [];
             doc.on('data', chunk => chunks.push(chunk));
             doc.on('end', () => {
               const pdfBuffer = Buffer.concat(chunks);
               const base64Pdf = pdfBuffer.toString('base64');
               
               const msgData = JSON.stringify({
                 phone: formattedPhone,
                 text: `🏥 *HIMS Lab Report Alert*\nHello Dr. ${report.doctor_name || 'Doctor'},\n\nA new lab report for your patient *${report.patient_name || 'Unknown'}* (${report.patient_reg_no || 'N/A'}) is ready.\n\n*Test:* ${report.test_name || 'Lab Test'}\n*Verified by:* ${report.verified_by_name || 'N/A'}\n\nPlease find the PDF attached below.`,
                 media: base64Pdf,
                 filename: `${(report.test_name || 'Lab_Report').replace(/[^a-zA-Z0-9]/g, '_')}_${report.patient_name || 'Patient'}.pdf`
               });
               
               const botUrl = new URL(process.env.WHATSAPP_BOT_URL || 'http://localhost:3000');
               const httpReq = http.request({
                 hostname: botUrl.hostname,
                 port: botUrl.port || (botUrl.protocol === 'https:' ? 443 : 80),
                 path: '/send-message',
                 method: 'POST',
                 headers: {
                   'Content-Type': 'application/json',
                   'Content-Length': Buffer.byteLength(msgData)
                 }
               });
               // Logged as a delivery to the referring clinician (tender #42-43).
               const deliveryLogged = recordDelivery({ sampleId: report.sample_id, channel: 'WhatsApp', recipient: `Doctor ${maskPhone(formattedPhone)}`,
                 status: 'Sent', provider: 'bot', triggeredBy: 'Auto' });
               httpReq.on('error', e => {
                 console.log('WhatsApp HTTP error:', e.message);
                 deliveryLogged.then((id) => updateDelivery(id, { status: 'Failed', error: e.message }));
               });
               httpReq.write(msgData);
               httpReq.end();
             });
          }
        }
      } catch (pdfErr) {
        console.error('Error generating PDF for WhatsApp:', pdfErr);
      }
      // --- END AUTOMATED WHATSAPP PDF SEND ---

      // --- CDAC RESULTS/STATUS/REPORT PUSH ---
      // Only fires for bill_items that originated from a CDAC pull. Each step
      // is independently try/caught so a slow/failing API5 (the ~260KB PDF
      // payload) can't block API31/API3 from having already succeeded, and
      // each failure is independently visible in cdac_integration_logs.
      try {
        const [[cdacReq]] = await db.query(
          `SELECT cr.* FROM bill_items bi
           JOIN cdac_lab_requisitions cr ON cr.bill_item_id = bi.id
           WHERE bi.sample_id = ? LIMIT 1`,
          [sample_id]
        );

        if (cdacReq) {
          const branchConfig = await cdacService.getBranchCdacConfig(cdacReq.branch_id);

          if (branchConfig?.integration_type === 'CDAC' && branchConfig.is_active) {
            // Step 1: parameter-level results (API 31)
            try {
              const [[labTestResult]] = await db.query(
                `SELECT * FROM lab_test_result WHERE id = ? LIMIT 1`,
                [test_result_id]
              );
              if (labTestResult) {
                const resultPayload = await buildResultRowDataPayload(cdacReq, labTestResult, 'AUTHORIZED');
                if (resultPayload.investigationData.length) {
                  await cdacService.pushInvestigationStatusUpdateDtlsRowData(resultPayload, branchConfig);
                }
              }
            } catch (e) {
              console.error('CDAC API31 (results) push failed:', e.message);
            }

            // Step 2: overall status -> AUTHORIZED (API 3)
            try {
              await cdacService.pushInvestigationStatusUpdateDtls(
                buildStatusUpdatePayload(cdacReq, 'AUTHORIZED'),
                branchConfig
              );
              await db.query(
                `UPDATE cdac_lab_requisitions SET last_pushed_status = 'AUTHORIZED', last_pushed_at = NOW(), last_push_error = NULL WHERE id = ?`,
                [cdacReq.id]
              );
            } catch (e) {
              console.error('CDAC API3 (status) push failed:', e.message);
              await db.query(
                `UPDATE cdac_lab_requisitions SET last_push_error = ? WHERE id = ?`,
                [String(e.message).slice(0, 1000), cdacReq.id]
              );
            }

            // Step 3: final PDF report (API 5) — independent query + PDF build.
            // The WhatsApp block above skips PDF generation entirely when
            // there's no doctor_phone, but CDAC needs the report regardless,
            // so this deliberately regenerates it rather than sharing that buffer.
            try {
              const [cdacReportRows] = await db.query(
                `SELECT
                  tr.id, tr.sample_id, tr.test_name, tr.results_json, tr.tested_at, tr.verified_at, tr.notes,
                  CONCAT(p.first_name, ' ', p.last_name) as patient_name,
                  p.reg_no as patient_reg_no, p.gender, p.dob,
                  CONCAT(ut.first_name, ' ', ut.last_name) as tested_by_name,
                  CONCAT(uv.first_name, ' ', uv.last_name) as verified_by_name,
                  i.name as lab_name,
                  br.branch_name, br.address as branch_address, br.contact_number as branch_contact,
        d.name as branch_district
                FROM lab_test_result tr
                LEFT JOIN bill_items bi ON tr.sample_id = bi.sample_id
                LEFT JOIN bills b ON bi.bill_id = b.id
                LEFT JOIN patients p ON b.patient_id = p.id
                LEFT JOIN branches br ON b.branch_id = br.id
        LEFT JOIN districts d ON d.id = br.district_id
                LEFT JOIN users ut ON tr.tested_by = ut.id
                LEFT JOIN users uv ON tr.verified_by = uv.id
                LEFT JOIN infrastructure i ON bi.lab_id = i.id
                WHERE tr.sample_id = ?
                LIMIT 1`,
                [sample_id]
              );

              if (cdacReportRows.length > 0) {
                const report = cdacReportRows[0];
                let cdacResults = [];
                try { cdacResults = typeof report.results_json === 'string' ? JSON.parse(report.results_json) : report.results_json; } catch (e) { /* leave empty */ }

                const formatCdacDate = (date) => {
                  if (!date) return 'N/A';
                  return new Date(date).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
                };
                let cdacAge = 'N/A';
                if (report.dob) {
                  cdacAge = (new Date().getFullYear() - new Date(report.dob).getFullYear()) + ' Y';
                }

                const [cdacSettingsRows] = await db.query(`SELECT * FROM hospital_settings LIMIT 1`);
                const cdacHospitalSettings = cdacSettingsRows.length > 0 ? cdacSettingsRows[0] : null;

                const cdacReportData = {
                  hospital_settings: cdacHospitalSettings,
                  branch_name: report.branch_name,
              branch_district: report.branch_district,
                  branch_address: report.branch_address,
                  branch_contact: report.branch_contact,
                  patient_name: report.patient_name || 'Unknown',
                  patient_reg_no: report.patient_reg_no || 'N/A',
                  sample_id: report.sample_id,
                  gender: report.gender || 'N/A',
                  age: cdacAge,
                  referred_by: 'Self',
                  centre: report.lab_name || report.branch_name || cdacHospitalSettings?.hospital_name || 'MERIL HIMS',
                  registration_date: formatCdacDate(report.tested_at),
                  tested_by_name: report.tested_by_name || 'N/A',
                  tested_at: formatCdacDate(report.tested_at),
                  verified_by_name: report.verified_by_name || 'N/A',
                  verified_at: formatCdacDate(report.verified_at),
                  report_url: String(report.patient_reg_no || sample_id).replace(/^CARE-/, ''),
                  tests: [{
                    test_name: report.test_name || 'Lab Test',
                    sample_type: 'Blood Sample',
                    accession_no: report.sample_id,
                    collected_on: formatCdacDate(report.tested_at),
                    received_on: formatCdacDate(report.tested_at),
                    approved_on: formatCdacDate(report.verified_at),
                    remarks: report.notes || 'Please correlate results clinically.',
                    parameters: cdacResults.map(r => ({
                      parameter_name: r.parameter_name || r.parameter_code || 'Unknown',
                      result_value: r.result_value || '',
                      unit: r.unit || '',
                      reference_range: r.reference_range || '',
                      result_flag: externalFlag(r.result_flag),
                      is_subheader: r.is_subheader || false
                    }))
                  }]
                };

                const cdacDoc = await generateLabReportPDFStream({ ...cdacReportData, signed_pdf: signedPdfBuf });
                const cdacPdfBase64 = await new Promise((resolve, reject) => {
                  const chunks = [];
                  cdacDoc.on('data', chunk => chunks.push(chunk));
                  cdacDoc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
                  cdacDoc.on('error', reject);
                });

                await cdacService.pushInvestigationReportDtls(
                  buildReportPayload(cdacReq, cdacPdfBase64, 'PRINTED'),
                  branchConfig
                );
                await db.query(
                  `UPDATE cdac_lab_requisitions SET last_pushed_status = 'PRINTED', last_pushed_at = NOW(), last_push_error = NULL WHERE id = ?`,
                  [cdacReq.id]
                );
              }
            } catch (e) {
              console.error('CDAC API5 (report) push failed:', e.message);
              await db.query(
                `UPDATE cdac_lab_requisitions SET last_push_error = ? WHERE id = ?`,
                [String(e.message).slice(0, 1000), cdacReq.id]
              );
            }
          }
        }
      } catch (cdacLookupErr) {
        console.error('CDAC results/status/report lookup error:', cdacLookupErr.message);
      }
      // --- END CDAC RESULTS/STATUS/REPORT PUSH ---
    }

    await connection.commit();

    // --- CARE RESULT PUSH (ORU) ---
    // Only fires for bill_items that originated from a CARE ORM order. CARE's
    // contract has exactly one outbound push (final results) — no
    // sample-collected or status-update equivalent, unlike CDAC's 3-step push
    // above — so this is the only new hook needed. Deliberately placed AFTER
    // connection.commit() (unlike the CDAC hook above, which runs before) —
    // nothing this reads needs to be in the same transaction, and this avoids
    // ever telling CARE a result is final while the local write could still
    // roll back.
    if (status === 'Approved') {
      try {
        const [[careOrder]] = await db.query(
          `SELECT co.* FROM bill_items bi
           JOIN care_lab_orders co ON co.bill_item_id = bi.id
           WHERE bi.sample_id = ? LIMIT 1`,
          [sample_id]
        );

        if (careOrder) {
          const branchConfig = await careService.getBranchCareConfig(careOrder.branch_id);

          if (branchConfig?.integration_type === 'CARE' && branchConfig.is_active) {
            try {
              const [[labTestResult]] = await db.query(
                `SELECT * FROM lab_test_result WHERE id = ? LIMIT 1`,
                [test_result_id]
              );
              if (labTestResult) {
                const { rawMessage, resultCount } = await buildResultOruPayload(careOrder, labTestResult);
                // Mirrors the CDAC hook's guard above (only pushes API31 if
                // investigationData.length) — an ORU with zero OBX segments
                // (no parameters matched care_loinc_parameter_map yet) is not
                // worth sending and would likely be rejected by CARE anyway.
                if (resultCount > 0) {
                  await careService.pushResultToCare(
                    { rawMessage, senderIp: branchConfig.care_sender_ip },
                    branchConfig,
                    { careLabOrderId: careOrder.id, billItemId: careOrder.bill_item_id, fillerOrderNumber: careOrder.filler_order_number }
                  );
                  await db.query(
                    `UPDATE care_lab_orders SET last_pushed_status = 'RESULT_PUSHED', last_pushed_at = NOW(), last_push_error = NULL WHERE id = ?`,
                    [careOrder.id]
                  );
                } else {
                  await db.query(
                    `UPDATE care_lab_orders SET last_push_error = 'No parameters matched care_loinc_parameter_map — nothing pushed' WHERE id = ?`,
                    [careOrder.id]
                  );
                }
              }
            } catch (careErr) {
              console.error('CARE ORU push failed:', careErr.message);
              await db.query(
                `UPDATE care_lab_orders SET last_push_error = ? WHERE id = ?`,
                [String(careErr.message).slice(0, 1000), careOrder.id]
              );
            }
          }
        }
      } catch (careLookupErr) {
        console.error('CARE result-push lookup error:', careLookupErr.message);
      }
    }
    // --- END CARE RESULT PUSH (ORU) ---

    res.json({
      success: true,
      message: `Test ${status.toLowerCase()} successfully`,
      data: {
        test_result_id,
        sample_id,
        status,
        verified_by,
        verified_at: verifiedAt,
        dsc_signed: !!signedPdfBuf,
        dsc_warning: dsc.warning || null,
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error verifying test:', error);
    res.status(500).json({
      success: false,
      message: 'Server error verifying test'
    });
  } finally {
    connection.release();
  }
};

// A verifying/approving doctor who isn't satisfied with a result can kick it
// back to the lab tech instead of Verify/Approve. Sets lab_test_result.status
// to 'Rerun Requested' — this removes it from the doctor's own queue
// (getPendingVerifications only looks at 'Test Done'/'Verified'/'Completed')
// and, via getWorklist's status CASE, makes it reappear as actionable in the
// lab tech's worklist. Re-submitting results through the normal
// saveTestResults flow clears the rerun fields and puts it back in front of
// the doctor automatically — no separate "clear rerun" step needed.
export const requestRerun = async (req, res) => {
  try {
    const { test_result_id, sample_id, reason } = req.body;
    const requested_by = req.user?.id || null;   // from the session, not the request body

    if (!test_result_id || !sample_id) {
      return res.status(400).json({
        success: false,
        message: 'test_result_id and sample_id are required'
      });
    }

    const [[before]] = await db.query('SELECT id, status, branch_id, report_version FROM lab_test_result WHERE id = ? AND sample_id = ?', [test_result_id, sample_id]);
    const [result] = await db.query(
      `UPDATE lab_test_result
       SET status = 'Rerun Requested',
           rerun_reason = ?,
           rerun_requested_by = ?,
           rerun_requested_at = NOW(),
           updated_at = NOW()
       WHERE id = ? AND sample_id = ? AND status IN ('Test Done', 'Verified')`,
      [reason || null, requested_by, test_result_id, sample_id]
    );

    if (result.affectedRows === 0) {
      return res.status(409).json({ success: false, message: 'A rerun can only be requested for a result that is Test Done or Verified.' });
    }

    await logResultAudit(db, { result_id: test_result_id, sample_id, branch_id: before?.branch_id || null, action: 'Rerun requested',
      from_status: before?.status || null, to_status: 'Rerun Requested', actor: actorFromReq(req), reason, version: before?.report_version || null });
    res.json({ success: true, message: 'Rerun requested — sent back to the lab for re-testing' });
  } catch (error) {
    console.error('Error requesting rerun:', error);
    res.status(500).json({ success: false, message: 'Server error requesting rerun' });
  }
};

// Get approved reports for download
export const getApprovedReports = async (req, res) => {
  try {
    const { search, from, to } = req.query;

    let query = `
      SELECT
        tr.id,
        tr.sample_id,
        tr.test_name,
        tr.tested_at,
        tr.verified_at,
        tr.verified_by,
        CONCAT(p.first_name, ' ', p.last_name) as patient_name,
        p.reg_no as patient_reg_no,
        p.telephone as patient_phone,
        CONCAT(u.first_name, ' ', u.last_name) as verified_by_name
      FROM lab_test_result tr
      LEFT JOIN patients p ON tr.patient_id = p.id
      LEFT JOIN users u ON tr.verified_by = u.id
      LEFT JOIN bill_items bi ON tr.sample_id = bi.sample_id
      LEFT JOIN bills b ON bi.bill_id = b.id
      WHERE tr.status = 'Approved'
    `;

    const params = [];

    // Enforce scope from the JWT, not a client-supplied query string — same
    // pattern as getBranches. Without this, any branch's staff saw every
    // other branch's approved reports (e.g. RIIMS saw CHCKAN's list).
    const role_level = req.user?.role_level;
    const branch_id = req.user?.branch_id;
    if (role_level === 'Sub-Central' && branch_id) {
      query += ` AND b.branch_id IN (SELECT id FROM branches WHERE district_id = (SELECT district_id FROM branches WHERE id = ?))`;
      params.push(branch_id);
    } else if (role_level === 'Branch' && branch_id) {
      query += ` AND b.branch_id = ?`;
      params.push(branch_id);
    }

    if (search) {
      // Widened beyond name/sample/test to every identifier a CARE site might
      // have to hand — UHID, ABHA, phone, CARE patient UUID. The Token No
      // branch below is preserved: a bare number is still treated as a
      // possible daily token, which the identifier clause cannot express.
      const { clause, params: searchParams } = identifierSearchClause(search, {
        patients: 'p', billItems: 'bi', sampleId: 'tr.sample_id', testName: 'tr.test_name',
      });

      const isNumeric = !isNaN(search) && search.trim() !== '';
      if (isNumeric) {
        query += ` AND ((
          SELECT COUNT(DISTINCT b2.id)
          FROM bills b2
          WHERE DATE(b2.created_at) = DATE(b.created_at) AND b2.id <= b.id
        ) = ? OR (1=1${clause.replace(' AND ', ' AND ')}))`;
        params.push(parseInt(search), ...searchParams);
      } else {
        query += clause;
        params.push(...searchParams);
      }
    }

    query += ` ORDER BY tr.verified_at DESC`;

    const [reports] = await db.query(query, params);

    res.json({
      success: true,
      count: reports.length,
      reports
    });

  } catch (error) {
    console.error('Error fetching approved reports:', error);

    res.status(500).json({
      success: false,
      message: 'Server error fetching approved reports'
    });
  }
};

// Get detailed report by sample_id
export const getReportDetails = async (req, res) => {
  try {
    const { sampleId } = req.params;

    const [rows] = await db.query(
      `SELECT 
        tr.id,
        tr.sample_id,
        tr.machine_no,
        tr.test_name,
        tr.results_json,
        tr.tested_by,
        tr.tested_at,
        tr.verified_by,
        tr.verified_at,
        tr.notes,
        tr.status,
        CONCAT(p.first_name, ' ', p.last_name) as patient_name,
        p.reg_no as patient_reg_no,
        CONCAT(ut.first_name, ' ', ut.last_name) as tested_by_name,
        CONCAT(uv.first_name, ' ', uv.last_name) as verified_by_name
      FROM lab_test_result tr
      LEFT JOIN patients p ON tr.patient_id = p.id
      LEFT JOIN users ut ON tr.tested_by = ut.id
      LEFT JOIN users uv ON tr.verified_by = uv.id
      WHERE tr.sample_id = ? AND tr.status = 'Approved'
      ORDER BY tr.verified_at DESC
      LIMIT 1`,
      [sampleId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Report not found or not approved'
      });
    }

    const report = rows[0];

    // Parse JSON results
    let results = [];
    try {
      results = typeof report.results_json === 'string'
        ? JSON.parse(report.results_json)
        : report.results_json;
    } catch (e) {
      results = [];
    }

    res.json({
      success: true,
      id: report.id,
      sample_id: report.sample_id,
      machine_no: report.machine_no,
      test_name: report.test_name,
      patient_name: report.patient_name,
      patient_reg_no: report.patient_reg_no,
      tested_by_name: report.tested_by_name,
      tested_at: report.tested_at,
      verified_by_name: report.verified_by_name,
      verified_at: report.verified_at,
      notes: report.notes,
      status: report.status,
      results_count: results.length,
      results
    });

  } catch (error) {
    console.error('Error fetching report details:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching report details'
    });
  }
};

// Generate PDF report - Professional HOD Style

/**
 * Builds the report exactly as the lab technician's download produces it.
 *
 * One builder for every route that emits a report — the staff download, the
 * WhatsApp send and the kiosk print. They each used to assemble their own
 * reportData, and the two patient-facing ones were far thinner: no hospital
 * branding, no branch address, no UHID, no age or sex, no collected/verified
 * timestamps, no QR. A patient's WhatsApp copy and the counter's printout
 * disagreed about what the same test said, which is indefensible on a
 * clinical document.
 *
 * Returns null when there is no approved result for that sample.
 */
/**
 * Signature for the QR printed on a report.
 *
 * The QR used to carry a bare UHID, which a phone camera turns into a number
 * nobody can do anything with, and before that an authenticated URL that
 * answered "Access denied" when scanned. It now carries a link that opens the
 * PDF itself.
 *
 * Unguessable rather than unauthenticated-and-open: the link is only valid
 * with an HMAC of the sample id, so knowing or guessing a sample number is not
 * enough to fetch somebody's results. Possession of the printed report is what
 * grants access, which is the same standard as the paper itself.
 */
export const reportQrSignature = (sampleId) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET || 'jh-lims')
    .update(`report:${sampleId}`)
    .digest('hex')
    .slice(0, 16);

/**
 * GET /api/lab/report/:sampleId?k=<signature>
 * The report PDF, opened by scanning the QR on a printed or WhatsApp copy.
 */
export const getReportByQr = async (req, res) => {
  const { sampleId } = req.params;
  const key = String(req.query.k || '');

  try {
    const expected = reportQrSignature(sampleId);
    // timingSafeEqual needs equal lengths; a wrong-length key is already wrong.
    const ok = key.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected));
    if (!ok) {
      return res.status(403).send('This link is not valid. Please collect your report at the counter.');
    }

    const data = await buildLabReportData(sampleId);
    if (!data) return res.status(404).send('Report not found or not yet approved.');

    const doc = await generateLabReportPDFStream(data);
    res.setHeader('Content-Type', 'application/pdf');
    // inline: a phone opens it in the browser's viewer rather than dumping a
    // file the patient then has to find.
    res.setHeader('Content-Disposition', `inline; filename="report-${sampleId}.pdf"`);
    doc.pipe(res);
  } catch (error) {
    console.error('getReportByQr error:', error);
    if (!res.headersSent) res.status(500).send('Could not open the report.');
  }
};

/** Does this identifier belong to the patient the report is for? */
export const reportBelongsTo = (data, query) => {
  const digits = String(query).replace(/\D/g, '');
  const regNo = String(query).toUpperCase().replace(/^CARE-/, '');
  const o = data._owner || {};
  return (
    (digits.length >= 10 && String(o.telephone || '').replace(/\D/g, '').slice(-10) === digits.slice(-10)) ||
    (digits.length >= 12 && String(o.abha_id || '').replace(/\D/g, '') === digits) ||
    String(o.reg_no || '').toUpperCase() === regNo ||
    String(o.reg_no || '').toUpperCase() === `CARE-${regNo}`
  );
};

/**
 * opts.resultId / opts.signatureId: build the report for a specific result that
 * is still waiting for its signature (Poxia DSC Agent), exactly as it will look
 * once approved; opts.approvedAt / opts.approverName stand in for what the
 * approval will record.
 */
export const buildLabReportData = async (sampleId, conn = db, opts = {}) => {
  const [rows] = await conn.query(`
    SELECT
      tr.id, tr.sample_id, tr.machine_no, tr.test_name, tr.results_json, tr.report_version,
      tr.tested_by, tr.tested_at, tr.verified_by, tr.verified_at, tr.notes,
      CONCAT(p.first_name, ' ', p.last_name) as patient_name,
      p.reg_no as patient_reg_no, p.gender, p.dob, p.telephone, p.abha_id,
      p.consultant_name, p.patient_type,
      CONCAT(ut.first_name, ' ', ut.last_name) as tested_by_name,
      COALESCE(NULLIF(CONCAT(ua.first_name, ' ', ua.last_name), ' '), CONCAT(uv.first_name, ' ', uv.last_name)) as verified_by_name,
      COALESCE(tr.approved_at, tr.verified_at) as approved_time,
      i.name as lab_name,
      br.branch_name, br.address as branch_address, br.contact_number as branch_contact,
      d.name as branch_district
    FROM lab_test_result tr
    LEFT JOIN patients p ON tr.patient_id = p.id
    LEFT JOIN users ut ON tr.tested_by = ut.id
    LEFT JOIN users uv ON tr.verified_by = uv.id
    LEFT JOIN users ua ON tr.approved_by = ua.id
    LEFT JOIN bill_items bi ON tr.bill_item_id = bi.id
    LEFT JOIN bills b ON bi.bill_id = b.id
    LEFT JOIN branches br ON b.branch_id = br.id
    LEFT JOIN districts d ON d.id = br.district_id
    LEFT JOIN infrastructure i ON bi.lab_id = i.id
    WHERE ${opts.resultId ? 'tr.id = ?' : "tr.sample_id = ? AND tr.status = 'Approved'"}
    ORDER BY tr.verified_at DESC
    LIMIT 1`, [opts.resultId || sampleId]);

  if (!rows.length) return null;
  const report = rows[0];
  if (opts.approvedAt) report.approved_time = opts.approvedAt;
  if (opts.approverName) report.verified_by_name = opts.approverName;

  let results = [];
  try {
    results = typeof report.results_json === 'string'
      ? JSON.parse(report.results_json) : (report.results_json || []);
  } catch { results = []; }

  let age = 'N/A';
  if (report.dob) {
    const birth = new Date(report.dob);
    const today = new Date();
    let years = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) years--;
    age = years + ' Y';
  }

  const formatDate = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).replace(',', '');
  };

  // Electronic authentication: the latest signature on this result, with a
  // live check that the content still matches what the doctor signed.
  let authentication = null;
  const [[sig]] = opts.signatureId
    ? await conn.query('SELECT * FROM report_signatures WHERE id = ? AND result_id = ?', [opts.signatureId, report.id])
    : await conn.query("SELECT * FROM report_signatures WHERE result_id = ? AND status = 'Valid' ORDER BY id DESC LIMIT 1", [report.id]);
  if (sig) {
    const check = await checkSignature(conn, sig);
    authentication = {
      signer_name: sig.signer_name, designation: sig.designation, registration_no: sig.registration_no,
      signature_image: sig.signature_image, signed_at: formatDate(sig.signed_at), state: check.state,
      hash_short: sig.content_hash.slice(0, 16).toUpperCase(),
      verify_url: `${PUBLIC_APP_URL}/verify-report/${sig.id}?k=${verifyKey(sig.id)}`,
    };
  }

  // A corrected report says so, and why.
  let amendment = null;
  if (Number(report.report_version) > 1) {
    const [[last]] = await conn.query('SELECT superseded_reason FROM lab_result_versions WHERE result_id = ? ORDER BY version DESC LIMIT 1', [report.id]);
    amendment = { version: Number(report.report_version), reason: last?.superseded_reason || null };
  }

  const [settingsRows] = await conn.query('SELECT * FROM hospital_settings LIMIT 1');
  const hospitalSettings = settingsRows.length ? settingsRows[0] : null;

  // A merged sample runs several tests from one tube, so the report is titled
  // with all of them rather than whichever name the analyzer sent.
  const [mergedRows] = await conn.query(
    `SELECT service_name FROM bill_items WHERE sample_id = ? AND service_type = 'Laboratory' ORDER BY id`,
    [sampleId]
  );
  const testName = mergedRows.length > 1
    ? mergedRows.map((r) => r.service_name).join(' & ')
    : (report.test_name || mergedRows[0]?.service_name || 'Lab Test');

  return {
    hospital_settings: hospitalSettings,
    branch_name: report.branch_name,
    branch_district: report.branch_district,
    branch_address: report.branch_address,
    branch_contact: report.branch_contact,
    patient_name: report.patient_name || 'Unknown',
    patient_reg_no: report.patient_reg_no || 'N/A',
    // Shown on the report only when one is linked — see pdfGenerator.
    abha_id: report.abha_id || null,
    sample_id: report.sample_id,
    gender: report.gender || 'N/A',
    age,
    // consultant_name (set at registration — see PatientDetails.jsx) is the
    // real value when known; falls back to 'Self' for patients registered
    // before that field existed, or who genuinely have no referring
    // consultant, rather than showing a blank.
    referred_by: report.consultant_name || 'Self',
    patient_mobile: report.telephone || null,
    patient_type: report.patient_type || null,
    centre: report.lab_name || report.branch_name || hospitalSettings?.hospital_name || 'MERIL HIMS',
    registration_date: formatDate(report.tested_at),
    tested_by_name: report.tested_by_name || 'N/A',
    tested_at: formatDate(report.tested_at),
    verified_by_name: report.verified_by_name || 'N/A',
    verified_at: formatDate(report.approved_time || report.verified_at),
    authentication,
    amendment,
    // Scanning this opens the PDF itself — on a phone camera, on the kiosk
    // scanner, anywhere. The signature is what makes it safe to leave
    // unauthenticated.
    // Signed reports point at the verification page (which links on to the
    // PDF); legacy approved reports keep the direct PDF link.
    report_url: authentication?.verify_url || `${PUBLIC_API_URL}/api/lab/report/${encodeURIComponent(sampleId)}?k=${reportQrSignature(sampleId)}`,
    tests: [{
      test_name: testName,
      sample_type: 'Blood Sample',
      accession_no: report.sample_id,
      collected_on: formatDate(report.tested_at),
      received_on: formatDate(report.tested_at),
      approved_on: formatDate(report.verified_at),
      remarks: report.notes || 'Please correlate results clinically.',
      parameters: results.map((r) => ({
        parameter_name: r.parameter_name || r.parameter_code || 'Unknown',
        result_value: r.result_value || '',
        unit: r.unit || '',
        reference_range: r.reference_range || r.ref_range || '',
        result_flag: externalFlag(r.result_flag || r.flag),
        is_subheader: r.is_subheader || false,
      })),
    }],
    // Not part of the document; used by the callers to check ownership.
    _owner: { telephone: report.telephone, abha_id: report.abha_id, reg_no: report.patient_reg_no },
  };
};

export const generateLabReportPDF = async (req, res) => {
  try {
    const { sampleId } = req.params;

    // The reference document. Everything else that emits a report — the
    // WhatsApp send, the kiosk print — calls this same builder, so what a
    // patient receives and what the lab holds are the same paper.
    const reportData = await buildLabReportData(sampleId);
    if (!reportData) {
      return res.status(404).json({ success: false, message: 'Report not found or not approved' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="lab-report-${sampleId}.pdf"`);

    const doc = await generateLabReportPDFStream(reportData);
    doc.pipe(res);
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Server error generating PDF'
    });
  }
};

// Get hospital code for machine ID generation
export const getHospitalCode = async (req, res) => {
  try {
    const { userId } = req.params;
    const [rows] = await db.query(
      `SELECT hospital_code FROM branches WHERE id = (SELECT branch_id FROM users WHERE id = ?)`,
      [userId]
    );
    if (rows.length === 0) {
      return res.json({ success: true, hospital_code: 'LAB' }); // Fallback
    }
    res.json({ success: true, hospital_code: rows[0].hospital_code });
  } catch (error) {
    console.error('Error fetching hospital code:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get machine protocol JSON for dynamic parsing in LIS Agent
export const getMachineProtocol = async (req, res) => {
  try {
    const { model } = req.params;
    const path = `./utils/machinesid.json/${model.toLowerCase()}.json`;
    
    const fs = await import('fs/promises');
    const data = await fs.readFile(path, 'utf8');
    const protocol = JSON.parse(data);
    
    res.json({ success: true, protocol });
  } catch (error) {
    console.error('Error fetching machine protocol:', error);
    res.status(404).json({ success: false, message: 'Protocol not found for this model' });
  }
};

// Create an unsolicited worklist entry for analyzer results that don't match an active test
export const createUnsolicitedWorklist = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { sample_id, patient_name, test_name } = req.body;

    if (!sample_id) {
      return res.status(400).json({ success: false, message: 'Sample ID is required' });
    }

    // Check if it already exists
    const [existing] = await connection.query(`SELECT id FROM bill_items WHERE sample_id = ?`, [sample_id]);
    if (existing.length > 0) {
      // Return existing
      const [rows] = await connection.query(`
        SELECT bi.id as bill_item_id, b.id as bill_id, p.id as patient_id,
          CONCAT(p.first_name, ' ', p.last_name) as patient_name,
          lt.id as test_id, lt.test_name, bi.sample_id, bi.short_id, bi.status
        FROM bill_items bi JOIN bills b ON bi.bill_id = b.id JOIN patients p ON b.patient_id = p.id
        LEFT JOIN lab_tests lt ON bi.service_id = lt.id WHERE bi.sample_id = ? LIMIT 1
      `, [sample_id]);
      await connection.commit();
      return res.json({ success: true, test: rows[0] });
    }

    // 1. Resolve Patient
    let pName = patient_name ? patient_name.replace(/\^/g, ' ').trim() : 'Unknown Patient';
    let patientId;
    
    // If we have a real name, try to find them, else create a new patient
    if (pName !== 'Unknown Patient') {
      const [pts] = await connection.query(`SELECT id FROM patients WHERE CONCAT(first_name, ' ', last_name) = ? OR first_name = ? LIMIT 1`, [pName, pName]);
      if (pts.length > 0) {
        patientId = pts[0].id;
      } else {
        const regNo = `ANL-${Date.now()}`;
        const [insPt] = await connection.query(`
          INSERT INTO patients (reg_no, reg_date, first_name, last_name, telephone, gender) 
          VALUES (?, NOW(), ?, '', '0000000000', 'Other')`, [regNo, pName]);
        patientId = insPt.insertId;
      }
    } else {
      // Fallback dummy patient
      const [pts] = await connection.query(`SELECT id FROM patients WHERE first_name = 'Unknown Patient' LIMIT 1`);
      if (pts.length > 0) {
        patientId = pts[0].id;
      } else {
        const regNo = `ANL-${Date.now()}`;
        const [insPt] = await connection.query(`
          INSERT INTO patients (reg_no, reg_date, first_name, last_name, telephone, gender) 
          VALUES (?, NOW(), 'Unknown Patient', '', '0000000000', 'Other')`, [regNo]);
        patientId = insPt.insertId;
      }
    }

    // 2. Find a generic lab test for the analyzer
    let testId = null;
    let tName = test_name || 'Unmapped Analyzer Test';
    const [tests] = await connection.query(`SELECT id, test_name FROM lab_tests WHERE test_name = ? OR test_name = 'Unmapped Analyzer Test' LIMIT 1`, [tName]);
    if (tests.length > 0) {
      testId = tests[0].id;
      tName = tests[0].test_name;
    } else {
      const tCode = `UNM-${Date.now().toString().slice(-6)}`;
      const [cats] = await connection.query('SELECT id FROM lab_categories LIMIT 1');
      const catId = cats.length > 0 ? cats[0].id : 1;
      const [insT] = await connection.query(`INSERT INTO lab_tests (test_code, test_name, category_id, sample_type, price) VALUES (?, ?, ?, 'Serum', 0)`, [tCode, tName, catId]);
      testId = insT.insertId;
    }

    // 3. Create Bill
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const [billCount] = await connection.query('SELECT COUNT(*) as count FROM bills WHERE DATE(created_at) = CURDATE()');
    const billNumber = `BILL-${date}-${(billCount[0].count + 1).toString().padStart(4, '0')}`;
    const [billResult] = await connection.query(
      `INSERT INTO bills (patient_id, bill_number, total_amount, payment_status, created_at, updated_at) VALUES (?, ?, 0, 'Paid', NOW(), NOW())`,
      [patientId, billNumber]
    );
    const billId = billResult.insertId;

    // 4. Create Bill Item
    const shortId = sample_id.slice(-4);
    const [biResult] = await connection.query(
      `INSERT INTO bill_items (bill_id, service_type, service_id, service_name, unit_price, total_price, status, sample_id, short_id, created_at, updated_at)
       VALUES (?, 'Laboratory', ?, ?, 0, 0, 'In Progress', ?, ?, NOW(), NOW())`,
      [billId, testId, tName, sample_id, shortId]
    );

    await connection.commit();

    const newTest = {
      bill_item_id: biResult.insertId,
      bill_id: billId,
      patient_id: patientId,
      patient_name: pName,
      test_id: testId,
      test_name: tName,
      sample_id: sample_id,
      short_id: shortId,
      status: 'In Progress'
    };

    res.json({ success: true, test: newTest });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating unsolicited worklist:', error);
    res.status(500).json({ success: false, message: 'Server error creating unsolicited worklist' });
  } finally {
    connection.release();
  }
};


export const mapUnmappedTest = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { sample_id, patient_reg_no } = req.body;
    if (!sample_id || !patient_reg_no) {
      return res.status(400).json({ success: false, message: 'Sample ID and Patient CRN are required.' });
    }

    await connection.beginTransaction();

    // 1. Find the real patient by CRN
    const [realPatients] = await connection.query(`SELECT id, CONCAT(first_name, ' ', last_name) as name, telephone FROM patients WHERE reg_no = ? LIMIT 1`, [patient_reg_no]);
    if (realPatients.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Patient not found with that CRN.' });
    }
    const realPatient = realPatients[0];

    // 2. Find the bill item to get the bill_id and test_id
    const [billItems] = await connection.query(`SELECT bill_id, service_id as test_id FROM bill_items WHERE sample_id = ? LIMIT 1`, [sample_id]);
    if (billItems.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Test not found for that Sample ID.' });
    }
    const billId = billItems[0].bill_id;

    // 3. Update the bills table to the real patient
    await connection.query(`UPDATE bills SET patient_id = ? WHERE id = ?`, [realPatient.id, billId]);

    // 4. Update lab_test_result (if it exists) to the real patient
    await connection.query(`UPDATE lab_test_result SET patient_id = ? WHERE sample_id = ?`, [realPatient.id, sample_id]);

    await connection.commit();

    res.json({ success: true, message: 'Patient successfully mapped.', patient: realPatient.name });

  } catch (error) {
    await connection.rollback();
    console.error('Error mapping unsolicited test:', error);
    res.status(500).json({ success: false, message: 'Server error mapping test.' });
  } finally {
    connection.release();
  }
};

// ── Kiosk: fetch patient reports by phone ────────────────────────────────────
export const getKioskReports = async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || query.trim().length < 4) {
      return res.status(400).json({ success: false, message: 'Enter at least 4 digits' });
    }

    const q = query.trim();

    // Phone, ABHA number or UHID — whichever the patient has to hand, and
    // whatever a scanned QR code turns out to contain.
    //
    // Matched exactly, not by substring. The previous `telephone LIKE %q%`
    // meant four typed digits could match a stranger's number, and the code
    // then silently took patients[0] — one person collecting another's
    // results. Each identifier below has to match in full.
    const digits = q.replace(/\D/g, '');
    const abhaDigits = digits;                       // ABHA is written 91-1234-5678-9012
    const regNo = q.toUpperCase().replace(/^CARE-/, '');

    const clauses = [];
    const params = [];

    if (digits.length >= 10) {
      // Last 10 digits, so +91 / 0 prefixes and spacing all match the same row.
      clauses.push(`RIGHT(REGEXP_REPLACE(COALESCE(p.telephone, ''), '[^0-9]', ''), 10) = ?`);
      params.push(digits.slice(-10));
    }
    if (abhaDigits.length >= 12) {
      clauses.push(`REGEXP_REPLACE(COALESCE(p.abha_id, ''), '[^0-9]', '') = ?`);
      params.push(abhaDigits);
    }
    // UHID: ours is stored as CARE-<uhid> for CARE patients, plain otherwise.
    clauses.push(`UPPER(p.reg_no) = ? OR UPPER(p.reg_no) = ?`);
    params.push(regNo, `CARE-${regNo}`);

    // A scanned QR may carry a CARE request id instead of a UHID, which
    // identifies one order rather than the person — so it is resolved back to
    // the patient who owns that order.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)) {
      clauses.push(`p.id IN (SELECT b2.patient_id FROM bill_items bi2
                               JOIN bills b2 ON b2.id = bi2.bill_id
                              WHERE bi2.care_request_id = ?)`);
      params.push(q);
    }

    const [patients] = await db.query(
      `SELECT p.id, p.first_name, p.last_name, p.telephone, p.reg_no, p.abha_id
         FROM patients p
        WHERE ${clauses.map((c) => `(${c})`).join(' OR ')}
        LIMIT 5`,
      params
    );

    if (patients.length === 0) {
      return res.json({ success: true, patient: null, reports: [] });
    }

    // Two people cannot share a phone, ABHA or UHID; if they do the data is
    // wrong and guessing between them is how one patient goes home with
    // another's results.
    if (patients.length > 1) {
      return res.json({
        success: true, patient: null, reports: [], ambiguous: true,
        message: 'More than one patient matches that. Please ask at the counter.',
      });
    }

    const patient = patients[0];
    // Tests this patient has in the lab right now — booked, collected or
    // running, with nothing approved against them yet.
    const [pendingTests] = await db.query(
      `SELECT bi.sample_id, bi.short_id, bi.service_name AS test_name, bi.status,
              b.created_at AS booked_at
         FROM bill_items bi
         JOIN bills b ON b.id = bi.bill_id
        WHERE b.patient_id = ?
          AND bi.service_type = 'Laboratory'
          AND bi.status IN ('Pending', 'Collected', 'In Progress', 'Test Done')
          AND NOT EXISTS (SELECT 1 FROM lab_test_result r
                           WHERE r.sample_id = bi.sample_id AND r.status = 'Approved')
        ORDER BY bi.id DESC
        LIMIT 20`,
      [patient.id]
    );


    // Fetch approved reports from last 7 days
    const [reports] = await db.query(
      `SELECT
         tr.id, tr.sample_id, tr.test_name,
         tr.verified_at, tr.status,
         bi.service_name,
         b.bill_number,
         CONCAT(u.first_name, ' ', u.last_name) as verified_by_name
       FROM lab_test_result tr
       LEFT JOIN bill_items bi ON tr.sample_id = bi.sample_id
       LEFT JOIN bills b       ON bi.bill_id   = b.id
       LEFT JOIN users u       ON tr.verified_by = u.id
       WHERE tr.patient_id = ?
         AND tr.status = 'Approved'
         AND COALESCE(tr.verified_at, tr.tested_at) >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       ORDER BY COALESCE(tr.verified_at, tr.tested_at) DESC`,
      [patient.id]
    );

    res.json({
      success: true,
      patient: {
        name: `${patient.first_name} ${patient.last_name}`.trim(),
        phone: patient.telephone
      },
      reports,
      // What is still being worked on. A patient who walks up and sees
      // nothing cannot tell "not ready yet" from "we lost it" — this says
      // which of their tests the lab still has.
      pending: pendingTests,
    });
  } catch (error) {
    console.error('Kiosk reports error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/lab/kiosk-stats?branch_id=…
 *
 * Counts for the lobby slideshow. Public, so it returns numbers only — never a
 * name, never an identifier, never a value. A waiting room is full of
 * strangers, and a board that shows who was tested for what is a disclosure
 * whether or not the result is on it.
 */
export const getKioskStats = async (req, res) => {
  try {
    const { branch_id } = req.query;
    const scoped = branch_id && branch_id !== 'all';
    const p = scoped ? [branch_id] : [];
    const w = scoped ? 'AND b.branch_id = ?' : '';

    const [[today]] = await db.query(`
      SELECT COUNT(*) AS booked,
             SUM(bi.status IN ('Test Done', 'Completed')) AS completed,
             SUM(bi.status IN ('Pending', 'Collected', 'In Progress')) AS in_progress
        FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
       WHERE bi.service_type = 'Laboratory' AND DATE(b.created_at) = CURDATE() ${w}`, p);

    const [[week]] = await db.query(`
      SELECT COUNT(*) AS tests, COUNT(DISTINCT b.patient_id) AS patients
        FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
       WHERE bi.service_type = 'Laboratory'
         AND b.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) ${w}`, p);

    // The month in the SAME shape as today, so the stats slide can keep one
    // layout and simply count its figures up to the larger period rather than
    // swapping in a second screen.
    const [[month]] = await db.query(`
      SELECT COUNT(*) AS tests, COUNT(DISTINCT b.patient_id) AS patients,
             COUNT(*) AS booked,
             SUM(bi.status IN ('Test Done', 'Completed')) AS completed,
             SUM(bi.status IN ('Pending', 'Collected', 'In Progress')) AS in_progress
        FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
       WHERE bi.service_type = 'Laboratory'
         AND YEAR(b.created_at) = YEAR(CURDATE())
         AND MONTH(b.created_at) = MONTH(CURDATE()) ${w}`, p);

    // Its own most-performed list, so the chart moves with the counters.
    const [topTestsMonth] = await db.query(`
      SELECT bi.service_name AS test_name, COUNT(*) AS count
        FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
       WHERE bi.service_type = 'Laboratory'
         AND YEAR(b.created_at) = YEAR(CURDATE())
         AND MONTH(b.created_at) = MONTH(CURDATE()) ${w}
       GROUP BY bi.service_name ORDER BY count DESC LIMIT 6`, p);

    const [[year]] = await db.query(`
      SELECT COUNT(*) AS tests, COUNT(DISTINCT b.patient_id) AS patients
        FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
       WHERE bi.service_type = 'Laboratory'
         AND YEAR(b.created_at) = YEAR(CURDATE()) ${w}`, p);

    const [topTests] = await db.query(`
      SELECT bi.service_name AS test_name, COUNT(*) AS count
        FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
       WHERE bi.service_type = 'Laboratory'
         AND b.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) ${w}
       GROUP BY bi.service_name ORDER BY count DESC LIMIT 6`, p);

    // Which tests finished recently, as counts per test — no patient attached.
    const [recent] = await db.query(`
      SELECT bi.service_name AS test_name, COUNT(*) AS count, MAX(tr.verified_at) AS latest
        FROM lab_test_result tr
        JOIN bill_items bi ON bi.sample_id = tr.sample_id
        JOIN bills b ON b.id = bi.bill_id
       WHERE tr.status IN ('Approved', 'Verified')
         AND tr.verified_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) ${w}
       GROUP BY bi.service_name ORDER BY latest DESC LIMIT 8`, p);

    // For the corner panel that tells people their report is ready.
    //
    // Named only as "Deependra K." — a lobby is full of strangers, and a full
    // name beside a test is a disclosure. The sample ID is what actually
    // identifies it: the patient has it printed on the slip in their hand,
    // and nobody else knows which slip is whose.
    const [ready] = await db.query(`
      SELECT tr.sample_id, bi.service_name AS test_name, tr.verified_at,
             p.first_name, p.last_name
        FROM lab_test_result tr
        JOIN bill_items bi ON bi.sample_id = tr.sample_id
        JOIN bills b ON b.id = bi.bill_id
        LEFT JOIN patients p ON p.id = b.patient_id
       WHERE tr.status IN ('Approved', 'Verified')
         AND tr.verified_at >= DATE_SUB(NOW(), INTERVAL 12 HOUR) ${w}
       ORDER BY tr.verified_at DESC LIMIT 16`, p);   // two columns of eight on the board

    const masked = ready.map((r) => ({
      sample_id: r.sample_id,
      test_name: r.test_name,
      verified_at: r.verified_at,
      name: [r.first_name, (r.last_name || '').trim().charAt(0)]
        .filter(Boolean).join(' ').trim() + (r.last_name ? '.' : ''),
    }));

    res.json({
      success: true,
      ready: masked,
      today: {
        booked: Number(today?.booked || 0),
        completed: Number(today?.completed || 0),
        in_progress: Number(today?.in_progress || 0),
      },
      week: { tests: Number(week?.tests || 0), patients: Number(week?.patients || 0) },
      month: {
        tests: Number(month?.tests || 0),
        patients: Number(month?.patients || 0),
        booked: Number(month?.booked || 0),
        completed: Number(month?.completed || 0),
        in_progress: Number(month?.in_progress || 0),
      },
      top_tests_month: topTestsMonth,
      year: { tests: Number(year?.tests || 0), patients: Number(year?.patients || 0) },
      top_tests: topTests,
      recent_completed: recent,
    });
  } catch (error) {
    console.error('Kiosk stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Public lobby-TV queue display. Deliberately a separate, minimal endpoint
// rather than exposing getWorklist without auth — that one returns full
// patient details AND actual results_json, which must never be reachable
// unauthenticated. This mirrors getWorklist's same queue-numbering logic
// (sequential per bill_id, computed across the whole day's items so numbers
// stay stable as items move through the pipeline) but returns only what a
// public screen may show: patient name, department, queue number.
export const getKioskQueue = async (req, res) => {
  try {
    const { branch_id } = req.query;

    let query = `
      SELECT
        bi.id as bill_item_id,
        b.id as bill_id,
        CONCAT(p.first_name, ' ', p.last_name) as patient_name,
        lc.name as department,
        CASE
          WHEN tr.status = 'Rerun Requested' THEN 'Rerun Requested'
          WHEN tr.id IS NOT NULL THEN 'Test Done'
          ELSE bi.status
        END as status
      FROM bill_items bi
      JOIN bills b ON bi.bill_id = b.id
      JOIN patients p ON b.patient_id = p.id
      JOIN lab_tests lt ON bi.service_id = lt.id
      LEFT JOIN lab_categories lc ON lt.category_id = lc.id
      LEFT JOIN lab_test_result tr ON bi.sample_id = tr.sample_id
      WHERE bi.service_type = 'Laboratory'
      AND bi.status IN ('Pending', 'Collected', 'In Progress', 'Test Done')
      AND b.payment_status IN ('Pending', 'Partial', 'Paid')
      AND DATE(b.created_at) = CURDATE()
    `;
    const params = [];

    if (branch_id && branch_id !== 'all') {
      query += ` AND b.branch_id = ?`;
      params.push(branch_id);
    }

    query += ` GROUP BY bi.bill_id, bi.id, b.id, p.id, lc.name, tr.id, bi.status`;
    query += ` ORDER BY b.created_at ASC`;

    const [rows] = await db.query(query, params);

    let currentQueueNo = 1;
    const billQueueMap = {};
    const queue = rows
      .map(item => {
        if (!billQueueMap[item.bill_id]) billQueueMap[item.bill_id] = currentQueueNo++;
        return {
          patient_name: item.patient_name,
          department: item.department,
          status: item.status,
          lab_queue_number: billQueueMap[item.bill_id],
        };
      })
      .filter(item => item.status === 'Pending');

    res.json({ success: true, worklist: queue });
  } catch (error) {
    console.error('Kiosk queue error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching queue' });
  }
};

// Public kiosk: patient found their own report via getKioskQueue and asked to
// have it sent to WhatsApp. Builds the PDF in-process (same reportData shape
// as generateLabReportPDF, same restriction to status='Approved' — a patient
// can only ever fetch their own already-finalized report this way) rather
// than the previous self-HTTP-call to /generate-report-pdf, which always
// 401'd since that route requires a staff token this caller never has.
/**
 * POST /api/lab/kiosk-print-report  { sampleId, query }
 *
 * The PDF for a lobby printout. Public, like the rest of the kiosk, so it is
 * gated the same way collection is: the caller must supply an identifier that
 * resolves to the patient who owns this sample. Without that check this route
 * would hand any patient's results to anyone who guessed a sample number.
 *
 * Streams the PDF rather than a link, so the kiosk can print without a browser
 * download or a signed-in session.
 */
// One send per sample per two minutes. The lobby board is public and a row is
// one tap away, so without this a bored passer-by could flood a patient's
// phone. Two minutes is long enough to stop that and short enough that a
// patient who mistyped nothing and simply tapped twice is not stuck.
const lastBoardSend = new Map();
const BOARD_SEND_COOLDOWN_MS = 120000;

/**
 * POST /api/lab/kiosk-send-ready  { sampleId }
 *
 * Sends a ready report to the number already registered against it. No
 * identifier is asked for and none is returned: the caller names a sample and
 * the result goes to that patient's own phone, so tapping a row on the public
 * board can never deliver anything to the person standing at the screen.
 */
export const sendReadyReportToPatient = async (req, res) => {
  const sampleId = String(req.body?.sampleId || '').trim();
  if (!sampleId) {
    return res.status(400).json({ success: false, message: 'sampleId is required' });
  }

  const last = lastBoardSend.get(sampleId);
  if (last && Date.now() - last < BOARD_SEND_COOLDOWN_MS) {
    return res.status(429).json({
      success: false,
      message: 'That report was just sent. Please check your WhatsApp.',
    });
  }

  try {
    const [[row]] = await db.query(
      `SELECT tr.sample_id, tr.test_name, p.telephone,
              CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name,
              bi.service_name
         FROM lab_test_result tr
         LEFT JOIN patients p ON p.id = tr.patient_id
         LEFT JOIN bill_items bi ON bi.sample_id = tr.sample_id
        WHERE tr.sample_id = ? AND tr.status = 'Approved'
        LIMIT 1`,
      [sampleId]
    );

    if (!row) {
      return res.status(404).json({ success: false, message: 'Report not found or not approved' });
    }
    if (!row.telephone) {
      return res.status(409).json({
        success: false,
        message: 'No mobile number is registered for this patient. Please ask at the counter.',
      });
    }

    lastBoardSend.set(sampleId, Date.now());

    // Reuses the kiosk WhatsApp path, with the number taken from the record
    // rather than from the request — the browser never sees it.
    req.body = {
      sampleId,
      phone: row.telephone,
      patientName: row.patient_name,
      testName: row.test_name || row.service_name,
    };
    req.deliveryTrigger = 'Lobby board';
    return sendKioskReportWhatsApp(req, res);
  } catch (error) {
    console.error('sendReadyReportToPatient error:', error);
    return res.status(500).json({ success: false, message: 'Could not send right now' });
  }
};

/**
 * POST /api/lab/kiosk-view-report  { sampleId, query }
 *
 * The report's values as data, for showing on the kiosk screen.
 *
 * Separate from the print route on purpose. That one returns a PDF, which is
 * built for A4 and cannot be read on a lobby panel — and the embedded viewer
 * needed to display one is not available in a locked-down kiosk, so it showed
 * nothing at all. A screen wants rows it can lay out large; a printer wants
 * the PDF. Same ownership check on both.
 */
export const viewKioskReport = async (req, res) => {
  const sampleId = String(req.body?.sampleId || '').trim();
  const query = String(req.body?.query || '').trim();
  if (!sampleId || !query) {
    return res.status(400).json({ success: false, message: 'sampleId and query are required' });
  }

  try {
    const [[row]] = await db.query(
      `SELECT tr.sample_id, tr.results_json, tr.notes, tr.test_name, tr.verified_at,
              CONCAT_WS(' ', p.first_name, p.last_name) AS patient_name,
              p.reg_no, p.abha_id, p.telephone, p.gender, p.dob,
              CONCAT_WS(' ', u.first_name, u.last_name) AS verified_by_name
         FROM lab_test_result tr
         LEFT JOIN patients p ON p.id = tr.patient_id
         LEFT JOIN users u ON u.id = tr.verified_by
        WHERE tr.sample_id = ? AND tr.status = 'Approved'
        LIMIT 1`,
      [sampleId]
    );

    if (!row) {
      return res.status(404).json({ success: false, message: 'Report not found or not approved' });
    }

    // Same identifiers the lookup accepts, checked against this report's owner.
    const digits = query.replace(/\D/g, '');
    const regNo = query.toUpperCase().replace(/^CARE-/, '');
    const owns =
      (digits.length >= 10 && String(row.telephone || '').replace(/\D/g, '').slice(-10) === digits.slice(-10)) ||
      (digits.length >= 12 && String(row.abha_id || '').replace(/\D/g, '') === digits) ||
      String(row.reg_no || '').toUpperCase() === regNo ||
      String(row.reg_no || '').toUpperCase() === `CARE-${regNo}`;

    if (!owns) {
      return res.status(403).json({ success: false, message: 'That identifier does not match this report' });
    }

    let parsed = [];
    try {
      parsed = typeof row.results_json === 'string' ? JSON.parse(row.results_json) : (row.results_json || []);
    } catch { parsed = []; }

    const [mergedRows] = await db.query(
      `SELECT service_name FROM bill_items WHERE sample_id = ? AND service_type = 'Laboratory' ORDER BY id`,
      [sampleId]
    );

    await recordDelivery({ sampleId, channel: 'Kiosk view', recipient: maskPhone(row.telephone), status: 'Delivered', triggeredBy: 'Patient kiosk', req });

    res.json({
      success: true,
      sample_id: row.sample_id,
      test_name: mergedRows.length > 1
        ? mergedRows.map(r => r.service_name).join(' & ')
        : (row.test_name || mergedRows[0]?.service_name || 'Lab Test'),
      patient_name: row.patient_name,
      reg_no: row.reg_no,
      gender: row.gender,
      verified_at: row.verified_at,
      verified_by: row.verified_by_name,
      notes: row.notes,
      parameters: (Array.isArray(parsed) ? parsed : []).map((r) => ({
        name: r.parameter_name || r.parameter_code || 'Unknown',
        value: r.result_value ?? '',
        unit: r.unit || '',
        ref_range: r.ref_range || r.reference_range || '',
        flag: (r.flag || r.result_flag || '').toString().toUpperCase(),
      })),
    });
  } catch (error) {
    console.error('viewKioskReport error:', error);
    res.status(500).json({ success: false, message: 'Could not read the report' });
  }
};

export const printKioskReport = async (req, res) => {
  const { sampleId, query } = req.body || {};
  if (!sampleId || !query) {
    return res.status(400).json({ success: false, message: 'sampleId and query are required' });
  }

  try {
    // The very same document the lab technician downloads — same builder, so
    // the two cannot drift apart.
    const data = await buildLabReportData(sampleId);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Report not found or not approved' });
    }
    if (!reportBelongsTo(data, query)) {
      return res.status(403).json({ success: false, message: 'That identifier does not match this report' });
    }

    const doc = await generateLabReportPDFStream(data);
    await recordDelivery({ sampleId, channel: 'Kiosk print', recipient: maskPhone(data.patient_mobile), status: 'Delivered', triggeredBy: 'Patient kiosk', req });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="report-${sampleId}.pdf"`);
    doc.pipe(res);
  } catch (error) {
    console.error('printKioskReport error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Could not build the report' });
  }
};

export const sendKioskReportWhatsApp = async (req, res) => {
  const { sampleId, phone } = req.body;

  if (!sampleId || !phone) {
    return res.status(400).json({ success: false, message: 'sampleId and phone are required' });
  }

  // This is a public, unauthenticated kiosk endpoint (see labRoutes.js) — the
  // only thing stopping it from sending any patient's report to an arbitrary
  // attacker-chosen phone number is proving the caller already knows the
  // phone on file for this sample. dispatchReport enforces that (comparing
  // the last 10 digits, so +91/0 prefixes and spacing all match), sends only
  // to the number on file, honours an opt-out, and logs the delivery. The PDF
  // is built by buildLabReportData, so the copy a patient receives is
  // byte-for-byte the document the lab technician downloads.
  try {
    await dispatchReport({
      sampleId, channel: 'WhatsApp', recipient: phone, buildData: buildLabReportData,
      triggeredBy: req.deliveryTrigger || 'Patient kiosk', req,
    });
    res.json({ success: true, message: 'Report sent on WhatsApp successfully' });
  } catch (error) {
    // VAPT #8 (Improper Error Handling): only DeliveryError messages are
    // written for patients; anything else is logged, not echoed.
    if (error instanceof DeliveryError) return res.status(error.status).json({ success: false, message: error.message });
    console.error('Kiosk WhatsApp send report error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Staff-facing "Resend" on the Reports page — same dispatch path as the
// kiosk, but no phone-ownership check (the caller is an authenticated staff
// member); the number always comes from the patient record.
export const resendReportWhatsApp = async (req, res) => {
  const { sampleId } = req.params;
  try {
    const { recipient } = await dispatchReport({
      sampleId, channel: 'WhatsApp', buildData: buildLabReportData, triggeredBy: 'Staff', actor: req.user, req,
    });
    res.json({ success: true, message: `Report sent on WhatsApp to ${recipient}` });
  } catch (error) {
    if (error instanceof DeliveryError) return res.status(error.status).json({ success: false, message: error.message });
    console.error('Resend report WhatsApp error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Parameter code -> display name (parameter_code_names) ──────────────────
// What pdfGenerator.js looks up so a report shows "White Blood Cell Count"
// instead of the raw analyzer code "WBC". Admin-only: whoever holds that
// role can review/correct the whole table and add anything an analyzer
// sends that isn't covered yet, without needing a code change.

export const getParameterCodeNames = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, code, name FROM parameter_code_names ORDER BY code'
    );
    res.json({ success: true, parameters: rows });
  } catch (error) {
    console.error('Error fetching parameter code names:', error);
    res.status(500).json({ success: false, message: 'Server error fetching parameter names' });
  }
};

// Single endpoint for both add and correct — a code that already exists
// gets its name updated instead of erroring, since "add if missing, fix if
// wrong" is one action from the admin's side, not two.
export const upsertParameterCodeName = async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim();
    const name = String(req.body?.name || '').trim();
    if (!code || !name) {
      return res.status(400).json({ success: false, message: 'Code and name are required' });
    }

    await db.query(
      `INSERT INTO parameter_code_names (code, name) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [code, name]
    );

    res.json({ success: true, message: 'Saved' });
  } catch (error) {
    console.error('Error saving parameter code name:', error);
    res.status(500).json({ success: false, message: 'Server error saving parameter name' });
  }
};
