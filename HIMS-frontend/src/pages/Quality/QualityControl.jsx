import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import '../../assets/CSS/Governance.css';
import { api, fmtDT, fmtDate, role, saveCsv } from '../../utils/govApi';

const LEVELS = ['Level 1', 'Level 2', 'Level 3', 'Low', 'Normal', 'High'];
const STATUS_BADGE = { Accepted: 'ok', Warning: 'warn', Rejected: 'bad' };
const PERF_BADGE = { Acceptable: 'ok', Warning: 'warn', Unacceptable: 'bad', Pending: '' };
const isManager = () => ['admin', 'super admin', 'lab head', 'lab doctor', 'lab_doctor'].includes(role());
const canRun = () => isManager() || ['lab technician', 'lab_tech'].includes(role());

// Internal Quality Control (Westgard / Levey-Jennings) and EQAS records.
export default function QualityControl() {
  const [tab, setTab] = useState('iqc');
  const [options, setOptions] = useState({ machines: [], tests: [], rules: [] });
  const [msg, setMsg] = useState(null);

  useEffect(() => { api('/api/quality/options').then((d) => d.success && setOptions(d)); }, []);

  return (
    <div className="gv-page">
      <div className="gv-head">
        <div>
          <h1>Quality Control</h1>
          <p>Internal QC runs are checked against Westgard rules the moment they are recorded. A rejected run means patient results for that parameter on that analyzer must be held until corrective action and a passing re-run.</p>
        </div>
      </div>
      <div className="gv-tabs">
        {[['iqc', 'Internal QC (IQC)'], ['eqas', 'External QA (EQAS)']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => { setTab(k); setMsg(null); }}>{l}</button>
        ))}
      </div>
      {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
      {tab === 'iqc' ? <IqcTab options={options} setMsg={setMsg} /> : <EqasTab options={options} setMsg={setMsg} />}
    </div>
  );
}

