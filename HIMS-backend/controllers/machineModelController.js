import db from '../config/db.js';

// Model-level configuration — "a BC-5130 is a 3-part differential
// Hematology analyzer" — kept separate from lab_machines (one row per
// physical box) because the same model/manufacturer combination repeats
// across many machines; this is configured once per model and every
// physical unit of that model inherits it via a manufacturer+model join
// (see getMachineStats/getAnalyzerLogs in labMachineController.js), not
// duplicated per-machine.

// Every manufacturer+model combination actually registered in lab_machines,
// left-joined against machine_models so an admin can see at a glance which
// ones still need configuring (diff_type/department both NULL) — same
// "review what's really out there" pattern as parameter_code_names.
export const getMachineModels = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        lm.manufacturer,
        lm.model,
        COUNT(*) AS machine_count,
        mm.id AS config_id,
        mm.diff_type,
        mm.department,
        mm.notes
      FROM lab_machines lm
      LEFT JOIN machine_models mm
        ON mm.manufacturer = lm.manufacturer AND mm.model = lm.model
      WHERE lm.model IS NOT NULL AND lm.model != ''
      GROUP BY lm.manufacturer, lm.model, mm.id, mm.diff_type, mm.department, mm.notes
      ORDER BY (mm.id IS NULL) DESC, lm.manufacturer, lm.model
    `);
    res.json({ success: true, machine_models: rows });
  } catch (error) {
    console.error('Error listing machine models:', error);
    res.status(500).json({ success: false, message: 'Server error listing machine models' });
  }
};

export const upsertMachineModel = async (req, res) => {
  try {
    const { manufacturer, model, diff_type, department, notes } = req.body;
    if (!manufacturer || !model) {
      return res.status(400).json({ success: false, message: 'Manufacturer and model are required.' });
    }
    // Mirrors DEPARTMENT_DIFF_TYPES in HIMS-frontend/src/pages/Settings/
    // MachineMaster.jsx — every diff_type value that UI can send, across all
    // departments, flattened into one allowlist. 'N/A' is always valid as
    // the unset default regardless of department.
    const validDiffTypes = [
      'N/A',
      // Hematology Analyzers
      '3-Part', '5-Part', '6-Part', '7-Part', '9-Part',
      '5-Part with Reticulocyte', '5-Part with ESR',
      'Automated Reticulocyte Analyzer', 'ESR Analyzer',
      // Clinical Chemistry / Biochemistry Analyzers
      'Semi-Automated Biochemistry Analyzer', 'Fully Automated Biochemistry Analyzer',
      'Random Access Biochemistry Analyzer', 'Batch Biochemistry Analyzer',
      'High Throughput Biochemistry Analyzer', 'Integrated Chemistry Analyzer',
      // Electrolyte Analyzers
      'Standalone ISE Analyzer', '3-Electrode ISE Analyzer', '5-Electrode ISE Analyzer',
      'Electrolyte Analyzer with Blood Gas', 'Integrated ISE Analyzer',
      // Immunoassay Analyzers
      'ELISA Analyzer', 'CLIA Analyzer', 'ECLIA Analyzer', 'FIA Analyzer', 'FEIA Analyzer',
      'Chemiluminescence Immunoassay Analyzer', 'Fully Automated Immunoassay Analyzer',
      'Automated Immunoassay Analyzer',
      // Urinalysis Analyzers
      'Urine Strip Analyzer', 'Urine Chemistry Analyzer', 'Urine Sediment Analyzer',
      'Automated Urine Sediment Analyzer', 'Digital Urine Microscopy Analyzer',
      'Flow Cytometry Urine Analyzer', 'Integrated Urine Analyzer',
      // Coagulation Analyzers
      'Semi-Automated Coagulation Analyzer', 'Fully Automated Coagulation Analyzer',
      'Random Access Coagulation Analyzer', 'High Throughput Coagulation Analyzer',
      // Blood Gas Analyzers
      'ABG Analyzer', 'VBG Analyzer', 'Blood Gas Analyzer',
      'Blood Gas and Electrolyte Analyzer', 'Blood Gas and Metabolite Analyzer',
      'Critical Care Analyzer',
      // HbA1c Analyzers
      'HPLC HbA1c Analyzer', 'Immunoassay HbA1c Analyzer', 'Boronate Affinity HbA1c Analyzer',
      'Enzymatic HbA1c Analyzer', 'Point-of-Care HbA1c Analyzer',
      // Microbiology Analyzers
      'Automated Blood Culture Analyzer', 'Microbial Identification Analyzer',
      'Antimicrobial Susceptibility Testing Analyzer', 'Automated Identification and AST Analyzer',
      'MALDI-TOF Analyzer', 'Microbiology Automation System',
      // Molecular Diagnostics Analyzers
      'PCR Analyzer', 'Real-Time PCR Analyzer', 'qPCR Analyzer', 'Multiplex PCR Analyzer',
      'Digital PCR Analyzer', 'Cartridge-Based Molecular Analyzer', 'Fully Automated Molecular Analyzer',
      // Point-of-Care Testing Analyzers
      'Blood Glucose Analyzer', 'POCT Blood Gas Analyzer', 'POCT HbA1c Analyzer',
      'POCT Electrolyte Analyzer', 'POCT Cardiac Marker Analyzer', 'POCT CRP Analyzer',
      'POCT Immunoassay Analyzer', 'POCT Coagulation Analyzer',
      // Special Chemistry Analyzers
      'Protein Analyzer', 'Nephelometer', 'Turbidimeter',
      'Immunoturbidimetric Analyzer', 'Serum Protein Electrophoresis Analyzer',
      // Pathology Analyzers
      'Digital Slide Scanner', 'Digital Pathology Analyzer', 'Histopathology Analyzer',
      'Cytology Analyzer', 'Automated Slide Stainer', 'Automated Tissue Processor',
      // Cytology Analyzers
      'Automated Cytology Analyzer', 'Liquid-Based Cytology Analyzer', 'Cervical Cytology Analyzer',
      // Genetic / Molecular Analyzers
      'DNA Analyzer', 'RNA Analyzer', 'Genetic Analyzer', 'DNA Sequencer',
      'Next Generation Sequencing Analyzer',
      // POC / Rapid Diagnostic Analyzers
      'Lateral Flow Analyzer', 'Fluorescence Immunoassay Reader', 'Rapid Test Reader',
      'Digital Rapid Test Analyzer',
    ];
    if (diff_type && !validDiffTypes.includes(diff_type)) {
      return res.status(400).json({ success: false, message: 'Invalid diff_type for this department.' });
    }

    await db.query(
      `INSERT INTO machine_models (manufacturer, model, diff_type, department, notes)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         diff_type = VALUES(diff_type), department = VALUES(department), notes = VALUES(notes)`,
      [manufacturer.trim(), model.trim(), diff_type || 'N/A', department || null, notes || null]
    );

    res.json({ success: true, message: `Saved configuration for ${manufacturer} ${model}.` });
  } catch (error) {
    console.error('Error saving machine model:', error);
    res.status(500).json({ success: false, message: 'Server error saving machine model' });
  }
};
