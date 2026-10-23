import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import '../../assets/CSS/Governance.css';
import { api, saveCsv, fmtMin, fmtPct, daysAgo, ymd, roleLevel } from '../../utils/govApi';

const PRESETS = [['7 days', 7], ['30 days', 30], ['90 days', 90]];
const tone = (v, warnAt, badAt, higherIsWorse = true) => {
  if (v == null) return '';
  const x = higherIsWorse ? v : -v; const w = higherIsWorse ? warnAt : -warnAt; const b = higherIsWorse ? badAt : -badAt;
  return x >= b ? 'bad' : x >= w ? 'warn' : 'ok';
};

// Quality indicators and turnaround (tender #68-70, #88-91): one facility, or
// all facilities compared side by side for district / state users.
export default function QualityDashboard() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(ymd());
  const [branch, setBranch] = useState('all');
  const [branches, setBranches] = useState([]);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => { api('/api/quality/options').then((o) => o.success && setBranches(o.branches || [])); }, []);
  const load = useCallback(() => api(`/api/quality/dashboard?from=${from}&to=${to}&branch_id=${branch}`)
    .then((r) => { setErr(r.success ? '' : r.message); if (r.success) setD(r); }), [from, to, branch]);
  useEffect(() => { load(); }, [load]);

  const exportAll = () => {
    if (!d) return;
    saveCsv(`quality-indicators-${from}-to-${to}.csv`, [
      ['Reports authorised', d.tat.reports], ['Median TAT order→report (min)', d.tat.order_to_report.median], ['P90 TAT (min)', d.tat.order_to_report.p90],
      ['TAT breach %', d.tat.breach_pct], ['Samples collected', d.rejection.samples], ['Samples rejected', d.rejection.rejected], ['Rejection rate %', d.rejection.rate_pct],
      ['Recollected', d.rejection.recollected], ['Recollection pending', d.rejection.recollection_pending], ['Critical results', d.critical.raised],
      ['Critical acknowledged in time %', d.critical.acknowledged_in_time_pct], ['QC runs', d.qc.runs], ['QC rejected %', d.qc.reject_pct],
      ['EQAS acceptable %', d.eqas.acceptable_pct], ['PM overdue', d.equipment.pm_overdue], ['Open breakdown tickets', d.equipment.open_tickets], ['Downtime hours', d.equipment.downtime_hours],
    ], [['Indicator', (r) => r[0]], ['Value', (r) => r[1]]]);
  };

  return (
    <div className="gv-page">
      <div className="gv-head">
        <div>
          <h1>Quality &amp; TAT Dashboard</h1>
          <p>Turnaround from order to authorised report, sample rejection and recollection, critical-result acknowledgement, IQC/EQAS performance and equipment — the evidence an NABL inspection asks for.</p>
        </div>
        <div className="gv-actions"><button className="gv-btn ghost" onClick={exportAll} disabled={!d}>Export indicators</button></div>
      </div>

      <div className="gv-filters">
        <div className="gv-tabs" style={{ marginBottom: 0 }}>
          {PRESETS.map(([l, n]) => <button key={n} className={from === daysAgo(n - 1) && to === ymd() ? 'active' : ''} onClick={() => { setFrom(daysAgo(n - 1)); setTo(ymd()); }}>{l}</button>)}
        </div>
        <label>From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        {roleLevel() !== 'Branch' && branches.length > 0 && (
          <label>Facility<select value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="all">All facilities</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
          </select></label>
        )}
      </div>
      {err && <div className="gv-msg bad">{err}</div>}
      {!d && !err && <div className="gv-empty">Loading…</div>}

      {d && (
        <>
          <div className="gv-kpis">
            <div className="gv-kpi"><b>{d.tat.reports}</b><span>Reports authorised</span></div>
            <div className="gv-kpi"><b>{fmtMin(d.tat.order_to_report.median)}</b><span>Median TAT</span><small>P90 {fmtMin(d.tat.order_to_report.p90)}</small></div>
            <div className={`gv-kpi ${tone(d.tat.breach_pct, 5, 15)}`}><b>{fmtPct(d.tat.breach_pct)}</b><span>TAT breached</span><small>{d.tat.breached} of {d.tat.with_target} with a target</small></div>
            <div className={`gv-kpi ${tone(d.rejection.rate_pct, 2, 5)}`}><b>{fmtPct(d.rejection.rate_pct)}</b><span>Sample rejection</span><small>{d.rejection.rejected} of {d.rejection.samples} samples</small></div>
            <div className={`gv-kpi ${tone(d.critical.acknowledged_in_time_pct, 95, 80, false)}`}><b>{fmtPct(d.critical.acknowledged_in_time_pct)}</b><span>Criticals ack'd in time</span><small>{d.critical.raised} raised · {d.critical.open} open</small></div>
            <div className={`gv-kpi ${tone(d.qc.reject_pct, 2, 5)}`}><b>{fmtPct(d.qc.reject_pct)}</b><span>IQC runs rejected</span><small>{d.qc.runs} runs</small></div>
            <div className={`gv-kpi ${tone(d.eqas.acceptable_pct, 95, 85, false)}`}><b>{fmtPct(d.eqas.acceptable_pct)}</b><span>EQAS acceptable</span><small>{d.eqas.scored} scored</small></div>
            <div className={`gv-kpi ${d.equipment.pm_overdue || d.equipment.open_tickets ? 'warn' : ''}`}><b>{d.equipment.downtime_hours}h</b><span>Equipment downtime</span><small>{d.equipment.open_tickets} open tickets · {d.equipment.pm_overdue} PM overdue</small></div>
          </div>

          <div className="gv-grid2">
            <div className="gv-card">
              <h3>Turnaround by stage</h3>
              <table className="gv-table">
                <thead><tr><th>Stage</th><th className="num">Median</th><th className="num">Average</th><th className="num">P90</th><th className="num">n</th></tr></thead>
                <tbody>
                  {[['Order → collection', 'order_to_collect'], ['Collection → lab receipt', 'collect_to_receive'], ['Receipt → result', 'receive_to_result'],
                    ['Result → authorisation', 'result_to_authorise'], ['Order → authorised report', 'order_to_report']].map(([l, k]) => (
                    <tr key={k}><td>{l}</td><td className="num">{fmtMin(d.tat[k].median)}</td><td className="num">{fmtMin(d.tat[k].avg)}</td><td className="num">{fmtMin(d.tat[k].p90)}</td><td className="num">{d.tat[k].n}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="gv-card">
              <h3>Rejection reasons</h3>
              <div className="gv-sub">{d.rejection.recollected} recollected · {d.rejection.recollection_pending} recollection pending</div>
              {d.rejection.by_reason.length === 0 ? <div className="gv-empty">No rejections in this period.</div> : (
                <table className="gv-table"><tbody>
                  {d.rejection.by_reason.map((r) => (
                    <tr key={r.reason}><td>{r.reason}</td><td style={{ width: '45%' }}><div className="gv-bar"><i style={{ width: `${(r.count / d.rejection.by_reason[0].count) * 100}%` }} /></div></td><td className="num">{r.count}</td></tr>
                  ))}
                </tbody></table>
              )}
            </div>
          </div>

          <div className="gv-grid2">
            <div className="gv-card">
              <h3>Reports authorised per day</h3>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.trend} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="day" tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={16} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                    <Bar dataKey="reports" name="Reports" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="gv-card">
              <h3>Median TAT per day (minutes)</h3>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={d.trend} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="day" tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={16} />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} formatter={(v) => [fmtMin(v), 'Median TAT']} />
                    <Line dataKey="median_tat" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="gv-card">
            <h3>TAT by test</h3>
            {d.tat.by_test.length === 0 ? <div className="gv-empty">No authorised reports in this period.</div> : (
              <table className="gv-table">
                <thead><tr><th>Test</th><th className="num">Reports</th><th className="num">Target</th><th className="num">Median</th><th className="num">P90</th><th className="num">Breached</th></tr></thead>
                <tbody>{d.tat.by_test.map((t) => (
                  <tr key={t.test_name}><td>{t.test_name}</td><td className="num">{t.reports}</td><td className="num">{t.target ? fmtMin(t.target) : <span className="gv-sub">not set</span>}</td>
                    <td className="num">{fmtMin(t.median)}</td><td className="num">{fmtMin(t.p90)}</td>
                    <td className="num">{t.breach_pct == null ? '—' : <span className={`gv-badge ${tone(t.breach_pct, 5, 15)}`}>{t.breach_pct}%</span>}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>

          {d.facilities.length > 0 && (
            <div className="gv-card">
              <div className="gv-head" style={{ marginBottom: 6 }}>
                <h3 style={{ margin: 0 }}>Facility comparison</h3>
                <button className="gv-btn sm ghost" onClick={() => saveCsv(`facility-comparison-${from}-to-${to}.csv`, d.facilities, [
                  ['District', (f) => f.district], ['Facility', (f) => f.branch_name], ['Reports', (f) => f.reports], ['Median TAT (min)', (f) => f.median_tat],
                  ['TAT breach %', (f) => f.tat_breach_pct], ['Rejection %', (f) => f.rejection_pct], ['Critical ack in time %', (f) => f.critical_ack_pct], ['QC reject %', (f) => f.qc_reject_pct]])}>Export</button>
              </div>
              <div className="gv-sub">Ranked by workload. Click a facility to see its own indicators.</div>
              <table className="gv-table">
                <thead><tr><th>#</th><th>Facility</th><th>District</th><th className="num">Reports</th><th className="num">Median TAT</th><th className="num">TAT breach</th><th className="num">Rejection</th><th className="num">Critical ack</th><th className="num">QC reject</th></tr></thead>
                <tbody>{d.facilities.map((f, i) => (
                  <tr key={f.branch_id} className="clickable" onClick={() => setBranch(String(f.branch_id))}>
                    <td>{i + 1}</td><td><b>{f.branch_name}</b></td><td>{f.district}</td><td className="num">{f.reports}</td><td className="num">{fmtMin(f.median_tat)}</td>
                    <td className="num">{fmtPct(f.tat_breach_pct)}</td><td className="num">{fmtPct(f.rejection_pct)}</td><td className="num">{fmtPct(f.critical_ack_pct)}</td><td className="num">{fmtPct(f.qc_reject_pct)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
