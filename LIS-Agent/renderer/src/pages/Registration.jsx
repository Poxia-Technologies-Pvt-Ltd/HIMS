import { useState, useEffect, useCallback, useMemo } from 'react';
import { UserPlus, CheckCircle2, CloudOff, Printer, RotateCcw, Save, AlertCircle } from 'lucide-react';
import useOfflineState from '../hooks/useOfflineState';
import { printProvisionalSlip } from '../utils/labelPrint';
import '../assets/CSS/Offline.css';

// The registration desk captures only these six details; anything else can be
// added later in the main HIMS. Whether each is mandatory comes from Settings →
// Patient Field Config (first and last name always are).
const FIELDS = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Other'] },
  { key: 'ageOrYear', label: 'Age or birth year', type: 'number', hint: 'e.g. 35 or 1990' },
  { key: 'telephone', label: 'Mobile number', type: 'tel', maxLength: 10, hint: '10 digits' },
  { key: 'aadharNumber', label: 'Aadhaar number', type: 'tel', maxLength: 12, hint: '12 digits' },
];
const REQUIRED_KEY = { ageOrYear: 'dob' }; // the form field that stands for a config field
const EMPTY = {};

// "35" is an age, "1990" a year of birth — either becomes an approximate date of birth.
function dobFromAgeOrYear(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { dob: null };
  const n = Number(raw);
  const year = new Date().getFullYear();
  if (!Number.isInteger(n) || n < 0) return { error: 'Enter an age (0–120) or a birth year such as 1990.' };
  if (n <= 120) return { dob: `${year - n}-01-01` };
  if (n >= year - 120 && n <= year) return { dob: `${n}-01-01` };
  return { error: 'Enter an age (0–120) or a birth year such as 1990.' };
}

