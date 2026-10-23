import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Two single-measure bar charts: cases by district (top 12) and by disease.
const Charts = ({ data = [], byDistrict = [] }) => {
  const districts = byDistrict.slice().sort((a, b) => b.cases - a.cases).slice(0, 12).map((d) => ({ name: d.district, cases: d.cases }));
  const diseaseMap = data.reduce((acc, r) => ({ ...acc, [r.disease]: (acc[r.disease] || 0) + r.cases }), {});
  const diseases = Object.entries(diseaseMap).map(([name, cases]) => ({ name, cases })).sort((a, b) => b.cases - a.cases);
  const tip = { backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#0f172a', fontSize: 12 };

  return (
    <div className="charts-grid">
      <div className="chart-card">
        <h3>Positive Cases by District</h3>
        <div className="chart-container">
          {districts.length === 0 ? <p style={{ color: '#94a3b8', fontSize: 13 }}>No cases in this window.</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={districts}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} interval={0} angle={-40} textAnchor="end" height={70} />
                <YAxis allowDecimals={false} stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tip} />
                <Bar dataKey="cases" name="Positive cases" fill="#1e88e5" radius={[4, 4, 0, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      <div className="chart-card">
        <h3>Positive Cases by Disease</h3>
        <div className="chart-container">
          {diseases.length === 0 ? <p style={{ color: '#94a3b8', fontSize: 13 }}>No cases in this window.</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={diseases} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" allowDecimals={false} stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} width={100} />
                <Tooltip contentStyle={tip} />
                <Bar dataKey="cases" name="Positive cases" fill="#1e88e5" radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
};

export default Charts;
