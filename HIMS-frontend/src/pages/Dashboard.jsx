import { useState, useEffect, useMemo } from 'react';
import {
  Users,
  FlaskConical,
  Clock,
  IndianRupee,
  Hospital,
  ShieldCheck,
  Map,
  Microscope,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Home,
  Monitor,
  RefreshCw,
  Search
} from 'lucide-react';
import '../assets/CSS/Dashboard.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

// ─── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat('en-IN').format(Math.round(n || 0));
const fmtRs = (n) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0)}`;
const pct = (c) => { const v = Number(c); if (!v) return null; return { val: Math.abs(v), up: v >= 0 }; };
const LEVEL_COLOR = { Central: '#0d2554', 'Sub-Central': '#1a56db', Center: '#0ea5e9' };
const LEVEL_BG = { Central: '#e8edf8', 'Sub-Central': '#dbeafe', Center: '#e0f2fe' };
const STATUS_COLOR = { Approved: '#16a34a', 'Test Done': '#1a56db', Pending: '#d97706', Collected: '#0ea5e9', 'In Progress': '#7c3aed' };

// ─── Line Graph (7-Day Trend) ────────────────────────────────────────────────
function LineGraph({ data, valueKey = 'tests', color = '#1a56db' }) {
  if (!data || data.length === 0) return <div className="dash-chart-empty">No data this week</div>;
  const W = 560, H = 160, padL = 36, padB = 28, padT = 16, padR = 16;
  const gW = W - padL - padR;
  const gH = H - padT - padB;
  const vals = data.map(d => Number(d[valueKey]) || 0);
  const max = Math.max(...vals, 1);
  const pts = vals.map((v, i) => ({
    x: padL + (i / (vals.length - 1)) * gW,
    y: padT + gH - (v / max) * gH,
    v, label: new Date(data[i].day).toLocaleDateString('en-IN', { weekday: 'short' })
  }));
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${(padT + gH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(padT + gH).toFixed(1)} Z`;
  const gradId = `lg-${color.replace('#', '')}`;
  // Y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({ val: Math.round(max * f), y: padT + gH - f * gH }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="line-graph-svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Grid lines */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="#e2e8f0" strokeWidth="1" />
          <text x={padL - 6} y={t.y + 4} textAnchor="end" fontSize="9" fill="#94a3b8" fontFamily="Georgia, serif">{t.val}</text>
        </g>
      ))}
      {/* Area fill */}
      <path d={areaPath} fill={`url(#${gradId})`} />
      {/* Line */}
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* Dots + labels */}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4" fill="white" stroke={color} strokeWidth="2.5" />
          <text x={p.x} y={H - 6} textAnchor="middle" fontSize="10" fill="#64748b" fontFamily="Georgia, serif">{p.label}</text>
          <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="9" fill={color} fontWeight="700" fontFamily="Georgia, serif">{p.v}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── Horizontal Bar Chart (Top Tests) ───────────────────────────────────────
