import { useState, useEffect, useCallback } from 'react';
import '../../assets/CSS/Governance.css';
import { api, fmtDT, saveCsv, daysAgo, ymd } from '../../utils/govApi';

const FLAG_TONE = { Normal: 'ok', Qualitative: '', Low: 'warn', High: 'warn', 'Critical low': 'bad', 'Critical high': 'bad' };

// Point-of-care testing (tender #123): bedside devices, daily quality control, certified operators
// and results. A result needs a certified operator and a device with current quality control.
export default function Poct() {
  const [tab, setTab] = useState('results');
  const [devices, setDevices] = useState([]);
  const [msg, setMsg] = useState(null);
  const loadDevices = useCallback(() => api('/api/poct/devices').then((r) => r.success && setDevices(r.devices)), []);
  useEffect(() => { loadDevices(); }, [loadDevices]);
  const note = (r, okText) => setMsg({ ok: r.success, text: r.success ? (r.message || okText || 'Saved.') : r.message });
  return (
    <div className="gv-page">
      <div className="gv-head"><div><h1>Point-of-Care Testing</h1>
        <p>Bedside devices such as glucometers and rapid-test readers. Results are recorded against the patient with the device, the operator and the quality-control status.</p></div></div>
      <div className="gv-tabs">{[['results', 'Results'], ['devices', 'Devices & quality control']].map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => { setTab(k); setMsg(null); }}>{l}</button>)}</div>
      {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
      {tab === 'results' ? <Results devices={devices} note={note} setMsg={setMsg} /> : <Devices devices={devices} reload={loadDevices} note={note} />}
    </div>
  );
}

function Results({ devices, note, setMsg }) {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ from: daysAgo(6), to: ymd(), q: '', flag: '' });
  const [form, setForm] = useState(null);
  const load = useCallback(() => api(`/api/poct/results?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`).then((r) => r.success && setRows(r.results)), [f]);
  useEffect(() => { load(); }, [load]);
  const active = devices.filter((d) => d.status === 'Active');
  const save = async (e) => {
    e.preventDefault();
    const r = await api('/api/poct/results', { method: 'POST', body: form });
    if (r.qc_required) { setForm({ ...form, needQc: r.message }); setMsg({ ok: false, text: r.message }); return; }
    note({ ...r, message: r.success ? `Saved — ${r.flag}.${r.critical ? ' CRITICAL: inform the clinician now.' : ''}${r.qc_warning ? ` (recorded with reason: ${r.qc_warning})` : ''}` : r.message });
    if (r.success) { setForm(null); load(); }
  };
  const s = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const dev = form && devices.find((d) => String(d.id) === String(form.device_id));
  return (
    <>
      <div className="gv-filters">
        <label>From<input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label>To<input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label>Search<input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Patient or test" /></label>
        <label>Flag<select value={f.flag} onChange={(e) => setF({ ...f, flag: e.target.value })}><option value="">All</option>{Object.keys(FLAG_TONE).map((x) => <option key={x}>{x}</option>)}</select></label>
        <button className="gv-btn" onClick={() => setForm({ device_id: active[0]?.id || '' })} disabled={!active.length}>New result</button>
        <button className="gv-btn ghost" onClick={() => saveCsv(`poct-results-${f.from}-to-${f.to}.csv`, rows, [['When', (r) => r.performed_at], ['Patient', (r) => r.patient_name], ['Test', (r) => r.test_name], ['Result', (r) => r.value], ['Unit', (r) => r.unit], ['Flag', (r) => r.flag], ['Device', (r) => r.device_name], ['Operator', (r) => r.performed_by_name], ['QC override', (r) => r.qc_override_reason]])}>Export</button>
      </div>
      {!active.length && <div className="gv-msg bad">Add a POCT device under "Devices & quality control" first.</div>}
      {form && (
        <form className="gv-card" onSubmit={save}><h3>New point-of-care result</h3>
          <div className="gv-filters">
            <label>Device<select value={form.device_id} onChange={s('device_id')} required>{active.map((d) => <option key={d.id} value={d.id}>{d.name}{d.qc.ok ? '' : ' — QC due'}</option>)}</select></label>
            <label>Patient name<input value={form.patient_name || ''} onChange={s('patient_name')} required /></label>
            <label>Test<input value={form.test_name || ''} onChange={s('test_name')} list="poct-tests" required /></label>
            <datalist id="poct-tests">{(dev?.tests || '').split(',').map((t) => t.trim()).filter(Boolean).map((t) => <option key={t} value={t} />)}</datalist>
            <label>Result<input value={form.value || ''} onChange={s('value')} required /></label>
            <label>Unit<input value={form.unit || ''} onChange={s('unit')} /></label>
            <label>Ref. low<input type="number" step="any" value={form.ref_low || ''} onChange={s('ref_low')} /></label>
            <label>Ref. high<input type="number" step="any" value={form.ref_high || ''} onChange={s('ref_high')} /></label>
            <label>Critical low<input type="number" step="any" value={form.crit_low || ''} onChange={s('crit_low')} /></label>
            <label>Critical high<input type="number" step="any" value={form.crit_high || ''} onChange={s('crit_high')} /></label>
            <label>Strip / cartridge lot<input value={form.lot_no || ''} onChange={s('lot_no')} /></label>
            <label>Comment<input value={form.comment || ''} onChange={s('comment')} /></label>
            {(form.needQc || (dev && !dev.qc.ok)) && <label>Reason to test without current QC<input value={form.qc_override_reason || ''} onChange={s('qc_override_reason')} placeholder={dev?.qc.reason} /></label>}
          </div>
          {dev && !dev.qc.ok && <div className="gv-sub">{dev.qc.reason} Run quality control, or give a reason above (it is kept with the result).</div>}
          <div className="gv-actions"><button className="gv-btn" type="submit">Save result</button><button type="button" className="gv-btn ghost" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}
      <div className="gv-card">
        {rows.length === 0 ? <div className="gv-empty">No results in this period.</div> : (
          <table className="gv-table"><thead><tr><th>When</th><th>Patient</th><th>Test</th><th className="num">Result</th><th>Flag</th><th>Device</th><th>Operator</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td>{fmtDT(r.performed_at)}</td><td>{r.patient_name}</td><td>{r.test_name}</td><td className="num"><b>{r.value}</b> {r.unit}</td>
                <td><span className={`gv-badge ${FLAG_TONE[r.flag]}`}>{r.flag}</span>{r.qc_override_reason && <div className="gv-sub">No current QC: {r.qc_override_reason}</div>}</td>
                <td>{r.device_name}</td><td>{r.performed_by_name || '—'}</td></tr>))}</tbody></table>
        )}
      </div>
    </>
  );
}

