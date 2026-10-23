import React from 'react';
import { Activity, AlertTriangle, Thermometer, ShieldCheck } from 'lucide-react';

const SummaryCards = ({ data = [], byDistrict = [], loading }) => {
  const totalCases = data.reduce((sum, r) => sum + r.cases, 0);
  const prevCases = data.reduce((sum, r) => sum + r.prev_cases, 0);
  const change = prevCases ? Math.round(((totalCases - prevCases) / prevCases) * 100) : null;
  const highRisk = byDistrict.filter((d) => d.risk_level === 'HIGH').length;
  const rising = byDistrict.filter((d) => d.direction === 'rising').length;

  const diseaseCounts = data.reduce((acc, r) => ({ ...acc, [r.disease]: (acc[r.disease] || 0) + r.cases }), {});
  const top = Object.entries(diseaseCounts).sort((a, b) => b[1] - a[1])[0];

  const cards = [
    { label: 'Positive Cases', value: loading ? '…' : totalCases, icon: Activity,
      trend: change == null ? (totalCases ? 'new' : '—') : `${change > 0 ? '+' : ''}${change}% vs previous`, up: change > 0 },
    { label: 'High Risk Districts', value: loading ? '…' : highRisk, icon: AlertTriangle, trend: `${rising} rising`, up: rising > 0 },
    { label: 'Leading Disease', value: loading ? '…' : (top ? top[0] : 'None'), icon: Thermometer, trend: top ? `${top[1]} cases` : '—', up: false },
    { label: 'Districts Reporting', value: loading ? '…' : byDistrict.length, icon: ShieldCheck, trend: 'of 31', up: false },
  ];

  return (
    <div className="summary-cards">
      {cards.map((card) => (
        <div key={card.label} className="summary-card">
          <div className="summary-header">
            <card.icon className="summary-icon" size={20} strokeWidth={1.5} />
            <div className={`trend-badge ${card.up ? 'up' : 'stable'}`}>{card.up ? '↑ ' : ''}{card.trend}</div>
          </div>
          <div className="summary-body">
            <p>{card.label}</p>
            <h3>{card.value}</h3>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SummaryCards;
