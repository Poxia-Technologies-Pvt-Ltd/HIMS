import React, { useState, useEffect, useMemo, useCallback } from 'react';
import SummaryCards from '../components/DisasterDashboard/SummaryCards';
import MapChart from '../components/DisasterDashboard/MapChart';
import DistrictList from '../components/DisasterDashboard/DistrictList';
import Charts from '../components/DisasterDashboard/Charts';
import AlertPanel from '../components/DisasterDashboard/AlertPanel';
import DrillDownModal from '../components/DisasterDashboard/DrillDownModal';
import ThresholdSettings from '../components/DisasterDashboard/ThresholdSettings';
import { ShieldAlert, Download, RefreshCw, Cpu, SlidersHorizontal } from 'lucide-react';
import { api, saveCsv } from '../utils/govApi';
import '../assets/CSS/DisasterDashboard.css';

const WINDOWS = [['1D', 'Today'], ['3D', '3 Days'], ['7D', '7 Days'], ['14D', '14 Days'], ['30D', '30 Days']];
const RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };
const canSetThresholds = () => ['admin', 'super admin', 'programme officer'].includes((localStorage.getItem('role') || '').toLowerCase());

// Disease surveillance for Karnataka (tender #95-102), computed by the backend
// from approved lab results per facility district, against Government-set
// thresholds (see disasterController.js).
const DisasterDashboard = () => {
  const [timeFilter, setTimeFilter] = useState('7D');
  const [disease, setDisease] = useState('All');
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [rows, setRows] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const fetchData = useCallback(() => Promise.all([
    api(`/api/disaster/surveillance?timeFilter=${timeFilter}`),
    api(`/api/disaster/alerts?timeFilter=${timeFilter}`),
  ]).then(([surv, alert]) => {
    setError(surv.success ? '' : surv.message);
    if (surv.success) setRows(surv.data);
    if (alert.success) setAlerts(alert.data);
    setLoading(false);
  }), [timeFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const diseases = useMemo(() => [...new Set(rows.map((r) => r.disease))].sort(), [rows]);
  const data = useMemo(() => (disease === 'All' ? rows : rows.filter((r) => r.disease === disease)), [rows, disease]);
  const shownAlerts = disease === 'All' ? alerts : alerts.filter((a) => a.disease === disease);

  // One entry per district for the map and the district list: worst risk, total cases.
  const byDistrict = useMemo(() => {
    const m = {};
    for (const r of data) {
      const d = (m[r.district] ||= { district: r.district, cases: 0, prev_cases: 0, risk_level: 'LOW', diseases: [] });
      d.cases += r.cases; d.prev_cases += r.prev_cases;
      if (RANK[r.risk_level] > RANK[d.risk_level]) d.risk_level = r.risk_level;
      d.diseases.push(r);
    }
    return Object.values(m).map((d) => {
      const pct = d.prev_cases ? Math.round(((d.cases - d.prev_cases) / d.prev_cases) * 100) : null;
      return {
        ...d,
        trend: pct == null ? (d.cases ? 'New' : '0%') : `${pct > 0 ? '+' : ''}${pct}%`,
        direction: pct == null ? (d.cases ? 'rising' : 'stable') : pct >= 10 ? 'rising' : pct <= -10 ? 'declining' : 'stable',
      };
    }).sort((a, b) => RANK[b.risk_level] - RANK[a.risk_level] || b.cases - a.cases);
  }, [data]);

  const insight = useMemo(() => {
    if (!byDistrict.length) return 'No positive cases of the monitored diseases were reported in this window.';
    const rising = byDistrict.filter((d) => d.direction === 'rising' && d.cases > 0).sort((a, b) => b.cases - a.cases);
    const high = byDistrict.filter((d) => d.risk_level === 'HIGH');
    const parts = [];
    if (high.length) parts.push(`${high.length} district${high.length > 1 ? 's are' : ' is'} above the HIGH threshold (${high.slice(0, 3).map((d) => d.district).join(', ')}).`);
    if (rising.length) parts.push(`Cases are rising in ${rising.slice(0, 3).map((d) => `${d.district} (${d.trend})`).join(', ')}.`);
    if (!parts.length) parts.push('No district is above its threshold and no rising trend was detected.');
    return parts.join(' ');
  }, [byDistrict]);

  const exportCsv = () => saveCsv(`disease-surveillance-${timeFilter}.csv`, data, [
    ['District', (r) => r.district], ['Disease', (r) => r.disease], ['Positive cases', (r) => r.cases], ['Previous window', (r) => r.prev_cases],
    ['Trend', (r) => r.trend], ['Risk', (r) => r.risk_level], ['Tests done', (r) => r.tests], ['Positivity %', (r) => r.positivity_pct], ['Source', (r) => r.source]]);

  return (
    <div className="disaster-page">
      <header className="disaster-header">
        <div className="header-left">
          <div className="header-icon"><ShieldAlert size={28} strokeWidth={2} /></div>
          <div>
            <h1>Disease Surveillance <span>Dashboard</span></h1>
            <p>State Level Monitoring • Karnataka • from authorised laboratory results</p>
          </div>
        </div>

        <div className="header-actions">
          <div className="time-filters">
            {WINDOWS.map(([id, label]) => (
              <button key={id} onClick={() => { setLoading(true); setTimeFilter(id); }} className={`btn-filter ${timeFilter === id ? 'active' : ''}`}>{label}</button>
            ))}
          </div>
          <select className="btn-filter" value={disease} onChange={(e) => setDisease(e.target.value)} aria-label="Disease">
            <option value="All">All diseases</option>
            {diseases.map((d) => <option key={d}>{d}</option>)}
          </select>
          <button className="btn-filter" onClick={() => { setLoading(true); fetchData(); }} title="Refresh"><RefreshCw size={14} /></button>
          {canSetThresholds() && <button className="btn-filter" onClick={() => setShowSettings(true)}><SlidersHorizontal size={14} /> Thresholds</button>}
          <button className="btn-export" onClick={exportCsv} disabled={!data.length}><Download size={16} /> Export Data</button>
        </div>
      </header>

      {error && <div style={{ margin: '0 24px 12px', padding: '10px 14px', borderRadius: 9, background: '#fef2f2', color: '#991b1b', fontSize: 13 }}>{error}</div>}

      <main className="disaster-main">
        <div className="main-content">
          <SummaryCards data={data} byDistrict={byDistrict} loading={loading} />

          <div className="map-district-grid">
            <div className="map-card">
              <div className="map-header">
                <h3>Geospatial Risk Heatmap</h3>
                <div className="map-legend">
                  <div className="legend-item"><div className="legend-dot dot-high"></div> HIGH RISK</div>
                  <div className="legend-item"><div className="legend-dot dot-med"></div> MEDIUM</div>
                  <div className="legend-item"><div className="legend-dot dot-low"></div> LOW</div>
                </div>
              </div>
              <div className="map-container">
                <MapChart data={byDistrict} onDistrictClick={setSelectedDistrict} />
              </div>
            </div>
            <div>
              <DistrictList data={byDistrict} onSelect={setSelectedDistrict} />
            </div>
          </div>

          <Charts data={data} byDistrict={byDistrict} />
        </div>

        <div className="sidebar-content">
          <div className="intel-box">
            <div className="intel-header"><Cpu size={16} /><h4>Analytical Insights</h4></div>
            <p>{loading ? 'Analysing…' : insight}</p>
          </div>
          <AlertPanel alerts={shownAlerts} />
        </div>
      </main>

      {selectedDistrict && <DrillDownModal district={selectedDistrict} onClose={() => setSelectedDistrict(null)} />}
      {showSettings && <ThresholdSettings onClose={() => setShowSettings(false)} onSaved={fetchData} />}

      <footer className="disaster-footer">
        <p className="footer-copy">STATE HEALTH SURVEILLANCE • KARNATAKA • Risk bands use Government-approved thresholds</p>
      </footer>
    </div>
  );
};

export default DisasterDashboard;