function IqcTab({ options, setMsg }) {
  const [materials, setMaterials] = useState(null);
  const [adding, setAdding] = useState(false);
  const [recording, setRecording] = useState(null);
  const [chart, setChart] = useState(null);

  const load = useCallback(() => api('/api/quality/materials').then((d) => setMaterials(d.success ? d.materials : [])), []);
  useEffect(() => { load(); }, [load]);

  const rejectedNow = (materials || []).filter((m) => m.latest_status === 'Rejected').length;
  const warnNow = (materials || []).filter((m) => m.latest_status === 'Warning').length;
  const notRunToday = (materials || []).filter((m) => !m.latest_run_at || new Date(m.latest_run_at).toDateString() !== new Date().toDateString()).length;

  return (
    <>
      <div className="gv-kpis">
        <div className="gv-kpi"><b>{materials?.length ?? '…'}</b><span>Active control lots</span></div>
        <div className={`gv-kpi ${rejectedNow ? 'bad' : ''}`}><b>{rejectedNow}</b><span>Last run rejected</span><small>Hold patient results</small></div>
        <div className={`gv-kpi ${warnNow ? 'warn' : ''}`}><b>{warnNow}</b><span>Last run warning (1-2s)</span></div>
        <div className={`gv-kpi ${notRunToday ? 'warn' : ''}`}><b>{notRunToday}</b><span>Not run today</span></div>
      </div>
      <div className="gv-actions" style={{ marginBottom: 12 }}>
        {isManager() && <button className="gv-btn" onClick={() => setAdding(true)}>Add control lot</button>}
      </div>
      <div className="gv-table-wrap">
        <table className="gv-table">
          <thead><tr><th>Analyzer / parameter</th><th>Control lot</th><th className="num">Target</th><th>Last run</th><th className="num">30-day runs</th><th /></tr></thead>
          <tbody>
            {materials === null && <tr><td colSpan={6} className="gv-empty">Loading…</td></tr>}
            {materials?.length === 0 && <tr><td colSpan={6} className="gv-empty">No control lots yet. Add one to start recording QC.</td></tr>}
            {(materials || []).map((m) => (
              <tr key={m.id}>
                <td><b>{m.parameter_name}</b>{m.unit ? ` (${m.unit})` : ''}<div className="gv-sub">{m.machine_name || 'Any analyzer'}{m.test_name ? ` · ${m.test_name}` : ''}</div></td>
                <td>{m.material_name}<div className="gv-sub">Lot {m.lot_no} · {m.level}{m.expiry_date ? ` · exp ${fmtDate(m.expiry_date)}` : ''}</div></td>
                <td className="num">{Number(m.target_mean)} ± {Number(m.target_sd)}</td>
                <td>
                  {m.latest_status ? <span className={`gv-badge ${STATUS_BADGE[m.latest_status]}`}>{m.latest_status}{m.latest_violations ? ` · ${m.latest_violations}` : ''}</span> : <span className="gv-badge">No runs</span>}
                  {m.latest_run_at && <div className="gv-sub">{Number(m.latest_value)} (z {Number(m.latest_z).toFixed(2)}) · {fmtDT(m.latest_run_at)}</div>}
                </td>
                <td className="num">{m.runs_30d}{Number(m.rejected_30d) ? <div className="gv-sub" style={{ color: '#b91c1c' }}>{m.rejected_30d} rejected</div> : null}</td>
                <td>
                  <div className="gv-actions">
                    {canRun() && <button className="gv-btn sm" onClick={() => setRecording(m)}>Record run</button>}
                    <button className="gv-btn sm ghost" onClick={() => setChart(m)}>Levey-Jennings</button>
                    {isManager() && <button className="gv-btn sm ghost" onClick={async () => { const d = await api(`/api/quality/materials/${m.id}`, { method: 'PUT', body: { active: false } }); setMsg({ ok: d.success, text: d.success ? `Lot ${m.lot_no} retired.` : d.message }); load(); }}>Retire lot</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <MaterialModal options={options} onClose={() => setAdding(false)} onSaved={(d) => { setAdding(false); setMsg({ ok: true, text: d.message }); load(); }} />}
      {recording && <RunModal material={recording} onClose={() => setRecording(null)} onSaved={(d) => { setRecording(null); setMsg({ ok: d.status !== 'Rejected', text: d.message }); load(); }} />}
      {chart && <LeveyJennings material={chart} onClose={() => { setChart(null); load(); }} />}
    </>
  );
}

function MaterialModal({ options, onClose, onSaved }) {
  const [f, setF] = useState({ machine_id: '', test_id: '', parameter_name: '', unit: '', material_name: '', lot_no: '', level: 'Level 1', target_mean: '', target_sd: '', expiry_date: '', rules: options.rules });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggleRule = (r) => setF({ ...f, rules: f.rules.includes(r) ? f.rules.filter((x) => x !== r) : [...f.rules, r] });
  const save = async () => {
    const d = await api('/api/quality/materials', { method: 'POST', body: f });
    if (d.success) onSaved(d); else setErr(d.message);
  };
  return (
    <div className="gv-overlay" onClick={onClose}>
      <div className="gv-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add control lot</h2>
        <div className="gv-sub">Use the lab's own established mean and SD for this lot (from at least 20 runs), not the manufacturer's range.</div>
        <div className="gv-form">
          <label>Analyzer<select value={f.machine_id} onChange={set('machine_id')}><option value="">Any</option>{options.machines.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.model}</option>)}</select></label>
          <label>Test<select value={f.test_id} onChange={set('test_id')}><option value="">—</option>{options.tests.map((t) => <option key={t.id} value={t.id}>{t.test_name}</option>)}</select></label>
          <label>Parameter *<input value={f.parameter_name} onChange={set('parameter_name')} placeholder="e.g. Haemoglobin" /></label>
          <label>Unit<input value={f.unit} onChange={set('unit')} placeholder="g/dL" /></label>
          <label>Control material *<input value={f.material_name} onChange={set('material_name')} placeholder="e.g. Bio-Rad Lyphochek" /></label>
          <label>Lot number *<input value={f.lot_no} onChange={set('lot_no')} /></label>
          <label>Level<select value={f.level} onChange={set('level')}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></label>
          <label>Lot expiry<input type="date" value={f.expiry_date} onChange={set('expiry_date')} /></label>
          <label>Target mean *<input type="number" step="any" value={f.target_mean} onChange={set('target_mean')} /></label>
          <label>Target SD *<input type="number" step="any" value={f.target_sd} onChange={set('target_sd')} /></label>
          <div className="full">
            <div className="gv-sub" style={{ marginBottom: 6, fontWeight: 700 }}>Westgard rules</div>
            <div className="gv-checks">{options.rules.map((r) => <label key={r}><input type="checkbox" checked={f.rules.includes(r)} onChange={() => toggleRule(r)} />{r}</label>)}</div>
          </div>
        </div>
        {err && <div className="gv-msg bad">{err}</div>}
        <div className="gv-modal-actions"><button className="gv-btn ghost" onClick={onClose}>Cancel</button><button className="gv-btn" onClick={save}>Save</button></div>
      </div>
    </div>
  );
}

function RunModal({ material, onClose, onSaved }) {
  const [value, setValue] = useState('');
  const [action, setAction] = useState('');
  const [err, setErr] = useState('');
  const mean = Number(material.target_mean); const sd = Number(material.target_sd);
  const z = value === '' ? null : (Number(value) - mean) / sd;
  const save = async () => {
    const d = await api('/api/quality/runs', { method: 'POST', body: { material_id: material.id, value, corrective_action: action } });
    if (d.success) onSaved(d); else setErr(d.message);
  };
  return (
    <div className="gv-overlay" onClick={onClose}>
      <div className="gv-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Record QC run</h2>
        <div className="gv-sub">{material.parameter_name} · {material.material_name} lot {material.lot_no} ({material.level}) · target {mean} ± {sd}{material.unit ? ` ${material.unit}` : ''}</div>
        <div className="gv-form">
          <label>Control value *<input type="number" step="any" autoFocus value={value} onChange={(e) => setValue(e.target.value)} /></label>
          <label>z-score<input readOnly value={z == null || Number.isNaN(z) ? '' : z.toFixed(2)} /></label>
          <label className="full">Corrective action (if out of control)<textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. recalibrated, new reagent lot, re-run passed" /></label>
        </div>
        {err && <div className="gv-msg bad">{err}</div>}
        <div className="gv-modal-actions"><button className="gv-btn ghost" onClick={onClose}>Cancel</button><button className="gv-btn" disabled={value === ''} onClick={save}>Save run</button></div>
      </div>
    </div>
  );
}

function LeveyJennings({ material, onClose }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [fixing, setFixing] = useState(null);
  const load = useCallback(() => api(`/api/quality/materials/${material.id}/runs?days=${days}`).then((d) => d.success && setData(d)), [material.id, days]);
  useEffect(() => { load(); }, [load]);

  const mean = Number(material.target_mean); const sd = Number(material.target_sd);
  const points = (data?.runs || []).map((r, i) => ({ i: i + 1, value: Number(r.value), status: r.status, when: fmtDT(r.run_at), violations: r.violations }));
  const vals = points.map((p) => p.value);
  const lo = Math.min(mean - 3.5 * sd, ...vals); const hi = Math.max(mean + 3.5 * sd, ...vals);
  const dot = (props) => {
    const { cx, cy, payload } = props;
    const fill = payload.status === 'Rejected' ? '#dc2626' : payload.status === 'Warning' ? '#d97706' : '#2563eb';
    return <circle key={payload.i} cx={cx} cy={cy} r={payload.status === 'Accepted' ? 4 : 6} fill={fill} stroke="#fff" strokeWidth={2} />;
  };

  return (
    <div className="gv-overlay" onClick={onClose}>
      <div className="gv-modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="gv-head" style={{ marginBottom: 8 }}>
          <div>
            <h2>Levey-Jennings — {material.parameter_name}</h2>
            <div className="gv-sub">{material.material_name} lot {material.lot_no} ({material.level}) · target mean {mean}, SD {sd}</div>
          </div>
          <div className="gv-tabs" style={{ marginBottom: 0 }}>
            {[7, 30, 90].map((d) => <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>{d} days</button>)}
          </div>
        </div>
        {data && (
          <div className="gv-kpis">
            <div className="gv-kpi"><b>{data.observed.n}</b><span>Runs</span></div>
            <div className="gv-kpi"><b>{data.observed.mean == null ? '—' : data.observed.mean.toFixed(2)}</b><span>Observed mean</span></div>
            <div className="gv-kpi"><b>{data.observed.sd == null ? '—' : data.observed.sd.toFixed(3)}</b><span>Observed SD</span></div>
            <div className="gv-kpi"><b>{data.observed.cv == null ? '—' : `${data.observed.cv.toFixed(1)}%`}</b><span>CV</span></div>
          </div>
        )}
        <div style={{ height: 300 }}>
          {points.length === 0 ? <div className="gv-empty">No runs in this period.</div> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 10, right: 40, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="i" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} label={{ value: 'Run', position: 'insideBottomRight', fontSize: 11, fill: '#94a3b8' }} />
                <YAxis domain={[lo, hi]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => Number(v).toFixed(1)} />
                {[3, 2, 1].flatMap((k) => [k, -k]).map((k) => (
                  <ReferenceLine key={k} y={mean + k * sd} stroke={Math.abs(k) === 3 ? '#dc2626' : Math.abs(k) === 2 ? '#d97706' : '#cbd5e1'} strokeDasharray="4 4"
                    label={{ value: `${k > 0 ? '+' : '−'}${Math.abs(k)}SD`, position: 'right', fontSize: 10, fill: '#64748b' }} />
                ))}
                <ReferenceLine y={mean} stroke="#64748b" label={{ value: 'Mean', position: 'right', fontSize: 10, fill: '#64748b' }} />
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }}
                  formatter={(v, _n, p) => [`${v} — ${p.payload.status}${p.payload.violations ? ` (${p.payload.violations})` : ''}`, 'Value']}
                  labelFormatter={(_l, p) => p?.[0]?.payload?.when || ''} />
                <Line type="linear" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={dot} activeDot={{ r: 7 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="gv-legend"><span><i style={{ background: '#2563eb' }} />Accepted</span><span><i style={{ background: '#d97706' }} />Warning (1-2s)</span><span><i style={{ background: '#dc2626' }} />Rejected</span></div>
        <h3 style={{ margin: '16px 0 8px', fontSize: 14 }}>Runs</h3>
        <div className="gv-table-wrap">
          <table className="gv-table">
            <thead><tr><th>When</th><th className="num">Value</th><th className="num">z</th><th>Result</th><th>By</th><th>Corrective action</th></tr></thead>
            <tbody>
              {[...(data?.runs || [])].reverse().map((r) => (
                <tr key={r.id}>
                  <td>{fmtDT(r.run_at)}</td><td className="num">{Number(r.value)}</td><td className="num">{Number(r.z_score).toFixed(2)}</td>
                  <td><span className={`gv-badge ${STATUS_BADGE[r.status]}`}>{r.status}{r.violations ? ` · ${r.violations}` : ''}</span></td>
                  <td>{r.performed_by_name || '—'}</td>
                  <td>{r.corrective_action || (r.status === 'Rejected' && canRun()
                    ? <button className="gv-btn sm ghost" onClick={() => setFixing(r)}>Record action</button>
                    : <span className="gv-sub">—</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="gv-modal-actions">
          <button className="gv-btn ghost" onClick={() => saveCsv(`qc-${material.parameter_name}-${material.lot_no}.csv`, data?.runs || [], [
            ['Run at', (r) => r.run_at], ['Value', (r) => r.value], ['z', (r) => r.z_score], ['Status', (r) => r.status], ['Rules', (r) => r.violations], ['By', (r) => r.performed_by_name], ['Corrective action', (r) => r.corrective_action]])}>Export CSV</button>
          <button className="gv-btn" onClick={onClose}>Close</button>
        </div>
        {fixing && <CorrectiveModal run={fixing} onClose={() => setFixing(null)} onSaved={() => { setFixing(null); load(); }} />}
      </div>
    </div>
  );
}

function CorrectiveModal({ run, onClose, onSaved }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="gv-overlay" onClick={onClose}>
      <div className="gv-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Corrective action</h2>
        <div className="gv-sub">Run of {fmtDT(run.run_at)} — {run.violations}</div>
        <div className="gv-form"><label className="full">What was done<textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></label></div>
        {err && <div className="gv-msg bad">{err}</div>}
        <div className="gv-modal-actions"><button className="gv-btn ghost" onClick={onClose}>Cancel</button>
          <button className="gv-btn" onClick={async () => { const d = await api(`/api/quality/runs/${run.id}/corrective-action`, { method: 'PUT', body: { corrective_action: text } }); if (d.success) onSaved(); else setErr(d.message); }}>Save</button></div>
      </div>
    </div>
  );
}

const EMPTY_EQAS = { provider: '', program_name: '', cycle: '', sample_code: '', test_id: '', parameter_name: '', our_result: '', assigned_value: '', assigned_sd: '', received_on: '', submitted_on: '', result_on: '', corrective_action: '' };

function EqasTab({ options, setMsg }) {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api('/api/quality/eqas').then((d) => d.success && setData(d)), []);
  useEffect(() => { load(); }, [load]);
  const s = data?.summary;
  return (
    <>
      {s && (
        <div className="gv-kpis">
          <div className="gv-kpi"><b>{s.total}</b><span>EQAS results</span></div>
          <div className={`gv-kpi ${s.acceptable_pct != null && s.acceptable_pct < 90 ? 'warn' : 'ok'}`}><b>{s.acceptable_pct == null ? '—' : `${s.acceptable_pct}%`}</b><span>Acceptable (|SDI| ≤ 2)</span></div>
          <div className={`gv-kpi ${s.warning ? 'warn' : ''}`}><b>{s.warning}</b><span>Warning (2 – 3)</span></div>
          <div className={`gv-kpi ${s.unacceptable ? 'bad' : ''}`}><b>{s.unacceptable}</b><span>Unacceptable (&gt; 3)</span></div>
          <div className="gv-kpi"><b>{s.pending}</b><span>Awaiting provider result</span></div>
        </div>
      )}
      <div className="gv-actions" style={{ marginBottom: 12 }}>
        {isManager() && <button className="gv-btn" onClick={() => setEditing(EMPTY_EQAS)}>Add EQAS result</button>}
        <button className="gv-btn ghost" onClick={() => saveCsv('eqas-results.csv', data?.results || [], [
          ['Provider', (r) => r.provider], ['Programme', (r) => r.program_name], ['Cycle', (r) => r.cycle], ['Sample', (r) => r.sample_code], ['Parameter', (r) => r.parameter_name],
          ['Our result', (r) => r.our_result], ['Assigned', (r) => r.assigned_value], ['SD', (r) => r.assigned_sd], ['SDI', (r) => r.sdi], ['Performance', (r) => r.performance],
          ['Result date', (r) => r.result_on], ['Corrective action', (r) => r.corrective_action]])}>Export CSV</button>
      </div>
      <div className="gv-table-wrap">
        <table className="gv-table">
          <thead><tr><th>Programme / cycle</th><th>Parameter</th><th className="num">Our result</th><th className="num">Assigned ± SD</th><th className="num">SDI</th><th>Performance</th><th>Corrective action</th><th /></tr></thead>
          <tbody>
            {!data && <tr><td colSpan={8} className="gv-empty">Loading…</td></tr>}
            {data?.results.length === 0 && <tr><td colSpan={8} className="gv-empty">No EQAS results recorded yet.</td></tr>}
            {(data?.results || []).map((r) => (
              <tr key={r.id}>
                <td><b>{r.program_name}</b><div className="gv-sub">{r.provider} · {r.cycle}{r.sample_code ? ` · ${r.sample_code}` : ''}</div></td>
                <td>{r.parameter_name}{r.test_name ? <div className="gv-sub">{r.test_name}</div> : null}</td>
                <td className="num">{r.our_result == null ? '—' : Number(r.our_result)}</td>
                <td className="num">{r.assigned_value == null ? '—' : `${Number(r.assigned_value)} ± ${Number(r.assigned_sd)}`}</td>
                <td className="num">{r.sdi == null ? '—' : Number(r.sdi).toFixed(2)}</td>
                <td><span className={`gv-badge ${PERF_BADGE[r.performance]}`}>{r.performance}</span><div className="gv-sub">{r.result_on ? fmtDate(r.result_on) : ''}</div></td>
                <td>{r.corrective_action || <span className="gv-sub">—</span>}</td>
                <td>{isManager() && <button className="gv-btn sm ghost" onClick={() => setEditing({ ...EMPTY_EQAS, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? ''])), received_on: r.received_on ? String(r.received_on).slice(0, 10) : '', submitted_on: r.submitted_on ? String(r.submitted_on).slice(0, 10) : '', result_on: r.result_on ? String(r.result_on).slice(0, 10) : '' })}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <EqasModal initial={editing} options={options} onClose={() => setEditing(null)} onSaved={(d) => { setEditing(null); setMsg({ ok: d.performance !== 'Unacceptable', text: d.message }); load(); }} />}
    </>
  );
}

function EqasModal({ initial, options, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const d = await api(f.id ? `/api/quality/eqas/${f.id}` : '/api/quality/eqas', { method: f.id ? 'PUT' : 'POST', body: f });
    if (d.success) onSaved(d); else setErr(d.message);
  };
  return (
    <div className="gv-overlay" onClick={onClose}>
      <div className="gv-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{f.id ? 'Edit' : 'Add'} EQAS result</h2>
        <div className="gv-sub">The SDI and performance band are calculated from the provider's assigned value and SD.</div>
        <div className="gv-form">
          <label>Provider *<input value={f.provider} onChange={set('provider')} placeholder="e.g. CMC Vellore" /></label>
          <label>Programme *<input value={f.program_name} onChange={set('program_name')} placeholder="e.g. Haematology EQAS" /></label>
          <label>Cycle *<input value={f.cycle} onChange={set('cycle')} placeholder="e.g. 2026-Q3" /></label>
          <label>Sample code<input value={f.sample_code} onChange={set('sample_code')} /></label>
          <label>Test<select value={f.test_id} onChange={set('test_id')}><option value="">—</option>{options.tests.map((t) => <option key={t.id} value={t.id}>{t.test_name}</option>)}</select></label>
          <label>Parameter *<input value={f.parameter_name} onChange={set('parameter_name')} /></label>
          <label>Our result<input type="number" step="any" value={f.our_result} onChange={set('our_result')} /></label>
          <label>Assigned value<input type="number" step="any" value={f.assigned_value} onChange={set('assigned_value')} /></label>
          <label>Assigned SD<input type="number" step="any" value={f.assigned_sd} onChange={set('assigned_sd')} /></label>
          <label>Sample received<input type="date" value={f.received_on} onChange={set('received_on')} /></label>
          <label>Submitted<input type="date" value={f.submitted_on} onChange={set('submitted_on')} /></label>
          <label>Result received<input type="date" value={f.result_on} onChange={set('result_on')} /></label>
          <label className="full">Corrective action<textarea rows={2} value={f.corrective_action} onChange={set('corrective_action')} /></label>
        </div>
        {err && <div className="gv-msg bad">{err}</div>}
        <div className="gv-modal-actions"><button className="gv-btn ghost" onClick={onClose}>Cancel</button><button className="gv-btn" onClick={save}>Save</button></div>
      </div>
    </div>
  );
}
