import { useState, useEffect, useMemo } from 'react';
import {
  Package,
  LayoutList,
  Wallet,
  AlertTriangle,
  Clock,
  Ban,
  CheckCircle
} from 'lucide-react';
import '../../assets/CSS/InventoryNetworkDashboard.css';

const API = import.meta.env.VITE_API_URL || '';

const fmt = (n) => new Intl.NumberFormat('en-IN').format(Math.round(n || 0));
const fmtRs = (n) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0)}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

const CAT_COLORS = ['#1a56db', '#0d9488', '#7c3aed', '#d97706', '#16a34a', '#db2777', '#dc2626', '#0ea5e9'];

// ─── Mini Consumption Line ────────────────────────────────────────────────────
function TrendLine({ trend }) {
  if (!trend || trend.length < 2) return <span style={{ color: '#94a3b8', fontSize: 12 }}>No data</span>;
  const W = 160, H = 36;
  const vals = trend.map(t => Number(t.consumed) || 0);
  const max = Math.max(...vals, 1);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * W},${H - (v / max) * (H - 4)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="#1a56db" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, color = '#1a56db', danger }) {
  return (
    <div className={`inv-net-kpi ${danger ? 'danger' : ''}`} style={{ borderTop: `3px solid ${color}` }}>
      <div className="inv-net-kpi-icon" style={{ background: color + '18' }}>{icon}</div>
      <div className="inv-net-kpi-body">
        <div className="inv-net-kpi-val">{value}</div>
        <div className="inv-net-kpi-label">{label}</div>
        {sub && <div className="inv-net-kpi-sub">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Category Donut ───────────────────────────────────────────────────────────
function CategoryDonut({ data }) {
  const total = data.reduce((s, d) => s + Number(d.item_count), 0);
  if (!total) return <div className="inv-net-empty">No category data</div>;
  let cum = -90;
  const R = 54, cx = 68, cy = 68, sw = 18, circ = 2 * Math.PI * R;
  const slices = data.map((d, i) => {
    const frac = d.item_count / total;
    const rot = cum;
    cum += frac * 360;
    return { ...d, frac, rot, da: `${(frac * circ).toFixed(1)} ${circ.toFixed(1)}`, color: CAT_COLORS[i % CAT_COLORS.length] };
  });
  return (
    <div className="inv-net-donut-wrap">
      <svg viewBox="0 0 136 136" className="inv-net-donut-svg">
        {slices.map((s, i) => (
          <circle key={i} cx={cx} cy={cy} r={R} fill="none" stroke={s.color}
            strokeWidth={sw} strokeDasharray={s.da} strokeDashoffset={0}
            transform={`rotate(${s.rot} ${cx} ${cy})`} />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="15" fontWeight="700" fill="#0f172a" fontFamily="Georgia, serif">{total}</text>
        <text x={cx} y={cx + 12} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="Georgia, serif">Items</text>
      </svg>
      <div className="inv-net-donut-legend">
        {slices.map((s, i) => (
          <div key={i} className="inv-net-legend-row">
            <span className="inv-net-legend-dot" style={{ background: s.color }} />
            <span className="inv-net-legend-cat">{s.category}</span>
            <span className="inv-net-legend-val">{fmt(s.total_qty)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Stock Status Badge ───────────────────────────────────────────────────────
const STATUS_STYLE = {
  'OK': { bg: '#dcfce7', color: '#166534' },
  'Low': { bg: '#fef3c7', color: '#92400e' },
  'Critical': { bg: '#fee2e2', color: '#991b1b' },
  'Out of Stock': { bg: '#f1f5f9', color: '#64748b' },
};

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function InventoryNetworkDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const roleLevel = localStorage.getItem('role_level') || 'Branch';
  const branchId = localStorage.getItem('branch_id');
  const districtId = localStorage.getItem('district_id');
  const token = localStorage.getItem('hims_token');

  useEffect(() => {
    let url = `${API}/api/inventory-network/branch?branch_id=${branchId}`;
    if (roleLevel === 'Central') url = `${API}/api/inventory-network/central`;
    if (roleLevel === 'Sub-Central') url = `${API}/api/inventory-network/sub-central?district_id=${districtId}`;

    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError('Failed to load inventory dashboard.'); setLoading(false); });
  }, []);

  if (loading) return <div className="inv-net-loading"><div className="inv-net-spinner" />Loading inventory data…</div>;
  if (error) return <div className="inv-net-error">{error}</div>;
  if (!data?.success) return <div className="inv-net-error">No inventory data returned from server.</div>;

  const { kpis, byCategory, topConsumed, perBranch, lowStockList, recentGrn, consumptionTrend, stockItems, consumption } = data;

  const headerMeta = {
    'Central': { title: 'Central Inventory Command', sub: 'State-wide stock overview' },
    'Sub-Central': { title: 'District Inventory Dashboard', sub: 'District-level stock & consumption' },
    'Branch': { title: 'Facility Inventory Dashboard', sub: 'Your stock levels & consumption' },
  };
  const meta = headerMeta[roleLevel] || headerMeta.Branch;

  return (
    <div className="inv-net-page">

      {/* Header */}
      <div className="inv-net-header">
        <div className="inv-net-header-left">
          <div className="inv-net-header-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Package size={24} color="white" />
          </div>
          <div>
            <div className="inv-net-header-title">{meta.title}</div>
            <div className="inv-net-header-sub">{meta.sub} · {new Date().toLocaleDateString('en-IN', { dateStyle: 'full' })}</div>
          </div>
        </div>
        <div className="inv-net-role-badge">{roleLevel}</div>
      </div>

      {/* KPI Row */}
      <div className="inv-net-kpi-row">
        <KpiCard icon={<LayoutList size={20} color="#1a56db" />} label="Total Items" value={fmt(kpis.total_items)} color="#1a56db" />
        <KpiCard icon={<Wallet size={20} color="#0d9488" />} label="Stock Value" value={fmtRs(kpis.total_value)} color="#0d9488" />
        <KpiCard icon={<AlertTriangle size={20} color="#d97706" />} label="Low Stock" value={fmt(kpis.low_stock)} sub="Need reorder" color="#d97706" danger={kpis.low_stock > 0} />
        <KpiCard icon={<Clock size={20} color="#7c3aed" />} label="Expiring Soon" value={fmt(kpis.expiring_30)} sub="Within 30 days" color="#7c3aed" danger={kpis.expiring_30 > 0} />
        <KpiCard icon={<Ban size={20} color="#dc2626" />} label="Expired" value={fmt(kpis.expired)} sub="Action required" color="#dc2626" danger={kpis.expired > 0} />
      </div>

      {/* Charts Row */}
      <div className="inv-net-charts-row">

        {/* Category breakdown */}
        <div className="inv-net-card">
          <div className="inv-net-card-head">
            <span className="inv-net-card-title">Stock by Category</span>
            <span className="inv-net-card-sub">All items</span>
          </div>
          <CategoryDonut data={byCategory || []} />
        </div>

        {/* Consumption trend */}
        <div className="inv-net-card">
          <div className="inv-net-card-head">
            <span className="inv-net-card-title">30-Day Consumption Trend</span>
            <span className="inv-net-card-sub">Units consumed daily</span>
          </div>
          <div className="inv-net-trend-wrap">
            <TrendLine trend={consumptionTrend} />
            {consumptionTrend && consumptionTrend.length > 0 && (
              <div className="inv-net-trend-labels">
                <span>{fmtDate(consumptionTrend[0]?.day)}</span>
                <span>{fmtDate(consumptionTrend[consumptionTrend.length - 1]?.day)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Top consumed */}
        <div className="inv-net-card">
          <div className="inv-net-card-head">
            <span className="inv-net-card-title">Top Consumed (30 Days)</span>
            <span className="inv-net-card-sub">By volume</span>
          </div>
          <div className="inv-net-horiz-bars">
            {(topConsumed || consumption || []).slice(0, 8).map((item, i) => {
              const maxC = Math.max(...(topConsumed || consumption || []).map(x => Number(x.total_consumed) || Number(x.consumed)), 1);
              const pct = (Number(item.total_consumed || item.consumed) / maxC) * 100;
              return (
                <div key={i} className="inv-net-hbar-row">
                  <div className="inv-net-hbar-label" title={item.item_name}>{item.item_name}</div>
                  <div className="inv-net-hbar-track">
                    <div className="inv-net-hbar-fill" style={{ width: `${pct}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} />
                  </div>
                  <div className="inv-net-hbar-val">{item.total_consumed || item.consumed} {item.unit}</div>
                </div>
              );
            })}
            {!(topConsumed || consumption)?.length && <div className="inv-net-empty">No consumption this month</div>}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="inv-net-bottom-row">

        {/* Per-Branch table — Central & Sub-Central */}
        {(roleLevel === 'Central' || roleLevel === 'Sub-Central') && perBranch && (
          <div className="inv-net-card inv-net-table-card">
            <div className="inv-net-card-head">
              <span className="inv-net-card-title">
                {roleLevel === 'Central' ? 'All Facilities — Stock Summary' : 'District Facilities — Stock Summary'}
              </span>
              <span className="inv-net-card-sub">{perBranch.length} facilities</span>
            </div>
            <div className="inv-net-table-wrap">
              <table className="inv-net-table">
                <thead>
                  <tr><th>Facility</th><th>Level</th><th>Items Tracked</th><th>Total Units</th><th>Low Stock</th><th>Stock Value</th></tr>
                </thead>
                <tbody>
                  {perBranch.map(b => (
                    <tr key={b.id}>
                      <td><div className="inv-tbl-name">{b.branch_name}</div><div className="inv-tbl-code">{b.hospital_code}</div></td>
                      <td><span className="inv-tbl-level">{b.branch_level || 'Center'}</span></td>
                      <td className="inv-tbl-num">{b.item_count}</td>
                      <td className="inv-tbl-num">{fmt(b.total_units)}</td>
                      <td>{b.low_stock_items > 0 ? <span className="inv-tbl-alert" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><AlertTriangle size={12} /> {b.low_stock_items}</span> : <span className="inv-tbl-ok" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle size={12} /> OK</span>}</td>
                      <td className="inv-tbl-rev">{roleLevel === 'Central' ? fmtRs(b.stock_value) : '—'}</td>
                    </tr>
                  ))}
                  {perBranch.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: '28px' }}>No facility data</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Branch: own stock items */}
        {roleLevel === 'Branch' && stockItems && (
          <div className="inv-net-card inv-net-table-card">
            <div className="inv-net-card-head">
              <span className="inv-net-card-title">Your Stock Items</span>
              <span className="inv-net-card-sub">{stockItems.length} items</span>
            </div>
            <div className="inv-net-table-wrap">
              <table className="inv-net-table">
                <thead>
                  <tr><th>Item</th><th>Category</th><th>Available</th><th>Min Level</th><th>Batches</th><th>Nearest Expiry</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {stockItems.slice(0, 20).map((item, i) => {
                    const st = item.available_stock === 0 ? 'Out of Stock' : item.available_stock <= item.min_stock_level ? 'Critical' : item.available_stock <= item.reorder_level ? 'Low' : 'OK';
                    const style = STATUS_STYLE[st] || STATUS_STYLE.OK;
                    return (
                      <tr key={i}>
                        <td><div className="inv-tbl-name">{item.item_name}</div><div className="inv-tbl-code">{item.item_code}</div></td>
                        <td style={{ fontSize: 11, color: '#64748b' }}>{item.category}</td>
                        <td className="inv-tbl-num">{fmt(item.available_stock)} {item.unit}</td>
                        <td style={{ fontSize: 12, color: '#94a3b8' }}>{item.min_stock_level}</td>
                        <td className="inv-tbl-num">{item.batch_count}</td>
                        <td style={{ fontSize: 12 }}>{fmtDate(item.nearest_expiry)}</td>
                        <td><span className="inv-status-badge" style={style}>{st}</span></td>
                      </tr>
                    );
                  })}
                  {(!stockItems || stockItems.length === 0) && <tr><td colSpan={7} style={{ textAlign: 'center', color: '#94a3b8', padding: '28px' }}>No stock items found</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Right column */}
        <div className="inv-net-right-col">

          {/* Low Stock Alerts */}
          <div className="inv-net-card">
            <div className="inv-net-card-head">
              <span className="inv-net-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={18} color="#d97706" /> Low Stock Alerts
              </span>
              <span className="inv-net-card-sub" style={{ color: '#d97706' }}>{lowStockList?.length || 0} items</span>
            </div>
            <div className="inv-net-alert-list">
              {(!lowStockList || lowStockList.length === 0) && <div className="inv-net-empty" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>All items well-stocked <CheckCircle size={16} color="#16a34a" /></div>}
              {(lowStockList || []).map((item, i) => (
                <div key={i} className="inv-net-alert-row">
                  <div>
                    <div className="inv-tbl-name" style={{ fontSize: 12 }}>{item.item_name}</div>
                    <div className="inv-tbl-code">{item.item_code} · {item.category}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, color: '#dc2626', fontSize: 14 }}>{item.available_stock} {item.unit}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>Reorder: {item.reorder_level}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent GRNs — Central only */}
          {roleLevel === 'Central' && recentGrn && (
            <div className="inv-net-card">
              <div className="inv-net-card-head">
                <span className="inv-net-card-title">Recent Purchase Orders</span>
              </div>
              <div className="inv-net-alert-list">
                {recentGrn.map((g, i) => (
                  <div key={i} className="inv-net-alert-row">
                    <div>
                      <div className="inv-tbl-name" style={{ fontSize: 12 }}>{g.po_number}</div>
                      <div className="inv-tbl-code">{g.vendor_name} · {fmtDate(g.receipt_date)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color: '#0d9488', fontSize: 13 }}>{fmtRs(g.total_amount)}</div>
                      <div style={{ fontSize: 10, color: g.status === 'Approved' ? '#16a34a' : '#d97706' }}>{g.status}</div>
                    </div>
                  </div>
                ))}
                {!recentGrn?.length && <div className="inv-net-empty">No recent GRNs</div>}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
