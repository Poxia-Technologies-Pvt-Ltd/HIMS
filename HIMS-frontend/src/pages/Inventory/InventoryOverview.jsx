import { useState, useEffect, useMemo } from 'react';
import {
  Box,
  ClipboardList,
  LayoutGrid,
  Building2,
  Download,
  CheckCircle,
  X,
  Search,
  RotateCcw,
  IndianRupee,
  AlertTriangle,
  Clock,
  PackageX
} from 'lucide-react';
import '../../assets/CSS/InventoryNetworkDashboard.css';

const API = import.meta.env.VITE_API_URL || '';

const fmt = (n) => new Intl.NumberFormat('en-IN').format(Math.round(n || 0));
const fmtRs = (n) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0)}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

const STATUS_STYLE = {
  'OK': { bg: '#dcfce7', color: '#166534' },
  'Low': { bg: '#fef3c7', color: '#92400e' },
  'Critical': { bg: '#fee2e2', color: '#991b1b' },
  'Out of Stock': { bg: '#f1f5f9', color: '#475569' },
};

const CATEGORIES = ['All', 'Reagents', 'Consumables', 'Test Kits', 'Calibrators', 'Controls', 'Glassware', 'General Lab Supplies'];

export default function InventoryOverview() {
  const [items, setItems] = useState([]);
  const [facilityStock, setFacilityStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('All');
  const [statusFilter, setStatus] = useState('All');
  const [viewMode, setViewMode] = useState('catalog'); // 'catalog' | 'facility'

  const roleLevel = localStorage.getItem('role_level') || 'Branch';
  const branchId = localStorage.getItem('branch_id');
  const districtId = localStorage.getItem('district_id');
  const token = localStorage.getItem('hims_token');

  useEffect(() => {
    const params = new URLSearchParams({ role_level: roleLevel });
    if (roleLevel === 'Sub-Central') params.append('district_id', districtId);
    if (roleLevel === 'Branch') params.append('branch_id', branchId);

    fetch(`${API}/api/inventory-network/overall?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setItems(d.items || []);
          setFacilityStock(d.facilityStock || []);
        } else {
          setError('Could not load stock data.');
        }
        setLoading(false);
      })
      .catch(() => { setError('Server error loading stock.'); setLoading(false); });
  }, []);

  // Filtered catalog items
  const filtered = useMemo(() => {
    return items.filter(item => {
      const matchSearch = !search || item.item_name.toLowerCase().includes(search.toLowerCase()) || item.item_code.toLowerCase().includes(search.toLowerCase());
      const matchCat = catFilter === 'All' || item.category === catFilter;
      const matchStatus = statusFilter === 'All' || item.stock_status === statusFilter;
      return matchSearch && matchCat && matchStatus;
    });
  }, [items, search, catFilter, statusFilter]);

  // Summary stats
  const summary = useMemo(() => ({
    total: items.length,
    ok: items.filter(i => i.stock_status === 'OK').length,
    low: items.filter(i => i.stock_status === 'Low').length,
    critical: items.filter(i => i.stock_status === 'Critical').length,
    outOfStock: items.filter(i => i.stock_status === 'Out of Stock').length,
    totalValue: items.reduce((s, i) => s + Number(i.stock_value), 0),
  }), [items]);

  // Group facility stock by branch (for table view)
  const facilityGroups = useMemo(() => {
    const groups = {};
    facilityStock.forEach(row => {
      if (!groups[row.branch_id]) groups[row.branch_id] = { branch_name: row.branch_name, hospital_code: row.hospital_code, branch_level: row.branch_level, items: [] };
      groups[row.branch_id].items.push(row);
    });
    return Object.values(groups);
  }, [facilityStock]);

  const exportCatalogCSV = () => {
    if (!filtered.length) return;
    const headers = ['Item Name', 'Code', 'Category', 'Unit', 'Available', 'Consumed', 'Batches', 'Expiry', 'Status'];
    if (roleLevel === 'Central') headers.push('Value');

    const csvRows = [headers.join(',')];
    filtered.forEach(item => {
      const row = [
        `"${item.item_name}"`,
        item.item_code,
        item.category,
        item.unit,
        item.available_stock,
        item.consumed_stock,
        item.active_batches,
        item.nearest_expiry || '—',
        item.stock_status
      ];
      if (roleLevel === 'Central') row.push(item.stock_value);
      csvRows.push(row.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Inventory_Catalog_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const exportFacilityCSV = () => {
    if (!facilityStock.length) return;
    const headers = ['Branch Name', 'Code', 'Level', 'Item Name', 'Item Code', 'Category', 'Available', 'Current Stock', 'Unit'];
    const csvRows = [headers.join(',')];

    facilityStock.forEach(item => {
      csvRows.push([
        `"${item.branch_name}"`,
        item.hospital_code,
        item.branch_level,
        `"${item.item_name}"`,
        item.item_code,
        item.category,
        item.available_stock,
        item.current_stock,
        item.unit
      ].join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Facility_Stock_Log_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  if (loading) return <div className="inv-net-loading"><div className="inv-net-spinner" />Loading stock overview…</div>;
  if (error) return <div className="inv-net-error">{error}</div>;

  const titleMap = {
    'Central': 'State-wide Overall Inventory',
    'Sub-Central': 'District Overall Inventory',
    'Branch': 'Facility Stock Overview',
  };

  return (
    <div className="inv-net-page">

      {/* Header */}
      <div className="inv-net-header">
        <div className="inv-net-header-left">
          <div className="inv-net-header-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Box size={24} color="#1d4ed8" />
          </div>
          <div>
            <div className="inv-net-header-title">{titleMap[roleLevel] || 'Inventory Overview'}</div>
            <div className="inv-net-header-sub">Real-time stock visibility · {new Date().toLocaleDateString('en-IN', { dateStyle: 'full' })}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {(roleLevel === 'Central' || roleLevel === 'Sub-Central') && facilityStock.length > 0 && (
            <div className="inv-net-view-toggle">
              <button className={viewMode === 'catalog' ? 'active' : ''} onClick={() => setViewMode('catalog')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ClipboardList size={14} /> Catalog
              </button>
              <button className={viewMode === 'facility' ? 'active' : ''} onClick={() => setViewMode('facility')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Building2 size={14} /> By Facility
              </button>
            </div>
          )}
          <div className="inv-net-role-badge">{roleLevel}</div>
          <button
            className="inv-net-export-btn"
            onClick={viewMode === 'catalog' ? exportCatalogCSV : exportFacilityCSV}
          >
            <Download size={16} /> Export CSV
          </button>
        </div>
      </div>

      {/* Summary Pills */}
      <div className="inv-net-summary-row">
        <div className="inv-summary-pill">
          <span className="inv-summary-num">{summary.total}</span>
          <span className="inv-summary-label">Total Items</span>
        </div>
        <div className="inv-summary-pill ok" onClick={() => setStatus('OK')}>
          <span className="inv-summary-num">
            <CheckCircle size={18} /> {summary.ok}
          </span>
          <span className="inv-summary-label">OK</span>
        </div>
        <div className="inv-summary-pill low" onClick={() => setStatus('Low')}>
          <span className="inv-summary-num">{summary.low}</span>
          <span className="inv-summary-label">Low Stock</span>
        </div>
        <div className="inv-summary-pill critical" onClick={() => setStatus('Critical')}>
          <span className="inv-summary-num">{summary.critical}</span>
          <span className="inv-summary-label">Critical</span>
        </div>
        <div className="inv-summary-pill oos" onClick={() => setStatus('Out of Stock')}>
          <span className="inv-summary-num">{summary.outOfStock}</span>
          <span className="inv-summary-label">Out of Stock</span>
        </div>
        {roleLevel === 'Central' && (
          <div className="inv-summary-pill value">
            <span className="inv-summary-num">
              <IndianRupee size={18} /> {fmt(summary.totalValue)}
            </span>
            <span className="inv-summary-label">Total Value</span>
          </div>
        )}
        {statusFilter !== 'All' && (
          <button className="inv-net-clear-btn" onClick={() => setStatus('All')}>
            <X size={14} /> Clear Filter
          </button>
        )}
      </div>

      {/* ── CATALOG VIEW ── */}
      {viewMode === 'catalog' && (
        <>
          {/* Filters */}
          <div className="inv-net-filters" style={{ position: 'relative' }}>
            <Search style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} size={16} />
            <input
              className="inv-net-search"
              style={{ paddingLeft: '40px' }}
              placeholder="Search by name or code…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select className="inv-net-select" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          {/* Stock Table */}
          <div className="inv-net-card" style={{ padding: 0 }}>
            <div className="inv-net-table-wrap">
              <table className="inv-net-table inv-net-table-full">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Item</th>
                    <th>Category</th>
                    <th>Unit</th>
                    <th>Available</th>
                    <th>Consumed</th>
                    <th>Batches</th>
                    <th>Nearest Expiry</th>
                    <th>Days to Expiry</th>
                    {roleLevel === 'Central' && <th>Value</th>}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item, i) => {
                    const st = STATUS_STYLE[item.stock_status] || STATUS_STYLE.OK;
                    const expDanger = item.days_to_expiry !== null && item.days_to_expiry <= 30;
                    return (
                      <tr key={item.id} className={item.stock_status !== 'OK' ? 'row-warn' : ''}>
                        <td style={{ color: '#94a3b8', width: 36 }}>{i + 1}</td>
                        <td>
                          <div className="inv-tbl-name">{item.item_name}</div>
                          <div className="inv-tbl-code">{item.item_code}</div>
                        </td>
                        <td style={{ fontSize: 11, color: '#64748b' }}>{item.category}</td>
                        <td style={{ fontSize: 12, color: '#64748b' }}>{item.unit}</td>
                        <td className="inv-tbl-num">{fmt(item.available_stock)}</td>
                        <td style={{ fontSize: 13, color: '#0d9488', fontWeight: 600 }}>{fmt(item.consumed_stock)}</td>
                        <td className="inv-tbl-num">{item.active_batches}</td>
                        <td style={{ fontSize: 12, color: expDanger ? '#dc2626' : '#334155' }}>{fmtDate(item.nearest_expiry)}</td>
                        <td>
                          {item.days_to_expiry !== null
                            ? <span style={{ fontSize: 11, fontWeight: 700, color: item.days_to_expiry <= 7 ? '#dc2626' : item.days_to_expiry <= 30 ? '#d97706' : '#16a34a' }}>
                              {item.days_to_expiry}d
                            </span>
                            : <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>
                          }
                        </td>
                        {roleLevel === 'Central' && <td className="inv-tbl-rev">{fmtRs(item.stock_value)}</td>}
                        <td><span className="inv-status-badge" style={{ background: st.bg, color: st.color }}>{item.stock_status}</span></td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={roleLevel === 'Central' ? 11 : 10} style={{ textAlign: 'center', color: '#94a3b8', padding: '40px' }}>No items match your filters</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="inv-net-table-footer">
              Showing {filtered.length} of {items.length} items
            </div>
          </div>
        </>
      )}

      {/* ── FACILITY VIEW — Central / Sub-Central ── */}
      {viewMode === 'facility' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {facilityGroups.map((group, gi) => (
            <div key={gi} className="inv-net-card" style={{ padding: 0 }}>
              <div className="inv-net-card-head" style={{ background: '#f8fafc' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🏥</span>
                  <div>
                    <div className="inv-tbl-name">{group.branch_name}</div>
                    <div className="inv-tbl-code">{group.hospital_code} · {group.branch_level}</div>
                  </div>
                </div>
                <span className="inv-net-card-sub">{group.items.length} items with stock</span>
              </div>
              <div className="inv-net-table-wrap">
                <table className="inv-net-table">
                  <thead>
                    <tr><th>Item</th><th>Category</th><th>Available</th><th>Current Stock</th><th>Unit</th></tr>
                  </thead>
                  <tbody>
                    {group.items.map((item, j) => (
                      <tr key={j}>
                        <td><div className="inv-tbl-name" style={{ fontSize: 12 }}>{item.item_name}</div><div className="inv-tbl-code">{item.item_code}</div></td>
                        <td style={{ fontSize: 11, color: '#64748b' }}>{item.category}</td>
                        <td className="inv-tbl-num">{fmt(item.available_stock)}</td>
                        <td className="inv-tbl-num">{fmt(item.current_stock)}</td>
                        <td style={{ fontSize: 11, color: '#94a3b8' }}>{item.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {facilityGroups.length === 0 && (
            <div className="inv-net-empty" style={{ padding: 40 }}>No facility stock data available. Stock may not be department-tracked yet.</div>
          )}
        </div>
      )}

    </div>
  );
}
