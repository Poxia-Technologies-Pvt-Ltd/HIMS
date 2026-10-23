import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Copy, Search } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { PageHead, Tabs, Modal, Field, Badge, Empty, WeekdayPicker } from '../../components/hmis/ui';
import {
  get, post, put, del, isRosterPlanner, todayIST, addDays, weekStart, fmtDate, weekdayShort, fullName, money,
} from '../../utils/hmisApi';

const DUTY_TYPES = ['General', 'OPD', 'IPD', 'Emergency', 'OT', 'On-Call', 'Weekly Off'];
const DUTY_COLORS = { OPD: '#10b981', IPD: '#6366f1', Emergency: '#dc2626', OT: '#0891b2', 'On-Call': '#a855f7', General: '#1a6fd4', 'Weekly Off': '#94a3b8' };
const ROOM_TYPES_FOR = {
  OPD: ['OPD Cabin', 'Room', 'Procedure Room'], IPD: ['Ward', 'ICU'], Emergency: ['Emergency'], OT: ['OT'],
};

function ConflictList({ conflicts }) {
  return (
    <div className="hm-note bad" style={{ maxHeight: 180, overflowY: 'auto' }}>
      <strong>{conflicts.length} clash{conflicts.length === 1 ? '' : 'es'}:</strong>
      <ul style={{ margin: '6px 0 0 18px' }}>
        {conflicts.slice(0, 40).map((c, i) => <li key={i}>{c.name ? `${c.name}, ` : ''}{fmtDate(c.date)} — {c.reasons.join('; ')}</li>)}
      </ul>
    </div>
  );
}

