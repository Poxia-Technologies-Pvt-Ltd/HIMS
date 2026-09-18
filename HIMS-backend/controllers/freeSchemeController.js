import db from '../config/db.js';

// Master list of free-diagnostic scheme names (NFDS, Ayushman Bharat, ...).
// Kept deliberately tiny — a name and an active flag — since its only job
// is to back the Scheme Name dropdown in Billing Packages / Billing, so
// staff pick a scheme instead of retyping it on every package/order.

export const getFreeSchemes = async (req, res) => {
  try {
    const { is_active } = req.query;
    let query = 'SELECT * FROM free_schemes WHERE 1=1';
    const params = [];
    if (is_active !== undefined) {
      query += ' AND is_active = ?';
      params.push(is_active === 'true' ? 1 : 0);
    }
    query += ' ORDER BY name';
    const [schemes] = await db.query(query, params);
    res.json({ success: true, schemes });
  } catch (error) {
    console.error('Error fetching free schemes:', error);
    res.status(500).json({ success: false, message: 'Server error fetching free schemes' });
  }
};

export const createFreeScheme = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Scheme name is required.' });
    }
    const [result] = await db.query(
      'INSERT INTO free_schemes (name, description) VALUES (?, ?)',
      [name.trim(), description?.trim() || null]
    );
    res.status(201).json({ success: true, message: `Scheme "${name.trim()}" added.`, id: result.insertId });
  } catch (error) {
    console.error('Error creating free scheme:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'A scheme with that name already exists.' });
    }
    res.status(500).json({ success: false, message: 'Server error creating free scheme' });
  }
};

export const updateFreeScheme = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, is_active } = req.body;
    const updateFields = [];
    const values = [];
    if (name !== undefined) { updateFields.push('name = ?'); values.push(name.trim()); }
    if (description !== undefined) { updateFields.push('description = ?'); values.push(description?.trim() || null); }
    if (is_active !== undefined) { updateFields.push('is_active = ?'); values.push(is_active ? 1 : 0); }
    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }
    values.push(id);
    const [result] = await db.query(`UPDATE free_schemes SET ${updateFields.join(', ')} WHERE id = ?`, values);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Scheme not found.' });
    }
    res.json({ success: true, message: 'Scheme updated.' });
  } catch (error) {
    console.error('Error updating free scheme:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'A scheme with that name already exists.' });
    }
    res.status(500).json({ success: false, message: 'Server error updating free scheme' });
  }
};

// Deactivate rather than hard-delete — a scheme that's already referenced
// by historical packages/bills should stay resolvable, just stop showing
// up as a choice for new ones.
export const deactivateFreeScheme = async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('UPDATE free_schemes SET is_active = 0 WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Scheme not found.' });
    }
    res.json({ success: true, message: 'Scheme deactivated.' });
  } catch (error) {
    console.error('Error deactivating free scheme:', error);
    res.status(500).json({ success: false, message: 'Server error deactivating free scheme' });
  }
};
