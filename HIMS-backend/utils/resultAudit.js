// History of a lab result: audit events, before/after diffs, version snapshots.

const norm = (s) => String(s || '').trim().toLowerCase();
const asArray = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? JSON.parse(v || '[]') : []);

// What changed between two result lists, by parameter name.
export function diffResults(oldRows, newRows) {
  const before = new Map(asArray(oldRows).filter((r) => r && !r.is_subheader).map((r) => [norm(r.parameter_name), r]));
  const changes = []; const added = [];
  for (const n of asArray(newRows)) {
    if (!n || n.is_subheader) continue;
    const o = before.get(norm(n.parameter_name));
    if (!o) { added.push(n.parameter_name); continue; }
    const ov = String(o.result_value ?? ''); const nv = String(n.result_value ?? '');
    if (ov !== nv || String(o.unit ?? '') !== String(n.unit ?? '')) {
      changes.push({ parameter: n.parameter_name, from: ov, to: nv, unit: n.unit || o.unit || '', flag_from: o.result_flag || o.flag || null, flag_to: n.result_flag || n.flag || null });
    }
  }
  return { changes, added };
}

async function actorName(conn, actor) {
  if (actor?.id) {
    const [[u]] = await conn.query("SELECT CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id = ?", [actor.id]);
    return u?.name || null;
  }
  return actor?.device ? `Workstation: ${actor.device}` : (actor?.role === 'System' ? 'System' : null);
}

export async function logResultAudit(conn, { result_id, sample_id, branch_id = null, action, from_status = null, to_status = null, actor = {}, reason = null, details = null, version = null, note = null }) {
  await conn.query(
    `INSERT INTO lab_result_audit (result_id, sample_id, branch_id, action, from_status, to_status, actor_id, actor_name, actor_role, note, reason, details, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [result_id, sample_id, branch_id, action, from_status, to_status, actor.id || null, await actorName(conn, actor), actor.role || null,
     note ? String(note).slice(0, 500) : null, reason ? String(reason).slice(0, 500) : null, details ? JSON.stringify(details) : null, version]
  );
}

// Keeps the content of the version being replaced so it can always be shown.
export async function snapshotVersion(conn, { result, reason, actor = {} }) {
  const [[sig]] = await conn.query("SELECT id FROM report_signatures WHERE result_id = ? AND status = 'Valid' ORDER BY id DESC LIMIT 1", [result.id]);
  await conn.query(
    `INSERT INTO lab_result_versions (result_id, version, results_json, status_at_change, verified_by, approved_by, approved_at, signature_id,
                                      superseded_reason, superseded_by, superseded_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [result.id, result.report_version || 1, typeof result.results_json === 'string' ? result.results_json : JSON.stringify(result.results_json || []),
     result.status, result.verified_by || null, result.approved_by || null, result.approved_at || null, sig?.id || null,
     String(reason).slice(0, 500), actor.id || null, await actorName(conn, actor)]
  );
  await conn.query("UPDATE report_signatures SET status = 'Revoked', revoked_at = NOW() WHERE result_id = ? AND status = 'Valid'", [result.id]);
}
