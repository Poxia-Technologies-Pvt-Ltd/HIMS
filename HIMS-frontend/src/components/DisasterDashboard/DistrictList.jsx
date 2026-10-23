import React from 'react';

const RISK_COLOR = { HIGH: '#ef4444', MEDIUM: '#eab308', LOW: '#22c55e' };
const ARROW = { rising: '▲', declining: '▼', stable: '▬' };

// Districts ranked by risk then case count; click one for its drill-down.
const DistrictList = ({ data = [], onSelect }) => (
  <div className="district-card">
    <div className="district-header">
      <h3>District Risk Monitor</h3>
      <span>{data.length} reporting</span>
    </div>
    <div className="district-list custom-scrollbar">
      {data.length === 0 && <p style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>No positive cases in this window.</p>}
      {data.map((d, index) => {
        const riskColor = RISK_COLOR[d.risk_level];
        const worstDisease = [...d.diseases].sort((a, b) => b.cases - a.cases)[0];
        return (
          <div key={d.district} className="district-item" onClick={() => onSelect?.(d)} style={{ cursor: 'pointer' }}>
            <div className="district-info">
              <span className="district-rank">{index + 1}.</span>
              <div className="district-details">
                <p>{d.district}</p>
                <span>
                  {worstDisease?.disease}{d.diseases.length > 1 ? ` +${d.diseases.length - 1}` : ''}{' '}
                  <span className={d.direction === 'rising' ? 'trend-badge up' : 'trend-badge stable'}>{ARROW[d.direction]} {d.trend}</span>
                </span>
              </div>
            </div>
            <div className="district-stats">
              <p className="cases">{d.cases}</p>
              <span className="status-badge" style={{ backgroundColor: `${riskColor}20`, color: riskColor, border: `1px solid ${riskColor}40` }}>{d.risk_level}</span>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

export default DistrictList;
