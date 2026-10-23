import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import JsBarcode from 'jsbarcode';
import { RefreshCw, Send, PackageCheck, Printer, Undo2, ScanLine, ArrowRightLeft } from 'lucide-react';
import { API_BASE } from '../apiBase';
import '../assets/CSS/SampleTransfer.css';

const POLL_MS = 20_000;
const REASONS = ['Test not available in this lab / hospital', 'Analyzer / equipment not working', 'Specialised or confirmatory test', 'Turnaround / workload', 'Other'];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (ts) => (ts ? new Date(ts).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const place = (hospital, lab) => [hospital, lab].filter(Boolean).join(' — ');

function printDispatchNote(r) {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, r.sample_id.slice(-4), { format: 'CODE128', width: 2, height: 50, displayValue: false, margin: 0 });
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Transfer note</title><style>
    body{font-family:Arial,sans-serif;margin:28px;color:#0f172a}h1{font-size:19px;margin:0 0 12px}.meta{font-size:12.5px;line-height:1.7;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:12px}th{background:#f1f5f9;text-align:left;padding:7px 8px;border:1px solid #cbd5e1;font-size:11px;text-transform:uppercase}
    td{padding:7px 8px;border:1px solid #cbd5e1;vertical-align:top}.m{font-size:10.5px;color:#64748b;margin-top:2px}
    .sig{display:flex;gap:60px;margin-top:46px;font-size:12px}.sig div{border-top:1px solid #0f172a;padding-top:6px;min-width:200px}
  </style></head><body><h1>Sample Transfer Note</h1>
  <div class="meta"><b>Transfer:</b> ${esc(r.transfer_type)}<br/><b>From:</b> ${esc(place(r.from_facility, r.from_lab))}<br/><b>To:</b> ${esc(place(r.to_facility, r.to_lab))}<br/>
  <b>Dispatched:</b> ${esc(fmt(r.dispatched_at))}${r.consignment_ref ? `<br/><b>Consignment ref:</b> ${esc(r.consignment_ref)}` : ''}${r.dispatch_remarks ? `<br/><b>Handling:</b> ${esc(r.dispatch_remarks)}` : ''}</div>
  <table><thead><tr><th>Barcode</th><th>Patient</th><th>Tests</th><th>Reason</th></tr></thead><tbody><tr>
  <td><img src="${canvas.toDataURL('image/png')}" height="38"/><div class="m">${esc(r.sample_id)}</div></td>
  <td>${esc(r.patient_name)}<div class="m">${esc(r.reg_no)}</div></td><td>${esc(r.tests)}</td><td>${esc(r.reason)}</td></tr></tbody></table>
  <div class="sig"><div>Dispatched by</div><div>Received by</div></div></body></html>`);
  w.document.close();
  w.onload = () => setTimeout(() => w.print(), 300);
}

// Moves a sample between labs in this hospital, or to another hospital, and
// receives samples sent to this lab. The barcode never changes.
export default function SampleTransfer() {
  const [tab, setTab] = useState('out');
  const [facilities, setFacilities] = useState([]);
  const [ownLabs, setOwnLabs] = useState([]);
  const [out, setOut] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState({ mode: 'labs', code: '', to_branch_id: '', to_lab_id: '', reason: REASONS[0], other: '', consignment_ref: '', remarks: '', ticket_id: '' });
  // Open analyzer breakdown tickets, so a transfer can be tied to the breakdown that caused it.
  const [tickets, setTickets] = useState([]);
  useEffect(() => {
    axios.get(`${API_BASE}/api/equipment/tickets`, { params: { status: 'active' } }).then((r) => r.data.success && setTickets(r.data.tickets)).catch(() => {});
  }, []);
  const [scan, setScan] = useState('');
  const [condition, setCondition] = useState('');

  const load = useCallback(async () => {
    try {
      const [o, i] = await Promise.all([
        axios.get(`${API_BASE}/api/lab/referrals`, { params: { direction: 'out' } }),
        axios.get(`${API_BASE}/api/lab/referrals`, { params: { direction: 'in' } }),
      ]);
      if (o.data.success) setOut(o.data.referrals);
      if (i.data.success) setIncoming(i.data.referrals);
    } catch { /* keep last */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    axios.get(`${API_BASE}/api/lab/referral-facilities`).then((r) => { if (r.data.success) { setFacilities(r.data.facilities); setOwnLabs(r.data.own_labs || []); } }).catch(() => {});
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const post = async (url, body) => {
    setBusy(true); setMsg(null);
    try {
      const res = await axios.post(`${API_BASE}${url}`, body, { validateStatus: () => true });
      setMsg({ ok: !!res.data.success, text: res.data.message || (res.data.success ? 'Done.' : 'Request failed.') });
      if (res.data.success) { load(); return res.data; }
    } catch { setMsg({ ok: false, text: 'Could not reach the server.' }); }
    finally { setBusy(false); }
    return null;
  };

  const submit = async (e) => {
    e.preventDefault();
    const reason = form.reason === 'Other' ? form.other.trim() : form.reason;
    const data = await post('/api/lab/referrals', {
      code: form.code.trim(), transfer_type: form.mode, reason, consignment_ref: form.consignment_ref, remarks: form.remarks, ticket_id: form.ticket_id || undefined,
      to_branch_id: form.mode === 'hospitals' ? form.to_branch_id : undefined, to_lab_id: form.to_lab_id || undefined,
    });
    if (data) setForm((f) => ({ ...f, code: '', other: '', remarks: '', to_lab_id: f.mode === 'labs' ? '' : f.to_lab_id }));
  };
  const receive = async (code) => { const d = await post('/api/lab/referrals/receive', { code, condition: condition.trim() || undefined }); if (d) setScan(''); };
  const recall = (r) => { if (window.confirm(`Recall sample ${r.sample_id.slice(-4)} from ${place(r.to_facility, r.to_lab)}?`)) post(`/api/lab/referrals/${r.id}/cancel`, {}); };

  const destLabs = facilities.find((h) => String(h.id) === String(form.to_branch_id))?.labs || [];
  const waiting = incoming.filter((r) => r.status === 'In Transit').length;
  const badge = (s) => <span className={`badge ${s === 'Received' ? 'badge-success' : s === 'Cancelled' ? 'badge-neutral' : 'badge-warning'}`}>{s}</span>;

  return (
    <div className="page st-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Sample Transfer</h1>
          <p className="page-subtitle">Move samples between labs in this hospital, or refer them to another hospital. The barcode stays the same, so custody and results follow the sample.</p>
        </div>
        <div className="page-actions"><button onClick={load} className="btn btn-secondary"><RefreshCw size={14} /> Refresh</button></div>
      </div>

      <div className="stx-tabs">
        <button className={tab === 'out' ? 'active' : ''} onClick={() => setTab('out')}>Outgoing</button>
        <button className={tab === 'in' ? 'active' : ''} onClick={() => setTab('in')}>Incoming{waiting > 0 && <span className="stx-count">{waiting}</span>}</button>
      </div>

      {msg && <div className={`stx-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}

      {tab === 'out' && (
        <>
          <form className="card stx-card" onSubmit={submit}>
            <h3><ArrowRightLeft size={17} /> Transfer a sample</h3>
            <div className="stx-modes">
              {[['labs', 'Between labs', 'Another lab in this hospital'], ['hospitals', 'Between hospitals', 'Refer to another hospital']].map(([k, l, d]) => (
                <button type="button" key={k} className={form.mode === k ? 'active' : ''} onClick={() => setForm({ ...form, mode: k, to_lab_id: '', to_branch_id: '' })}><b>{l}</b><span>{d}</span></button>
              ))}
            </div>
            <div className="stx-grid">
              <label><span className="field-label">Sample barcode</span><input className="control" required placeholder="Scan or enter Sample ID" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
              {form.mode === 'labs' ? (
                <label><span className="field-label">Transfer to lab</span>
                  <select className="control" required value={form.to_lab_id} onChange={(e) => setForm({ ...form, to_lab_id: e.target.value })}>
                    <option value="">Select lab…</option>{ownLabs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select></label>
              ) : (
                <>
                  <label><span className="field-label">Refer to hospital</span>
                    <select className="control" required value={form.to_branch_id} onChange={(e) => setForm({ ...form, to_branch_id: e.target.value, to_lab_id: '' })}>
                      <option value="">Select hospital…</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.branch_name} ({f.hospital_code})</option>)}
                    </select></label>
                  <label><span className="field-label">Lab there (optional)</span>
                    <select className="control" disabled={!form.to_branch_id} value={form.to_lab_id} onChange={(e) => setForm({ ...form, to_lab_id: e.target.value })}>
                      <option value="">Any lab</option>{destLabs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select></label>
                </>
              )}
              <label><span className="field-label">Reason</span>
                <select className="control" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>
              {form.reason === 'Other' && <label><span className="field-label">Specify reason</span><input className="control" required maxLength={150} value={form.other} onChange={(e) => setForm({ ...form, other: e.target.value })} /></label>}
              {tickets.length > 0 && (
                <label><span className="field-label">Because of an analyzer breakdown? (optional)</span>
                  <select className="control" value={form.ticket_id} onChange={(e) => setForm({ ...form, ticket_id: e.target.value })}>
                    <option value="">No</option>
                    {tickets.map((t) => <option key={t.id} value={t.id}>{t.ticket_no} — {t.machine_name} ({t.category})</option>)}
                  </select>
                </label>
              )}
              {form.mode === 'hospitals' && <label><span className="field-label">Courier / consignment ref</span><input className="control" maxLength={80} value={form.consignment_ref} onChange={(e) => setForm({ ...form, consignment_ref: e.target.value })} /></label>}
              <label><span className="field-label">Handling remarks</span><input className="control" maxLength={255} placeholder="e.g. keep at 2–8 °C" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></label>
            </div>
            <div className="stx-actions"><button className="btn btn-primary" disabled={busy}><Send size={14} /> {form.mode === 'labs' ? 'Transfer sample' : 'Dispatch sample'}</button></div>
          </form>

          <div className="card stx-table">
            <div className="stx-table-title">Sent from this hospital</div>
            <div className="table-scroll"><table className="data-table">
              <thead><tr><th>Sample</th><th>Patient</th><th>Type</th><th>To</th><th>Tests</th><th>Dispatched</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {loading && out.length === 0 && <tr><td colSpan="8"><div className="loading-row"><div className="spinner" /> Loading...</div></td></tr>}
                {!loading && out.length === 0 && <tr><td colSpan="8"><div className="empty-state"><div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>No transfers sent today</div></div></td></tr>}
                {out.map((r) => (
                  <tr key={r.id}>
                    <td className="stx-mono">{r.sample_id.slice(-4)}</td>
                    <td><div>{r.patient_name}</div><div className="stx-sub">{r.reg_no}</div></td>
                    <td>{r.transfer_type}</td><td>{place(r.to_facility, r.to_lab)}</td><td>{r.tests}</td><td>{fmt(r.dispatched_at)}</td>
                    <td>{badge(r.status)}</td>
                    <td className="stx-row-actions">
                      <button className="btn btn-secondary" onClick={() => printDispatchNote(r)}><Printer size={13} /> Note</button>
                      {r.status === 'In Transit' && <button className="btn btn-secondary" onClick={() => recall(r)}><Undo2 size={13} /> Recall</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </>
      )}

      {tab === 'in' && (
        <>
          <div className="card stx-card">
            <h3><PackageCheck size={17} /> Receive a transferred sample</h3>
            <div className="stx-receive">
              <div className="stx-scan"><ScanLine size={18} /><input autoFocus placeholder="Scan the barcode on the tube" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && scan.trim()) receive(scan.trim()); }} /></div>
              <input className="control stx-cond" maxLength={160} placeholder="Condition on arrival (optional)" value={condition} onChange={(e) => setCondition(e.target.value)} />
              <button className="btn btn-primary" disabled={busy || !scan.trim()} onClick={() => receive(scan.trim())}><PackageCheck size={14} /> Receive</button>
            </div>
          </div>

          <div className="card stx-table">
            <div className="stx-table-title">Sent to this hospital or lab</div>
            <div className="table-scroll"><table className="data-table">
              <thead><tr><th>Sample</th><th>Patient</th><th>Type</th><th>From</th><th>Tests</th><th>Reason</th><th>Dispatched</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {loading && incoming.length === 0 && <tr><td colSpan="9"><div className="loading-row"><div className="spinner" /> Loading...</div></td></tr>}
                {!loading && incoming.length === 0 && <tr><td colSpan="9"><div className="empty-state"><div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Nothing transferred to this lab</div></div></td></tr>}
                {incoming.map((r) => (
                  <tr key={r.id}>
                    <td className="stx-mono">{r.sample_id.slice(-4)}</td>
                    <td><div>{r.patient_name}</div><div className="stx-sub">{r.reg_no}</div></td>
                    <td>{r.transfer_type}</td><td>{place(r.from_facility, r.from_lab)}</td><td>{r.tests}</td><td>{r.reason}</td><td>{fmt(r.dispatched_at)}</td>
                    <td>{badge(r.status)}{r.receipt_condition && <div className="stx-sub">{r.receipt_condition}</div>}</td>
                    <td>{r.status === 'In Transit' && <button className="btn btn-primary" disabled={busy} onClick={() => receive(r.sample_id)}><PackageCheck size={13} /> Receive</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </>
      )}
    </div>
  );
}
