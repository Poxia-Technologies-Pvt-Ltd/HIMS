import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../assets/CSS/CriticalAlerts.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Red strip shown on lab pages while critical results are waiting to be
// communicated to a clinician.
export default function CriticalStrip() {
  const [info, setInfo] = useState({ open: 0, overdue: 0 });
  useEffect(() => {
    const load = () => fetch(`${API_BASE}/api/lab/critical-alerts?status=open`, { headers: { Authorization: `Bearer ${localStorage.getItem('hims_token')}` } })
      .then((r) => r.json()).then((d) => { if (d.success) setInfo({ open: d.open, overdue: d.overdue }); }).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  if (!info.open) return null;
  return (
    <div className="ca-strip">
      <span>{info.open} critical result{info.open > 1 ? 's' : ''} awaiting notification to the clinician{info.overdue ? ` — ${info.overdue} overdue` : ''}.</span>
      <Link to="/critical-alerts">Open Critical Alerts</Link>
    </div>
  );
}
