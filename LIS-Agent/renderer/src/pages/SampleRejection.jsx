import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import JsBarcode from 'jsbarcode';
import { RefreshCw, Search, Ban, Printer, ShieldAlert, ScanLine, CheckCircle2 } from 'lucide-react';
import { API_BASE } from '../apiBase';
import '../assets/CSS/SampleRejection.css';

const POLL_MS = 20_000;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const age = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);

// Same 50x20mm label as the web Billing "Print Barcode".
function printLabel({ sample_id, patient_name, tests }) {
  const shortId = sample_id.slice(-4);
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, shortId, { format: 'CODE128', width: 2, height: 60, displayValue: false, margin: 0 });
  const w = window.open('', '_blank', 'width=700,height=500');
  if (!w) return;
  w.document.write(`<html><head><title>Sample Label</title><style>
    @page{size:50mm 20mm;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#fff;font-family:Arial,sans-serif}
    .label{width:50mm;height:20mm;padding:1.3mm 2mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.3mm;text-align:center;overflow:hidden}
    .a{font-size:2.6mm;line-height:1.05;font-weight:700}.b{display:block;height:6mm;max-width:90%;margin-top:.3mm}
    .c{font-family:"Courier New",monospace;font-size:2.1mm;line-height:1;font-weight:700}
    .d{font-size:2.6mm;line-height:1.05;font-weight:700;text-transform:capitalize;margin-top:.4mm}
    .e{font-size:2.4mm;line-height:1.1;font-weight:700;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  </style></head><body><div class="label"><div class="a">${esc(sample_id)}</div><img class="b" src="${canvas.toDataURL('image/png')}"/>
  <div class="c">${esc(shortId)}</div><div class="d">${esc(String(patient_name || '').trim().split(/\s+/)[0])}</div><div class="e">${esc((tests || []).join(', '))}</div></div></body></html>`);
  w.document.close();
  w.onload = () => { setTimeout(() => { w.print(); w.close(); }, 400); };
}

