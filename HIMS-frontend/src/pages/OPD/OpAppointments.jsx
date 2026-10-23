import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search, UserCheck, Play, CheckCheck, CalendarClock, XCircle, Clock } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { PageHead, Tabs, Modal, Field, Badge, Stat, Empty } from '../../components/hmis/ui';
import SessionPicker from '../../components/hmis/SessionPicker';
import { get, post, isFrontDesk, hasRole, todayIST, addDays, fmtDate, weekdayShort, money } from '../../utils/hmisApi';

const PRIORITY_TONE = { Emergency: 'red', Urgent: 'amber', Routine: '' };
const patientName = (p) => [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ');

function PatientFinder({ patient, setPatient }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  useEffect(() => {
    if (q.trim().length < 3) { setResults([]); return undefined; }
    const t = setTimeout(() => get(`/api/patients/search?q=${encodeURIComponent(q.trim())}`).then((r) => setResults(r.data.patients || [])), 300);
    return () => clearTimeout(t);
  }, [q]);
  if (patient) {
    return (
      <div className="hm-note" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span><strong>{patientName(patient)}</strong> · {patient.reg_no} · {patient.gender || ''} {patient.telephone ? `· ${patient.telephone}` : ''}</span>
        <button className="hm-btn sm" onClick={() => setPatient(null)}>Change</button>
      </div>
    );
  }
  return (
    <Field label="Patient" hint="Search by name, mobile or registration number. New patients are registered on the Registration page first.">
      <div style={{ position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-soft)' }} />
        <input autoFocus className="hm-input" style={{ paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="At least 3 characters" />
      </div>
      {results.length > 0 && (
        <div style={{ border: '1px solid var(--border-light)', borderRadius: 6, maxHeight: 200, overflowY: 'auto' }}>
          {results.map((p) => (
            <button key={p.reg_no} type="button" className="hm-btn ghost" style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0 }} onClick={() => setPatient(p)}>
              <span>{patientName(p)} <span className="hm-muted">· {p.reg_no}</span></span>
              <span className="hm-muted">{p.telephone}</span>
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}

function BookModal({ initialDate, onClose, onSaved, showAlert }) {
  const [patient, setPatient] = useState(null);
  const [date, setDate] = useState(initialDate < todayIST() ? todayIST() : initialDate);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const [priority, setPriority] = useState('Routine');
  const [saving, setSaving] = useState(false);

  const book = useCallback(async () => {
    if (!patient) return showAlert('Select the patient', 'warning');
    if (!selected) return showAlert('Choose a doctor and slot, or Walk-in now', 'warning');
    const body = { reg_no: patient.reg_no, reason, priority, roster_entry_id: selected.session.id,
      ...(selected.walkIn ? { walk_in: true } : { appt_time: selected.time }) };
    setSaving(true);
    const r = await post('/api/appointments/book', body);
    setSaving(false);
    if (!r.ok) return showAlert(r.data.message || 'Could not book', 'error');
    const a = r.data.appointment;
    showAlert(`Booked with ${a.doctor} on ${fmtDate(a.appt_date)} at ${a.appt_time}. Fee ${money(a.fee)}.`, 'success');
    onSaved(a.appt_date);
  }, [patient, selected, reason, priority, showAlert, onSaved]);

  // Ctrl/Cmd+Enter books.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !saving) { e.preventDefault(); book(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [book, saving]);

  return (
    <Modal wide title="Book OP appointment" onClose={onClose}
      footer={<>
        {selected && <span style={{ marginRight: 'auto', fontSize: 13 }}>Dr. {selected.session.first_name} {selected.session.last_name} · {selected.walkIn ? 'Walk-in now' : `${fmtDate(date)} ${selected.time}`} · {money(selected.session.consultation_fee)}</span>}
        <button className="hm-btn" onClick={onClose}>Cancel</button>
        <button className="hm-btn primary" disabled={saving} onClick={book}>{saving ? 'Booking…' : <>Book <kbd style={{ marginLeft: 6, background: 'rgba(255,255,255,.2)', color: '#fff', borderColor: 'transparent' }}>Ctrl ↵</kbd></>}</button>
      </>}>
      <PatientFinder patient={patient} setPatient={setPatient} />
      <div className="hm-form">
        <Field label="Priority">
          <div className="bk-seg" role="radiogroup" aria-label="Priority">
            {['Routine', 'Urgent', 'Emergency'].map((p) => (
              <button key={p} type="button" role="radio" aria-checked={priority === p} className={`${priority === p ? 'on' : ''} ${p.toLowerCase()}`} onClick={() => setPriority(p)}>{p}</button>
            ))}
          </div>
        </Field>
        <Field label="Reason / complaint"><input className="hm-input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <SessionPicker date={date} setDate={(d) => { setDate(d); setSelected(null); }} selected={selected} onSelect={setSelected} allowWalkIn />
    </Modal>
  );
}

function RescheduleModal({ appt, onClose, onSaved, showAlert }) {
  const [date, setDate] = useState(appt.appt_date < todayIST() ? todayIST() : appt.appt_date);
  const [selected, setSelected] = useState(null);
  const save = async () => {
    if (!selected) return showAlert('Choose the new slot', 'warning');
    const r = await post(`/api/appointments/${appt.id}/reschedule`, { roster_entry_id: selected.session.id, appt_time: selected.time });
    if (!r.ok) return showAlert(r.data.message || 'Could not reschedule', 'error');
    showAlert(`Moved to ${fmtDate(r.data.appointment.appt_date)} ${r.data.appointment.appt_time} with ${r.data.appointment.doctor}`, 'success');
    onSaved(r.data.appointment.appt_date);
  };
  return (
    <Modal wide title={`Reschedule · ${appt.patient_name || appt.reg_no}`} subtitle={`Now: ${appt.doctor}, ${fmtDate(appt.appt_date)} ${appt.appt_time}`} onClose={onClose}
      footer={<><button className="hm-btn" onClick={onClose}>Cancel</button><button className="hm-btn primary" onClick={save}>Move appointment</button></>}>
      <SessionPicker date={date} setDate={(d) => { setDate(d); setSelected(null); }} selected={selected} onSelect={setSelected} />
    </Modal>
  );
}

export default function OpAppointments() {
  const { alert, showAlert, hideAlert } = useAlert();
  const desk = isFrontDesk();
  const clinician = desk || hasRole('doctor', 'nurse');
  const [tab, setTab] = useState('list');
  const [date, setDate] = useState(todayIST());
  const [rows, setRows] = useState(null);
  const [summary, setSummary] = useState({});
  const [status, setStatus] = useState('all');
  const [doctor, setDoctor] = useState('');
  const [q, setQ] = useState('');
  const [sessions, setSessions] = useState([]);
  const [book, setBook] = useState(false);
  const [resched, setResched] = useState(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ date });
    if (doctor) params.set('doctor_id', doctor);
    const [a, s] = await Promise.all([get(`/api/appointments?${params}`), get(`/api/appointments/sessions?date=${date}`)]);
    if (!a.ok) return showAlert(a.data.message || 'Could not load appointments', 'error');
    setRows(a.data.appointments || []);
    setSummary(a.data.summary || {});
    setSessions(s.data.sessions || []);
  }, [date, doctor, showAlert]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (date !== todayIST()) return undefined; const t = setInterval(load, 30000); return () => clearInterval(t); }, [date, load]);

  const doctors = useMemo(() => {
    const m = new Map();
    sessions.forEach((s) => m.set(s.doctor_id, `Dr. ${s.first_name} ${s.last_name}`));
    (rows || []).forEach((a) => a.doctor_id && !m.has(a.doctor_id) && m.set(a.doctor_id, a.doctor));
    return [...m.entries()];
  }, [sessions, rows]);

  const shown = useMemo(() => (rows || []).filter((a) => (status === 'all' || a.status === status)
    && (!q || `${a.patient_name} ${a.reg_no} ${a.telephone} ${a.token_number || ''}`.toLowerCase().includes(q.toLowerCase()))), [rows, status, q]);

  const act = async (a, action, body) => {
    if (action === 'cancel') {
      const reason = window.prompt(`Cancel ${a.patient_name || a.reg_no}'s appointment. Reason:`);
      if (!reason) return;
      body = { reason };
    }
    const r = await post(`/api/appointments/${a.id}/${action}`, body || {});
    if (!r.ok) return showAlert(r.data.message || 'Could not update', 'error');
    if (action === 'check-in') showAlert(`Checked in · token ${r.data.token_number}`, 'success');
    load();
  };

  const waiting = summary['Checked In'] || 0;
  const isToday = date === todayIST();

  return (
    <div className="hm-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={5000} />}
      <PageHead title="OP Appointments" subtitle="Bookings, check-in and the consultation queue for outpatient clinics">
        {desk && <button className="hm-btn primary" onClick={() => setBook(true)}><Plus size={16} /> Book appointment</button>}
      </PageHead>

      <div className="hm-toolbar">
        <button className="hm-btn sm" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={15} /></button>
        <strong style={{ minWidth: 170, textAlign: 'center' }}>{weekdayShort(date)}, {fmtDate(date)}</strong>
        <button className="hm-btn sm" onClick={() => setDate(addDays(date, 1))}><ChevronRight size={15} /></button>
        {!isToday && <button className="hm-btn sm" onClick={() => setDate(todayIST())}>Today</button>}
        <input type="date" className="hm-input" style={{ width: 160 }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        {!hasRole('doctor') && (
          <select className="hm-select" value={doctor} onChange={(e) => setDoctor(e.target.value)}>
            <option value="">All doctors</option>{doctors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
      </div>

      <div className="hm-stats">
        <Stat label="Booked" value={summary.Scheduled || 0} />
        <Stat label="Waiting" value={waiting} tone={waiting > 10 ? 'warn' : ''} />
        <Stat label="In consultation" value={summary['In Consultation'] || 0} />
        <Stat label="Completed" value={summary.Completed || 0} tone="good" />
        <Stat label="No show" value={summary['No Show'] || 0} tone={summary['No Show'] ? 'bad' : ''} />
        <Stat label="Cancelled" value={summary.Cancelled || 0} />
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'list', label: 'Appointments' }, { id: 'sessions', label: `Doctor sessions (${sessions.length})` }]} />

      {tab === 'list' && (
        <div className="hm-card">
          <div className="hm-card-head">
            <div className="hm-toolbar" style={{ flex: 1 }}>
              <div className="grow" style={{ position: 'relative', maxWidth: 340 }}>
                <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-soft)' }} />
                <input className="hm-input" style={{ paddingLeft: 32 }} placeholder="Patient, UHID, mobile or token" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <select className="hm-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">All statuses</option>
                {['Scheduled', 'Checked In', 'In Consultation', 'Completed', 'No Show', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="hm-table-wrap">
            <table className="hm-table">
              <thead><tr><th>Time</th><th>Token</th><th>Patient</th><th>Doctor</th><th>Source</th><th>Status</th><th /></tr></thead>
              <tbody>
                {!rows && <tr><td colSpan={7}><Empty>Loading…</Empty></td></tr>}
                {rows && shown.length === 0 && <tr><td colSpan={7}><Empty>No appointments.</Empty></td></tr>}
                {shown.map((a) => (
                  <tr key={a.id} style={{ opacity: ['Cancelled', 'No Show'].includes(a.status) ? 0.6 : 1 }}>
                    <td className="hm-mono"><strong>{a.appt_time}</strong>{a.priority !== 'Routine' && <span className="sub"><Badge tone={PRIORITY_TONE[a.priority]}>{a.priority}</Badge></span>}</td>
                    <td className="hm-mono" style={{ fontSize: 16, fontWeight: 700 }}>{a.token_number || '—'}</td>
                    <td><strong>{a.patient_name || a.reg_no}</strong><span className="sub">{a.reg_no}{a.telephone ? ` · ${a.telephone}` : ''}{a.reason ? ` · ${a.reason}` : ''}</span></td>
                    <td>{a.doctor}<span className="sub">{a.department}{a.room_name ? ` · ${a.room_name}` : ''}</span></td>
                    <td style={{ fontSize: 12 }}>{a.booking_source}{a.rescheduled_from && <span className="sub">rescheduled</span>}</td>
                    <td>
                      <Badge>{a.status}</Badge>
                      {a.checkin_time && <span className="sub"><Clock size={10} /> in {a.checkin_time}{a.wait_minutes !== null && a.wait_minutes !== undefined ? ` · waited ${a.wait_minutes}m` : ''}</span>}
                      {a.cancel_reason && <span className="sub">{a.cancel_reason}</span>}
                    </td>
                    <td>
                      <div className="hm-actions">
                        {desk && a.status === 'Scheduled' && isToday && <button className="hm-btn sm success" onClick={() => act(a, 'check-in')}><UserCheck size={13} /> Check in</button>}
                        {clinician && a.status === 'Checked In' && <button className="hm-btn sm" onClick={() => act(a, 'start')}><Play size={13} /> Start</button>}
                        {clinician && ['Checked In', 'In Consultation'].includes(a.status) && <button className="hm-btn sm success" onClick={() => act(a, 'complete')}><CheckCheck size={13} /> Done</button>}
                        {desk && a.status === 'Scheduled' && <button className="hm-btn sm" onClick={() => setResched(a)}><CalendarClock size={13} /></button>}
                        {desk && a.status === 'Scheduled' && date <= todayIST() && <button className="hm-btn sm" onClick={() => act(a, 'no-show')}>No show</button>}
                        {desk && ['Scheduled', 'Checked In'].includes(a.status) && <button className="hm-btn sm danger" title="Cancel" onClick={() => act(a, 'cancel')}><XCircle size={13} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'sessions' && (
        sessions.length === 0 ? <Empty>No OPD sessions on this day. Add them on the Duty Roster with duty type OPD.</Empty> : (
          <div className="hm-rooms">
            {sessions.map((s) => {
              const total = s.slots.reduce((n, sl) => n + sl.capacity, 0);
              const booked = s.slots.reduce((n, sl) => n + sl.booked, 0);
              return (
                <div key={s.id} className={`hm-room ${booked ? 'busy' : 'idle'}`}>
                  <h4>Dr. {s.first_name} {s.last_name}</h4>
                  <span className="hm-muted" style={{ fontSize: 12.5 }}>{s.department_name} · {s.room_name} · {s.start_time}–{s.end_time}</span>
                  <div style={{ fontSize: 13 }}>{booked}/{total} slots booked · {s.slot_minutes}-min slots · {money(s.consultation_fee)}</div>
                  <div style={{ height: 6, background: 'var(--bg-surface)', borderRadius: 3 }}><div style={{ height: 6, width: `${total ? (booked / total) * 100 : 0}%`, background: 'var(--blue-primary)', borderRadius: 3 }} /></div>
                  <span className="hm-muted" style={{ fontSize: 12 }}>{s.online_booking ? 'Open for online booking' : 'Desk booking only'}</span>
                </div>
              );
            })}
          </div>
        )
      )}

      {book && <BookModal initialDate={date} onClose={() => setBook(false)} onSaved={(d) => { setBook(false); setDate(d); load(); }} showAlert={showAlert} />}
      {resched && <RescheduleModal appt={resched} onClose={() => setResched(null)} onSaved={(d) => { setResched(null); setDate(d); load(); }} showAlert={showAlert} />}
    </div>
  );
}
