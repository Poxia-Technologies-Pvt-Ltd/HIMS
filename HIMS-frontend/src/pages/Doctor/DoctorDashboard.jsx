import { useState, useEffect, useCallback, useMemo } from 'react';
import { Play, RefreshCw, Search, X, Clock, CheckCircle2, UserRound, Phone } from 'lucide-react';
import ConsultationWorkspace from './ConsultationWorkspace';
import '../../assets/CSS/Consultation.css';

// Doctor Console: who is waiting, one big button for the next patient, and
// plain columns — waiting in the hospital, booked but not here yet, seen today.
// Refreshes on its own so the doctor never has to.

const REFRESH_MS = 30000;
const PRIORITY_RANK = { Emergency: 0, Urgent: 1 };

const calcAge = (dob) => (dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000)) : '');
const fmt12 = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const minutesSince = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() - (h * 60 + m);
};
const nameOf = (a) => [a.first_name, a.middle_name, a.last_name].filter(Boolean).join(' ') || a.reg_no;
const laneOf = (a) => {
  if (a.consultation_status === 'Completed' || a.appt_status === 'Completed') return 'done';
  if (a.appt_status === 'In Consultation') return 'now';
  if (a.appt_status === 'Checked In') return 'waiting';
  return 'booked';
};
const byQueue = (a, b) => (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2)
  || (parseInt(a.token_number, 10) || 999) - (parseInt(b.token_number, 10) || 999)
  || String(a.appt_time).localeCompare(String(b.appt_time));

function PatientCard({ a, lane, onOpen }) {
  const age = calcAge(a.dob);
  const waited = lane === 'waiting' ? minutesSince(a.checkin_time) : null;
  return (
    <div className={`dd2-card p-${(a.priority || 'Routine').toLowerCase()}`}>
      <div className="dd2-token">{a.token_number ? <><small>Token</small>{a.token_number}</> : <small>{fmt12(a.appt_time)}</small>}</div>
      <div className="dd2-info">
        <strong>{nameOf(a)}</strong>
        <span>{[age !== '' ? `${age} yrs` : null, a.gender, a.reg_no].filter(Boolean).join(' · ')}</span>
        {a.reason && <span className="dd2-reason">“{a.reason}”</span>}
        <span className="dd2-meta">
          {a.priority && a.priority !== 'Routine' && <b className={`dd2-pri ${a.priority.toLowerCase()}`}>{a.priority}</b>}
          {lane === 'waiting' && waited !== null && waited >= 0 && <span className={waited > 30 ? 'late' : ''}><Clock size={12} /> waiting {waited} min</span>}
          {lane === 'booked' && <span><Clock size={12} /> booked for {fmt12(a.appt_time)}</span>}
        </span>
      </div>
      <button type="button" className={`dd2-open ${lane}`} onClick={() => onOpen(a)}>
        {lane === 'done' ? 'View' : lane === 'booked' ? 'See now' : 'Start'}
      </button>
    </div>
  );
}