function DutyForm({ value, setValue, shifts, rooms, departments }) {
  const set = (k, v) => setValue((p) => ({ ...p, [k]: v }));
  const opd = value.duty_type === 'OPD';
  const roomChoices = rooms.filter((r) => !ROOM_TYPES_FOR[value.duty_type] || ROOM_TYPES_FOR[value.duty_type].includes(r.type));
  return (
    <div className="hm-form">
      <Field label="Duty type">
        <select className="hm-select" value={value.duty_type} onChange={(e) => set('duty_type', e.target.value)}>
          {DUTY_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </Field>
      {value.duty_type !== 'Weekly Off' && <>
        <Field label="Shift">
          <select className="hm-select" value={value.shift_id || ''} onChange={(e) => {
            const s = shifts.find((x) => String(x.id) === e.target.value);
            setValue((p) => ({ ...p, shift_id: e.target.value, start_time: s ? s.start_time : p.start_time, end_time: s ? s.end_time : p.end_time }));
          }}>
            <option value="">Custom hours</option>
            {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start_time}–{s.end_time})</option>)}
          </select>
        </Field>
        <Field label="From"><input type="time" className="hm-input" value={value.start_time} onChange={(e) => setValue((p) => ({ ...p, start_time: e.target.value, shift_id: '' }))} /></Field>
        <Field label="To" hint={value.end_time && value.start_time && value.end_time <= value.start_time ? 'Ends next day' : ''}>
          <input type="time" className="hm-input" value={value.end_time} onChange={(e) => setValue((p) => ({ ...p, end_time: e.target.value, shift_id: '' }))} />
        </Field>
        <Field label={opd ? 'Consultation room *' : 'Room / area'}>
          <select className="hm-select" value={value.room_id || ''} onChange={(e) => set('room_id', e.target.value)}>
            <option value="">—</option>
            {roomChoices.map((r) => <option key={r.id} value={r.id}>{r.name}{r.room_number ? ` (${r.room_number})` : ''} · {r.type}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <select className="hm-select" value={value.department_id || ''} onChange={(e) => set('department_id', e.target.value)}>
            <option value="">Employee's own</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </>}
      {opd && <>
        <div className="hm-section-title">OP booking</div>
        <Field label="Consultation fee (₹)"><input type="number" min="0" className="hm-input" value={value.consultation_fee} onChange={(e) => set('consultation_fee', e.target.value)} /></Field>
        <Field label="Slot length (minutes)">
          <select className="hm-select" value={value.slot_minutes} onChange={(e) => set('slot_minutes', e.target.value)}>
            {[5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Patients per slot"><input type="number" min="1" max="20" className="hm-input" value={value.patients_per_slot} onChange={(e) => set('patients_per_slot', e.target.value)} /></Field>
        <label className="hm-check"><input type="checkbox" checked={!!value.online_booking} onChange={(e) => set('online_booking', e.target.checked)} /> Open for online booking</label>
      </>}
      <Field label="Notes" className="full"><input className="hm-input" value={value.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
    </div>
  );
}

const blankDuty = () => ({
  duty_type: 'General', shift_id: '', start_time: '09:00', end_time: '17:00', room_id: '', department_id: '',
  consultation_fee: 0, slot_minutes: 15, patients_per_slot: 1, online_booking: true, notes: '',
});

function AssignModal({ preset, employees, shifts, rooms, departments, onClose, onSaved, showAlert }) {
  const [ids, setIds] = useState(preset.employee_id ? [preset.employee_id] : []);
  const [from, setFrom] = useState(preset.date || todayIST());
  const [to, setTo] = useState(preset.date || addDays(todayIST(), 6));
  const [weekdays, setWeekdays] = useState(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  const [duty, setDuty] = useState(blankDuty);
  const [filter, setFilter] = useState('');
  const [conflicts, setConflicts] = useState(null);
  const [saving, setSaving] = useState(false);

  const shown = employees.filter((e) => !filter || `${fullName(e)} ${e.designation || ''} ${e.department_name || ''}`.toLowerCase().includes(filter.toLowerCase()));
  const toggle = (id) => setIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const save = async (skip = false) => {
    if (!ids.length) return showAlert('Select at least one employee', 'warning');
    setSaving(true);
    const r = await post('/api/roster', { ...duty, employee_ids: ids, from, to, weekdays, skip_conflicts: skip });
    setSaving(false);
    if (r.status === 409) return setConflicts(r.data.conflicts || []);
    if (!r.ok) return showAlert(r.data.message || 'Could not save', 'error');
    showAlert(`${r.data.created} dut${r.data.created === 1 ? 'y' : 'ies'} added${r.data.skipped?.length ? `, ${r.data.skipped.length} skipped` : ''}`, 'success');
    onSaved();
  };

  return (
    <Modal wide title="Assign duties" subtitle="One or more staff, over a date range" onClose={onClose}
      footer={<>
        <button className="hm-btn" onClick={onClose}>Cancel</button>
        {conflicts?.length > 0 && <button className="hm-btn" disabled={saving} onClick={() => save(true)}>Skip clashes, save the rest</button>}
        <button className="hm-btn primary" disabled={saving} onClick={() => save(false)}>{saving ? 'Saving…' : 'Assign'}</button>
      </>}>
      <div className="hm-form">
        <Field label="Staff" className="full" hint={`${ids.length} selected`}>
          <input className="hm-input" placeholder="Filter by name, designation, department" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div style={{ maxHeight: 170, overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: 6, padding: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 2 }}>
            {shown.map((e) => (
              <label key={e.id} className="hm-check" style={{ padding: '3px 4px' }}>
                <input type="checkbox" checked={ids.includes(e.id)} onChange={() => toggle(e.id)} />
                <span>{fullName(e)} <span className="hm-muted">· {e.designation || e.staff_category}</span></span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="From"><input type="date" className="hm-input" value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
        <Field label="To"><input type="date" className="hm-input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="On these days" className="full"><WeekdayPicker value={weekdays} onChange={setWeekdays} /></Field>
      </div>
      <DutyForm value={duty} setValue={setDuty} shifts={shifts} rooms={rooms} departments={departments} />
      {conflicts?.length > 0 && <ConflictList conflicts={conflicts} />}
    </Modal>
  );
}

function EditDutyModal({ entry, shifts, rooms, departments, onClose, onSaved, showAlert }) {
  const [duty, setDuty] = useState(() => ({ ...blankDuty(), ...entry, shift_id: entry.shift_id || '', room_id: entry.room_id || '', department_id: entry.department_id || '', online_booking: !!entry.online_booking }));
  const [date, setDate] = useState(entry.duty_date);
  const [booked, setBooked] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const r = await put(`/api/roster/${entry.id}`, { ...duty, duty_date: date });
    setSaving(false);
    if (r.status === 409 && r.data.appointments) return setBooked(r.data.appointments);
    if (!r.ok) return showAlert(r.data.message || 'Could not save', 'error');
    showAlert('Duty updated', 'success');
    onSaved();
  };
  const cancel = async (withAppointments = false) => {
    const reason = withAppointments ? window.prompt('Reason given to patients', 'Doctor unavailable') : null;
    if (withAppointments && reason === null) return;
    if (!withAppointments && !window.confirm('Cancel this duty?')) return;
    const r = await del(`/api/roster/${entry.id}${withAppointments ? `?cancel_appointments=1&reason=${encodeURIComponent(reason)}` : ''}`);
    if (r.status === 409) return setBooked(r.data.appointments || []);
    if (!r.ok) return showAlert(r.data.message || 'Could not cancel', 'error');
    const n = r.data.cancelled_appointments?.length || 0;
    showAlert(n ? `Duty cancelled with ${n} appointments. Inform the patients listed on the OP Appointments page.` : 'Duty cancelled', n ? 'warning' : 'success');
    onSaved();
  };

  return (
    <Modal wide title={`${fullName(entry)} · ${fmtDate(entry.duty_date)}`} subtitle={entry.designation || entry.staff_category} onClose={onClose}
      footer={<>
        <button className="hm-btn danger" style={{ marginRight: 'auto' }} onClick={() => cancel(false)}>Cancel duty</button>
        <button className="hm-btn" onClick={onClose}>Close</button>
        <button className="hm-btn primary" disabled={saving} onClick={save}>Save</button>
      </>}>
      <div className="hm-form">
        <Field label="Date"><input type="date" className="hm-input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <DutyForm value={duty} setValue={setDuty} shifts={shifts} rooms={rooms} departments={departments} />
      {booked && (
        <div className="hm-note bad">
          <strong>{booked.length} patients are booked on this session.</strong> Move them on the OP Appointments page first, or cancel the session with them.
          <ul style={{ margin: '6px 0 8px 18px' }}>{booked.map((a) => <li key={a.id}>{a.appt_time} — {a.patient_name || a.reg_no} {a.telephone ? `(${a.telephone})` : ''}</li>)}</ul>
          <button className="hm-btn sm danger" onClick={() => cancel(true)}>Cancel session and these appointments</button>
        </div>
      )}
    </Modal>
  );
}

function ShiftsTab({ shifts, reload, showAlert }) {
  const [edit, setEdit] = useState(null);
  const save = async () => {
    const r = edit.id ? await put(`/api/roster/shifts/${edit.id}`, edit) : await post('/api/roster/shifts', edit);
    if (!r.ok) return showAlert(r.data.message || 'Could not save', 'error');
    setEdit(null); reload();
  };
  const retire = async (s) => {
    if (!window.confirm(`Retire the ${s.name} shift? Existing duties keep their hours.`)) return;
    const r = await del(`/api/roster/shifts/${s.id}`);
    if (!r.ok) return showAlert(r.data.message || 'Could not retire', 'error');
    reload();
  };
  return (
    <div className="hm-card">
      <div className="hm-card-head"><h3>Shifts</h3><button className="hm-btn primary sm" onClick={() => setEdit({ name: '', code: '', start_time: '09:00', end_time: '17:00', break_minutes: 0, color: '#1a6fd4' })}><Plus size={14} /> New shift</button></div>
      <div className="hm-table-wrap">
        <table className="hm-table">
          <thead><tr><th>Shift</th><th>Code</th><th>Hours</th><th className="num">Break</th><th>Scope</th><th /></tr></thead>
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id}>
                <td><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: s.color, marginRight: 8 }} />{s.name}</td>
                <td>{s.code}</td>
                <td className="hm-mono">{s.start_time}–{s.end_time}{s.end_time <= s.start_time ? ' (+1 day)' : ''}</td>
                <td className="num">{s.break_minutes} min</td>
                <td>{s.branch_id ? 'This facility' : 'All facilities'}</td>
                <td><div className="hm-actions"><button className="hm-btn sm" onClick={() => setEdit(s)}>Edit</button><button className="hm-btn sm danger" onClick={() => retire(s)}>Retire</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : 'New shift'} onClose={() => setEdit(null)}
          footer={<><button className="hm-btn" onClick={() => setEdit(null)}>Cancel</button><button className="hm-btn primary" onClick={save}>Save</button></>}>
          <div className="hm-form">
            <Field label="Name"><input className="hm-input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Code"><input className="hm-input" value={edit.code} maxLength={10} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
            <Field label="Starts"><input type="time" className="hm-input" value={edit.start_time} onChange={(e) => setEdit({ ...edit, start_time: e.target.value })} /></Field>
            <Field label="Ends" hint="Earlier than start = ends next day"><input type="time" className="hm-input" value={edit.end_time} onChange={(e) => setEdit({ ...edit, end_time: e.target.value })} /></Field>
            <Field label="Break (minutes)"><input type="number" min="0" className="hm-input" value={edit.break_minutes} onChange={(e) => setEdit({ ...edit, break_minutes: e.target.value })} /></Field>
            <Field label="Colour"><input type="color" className="hm-input" style={{ height: 38, padding: 3 }} value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MyDuties() {
  const [entries, setEntries] = useState([]);
  useEffect(() => { get(`/api/roster/my?from=${todayIST()}&to=${addDays(todayIST(), 27)}`).then((r) => setEntries(r.data.entries || [])); }, []);
  return (
    <div className="hm-card">
      <div className="hm-card-head"><h3>My duties — next 4 weeks</h3></div>
      <div className="hm-table-wrap">
        <table className="hm-table">
          <thead><tr><th>Date</th><th>Duty</th><th>Hours</th><th>Room</th><th>Department</th></tr></thead>
          <tbody>
            {entries.length === 0 && <tr><td colSpan={5}><Empty>No duties rostered.</Empty></td></tr>}
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{weekdayShort(e.duty_date)}, {fmtDate(e.duty_date)}</td>
                <td><Badge tone="blue">{e.duty_type}</Badge> {e.shift_name && <span className="hm-muted">{e.shift_name}</span>}</td>
                <td className="hm-mono">{e.duty_type === 'Weekly Off' ? '—' : `${e.start_time}–${e.end_time}`}</td>
                <td>{e.room_name || '—'}</td>
                <td>{e.department_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DutyRoster() {
  const { alert, showAlert, hideAlert } = useAlert();
  const planner = isRosterPlanner();
  const [tab, setTab] = useState(planner ? 'roster' : 'mine');
  const [start, setStart] = useState(() => weekStart(todayIST()));
  const [data, setData] = useState({ entries: [], leaves: [], holidays: [] });
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [dept, setDept] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [assign, setAssign] = useState(null);
  const [editEntry, setEditEntry] = useState(null);
  const [copyConflicts, setCopyConflicts] = useState(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const today = todayIST();

  const loadShifts = useCallback(() => get('/api/roster/shifts').then((r) => setShifts(r.data.shifts || [])), []);
  const load = useCallback(async () => {
    const r = await get(`/api/roster?from=${start}&to=${addDays(start, 6)}`);
    if (!r.ok) return showAlert(r.data.message || 'Could not load the roster', 'error');
    setData(r.data);
  }, [start, showAlert]);

  useEffect(() => {
    if (!planner) return;
    loadShifts();
    get('/api/employees/lookup').then((r) => setEmployees(r.data.employees || []));
    get('/api/infra').then((r) => setRooms(r.data.items || []));
    get('/api/departments?is_active=true').then((r) => setDepartments(r.data.departments || []));
  }, [planner, loadShifts]);
  useEffect(() => { if (planner && tab === 'roster') load(); }, [planner, tab, load]);

  const rows = useMemo(() => employees.filter((e) =>
    (!dept || String(e.department_id) === dept || data.entries.some((x) => x.employee_id === e.id && String(x.department_id) === dept))
    && (!category || e.staff_category === category)
    && (!q || `${fullName(e)} ${e.designation || ''}`.toLowerCase().includes(q.toLowerCase()))), [employees, dept, category, q, data.entries]);

  const holidayOn = (d) => data.holidays.find((h) => h.holiday_date === d);
  const cell = (empId, d) => data.entries.filter((x) => x.employee_id === empId && x.duty_date === d);
  const leaveOn = (empId, d) => data.leaves.find((l) => l.employee_id === empId && d >= l.from_date && d <= l.to_date);

  const copyWeek = async (skip = false) => {
    const target = addDays(start, 7);
    if (!skip && !window.confirm(`Copy every duty from the week of ${fmtDate(start)} to the week of ${fmtDate(target)}?`)) return;
    const r = await post('/api/roster/copy-week', { source_week_start: start, target_week_start: target, skip_conflicts: skip });
    if (r.status === 409) return setCopyConflicts(r.data.conflicts || []);
    if (!r.ok) return showAlert(r.data.message || 'Could not copy', 'error');
    setCopyConflicts(null);
    showAlert(`${r.data.created} duties copied to next week${r.data.skipped?.length ? `, ${r.data.skipped.length} skipped` : ''}`, 'success');
    setStart(target);
  };

  const onDuty = data.entries.filter((e) => e.duty_date === today && e.duty_type !== 'Weekly Off').length;

  return (
    <div className="hm-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={5000} />}
      <PageHead title="Duty Roster" subtitle="Shifts, OPD sessions and ward duties for every member of staff">
        {planner && tab === 'roster' && <>
          <button className="hm-btn" onClick={() => copyWeek(false)}><Copy size={15} /> Copy week forward</button>
          <button className="hm-btn primary" onClick={() => setAssign({})}><Plus size={16} /> Assign duties</button>
        </>}
      </PageHead>

      <Tabs active={tab} onChange={setTab} tabs={[
        planner && { id: 'roster', label: 'Roster' },
        { id: 'mine', label: 'My duties' },
        planner && { id: 'shifts', label: 'Shifts' },
      ]} />

      {tab === 'mine' && <MyDuties />}
      {tab === 'shifts' && <ShiftsTab shifts={shifts} reload={loadShifts} showAlert={showAlert} />}

      {tab === 'roster' && (
        <div className="hm-card">
          <div className="hm-card-head">
            <div className="hm-toolbar">
              <button className="hm-btn sm" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week"><ChevronLeft size={15} /></button>
              <strong style={{ minWidth: 190, textAlign: 'center' }}>{fmtDate(start)} – {fmtDate(addDays(start, 6))}</strong>
              <button className="hm-btn sm" onClick={() => setStart(addDays(start, 7))} aria-label="Next week"><ChevronRight size={15} /></button>
              <button className="hm-btn sm" onClick={() => setStart(weekStart(today))}>This week</button>
              <input type="date" className="hm-input" style={{ width: 150 }} value={start} onChange={(e) => e.target.value && setStart(weekStart(e.target.value))} />
            </div>
            <div className="hm-toolbar">
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 9, top: 10, color: 'var(--text-soft)' }} />
                <input className="hm-input" style={{ paddingLeft: 28, width: 170 }} placeholder="Find staff" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <select className="hm-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {['Doctor', 'Nurse', 'Paramedical', 'Technician', 'Pharmacist', 'Administrative', 'Support', 'Other'].map((c) => <option key={c}>{c}</option>)}
              </select>
              <select className="hm-select" value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <div className="hm-card-body" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, paddingBottom: 8 }}>
            {Object.entries(DUTY_COLORS).map(([k, c]) => <span key={k}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: c, marginRight: 5 }} />{k}</span>)}
            <span><span className="hm-leave-tag" style={{ display: 'inline-block', padding: '0 6px' }}>CL</span> leave</span>
            <span className="hm-muted" style={{ marginLeft: 'auto' }}>{onDuty} duties today · click an empty cell to assign</span>
          </div>
          {copyConflicts && (
            <div className="hm-card-body" style={{ paddingTop: 0 }}>
              <ConflictList conflicts={copyConflicts} />
              <div className="hm-actions" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
                <button className="hm-btn sm" onClick={() => copyWeek(true)}>Skip clashes and copy the rest</button>
                <button className="hm-btn sm ghost" onClick={() => setCopyConflicts(null)}>Dismiss</button>
              </div>
            </div>
          )}
          <div className="hm-roster">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', left: 0, zIndex: 2 }}>Staff ({rows.length})</th>
                  {days.map((d) => {
                    const h = holidayOn(d);
                    return (
                      <th key={d} className={d === today ? 'today' : h ? 'holiday' : ''} title={h?.holiday_name}>
                        {weekdayShort(d)} {d.slice(8)}{h && <div style={{ fontWeight: 500, color: '#c2410c' }}>{h.holiday_name}</div>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={8}><Empty>No staff match these filters.</Empty></td></tr>}
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="person"><strong>{fullName(e)}</strong><span className="hm-muted">{e.designation || e.staff_category}{e.department_name ? ` · ${e.department_name}` : ''}</span></td>
                    {days.map((d) => {
                      const duties = cell(e.id, d);
                      const leave = leaveOn(e.id, d);
                      const off = duties.some((x) => x.duty_type === 'Weekly Off');
                      return (
                        <td key={d} className={`cell${off ? ' off' : ''}`} onClick={() => setAssign({ employee_id: e.id, date: d })}>
                          {leave && <span className={`hm-leave-tag${leave.status === 'Pending' ? ' pending' : ''}`} title={`${leave.leave_name} (${leave.status})`}>{leave.leave_code}{leave.half_day !== 'None' ? ' ½' : ''}{leave.status === 'Pending' ? ' ?' : ''}</span>}
                          {duties.map((x) => (
                            <button key={x.id} type="button" className="hm-duty" style={{ background: x.duty_type === 'Weekly Off' ? '#94a3b8' : x.shift_color && x.duty_type === 'General' ? x.shift_color : DUTY_COLORS[x.duty_type] }}
                              onClick={(ev) => { ev.stopPropagation(); setEditEntry(x); }}>
                              {x.duty_type === 'Weekly Off' ? 'Off' : `${x.shift_code || x.duty_type} ${x.start_time}–${x.end_time}`}
                              {x.room_name && <small>{x.room_name}{x.duty_type === 'OPD' ? ` · ${money(x.consultation_fee)}` : ''}</small>}
                            </button>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {assign && <AssignModal preset={assign} employees={employees} shifts={shifts} rooms={rooms} departments={departments}
        onClose={() => setAssign(null)} onSaved={() => { setAssign(null); load(); }} showAlert={showAlert} />}
      {editEntry && <EditDutyModal entry={editEntry} shifts={shifts} rooms={rooms} departments={departments}
        onClose={() => setEditEntry(null)} onSaved={() => { setEditEntry(null); load(); }} showAlert={showAlert} />}
    </div>
  );
}
