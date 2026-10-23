import { useState, useEffect } from 'react';
import '../../assets/CSS/ResultFlagSettings.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}`, 'Content-Type': 'application/json' });

const FIELDS = [
  { key: 'delta_enabled', label: 'Delta check', type: 'toggle', help: 'Flag results that moved a lot since the same patient\'s previous result.' },
  { key: 'delta_default_percent', label: 'Default delta limit (%)', type: 'number', help: 'Used for parameters with no delta rule of their own. Blank = no default.' },
  { key: 'delta_default_days', label: 'Delta window (days)', type: 'number', help: 'Only compare with a previous result at most this old.' },
  { key: 'kids_max_age_years', label: 'Children are younger than (years)', type: 'number', help: 'These patients use the Children reference range.' },
  { key: 'trust_analyzer_alerts', label: 'Use the analyzer\'s H / L when no range is set', type: 'toggle', help: 'Fallback for parameters without a configured reference range.' },
  { key: 'invalid_tokens', label: 'Values that mean "not measured"', type: 'text', help: 'Comma-separated. Values made only of * # ? or - are always invalid.' },
  { key: 'invalid_analyzer_flags', label: 'Analyzer flags that mean invalid', type: 'text', help: 'Comma-separated analyzer flag codes.' },
];

// Facility-wide defaults for the result flagging rules. Per-parameter rules
// (critical limits, measurable range, delta limits) are edited with the test.
export default function ResultFlagSettings({ onClose }) {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const canEdit = ['admin', 'super admin', 'lab head'].includes((localStorage.getItem('role') || '').toLowerCase());

  useEffect(() => {
    fetch(`${API_BASE}/api/lab/result-flag-settings`, { headers: authHdr() })
      .then((r) => r.json())
      .then((d) => { if (d.success) setValues(Object.fromEntries(d.settings.map((s) => [s.setting_key, s.setting_value ?? '']))); })
      .catch(() => setMessage({ ok: false, text: 'Could not load the settings.' }))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/lab/result-flag-settings`, { method: 'PUT', headers: authHdr(), body: JSON.stringify({ settings: values }) });
      const d = await res.json();
      setMessage({ ok: !!d.success, text: d.message || (d.success ? 'Saved.' : 'Could not save.') });
    } catch { setMessage({ ok: false, text: 'Network error.' }); }
    finally { setSaving(false); }
  };

  return (
    <div className="rfs-overlay" onClick={onClose}>
      <div className="rfs-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Result Flagging Rules</h2>
          <p>Every result is checked against these rules when it arrives. Critical limits, measurable ranges and delta limits for a specific parameter are set on the test itself.</p>
        </header>

        <div className="rfs-legend">
          <span className="rfs-pill high">High / Low</span> outside the reference range
          <span className="rfs-pill crit">Critical</span> beyond the critical limit
          <span className="rfs-pill inv">Invalid</span> technically unusable
          <span className="rfs-pill delta">Delta</span> changed sharply from last time
        </div>

        {loading ? <div className="rfs-empty">Loading…</div> : (
          <div className="rfs-fields">
            {FIELDS.map((f) => (
              <label key={f.key} className={f.type === 'text' ? 'wide' : ''}>
                <span className="rfs-label">{f.label}</span>
                {f.type === 'toggle' ? (
                  <select disabled={!canEdit} value={values[f.key] ?? '1'} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                    <option value="1">On</option><option value="0">Off</option>
                  </select>
                ) : (
                  <input disabled={!canEdit} type={f.type} step="any" value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                )}
                <small>{f.help}</small>
              </label>
            ))}
          </div>
        )}

        {message && <div className={`rfs-msg ${message.ok ? 'ok' : 'bad'}`}>{message.text}</div>}
        <footer>
          {!canEdit && <span className="rfs-note">Only an Admin or Lab Head can change these.</span>}
          <button className="rfs-btn ghost" onClick={onClose}>Close</button>
          {canEdit && <button className="rfs-btn primary" onClick={save} disabled={saving || loading}>{saving ? 'Saving…' : 'Save rules'}</button>}
        </footer>
      </div>
    </div>
  );
}
