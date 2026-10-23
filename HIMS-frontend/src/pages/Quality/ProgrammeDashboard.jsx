import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import '../../assets/CSS/Governance.css';
import { api, download, fmtMin, fmtPct, daysAgo, ymd } from '../../utils/govApi';

const PRESETS = [['7 days', 7], ['30 days', 30], ['90 days', 90], ['1 year', 365]];
const COLORS = ['#2563eb', '#0d9488', '#d97706', '#7c3aed', '#db2777'];
const nf = (n) => new Intl.NumberFormat('en-IN').format(n ?? 0);
const AXIS = { fontSize: 10, fill: '#64748b' };
// Higher-is-better indicators against a floor, lower-is-better against a ceiling.
const toneMin = (v, target) => (v == null ? '' : v >= target ? 'ok' : v >= target - 10 ? 'warn' : 'bad');
const toneMax = (v, target) => (v == null ? '' : v <= target ? 'ok' : v <= target * 2.5 ? 'warn' : 'bad');
const change = (g) => (g == null ? '—' : `${g > 0 ? '+' : ''}${g}%`);

// State / district / facility analytics (tender #89-91): ranking, investigation
// volumes, test-wise and referral trends, utilisation, equipment, reagents,
// quality indicators and free-scheme monitoring — any date range, drill-down
// from state to district to facility, CSV export and print.
export default function ProgrammeDashboard() {
  const [params, setParams] = useSearchParams();
  const [from, setFrom] = useState(params.get('from') || daysAgo(29));
  const [to, setTo] = useState(params.get('to') || ymd());
  const district = params.get('district_id') || '';
  const branch = params.get('branch_id') || '';
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const qs = useCallback((extra = {}) => new URLSearchParams(Object.entries({ from, to, district_id: district, branch_id: branch, ...extra })
    .filter(([, v]) => v !== '' && v != null)).toString(), [from, to, district, branch]);
  const load = useCallback(() => api(`/api/programme/dashboard?${qs()}`).then((r) => { setErr(r.success ? '' : r.message); if (r.success) setD(r); }), [qs]);
  useEffect(() => { load(); }, [load]);

  const go = (next) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k); }
    setParams(p, { replace: false });
  };
  const exportView = (view) => download(`/api/programme/export?${qs({ view })}`, `programme-${view}.csv`).catch((e) => setMsg(e.message));

  const kind = d?.scope.kind;
  const focus = d?.scope.focus;
  const districtName = d?.scope.districts.find((x) => String(x.id) === district)?.name;
  const branchName = d?.scope.facilities.find((x) => String(x.id) === branch)?.name;
  const k = d?.kpis;
  const t = d?.targets;

  return (
    <div className="gv-page">
      <div className="gv-head">
        <div>
          <h1>{kind === 'facility' ? 'Facility analytics' : kind === 'district' ? 'District analytics' : 'State / NFDS programme dashboard'}</h1>
          <p>Investigation volumes, test-wise and referral trends, turnaround, sample rejection, analyzer utilisation and uptime, reagent use and free-scheme activity for any period. Click a district or facility to drill down; every table can be exported.</p>
        </div>
        <div className="gv-actions">
          <button className="gv-btn ghost" onClick={() => window.print()}>Print / save as PDF</button>
        </div>
      </div>

      <div className="gv-filters">
        <div className="gv-tabs" style={{ marginBottom: 0 }}>
          {PRESETS.map(([l, n]) => <button key={n} className={from === daysAgo(n - 1) && to === ymd() ? 'active' : ''} onClick={() => { setFrom(daysAgo(n - 1)); setTo(ymd()); }}>{l}</button>)}
        </div>
        <label>From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} min={from} max={ymd()} onChange={(e) => setTo(e.target.value)} /></label>
        {kind === 'state' && d && (
          <label>District<select value={district} onChange={(e) => go({ district_id: e.target.value, branch_id: '' })}>
            <option value="">All districts</option>{d.scope.districts.map((x) => <option key={x.id ?? 'none'} value={x.id ?? ''}>{x.name}</option>)}
          </select></label>
        )}
        {kind !== 'facility' && d && (
          <label>Facility<select value={branch} onChange={(e) => go({ branch_id: e.target.value })}>
            <option value="">All facilities</option>
            {d.scope.facilities.filter((f) => !district || String(f.district_id) === district).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select></label>
        )}
      </div>

      {kind && kind !== 'facility' && (
        <div className="gv-sub" style={{ marginBottom: 8 }}>
          <a href="#state" onClick={(e) => { e.preventDefault(); go({ district_id: '', branch_id: '' }); }}>{kind === 'state' ? 'Karnataka' : 'My district'}</a>
          {districtName && kind === 'state' && <> › <a href="#district" onClick={(e) => { e.preventDefault(); go({ branch_id: '' }); }}>{districtName}</a></>}
          {branchName && <> › <b>{branchName}</b></>}
        </div>
      )}

      {err && <div className="gv-msg bad">{err}</div>}
      {msg && <div className="gv-msg bad">{msg}</div>}
      {!d && !err && <div className="gv-empty">Loading…</div>}
      {d?.scope.empty && <div className="gv-msg bad">No facility is available for this selection.</div>}

      {d && !d.scope.empty && (
        <>
          <div className="gv-kpis">
            <div className="gv-kpi"><b>{nf(k.tests)}</b><span>Investigations</span><small>{change(k.growth_pct)} vs previous {d.period.days} days ({nf(k.prev_tests)})</small></div>
            <div className="gv-kpi"><b>{k.facilities_reporting}/{k.facilities}</b><span>Facilities reporting</span><small>{nf(k.approved)} reports authorised</small></div>
            <div className={`gv-kpi ${toneMin(k.tat_compliance_pct, t.tat_compliance_pct)}`}><b>{fmtPct(k.tat_compliance_pct)}</b><span>Within TAT target</span><small>target {t.tat_compliance_pct}%</small></div>
            <div className={`gv-kpi ${toneMax(k.rejection_pct, t.rejection_pct_max)}`}><b>{fmtPct(k.rejection_pct)}</b><span>Sample rejection</span><small>{k.rejected} of {nf(k.samples)} · target ≤ {t.rejection_pct_max}%</small></div>
            <div className={`gv-kpi ${toneMin(k.critical_ack_pct, t.critical_ack_pct)}`}><b>{fmtPct(k.critical_ack_pct)}</b><span>Criticals ack'd in time</span><small>{k.criticals} raised</small></div>
            <div className={`gv-kpi ${toneMax(k.qc_reject_pct, t.qc_reject_pct_max)}`}><b>{fmtPct(k.qc_reject_pct)}</b><span>IQC runs rejected</span><small>target ≤ {t.qc_reject_pct_max}%</small></div>
            <div className={`gv-kpi ${toneMin(k.uptime_pct, t.uptime_pct)}`}><b>{fmtPct(k.uptime_pct)}</b><span>Analyzer uptime</span><small>{k.machines} analyzers · {k.open_tickets} open tickets</small></div>
            <div className="gv-kpi"><b>{k.utilization_per_machine_day ?? '—'}</b><span>Tests / analyzer / day</span><small>utilisation</small></div>
            <div className="gv-kpi"><b>{nf(k.referred_out)} / {nf(k.referred_in)}</b><span>Referred out / in</span><small>between facilities</small></div>
            <div className="gv-kpi"><b>{nf(k.scheme_bills)}</b><span>Free-scheme bills</span><small>{fmtPct(k.scheme_share_pct)} of {nf(k.bills)} bills</small></div>
          </div>

          {focus === 'state' && d.districts.length > 0 && (
            <div className="gv-card">
              <div className="gv-head" style={{ marginBottom: 6 }}>
                <h3 style={{ margin: 0 }}>District ranking</h3>
                <button className="gv-btn sm ghost" onClick={() => exportView('districts')}>Export</button>
              </div>
              <div className="gv-sub">{d.score_formula} Click a district to see its facilities.</div>
              <table className="gv-table">
                <thead><tr><th>Rank</th><th>District</th><th className="num">Score</th><th className="num">Investigations</th><th className="num">vs previous</th><th className="num">Within TAT</th><th className="num">Rejection</th><th className="num">IQC reject</th><th className="num">Uptime</th><th className="num">Referred out/in</th><th className="num">Scheme bills</th></tr></thead>
                <tbody>{d.districts.map((x) => (
                  <tr key={x.district_id ?? 'none'} className="clickable" onClick={() => x.district_id && go({ district_id: String(x.district_id), branch_id: '' })}>
                    <td>{x.rank ?? '—'}</td><td><b>{x.district}</b><div className="gv-sub">{x.facilities} facilities</div></td>
                    <td className="num"><span className={`gv-badge ${x.score == null ? '' : x.score >= 90 ? 'ok' : x.score >= 75 ? 'warn' : 'bad'}`}>{x.score ?? '—'}</span></td>
                    <td className="num">{nf(x.tests)}</td><td className="num">{change(x.growth_pct)}</td>
                    <td className="num">{fmtPct(x.tat_compliance_pct)}</td><td className="num">{fmtPct(x.rejection_pct)}</td><td className="num">{fmtPct(x.qc_reject_pct)}</td>
                    <td className="num">{fmtPct(x.uptime_pct)}</td><td className="num">{x.referred_out} / {x.referred_in}</td><td className="num">{x.scheme_bills}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          <div className="gv-grid2">
            <div className="gv-card">
              <h3>Investigations per day</h3>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={d.volume_trend} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="day" tickFormatter={(v) => v.slice(5)} tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line dataKey="tests" name="Tests done" stroke="#2563eb" strokeWidth={2} dot={false} />
                    <Line dataKey="approved" name="Authorised" stroke="#0d9488" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="gv-card">
              <h3>Test-wise trend (top {d.test_trend.tests.length})</h3>
              {d.test_trend.tests.length === 0 ? <div className="gv-empty">No tests in this period.</div> : (
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={d.test_trend.series} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="day" tickFormatter={(v) => v.slice(5)} tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
                      <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {d.test_trend.tests.map((name, i) => <Line key={name} dataKey={name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />)}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="gv-card">
            <div className="gv-head" style={{ marginBottom: 6 }}>
              <h3 style={{ margin: 0 }}>Investigations by test</h3>
              <button className="gv-btn sm ghost" onClick={() => exportView('tests')}>Export</button>
            </div>
            {d.tests.length === 0 ? <div className="gv-empty">No tests in this period.</div> : (
              <table className="gv-table">
                <thead><tr><th>Test</th><th className="num">Investigations</th><th className="num">vs previous</th><th className="num">Facilities</th><th className="num">Authorised</th><th className="num">Avg TAT</th><th className="num">Target</th></tr></thead>
                <tbody>{d.tests.map((x) => (
                  <tr key={x.test_name}><td>{x.test_name}</td>
                    <td className="num">{nf(x.tests)}</td><td className="num">{change(x.growth_pct)}</td><td className="num">{x.facilities}</td><td className="num">{nf(x.approved)}</td>
                    <td className="num">{fmtMin(x.avg_tat)}</td><td className="num">{x.target ? fmtMin(x.target) : <span className="gv-sub">not set</span>}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>

          <div className="gv-grid2">
            <div className="gv-card">
              <div className="gv-head" style={{ marginBottom: 6 }}>
                <h3 style={{ margin: 0 }}>Referral trend</h3>
                <button className="gv-btn sm ghost" onClick={() => exportView('referrals')}>Export</button>
              </div>
              <div className="gv-sub">{d.referrals.total} referrals{d.referrals.avg_transit_hours != null && ` · average ${d.referrals.avg_transit_hours} h from dispatch to receipt`}{d.referrals.due_to_breakdown > 0 && ` · ${d.referrals.due_to_breakdown} because of an analyzer breakdown`}</div>
              <div style={{ height: 170 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.referrals.trend} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="day" tickFormatter={(v) => v.slice(5)} tick={AXIS} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                    <Bar dataKey="referrals" name="Referrals" fill="#d97706" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="gv-card">
              <h3>Referral analysis</h3>
              {d.referrals.total === 0 ? <div className="gv-empty">No referrals in this period.</div> : (
                <>
                  <table className="gv-table"><thead><tr><th>Main reasons</th><th className="num">Referrals</th></tr></thead>
                    <tbody>{d.referrals.by_reason.map((x) => <tr key={x.reason}><td>{x.reason}</td><td className="num">{x.n}</td></tr>)}</tbody></table>
                  <table className="gv-table" style={{ marginTop: 10 }}><thead><tr><th>From → to</th><th className="num">Referrals</th></tr></thead>
                    <tbody>{d.referrals.flows.map((x) => <tr key={`${x.from}${x.to}`}><td>{x.from} → {x.to}</td><td className="num">{x.n}</td></tr>)}</tbody></table>
                </>
              )}
            </div>
          </div>

          <div className="gv-card">
            <div className="gv-head" style={{ marginBottom: 6 }}>
              <h3 style={{ margin: 0 }}>{focus === 'facility' ? 'Facility' : 'Facilities'}</h3>
              <button className="gv-btn sm ghost" onClick={() => exportView('facilities')}>Export</button>
            </div>
            <div className="gv-sub">{focus === 'facility' ? '' : 'Click a facility to see only its figures.'}</div>
            <table className="gv-table">
              <thead><tr><th>Facility</th><th>District</th><th className="num">Investigations</th><th className="num">Within TAT</th><th className="num">Avg TAT</th><th className="num">Rejection</th><th className="num">IQC reject</th><th className="num">Analyzers</th><th className="num">Uptime</th><th className="num">Tests/analyzer/day</th><th className="num">Referred out/in</th></tr></thead>
              <tbody>{d.facilities.map((f) => (
                <tr key={f.branch_id} className={kind !== 'facility' ? 'clickable' : ''} onClick={() => kind !== 'facility' && go({ branch_id: String(f.branch_id), district_id: String(f.district_id || '') })}>
                  <td><b>{f.branch_name}</b></td><td>{f.district}</td><td className="num">{nf(f.tests)}</td>
                  <td className="num">{fmtPct(f.tat_compliance_pct)}</td><td className="num">{fmtMin(f.avg_tat)}</td><td className="num">{fmtPct(f.rejection_pct)}</td><td className="num">{fmtPct(f.qc_reject_pct)}</td>
                  <td className="num">{f.machines}</td><td className="num">{fmtPct(f.uptime_pct)}</td><td className="num">{f.tests_per_machine_day ?? '—'}</td><td className="num">{f.referred_out} / {f.referred_in}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          <div className="gv-grid2">
            <div className="gv-card">
              <h3>Reagent use</h3>
              <div className="gv-sub">{d.reagents.changes} lot changes{d.reagents.expired_loads > 0 && ` · ${d.reagents.expired_loads} expired lot(s) loaded`}</div>
              {d.reagents.by_reagent.length === 0 ? <div className="gv-empty">No reagent changes recorded in this period.</div> : (
                <table className="gv-table"><thead><tr><th>Reagent</th><th className="num">Changes</th><th className="num">Issued</th><th className="num">Expired loads</th></tr></thead>
                  <tbody>{d.reagents.by_reagent.map((x) => <tr key={x.reagent}><td>{x.reagent}</td><td className="num">{x.changes}</td><td className="num">{x.quantity}</td><td className="num">{x.expired_loads || '—'}</td></tr>)}</tbody></table>
              )}
            </div>
            <div className="gv-card">
              <h3>Free-scheme (programme) monitoring</h3>
              <div className="gv-sub">{nf(k.scheme_bills)} of {nf(k.bills)} bills were under a scheme · manual result entries: {fmtPct(k.manual_entry_pct)}</div>
              {d.programme.schemes.length === 0 ? <div className="gv-empty">No scheme bills in this period.</div> : (
                <table className="gv-table"><thead><tr><th>Scheme</th><th className="num">Bills</th><th className="num">Bill value</th></tr></thead>
                  <tbody>{d.programme.schemes.map((x) => <tr key={x.scheme}><td>{x.scheme}</td><td className="num">{nf(x.bills)}</td><td className="num">₹{nf(x.value)}</td></tr>)}</tbody></table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