function HorizBarChart({ data }) {
  if (!data || data.length === 0) return <div className="dash-chart-empty">No tests recorded this month</div>;
  const max = Math.max(...data.map(d => Number(d.count)), 1);
  const COLORS = ['#1a56db', '#0ea5e9', '#0d9488', '#7c3aed', '#d97706', '#16a34a', '#db2777', '#dc2626'];
  return (
    <div className="horiz-bar-chart">
      {data.map((d, i) => {
        const pct = (Number(d.count) / max) * 100;
        return (
          <div className="horiz-bar-row" key={i}>
            <div className="horiz-bar-label" title={d.test_name || d.category}>{d.test_name || d.category}</div>
            <div className="horiz-bar-track">
              <div className="horiz-bar-fill" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }} />
            </div>
            <div className="horiz-bar-count">{d.count}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Sparkline (KPI cards) ───────────────────────────────────────────────────
function Sparkline({ points, color = '#1a56db', height = 44, width = 160 }) {
  if (!points || points.length < 2) return null;
  const max = Math.max(...points, 1);
  const pts = points.map((v, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - (v / max) * (height - 4);
    return `${x},${y}`;
  }).join(' ');
  const areaBot = `${width},${height} 0,${height}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sp-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`${pts} ${areaBot}`} fill={`url(#sp-${color.replace('#', '')})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Donut Chart (Category) ───────────────────────────────────────────────────
const DONUT_COLORS = ['#1a56db', '#0ea5e9', '#0d9488', '#7c3aed', '#db2777', '#d97706', '#16a34a', '#dc2626', '#6366f1', '#f59e0b'];

function DonutChart({ data }) {
  const total = data.reduce((s, d) => s + Number(d.count), 0);
  if (!total) return <div className="dash-chart-empty">No data this month</div>;
  let cumAngle = -90;
  const R = 58, cx = 76, cy = 76, strokeW = 20;
  const circ = 2 * Math.PI * R;
  const slices = data.map((d, i) => {
    const frac = d.count / total;
    const startAngle = cumAngle;
    cumAngle += frac * 360;
    return { ...d, frac, dashArray: `${(frac * circ).toFixed(2)} ${circ.toFixed(2)}`, rot: startAngle, color: DONUT_COLORS[i % DONUT_COLORS.length] };
  });
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 152 152" className="donut-svg">
        {slices.map((s, i) => (
          <circle key={i} cx={cx} cy={cy} r={R} fill="none" stroke={s.color} strokeWidth={strokeW}
            strokeDasharray={s.dashArray} strokeDashoffset={0} transform={`rotate(${s.rot} ${cx} ${cy})`} />
        ))}
        <text x={cx} y={cy - 5} textAnchor="middle" className="donut-total-num">{fmt(total)}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="donut-total-lbl">Tests</text>
      </svg>
      <div className="donut-legend">
        {slices.map((s, i) => (
          <div key={i} className="donut-legend-row">
            <span className="donut-dot" style={{ background: s.color }} />
            <span className="donut-cat">{s.category}</span>
            <span className="donut-pct">{(s.frac * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Shared sub-components ───────────────────────────────────────────────────
function KpiCards({ kpis, spark }) {
  const cards = [
    { id: 'patients', label: "Today's Patients", value: fmt(kpis.patients.today), change: pct(kpis.patients.change), icon: <Users size={20} />, color: '#1a56db', spark: spark.tests },
    { id: 'tests', label: "Tests Done Today", value: fmt(kpis.tests.today), change: pct(kpis.tests.change), icon: <FlaskConical size={20} />, color: '#0d9488', spark: spark.tests },
    { id: 'pending', label: "Pending Tests", value: fmt(kpis.pending.value), change: null, icon: <Clock size={20} />, color: '#d97706', spark: null },
    { id: 'revenue', label: "Today's Revenue", value: fmtRs(kpis.revenue.today), sub: `Month: ${fmtRs(kpis.revenue.month)}`, icon: <IndianRupee size={20} />, color: '#16a34a', spark: spark.revenue },
  ];
  return (
    <div className="dash-kpi-row">
      {cards.map(card => (
        <div className="dash-kpi-card" key={card.id}>
          <div className="dash-kpi-top">
            <div className="dash-kpi-icon" style={{ background: card.color + '18', color: card.color }}>{card.icon}</div>
            {card.change && (
              <span className={`dash-kpi-badge ${card.change.up ? 'up' : 'down'}`}>
                {card.change.up ? <ArrowUpRight size={10} style={{ marginRight: 2 }} /> : <ArrowDownRight size={10} style={{ marginRight: 2 }} />}
                {card.change.val}%
              </span>
            )}
          </div>
          <div className="dash-kpi-value">{card.value}</div>
          <div className="dash-kpi-label">{card.label}</div>
          {card.sub && <div className="dash-kpi-sub">{card.sub}</div>}
          {card.spark && <div className="dash-kpi-spark"><Sparkline points={card.spark} color={card.color} /></div>}
        </div>
      ))}
    </div>
  );
}

function ChartsRow({ data, trendPoints }) {
  const [activeTab, setActiveTab] = useState('tests');
  const trendData = trendPoints.labels?.map((d, i) => ({
    day: d,
    tests: trendPoints.tests[i],
    revenue: trendPoints.revenue[i]
  })) || [];
  return (
    <div className="dash-charts-row">
      <div className="dash-card dash-trend-card">
        <div className="dash-card-header">
          <div className="dash-card-title">7-Day Trend</div>
          <div className="dash-tab-group">
            <button className={`dash-tab ${activeTab === 'tests' ? 'active' : ''}`} onClick={() => setActiveTab('tests')}>Tests</button>
            <button className={`dash-tab ${activeTab === 'revenue' ? 'active' : ''}`} onClick={() => setActiveTab('revenue')}>Revenue</button>
          </div>
        </div>
        <div className="line-graph-wrap">
          <LineGraph data={trendData} valueKey={activeTab} color={activeTab === 'tests' ? '#1a56db' : '#16a34a'} />
        </div>
      </div>
      <div className="dash-card dash-donut-card">
        <div className="dash-card-header">
          <div className="dash-card-title">Tests by Category</div>
          <div className="dash-card-sub">This month</div>
        </div>
        <DonutChart data={data.testBreakdown || []} />
      </div>
    </div>
  );
}

function FacilityTable({ perBranch }) {
  return (
    <div className="dash-card dash-table-card">
      <div className="dash-card-header">
        <div className="dash-card-title">Facility Performance Today</div>
        <div className="dash-card-sub">{perBranch?.length || 0} facilities</div>
      </div>
      <div className="dash-table-wrap">
        <table className="dash-table">
          <thead><tr><th>Facility</th><th>Level</th><th>Patients</th><th>Tests</th><th>Pending</th><th>Revenue</th></tr></thead>
          <tbody>
            {(perBranch || []).map(b => (
              <tr key={b.id}>
                <td><div className="dash-tbl-name">{b.branch_name}</div><div className="dash-tbl-code">{b.hospital_code}</div></td>
                <td><span className="dash-level-badge" style={{ background: LEVEL_BG[b.branch_level] || '#f1f5f9', color: LEVEL_COLOR[b.branch_level] || '#475569' }}>{b.branch_level || 'Center'}</span></td>
                <td className="dash-tbl-num">{b.today_patients}</td>
                <td className="dash-tbl-num dash-tbl-tests">{b.today_tests}</td>
                <td><span className={`dash-pending-badge ${b.pending_tests > 0 ? 'has-pending' : ''}`}>{b.pending_tests}</span></td>
                <td className="dash-tbl-rev">{fmtRs(b.today_revenue)}</td>
              </tr>
            ))}
            {(!perBranch || perBranch.length === 0) && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: '32px' }}>No data</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActivityFeed({ activity }) {
  return (
    <div className="dash-card dash-activity-card">
      <div className="dash-card-header">
        <div className="dash-card-title">Live Activity</div>
        <div className="dash-live-dot" style={{ width: 8, height: 8 }} />
      </div>
      <div className="dash-activity-list">
        {(!activity || activity.length === 0) && <div className="dash-chart-empty">No recent activity</div>}
        {(activity || []).map((a, i) => (
          <div className="dash-activity-item" key={i}>
            <div className="dash-activity-dot" style={{ background: STATUS_COLOR[a.status] || '#94a3b8' }} />
            <div className="dash-activity-body">
              <div className="dash-activity-label">{a.label}</div>
              <div className="dash-activity-meta">
                {a.branch && <span>{a.branch}</span>}
                <span className="dash-activity-status" style={{ color: STATUS_COLOR[a.status] || '#94a3b8' }}>{a.status}</span>
              </div>
            </div>
            <div className="dash-activity-time">{a.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}


// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const roleLevel = localStorage.getItem('role_level') || 'Branch';
  const branchId = localStorage.getItem('branch_id');
  const districtId = localStorage.getItem('district_id');
  const token = localStorage.getItem('hims_token');

  useEffect(() => {
    let url = `${API_BASE}/api/dashboard/stats`;
    if (roleLevel === 'Central') url = `${API_BASE}/api/dashboard/central`;
    if (roleLevel === 'Sub-Central') url = `${API_BASE}/api/dashboard/sub-central?district_id=${districtId}`;
    if (roleLevel === 'Branch') url = `${API_BASE}/api/dashboard/branch?branch_id=${branchId}`;

    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError('Could not load dashboard.'); setLoading(false); });
  }, []);

  const trendPoints = useMemo(() => {
    if (!data?.trend) return { tests: [], revenue: [], labels: [] };
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d.toISOString().split('T')[0]); }
    const tMap = Object.fromEntries((data.trend.tests || []).map(r => [String(r.day).split('T')[0], Number(r.tests)]));
    const rMap = Object.fromEntries((data.trend.revenue || []).map(r => [String(r.day).split('T')[0], Number(r.revenue)]));
    return { tests: days.map(d => tMap[d] || 0), revenue: days.map(d => rMap[d] || 0), labels: days };
  }, [data]);

  if (loading) return <div className="dash-loading"><div className="dash-spinner" />Loading dashboard…</div>;
  if (error) return <div className="dash-error">{error}</div>;

  const { kpis, activity, perBranch, network, branch, topTests } = data;

  // ── Topbar meta per role ──
  const topMeta = {
    Central: { title: 'Central Command Dashboard', sub: 'State-wide overview' },
    'Sub-Central': { title: 'District Dashboard', sub: `District-level overview` },
    Branch: { title: branch?.branch_name || 'Facility Dashboard', sub: `${branch?.hospital_code || ''} · ${branch?.branch_level || 'Center'}` },
  };
  const meta = topMeta[roleLevel] || topMeta.Branch;

  return (
    <div className="dash-page">
      {/* Topbar */}
      <header className="dash-topbar">
        <div className="dash-topbar-left">
          <div className="dash-topbar-icon">
            <Home size={20} color="white" />
          </div>
          <div>
            <div className="dash-topbar-title">{meta.title}</div>
            <div className="dash-topbar-sub">{meta.sub} · {new Date().toLocaleDateString('en-IN', { dateStyle: 'full' })}</div>
          </div>
        </div>
        <div className="dash-topbar-right">
          <span className="dash-live-dot" /><span className="dash-live-text">Live</span>
        </div>
      </header>

      <div className="dash-body">

        {/* Network strip — Central & Sub-Central only */}
        {roleLevel === 'Central' && network && (
          <div className="dash-network-strip">
            {[
              { label: 'Total Facilities', val: network.total, icon: <Hospital size={22} color="#0d2554" />, sub: 'State-wide' },
              { label: 'Central Hubs', val: network.central, icon: <ShieldCheck size={22} color="#0d2554" />, sub: 'Top-tier' },
              { label: 'Sub-Central Hubs', val: network.subCentral, icon: <Map size={22} color="#1a56db" />, sub: 'District-level' },
              { label: 'Centers & Labs', val: network.centers, icon: <Microscope size={22} color="#0ea5e9" />, sub: 'Primary care' },
            ].map(s => (
              <div className="dash-net-cell" key={s.label}>
                <div className="dash-net-icon">{s.icon}</div>
                <div>
                  <div className="dash-net-num">{s.val}</div>
                  <div className="dash-net-label">{s.label}</div>
                  <div className="dash-net-sub">{s.sub}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {roleLevel === 'Sub-Central' && network && (
          <div className="dash-network-strip">
            {[
              { label: 'Facilities in District', val: network.total, icon: <Hospital size={22} color="#0d2554" />, sub: 'Your jurisdiction' },
              { label: 'Patients Today', val: kpis.patients.today, icon: <Users size={22} color="#1a56db" />, sub: 'Across district' },
              { label: 'Tests Completed', val: kpis.tests.today, icon: <FlaskConical size={22} color="#0d9488" />, sub: 'Today' },
              { label: 'Pending Tests', val: kpis.pending.value, icon: <Clock size={22} color="#d97706" />, sub: 'Action required' },
            ].map(s => (
              <div className="dash-net-cell" key={s.label}>
                <div className="dash-net-icon">{s.icon}</div>
                <div>
                  <div className="dash-net-num">{s.val}</div>
                  <div className="dash-net-label">{s.label}</div>
                  <div className="dash-net-sub">{s.sub}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Branch — show facility info strip */}
        {roleLevel === 'Branch' && branch && (
          <div className="dash-branch-strip">
            <div className="dash-branch-icon"><Hospital size={28} color="#0d2554" /></div>
            <div className="dash-branch-info">
              <div className="dash-branch-name">{branch.branch_name}</div>
              <div className="dash-branch-meta">
                <span className="dash-level-badge" style={{ background: LEVEL_BG[branch.branch_level] || '#e0f2fe', color: LEVEL_COLOR[branch.branch_level] || '#0ea5e9' }}>{branch.branch_level || 'Center'}</span>
                <span style={{ color: '#64748b', fontSize: 13 }}>Code: <strong>{branch.hospital_code}</strong></span>
              </div>
            </div>
          </div>
        )}

        {/* KPIs */}
        <KpiCards kpis={kpis} spark={trendPoints} />

        {/* Charts */}
        <ChartsRow data={data} trendPoints={trendPoints} />

        {/* Bottom row */}
        <div className="dash-bottom-row">
          {/* Central & Sub-Central → facility table; Branch → top tests list */}
          {(roleLevel === 'Central' || roleLevel === 'Sub-Central') && perBranch
            ? <FacilityTable perBranch={perBranch} />
            : (
              <div className="dash-card dash-table-card">
                <div className="dash-card-header">
                  <div className="dash-card-title">Top Tests This Month</div>
                  <div className="dash-card-sub">By volume</div>
                </div>
                <div style={{ padding: '16px 20px' }}>
                  <HorizBarChart data={topTests || []} />
                </div>
              </div>
            )
          }
          <ActivityFeed activity={activity} />
        </div>
      </div>
    </div>
  );
}

