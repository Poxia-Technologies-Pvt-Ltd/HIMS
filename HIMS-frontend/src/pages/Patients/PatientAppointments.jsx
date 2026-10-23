import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { PageHead, Tabs, Field, Badge, Empty } from '../../components/hmis/ui';
import { todayIST, addDays, fmtDate, weekdayShort, money } from '../../utils/hmisApi';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Patient portal requests carry the portal token (not the staff cookie).
const usePortal = () => {
  const phone = useMemo(() => { try { return JSON.parse(localStorage.getItem('patient_data') || '{}').phone; } catch { return null; } }, []);
  const call = useCallback(async (method, path, body) => {
    const res = await fetch(`${API_BASE}/api/appointments/portal/${phone}${path}`, {
      method,
      headers: { Authorization: `Bearer ${localStorage.getItem('patient_token')}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    if (!res) return { ok: false, data: { message: 'Network error' } };
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.success !== false, status: res.status, data };
  }, [phone]);
  return { phone, call };
};

function BookTab({ call, onBooked, showAlert }) {
  const [patients, setPatients] = useState([]);
  const [options, setOptions] = useState([]);
  const [windowDays, setWindowDays] = useState(30);
  const [regNo, setRegNo] = useState('');
  const [branch, setBranch] = useState('');
  const [dept, setDept] = useState('');
  const [date, setDate] = useState(todayIST());
  const [sessions, setSessions] = useState(null);
  const [pick, setPick] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    call('GET', '/patients').then((r) => { setPatients(r.data.patients || []); setRegNo(r.data.patients?.[0]?.reg_no || ''); });
    call('GET', '/options').then((r) => { setOptions(r.data.options || []); setWindowDays(r.data.booking_window_days || 30); });
  }, [call]);
  useEffect(() => {
    setSessions(null); setPick(null);
    const p = new URLSearchParams({ date });
    if (branch) p.set('branch_id', branch);
    if (dept) p.set('department_id', dept);
    call('GET', `/sessions?${p}`).then((r) => setSessions(r.data.sessions || []));
  }, [call, date, branch, dept]);

  const branches = [...new Map(options.map((o) => [o.branch_id, o.branch_name])).entries()];
  const depts = [...new Map(options.filter((o) => !branch || String(o.branch_id) === branch).map((o) => [o.department_id, o.department_name])).entries()];
  const maxDate = addDays(todayIST(), windowDays);

  const book = async () => {
    if (!regNo) return showAlert('Choose who the appointment is for', 'warning');
    if (!pick) return showAlert('Choose a doctor and time', 'warning');
    setSaving(true);
    const r = await call('POST', '/book', { reg_no: regNo, roster_entry_id: pick.session.id, appt_time: pick.time, reason });
    setSaving(false);
    if (!r.ok) return showAlert(r.data.message || 'Could not book', 'error');
    const a = r.data.appointment;
    showAlert(`Booked: ${a.doctor}, ${fmtDate(a.appt_date)} at ${a.appt_time}. Please arrive 15 minutes early and check in at the OPD desk.`, 'success');
    onBooked();
  };

  if (!patients.length) return <div className="hm-note">No patient registration is linked to your mobile number yet. Please register at the hospital first.</div>;

  return (
    <div className="hm-card">
      <div className="hm-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="hm-form">
          <Field label="Appointment for">
            <select className="hm-select" value={regNo} onChange={(e) => setRegNo(e.target.value)}>
              {patients.map((p) => <option key={p.reg_no} value={p.reg_no}>{[p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ')} ({p.reg_no})</option>)}
            </select>
          </Field>
          {branches.length > 1 && (
            <Field label="Hospital">
              <select className="hm-select" value={branch} onChange={(e) => { setBranch(e.target.value); setDept(''); }}>
                <option value="">Any</option>{branches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Department">
            <select className="hm-select" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">Any</option>{depts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </Field>
          <Field label="Date">
            <div className="hm-toolbar">
              <button className="hm-btn sm" disabled={date <= todayIST()} onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={14} /></button>
              <input type="date" className="hm-input" style={{ flex: 1 }} min={todayIST()} max={maxDate} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              <button className="hm-btn sm" disabled={date >= maxDate} onClick={() => setDate(addDays(date, 1))}><ChevronRight size={14} /></button>
            </div>
          </Field>
        </div>

        {!sessions && <Empty>Loading…</Empty>}
        {sessions?.length === 0 && <Empty>No doctors are available for online booking on {weekdayShort(date)}, {fmtDate(date)}. Try another date.</Empty>}
        {sessions?.map((s) => (
          <div key={s.id} className={`hm-session${pick?.session.id === s.id ? ' on' : ''}`}>
            <div className="hm-session-head">
              <div>
                <strong>{s.doctor_name}</strong> <span className="hm-muted">{[s.designation, s.qualification].filter(Boolean).join(', ')}</span>
                <div className="hm-muted" style={{ fontSize: 12.5 }}>{s.department_name} · {s.branch_name} · {s.room_name}{s.room_number ? ` (${s.room_number})` : ''}</div>
              </div>
              <div style={{ textAlign: 'right' }}><strong>{money(s.consultation_fee)}</strong><div className="hm-muted" style={{ fontSize: 12 }}>pay at the hospital</div></div>
            </div>
            <div className="hm-slots">
              {s.slots.map((sl) => (
                <button key={sl.time} type="button" disabled={!sl.available}
                  className={`hm-slot${pick?.session.id === s.id && pick.time === sl.time ? ' on' : ''}`}
                  onClick={() => setPick({ session: s, time: sl.time })}>{sl.time}</button>
              ))}
            </div>
          </div>
        ))}

        {pick && (
          <div className="hm-form" style={{ alignItems: 'end' }}>
            <Field label="Reason for visit (optional)"><input className="hm-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
            <button className="hm-btn primary lg" disabled={saving} onClick={book}>
              <CalendarPlus size={17} /> {saving ? 'Booking…' : `Book ${pick.time} with ${pick.session.doctor_name}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MyAppointments({ call, showAlert, refresh }) {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => call('GET', '/appointments').then((r) => setRows(r.data.appointments || [])), [call]);
  useEffect(() => { load(); }, [load, refresh]);
  const cancel = async (a) => {
    if (!window.confirm(`Cancel your appointment with ${a.doctor} on ${fmtDate(a.appt_date)} at ${a.appt_time}?`)) return;
    const r = await call('POST', `/appointments/${a.id}/cancel`, { reason: 'Cancelled by patient' });
    if (!r.ok) return showAlert(r.data.message || 'Could not cancel', 'error');
    showAlert('Appointment cancelled', 'success');
    load();
  };
  const today = todayIST();
  const upcoming = (rows || []).filter((a) => a.appt_date >= today && ['Scheduled', 'Checked In', 'In Consultation'].includes(a.status)).reverse();
  const past = (rows || []).filter((a) => !upcoming.includes(a));
  const table = (list, canCancel) => (
    <div className="hm-table-wrap">
      <table className="hm-table">
        <thead><tr><th>Date & time</th><th>Patient</th><th>Doctor</th><th>Where</th><th>Status</th>{canCancel && <th />}</tr></thead>
        <tbody>
          {list.length === 0 && <tr><td colSpan={6}><Empty>None.</Empty></td></tr>}
          {list.map((a) => (
            <tr key={a.id}>
              <td><strong>{weekdayShort(a.appt_date)}, {fmtDate(a.appt_date)}</strong><span className="sub">{a.appt_time}{a.token_number ? ` · token ${a.token_number}` : ''}</span></td>
              <td>{a.patient_name}</td>
              <td>{a.doctor}<span className="sub">{a.department}</span></td>
              <td>{a.branch_name}<span className="sub">{a.room_name}</span></td>
              <td><Badge>{a.status}</Badge></td>
              {canCancel && <td>{a.status === 'Scheduled' && <button className="hm-btn sm danger" onClick={() => cancel(a)}>Cancel</button>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  if (!rows) return <Empty>Loading…</Empty>;
  return (
    <>
      <div className="hm-card"><div className="hm-card-head"><h3>Upcoming</h3></div>{table(upcoming, true)}</div>
      <div className="hm-card"><div className="hm-card-head"><h3>Past & cancelled</h3></div>{table(past, false)}</div>
    </>
  );
}

export default function PatientAppointments() {
  const { alert, showAlert, hideAlert } = useAlert();
  const { call } = usePortal();
  const [tab, setTab] = useState('mine');
  const [refresh, setRefresh] = useState(0);
  return (
    <div className="hm-portal">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={7000} />}
      <PageHead title="Doctor appointments" subtitle="Book an outpatient consultation for yourself or a family member on this mobile number" />
      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'mine', label: 'My appointments' }, { id: 'book', label: 'Book an appointment' }]} />
      {tab === 'book' && <BookTab call={call} showAlert={showAlert} onBooked={() => { setRefresh((n) => n + 1); setTab('mine'); }} />}
      {tab === 'mine' && <MyAppointments call={call} showAlert={showAlert} refresh={refresh} />}
    </div>
  );
}
