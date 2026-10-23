import React, { useEffect, useState } from 'react';
import { X, TrendingUp, TrendingDown, Minus, Hospital, Box, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../utils/govApi';

const RISK_COLOR = { HIGH: '#ef4444', MEDIUM: '#eab308', LOW: '#22c55e' };
const LEVEL_COLOR = { LOW: '#ef4444', MEDIUM: '#f59e0b', NORMAL: '#10b981' };

// One district: cases per disease with trend, the daily series, reporting
// facilities, and the resources (beds, oxygen, testing stock) to read the
// burden against (tender #102).
const DrillDownModal = ({ district, onClose }) => {
  const [res, setRes] = useState(null);
  useEffect(() => {
    api(`/api/disaster/resources?district=${encodeURIComponent(district.district)}`).then((d) => setRes(d.success ? d : { error: d.message }));
  }, [district.district]);

  const color = RISK_COLOR[district.risk_level];
  const series = (district.diseases[0]?.series || []).map((p, i) => ({
    day: p.day, cases: district.diseases.reduce((a, d) => a + (d.series[i]?.cases || 0), 0),
  }));
  const facilities = {};
  for (const d of district.diseases) for (const f of d.facilities) facilities[f.name] = (facilities[f.name] || 0) + f.cases;
  const TrendIcon = district.direction === 'rising' ? TrendingUp : district.direction === 'declining' ? TrendingDown : Minus;
  const pctBar = (avail, total) => (total ? Math.round((avail / total) * 100) : 0);

  return (
    <div className="dd-modal-overlay" onClick={onClose}>
      <div className="dd-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="dd-modal-header">
          <div className="dd-header-left">
            <div className="dd-icon" style={{ backgroundColor: `${color}20` }}><Activity size={24} style={{ color }} /></div>
            <div>
              <h2>{district.district}</h2>
              <p>Laboratory-confirmed cases and district resources</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-close"><X size={24} /></button>
        </div>

        <div className="dd-modal-body">
          <div>
            <div className="dd-stats-grid">
              <div className="dd-stat-box">
                <p>Positive Cases</p>
                <h4>{district.cases}</h4>
                <div className={`dd-trend ${district.direction === 'rising' ? 'up' : ''}`}><TrendIcon size={12} /> {district.trend} vs previous window</div>
              </div>
              <div className="dd-stat-box">
                <p>Risk Status</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="legend-dot" style={{ backgroundColor: color }}></span>
                  <h4>{district.risk_level}</h4>
                </div>
              </div>
            </div>

            <div className="dd-list-box" style={{ marginBottom: 16 }}>
              <h4 className="dd-box-title"><Activity size={16} color="var(--blue-primary)" /> By disease</h4>
              {district.diseases.map((d) => (
                <div key={d.disease} className="dd-resource-item">
                  <span>{d.disease}</span>
                  <span style={{ fontSize: 12 }}>
                    <b>{d.cases}</b> cases · {d.trend} · {d.positivity_pct == null ? '' : `${d.positivity_pct}% positivity · `}
                    <span style={{ color: RISK_COLOR[d.risk_level], fontWeight: 700 }}>{d.risk_level}</span>
                    <span style={{ color: '#94a3b8' }}> (MED ≥{d.thresholds.medium}, HIGH ≥{d.thresholds.high})</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="dd-chart-box">
              <h4 className="dd-box-title"><Activity size={16} color="var(--blue-primary)" /> Daily positive cases</h4>
              <div style={{ height: "200px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="day" stroke="#64748b" fontSize={10} axisLine={false} tickLine={false} minTickGap={12} />
                    <YAxis allowDecimals={false} stroke="#64748b" fontSize={10} axisLine={false} tickLine={false} width={28} />
                    <Tooltip contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: 12 }} />
                    <Line type="monotone" dataKey="cases" name="Positive cases" stroke="#1e88e5" strokeWidth={2} dot={{ r: 3, fill: '#1e88e5' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div>
            <div className="dd-list-box" style={{ marginBottom: "24px" }}>
              <h4 className="dd-box-title"><Box size={16} color="#f97316" /> Resources in the district</h4>
              {!res && <p style={{ fontSize: 13, color: '#94a3b8' }}>Loading…</p>}
              {res?.error && <p style={{ fontSize: 13, color: '#b91c1c' }}>{res.error}</p>}
              {res?.beds && (
                <>
                  {[['Beds available', res.beds.available, res.beds.total], ['Oxygen beds available', res.beds.oxygen_available, res.beds.oxygen_total], ['ICU/HDU beds available', res.beds.icu_available, res.beds.icu_total]].map(([label, a, t]) => (
                    <div key={label} className="dd-resource-item">
                      <span>{label}</span>
                      <div className="dd-progress-bar">
                        <div className="dd-bar-track"><div className="dd-bar-fill" style={{ width: `${pctBar(a, t)}%`, backgroundColor: pctBar(a, t) < 20 ? '#ef4444' : pctBar(a, t) < 50 ? '#f59e0b' : '#10b981' }}></div></div>
                        <span>{t ? `${a}/${t}` : 'not recorded'}</span>
                      </div>
                    </div>
                  ))}
                  {res.kits.map((k) => (
                    <div key={k.disease} className="dd-resource-item">
                      <span>{k.disease} testing stock</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: LEVEL_COLOR[k.level] }}>{k.tests_possible} tests · {k.level}</span>
                    </div>
                  ))}
                  {res.kits.length === 0 && <p style={{ fontSize: 12, color: '#94a3b8' }}>Testing stock appears once reagents are mapped to these tests in Inventory → Test Mappings.</p>}
                </>
              )}
            </div>

            <div className="dd-list-box">
              <h4 className="dd-box-title"><Hospital size={16} color="#10b981" /> Reporting facilities</h4>
              {Object.entries(facilities).sort((a, b) => b[1] - a[1]).map(([name, n], idx) => (
                <div key={name} className="dd-facility-item">
                  <div className="dd-facility-rank">#{idx + 1}</div>
                  <span className="dd-facility-name">{name} — {n} case{n === 1 ? '' : 's'}</span>
                </div>
              ))}
              {Object.keys(facilities).length === 0 && <p style={{ fontSize: 12, color: '#94a3b8' }}>Cases in this window come from the external feed only.</p>}
            </div>
          </div>
        </div>

        <div className="dd-modal-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default DrillDownModal;
