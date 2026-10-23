import React from 'react';

const TYPE_COLOR = { CRITICAL: '#ef4444', WARNING: '#f59e0b', INFO: '#1e88e5' };

// Alerts computed by the backend from Government-set thresholds: HIGH risk,
// a rise beyond the alert percentage, or a same-day cluster at one facility.
const AlertPanel = ({ alerts = [] }) => (
  <div className="alert-panel">
    <div className="alert-header">
      <h3>Active Alerts</h3>
      <span style={{ fontSize: 12, color: '#64748b' }}>{alerts.length}</span>
    </div>
    <div className="alert-list custom-scrollbar">
      {alerts.length === 0 && <p style={{ padding: 12, color: '#94a3b8', fontSize: 13 }}>No alerts — every district is within its thresholds.</p>}
      {alerts.map((alert) => (
        <div key={alert.id} className="alert-item">
          <div className="alert-type-header">
            <span className="legend-dot" style={{ backgroundColor: TYPE_COLOR[alert.type] || TYPE_COLOR.INFO }}></span>
            <span>{alert.type}</span>
          </div>
          <p className="alert-msg">{alert.msg}</p>
          <p className="alert-time">{alert.time}</p>
        </div>
      ))}
    </div>
  </div>
);

export default AlertPanel;
