import db from '../config/db.js';

// Backs Settings > Patient Field Config — lets an Admin control which
// demographic fields on patient registration are required/shown, and add
// wholly new custom fields without a schema change (spec item #1:
// "configurable identifiers and demographic fields"). 'system' rows map to
// a real patients.<column> (registerPatient in patientController.js); values
// for 'custom' rows live in patient_custom_field_values instead, since they
// have no column of their own.

export const getFieldConfig = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM patient_field_config ORDER BY display_order, id'
    );
    res.json({ success: true, fields: rows });
  } catch (error) {
    console.error('Error fetching patient field config:', error);
    res.status(500).json({ success: false, message: 'Server error fetching field config' });
  }
};

// Updates an existing field's label/required/enabled/order (system or
// custom), or creates a new custom field when field_key doesn't exist yet.
export const upsertFieldConfig = async (req, res) => {
  try {
    const { field_key, label, field_type, options_json, is_required, is_enabled, display_order } = req.body;

    if (!field_key || !label) {
      return res.status(400).json({ success: false, message: 'field_key and label are required.' });
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field_key)) {
      return res.status(400).json({ success: false, message: 'field_key must be alphanumeric/underscore, starting with a letter.' });
    }

    const [[existing]] = await db.query('SELECT id, field_source FROM patient_field_config WHERE field_key = ?', [field_key]);

    if (existing) {
      // System fields can be relabeled/toggled but never re-typed into a
      // custom field or given options — the column type on `patients` is
      // fixed, so field_type/options_json only apply going forward for
      // custom fields.
      await db.query(
        `UPDATE patient_field_config
         SET label = ?, is_required = ?, is_enabled = ?, display_order = ?
             ${existing.field_source === 'custom' ? ', field_type = ?, options_json = ?' : ''}
         WHERE field_key = ?`,
        existing.field_source === 'custom'
          ? [label, !!is_required, is_enabled === undefined ? true : !!is_enabled, display_order || 0, field_type || 'text', options_json ? JSON.stringify(options_json) : null, field_key]
          : [label, !!is_required, is_enabled === undefined ? true : !!is_enabled, display_order || 0, field_key]
      );
      return res.json({ success: true, message: `Updated "${label}".` });
    }

    await db.query(
      `INSERT INTO patient_field_config (field_key, label, field_source, field_type, options_json, is_required, is_enabled, display_order)
       VALUES (?, ?, 'custom', ?, ?, ?, ?, ?)`,
      [field_key, label, field_type || 'text', options_json ? JSON.stringify(options_json) : null, !!is_required, is_enabled === undefined ? true : !!is_enabled, display_order || 0]
    );
    res.status(201).json({ success: true, message: `Created custom field "${label}".` });
  } catch (error) {
    console.error('Error saving patient field config:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'A field with that key already exists.' });
    }
    res.status(500).json({ success: false, message: 'Server error saving field config' });
  }
};

// Only custom fields can be deleted — system fields map to real patients
// columns and can only be hidden (is_enabled = 0), never removed, or every
// existing patient row would lose that data's meaning.
export const deleteCustomField = async (req, res) => {
  try {
    const { field_key } = req.params;
    const [[existing]] = await db.query('SELECT field_source FROM patient_field_config WHERE field_key = ?', [field_key]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Field not found.' });
    }
    if (existing.field_source !== 'custom') {
      return res.status(400).json({ success: false, message: 'System fields cannot be deleted — disable them instead.' });
    }
    await db.query('DELETE FROM patient_field_config WHERE field_key = ?', [field_key]);
    await db.query('DELETE FROM patient_custom_field_values WHERE field_key = ?', [field_key]);
    res.json({ success: true, message: 'Custom field deleted.' });
  } catch (error) {
    console.error('Error deleting patient field config:', error);
    res.status(500).json({ success: false, message: 'Server error deleting field config' });
  }
};
