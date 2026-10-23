import { useState, useEffect, useCallback } from 'react';
import '../../assets/CSS/Governance.css';
import { api, fmtDT } from '../../utils/govApi';

const COMPONENTS = ['Whole Blood', 'PRBC', 'FFP', 'Platelets', 'Cryoprecipitate', 'Plasma'];
const GROUPS = [['A', 'Pos'], ['A', 'Neg'], ['B', 'Pos'], ['B', 'Neg'], ['AB', 'Pos'], ['AB', 'Neg'], ['O', 'Pos'], ['O', 'Neg']];
const TABS = [['overview', 'Overview'], ['requests', 'Requests & issue'], ['units', 'Units'], ['donors', 'Donors & donations'], ['issued', 'Issued / reactions']];
const grp = (a, r) => `${a}${r === 'Pos' ? '+' : r === 'Neg' ? '−' : '?'}`;
const TTI = [['hiv', 'HIV'], ['hbv', 'HBsAg (HBV)'], ['hcv', 'HCV'], ['syphilis', 'Syphilis'], ['malaria', 'Malaria']];
const badge = (s) => ({ Available: 'ok', Quarantine: 'warn', Reserved: 'warn', Issued: '', Used: '', Discarded: 'bad', Expired: 'bad', Cleared: 'ok', Reactive: 'bad', Pending: 'warn' }[s] || '');

