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
    const validDiffTypes = ['3-Part', '5-Part', 'N/A'];
    if (diff_type && !validDiffTypes.includes(diff_type)) {
      return res.status(400).json({ success: false, message: 'diff_type must be 3-Part, 5-Part, or N/A.' });
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
