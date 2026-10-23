import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, FlaskConical, Receipt, SkipForward, RotateCcw } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { Field } from '../../components/hmis/ui';
import SessionPicker from '../../components/hmis/SessionPicker';
import { get, post, todayIST, addDays, fmtDate, money } from '../../utils/hmisApi';
import '../../assets/CSS/Hmis.css';

// Registration step 2: book the registered patient with a doctor. Laid out for
// a desk that does this all day: patient confirmed at the top, doctors and
// slots on the left, everything needed to finish on a panel that stays in
// view on the right, and Ctrl+Enter to book (then again to go to billing).

const PRIORITIES = ['Routine', 'Urgent', 'Emergency'];
const COMPLAINTS = ['Fever', 'Follow-up', 'Review with reports', 'Cough / cold', 'Body pain', 'BP check', 'Sugar check', 'Pregnancy check-up'];

const ageOf = (dob) => {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let y = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) y -= 1;
  return y;
};

function PatientStrip({ regNo, visits }) {
  const [p, setP] = useState(null);
  useEffect(() => {
    get(`/api/patients/search?q=${encodeURIComponent(regNo)}`).then((r) => setP((r.data.patients || []).find((x) => x.reg_no === regNo) || null));
  }, [regNo]);
  const name = p ? [p.title, p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ') : regNo;
  const age = ageOf(p?.dob);
  return (
    <div className="bk-pt">
      <span className="bk-avatar">{(p?.first_name?.[0] || '#').toUpperCase()}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <strong>{name}</strong>
        <div className="bk-facts">
          <span>UHID <b>{regNo}</b></span>
          {(age !== null || p?.gender) && <span>{[age !== null ? `${age} y` : null, p?.gender].filter(Boolean).join(' · ')}</span>}
          {p?.telephone && <span>📞 {p.telephone}</span>}
        </div>
      </div>
      {visits.length > 0 && (
        <div className="bk-visits">
          <span>Already booked:</span>
          {visits.map((v) => (
            <span key={v.id} className="hm-badge violet">
              {v.appt_date === todayIST() ? 'Today' : fmtDate(v.appt_date, { day: '2-digit', month: 'short' })} {v.appt_time} · {v.doctor} · {v.status}{v.token_number ? ` · token ${v.token_number}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OpBookingStep({ regNo, onContinue, active = true }) {
  const { alert, showAlert, hideAlert } = useAlert();
  const [date, setDate] = useState(todayIST());
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const [priority, setPriority] = useState('Routine');
  const [checkInNow, setCheckInNow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [booked, setBooked] = useState(null);
  const [visits, setVisits] = useState([]);

  // The patient's open appointments from today on, so a second booking with
  // the same doctor (which the system refuses) is visible before trying.
  const loadVisits = useCallback(async () => {
    const r = await get(`/api/appointments?from=${todayIST()}&to=${addDays(todayIST(), 30)}&q=${encodeURIComponent(regNo)}`);
    setVisits((r.data.appointments || []).filter((a) => a.reg_no === regNo && ['Scheduled', 'Checked In', 'In Consultation'].includes(a.status)));
  }, [regNo]);
  useEffect(() => { loadVisits(); }, [loadVisits]);
  const clash = selected && visits.find((v) => v.doctor_id === selected.session.doctor_id && v.appt_date === (selected.walkIn ? todayIST() : date));

  const isToday = selected?.walkIn || date === todayIST();

  const book = useCallback(async () => {
    if (!selected) return showAlert('Choose a doctor and a time (or Walk-in now)', 'warning');
    const s = selected.session;
    const body = { reg_no: regNo, reason, priority, roster_entry_id: s.id, ...(selected.walkIn ? { walk_in: true } : { appt_time: selected.time }) };
    setSaving(true);
    const r = await post('/api/appointments/book', body);
    if (!r.ok) { setSaving(false); return showAlert(r.data.message || 'Could not book', 'error'); }
    const a = r.data.appointment;
    let token = null;
    let status = 'Scheduled';
    if (checkInNow && a.appt_date === todayIST()) {
      const c = await post(`/api/appointments/${a.id}/check-in`);
      if (c.ok) { token = c.data.token_number; status = 'Checked In'; }
      else showAlert(`Booked, but check-in failed: ${c.data.message || 'try again from OP Appointments'}`, 'warning');
    }
    setSaving(false);
    loadVisits();
    setBooked({ ...a, department: s.department_name, doctor_id: s.doctor_id, room: s.room_name, room_number: s.room_number, priority, token, status, walkIn: !!selected.walkIn });
  }, [selected, regNo, reason, priority, checkInNow, showAlert, loadVisits]);

  const toBilling = useCallback(() => ({
    doctor: booked.doctor, doctor_id: booked.doctor_id, department: booked.department, priority: booked.priority,
    apptDate: booked.appt_date, apptTime: booked.appt_time, price: Number(booked.fee) || 0,
  }), [booked]);

  const checkIn = async () => {
    const r = await post(`/api/appointments/${booked.id}/check-in`);
    if (!r.ok) return showAlert(r.data.message || 'Could not check in', 'error');
    setBooked((b) => ({ ...b, token: r.data.token_number, status: 'Checked In' }));
  };

  const reset = () => { setBooked(null); setSelected(null); setReason(''); setPriority('Routine'); };

  // Ctrl/Cmd+Enter: book; once booked, go to billing.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (booked) onContinue(toBilling(), 'billing');
      else if (!saving) book();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, booked, saving, book, onContinue, toBilling]);

  return (
    <main className="preg-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={5000} />}
      <PatientStrip regNo={regNo} visits={booked ? [] : visits} />

      {booked ? (
        <div className="hm-card" style={{ maxWidth: 760 }}>
          <div className="hm-card-head"><h3><CalendarCheck size={17} style={{ verticalAlign: -3, marginRight: 6 }} />Appointment booked</h3></div>
          <div className="hm-card-body" style={{ display: 'grid', gridTemplateColumns: booked.token ? '1fr 180px' : '1fr', gap: 16, alignItems: 'center' }}>
            <div style={{ fontSize: 14, lineHeight: 1.8 }}>
              <div><strong style={{ fontSize: 16 }}>{booked.doctor}</strong> · {booked.department}</div>
              <div>{fmtDate(booked.appt_date)} at <b>{booked.appt_time}</b>{booked.walkIn ? ' (walk-in)' : ''} · {booked.room}{booked.room_number ? ` (${booked.room_number})` : ''}</div>
              <div>Consultation fee <b>{money(booked.fee)}</b> · {booked.priority} · <b>{booked.status}</b></div>
            </div>
            {booked.token && <div className="bk-token">Token<b>{booked.token}</b>Send to {booked.room_number || booked.room}</div>}
          </div>
          <div className="hm-modal-foot" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div className="hm-actions">
              <button type="button" className="hm-btn ghost" onClick={reset}><RotateCcw size={14} /> Book another doctor</button>
              {booked.appt_date === todayIST() && booked.status === 'Scheduled' && <button type="button" className="hm-btn success" onClick={checkIn}>Check in now</button>}
            </div>
            <div className="hm-actions">
              <button type="button" className="hm-btn" onClick={() => onContinue(toBilling(), 'lab')}><FlaskConical size={15} /> Add lab tests</button>
              <button type="button" className="hm-btn primary" onClick={() => onContinue(toBilling(), 'billing')}><Receipt size={15} /> Go to billing <kbd style={{ marginLeft: 4 }}>Ctrl ↵</kbd></button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bk">
          <div className="hm-card"><div className="hm-card-body">
            <SessionPicker date={date} setDate={(d) => { setDate(d); setSelected(null); }} selected={selected} onSelect={setSelected} allowWalkIn autoFocus={active} />
          </div></div>

          <aside className="bk-panel">
            <div className="hm-card"><div className="hm-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className={`bk-choice${selected ? '' : ' empty'}`}>
                {selected ? (
                  <>
                    <strong>Dr. {selected.session.first_name} {selected.session.last_name}</strong>
                    {selected.session.department_name} · {selected.session.room_name}<br />
                    {selected.walkIn ? <b>Walk-in now · today</b> : <b>{fmtDate(date)} at {selected.time}</b>}
                    <span style={{ float: 'right', fontWeight: 700 }}>{money(selected.session.consultation_fee)}</span>
                  </>
                ) : 'Choose a doctor’s slot, “Next free” or “Walk-in now” on the left.'}
              </div>

              <Field label="Priority">
                <div className="bk-seg" role="radiogroup" aria-label="Priority">
                  {PRIORITIES.map((p) => (
                    <button key={p} type="button" role="radio" aria-checked={priority === p}
                      className={`${priority === p ? 'on' : ''} ${p.toLowerCase()}`} onClick={() => setPriority(p)}>{p}</button>
                  ))}
                </div>
              </Field>

              <Field label="Reason / complaint">
                <input className="hm-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Type or pick below" />
                <div className="hm-chips">
                  {COMPLAINTS.map((c) => (
                    <button key={c} type="button" className={`hm-chip${reason === c ? ' on' : ''}`} onClick={() => setReason(reason === c ? '' : c)}>{c}</button>
                  ))}
                </div>
              </Field>

              {clash && (
                <div className="hm-note bad">Already booked with this doctor on {fmtDate(clash.appt_date)} at {clash.appt_time} ({clash.status}). Choose another doctor or day, or reschedule it from OP Appointments.</div>
              )}

              {isToday && (
                <label className="hm-check"><input type="checkbox" checked={checkInNow} onChange={(e) => setCheckInNow(e.target.checked)} /> Check in now and give a token</label>
              )}

              <button type="button" className="hm-btn primary lg" style={{ justifyContent: 'center' }} disabled={saving || !selected || !!clash} onClick={book}>
                {saving ? 'Booking…' : <>Book appointment <kbd style={{ marginLeft: 6, background: 'rgba(255,255,255,.2)', color: '#fff', borderColor: 'transparent' }}>Ctrl ↵</kbd></>}
              </button>
              <button type="button" className="hm-btn ghost" style={{ justifyContent: 'center' }} onClick={() => onContinue(null, 'lab')}>
                <SkipForward size={15} /> Skip — no doctor consultation
              </button>
            </div></div>
          </aside>
        </div>
      )}
    </main>
  );
}
