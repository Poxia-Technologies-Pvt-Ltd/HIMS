import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../assets/CSS/EquipmentMaintenance.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Amber strip on lab pages while equipment maintenance is overdue or due soon.
// A warning only — it never blocks anything.
export default function MaintenanceStrip() {
  const [info, setInfo] = useState({ overdue: 0, due_soon: 0 });
  const [rg, setRg] = useState({ expired: 0, expiring: 0 });
  useEffect(() => {
    const load = () => fetch(`${API_BASE}/api/lab/maintenance/alerts`, { headers: { Authorization: `Bearer ${localStorage.getItem('hims_token')}` } })
      .then((r) => r.json()).then((d) => { if (d.success) setInfo({ overdue: d.overdue, due_soon: d.due_soon }); }).catch(() => {});
    const loadR = () => fetch(`${API_BASE}/api/lab/reagents/alerts`, { headers: { Authorization: `Bearer ${localStorage.getItem('hims_token')}` } })
      .then((r) => r.json()).then((d) => { if (d.success) setRg({ expired: d.expired, expiring: d.expiring }); }).catch(() => {});
    load(); loadR();
    const t = setInterval(() => { load(); loadR(); }, 60000);
    return () => clearInterval(t);
  }, []);
  if (!info.overdue && !info.due_soon && !rg.expired && !rg.expiring) return null;
  return (
    <div className="em-strip">
      <span>
        {(info.overdue || info.due_soon) ? `Equipment maintenance: ${[info.overdue && `${info.overdue} overdue`, info.due_soon && `${info.due_soon} due soon`].filter(Boolean).join(', ')}. ` : ''}
        {(rg.expired || rg.expiring) ? `Reagents: ${[rg.expired && `${rg.expired} expired`, rg.expiring && `${rg.expiring} expiring soon`].filter(Boolean).join(', ')}. ` : ''}
        Testing is not affected.
      </span>
      <span>
        {(info.overdue || info.due_soon) ? <Link to="/equipment-maintenance">Maintenance</Link> : null}
        {(rg.expired || rg.expiring) ? <> {' · '} <Link to="/reagent-changes">Reagents</Link></> : null}
      </span>
    </div>
  );
}