// Blood bank (tender #123): stock, donors and donations, screening, components, requests and
// compatibility-checked issue, outcome and transfusion reactions.
export default function BloodBank() {
  const [tab, setTab] = useState('overview');
  const [msg, setMsg] = useState(null);
  const note = (r, okText) => setMsg({ ok: r.success, text: r.success ? (r.message || okText || 'Saved.') : [r.message, ...(r.problems || [])].join(' ') });

  return (
    <div className="gv-page">
      <div className="gv-head"><div><h1>Blood Bank</h1>
        <p>Donors and donations, mandatory infection screening, components, stock, requests and issue. A unit can only be issued when screening is complete and its group is compatible with the patient.</p></div></div>
      <div className="gv-tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => { setTab(k); setMsg(null); }}>{l}</button>)}</div>
      {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
      {tab === 'overview' && <Overview />}
      {tab === 'requests' && <Requests note={note} />}
      {tab === 'units' && <Units note={note} />}
      {tab === 'donors' && <Donors note={note} />}
      {tab === 'issued' && <Issued note={note} />}
    </div>
  );
}

function Overview() {
  const [d, setD] = useState(null);
  useEffect(() => { api('/api/blood-bank/summary').then((r) => r.success && setD(r)); }, []);
  if (!d) return <div className="gv-empty">Loading…</div>;
  const n = (c, a, r) => d.stock.filter((s) => s.component === c && s.abo === a && s.rh === r).reduce((x, s) => x + Number(s.n), 0);
  return (
    <>
      <div className="gv-kpis">
        <div className="gv-kpi"><b>{d.donations_this_month}</b><span>Donations this month</span></div>
        <div className={`gv-kpi ${d.quarantine ? 'warn' : ''}`}><b>{d.quarantine}</b><span>In quarantine</span><small>awaiting screening</small></div>
        <div className={`gv-kpi ${d.near_expiry ? 'warn' : ''}`}><b>{d.near_expiry}</b><span>Expiring in 3 days</span></div>
        <div className={`gv-kpi ${d.emergency ? 'bad' : ''}`}><b>{d.open_requests}</b><span>Open requests</span><small>{d.emergency} emergency</small></div>
      </div>
      <div className="gv-card"><h3>Stock available for issue</h3>
        <table className="gv-table"><thead><tr><th>Component</th>{GROUPS.map(([a, r]) => <th key={a + r} className="num">{grp(a, r)}</th>)}</tr></thead>
          <tbody>{COMPONENTS.map((c) => <tr key={c}><td>{c}</td>{GROUPS.map(([a, r]) => { const v = n(c, a, r); return <td key={a + r} className="num" style={{ color: v === 0 ? '#cbd5e1' : undefined, fontWeight: v ? 700 : 400 }}>{v}</td>; })}</tr>)}</tbody></table>
      </div>
    </>
  );
}

function Donors({ note }) {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const [don, setDon] = useState(null);
  const load = useCallback(() => api(`/api/blood-bank/donors?q=${encodeURIComponent(q)}`).then((r) => r.success && setRows(r.donors)), [q]);
  useEffect(() => { load(); }, [load]);
  const save = async (e) => { e.preventDefault(); const r = await api('/api/blood-bank/donors', { method: 'POST', body: form }); note(r, 'Donor registered.'); if (r.success) { setForm(null); load(); } };
  const donate = async (e) => { e.preventDefault(); const r = await api('/api/blood-bank/donations', { method: 'POST', body: don }); note(r); if (r.success) { setDon(null); load(); } };
  const defer = async (d) => {
    const until = window.prompt('Defer until (YYYY-MM-DD):'); if (!until) return;
    const reason = window.prompt('Reason:'); if (!reason) return;
    note(await api(`/api/blood-bank/donors/${d.id}/defer`, { method: 'POST', body: { until, reason } }), 'Donor deferred.'); load();
  };
  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const g = (k) => (e) => setDon({ ...don, [k]: e.target.value });
  return (
    <>
      <div className="gv-filters"><label>Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Donor no., name or phone" /></label>
        <button className="gv-btn" onClick={() => setForm({ gender: 'Male', abo: 'Unknown', rh: 'Unknown' })}>Register donor</button></div>
      {form && (
        <form className="gv-card" onSubmit={save}><h3>New donor</h3>
          <div className="gv-filters">
            <label>First name<input value={form.first_name || ''} onChange={f('first_name')} required /></label>
            <label>Last name<input value={form.last_name || ''} onChange={f('last_name')} /></label>
            <label>Gender<select value={form.gender} onChange={f('gender')}><option>Male</option><option>Female</option><option>Other</option></select></label>
            <label>Date of birth<input type="date" value={form.dob || ''} onChange={f('dob')} required /></label>
            <label>Mobile<input value={form.phone || ''} onChange={f('phone')} /></label>
            <label>ABO<select value={form.abo} onChange={f('abo')}><option>Unknown</option><option>A</option><option>B</option><option>AB</option><option>O</option></select></label>
            <label>Rh<select value={form.rh} onChange={f('rh')}><option>Unknown</option><option>Pos</option><option>Neg</option></select></label>
          </div>
          <div className="gv-actions"><button className="gv-btn" type="submit">Save</button><button type="button" className="gv-btn ghost" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}
      {don && (
        <form className="gv-card" onSubmit={donate}><h3>Record donation — {don.name}</h3>
          <div className="gv-sub">Donor selection check: age 18–65, Hb ≥ 12.5 g/dL, weight ≥ 45 kg, BP 100–180 / 50–100, pulse 50–100, and at least 90 days (men) / 120 days (women) since the last donation.</div>
          <div className="gv-filters">
            <label>Haemoglobin (g/dL)<input type="number" step="0.1" value={don.hb || ''} onChange={g('hb')} required /></label>
            <label>Weight (kg)<input type="number" step="0.1" value={don.weight || ''} onChange={g('weight')} required /></label>
            <label>BP systolic<input type="number" value={don.systolic || ''} onChange={g('systolic')} required /></label>
            <label>BP diastolic<input type="number" value={don.diastolic || ''} onChange={g('diastolic')} required /></label>
            <label>Pulse<input type="number" value={don.pulse || ''} onChange={g('pulse')} required /></label>
            <label>Volume (mL)<input type="number" value={don.volume_ml || 450} onChange={g('volume_ml')} /></label>
          </div>
          <div className="gv-actions"><button className="gv-btn" type="submit">Collect and create unit</button><button type="button" className="gv-btn ghost" onClick={() => setDon(null)}>Cancel</button></div>
        </form>
      )}
      <div className="gv-card">
        {rows.length === 0 ? <div className="gv-empty">No donors.</div> : (
          <table className="gv-table"><thead><tr><th>Donor</th><th>Group</th><th>Mobile</th><th>Last donation</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((d) => { const deferred = d.deferred_until && new Date(d.deferred_until) > new Date(); return (
              <tr key={d.id}><td><b>{d.first_name} {d.last_name}</b><div className="gv-sub">{d.donor_no}</div></td><td>{grp(d.abo, d.rh)}</td><td>{d.phone || '—'}</td><td>{d.last_donation_date ? String(d.last_donation_date).slice(0, 10) : '—'}</td>
                <td>{deferred ? <span className="gv-badge bad" title={d.deferral_reason}>Deferred to {String(d.deferred_until).slice(0, 10)}</span> : <span className="gv-badge ok">Eligible to screen</span>}</td>
                <td className="num"><button className="gv-btn sm" onClick={() => setDon({ donor_id: d.id, name: `${d.first_name} ${d.last_name || ''}` })} disabled={deferred}>Donation</button>{' '}
                  <button className="gv-btn sm ghost" onClick={() => defer(d)}>Defer</button></td></tr>); })}</tbody></table>
        )}
      </div>
    </>
  );
}

function Units({ note }) {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ status: '', component: '', q: '' });
  const [scr, setScr] = useState(null);
  const [proc, setProc] = useState(null);
  const load = useCallback(() => api(`/api/blood-bank/units?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`).then((r) => r.success && setRows(r.units)), [f]);
  useEffect(() => { load(); }, [load]);
  const saveScr = async (e) => { e.preventDefault(); const r = await api(`/api/blood-bank/units/${scr.id}/screening`, { method: 'POST', body: scr }); note(r); if (r.success) { setScr(null); load(); } };
  const doProc = async () => { const r = await api(`/api/blood-bank/units/${proc.id}/process`, { method: 'POST', body: { components: proc.pick } }); note(r, 'Components prepared.'); if (r.success) { setProc(null); load(); } };
  const discard = async (u) => { const reason = window.prompt(`Discard ${u.unit_no}. Reason:`); if (!reason) return; note(await api(`/api/blood-bank/units/${u.id}/discard`, { method: 'POST', body: { reason } }), 'Discarded.'); load(); };
  return (
    <>
      <div className="gv-filters">
        <label>Status<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All</option>{['Quarantine', 'Available', 'Reserved', 'Issued', 'Used', 'Discarded', 'Expired'].map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Component<select value={f.component} onChange={(e) => setF({ ...f, component: e.target.value })}><option value="">All</option>{COMPONENTS.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Unit no.<input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></label>
      </div>
      {scr && (
        <form className="gv-card" onSubmit={saveScr}><h3>Screening — {scr.unit_no}</h3>
          <div className="gv-sub">All five tests are required before a unit is released; any reactive result discards the donation and its components and defers the donor.</div>
          <div className="gv-filters">
            {TTI.map(([k, l]) => <label key={k}>{l}<select value={scr[k] || ''} onChange={(e) => setScr({ ...scr, [k]: e.target.value })}><option value="">Pending</option><option>Non-reactive</option><option>Reactive</option></select></label>)}
            <label>ABO<select value={scr.abo} onChange={(e) => setScr({ ...scr, abo: e.target.value })}>{['Unknown', 'A', 'B', 'AB', 'O'].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>Rh<select value={scr.rh} onChange={(e) => setScr({ ...scr, rh: e.target.value })}>{['Unknown', 'Pos', 'Neg'].map((s) => <option key={s}>{s}</option>)}</select></label>
          </div>
          <div className="gv-actions"><button className="gv-btn" type="submit">Save screening</button><button type="button" className="gv-btn ghost" onClick={() => setScr(null)}>Cancel</button></div>
        </form>
      )}
      {proc && (
        <div className="gv-card"><h3>Prepare components from {proc.unit_no}</h3>
          <div className="gv-filters">{['PRBC', 'FFP', 'Platelets', 'Cryoprecipitate'].map((c) => (
            <label key={c} style={{ flexDirection: 'row', gap: 6 }}><input type="checkbox" checked={proc.pick.includes(c)} onChange={(e) => setProc({ ...proc, pick: e.target.checked ? [...proc.pick, c] : proc.pick.filter((x) => x !== c) })} /> {c}</label>))}</div>
          <div className="gv-actions"><button className="gv-btn" onClick={doProc} disabled={!proc.pick.length}>Prepare</button><button className="gv-btn ghost" onClick={() => setProc(null)}>Cancel</button></div>
        </div>
      )}
      <div className="gv-card">
        {rows.length === 0 ? <div className="gv-empty">No units.</div> : (
          <table className="gv-table"><thead><tr><th>Unit</th><th>Component</th><th>Group</th><th>Collected</th><th>Expires</th><th>Screening</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((u) => (
              <tr key={u.id}><td><b>{u.unit_no}</b>{u.donor_no && <div className="gv-sub">{u.donor_no}</div>}</td><td>{u.component}</td><td>{grp(u.abo, u.rh)}</td><td>{fmtDT(u.collected_at)}</td><td>{fmtDT(u.expires_at)}</td>
                <td><span className={`gv-badge ${badge(u.tti_status)}`}>{u.tti_status}</span></td>
                <td><span className={`gv-badge ${badge(u.status)}`}>{u.status}</span>{u.discard_reason && <div className="gv-sub">{u.discard_reason}</div>}</td>
                <td className="num">
                  {!u.parent_unit_id && !['Discarded', 'Expired'].includes(u.status) && <button className="gv-btn sm" onClick={() => setScr({ id: u.id, unit_no: u.unit_no, abo: u.abo, rh: u.rh, ...(u.tti_json || {}) })}>Screening</button>}{' '}
                  {u.component === 'Whole Blood' && ['Quarantine', 'Available'].includes(u.status) && <button className="gv-btn sm ghost" onClick={() => setProc({ id: u.id, unit_no: u.unit_no, pick: ['PRBC', 'FFP'] })}>Components</button>}{' '}
                  {['Quarantine', 'Available', 'Reserved'].includes(u.status) && <button className="gv-btn sm ghost" onClick={() => discard(u)}>Discard</button>}
                </td></tr>))}</tbody></table>
        )}
      </div>
    </>
  );
}

function Requests({ note }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(null);
  const [issue, setIssue] = useState(null);
  const load = useCallback(() => api('/api/blood-bank/requests').then((r) => r.success && setRows(r.requests)), []);
  useEffect(() => { load(); }, [load]);
  const save = async (e) => { e.preventDefault(); const r = await api('/api/blood-bank/requests', { method: 'POST', body: form }); note(r, 'Request recorded.'); if (r.success) { setForm(null); load(); } };
  const open = async (rq) => { const r = await api(`/api/blood-bank/requests/${rq.id}/units`); setIssue({ rq, units: r.units || [], known: r.recipient_group_known, crossmatch: 'Compatible', unit_id: '', issued_to: '', override_reason: '' }); };
  const doIssue = async (e) => {
    e.preventDefault();
    const r = await api(`/api/blood-bank/requests/${issue.rq.id}/issue`, { method: 'POST', body: { unit_id: issue.unit_id, crossmatch: issue.crossmatch, issued_to: issue.issued_to, override_reason: issue.override_reason } });
    note({ ...r, message: r.success ? `${r.message}${r.warnings?.length ? ` Note: ${r.warnings.join(' ')}` : ''}` : r.message });
    if (r.success) { setIssue(null); load(); }
  };
  const cancel = async (rq) => { if (!window.confirm('Cancel this request?')) return; note(await api(`/api/blood-bank/requests/${rq.id}/cancel`, { method: 'POST' }), 'Cancelled.'); load(); };
  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <>
      <div className="gv-actions" style={{ marginBottom: 10 }}><button className="gv-btn" onClick={() => setForm({ component: 'PRBC', units_requested: 1, urgency: 'Routine', patient_abo: 'Unknown', patient_rh: 'Unknown' })}>New request</button></div>
      {form && (
        <form className="gv-card" onSubmit={save}><h3>New blood request</h3>
          <div className="gv-filters">
            <label>Patient name<input value={form.patient_name || ''} onChange={f('patient_name')} required /></label>
            <label>Ward<input value={form.ward || ''} onChange={f('ward')} /></label>
            <label>Requesting clinician<input value={form.clinician || ''} onChange={f('clinician')} /></label>
            <label>Patient ABO (grouped by lab)<select value={form.patient_abo} onChange={f('patient_abo')}>{['Unknown', 'A', 'B', 'AB', 'O'].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>Patient Rh<select value={form.patient_rh} onChange={f('patient_rh')}>{['Unknown', 'Pos', 'Neg'].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>Component<select value={form.component} onChange={f('component')}>{COMPONENTS.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>Units<input type="number" min="1" max="10" value={form.units_requested} onChange={f('units_requested')} /></label>
            <label>Urgency<select value={form.urgency} onChange={f('urgency')}><option>Routine</option><option>Urgent</option><option>Emergency</option></select></label>
            <label>Indication<input value={form.indication || ''} onChange={f('indication')} /></label>
          </div>
          <div className="gv-actions"><button className="gv-btn" type="submit">Save request</button><button type="button" className="gv-btn ghost" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}
      {issue && (
        <form className="gv-card" onSubmit={doIssue}><h3>Issue for {issue.rq.patient_name} — {issue.rq.component} ({grp(issue.rq.patient_abo, issue.rq.patient_rh)})</h3>
          {!issue.known && <div className="gv-msg bad">The patient's blood group is not recorded, so no unit can be matched. Group the patient first. In an emergency, record the request as Emergency, choose "Not done (emergency)" and give a reason to release O-negative red cells.</div>}
          <div className="gv-filters">
            <label>Unit (compatible, earliest expiry first)<select value={issue.unit_id} onChange={(e) => setIssue({ ...issue, unit_id: e.target.value })} required>
              <option value="">Choose…</option>{issue.units.map((u) => <option key={u.id} value={u.id}>{u.unit_no} · {grp(u.abo, u.rh)} · {u.compat.level}{u.compat.warnings.length ? ' ⚠' : ''} · exp {String(u.expires_at).slice(0, 10)}</option>)}</select></label>
            <label>Cross-match<select value={issue.crossmatch} onChange={(e) => setIssue({ ...issue, crossmatch: e.target.value })}><option>Compatible</option><option>Not done (emergency)</option></select></label>
            <label>Issued to<input value={issue.issued_to} onChange={(e) => setIssue({ ...issue, issued_to: e.target.value })} placeholder="Name of person collecting" /></label>
            {issue.crossmatch !== 'Compatible' && <label>Reason (required)<input value={issue.override_reason} onChange={(e) => setIssue({ ...issue, override_reason: e.target.value })} /></label>}
          </div>
          <div className="gv-actions"><button className="gv-btn" type="submit" disabled={!issue.unit_id && issue.crossmatch === 'Compatible'}>Issue</button><button type="button" className="gv-btn ghost" onClick={() => setIssue(null)}>Cancel</button></div>
        </form>
      )}
      <div className="gv-card">
        {rows.length === 0 ? <div className="gv-empty">No requests.</div> : (
          <table className="gv-table"><thead><tr><th>Request</th><th>Patient</th><th>Needs</th><th>Urgency</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td><b>{r.request_no}</b><div className="gv-sub">{fmtDT(r.created_at)}</div></td><td>{r.patient_name}<div className="gv-sub">{grp(r.patient_abo, r.patient_rh)} · {r.ward || '—'}</div></td>
                <td>{r.units_requested} × {r.component}<div className="gv-sub">{r.issued_units} issued</div></td>
                <td><span className={`gv-badge ${r.urgency === 'Emergency' ? 'bad' : r.urgency === 'Urgent' ? 'warn' : ''}`}>{r.urgency}</span></td><td>{r.status}</td>
                <td className="num">{['Requested', 'Ready', 'Partly issued'].includes(r.status) && <button className="gv-btn sm" onClick={() => open(r)}>Issue</button>}{' '}
                  {['Requested', 'Ready'].includes(r.status) && <button className="gv-btn sm ghost" onClick={() => cancel(r)}>Cancel</button>}</td></tr>))}</tbody></table>
        )}
      </div>
    </>
  );
}

function Issued({ note }) {
  const [rows, setRows] = useState([]);
  const [react, setReact] = useState(null);
  const [reactions, setReactions] = useState([]);
  const load = useCallback(() => {
    api('/api/blood-bank/issues').then((r) => r.success && setRows(r.issues));
    api('/api/blood-bank/reactions').then((r) => r.success && setReactions(r.reactions));
  }, []);
  useEffect(() => { load(); }, [load]);
  const out = async (i, outcome) => { note(await api(`/api/blood-bank/issues/${i.id}/outcome`, { method: 'POST', body: { outcome } }), 'Saved.'); load(); };
  const saveR = async (e) => { e.preventDefault(); const r = await api('/api/blood-bank/reactions', { method: 'POST', body: react }); note(r, 'Reaction recorded.'); if (r.success) { setReact(null); load(); } };
  return (
    <>
      {react && (
        <form className="gv-card" onSubmit={saveR}><h3>Transfusion reaction — {react.unit_no}</h3>
          <div className="gv-filters">
            <label>Type<input value={react.reaction_type || ''} onChange={(e) => setReact({ ...react, reaction_type: e.target.value })} placeholder="Febrile, allergic, haemolytic…" required /></label>
            <label>Severity<select value={react.severity || ''} onChange={(e) => setReact({ ...react, severity: e.target.value })} required><option value="">Choose…</option>{['Mild', 'Moderate', 'Severe', 'Fatal'].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>Details<input value={react.details || ''} onChange={(e) => setReact({ ...react, details: e.target.value })} /></label>
          </div>
          <div className="gv-actions"><button className="gv-btn" type="submit">Save</button><button type="button" className="gv-btn ghost" onClick={() => setReact(null)}>Cancel</button></div>
        </form>
      )}
      <div className="gv-card"><h3>Issued units</h3>
        {rows.length === 0 ? <div className="gv-empty">Nothing issued yet.</div> : (
          <table className="gv-table"><thead><tr><th>Unit</th><th>Patient</th><th>Issued</th><th>Cross-match</th><th>Outcome</th><th /></tr></thead>
            <tbody>{rows.map((i) => (
              <tr key={i.id}><td><b>{i.unit_no}</b><div className="gv-sub">{i.component} · {grp(i.abo, i.rh)}</div></td><td>{i.patient_name}<div className="gv-sub">{i.request_no}</div></td><td>{fmtDT(i.issued_at)}</td>
                <td>{i.crossmatch}{i.override_reason && <div className="gv-sub">{i.override_reason}</div>}</td><td>{i.outcome}{i.notes && <div className="gv-sub">{i.notes}</div>}</td>
                <td className="num">{i.outcome === 'Issued' && <><button className="gv-btn sm" onClick={() => out(i, 'Transfused')}>Transfused</button>{' '}<button className="gv-btn sm ghost" onClick={() => out(i, 'Returned')}>Returned</button>{' '}<button className="gv-btn sm ghost" onClick={() => out(i, 'Wasted')}>Wasted</button>{' '}</>}
                  <button className="gv-btn sm ghost" onClick={() => setReact({ issue_id: i.id, unit_no: i.unit_no })}>Reaction</button></td></tr>))}</tbody></table>
        )}
      </div>
      {reactions.length > 0 && (
        <div className="gv-card"><h3>Reported reactions</h3>
          <table className="gv-table"><thead><tr><th>When</th><th>Unit</th><th>Patient</th><th>Reaction</th><th>Severity</th></tr></thead>
            <tbody>{reactions.map((x) => <tr key={x.id}><td>{fmtDT(x.reported_at)}</td><td>{x.unit_no}</td><td>{x.patient_name}</td><td>{x.reaction_type}{x.details && <div className="gv-sub">{x.details}</div>}</td><td><span className={`gv-badge ${x.severity === 'Mild' ? '' : 'bad'}`}>{x.severity}</span></td></tr>)}</tbody></table>
        </div>
      )}
    </>
  );
}
