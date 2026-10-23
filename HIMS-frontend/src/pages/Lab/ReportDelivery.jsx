import { useState, useEffect, useCallback } from 'react';
import '../../assets/CSS/Governance.css';
import { api, fmtDT, daysAgo, ymd, saveCsv, role } from '../../utils/govApi';

const STATUSES = ['Queued', 'Sent', 'Delivered', 'Read', 'Failed', 'Blocked'];
const BADGE = { Queued: '', Sent: 'info', Delivered: 'ok', Read: 'ok', Failed: 'bad', Blocked: 'warn' };
const CHANNELS = ['WhatsApp', 'Email', 'Kiosk view', 'Kiosk print', 'Portal download', 'HMIS push'];
const canSend = () => role() !== 'auditor';

// Every attempt to put an authorised report in front of a patient or
// clinician (tender #42-45, #51-52): WhatsApp and e-mail sends with their
// delivery status, kiosk views and prints, portal downloads. Failed sends can
// be resent; reports can be sent by e-mail; consent is recorded here.
export default function ReportDelivery() {
  const [f, setF] = useState({ from: daysAgo(6), to: ymd(), status: '', channel: '', q: '' });
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);
  const [sending, setSending] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api(`/api/report-delivery?${qs}`).then((d) => (d.success ? setData(d) : setMsg({ ok: false, text: d.message })));
  }, [f]);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const resend = async (row) => {
    setBusy(row.id);
    const d = await api(`/api/report-delivery/${row.id}/resend`, { method: 'POST' });
    setBusy(null);
    setMsg({ ok: d.success, text: d.message });
    load();
  };

  const s = data?.summary || {};
  const total = Object.values(s).reduce((a, n) => a + n, 0);
  const resendable = (r) => ['WhatsApp', 'Email'].includes(r.channel) && !String(r.recipient || '').startsWith('Doctor') && ['Failed', 'Queued'].includes(r.status);

  return (
    <div className="gv-page">
      <div className="gv-head">
        <div>
          <h1>Report Delivery</h1>
          <p>Reports go only to the mobile number or e-mail registered on the patient record, and never to a patient who has opted out of digital delivery. Failed deliveries stay here until resent.</p>
        </div>
        <div className="gv-actions">
          {canSend() && <button className="gv-btn" onClick={() => setSending({ sample_id: '' })}>Send a report</button>}
          <button className="gv-btn ghost" onClick={() => saveCsv(`report-deliveries-${f.from}-to-${f.to}.csv`, data?.deliveries || [], [
            ['When', (r) => r.created_at], ['Sample', (r) => r.sample_id], ['Patient', (r) => r.patient_name], ['UHID', (r) => r.reg_no], ['Channel', (r) => r.channel],
            ['Recipient', (r) => r.recipient], ['Status', (r) => r.status], ['Error', (r) => r.error], ['Triggered by', (r) => r.triggered_by], ['Staff', (r) => r.actor_name]])}>Export CSV</button>
        </div>
      </div>

      <div className="gv-kpis">
        <button className="gv-kpi" onClick={() => setF({ ...f, status: '' })}><b>{total}</b><span>All attempts</span></button>
        {STATUSES.filter((st) => st !== 'Queued').map((st) => (
          <button key={st} className={`gv-kpi ${st === 'Failed' && s.Failed ? 'bad' : st === 'Blocked' && s.Blocked ? 'warn' : ''}`} onClick={() => setF({ ...f, status: st })}>
            <b>{s[st] || 0}</b><span>{st}</span>
          </button>
        ))}
      </div>

      <div className="gv-filters">
        <label>From<input type="date" value={f.from} onChange={set('from')} /></label>
        <label>To<input type="date" value={f.to} onChange={set('to')} /></label>
        <label>Status<select value={f.status} onChange={set('status')}><option value="">All</option>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Channel<select value={f.channel} onChange={set('channel')}><option value="">All</option>{CHANNELS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Search<input value={f.q} onChange={set('q')} placeholder="Sample ID, UHID or name" /></label>
      </div>
      {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}

      <div className="gv-table-wrap">
        <table className="gv-table">
          <thead><tr><th>When</th><th>Patient / sample</th><th>Channel</th><th>Recipient</th><th>Status</th><th>By</th><th /></tr></thead>
          <tbody>
            {!data && <tr><td colSpan={7} className="gv-empty">Loading…</td></tr>}
            {data?.deliveries.length === 0 && <tr><td colSpan={7} className="gv-empty">No deliveries match these filters.</td></tr>}
            {(data?.deliveries || []).map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDT(r.created_at)}{r.resend_of ? <div className="gv-sub">resend of #{r.resend_of}</div> : null}</td>
                <td>{r.patient_name || '—'}<div className="gv-sub">{r.reg_no || ''} · <span className="gv-mono">{r.sample_id}</span></div>
                  {r.report_consent === 0 && <span className="gv-badge warn">opted out</span>}</td>
                <td>{r.channel}</td>
                <td className="gv-mono">{r.recipient || '—'}</td>
                <td><span className={`gv-badge ${BADGE[r.status]}`}>{r.status}</span>{r.error ? <div className="gv-sub" style={{ color: '#b91c1c', maxWidth: 260 }}>{r.error}</div> : null}
                  {Number(r.resend_count) ? <div className="gv-sub">resent {r.resend_count}×</div> : null}</td>
                <td>{r.actor_name || r.triggered_by}<div className="gv-sub">{r.actor_name ? r.triggered_by : ''}</div></td>
                <td>{canSend() && resendable(r) && <button className="gv-btn sm" disabled={busy === r.id} onClick={() => resend(r)}>{busy === r.id ? 'Sending…' : 'Resend'}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sending && <SendModal onClose={() => setSending(null)} onDone={(d) => { setMsg({ ok: d.success, text: d.message }); load(); }} />}
    </div>
  );
}

function SendModal({ onClose, onDone }) {
  const [sampleId, setSampleId] = useState('');
  const [patient, setPatient] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const lookup = async () => {
    setErr(''); setPatient(null);
    const d = await api(`/api/report-delivery/consent/${encodeURIComponent(sampleId.trim())}`);
    if (d.success) setPatient(d.patient); else setErr(d.message);
  };
  const setConsent = async (consent) => {
    const d = await api(`/api/report-delivery/consent/${patient.id}`, { method: 'PUT', body: { consent } });
    if (d.success) setPatient({ ...patient, report_consent: consent ? 1 : 0 }); else setErr(d.message);
  };
  const send = async (channel) => {
    setBusy(true); setErr('');
    const d = await api('/api/report-delivery/send', { method: 'POST', body: { sample_id: sampleId.trim(), channel } });
    setBusy(false);
    if (d.success) { onDone(d); onClose(); } else { setErr(d.message); onDone(d); }
  };
  const optedOut = patient?.report_consent === 0;

  return (
    <div className="gv-overlay" onClick={onClose}>
      <div className="gv-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Send an authorised report</h2>
        <div className="gv-sub">Sent to the contact registered for the patient — it cannot be typed in here.</div>
        <div className="gv-form">
          <label className="full">Sample ID<div style={{ display: 'flex', gap: 8 }}>
            <input style={{ flex: 1 }} value={sampleId} autoFocus onChange={(e) => setSampleId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} placeholder="Scan or type the sample barcode" />
            <button className="gv-btn ghost" onClick={lookup} disabled={!sampleId.trim()}>Find</button></div></label>
        </div>
        {patient && (
          <div className="gv-card">
            <b>{patient.name}</b> <span className="gv-sub">{patient.reg_no}</span>
            <table className="gv-table" style={{ marginTop: 8 }}><tbody>
              <tr><td>Mobile (WhatsApp)</td><td className="gv-mono">{patient.phone || <span className="gv-sub">not registered</span>}</td></tr>
              <tr><td>E-mail</td><td className="gv-mono">{patient.email || <span className="gv-sub">not registered</span>}</td></tr>
              <tr><td>Digital delivery consent</td><td>
                <span className={`gv-badge ${optedOut ? 'warn' : patient.report_consent === 1 ? 'ok' : ''}`}>{optedOut ? 'Opted out' : patient.report_consent === 1 ? 'Agreed' : 'Not recorded'}</span>{' '}
                <button className="gv-btn sm ghost" onClick={() => setConsent(optedOut)}>{optedOut ? 'Record agreement' : 'Record opt-out'}</button>
              </td></tr>
            </tbody></table>
          </div>
        )}
        {err && <div className="gv-msg bad">{err}</div>}
        <div className="gv-modal-actions">
          <button className="gv-btn ghost" onClick={onClose}>Close</button>
          <button className="gv-btn" disabled={!patient || busy || optedOut || !patient.email} onClick={() => send('Email')}>Send by e-mail</button>
          <button className="gv-btn" disabled={!patient || busy || optedOut || !patient.phone} onClick={() => send('WhatsApp')}>Send on WhatsApp</button>
        </div>
      </div>
    </div>
  );
}
