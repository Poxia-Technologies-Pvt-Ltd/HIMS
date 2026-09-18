import React from 'react';
import { X, TrendingUp, Hospital, Box, Activity } from 'lucide-react';
import { getRiskLevel } from '../../data/disasterMockData';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const mockTrendData = [
  { day: 'Mon', cases: 10 }, { day: 'Tue', cases: 15 }, { day: 'Wed', cases: 45 },
  { day: 'Thu', cases: 30 }, { day: 'Fri', cases: 55 }, { day: 'Sat', cases: 70 },
  { day: 'Sun', cases: 65 },
];

const DrillDownModal = ({ district, onClose }) => {
  if (!district) return null;
  const risk = getRiskLevel(district.cases);

  return (
    <div className="dd-modal-overlay">
      <div className="dd-modal-content">
        
        {/* Modal Header */}
        <div className="dd-modal-header">
          <div className="dd-header-left">
            <div className={`dd-icon`} style={{ backgroundColor: `${risk.color}20` }}>
              <Activity size={24} style={{ color: risk.color }} />
            </div>
            <div>
              <h2>{district.district} Profile</h2>
              <p>Deep Intelligence & Resource Tracking</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-close">
            <X size={24} />
          </button>
        </div>

        <div className="dd-modal-body">
          
          {/* Left Column: Stats & Charts */}
          <div>
            <div className="dd-stats-grid">
              <div className="dd-stat-box">
                <p>Total Cases</p>
                <h4>{district.cases}</h4>
                <div className="dd-trend up">
                  <TrendingUp size={12} /> {district.trend} from last week
                </div>
              </div>
              <div className="dd-stat-box">
                <p>Risk Status</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="legend-dot" style={{ backgroundColor: risk.color }}></span>
                  <h4>{risk.label}</h4>
                </div>
              </div>
            </div>

            <div className="dd-chart-box">
              <h4 className="dd-box-title">
                <Activity size={16} color="var(--blue-primary)" /> 7-Day Case Trend
              </h4>
              <div style={{ height: "200px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mockTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="day" stroke="#64748b" fontSize={10} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                    />
                    <Line type="monotone" dataKey="cases" stroke={risk.color} strokeWidth={4} dot={{ fill: risk.color }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Right Column: Resources & Facilities */}
          <div>
            <div className="dd-list-box" style={{ marginBottom: "24px" }}>
              <h4 className="dd-box-title">
                <Box size={16} color="#f97316" /> Resource Inventory
              </h4>
              <div>
                {Object.entries(district.resources).map(([name, level]) => (
                  <div key={name} className="dd-resource-item">
                    <span>{name}</span>
                    <div className="dd-progress-bar">
                      <div className="dd-bar-track">
                        <div 
                          className="dd-bar-fill" 
                          style={{ 
                            backgroundColor: level === 'LOW' ? '#ef4444' : level === 'MEDIUM' ? '#f59e0b' : '#10b981',
                            width: level === 'LOW' ? '30%' : level === 'MEDIUM' ? '60%' : '100%' 
                          }}
                        ></div>
                      </div>
                      <span>{level}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="dd-list-box">
              <h4 className="dd-box-title">
                <Hospital size={16} color="#10b981" /> Reporting Facilities
              </h4>
              <div>
                {district.hospitals.map((h, idx) => (
                  <div key={idx} className="dd-facility-item">
                    <div className="dd-facility-rank">#{idx+1}</div>
                    <span className="dd-facility-name">{h}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>

        <div className="dd-modal-footer">
          <button className="btn-secondary">
            Generate Local Report
          </button>
          <button className="btn-export">
            Deploy Emergency Resources
          </button>
        </div>
      </div>
    </div>
  );
};

export default DrillDownModal;
