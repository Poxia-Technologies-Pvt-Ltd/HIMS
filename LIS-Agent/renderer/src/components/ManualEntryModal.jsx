import { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Save, Keyboard, AlertCircle } from 'lucide-react';
import { API_BASE } from '../apiBase';
import { useManualReasons, ReasonPicker, reasonComplete } from './ManualReason';
import '../assets/CSS/Offline.css';

// Type the results of one test in by hand — for tests with no analyzer
// interface, an analyzer that is down, or a repeat by the manual method. The
// result is saved like an analyzer result (it goes to validation), but it is
// marked as manual and carries a mandatory reason, kept in its audit trail.
export default function ManualEntryModal({ item, onClose, onSaved }) {
  const reasons = useManualReasons();
  const [form, setForm] = useState(null);
  const [values, setValues] = useState({});
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    axios.get(`${API_BASE}/api/lab/manual-entry/form/${item.bill_item_id}`, { validateStatus: () => true })
      .then((res) => {
        if (!live) return;
        if (!res.data?.success) { setLoadError(res.data?.message || 'Could not load this test.'); return; }
        setForm(res.data);
        setValues(Object.fromEntries(res.data.parameters.map((p) => [p.parameter_name, p.value === null || p.value === undefined ? '' : String(p.value)])));
        // A test with no analyzer behind it is manual by nature.
        if (!res.data.test.interfaced) setCode('NOT_INTERFACED');
      })
      .catch(() => live && setLoadError('Could not reach the server.'));
    return () => { live = false; };
  }, [item.bill_item_id]);

  const typed = (form?.parameters || []).filter((p) => !p.calculated && String(values[p.parameter_name] ?? '').trim() !== '');
  const ready = typed.length > 0 && reasonComplete(reasons, code, note);

  const save = async () => {
    setBusy(true); setError('');
    const reason = reasons.find((r) => r.code === code);
    try {
      const res = await axios.post(`${API_BASE}/api/lab/save-test-results`, {
        sample_id: item.sample_id, bill_item_id: item.bill_item_id, test_id: item.test_id, test_name: item.test_name,
        entry_mode: 'manual', manual_reason_code: code, manual_reason: note.trim(),
        // used when this amends a result that was already validated
        edit_reason: `${reason?.label || ''}${note.trim() ? `: ${note.trim()}` : ''}`,
        results: typed.map((p) => ({
          parameter_name: p.parameter_name, result_value: String(values[p.parameter_name]).trim(), unit: p.unit, reference_range: p.reference_range, flag: '',
        })),
      }, { validateStatus: () => true });
      if (!res.data?.success) { setError(res.data?.message || 'The result was not saved.'); return; }
      onSaved?.();
      onClose();
    } catch {
      setError('Could not reach the server — results typed by hand need a connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal-card" style={{ width: 760, maxWidth: '94vw', padding: 28, maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="flex-between" style={{ marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}><Keyboard size={20} /> Type results manually</h2>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 3 }}>
              {item.test_name} · sample {item.sample_id}{form ? ` · ${form.test.patient_name}${form.test.age !== null ? `, ${form.test.age}y` : ''}${form.test.gender ? ` ${String(form.test.gender)[0]}` : ''}` : ''}
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-icon" disabled={busy}><X size={18} /></button>
        </div>

        {loadError && <div className="ofl-error"><AlertCircle size={15} /> {loadError}</div>}
        {!form && !loadError && <p className="ofl-empty">Loading…</p>}

        {form && (
          <>
            {form.test.interfaced && (
              <div className="ofl-note" style={{ marginTop: 0, marginBottom: 14 }}>
                This test normally comes from an analyzer. Values typed here are marked as manual, need a reason, and always go to validation.
              </div>
            )}
            {form.parameters.length === 0 ? (
              <div className="ofl-error"><AlertCircle size={15} /> This test has no parameters set up. Ask an admin to add them in Test Management.</div>
            ) : (
              <table className="data-table" style={{ marginBottom: 16 }}>
                <thead><tr><th>Parameter</th><th style={{ width: 190 }}>Result</th><th>Unit</th><th>Reference range</th></tr></thead>
                <tbody>
                  {form.parameters.map((p) => (
                    <tr key={p.parameter_name}>
                      <td style={{ fontWeight: 700 }}>{p.parameter_name}</td>
                      <td>
                        {p.calculated ? <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>calculated automatically</span>
                          : p.result_type === 'select' && p.options.length ? (
                            <select className="control" style={{ height: 36 }} value={values[p.parameter_name] || ''} onChange={(e) => setValues((v) => ({ ...v, [p.parameter_name]: e.target.value }))}>
                              <option value="">—</option>
                              {p.options.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input className="control" style={{ height: 36 }} inputMode={p.result_type === 'numeric' ? 'decimal' : undefined}
                              value={values[p.parameter_name] || ''} onChange={(e) => setValues((v) => ({ ...v, [p.parameter_name]: e.target.value }))} />
                          )}
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{p.unit}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{p.reference_range || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <ReasonPicker reasons={reasons} code={code} note={note} onCode={setCode} onNote={setNote} />
            {error && <div className="ofl-error"><AlertCircle size={15} /> {error}</div>}
            <div className="ofl-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={!ready || busy}>
                <Save size={14} /> {busy ? 'Saving…' : `Save ${typed.length || ''} result${typed.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
