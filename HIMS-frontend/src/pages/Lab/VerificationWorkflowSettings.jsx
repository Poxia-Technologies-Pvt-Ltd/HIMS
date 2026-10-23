import { useState, useEffect, useCallback } from 'react';
import '../../assets/CSS/ResultFlagSettings.css';
import '../../assets/CSS/VerificationWorkflowSettings.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}`, 'Content-Type': 'application/json' });

// Per-discipline result validation workflow: one authorization step, or
// technical validation followed by doctor authorization — plus who may do
// each, whether the people must differ, and auto-validation of unflagged results.
export default function VerificationWorkflowSettings({ onClose }) {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);   // { id, name, inherited, wf }
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const canEdit = ['admin', 'super admin', 'lab head'].includes((localStorage.getItem('role') || '').toLowerCase());

  const load = useCallback(() => {
    fetch(`${API_BASE}/api/lab/verification-workflows`, { headers: authHdr() })
      .then((r) => r.json()).then((d) => { if (d.success) setData(d); })
      .catch(() => setMessage({ ok: false, text: 'Could not load the workflows.' }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = data ? [{ id: 0, name: 'Facility default', inherited: false, wf: data.default }, ...data.disciplines.map((d) => ({ id: d.id, name: d.name, inherited: d.inherited, wf: d.workflow }))] : [];

  const toggleRole = (field, role) => setEditing((e) => ({
    ...e, wf: { ...e.wf, [field]: e.wf[field].includes(role) ? e.wf[field].filter((r) => r !== role) : [...e.wf[field], role] },
  }));

  const save = async (body) => {
    setSaving(true); setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/lab/verification-workflows/${editing.id}`, { method: 'PUT', headers: authHdr(), body: JSON.stringify(body) });
      const d = await res.json();
      setMessage({ ok: !!d.success, text: d.message || (d.success ? 'Saved.' : 'Could not save.') });
      if (d.success) { setEditing(null); load(); }
    } catch { setMessage({ ok: false, text: 'Network error.' }); }
    finally { setSaving(false); }
  };

  return (
    <div className="rfs-overlay" onClick={onClose}>
      <div className="rfs-modal vw-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Verification Workflow</h2>
          <p>Choose how results are validated and authorized for each laboratory discipline. Disciplines without their own setting follow the facility default.</p>
        </header>

        <div className="vw-legend">
          <b>Two-level:</b> Test Done → technical validation → doctor authorization → report released. &nbsp;
          <b>Single:</b> Test Done → one authorization → report released.
        </div>

        {!data ? <div className="rfs-empty">Loading…</div> : (
          <table className="vw-table">
            <thead><tr><th>Discipline</th><th>Workflow</th><th>Technical validation</th><th>Authorization</th><th>Options</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={editing?.id === r.id ? 'active' : ''}>
                  <td><b>{r.name}</b>{r.id !== 0 && r.inherited && <span className="vw-inherit">default</span>}</td>
                  <td>{r.wf.levels}</td>
                  <td>{r.wf.levels === 'Two-level' ? r.wf.technical_roles.join(', ') : '—'}</td>
                  <td>{r.wf.clinical_roles.join(', ')}</td>
                  <td className="vw-opts">
                    {r.wf.enforce_segregation && <span>Different person</span>}
                    {r.wf.auto_verify_normal && <span>Auto-validate unflagged</span>}
                    {r.wf.critical_notify && <span>Critical alert · {r.wf.critical_notify_minutes} min{r.wf.critical_block_approval ? ' · blocks sign-off' : ''}</span>}
                  </td>
                  <td>{canEdit && <button className="rfs-btn ghost vw-edit" onClick={() => setEditing({ ...r, wf: { ...r.wf, technical_roles: [...r.wf.technical_roles], clinical_roles: [...r.wf.clinical_roles] } })}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {editing && (
          <div className="vw-editor">
            <h3>{editing.name}</h3>
            <div className="vw-grid">
              <label>Workflow
                <select value={editing.wf.levels} onChange={(e) => setEditing({ ...editing, wf: { ...editing.wf, levels: e.target.value } })}>
                  <option>Two-level</option><option>Single</option>
                </select>
              </label>
              {editing.wf.levels === 'Two-level' && (
                <fieldset><legend>Who may technically validate</legend>
                  {data.role_choices.technical.map((r) => (
                    <label key={r} className="vw-check"><input type="checkbox" checked={editing.wf.technical_roles.includes(r)} onChange={() => toggleRole('technical_roles', r)} />{r}</label>
                  ))}
                </fieldset>
              )}
              <fieldset><legend>Who may authorize (doctor / lab head)</legend>
                {data.role_choices.clinical.map((r) => (
                  <label key={r} className="vw-check"><input type="checkbox" checked={editing.wf.clinical_roles.includes(r)} onChange={() => toggleRole('clinical_roles', r)} />{r}</label>
                ))}
              </fieldset>
            </div>
            <label className="vw-check"><input type="checkbox" checked={editing.wf.enforce_segregation} onChange={(e) => setEditing({ ...editing, wf: { ...editing.wf, enforce_segregation: e.target.checked } })} />
              The authorizer must be a different person from the tester and the technical validator</label>
            {editing.wf.levels === 'Two-level' && (
              <label className="vw-check"><input type="checkbox" checked={editing.wf.auto_verify_normal} onChange={(e) => setEditing({ ...editing, wf: { ...editing.wf, auto_verify_normal: e.target.checked } })} />
                Automatically validate complete results that raise no flags (abnormal, critical, invalid or delta)</label>
            )}
            <div className="vw-critical">
              <label className="vw-check"><input type="checkbox" checked={editing.wf.critical_notify} onChange={(e) => setEditing({ ...editing, wf: { ...editing.wf, critical_notify: e.target.checked } })} />
                Raise a critical-result alert (clinician must be notified and acknowledge)</label>
              {editing.wf.critical_notify && (
                <>
                  <label className="vw-inline">Notify within
                    <input type="number" min="5" max="1440" value={editing.wf.critical_notify_minutes} onChange={(e) => setEditing({ ...editing, wf: { ...editing.wf, critical_notify_minutes: e.target.value } })} /> minutes</label>
                  <label className="vw-check"><input type="checkbox" checked={editing.wf.critical_block_approval} onChange={(e) => setEditing({ ...editing, wf: { ...editing.wf, critical_block_approval: e.target.checked } })} />
                    Do not allow authorization until the clinician has acknowledged</label>
                </>
              )}
            </div>
            <div className="vw-editor-actions">
              {editing.id !== 0 && !editing.inherited && <button className="rfs-btn ghost" onClick={() => save({ inherit: true })} disabled={saving}>Use facility default</button>}
              <button className="rfs-btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="rfs-btn primary" disabled={saving} onClick={() => save({ ...editing.wf })}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        )}

        {message && <div className={`rfs-msg ${message.ok ? 'ok' : 'bad'}`}>{message.text}</div>}
        <footer>
          {!canEdit && <span className="rfs-note">Only an Admin or Lab Head can change these.</span>}
          <button className="rfs-btn ghost" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
