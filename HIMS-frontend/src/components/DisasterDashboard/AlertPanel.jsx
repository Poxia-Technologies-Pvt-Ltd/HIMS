import React from 'react';
import { Bell, Info, AlertCircle, Zap } from 'lucide-react';
import { ALERTS } from '../../data/disasterMockData';

const AlertPanel = ({ alerts = [] }) => {
  return (
    <div className="alert-panel">
      <div className="alert-header">
        <h3>Active Alerts</h3>
        <div className="legend-dot" style={{ backgroundColor: "var(--blue-primary)" }}></div>
      </div>
      
      <div className="alert-list custom-scrollbar">
        {alerts.map((alert) => (
          <div key={alert.id} className="alert-item">
            <div className="alert-type-header">
              <span className="legend-dot" style={{ backgroundColor: 
                alert.type === 'CRITICAL' ? '#ef4444' : 
                alert.type === 'WARNING' ? '#f59e0b' : '#1e88e5'
              }}></span>
              <span>{alert.type}</span>
            </div>
            <p className="alert-msg">{alert.msg}</p>
            <p className="alert-time">{alert.time}</p>
          </div>
        ))}
      </div>
      
      <div className="alert-footer">
        <button className="btn-alert-link">
          Access Intelligence Logs
        </button>
      </div>
    </div>
  );
};


export default AlertPanel;
