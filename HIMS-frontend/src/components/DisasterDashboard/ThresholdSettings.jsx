import React, { useEffect, useState } from 'react';
import '../../assets/CSS/Governance.css';
import { api } from '../../utils/govApi';

// Government-approved surveillance thresholds, per disease.
const ThresholdSettings = ({ onClose, onSaved }) => {
  const [rules, setRules] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { api('/api/disaster/rules').then((d) => setRules(d.success ? d.rules : [])); }, []);

  const update = (id, k, v) => setRules(rules.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const save = async (r) => {
    const d = await api(`/api/disaster/rules/${r.id}`, { method: 'PUT', body: r });
    setMsg({ ok: d.success, text: `${r.disease}: ${d.message}` });
    if (d.success) onSaved();
  };

  return (
    <div className="gv-overlay" onClick={onClose}>
      <div className="gv-modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>Surveillance thresholds</h2>
        <div className="gv-sub">Positive cases in the selected window at or above MEDIUM / HIGH set a district's risk. An alert is raised at HIGH, when cases rise by the alert percentage, or when one facility reports the cluster count in a day. The test pattern decides which lab tests count for the disease.</div>
        {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`} style={{ marginTop: 10 }}>{msg.text}</div>}
        <div className="gv-table-wrap" style={{ marginTop: 12 }}>
          <table className="gv-table">
            <thead><tr><th>Disease</th><th>Test pattern</th><th className="num">Medium ≥</th><th className="num">High ≥</th><th className="num">Rise alert %</th><th className="num">Cluster</th><th>Active</th><th /></tr></thead>
            <tbody>
              {!rules && <tr><td colSpan={8} className="gv-empty">Loading…</td></tr>}
              {(rules || []).map((r) => (
                <tr key={r.id}>
                  <td><b>{r.disease}</b></td>
                  <td><input className="gv-mono" style={{ width: 200, padding: 6, border: '1.5px solid #e2e8f0', borderRadius: 6 }} value={r.test_pattern} onChange={(e) => update(r.id, 'test_pattern', e.target.value)} /></td>
                  {['medium_threshold', 'high_threshold', 'rise_alert_percent', 'cluster_min_cases'].map((k) => (
                    <td key={k} className="num"><input type="number" min={1} style={{ width: 64, padding: 6, border: '1.5px solid #e2e8f0', borderRadius: 6, textAlign: 'right' }} value={r[k]} onChange={(e) => update(r.id, k, e.target.value)} /></td>
                  ))}
                  <td><input type="checkbox" checked={!!r.active} onChange={(e) => update(r.id, 'active', e.target.checked)} /></td>
                  <td><button className="gv-btn sm" onClick={() => save(r)}>Save</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="gv-modal-actions"><button className="gv-btn ghost" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
};

export default ThresholdSettings;
