import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || '';
const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}`, 'Content-Type': 'application/json' });

function Section({ title, icon, children, color = '#6366f1' }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 16 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '6px 0', borderBottom: `2px solid ${color}10`,
        }}
      >
        <span style={{ fontSize: '1rem' }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: '0.85rem', color, textTransform: 'uppercase', letterSpacing: '.5px' }}>{title}</span>
        <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: '0.75rem' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ paddingTop: 8 }}>{children}</div>}
    </div>
  );
}

function TimelineDot({ color }) {
  return (
    <div style={{
      width: 12, height: 12, borderRadius: '50%', background: color,
      flexShrink: 0, boxShadow: `0 0 0 3px ${color}30`,
    }} />
  );
}

export default function PatientTimeline({ regNo, patientName, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/consultations/patient/${regNo}/timeline`, { headers: authHdr() });
        const json = await res.json();
        setData(json);
      } catch {
        setData({ events: [] });
      }
      setLoading(false);
    })();
  }, [regNo]);

  const allEvents = (data?.events || []).sort((a, b) => new Date(b.date) - new Date(a.date));
  const filtered = tab === 'all' ? allEvents : allEvents.filter(e => e.type === tab);

  const typeColor = {
    consultation: '#6366f1',
    lab: '#0f766e',
    bill: '#d97706',
    vital: '#dc2626',
  };
  const typeIcon = {
    consultation: '🩺',
    lab: '🧪',
    bill: '💳',
    vital: '📊',
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="ptl-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="ptl-modal">
          <div className="ptl-header">
            <div>
              <span>⏱ Patient Timeline</span>
              <span className="ptl-sub">{patientName} · {regNo}</span>
            </div>
            <button onClick={onClose}>✕</button>
          </div>

          {/* Tabs */}
          <div className="ptl-tabs">
            {[['all','All Events'],['consultation','Consultations'],['lab','Lab'],['bill','Bills'],['vital','Vitals']].map(([k, l]) => (
              <button key={k}
                className={`ptl-tab ${tab === k ? 'ptl-tab--active' : ''}`}
                onClick={() => setTab(k)}
                style={tab === k ? { borderColor: typeColor[k] || '#6366f1', color: typeColor[k] || '#6366f1' } : {}}
              >{l}</button>
            ))}
          </div>

          <div className="ptl-body">
            {loading && (
              <div className="ptl-loading">
                <div className="ptl-spinner" />
                <span>Loading timeline…</span>
              </div>
            )}

            {!loading && filtered.length === 0 && (
              <div className="ptl-empty">No {tab === 'all' ? '' : tab + ' '}events found for this patient.</div>
            )}

            {!loading && filtered.length > 0 && (
              <div className="ptl-timeline">
                {filtered.map((ev, i) => {
                  const color = typeColor[ev.type] || '#6366f1';
                  const icon = typeIcon[ev.type] || '📝';
                  const dateStr = new Date(ev.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
                  return (
                    <div key={i} className="ptl-event">
                      <div className="ptl-dot-col">
                        <TimelineDot color={color} />
                        {i < filtered.length - 1 && <div className="ptl-line" />}
                      </div>
                      <div className="ptl-event-card" style={{ borderLeft: `3px solid ${color}` }}>
                        <div className="ptl-event-header">
                          <span className="ptl-event-icon">{icon}</span>
                          <span className="ptl-event-title" style={{ color }}>{ev.title}</span>
                          <span className="ptl-event-date">{dateStr}</span>
                        </div>
                        {ev.subtitle && <div className="ptl-event-sub">{ev.subtitle}</div>}
                        {ev.detail && <div className="ptl-event-detail">{ev.detail}</div>}
                        {ev.tags?.length > 0 && (
                          <div className="ptl-event-tags">
                            {ev.tags.map((t, j) => (
                              <span key={j} className="ptl-tag" style={{ background: color + '15', color }}>{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Summary stats */}
            {!loading && data && (
              <div className="ptl-stats">
                <div className="ptl-stat">
                  <span className="ptl-stat-val">{data.stats?.totalVisits || 0}</span>
                  <span className="ptl-stat-label">Visits</span>
                </div>
                <div className="ptl-stat">
                  <span className="ptl-stat-val">{data.stats?.totalLabs || 0}</span>
                  <span className="ptl-stat-label">Lab Tests</span>
                </div>
                <div className="ptl-stat">
                  <span className="ptl-stat-val">{data.stats?.totalBills || 0}</span>
                  <span className="ptl-stat-label">Bills</span>
                </div>
                <div className="ptl-stat">
                  <span className="ptl-stat-val">{data.stats?.firstVisit ? new Date(data.stats.firstVisit).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—'}</span>
                  <span className="ptl-stat-label">Since</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const CSS = `
  .ptl-overlay {
    position: fixed; inset: 0; background: rgba(15,23,42,.65); z-index: 1200;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(3px);
  }
  .ptl-modal {
    background: #fff; border-radius: 16px; width: 100%; max-width: 680px;
    box-shadow: 0 32px 100px rgba(0,0,0,.35); display: flex; flex-direction: column;
    height: 88vh; max-height: 800px; overflow: hidden; font-family: 'Inter', system-ui, sans-serif;
  }
  .ptl-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; background: linear-gradient(135deg,#1e1b4b,#312e81);
    color: #fff;
  }
  .ptl-header > div { display: flex; flex-direction: column; gap: 2px; }
  .ptl-header span:first-child { font-weight: 700; font-size: 1rem; }
  .ptl-sub { font-size: 0.75rem; opacity: .7; }
  .ptl-header button {
    background: rgba(255,255,255,.15); border: none; border-radius: 50%;
    width: 28px; height: 28px; color: #fff; cursor: pointer; font-size: 0.85rem; align-self: flex-start;
  }
  .ptl-tabs {
    display: flex; gap: 2px; padding: 10px 16px; border-bottom: 1.5px solid #e2e8f0;
    background: #f8fafc; overflow-x: auto;
  }
  .ptl-tab {
    padding: 5px 14px; border-radius: 99px; border: 1.5px solid #e2e8f0;
    background: #fff; font-size: 0.78rem; color: #64748b; cursor: pointer;
    white-space: nowrap; transition: all .15s;
  }
  .ptl-tab--active { font-weight: 600; background: #f0f0ff; }
  .ptl-body { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 0; }
  .ptl-loading, .ptl-empty {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    height: 200px; color: #94a3b8; font-size: 0.88rem;
  }
  .ptl-spinner {
    width: 20px; height: 20px; border: 2px solid #e2e8f0;
    border-top-color: #6366f1; border-radius: 50%; animation: ptl-spin .7s linear infinite;
  }
  @keyframes ptl-spin { to { transform: rotate(360deg); } }
  .ptl-timeline { display: flex; flex-direction: column; gap: 0; }
  .ptl-event { display: flex; gap: 12px; }
  .ptl-dot-col { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; padding-top: 3px; }
  .ptl-line { flex: 1; width: 2px; background: #e2e8f0; margin: 4px 0; min-height: 20px; }
  .ptl-event-card {
    flex: 1; background: #f8fafc; border-radius: 10px;
    padding: 10px 14px; margin-bottom: 12px;
  }
  .ptl-event-header { display: flex; align-items: center; gap: 6px; }
  .ptl-event-icon { font-size: 0.9rem; }
  .ptl-event-title { font-weight: 600; font-size: 0.85rem; flex: 1; }
  .ptl-event-date { font-size: 0.73rem; color: #94a3b8; white-space: nowrap; }
  .ptl-event-sub { font-size: 0.78rem; color: #475569; margin-top: 4px; }
  .ptl-event-detail { font-size: 0.78rem; color: #64748b; margin-top: 4px; line-height: 1.5; }
  .ptl-event-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .ptl-tag { padding: 2px 8px; border-radius: 99px; font-size: 0.72rem; font-weight: 500; }
  .ptl-stats {
    display: flex; gap: 0; border: 1.5px solid #e2e8f0; border-radius: 12px;
    overflow: hidden; margin-top: 16px; flex-shrink: 0;
  }
  .ptl-stat {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    padding: 12px; border-right: 1.5px solid #e2e8f0; gap: 2px;
  }
  .ptl-stat:last-child { border-right: none; }
  .ptl-stat-val { font-size: 1.2rem; font-weight: 700; color: #1e293b; }
  .ptl-stat-label { font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; letter-spacing: .5px; }
`;
