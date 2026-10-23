import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, UserCheck, UserPlus, Trash2, RotateCcw, CloudUpload, CheckCircle2, AlertTriangle } from 'lucide-react';
import useOfflineState from '../hooks/useOfflineState';
import '../assets/CSS/Offline.css';

const when = (ts) => {
  if (!ts) return '';
  const d = new Date(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`);
  return d.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const dobText = (d) => (d ? new Date(d).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// Everything saved on this computer that has not yet been accepted by the
// server — and anything that needs a person to decide.
export default function OfflineQueue() {
  const [regs, setRegs] = useState([]);
  const [cols, setCols] = useState([]);
  const [busy, setBusy] = useState(false);
  const { state, online } = useOfflineState();

  const load = useCallback(async () => {
    const [r, c] = await Promise.all([window.electronAPI.offline.listRegistrations(), window.electronAPI.offline.listCollections()]);
    setRegs(r); setCols(c);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load().catch(() => {}), 0);
    const off = window.electronAPI.offline.onUpdated(() => load().catch(() => {}));
    return () => { clearTimeout(t); off?.(); };
  }, [load]);

  const syncNow = async () => {
    setBusy(true);
    try { await window.electronAPI.offline.syncNow(); } finally { setBusy(false); load().catch(() => {}); }
  };
  const resolveReg = async (id, action, extra = {}) => { await window.electronAPI.offline.resolveRegistration({ id, action, ...extra }); load(); };
  const resolveCol = async (id, action) => { await window.electronAPI.offline.resolveCollection({ id, action }); load(); };

  const review = regs.filter((r) => r.status === 'review');
  const failedRegs = regs.filter((r) => r.status === 'failed');
  const pendingRegs = regs.filter((r) => r.status === 'pending');
  const doneRegs = regs.filter((r) => r.status === 'synced');
  const openCols = cols.filter((c) => c.status !== 'synced');
  const doneCols = cols.filter((c) => c.status === 'synced');
  const nothing = !review.length && !failedRegs.length && !pendingRegs.length && !openCols.length;

  return (
    <div className="page ofl-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Offline Queue</h1>
          <p className="page-subtitle">Registrations and sample collections saved on this computer while the server could not be reached. They are sent automatically, oldest first.</p>
        </div>
        <div className="page-actions">
          <span className={`badge ${online ? 'badge-success' : 'badge-danger'}`}><span className="badge-dot" />{online ? 'Online' : 'Offline'}</span>
          <button type="button" className="btn btn-primary" onClick={syncNow} disabled={busy || !online || state?.syncing}>
            <RefreshCw size={14} className={busy || state?.syncing ? 'spin' : ''} /> Sync now
          </button>
        </div>
      </div>

      {nothing && (
        <div className="ofl-allclear"><CheckCircle2 size={22} /> Nothing is waiting — everything saved on this computer has reached the server.</div>
      )}

      {review.length > 0 && (
        <section className="card ofl-section attn">
          <div className="card-header"><h3><AlertTriangle size={16} /> Check possible duplicates ({review.length})</h3></div>
          <div className="card-body">
            <p className="ofl-hint">These patients were registered offline, and the server already has someone with the same name and phone or birth date. Nothing was created yet — please decide for each.</p>
            {review.map((r) => (
              <div key={r.id} className="ofl-review">
                <div className="ofl-review-new">
                  <small>Registered offline</small>
                  <b>{r.patient_name}</b>
                  <span>{r.payload?.telephone || '—'} · born {dobText(r.payload?.dob)}</span>
                  <code>{r.provisional_id}</code>
                </div>
                <div className="ofl-review-matches">
                  {r.matches.map((m) => (
                    <div key={m.id} className="ofl-match">
                      <div><b>{m.name}</b> <code>{m.reg_no}</code><small>{m.telephone || '—'} · born {dobText(m.dob)}</small></div>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => resolveReg(r.id, 'use-existing', { patientId: m.id, regNo: m.reg_no })}>
                        <UserCheck size={13} /> Same person
                      </button>
                    </div>
                  ))}
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => resolveReg(r.id, 'register-new')}>
                    <UserPlus size={13} /> Different person — register as new
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(failedRegs.length > 0 || cols.some((c) => c.status === 'failed')) && (
        <section className="card ofl-section attn">
          <div className="card-header"><h3><AlertTriangle size={16} /> Not accepted by the server</h3></div>
          <ul className="ofl-queue">
            {failedRegs.map((r) => (
              <li key={`r${r.id}`}>
                <div><b>{r.patient_name}</b><small>Registration · {r.provisional_id} · {when(r.created_at)}</small><small className="ofl-err-text">{r.last_error}</small></div>
                <div className="ofl-row-actions">
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => resolveReg(r.id, 'retry')}><RotateCcw size={13} /> Retry</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => { if (window.confirm('Discard this registration? The patient will not be registered.')) resolveReg(r.id, 'discard'); }}><Trash2 size={13} /> Discard</button>
                </div>
              </li>
            ))}
            {cols.filter((c) => c.status === 'failed').map((c) => (
              <li key={`c${c.id}`}>
                <div><b>{c.patient_name}</b><small>Collection · bill {c.bill_number} · collected {when(c.collected_at)}</small><small className="ofl-err-text">{c.last_error}</small></div>
                <div className="ofl-row-actions">
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => resolveCol(c.id, 'retry')}><RotateCcw size={13} /> Retry</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => { if (window.confirm('Discard this collection record?')) resolveCol(c.id, 'discard'); }}><Trash2 size={13} /> Discard</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(pendingRegs.length > 0 || cols.some((c) => c.status === 'pending')) && (
        <section className="card ofl-section">
          <div className="card-header"><h3><CloudUpload size={16} /> Waiting to sync</h3></div>
          <ul className="ofl-queue">
            {pendingRegs.map((r) => (
              <li key={`r${r.id}`}>
                <div><b>{r.patient_name}</b><small>Registration · {r.provisional_id} · saved {when(r.created_at)}</small>{r.last_error && <small className="ofl-err-text">Last try: {r.last_error}</small>}</div>
                <span className="badge badge-warning">Waiting</span>
              </li>
            ))}
            {cols.filter((c) => c.status === 'pending').map((c) => (
              <li key={`c${c.id}`}>
                <div><b>{c.patient_name}</b><small>Collection · bill {c.bill_number} · collected {when(c.collected_at)}</small>{c.last_error && <small className="ofl-err-text">Last try: {c.last_error}</small>}</div>
                <span className="badge badge-warning">Waiting</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(doneRegs.length > 0 || doneCols.length > 0) && (
        <section className="card ofl-section">
          <div className="card-header"><h3><CheckCircle2 size={16} /> Synced</h3></div>
          <ul className="ofl-queue compact">
            {doneRegs.slice(0, 15).map((r) => (
              <li key={`r${r.id}`}>
                <div><b>{r.patient_name}</b><small>Registration · {r.provisional_id} → <b>{r.official_reg_no}</b>{r.link_note ? ` (${r.link_note.toLowerCase()})` : ''} · {when(r.synced_at)}</small></div>
                <span className="badge badge-success">Registered</span>
              </li>
            ))}
            {doneCols.slice(0, 15).map((c) => (
              <li key={`c${c.id}`}>
                <div><b>{c.patient_name}</b><small>Collection · bill {c.bill_number} · collected {when(c.collected_at)} · synced {when(c.synced_at)}</small></div>
                <span className="badge badge-success">Synced</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
