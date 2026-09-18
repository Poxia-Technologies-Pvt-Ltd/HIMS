import db from '../config/db.js';

// Get all machines for a lab
export const getLabMachines = async (req, res) => {
  try {
    const { labId } = req.params;
    const [machines] = await db.query(
      'SELECT * FROM lab_machines WHERE lab_id = ? ORDER BY created_at DESC',
      [labId]
    );
    res.json({ success: true, machines });
  } catch (error) {
    console.error('Error fetching lab machines:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get network machines for dashboard (grouped by branch)
export const getNetworkMachines = async (req, res) => {
  try {
    const query = `
      SELECT
        i.name AS branchName,
        lm.id AS db_id,
        lm.machine_id AS id,
        CONCAT(lm.manufacturer, ' ', lm.model) AS name,
        lm.model AS type,
        lm.status AS status,
        lm.serial_number,
        (
          SELECT COUNT(*) FROM lab_test_result ltr
          WHERE ltr.machine_no = lm.machine_id
          AND ltr.tested_at >= NOW() - INTERVAL 1 DAY
        ) AS testsDone
      FROM lab_machines lm
      LEFT JOIN infrastructure i ON lm.lab_id = i.id
      ORDER BY i.name ASC, lm.machine_id ASC
    `;
    const [rows] = await db.query(query);

    // Group by branchName
    const grouped = rows.reduce((acc, curr) => {
      let branch = acc.find(b => b.branchName === curr.branchName);
      if (!branch) {
        branch = { branchName: curr.branchName || 'Unassigned Lab', machines: [] };
        acc.push(branch);
      }
      branch.machines.push({
        id: curr.id || curr.serial_number,
        name: curr.name,
        type: curr.type || 'Unknown Analyzer',
        status: curr.status || 'Offline',
        testsDone: curr.testsDone || 0
      });
      return acc;
    }, []);

    res.json({ success: true, data: grouped });
  } catch (error) {
    console.error('Error fetching network machines:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get machine by Serial Number
export const getMachineBySerial = async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const [machines] = await db.query(
      'SELECT * FROM lab_machines WHERE serial_number = ? LIMIT 1',
      [serialNumber]
    );
    if (machines.length === 0) {
      return res.json({ success: false, message: 'Machine not found' });
    }
    res.json({ success: true, machine: machines[0] });
  } catch (error) {
    console.error('Error fetching machine by serial:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Add or Update machine (Cloud Sync)
export const syncLabMachine = async (req, res) => {
  try {
    const { 
      lab_id, machine_id, name, model, manufacturer, 
      serial_number, interface_type, port_ip, baud_rate 
    } = req.body;

    if (!serial_number) {
      return res.status(400).json({ success: false, message: 'Serial number is required for syncing' });
    }

    // Check if machine with this serial exists
    const [existing] = await db.query('SELECT id FROM lab_machines WHERE serial_number = ?', [serial_number]);

    if (existing.length > 0) {
      await db.query(
        `UPDATE lab_machines
         SET lab_id = ?, machine_id = ?, name = ?, model = ?, manufacturer = ?,
             interface_type = ?, port_ip = ?, baud_rate = ?, updated_at = NOW()
         WHERE serial_number = ?`,
        [lab_id, machine_id, name, model, manufacturer, interface_type, port_ip, baud_rate, serial_number]
      );
      // Auto-assign all tests for this analyzer to this lab
      if (model && lab_id) {
        await db.query(`UPDATE lab_tests SET lab_id = ? WHERE analyzer_name = ?`, [lab_id, model]);
      }
      res.json({ success: true, message: 'Machine synced (Updated)', id: existing[0].id });
    } else {
      const [result] = await db.query(
        `INSERT INTO lab_machines
         (lab_id, machine_id, name, model, manufacturer, serial_number, interface_type, port_ip, baud_rate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [lab_id, machine_id, name, model, manufacturer, serial_number, interface_type, port_ip, baud_rate]
      );
      // Auto-assign all tests for this analyzer to this lab
      if (model && lab_id) {
        await db.query(`UPDATE lab_tests SET lab_id = ? WHERE analyzer_name = ?`, [lab_id, model]);
      }
      res.status(201).json({ success: true, message: 'Machine synced (Created)', id: result.insertId });
    }
  } catch (error) {
    console.error('Error syncing lab machine:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const addLabMachine = async (req, res) => {
  try {
    const { lab_id, machine_id, name, model, manufacturer } = req.body;
    const [result] = await db.query(
      'INSERT INTO lab_machines (lab_id, machine_id, name, model, manufacturer) VALUES (?, ?, ?, ?, ?)',
      [lab_id, machine_id, name, model || '', manufacturer || '']
    );
    // Auto-assign all tests for this analyzer to this lab
    if (model && lab_id) {
      await db.query(`UPDATE lab_tests SET lab_id = ? WHERE analyzer_name = ?`, [lab_id, model]);
    }
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) { res.status(500).json({ success: false }); }
};

export const updateLabMachine = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, model, manufacturer, status } = req.body;
    await db.query('UPDATE lab_machines SET name = ?, model = ?, manufacturer = ?, status = ? WHERE id = ?', [name, model, manufacturer, status, id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
};

export const deleteLabMachine = async (req, res) => {
  try {
    const { id } = req.params;
    // Get the machine before deleting so we can clear lab_tests
    const [[machine]] = await db.query('SELECT lab_id, model FROM lab_machines WHERE id = ?', [id]);
    await db.query('DELETE FROM lab_machines WHERE id = ?', [id]);
    // Clear lab assignment on tests for this analyzer if no other machine of same model remains in any lab
    if (machine?.model) {
      const [remaining] = await db.query(
        'SELECT id FROM lab_machines WHERE model = ? LIMIT 1', [machine.model]
      );
      if (remaining.length === 0) {
        await db.query(`UPDATE lab_tests SET lab_id = NULL WHERE analyzer_name = ?`, [machine.model]);
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
};

// Log an analyzer ONLINE / OFFLINE event (called by LIS-Agent)
export const logAnalyzerEvent = async (req, res) => {
  try {
    const { machine_id, machine_name, model, lab_id, port, event, ip_address } = req.body;
    if (!machine_id || !event) {
      return res.status(400).json({ success: false, message: 'machine_id and event are required' });
    }
    if (!['ONLINE', 'OFFLINE'].includes(event)) {
      return res.status(400).json({ success: false, message: 'event must be ONLINE or OFFLINE' });
    }

    await db.query(
      `INSERT INTO analyzer_connection_logs
         (machine_id, machine_name, model, lab_id, port, event, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [machine_id, machine_name || null, model || null, lab_id || null, port || null, event, ip_address || null]
    );

    // Keep lab_machines.status in sync
    if (machine_id) {
      await db.query(
        `UPDATE lab_machines SET status = ? WHERE machine_id = ?`,
        [event === 'ONLINE' ? 'Online' : 'Offline', machine_id]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error logging analyzer event:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// lab_machines.lab_id / analyzer_connection_logs.lab_id are infrastructure.id
// values (a specific lab/department), NOT branches.id — a branch can have
// zero, one, or several infrastructure/lab records. Callers that only know
// the branch (e.g. the web Analyzer Connectivity page, scoped off
// localStorage branch_id) need this resolved first, or they end up filtering
// lab_machines.lab_id against a branches.id by coincidence of numbering.
async function resolveInfraIdsForBranch(branchId) {
  const [rows] = await db.query('SELECT id FROM infrastructure WHERE branch_id = ?', [branchId]);
  return rows.map(r => r.id);
}

// Get analyzer connection/disconnection history
export const getAnalyzerLogs = async (req, res) => {
  try {
    const { lab_id, branch_id, machine_id, event, limit = 200 } = req.query;

    let where = [];
    let params = [];

    if (branch_id) {
      const infraIds = await resolveInfraIdsForBranch(branch_id);
      if (infraIds.length === 0) {
        return res.json({ success: true, logs: [] });
      }
      // Scope by which machines are CURRENTLY assigned to this branch's
      // lab(s), not by whatever lab_id was stamped on each historical log
      // row — a machine that gets reassigned to a different lab keeps its
      // full connection history (same as how "Last Online" already matches
      // on machine_id alone below), instead of that history disappearing
      // the moment the machine moves.
      const [machineRows] = await db.query(
        `SELECT machine_id FROM lab_machines WHERE lab_id IN (${infraIds.map(() => '?').join(',')})`,
        infraIds
      );
      if (machineRows.length === 0) {
        return res.json({ success: true, logs: [] });
      }
      const machineIds = machineRows.map((r) => r.machine_id);
      where.push(`acl.machine_id IN (${machineIds.map(() => '?').join(',')})`);
      params.push(...machineIds);
    } else if (lab_id) {
      where.push('acl.lab_id = ?'); params.push(lab_id);
    }
    if (machine_id) { where.push('acl.machine_id = ?'); params.push(machine_id); }
    if (event) { where.push('acl.event = ?'); params.push(event.toUpperCase()); }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(parseInt(limit, 10) || 200);

    const [logs] = await db.query(
      `SELECT
         acl.id,
         acl.machine_id,
         acl.machine_name,
         acl.model,
         acl.lab_id,
         i.name AS lab_name,
         acl.port,
         acl.event,
         acl.ip_address,
         acl.created_at,
         mm.diff_type,
         mm.department
       FROM analyzer_connection_logs acl
       LEFT JOIN infrastructure i ON acl.lab_id = i.id
       -- analyzer_connection_logs has no manufacturer column of its own, only
       -- model — joined via lab_machines (matched on machine_id, which both
       -- tables carry) to get the manufacturer machine_models is keyed on,
       -- rather than guessing manufacturer from model text alone.
       LEFT JOIN lab_machines lm ON lm.machine_id = acl.machine_id
       LEFT JOIN machine_models mm ON mm.manufacturer = lm.manufacturer AND mm.model = lm.model
       ${whereClause}
       ORDER BY acl.created_at DESC
       LIMIT ?`,
      params
    );

    res.json({ success: true, logs });
  } catch (err) {
    console.error('Error fetching analyzer logs:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Comprehensive stats for admin dashboard
export const getMachineStats = async (req, res) => {
  try {
    const { lab_id, branch_id } = req.query;

    // branch_id (a hospital branch) resolves to every infrastructure/lab
    // record under it, since lab_machines.lab_id is an infrastructure.id,
    // not a branches.id — a branch can have zero, one, or several labs.
    // lab_id, if given directly, scopes to exactly that one lab.
    let scopeIds = null;
    if (branch_id) {
      scopeIds = await resolveInfraIdsForBranch(branch_id);
      if (scopeIds.length === 0) {
        return res.json({
          success: true,
          totals: { total: 0, online: 0, offline: 0, unknown: 0, tests_today: 0 },
          brands: [], models: [], labs: [], machines: [],
        });
      }
    } else if (lab_id) {
      scopeIds = [lab_id];
    }

    const idList = scopeIds ? scopeIds.map((id) => db.escape(id)).join(',') : null;
    // Optional WHERE clause when scoping to one or more labs
    const labWhere  = idList ? `WHERE lm.lab_id IN (${idList})` : '';
    const labFilter = idList ? `WHERE lab_id   IN (${idList})` : '';
    const labJoinWhere = idList ? `AND lm.lab_id IN (${idList})` : '';

    // Overall totals. A machine only ever counts as "online" once it's
    // actually reported in — anything else (freshly registered and never
    // connected, 'Active'/'Inactive'/'Maintenance' from other flows, NULL)
    // counts as "offline" so total always equals online + offline; the UI
    // only has tiles for those two, so a separate "unknown" bucket used to
    // just vanish from the visible total instead of showing up anywhere.
    const [[totals]] = await db.query(`
      SELECT
        COUNT(*)                                                          AS total,
        SUM(CASE WHEN status = 'Online' THEN 1 ELSE 0 END)               AS online,
        SUM(CASE WHEN status != 'Online' OR status IS NULL THEN 1 ELSE 0 END) AS offline
      FROM lab_machines
      ${labFilter}
    `);

    // Tests done today (scoped to lab(s) if provided)
    const testWhere = idList
      ? `WHERE ltr.tested_at >= CURDATE() AND ltr.machine_no IN (SELECT machine_id FROM lab_machines WHERE lab_id IN (${idList}))`
      : `WHERE tested_at >= CURDATE()`;
    const [[testStats]] = await db.query(
      `SELECT COUNT(*) AS tests_today FROM lab_test_result ltr ${testWhere}`
    );

    // Brand-wise
    const [brands] = await db.query(`
      SELECT
        COALESCE(manufacturer, 'Unknown')                                AS brand,
        COUNT(*)                                                          AS total,
        SUM(CASE WHEN status = 'Online' THEN 1 ELSE 0 END)               AS online,
        SUM(CASE WHEN status != 'Online' OR status IS NULL THEN 1 ELSE 0 END) AS offline
      FROM lab_machines
      ${labFilter}
      GROUP BY manufacturer
      ORDER BY total DESC
    `);

    // Model-wise
    const [models] = await db.query(`
      SELECT
        COALESCE(lm.model, 'Unknown')                                     AS model,
        COALESCE(lm.manufacturer, 'Unknown')                              AS brand,
        mm.diff_type, mm.department,
        COUNT(*)                                                          AS total,
        SUM(CASE WHEN lm.status = 'Online' THEN 1 ELSE 0 END)             AS online,
        SUM(CASE WHEN lm.status != 'Online' OR lm.status IS NULL THEN 1 ELSE 0 END) AS offline
      FROM lab_machines lm
      LEFT JOIN machine_models mm ON mm.manufacturer = lm.manufacturer AND mm.model = lm.model
      ${labWhere}
      GROUP BY lm.model, lm.manufacturer, mm.diff_type, mm.department
      ORDER BY total DESC
    `);

    // Differential-type-wise — "how many 3-part vs 5-part machines" per the
    // Machine Master configuration. Anything not yet configured in
    // machine_models (or explicitly marked N/A, e.g. a biochemistry
    // analyzer with no differential at all) falls into 'N/A'.
    const [diffTypes] = await db.query(`
      SELECT
        COALESCE(mm.diff_type, 'N/A')                                     AS diff_type,
        COUNT(*)                                                          AS total,
        SUM(CASE WHEN lm.status = 'Online' THEN 1 ELSE 0 END)             AS online,
        SUM(CASE WHEN lm.status != 'Online' OR lm.status IS NULL THEN 1 ELSE 0 END) AS offline
      FROM lab_machines lm
      LEFT JOIN machine_models mm ON mm.manufacturer = lm.manufacturer AND mm.model = lm.model
      ${labWhere}
      GROUP BY COALESCE(mm.diff_type, 'N/A')
      ORDER BY total DESC
    `);

    // Department-wise, same source
    const [departments] = await db.query(`
      SELECT
        COALESCE(mm.department, 'Unconfigured')                           AS department,
        COUNT(*)                                                          AS total,
        SUM(CASE WHEN lm.status = 'Online' THEN 1 ELSE 0 END)             AS online,
        SUM(CASE WHEN lm.status != 'Online' OR lm.status IS NULL THEN 1 ELSE 0 END) AS offline
      FROM lab_machines lm
      LEFT JOIN machine_models mm ON mm.manufacturer = lm.manufacturer AND mm.model = lm.model
      ${labWhere}
      GROUP BY COALESCE(mm.department, 'Unconfigured')
      ORDER BY total DESC
    `);

    // Lab / Hospital-wise (omit when scoped to specific lab(s))
    let labs = [];
    if (!scopeIds) {
      [labs] = await db.query(`
        SELECT
          COALESCE(i.name, 'Unassigned')                                 AS lab_name,
          lm.lab_id,
          COUNT(lm.id)                                                    AS total,
          SUM(CASE WHEN lm.status = 'Online' THEN 1 ELSE 0 END)         AS online,
          SUM(CASE WHEN lm.status != 'Online' OR lm.status IS NULL THEN 1 ELSE 0 END) AS offline
        FROM lab_machines lm
        LEFT JOIN infrastructure i ON lm.lab_id = i.id
        GROUP BY lm.lab_id, i.name
        ORDER BY total DESC
      `);
    }

    // Per-machine detail
    const [machines] = await db.query(`
      SELECT
        lm.id,
        lm.machine_id,
        lm.name         AS machine_name,
        lm.model,
        COALESCE(lm.manufacturer, 'Unknown')   AS brand,
        mm.diff_type,
        mm.department,
        lm.serial_number,
        lm.interface_type,
        lm.port_ip,
        CASE WHEN lm.status = 'Online' THEN 'Online' ELSE 'Offline' END AS status,
        lm.lab_id,
        COALESCE(i.name, 'Unassigned')         AS lab_name,
        (SELECT MAX(acl.created_at) FROM analyzer_connection_logs acl
           WHERE acl.machine_id = lm.machine_id AND acl.event = 'ONLINE')  AS last_online,
        (SELECT MAX(acl.created_at) FROM analyzer_connection_logs acl
           WHERE acl.machine_id = lm.machine_id AND acl.event = 'OFFLINE') AS last_offline,
        (SELECT COUNT(*) FROM lab_test_result ltr
           WHERE ltr.machine_no = lm.machine_id
             AND ltr.tested_at >= NOW() - INTERVAL 24 HOUR)               AS tests_today
      FROM lab_machines lm
      LEFT JOIN infrastructure i ON lm.lab_id = i.id
      LEFT JOIN machine_models mm ON mm.manufacturer = lm.manufacturer AND mm.model = lm.model
      ${labWhere}
      ORDER BY lm.lab_id, lm.machine_id
    `);

    res.json({
      success: true,
      totals: { ...totals, tests_today: testStats.tests_today },
      brands,
      models,
      diff_types: diffTypes,
      departments,
      labs,
      machines,
    });
  } catch (err) {
    console.error('Error fetching machine stats:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