const STATUS = {
  pending: { text: 'Waiting to sync', cls: 'badge-warning' },
  review: { text: 'Check possible duplicate', cls: 'badge-danger' },
  failed: { text: 'Not accepted', cls: 'badge-danger' },
  synced: { text: 'Registered', cls: 'badge-success' },
};
const fmt = (ts) => new Date(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Patient registration that keeps working without the network: online it
// registers straight away; offline it saves the patient on this computer with a
// provisional ID and sends the registration once the server is reachable.
export default function Registration() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [recent, setRecent] = useState([]);
  const { online } = useOfflineState();

  const loadRecent = useCallback(() => {
    window.electronAPI.offline.listRegistrations().then(setRecent).catch(() => {});
  }, []);

  useEffect(() => {
    window.electronAPI.offline.fieldConfig().then(setConfig).catch(() => setConfig({ fields: [], defaults: true }));
    const t = setTimeout(loadRecent, 0);
    const off = window.electronAPI.offline.onUpdated(loadRecent);
    return () => { clearTimeout(t); off?.(); };
  }, [loadRecent]);

  const byKey = useMemo(() => new Map((config?.fields || []).map((f) => [f.field_key, f])), [config]);
  const isRequired = (key) => !!byKey.get(REQUIRED_KEY[key] || key)?.is_required || key === 'firstName' || key === 'lastName';

  const set = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setError(''); };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { ageOrYear, ...body } = form;
      const age = dobFromAgeOrYear(ageOrYear);
      if (age.error) { setError(age.error); return; }
      if (age.dob) body.dob = age.dob;
      if (body.telephone) body.telephone = String(body.telephone).replace(/\D/g, '').slice(-10);
      if (body.aadharNumber) body.aadharNumber = String(body.aadharNumber).replace(/\D/g, '');
      const res = await window.electronAPI.offline.registerPatient(body);
      if (!res.ok) { setError(res.message || 'Could not register.'); return; }
      setResult({ ...res, telephone: body.telephone });
      setForm(EMPTY);
      loadRecent();
    } catch (err) {
      setError(err.message || 'Could not register.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page ofl-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Patient Registration</h1>
          <p className="page-subtitle">Register a new patient. Works without the network — the patient is saved here with a provisional ID and registered on the server as soon as it is reachable.</p>
        </div>
        <div className="page-actions">
          <span className={`badge ${online ? 'badge-success' : 'badge-danger'}`}><span className="badge-dot" />{online ? 'Online' : 'Offline'}</span>
        </div>
      </div>

      {result && (
        <div className={`ofl-result ${result.mode === 'offline' ? 'offline' : 'online'}`}>
          {result.mode === 'offline' ? <CloudOff size={26} /> : <CheckCircle2 size={26} />}
          <div className="ofl-result-body">
            {result.mode === 'offline' ? (
              <>
                <h3>Saved on this computer</h3>
                <p>The server could not be reached, so <b>{result.name}</b> is saved here. Give the patient this <b>provisional ID</b> — the official CRN is issued automatically when the registration syncs.</p>
                <div className="ofl-provisional">{result.provisionalId}</div>
              </>
            ) : (
              <>
                <h3>Patient registered</h3>
                <p>CRN <b>{result.regNo}</b></p>
              </>
            )}
          </div>
          <div className="ofl-result-actions">
            {result.mode === 'offline' && (
              <button type="button" className="btn btn-secondary" onClick={() => printProvisionalSlip(result)}><Printer size={14} /> Print slip</button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => setResult(null)}><UserPlus size={14} /> Register another</button>
          </div>
        </div>
      )}

      <div className="ofl-grid">
        <form className="card ofl-form" onSubmit={submit}>
          <div className="card-header"><h3>New patient</h3></div>
          <div className="card-body">
            <div className="ofl-fields">
              {FIELDS.map((f) => (
                <label key={f.key} className="field-group">
                  <span className="field-label">{f.label}{isRequired(f.key) && <i className="req">*</i>}</span>
                  {f.type === 'select' ? (
                    <select className="control" value={form[f.key] || ''} onChange={(e) => set(f.key, e.target.value)}>
                      <option value="">Select…</option>
                      {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      className="control"
                      type={f.type === 'tel' ? 'text' : (f.type || 'text')} inputMode={f.type === 'tel' || f.type === 'number' ? 'numeric' : undefined}
                      maxLength={f.maxLength} value={form[f.key] || ''} placeholder={f.hint || ''}
                      min={f.type === 'number' ? 0 : undefined}
                      onChange={(e) => set(f.key, f.type === 'tel' ? e.target.value.replace(/\D/g, '') : e.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
            {error && <div className="ofl-error"><AlertCircle size={15} /> {error}</div>}
            {!online && <div className="ofl-note"><CloudOff size={14} /> Offline — a duplicate check against existing patients runs when this syncs. A possible match is held for you to confirm, never merged automatically.</div>}
            <div className="ofl-actions">
              <button type="button" className="btn btn-secondary" onClick={() => { setForm(EMPTY); setError(''); }} disabled={busy}><RotateCcw size={14} /> Clear</button>
              <button type="submit" className="btn btn-primary" disabled={busy}><Save size={14} /> {busy ? 'Saving…' : online ? 'Register patient' : 'Save offline'}</button>
            </div>
          </div>
        </form>

        <aside className="card ofl-side">
          <div className="card-header"><h3>Registered on this computer</h3><span className="ofl-count">{recent.length}</span></div>
          {recent.length === 0 ? (
            <p className="ofl-empty">Patients saved while offline appear here until they are registered on the server.</p>
          ) : (
            <ul className="ofl-list">
              {recent.slice(0, 30).map((r) => (
                <li key={r.id}>
                  <div>
                    <b>{r.patient_name}</b>
                    <small>{r.status === 'synced' ? (r.official_reg_no + (r.link_note ? ` · ${r.link_note.toLowerCase()}` : '')) : r.provisional_id} · {fmt(r.created_at)}</small>
                    {r.last_error && r.status !== 'synced' && <small className="ofl-err-text">{r.last_error}</small>}
                  </div>
                  <span className={`badge ${STATUS[r.status]?.cls || 'badge-neutral'}`}>{STATUS[r.status]?.text || r.status}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
