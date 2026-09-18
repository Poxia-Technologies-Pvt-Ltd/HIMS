import { useState, useEffect, useRef, useCallback } from 'react';
import ConsultationWorkspace from './ConsultationWorkspace';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function calcAge(dob) {
  if (!dob) return '';
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

function calcWait(apptTime) {
  if (!apptTime) return null;
  const [h, m] = apptTime.split(':').map(Number);
  const apptMs = new Date().setHours(h, m, 0, 0);
  return Math.round((Date.now() - apptMs) / 60000);
}

function fmt12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function initials(fn, ln) {
  return `${(fn || '')[0] || ''}${(ln || '')[0] || ''}`.toUpperCase();
}

const PRIORITY_META = {
  Emergency: { color: '#dc2626', bg: '#fef2f2', pulse: true },
  Urgent:    { color: '#ea580c', bg: '#fff7ed', pulse: false },
  Normal:    { color: '#2563eb', bg: '#eff6ff', pulse: false },
};

// ─── Patient Queue Card ───────────────────────────────────────────────────────
function PatientCard({ appt, lane, onAction, isActive }) {
  const p = PRIORITY_META[appt.priority] || PRIORITY_META.Normal;
  const waitMin = lane === 'waiting' ? calcWait(appt.appt_time) : null;
  const name = [appt.first_name, appt.last_name].filter(Boolean).join(' ');
  const age = calcAge(appt.dob);
  const gender = (appt.gender || '').charAt(0).toUpperCase();

  return (
    <div className={`pcard ${isActive ? 'pcard--active' : ''}`}>
      <div className="pcard-stripe" style={{ background: p.color }} />
      <div className="pcard-body">
        <div className="pcard-top">
          <div className="pcard-avatar">
            {appt.photo_base64
              ? <img src={`data:image/jpeg;base64,${appt.photo_base64}`} alt="" />
              : <span>{initials(appt.first_name, appt.last_name)}</span>
            }
            {p.pulse && <span className="pcard-pulse" />}
          </div>
          <div className="pcard-info">
            <span className="pcard-name">{name || '—'}</span>
            <span className="pcard-meta">{age ? `${age}y` : ''}{age && gender ? ' · ' : ''}{gender}</span>
            <span className="pcard-regno">{appt.reg_no}</span>
          </div>
          <div className="pcard-time-col">
            <span className="pcard-time">{fmt12(appt.appt_time)}</span>
            {waitMin !== null && waitMin > 0 && (
              <span className="pcard-wait" style={{ color: waitMin > 30 ? '#dc2626' : '#d97706' }}>
                {waitMin}m wait
              </span>
            )}
          </div>
        </div>

        <div className="pcard-reason-row">
          {appt.reason && <span className="pcard-reason">"{appt.reason}"</span>}
          <span className="pcard-priority" style={{ color: p.color, background: p.bg }}>
            {appt.priority || 'Normal'}
          </span>
        </div>

        {appt.department && <span className="pcard-dept">{appt.department}</span>}

        {lane !== 'completed' ? (
          <button
            className="pcard-cta"
            style={{ background: lane === 'waiting' ? '#4f46e5' : '#0891b2' }}
            onClick={() => onAction(appt)}
          >
            {lane === 'waiting' ? '▶ Start Consultation' : '↩ Resume'}
          </button>
        ) : (
          <button className="pcard-cta pcard-cta--view" onClick={() => onAction(appt)}>
            View Record
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Swim Lane ───────────────────────────────────────────────────────────────
function Lane({ title, color, count, children, emptyText }) {
  return (
    <div className="lane">
      <div className="lane-hdr" style={{ borderTopColor: color }}>
        <span className="lane-title">{title}</span>
        <span className="lane-count" style={{ background: color }}>{count}</span>
      </div>
      <div className="lane-body">
        {count === 0
          ? <div className="lane-empty">{emptyText}</div>
          : children
        }
      </div>
    </div>
  );
}

// ─── Timeline Bar ─────────────────────────────────────────────────────────────
function TimelineBar({ appointments }) {
  if (!appointments.length) return null;
  const startH = 7, endH = 20, totalMin = (endH - startH) * 60;
  const now = new Date();
  const nowPct = Math.max(0, Math.min(100,
    ((now.getHours() * 60 + now.getMinutes() - startH * 60) / totalMin) * 100
  ));
  return (
    <div className="timeline">
      <div className="timeline-bar">
        {appointments.map((a, i) => {
          const [h, m] = (a.appt_time || '08:00').split(':').map(Number);
          const pct = Math.max(0, Math.min(100, ((h * 60 + m - startH * 60) / totalMin) * 100));
          const p = PRIORITY_META[a.priority] || PRIORITY_META.Normal;
          return (
            <div key={i} className="timeline-dot"
              style={{ left: `${pct}%`, background: p.color }}
              title={`${fmt12(a.appt_time)} — ${a.first_name} ${a.last_name}`}
            />
          );
        })}
        <div className="timeline-now" style={{ left: `${nowPct}%` }} />
      </div>
      <div className="timeline-labels">
        {[7, 9, 11, 13, 15, 17, 19].map(h => (
          <span key={h} style={{ left: `${((h - startH) / (endH - startH)) * 100}%` }}>
            {h > 12 ? `${h - 12}pm` : `${h}am`}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DoctorDashboard() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [selected, setSelected]         = useState(null);
  const [search, setSearch]             = useState('');
  const [clock, setClock]               = useState(new Date());
  const [followUps, setFollowUps]       = useState([]);
  const [showFollowUps, setShowFollowUps] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const fetchAppointments = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('hims_token');
      const [apptRes, fuRes] = await Promise.all([
        fetch('/api/consultations/today', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/consultations/followup-due', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const apptData = await apptRes.json();
      const fuData = await fuRes.json().catch(() => ({ followups: [] }));
      if (apptData.success) setAppointments(apptData.appointments || []);
      if (fuData.success) setFollowUps(fuData.followups || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAppointments(); }, [fetchAppointments]);

  const filtered = appointments.filter(a => {
    if (!search) return true;
    const q = search.toLowerCase();
    return `${a.first_name} ${a.last_name}`.toLowerCase().includes(q) ||
           (a.reg_no || '').toLowerCase().includes(q);
  });

  const waiting    = filtered.filter(a => !a.consultation_status);
  const inProgress = filtered.filter(a => a.consultation_status === 'Pending');
  const completed  = filtered.filter(a => a.consultation_status === 'Completed');
  const emergency  = appointments.filter(a => a.priority === 'Emergency').length;

  const todayStr = clock.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr  = clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <>
      <style>{CSS}</style>
      <div className="dd-root">

        {/* Header */}
        <div className="dd-header">
          <div>
            <h1 className="dd-title">Doctor Console</h1>
            <span className="dd-date">{todayStr}</span>
          </div>
          <div className="dd-header-right">
            <span className="dd-clock">{timeStr}</span>
            <button className="dd-refresh-btn" onClick={fetchAppointments}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="dd-stats">
          {[
            { label: 'Total Today', val: appointments.length, color: '#4f46e5', bg: '#eef2ff' },
            { label: 'Waiting',     val: waiting.length,      color: '#d97706', bg: '#fffbeb' },
            { label: 'In Progress', val: inProgress.length,   color: '#0891b2', bg: '#ecfeff' },
            { label: 'Completed',   val: completed.length,    color: '#16a34a', bg: '#f0fdf4' },
            { label: 'Emergency',   val: emergency,           color: '#dc2626', bg: '#fef2f2' },
          ].map(s => (
            <div className="dd-stat" key={s.label} style={{ borderColor: s.color, background: s.bg }}>
              <span className="dd-stat-val" style={{ color: s.color }}>{s.val}</span>
              <span className="dd-stat-label">{s.label}</span>
            </div>
          ))}
          {followUps.length > 0 && (
            <button
              className="dd-stat dd-stat--fu"
              onClick={() => setShowFollowUps(o => !o)}
              style={{ borderColor: '#7c3aed', background: '#f5f3ff', cursor: 'pointer' }}
            >
              <span className="dd-stat-val" style={{ color: '#7c3aed' }}>{followUps.length}</span>
              <span className="dd-stat-label">Follow-up Due</span>
            </button>
          )}
        </div>

        {/* Follow-up due panel */}
        {showFollowUps && followUps.length > 0 && (
          <div className="dd-fu-panel">
            <div className="dd-fu-header">
              📆 Follow-ups Due Today
              <button onClick={() => setShowFollowUps(false)}>✕</button>
            </div>
            <div className="dd-fu-list">
              {followUps.map((fu, i) => (
                <div key={i} className="dd-fu-row">
                  <div className="dd-fu-avatar">
                    {((fu.first_name || '')[0] || '') + ((fu.last_name || '')[0] || '')}
                  </div>
                  <div className="dd-fu-info">
                    <span className="dd-fu-name">{[fu.first_name, fu.last_name].filter(Boolean).join(' ')}</span>
                    <span className="dd-fu-meta">{fu.reg_no} · {fu.diagnosis || 'No diagnosis on record'}</span>
                  </div>
                  <a
                    href={`tel:${fu.telephone}`}
                    className="dd-fu-call"
                    title={`Call ${fu.telephone}`}
                  >📞</a>
                </div>
              ))}
            </div>
          </div>
        )}

        <TimelineBar appointments={appointments} />

        {/* Search */}
        <div className="dd-searchbar">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            placeholder="Search patient name or reg no…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && <button onClick={() => setSearch('')}>✕</button>}
        </div>

        {/* Kanban */}
        {loading ? (
          <div className="dd-loading">
            <div className="dd-spinner" />
            <span>Loading today's appointments…</span>
          </div>
        ) : (
          <div className="dd-kanban">
            <Lane title="Waiting" color="#d97706" count={waiting.length} emptyText="No patients waiting">
              {waiting.map(a => (
                <PatientCard key={a.appointment_id} appt={a} lane="waiting"
                  onAction={setSelected} isActive={selected?.appointment_id === a.appointment_id} />
              ))}
            </Lane>
            <Lane title="In Progress" color="#0891b2" count={inProgress.length} emptyText="No active consultations">
              {inProgress.map(a => (
                <PatientCard key={a.appointment_id} appt={a} lane="in-progress"
                  onAction={setSelected} isActive={selected?.appointment_id === a.appointment_id} />
              ))}
            </Lane>
            <Lane title="Completed" color="#16a34a" count={completed.length} emptyText="No completed consultations yet">
              {completed.map(a => (
                <PatientCard key={a.appointment_id} appt={a} lane="completed"
                  onAction={setSelected} isActive={selected?.appointment_id === a.appointment_id} />
              ))}
            </Lane>
          </div>
        )}
      </div>

      {selected && (
        <ConsultationWorkspace
          appointment={selected}
          onClose={() => { setSelected(null); fetchAppointments(); }}
        />
      )}
    </>
  );
}

const CSS = `
  .dd-root {
    min-height: 100vh;
    background: linear-gradient(135deg, #f0f4ff 0%, #fafbff 100%);
    padding: 24px 28px;
    font-family: 'Inter', system-ui, sans-serif;
    box-sizing: border-box;
  }
  .dd-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 20px;
    flex-wrap: wrap;
    gap: 12px;
  }
  .dd-title { margin: 0 0 2px; font-size: 1.6rem; font-weight: 700; color: #1e293b; letter-spacing: -0.5px; }
  .dd-date { font-size: 0.82rem; color: #64748b; }
  .dd-header-right { display: flex; align-items: center; gap: 14px; }
  .dd-clock { font-size: 1.1rem; font-weight: 600; color: #4f46e5; font-variant-numeric: tabular-nums; letter-spacing: 1px; }
  .dd-refresh-btn {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 14px; border: 1.5px solid #e2e8f0; border-radius: 8px;
    background: #fff; font-size: 0.82rem; font-weight: 500; color: #475569; cursor: pointer;
    transition: all .15s;
  }
  .dd-refresh-btn:hover { border-color: #4f46e5; color: #4f46e5; background: #eef2ff; }

  .dd-stats { display: flex; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
  .dd-stat {
    flex: 1; min-width: 110px; padding: 14px 16px; border-radius: 12px;
    border: 1.5px solid; display: flex; flex-direction: column; align-items: center; gap: 2px;
  }
  .dd-stat-val { font-size: 1.8rem; font-weight: 700; line-height: 1; }
  .dd-stat-label { font-size: 0.72rem; font-weight: 500; color: #64748b; text-align: center; }

  .timeline { position: relative; height: 36px; margin-bottom: 18px; padding: 0 4px; }
  .timeline-bar {
    position: relative; height: 6px; background: #e2e8f0;
    border-radius: 99px; margin-top: 12px;
  }
  .timeline-dot {
    position: absolute; width: 10px; height: 10px; border-radius: 50%;
    top: -2px; transform: translateX(-50%);
    border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); cursor: pointer;
  }
  .timeline-now {
    position: absolute; width: 2px; height: 20px;
    background: #4f46e5; top: -7px; transform: translateX(-50%); border-radius: 2px;
  }
  .timeline-now::before {
    content: 'Now'; position: absolute; top: -16px; left: -12px;
    font-size: 9px; font-weight: 700; color: #4f46e5; white-space: nowrap;
    font-family: 'Inter', system-ui, sans-serif;
  }
  .timeline-labels { position: absolute; top: 22px; left: 4px; right: 4px; font-size: 9px; color: #94a3b8; }
  .timeline-labels span { position: absolute; transform: translateX(-50%); font-family: 'Inter', system-ui, sans-serif; }

  .dd-searchbar {
    display: flex; align-items: center; gap: 8px;
    background: #fff; border: 1.5px solid #e2e8f0; border-radius: 10px;
    padding: 8px 14px; margin-bottom: 20px; max-width: 420px;
    transition: border-color .15s;
  }
  .dd-searchbar:focus-within { border-color: #4f46e5; }
  .dd-searchbar input { flex: 1; border: none; outline: none; font-size: 0.88rem; color: #1e293b; background: transparent; }
  .dd-searchbar button { border: none; background: none; cursor: pointer; color: #94a3b8; font-size: 0.8rem; padding: 0; }

  .dd-loading { display: flex; flex-direction: column; align-items: center; padding: 60px 0; gap: 14px; color: #64748b; font-size: 0.9rem; }
  .dd-spinner {
    width: 32px; height: 32px; border: 3px solid #e2e8f0;
    border-top-color: #4f46e5; border-radius: 50%;
    animation: dd-spin .7s linear infinite;
  }
  @keyframes dd-spin { to { transform: rotate(360deg); } }

  .dd-kanban { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; align-items: start; }
  @media (max-width: 900px) { .dd-kanban { grid-template-columns: 1fr; } }

  .lane {
    background: #f8fafc; border-radius: 14px; border: 1.5px solid #e2e8f0;
    overflow: hidden; display: flex; flex-direction: column; min-height: 200px;
  }
  .lane-hdr {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; background: #fff; border-bottom: 1.5px solid #e2e8f0; border-top: 3px solid transparent;
  }
  .lane-title { font-size: 0.88rem; font-weight: 600; color: #1e293b; letter-spacing: 0.3px; }
  .lane-count {
    min-width: 22px; height: 22px; border-radius: 99px;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.75rem; font-weight: 700; color: #fff; padding: 0 6px;
  }
  .lane-body { padding: 10px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
  .lane-empty { text-align: center; color: #94a3b8; font-size: 0.82rem; padding: 30px 0; }

  .pcard {
    background: #fff; border-radius: 12px; border: 1.5px solid #e2e8f0;
    display: flex; overflow: hidden; transition: box-shadow .15s, border-color .15s;
  }
  .pcard:hover { box-shadow: 0 4px 16px rgba(0,0,0,.08); border-color: #c7d2fe; }
  .pcard--active { border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,.12); }
  .pcard-stripe { width: 4px; flex-shrink: 0; }
  .pcard-body { flex: 1; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }

  .pcard-top { display: flex; align-items: flex-start; gap: 10px; }
  .pcard-avatar {
    position: relative; width: 40px; height: 40px; border-radius: 50%;
    background: linear-gradient(135deg, #4f46e5, #818cf8);
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; color: #fff; font-size: 0.85rem; flex-shrink: 0; overflow: hidden;
  }
  .pcard-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .pcard-pulse {
    position: absolute; bottom: 0; right: 0; width: 10px; height: 10px;
    background: #dc2626; border-radius: 50%; border: 2px solid #fff;
    animation: dd-pulse 1.2s ease-out infinite;
  }
  @keyframes dd-pulse {
    0%   { box-shadow: 0 0 0 0 rgba(220,38,38,.4); }
    70%  { box-shadow: 0 0 0 6px rgba(220,38,38,0); }
    100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); }
  }
  .pcard-info { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .pcard-name { font-weight: 600; color: #1e293b; font-size: 0.88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pcard-meta { font-size: 0.75rem; color: #64748b; }
  .pcard-regno { font-size: 0.72rem; color: #94a3b8; font-family: monospace; }
  .pcard-time-col { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
  .pcard-time { font-size: 0.8rem; font-weight: 600; color: #475569; font-variant-numeric: tabular-nums; }
  .pcard-wait { font-size: 0.72rem; font-weight: 500; }

  .pcard-reason-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .pcard-reason { font-size: 0.78rem; color: #475569; font-style: italic; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pcard-priority { font-size: 0.68rem; font-weight: 600; padding: 2px 8px; border-radius: 99px; white-space: nowrap; flex-shrink: 0; }
  .pcard-dept { font-size: 0.72rem; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 6px; width: fit-content; }
  .pcard-cta {
    width: 100%; padding: 9px; border: none; border-radius: 8px;
    color: #fff; font-size: 0.82rem; font-weight: 600; cursor: pointer;
    transition: opacity .15s, transform .1s; letter-spacing: 0.2px;
  }
  .pcard-cta:hover { opacity: .88; transform: translateY(-1px); }
  .pcard-cta:active { transform: translateY(0); }
  .pcard-cta--view { background: #f1f5f9 !important; color: #475569 !important; border: 1.5px solid #e2e8f0; }

  /* Follow-up panel */
  .dd-stat--fu { border: none; outline: none; font-family: inherit; }
  .dd-fu-panel {
    margin: 0 18px; border: 1.5px solid #7c3aed; border-radius: 12px;
    background: #fdf4ff; overflow: hidden;
  }
  .dd-fu-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 16px; font-size: 0.85rem; font-weight: 600; color: #6d28d9;
    background: #f5f3ff; border-bottom: 1.5px solid #ddd6fe;
  }
  .dd-fu-header button {
    background: none; border: none; cursor: pointer; font-size: 0.85rem; color: #a78bfa;
  }
  .dd-fu-list { max-height: 240px; overflow-y: auto; }
  .dd-fu-row {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 16px; border-bottom: 1px solid #ede9fe;
  }
  .dd-fu-row:last-child { border-bottom: none; }
  .dd-fu-avatar {
    width: 34px; height: 34px; border-radius: 50%; background: #7c3aed;
    color: #fff; display: flex; align-items: center; justify-content: center;
    font-size: 0.78rem; font-weight: 700; flex-shrink: 0; text-transform: uppercase;
  }
  .dd-fu-info { flex: 1; display: flex; flex-direction: column; gap: 1px; }
  .dd-fu-name { font-size: 0.85rem; font-weight: 600; color: #1e293b; }
  .dd-fu-meta { font-size: 0.73rem; color: #7c3aed; }
  .dd-fu-call {
    text-decoration: none; font-size: 1.1rem;
    background: #ede9fe; padding: 5px 8px; border-radius: 8px;
    transition: background .15s;
  }
  .dd-fu-call:hover { background: #ddd6fe; }
`;