export default function DoctorDashboard() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [followUps, setFollowUps] = useState([]);
  const [clock, setClock] = useState(() => new Date());

  let me = {};
  try { me = JSON.parse(localStorage.getItem('user') || '{}'); } catch { /* ignore */ }

  const load = useCallback(async (quiet) => {
    if (!quiet) setLoading(true);
    try {
      const [a, f] = await Promise.all([
        fetch('/api/consultations/today').then((r) => r.json()),
        fetch('/api/consultations/followup-due').then((r) => r.json()).catch(() => ({})),
      ]);
      if (a.success) setAppointments(a.appointments || []);
      if (f.success) setFollowUps(f.followups || []);
    } catch { /* offline: keep what is shown */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(false); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!selected) load(true); setClock(new Date()); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, selected]);

  const lanes = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = appointments.filter((a) => !q || `${nameOf(a)} ${a.reg_no} ${a.token_number || ''}`.toLowerCase().includes(q));
    const out = { now: [], waiting: [], booked: [], done: [] };
    list.forEach((a) => out[laneOf(a)].push(a));
    out.waiting.sort(byQueue);
    out.booked.sort((a, b) => String(a.appt_time).localeCompare(String(b.appt_time)));
    return out;
  }, [appointments, search]);

  const next = lanes.waiting[0];
  const hour = clock.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const doctorName = [me.firstName, me.lastName].filter(Boolean).join(' ');

  const columns = [
    { id: 'waiting', title: 'Waiting in hospital', hint: 'Checked in at the front desk', empty: 'Nobody is waiting right now.' },
    { id: 'booked', title: 'Booked – not arrived yet', hint: 'Appointments later today', empty: 'No more bookings today.' },
    { id: 'done', title: 'Seen today', hint: 'Finished consultations', empty: 'No patients seen yet.' },
  ];

  return (
    <div className="dd2">
      <div className="dd2-head">
        <div>
          <h1>{greet}{doctorName ? `, Dr. ${doctorName}` : ''}</h1>
          <p>{clock.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · {appointments.length} patient{appointments.length === 1 ? '' : 's'} today · {lanes.done.length} seen</p>
        </div>
        <div className="dd2-head-actions">
          <div className="cw-search" style={{ width: 280 }}>
            <Search size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find patient, UHID or token" />
            {search && <button type="button" className="cw-x" style={{ position: 'absolute', right: 10 }} onClick={() => setSearch('')} aria-label="Clear"><X size={14} /></button>}
          </div>
          <button type="button" className="cw-btn" onClick={() => load(false)}><RefreshCw size={15} /> Refresh</button>
        </div>
      </div>

      {lanes.now.map((a) => (
        <div key={a.appointment_id} className="dd2-now">
          <UserRound size={22} />
          <span>You are seeing <b>{nameOf(a)}</b>{a.token_number ? ` (token ${a.token_number})` : ''}</span>
          <button type="button" className="cw-btn primary" onClick={() => setSelected(a)}>Continue</button>
        </div>
      ))}

      <button type="button" className="dd2-next" disabled={!next} onClick={() => next && setSelected(next)}>
        <Play size={26} />
        {next
          ? <span>Call next patient<small>{next.token_number ? `Token ${next.token_number} · ` : ''}{nameOf(next)}{next.priority && next.priority !== 'Routine' ? ` · ${next.priority}` : ''}</small></span>
          : <span>No patient waiting<small>Patients appear here when the front desk checks them in</small></span>}
      </button>

      {loading ? <div className="cw-empty">Loading today's patients…</div> : (
        <div className="dd2-cols">
          {columns.map((c) => (
            <section key={c.id} className={`dd2-col c-${c.id}`}>
              <header><h2>{c.title} <b>{lanes[c.id].length}</b></h2><span>{c.hint}</span></header>
              <div className="dd2-list">
                {lanes[c.id].length === 0 && <p className="dd2-empty">{c.empty}</p>}
                {lanes[c.id].map((a) => <PatientCard key={a.appointment_id} a={a} lane={c.id} onOpen={setSelected} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      {followUps.length > 0 && (
        <section className="cw-card" style={{ marginTop: 16 }}>
          <h2>Follow-up due today <small>({followUps.length})</small></h2>
          {followUps.map((f, i) => (
            <div key={i} className="cw-order">
              <b>{[f.first_name, f.last_name].filter(Boolean).join(' ')}</b> {f.reg_no} · {f.diagnosis || '—'}
              {f.telephone && <a className="cw-btn sm" style={{ marginLeft: 'auto', textDecoration: 'none' }} href={`tel:${f.telephone}`}><Phone size={14} /> Call</a>}
            </div>
          ))}
        </section>
      )}

      {selected && <ConsultationWorkspace appointment={selected} onClose={() => { setSelected(null); load(true); }} />}
      {!loading && appointments.length === 0 && (
        <div className="cw-empty" style={{ marginTop: 16 }}><CheckCircle2 size={18} /> No appointments for you today.</div>
      )}
    </div>
  );
}
