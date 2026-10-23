import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Send, PackageCheck, Printer, Undo2, ScanLine } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import '../../assets/CSS/QueueManagement.css';
import '../../assets/CSS/SampleReferrals.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}`, 'Content-Type': 'application/json' });
const branchQ = () => { const b = localStorage.getItem('branch_id'); return b ? `branch_id=${b}` : ''; };
const POLL_MS = 20_000;

const REASONS = ['Test not available in this lab / hospital', 'Analyzer / equipment not working', 'Specialised or confirmatory test', 'Turnaround / workload', 'Other'];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (ts) => (ts ? new Date(ts).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

const place = (hospital, lab) => [hospital, lab].filter(Boolean).join(' — ');

// One-page dispatch note that travels with the samples: the barcode on the
// note is the same one on the tube, so the receiving lab checks it in as-is.
function printDispatchNote(rows) {
  const items = rows.map((r) => {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, r.sample_id.slice(-4), { format: 'CODE128', width: 2, height: 50, displayValue: false, margin: 0 });
    return `<tr><td><img src="${canvas.toDataURL('image/png')}" height="38"/><div class="m">${esc(r.sample_id)}</div></td>
      <td>${esc(r.patient_name)}<div class="m">${esc(r.reg_no)}</div></td><td>${esc(r.tests)}</td><td>${esc(r.reason)}</td></tr>`;
  }).join('');
  const f = rows[0];
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><title>Referral dispatch note</title><style>
    body{font-family:Arial,sans-serif;margin:28px;color:#0f172a}h1{font-size:19px;margin:0 0 12px}
    .meta{font-size:12.5px;line-height:1.7;margin-bottom:16px}table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#f1f5f9;text-align:left;padding:7px 8px;border:1px solid #cbd5e1;font-size:11px;text-transform:uppercase}
    td{padding:7px 8px;border:1px solid #cbd5e1;vertical-align:top}.m{font-size:10.5px;color:#64748b;margin-top:2px}
    .sig{display:flex;gap:60px;margin-top:46px;font-size:12px}.sig div{border-top:1px solid #0f172a;padding-top:6px;min-width:200px}
  </style></head><body><h1>Sample Referral — Dispatch Note</h1>
  <div class="meta"><b>Transfer:</b> ${esc(f.transfer_type)}<br/><b>From:</b> ${esc(place(f.from_facility, f.from_lab))}<br/><b>To:</b> ${esc(place(f.to_facility, f.to_lab))}<br/>
  <b>Dispatched:</b> ${esc(fmt(f.dispatched_at))}${f.consignment_ref ? `<br/><b>Consignment / courier ref:</b> ${esc(f.consignment_ref)}` : ''}${f.dispatch_remarks ? `<br/><b>Handling:</b> ${esc(f.dispatch_remarks)}` : ''}</div>
  <table><thead><tr><th>Barcode</th><th>Patient</th><th>Tests requested</th><th>Reason</th></tr></thead><tbody>${items}</tbody></table>
  <div class="sig"><div>Dispatched by</div><div>Received by</div></div></body></html>`);
  w.document.close();
  w.onload = () => setTimeout(() => w.print(), 300);
  return true;
}

export default function SampleReferrals() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [tab, setTab] = useState('out');
  const [facilities, setFacilities] = useState([]);
  const [ownLabs, setOwnLabs] = useState([]);
  const [out, setOut] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ mode: 'labs', code: '', to_branch_id: '', to_lab_id: '', reason: REASONS[0], other: '', consignment_ref: '', remarks: '', ticket_id: '' });
  // Open analyzer breakdown tickets, so a referral can be tied to the breakdown that caused it.
  const [tickets, setTickets] = useState([]);
  useEffect(() => {
    fetch(`${API_BASE}/api/equipment/tickets?status=active`, { headers: authHdr() }).then((r) => r.json()).then((d) => d.success && setTickets(d.tickets)).catch(() => {});
  }, []);
  const [scan, setScan] = useState('');
  const [condition, setCondition] = useState('');

  const load = useCallback(async () => {
    try {
      const q = branchQ();
      const [o, i] = await Promise.all([
        fetch(`${API_BASE}/api/lab/referrals?direction=out${q ? `&${q}` : ''}`, { headers: authHdr() }).then((r) => r.json()),
        fetch(`${API_BASE}/api/lab/referrals?direction=in${q ? `&${q}` : ''}`, { headers: authHdr() }).then((r) => r.json()),
      ]);
      if (o.success) setOut(o.referrals);
      if (i.success) setIncoming(i.referrals);
    } catch { /* keep last */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/lab/referral-facilities?${branchQ()}`, { headers: authHdr() }).then((r) => r.json()).then((d) => { if (d.success) { setFacilities(d.facilities); setOwnLabs(d.own_labs || []); } }).catch(() => {});
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const post = async (url, body, okMsg) => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}${url}`, { method: 'POST', headers: authHdr(), body: JSON.stringify({ ...body, branch_id: localStorage.getItem('branch_id') || undefined }) });
      const data = await res.json();
      if (data.success) { showAlert(okMsg || data.message, 'success'); load(); return data; }
      showAlert(data.message || 'Request failed.', 'error');
    } catch { showAlert('Network error.', 'error'); }
    finally { setBusy(false); }
    return null;
  };

  const dispatch = async (e) => {
    e.preventDefault();
    const reason = form.reason === 'Other' ? form.other.trim() : form.reason;
    const data = await post('/api/lab/referrals', { code: form.code.trim(), transfer_type: form.mode, to_branch_id: form.mode === 'hospitals' ? form.to_branch_id : undefined, to_lab_id: form.to_lab_id || undefined, reason, consignment_ref: form.consignment_ref, remarks: form.remarks, ticket_id: form.ticket_id || undefined });
    if (data) setForm((f) => ({ ...f, code: '', other: '', remarks: '', to_lab_id: f.mode === 'labs' ? '' : f.to_lab_id }));
  };

  const receive = async (code) => {
    const data = await post('/api/lab/referrals/receive', { code, condition: condition.trim() || undefined });
    if (data) setScan('');
  };

  const cancel = async (r) => {
    if (!window.confirm(`Recall sample ${r.sample_id.slice(-4)} from ${place(r.to_facility, r.to_lab)}?`)) return;
    post(`/api/lab/referrals/${r.id}/cancel`, {});
  };

  const destLabs = facilities.find((h) => String(h.id) === String(form.to_branch_id))?.labs || [];

  const inTransitIn = incoming.filter((r) => r.status === 'In Transit').length;
  const statusCls = (s) => `sr-status sr-status-${s.toLowerCase().replace(' ', '-')}`;

  return (
    <div className="qm-page sr-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={3500} />}
      <div className="qm-header">
        <div>
          <h1>Sample Referrals</h1>
          <p>Move samples between labs in this hospital, or refer them to another hospital. The barcode stays the same throughout, so the custody trail and results follow the sample.</p>
        </div>
        <button className="qm-btn qm-btn-ghost" onClick={load}><RefreshCw size={14} />Refresh</button>
      </div>

      <div className="qm-tabs sr-tabs">
        <button className={`qm-tab${tab === 'out' ? ' active' : ''}`} onClick={() => setTab('out')}>Outgoing</button>
        <button className={`qm-tab${tab === 'in' ? ' active' : ''}`} onClick={() => setTab('in')}>
          Incoming{inTransitIn > 0 && <span className="sr-badge">{inTransitIn}</span>}
        </button>
      </div>

      {tab === 'out' && (
        <>
          <form className="qm-card sr-form" onSubmit={dispatch}>
            <h3>Transfer a sample</h3>
            <div className="sr-modes">
              {[['labs', 'Between labs', 'Another lab in this hospital'], ['hospitals', 'Between hospitals', 'Refer to another hospital']].map(([k, l, d]) => (
                <button type="button" key={k} className={form.mode === k ? 'active' : ''} onClick={() => setForm({ ...form, mode: k, to_lab_id: '', to_branch_id: '' })}><b>{l}</b><span>{d}</span></button>
              ))}
            </div>
            <div className="sr-grid">
              <label>Sample barcode<input className="qm-input" required placeholder="Scan or enter Sample ID / last 4 digits" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
              {form.mode === 'labs' ? (
                <label>Transfer to lab
                  <select className="qm-input" required value={form.to_lab_id} onChange={(e) => setForm({ ...form, to_lab_id: e.target.value })}>
                    <option value="">Select lab…</option>
                    {ownLabs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
              ) : (
                <>
                  <label>Refer to hospital
                    <select className="qm-input" required value={form.to_branch_id} onChange={(e) => setForm({ ...form, to_branch_id: e.target.value, to_lab_id: '' })}>
                      <option value="">Select hospital…</option>
                      {facilities.map((f) => <option key={f.id} value={f.id}>{f.branch_name} ({f.hospital_code})</option>)}
                    </select>
                  </label>
                  <label>Lab at that hospital (optional)
                    <select className="qm-input" value={form.to_lab_id} disabled={!form.to_branch_id} onChange={(e) => setForm({ ...form, to_lab_id: e.target.value })}>
                      <option value="">Any lab</option>
                      {destLabs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </label>
                </>
              )}
              <label>Reason
                <select className="qm-input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
              </label>
              {form.reason === 'Other' && <label>Specify reason<input className="qm-input" required maxLength={150} value={form.other} onChange={(e) => setForm({ ...form, other: e.target.value })} /></label>}
              {tickets.length > 0 && (
                <label>Because of an analyzer breakdown? <span style={{ color: '#64748b' }}>(optional)</span>
                  <select className="qm-input" value={form.ticket_id} onChange={(e) => setForm({ ...form, ticket_id: e.target.value })}>
                    <option value="">No</option>
                    {tickets.map((t) => <option key={t.id} value={t.id}>{t.ticket_no} — {t.machine_name} ({t.category})</option>)}
                  </select>
                </label>
              )}
              {form.mode === 'hospitals' && <label>Courier / consignment ref<input className="qm-input" maxLength={80} value={form.consignment_ref} onChange={(e) => setForm({ ...form, consignment_ref: e.target.value })} /></label>}
              <label>Handling remarks<input className="qm-input" maxLength={255} placeholder="e.g. keep at 2–8 °C" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></label>
            </div>
            <div className="sr-form-actions"><button className="qm-btn qm-btn-primary" disabled={busy}><Send size={14} />{form.mode === 'labs' ? 'Transfer sample' : 'Dispatch sample'}</button></div>
          </form>

          <div className="qm-card">
            <div className="sr-card-title">Sent from this hospital</div>
            <div className="qm-table-wrap">
              <table className="qm-table">
                <thead><tr><th>Sample</th><th>Patient</th><th>Type</th><th>To</th><th>Tests</th><th>Reason</th><th>Dispatched</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={9} className="qm-empty">Loading…</td></tr>}
                  {!loading && out.length === 0 && <tr><td colSpan={9} className="qm-empty">No referrals sent today.</td></tr>}
                  {out.map((r) => (
                    <tr key={r.id}>
                      <td className="sr-mono">{r.sample_id}</td>
                      <td><div className="qm-patient">{r.patient_name}</div><div className="qm-sub">{r.reg_no}</div></td>
                      <td>{r.transfer_type}</td><td>{place(r.to_facility, r.to_lab)}</td><td>{r.tests}</td><td>{r.reason}</td><td>{fmt(r.dispatched_at)}</td>
                      <td><span className={statusCls(r.status)}>{r.status}</span>{r.received_at && <div className="qm-sub">{fmt(r.received_at)}</div>}</td>
                      <td><div className="qm-actions">
                        <button className="qm-btn qm-btn-ghost" onClick={() => printDispatchNote([r])}><Printer size={13} />Note</button>
                        {r.status === 'In Transit' && <button className="qm-btn qm-btn-ghost" onClick={() => cancel(r)}><Undo2 size={13} />Recall</button>}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'in' && (
        <>
          <div className="qm-card sr-form">
            <h3>Receive a transferred sample</h3>
            <div className="sr-receive">
              <div className="sr-scan"><ScanLine size={17} />
                <input placeholder="Scan the barcode on the tube" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && scan.trim()) receive(scan.trim()); }} />
              </div>
              <input className="qm-input sr-cond" maxLength={160} placeholder="Condition on arrival (optional)" value={condition} onChange={(e) => setCondition(e.target.value)} />
              <button className="qm-btn qm-btn-primary" disabled={busy || !scan.trim()} onClick={() => receive(scan.trim())}><PackageCheck size={14} />Receive</button>
            </div>
          </div>

          <div className="qm-card">
            <div className="sr-card-title">Sent to this hospital or lab</div>
            <div className="qm-table-wrap">
              <table className="qm-table">
                <thead><tr><th>Sample</th><th>Patient</th><th>Type</th><th>From</th><th>Tests</th><th>Reason</th><th>Ref</th><th>Dispatched</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={9} className="qm-empty">Loading…</td></tr>}
                  {!loading && incoming.length === 0 && <tr><td colSpan={9} className="qm-empty">Nothing transferred to this hospital.</td></tr>}
                  {incoming.map((r) => (
                    <tr key={r.id}>
                      <td className="sr-mono">{r.sample_id}</td>
                      <td><div className="qm-patient">{r.patient_name}</div><div className="qm-sub">{r.reg_no}</div></td>
                      <td>{r.transfer_type}</td><td>{place(r.from_facility, r.from_lab)}</td><td>{r.tests}</td><td>{r.reason}</td><td>{r.consignment_ref || '—'}</td><td>{fmt(r.dispatched_at)}</td>
                      <td><span className={statusCls(r.status)}>{r.status}</span>{r.receipt_condition && <div className="qm-sub">{r.receipt_condition}</div>}</td>
                      <td>{r.status === 'In Transit' && <button className="qm-btn qm-btn-success" disabled={busy} onClick={() => receive(r.sample_id)}><PackageCheck size={13} />Receive</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