// Sample rejection: the technician scans a sample that arrived unfit, picks a
// reason code, and the system retires that tube and issues a replacement
// barcode for the same tests. The collector desk is alerted until the patient
// has been recollected.
export default function SampleRejection() {
  const [reasons, setReasons] = useState([]);
  const [code, setCode] = useState('');
  const [sample, setSample] = useState(null);
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef(null);

  const loadRows = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/lab/rejections`);
      if (res.data.success) setRows(res.data.rejections || []);
    } catch { /* keep last */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    axios.get(`${API_BASE}/api/lab/rejection-reasons`).then((r) => setReasons(r.data.reasons || [])).catch(() => {});
    loadRows();
    const t = setInterval(loadRows, POLL_MS);
    return () => clearInterval(t);
  }, [loadRows]);

  const lookup = async () => {
    if (!code.trim()) return;
    setError(''); setResult(null); setSample(null); setReasonCode(''); setNote('');
    try {
      const res = await axios.get(`${API_BASE}/api/lab/samples/lookup`, { params: { code: code.trim() }, validateStatus: () => true });
      if (res.data.success) setSample(res.data.sample); else setError(res.data.message || 'Sample not found.');
    } catch { setError('Could not reach the server.'); }
  };

  const chosen = reasons.find((r) => r.code === reasonCode);
  const canSubmit = sample && reasonCode && (!chosen?.note_required || note.trim());

  const reject = async () => {
    setBusy(true); setError('');
    try {
      const res = await axios.post(`${API_BASE}/api/lab/samples/reject`,
        { code: sample.sample_id, reason_code: reasonCode, note: note.trim() || undefined }, { validateStatus: () => true });
      if (res.data.success) {
        setResult({ ...res.data, patient_name: sample.patient_name });
        setSample(null); setCode(''); setReasonCode(''); setNote('');
        loadRows();
      } else setError(res.data.message || 'Could not reject the sample.');
    } catch { setError('Could not reach the server.'); }
    finally { setBusy(false); setConfirming(false); }
  };

  const grouped = reasons.reduce((acc, r) => { (acc[r.category] ||= []).push(r); return acc; }, {});
  const pending = rows.filter((r) => r.status === 'Recollection Pending');
  const overdue = pending.filter((r) => r.overdue).length;
  const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="page rj-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Sample Rejection</h1>
          <p className="page-subtitle">Reject a specimen that is unfit for testing. A replacement barcode is issued and the collection desk is alerted to recollect.</p>
        </div>
        <div className="page-actions">
          <button onClick={loadRows} className="btn btn-secondary"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {pending.length > 0 && (
        <div className={`rj-alert${overdue ? ' overdue' : ''}`}>
          <ShieldAlert size={18} />
          <span>
            <b>{pending.length} patient{pending.length > 1 ? 's' : ''} awaiting recollection</b>
            {overdue ? ` — ${overdue} overdue (over 30 minutes)` : ''}
          </span>
        </div>
      )}

      <div className="rj-grid">
        <div className="rj-main">
          {/* Step 1 */}
          <section className="card rj-step">
            <header><span className="rj-num">1</span><div><h3>Identify the sample</h3><p>Scan the tube barcode, or type the Sample ID or its last four digits.</p></div></header>
            <div className="rj-scan">
              <div className="rj-scan-input">
                <ScanLine size={18} />
                <input ref={inputRef} autoFocus type="text" placeholder="Scan or enter sample ID" value={code}
                  onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }} />
              </div>
              <button className="btn btn-primary" onClick={lookup} disabled={!code.trim()}><Search size={14} /> Find sample</button>
            </div>
            {error && <div className="rj-error">{error}</div>}

            {sample && (
              <div className="rj-sample">
                <div className="rj-avatar">{initials(sample.patient_name)}</div>
                <div className="rj-sample-body">
                  <div className="rj-sample-name">{sample.patient_name || 'Unknown patient'}<span>{sample.reg_no}</span></div>
                  <div className="rj-sample-id">{sample.sample_id}</div>
                  <div className="rj-sample-tests">{(sample.tests || []).map((t) => t.test_name).join(' · ') || '—'}</div>
                </div>
                <div className="rj-stage"><small>Stage</small>{sample.stage}</div>
              </div>
            )}
          </section>

          {/* Step 2 */}
          <section className={`card rj-step${sample ? '' : ' locked'}`}>
            <header><span className="rj-num">2</span><div><h3>Reason for rejection</h3><p>Choose the reason code that applies.</p></div></header>
            {Object.entries(grouped).map(([cat, list]) => (
              <div key={cat} className="rj-cat">
                <div className="rj-cat-title">{cat}</div>
                <div className="rj-reasons">
                  {list.map((r) => (
                    <label key={r.code} className={`rj-reason${reasonCode === r.code ? ' active' : ''}`}>
                      <input type="radio" name="reason" value={r.code} disabled={!sample} checked={reasonCode === r.code} onChange={() => setReasonCode(r.code)} />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <label className="rj-remarks">
              <span className="field-label">Remarks{chosen?.note_required ? ' (required)' : ' (optional)'}</span>
              <textarea className="control" rows={2} maxLength={255} disabled={!sample} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add details for the collection desk" />
            </label>
            <div className="rj-actions">
              <button className="btn rj-danger" disabled={!canSubmit || busy} onClick={() => setConfirming(true)}><Ban size={15} /> Reject sample</button>
            </div>
          </section>

          {result && (
            <section className="rj-done">
              <CheckCircle2 size={22} />
              <div>
                <h4>Sample rejected — recollection requested</h4>
                <p>Sample {result.rejected_sample_id.slice(-4)} is retired. Replacement barcode <b>{result.new_sample_id}</b>. The collection desk has been alerted.</p>
                <button className="btn btn-secondary" onClick={() => printLabel({ sample_id: result.new_sample_id, patient_name: result.patient_name, tests: result.tests })}>
                  <Printer size={14} /> Print new label
                </button>
              </div>
            </section>
          )}
        </div>

        {/* Alerts */}
        <aside className="card rj-log">
          <header><h3>Today's rejections</h3><span className="rj-count">{rows.length}</span></header>
          {loading && rows.length === 0 && <div className="rj-empty">Loading…</div>}
          {!loading && rows.length === 0 && <div className="rj-empty">No rejections today.</div>}
          <ul>
            {rows.map((r) => (
              <li key={r.id}>
                <div className="rj-log-top">
                  <b>{r.patient_name}</b>
                  {r.status === 'Recollected'
                    ? <span className="badge badge-success">Recollected</span>
                    : <span className={`badge ${r.overdue ? 'badge-danger' : 'badge-warning'}`}>Pending · {age(r.minutes_open)}</span>}
                </div>
                <div className="rj-log-meta">{r.token_number ? `Token ${r.token_number} · ` : ''}{r.reg_no} · {fmt(r.rejected_at)}</div>
                <div className="rj-log-reason">{r.reason_label}{r.note ? ` — ${r.note}` : ''}</div>
                <div className="rj-log-ids">{r.sample_id.slice(-4)} <i>&rarr;</i> {r.recollect_sample_id.slice(-4)} <span>{r.tests}</span></div>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {confirming && (
        <div className="modal-overlay">
          <div className="modal-card rj-modal">
            <h3>Reject this sample?</h3>
            <p>{sample?.patient_name}'s sample will be retired for <b>{chosen?.label}</b>. A new barcode is issued and the patient must be recollected. This cannot be undone.</p>
            <div className="rj-modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
              <button className="btn rj-danger" onClick={reject} disabled={busy}>{busy ? 'Rejecting…' : 'Reject sample'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
