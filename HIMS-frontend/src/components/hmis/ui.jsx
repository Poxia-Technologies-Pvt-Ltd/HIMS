import { useEffect } from 'react';
import { X } from 'lucide-react';
import '../../assets/CSS/Hmis.css';

export function PageHead({ title, subtitle, children }) {
  return (
    <div className="hm-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="hm-head-actions">{children}</div>}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="hm-tabs" role="tablist">
      {tabs.filter(Boolean).map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={active === t.id}
          className={`hm-tab${active === t.id ? ' active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}{t.count ? <em>{t.count}</em> : null}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="hm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`hm-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="hm-modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="hm-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="hm-modal-body">{children}</div>
        {footer && <div className="hm-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, className = '', children }) {
  return (
    <div className={`hm-field ${className}`}>
      {label && <label>{label}</label>}
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

const BADGE_COLORS = {
  Active: 'green', Present: 'green', Approved: 'green', Completed: 'green', Available: 'green', Paid: 'green',
  Scheduled: 'blue', 'Checked In': 'violet', 'In Consultation': 'teal', Finalized: 'blue', Draft: 'amber',
  Pending: 'amber', 'Half Day': 'amber', 'Half Leave': 'amber', Suspended: 'amber', Maintenance: 'amber', Late: 'amber',
  Absent: 'red', Rejected: 'red', Cancelled: 'red', 'No Show': 'red', Terminated: 'red', Occupied: 'red',
  Leave: 'violet', Resigned: '', Retired: '', 'Weekly Off': '', Holiday: '', Upcoming: '', 'Not Employed': '',
};
export function Badge({ children, tone }) {
  return <span className={`hm-badge ${tone ?? BADGE_COLORS[children] ?? ''}`}>{children}</span>;
}

export function Stat({ label, value, note, tone }) {
  return (
    <div className={`hm-stat ${tone || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="hm-empty">{children}</div>;
}

export function WeekdayPicker({ value, onChange }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const set = new Set(value);
  return (
    <div className="hm-chips">
      {days.map((d) => (
        <button key={d} type="button" className={`hm-chip${set.has(d) ? ' on' : ''}`}
          onClick={() => onChange(set.has(d) ? value.filter((x) => x !== d) : [...value, d])}>{d}</button>
      ))}
    </div>
  );
}
