import db from '../config/db.js';
import { seedBranchHmisConfig } from '../services/cdacService.js';

// 1. Get all branches (Hierarchy aware)
export const getBranches = async (req, res) => {
  try {
    // Enforce scope from the JWT, not the client-supplied query string.
    const role_level = req.user?.role_level;
    const branch_id = req.user?.branch_id;

    let query = `
      SELECT b.*, d.name as district_name, p.branch_name as parent_branch_name,
             bhc.hmis_hosp_mapping_code, bhc.integration_type as cdac_integration_type
      FROM branches b
      LEFT JOIN districts d ON b.district_id = d.id
      LEFT JOIN branches p ON b.parent_branch_id = p.id
      LEFT JOIN branch_hmis_config bhc ON bhc.branch_id = b.id
      WHERE 1=1
    `;
    const params = [];

    // Sub-Central role: only see branches in their own district (looked up
    // server-side via their branch, since district_id isn't in the JWT).
    if (role_level === 'Sub-Central' && branch_id) {
      query += ` AND b.district_id = (SELECT district_id FROM branches WHERE id = ?)`;
      params.push(branch_id);
    }
    // Central role: sees all branches (no filter)
    // Branch level sees only their own branch
    else if (role_level === 'Branch' && branch_id) {
      query += ' AND b.id = ?';
      params.push(branch_id);
    }

    query += ` ORDER BY d.name, b.branch_name`;

    const [branches] = await db.query(query, params);
    
    // Also fetch districts to populate dropdowns
    const [districts] = await db.query('SELECT * FROM districts ORDER BY name');

    // Also fetch facility categories
    const [categories] = await db.query('SELECT * FROM facility_categories ORDER BY name');

    res.json({ success: true, branches, districts, categories });
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 2. Create District (Sub-Central Hub)
export const createDistrict = async (req, res) => {
  try {
    const { name, state = null, state_id = null } = req.body;

    if (!name) return res.status(400).json({ success: false, message: 'District name is required' });

    const [result] = await db.query(
      'INSERT INTO districts (name, state, state_id) VALUES (?, ?, ?)',
      [name, state, state_id || null]
    );

    res.json({ success: true, message: 'District created successfully', district_id: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'District already exists' });
    }
    console.error('Error creating district:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Update District
export const updateDistrict = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, state_id } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'District name is required' });

    await db.query(
      'UPDATE districts SET name = ?, state_id = COALESCE(?, state_id) WHERE id = ?',
      [name, state_id || null, id]
    );
    res.json({ success: true, message: 'District updated successfully' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'District already exists' });
    console.error('Error updating district:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Delete District
export const deleteDistrict = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if there are branches assigned to this district
    const [branches] = await db.query('SELECT id FROM branches WHERE district_id = ? LIMIT 1', [id]);
    if (branches.length > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete district. It has assigned health centers.' });
    }

    await db.query('DELETE FROM districts WHERE id = ?', [id]);
    res.json({ success: true, message: 'District deleted successfully' });
  } catch (error) {
    console.error('Error deleting district:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Patch block_id on a branch (assign / unassign from a block)
export const patchBranchBlock = async (req, res) => {
  try {
    const { id } = req.params;
    const { block_id } = req.body;
    await db.query('UPDATE branches SET block_id = ? WHERE id = ?', [block_id || null, id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error patching branch block:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Facility coordinates for the hospital-network map and equipment geo-fencing.
// Blank means "not set"; anything else must be a real latitude / longitude.
const coords = (lat, lng) => {
  const blank = (v) => v === undefined || v === null || v === '';
  if (blank(lat) && blank(lng)) return { ok: true, lat: null, lng: null };
  const a = Number(lat); const o = Number(lng);
  if (blank(lat) || blank(lng) || !Number.isFinite(a) || !Number.isFinite(o) || Math.abs(a) > 90 || Math.abs(o) > 180) return { ok: false };
  return { ok: true, lat: a, lng: o };
};

// 3. Create Center (Lab/Branch)
export const createCenter = async (req, res) => {
  try {
    const { district_id, branch_name, category = 'General Lab', hospital_code, address, contact_number, branch_level = 'Center', parent_branch_id = null, hmis_hosp_mapping_code, latitude, longitude } = req.body;

    if (!district_id || !branch_name || !hospital_code) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    const geo = coords(latitude, longitude);
    if (!geo.ok) return res.status(400).json({ success: false, message: 'Enter a valid latitude and longitude, or leave both blank.' });

    const [result] = await db.query(
      `INSERT INTO branches (district_id, branch_name, category, branch_level, parent_branch_id, hospital_code, address, contact_number, latitude, longitude, status)
       VALUES (?, ?, ?, ?, ?, UPPER(?), ?, ?, ?, ?, 'Active')`,
      [district_id, branch_name, category, branch_level, parent_branch_id || null, hospital_code, address, contact_number, geo.lat, geo.lng]
    );
    const branchId = result.insertId;

    // Route to CDAC or Care HIMS and seed hmis_hosp_mapping_code (see
    // seedBranchHmisConfig for why this can't be left for later).
    await seedBranchHmisConfig(branchId, district_id, hmis_hosp_mapping_code || null);

    res.json({ success: true, message: 'Center created successfully', branch_id: branchId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Hospital Code already exists' });
    }
    console.error('Error creating center:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Update Center
export const updateCenter = async (req, res) => {
  try {
    const { id } = req.params;
    const { district_id, branch_name, category, hospital_code, address, contact_number, branch_level, parent_branch_id, hmis_hosp_mapping_code, latitude, longitude } = req.body;

    if (!district_id || !branch_name || !hospital_code) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    const geo = coords(latitude, longitude);
    if (!geo.ok) return res.status(400).json({ success: false, message: 'Enter a valid latitude and longitude, or leave both blank.' });

    await db.query(
      `UPDATE branches
       SET district_id = ?, branch_name = ?, category = ?, branch_level = ?, parent_branch_id = ?, hospital_code = UPPER(?), address = ?, contact_number = ?,
           latitude = ?, longitude = ?
       WHERE id = ?`,
      [district_id, branch_name, category, branch_level, parent_branch_id || null, hospital_code, address, contact_number, geo.lat, geo.lng, id]
    );

    if (hmis_hosp_mapping_code !== undefined) {
      // Preserve an existing integration_type if one's already set (e.g. an
      // admin manually overrode it on the CDAC Mapping page) — only fall
      // back to the district-based default for a branch with no config yet.
      const [[existing]] = await db.query('SELECT integration_type FROM branch_hmis_config WHERE branch_id = ?', [id]);
      let integrationType = existing?.integration_type;
      if (!integrationType) {
        const [[district]] = await db.query('SELECT name FROM districts WHERE id = ?', [district_id]);
        integrationType = district?.name === 'Ramgarh' ? 'CARE' : 'CDAC';
      }
      await db.query(
        `INSERT INTO branch_hmis_config (branch_id, integration_type, hmis_hosp_mapping_code, is_active)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE hmis_hosp_mapping_code = VALUES(hmis_hosp_mapping_code), updated_at = NOW()`,
        [id, integrationType, hmis_hosp_mapping_code || null]
      );
    }

    res.json({ success: true, message: 'Center updated successfully' });
  } catch (error) {
    console.error('Error updating center:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Delete Center
export const deleteCenter = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Optional: check if there are users, patients, or bills linked to this branch before deleting
    // For now, we will allow direct deletion
    await db.query('DELETE FROM branches WHERE id = ?', [id]);
    res.json({ success: true, message: 'Center deleted successfully' });
  } catch (error) {
    console.error('Error deleting center:', error);
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ success: false, message: 'Cannot delete this facility because it is actively being used by registered staff, infrastructure, or patient records.' });
    }
    res.status(500).json({ success: false, message: 'Server error (Make sure no records depend on this center)' });
  }
};

// --- FACILITY CATEGORY MANAGEMENT ---

// Create Category
export const createFacilityCategory = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });

    const [result] = await db.query('INSERT INTO facility_categories (name) VALUES (?)', [name]);
    res.json({ success: true, message: 'Category created', category_id: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'Category already exists' });
    console.error('Error creating category:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Update Category
export const updateFacilityCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });

    await db.query('UPDATE facility_categories SET name = ? WHERE id = ?', [name, id]);
    res.json({ success: true, message: 'Category updated' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'Category already exists' });
    console.error('Error updating category:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Delete Category
export const deleteFacilityCategory = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM facility_categories WHERE id = ?', [id]);
    res.json({ success: true, message: 'Category deleted' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