function Devices({ devices, reload, note }) {
  const [form, setForm] = useState(null);
  const [qc, setQc] = useState(null);
  const [open, setOpen] = useState(null);
  const [ops, setOps] = useState([]);
  const [hist, setHist] = useState([]);
  const [op, setOp] = useState({ user_id: '', certified_until: '' });
  const [staff, setStaff] = useState([]);
  useEffect(() => { api('/api/staff/list').then((r) => { const list = r.staff || r.users || r.data || []; if (Array.isArray(list)) setStaff(list); }); }, []);
  const show = async (d) => {
    setOpen(d);
    const [o, h] = await Promise.all([api(`/api/poct/devices/${d.id}/operators`), api(`/api/poct/devices/${d.id}/qc`)]);
    setOps(o.operators || []); setHist(h.qc || []);
  };
  const saveDev = async (e) => { e.preventDefault(); const r = form.id ? await api(`/api/poct/devices/${form.id}`, { method: 'PUT', body: form }) : await api('/api/poct/devices', { method: 'POST', body: form }); note(r); if (r.success) { setForm(null); reload(); } };
  const saveQc = async (e) => { e.preventDefault(); const r = await api(`/api/poct/devices/${qc.id}/qc`, { method: 'POST', body: qc }); note(r, 'Quality control recorded.'); if (r.success) { setQc(null); reload(); if (open?.id === qc.id) show(open); } };
  const certify = async (e) => { e.preventDefault(); const r = await api(`/api/poct/devices/${open.id}/operators`, { method: 'POST', body: op }); note(r, 'Certification saved.'); if (r.success) { setOp({ user_id: '', certified_until: '' }); show(open); } };
  const unCertify = async (o) => { note(await api(`/api/poct/devices/${open.id}/operators/${o.user_id}`, { method: 'DELETE' }), 'Removed.'); show(open); };
  const s = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <>
      <div className="gv-actions" style={{ marginBottom: 10 }}><button className="gv-btn" onClick={() => setForm({ qc_interval_hours: 24, status: 'Active' })}>Add device</button></div>
      {form && (
        <form className="gv-card" onSubmit={saveDev}><h3>{form.id ? 'Edit device' : 'New device'}</h3>
          <div className="gv-filters">
            <label>Name<input value={form.name || ''} onChange={s('name')} required /></label>
            <label>Model<input value={form.model || ''} onChange={s('model')} /></label>
            <label>Serial no.<input value={form.serial_no || ''} onChange={s('serial_no')} /></label>
            <label>Location<input value={form.location || ''} onChange={s('location')} /></label>
            <label>Tests (comma separated)<input value={form.tests || ''} onChange={s('tests')} placeholder="Glucose, Haemoglobin" /></label>
            <label>QC needed every (hours)<input type="number" min="1" max="168" value={form.qc_interval_hours} onChange={s('qc_interval_hours')} /></label>
            <label>Status<select value={form.status} onChange={s('status')}><option>Active</option><option>Inactive</option></select></label>
          </div>
          <div className="gv-actions"><button className="gv-btn" type="submit">Save</button><button type="button" className="gv-btn ghost" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}
      {qc && (
        <form className="gv-card" onSubmit={saveQc}><h3>Quality control — {qc.name}</h3>
          <div className="gv-filters">
            <label>Level<input value={qc.level || ''} onChange={(e) => setQc({ ...qc, level: e.target.value })} placeholder="Normal / High / Low" required /></label>
            <label>Control lot<input value={qc.lot_no || ''} onChange={(e) => setQc({ ...qc, lot_no: e.target.value })} /></label>
            <label>Expected<input value={qc.expected || ''} onChange={(e) => setQc({ ...qc, expected: e.target.value })} /></label>
            <label>Observed<input value={qc.observed || ''} onChange={(e) => setQc({ ...qc, observed: e.target.value })} /></label>
            <label>Outcome<select value={qc.passed === undefined ? '' : String(qc.passed)} onChange={(e) => setQc({ ...qc, passed: e.target.value === 'true' })} required><option value="">Choose…</option><option value="true">Passed</option><option value="false">Failed</option></select></label>
            <label>Note<input value={qc.note || ''} onChange={(e) => setQc({ ...qc, note: e.target.value })} /></label>
          </div>
          <div className="gv-actions"><button className="gv-btn" type="submit">Save</button><button type="button" className="gv-btn ghost" onClick={() => setQc(null)}>Cancel</button></div>
        </form>
      )}
      <div className="gv-card">
        {devices.length === 0 ? <div className="gv-empty">No devices yet.</div> : (
          <table className="gv-table"><thead><tr><th>Device</th><th>Tests</th><th>Quality control</th><th>Certified operators</th><th /></tr></thead>
            <tbody>{devices.map((d) => (
              <tr key={d.id}><td><b>{d.name}</b>{d.status === 'Inactive' && <span className="gv-badge" style={{ marginLeft: 6 }}>Inactive</span>}<div className="gv-sub">{[d.model, d.serial_no, d.location].filter(Boolean).join(' · ')}</div></td><td>{d.tests || '—'}</td>
                <td><span className={`gv-badge ${d.qc.ok ? 'ok' : 'bad'}`}>{d.qc.ok ? 'Current' : 'Due'}</span>{!d.qc.ok && <div className="gv-sub">{d.qc.reason}</div>}</td>
                <td>{Number(d.certified_operators) || 'Open to all staff'}</td>
                <td className="num"><button className="gv-btn sm" onClick={() => setQc({ id: d.id, name: d.name })}>Record QC</button>{' '}<button className="gv-btn sm ghost" onClick={() => show(d)}>Operators &amp; history</button>{' '}<button className="gv-btn sm ghost" onClick={() => setForm({ ...d })}>Edit</button></td></tr>))}</tbody></table>
        )}
      </div>
      {open && (
        <div className="gv-card"><h3>{open.name}</h3>
          <div className="gv-grid2">
            <div><h4>Certified operators</h4>
              <table className="gv-table"><tbody>{ops.map((o) => <tr key={o.id}><td>{o.name}</td><td>until {String(o.certified_until).slice(0, 10)}</td><td className="num"><button className="gv-btn sm ghost" onClick={() => unCertify(o)}>Remove</button></td></tr>)}</tbody></table>
              <form className="gv-filters" onSubmit={certify}>
                <label>Staff<select value={op.user_id} onChange={(e) => setOp({ ...op, user_id: e.target.value })} required><option value="">Choose…</option>{staff.map((u) => <option key={u.id} value={u.id}>{[u.first_name, u.last_name].filter(Boolean).join(' ') || u.name}</option>)}</select></label>
                <label>Certified until<input type="date" value={op.certified_until} onChange={(e) => setOp({ ...op, certified_until: e.target.value })} required /></label>
                <button className="gv-btn sm" type="submit">Certify</button>
              </form>
              <div className="gv-sub">If no one is listed, any staff member may use the device.</div>
            </div>
            <div><h4>Quality-control history</h4>
              <table className="gv-table"><thead><tr><th>When</th><th>Level</th><th>Expected / observed</th><th>Result</th></tr></thead>
                <tbody>{hist.map((h) => <tr key={h.id}><td>{fmtDT(h.performed_at)}</td><td>{h.level}</td><td>{h.expected || '—'} / {h.observed || '—'}</td><td><span className={`gv-badge ${h.passed ? 'ok' : 'bad'}`}>{h.passed ? 'Passed' : 'Failed'}</span></td></tr>)}</tbody></table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
