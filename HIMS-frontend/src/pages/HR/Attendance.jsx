import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, Trash2, Plus, LocateFixed } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { PageHead, Tabs, Modal, Field, Badge, Stat, Empty } from '../../components/hmis/ui';
import { get, post, put, del, isHrAdmin, isRosterPlanner, todayIST, fmtDate, weekdayShort, fullName, timeHM } from '../../utils/hmisApi';

const hm = (min) => (min ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : '—');
const thisPeriod = () => todayIST().slice(0, 7);
const calClass = (s) => ({ Present: 'Present', Absent: 'Absent', 'Half Day': 'Half', 'Half Leave': 'Half', Leave: 'Leave', 'Weekly Off': 'Off', Holiday: 'Off' }[s] || '');

const locate = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
    () => resolve(null),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
});

function MonthCalendar({ days }) {
  if (!days?.length) return null;
  const lead = (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return (
    <div className="hm-cal">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="dow">{d}</div>)}
      {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} className="day blank" />)}
      {days.map((d) => (
        <div key={d.date} className={`day ${calClass(d.status)}`} title={d.holiday || d.status}>
          <b>{Number(d.date.slice(8))}</b>
          <div>{d.status === 'Upcoming' ? '' : d.status}{d.leave_code ? ` (${d.leave_code})` : ''}</div>
          {d.first_in && <div className="hm-muted">{timeHM(d.first_in)}–{d.last_out ? timeHM(d.last_out) : '…'}</div>}
          {d.late_minutes > 0 && <div style={{ color: '#b45309' }}>Late {d.late_minutes}m</div>}
        </div>
      ))}
    </div>
  );
}

function MyAttendance({ showAlert }) {
  const [today, setToday] = useState(null);
  const [missing, setMissing] = useState(false);
  const [period, setPeriod] = useState(thisPeriod());
  const [month, setMonth] = useState(null);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  const load = useCallback(async () => {
    const r = await get('/api/attendance/me/today');
    if (r.status === 404) return setMissing(true);
    if (r.ok) setToday(r.data);
  }, []);
  const loadMonth = useCallback(async () => {
    const r = await get(`/api/attendance/me?period=${period}`);
    if (r.ok) setMonth(r.data);
  }, [period]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!missing) loadMonth(); }, [loadMonth, missing]);
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);

  const punch = async () => {
    setBusy(true);
    const loc = await locate();
    if (!loc && today?.geofence?.enforced) {
      setBusy(false);
      return showAlert('Location is needed to mark attendance here. Allow location access in your browser and try again.', 'warning');
    }
    const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    const r = await post('/api/attendance/punch', { ...(loc || {}), source: mobile ? 'Mobile' : 'Web' });
    setBusy(false);
    if (!r.ok) return showAlert(r.data.message || 'Could not mark attendance', 'error');
    showAlert(`Punched ${r.data.punch_type === 'IN' ? 'in' : 'out'} at ${timeHM(r.data.punched_at)}`, 'success');
    load(); loadMonth();
  };

  if (missing) return <div className="hm-note">Your login is not linked to an employee record, so you cannot mark attendance. HR can link it from Employee Management.</div>;
  if (!today) return <Empty>Loading…</Empty>;
  const s = month?.summary;
  const timeStr = clock.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  return (
    <div className="hm-split">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <div className="hm-stats">
          <Stat label="Present" value={s?.present_days ?? '—'} />
          <Stat label="Absent" value={s?.absent_days ?? '—'} tone={s?.absent_days ? 'bad' : ''} />
          <Stat label="Leave" value={s?.leave_days ?? '—'} />
          <Stat label="Late arrivals" value={s?.late_days ?? '—'} tone={s?.late_days ? 'warn' : ''} />
          <Stat label="Overtime" value={s ? `${s.ot_hours} h` : '—'} />
        </div>
        <div className="hm-card">
          <div className="hm-card-head">
            <h3>My month</h3>
            <input type="month" className="hm-input" style={{ width: 160 }} value={period} max={thisPeriod()} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
          </div>
          <div className="hm-card-body"><MonthCalendar days={month?.days} /></div>
        </div>
      </div>
      <div className="hm-card">
        <div className="hm-punch">
          <div className="hm-muted" style={{ fontSize: 13 }}>{fmtDate(todayIST(), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <div className="clock">{timeStr}</div>
          <button className={`hm-punch-btn ${today.next_action === 'IN' ? 'in' : 'out'}`} disabled={busy} onClick={punch}>
            {busy ? 'Locating…' : today.next_action === 'IN' ? 'Punch In' : 'Punch Out'}
          </button>
          {today.open_since && <div className="hm-muted">On duty since {timeHM(today.open_since)}</div>}
          <div className="hm-muted" style={{ fontSize: 12 }}>
            <MapPin size={12} style={{ verticalAlign: -2 }} /> {today.geofence.enforced ? `Must be within ${today.geofence.radius_m} m of ${today.geofence.facility}` : 'Location is recorded with each punch'}
          </div>
        </div>
        <div className="hm-card-body" style={{ borderTop: '1px solid var(--border-light)' }}>
          <strong style={{ fontSize: 13 }}>Today's duty</strong>
          {today.duties.length === 0 ? <div className="hm-muted" style={{ fontSize: 13 }}>No roster entry — default shift applies.</div>
            : today.duties.map((d, i) => <div key={i} style={{ fontSize: 13 }}>{d.duty_type} {d.duty_type !== 'Weekly Off' && `${d.start_time}–${d.end_time}`} {d.room_name && <span className="hm-muted">· {d.room_name}</span>}</div>)}
          <strong style={{ fontSize: 13, display: 'block', marginTop: 10 }}>Punches</strong>
          {today.punches.length === 0 ? <div className="hm-muted" style={{ fontSize: 13 }}>None yet.</div>
            : today.punches.map((p) => <div key={p.id} style={{ fontSize: 13 }}><Badge tone={p.punch_type === 'IN' ? 'green' : 'amber'}>{p.punch_type}</Badge> {timeHM(p.punched_at)} <span className="hm-muted">{p.source}{p.distance_m !== null && p.distance_m !== undefined ? ` · ${p.distance_m} m` : ''}</span></div>)}
        </div>
      </div>
    </div>
  );
}

function DailyRegister({ departments }) {
  const [date, setDate] = useState(todayIST());
  const [dept, setDept] = useState('');
  const [data, setData] = useState(null);
  useEffect(() => {
    get(`/api/attendance/register?date=${date}${dept ? `&department_id=${dept}` : ''}`).then((r) => setData(r.ok ? r.data : { rows: [], tally: {} }));
  }, [date, dept]);
  return (
    <div className="hm-card">
      <div className="hm-card-head">
        <div className="hm-toolbar">
          <input type="date" className="hm-input" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
          <select className="hm-select" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="hm-toolbar">{Object.entries(data?.tally || {}).map(([k, v]) => <Badge key={k}>{`${k}: ${v}`}</Badge>)}</div>
      </div>
      <div className="hm-table-wrap">
        <table className="hm-table">
          <thead><tr><th>Employee</th><th>Department</th><th>Duty</th><th>Status</th><th>In</th><th>Out</th><th className="num">Worked</th><th className="num">Late</th><th className="num">OT</th></tr></thead>
          <tbody>
            {!data && <tr><td colSpan={9}><Empty>Loading…</Empty></td></tr>}
            {data?.rows?.map((r) => (
              <tr key={r.id}>
                <td><strong>{fullName(r)}</strong><span className="sub">{r.employee_code} · {r.designation || r.staff_category}</span></td>
                <td>{r.department_name || '—'}</td>
                <td className="hm-mono" style={{ fontSize: 12 }}>{r.duties?.length ? r.duties.map((d) => (d.duty_type === 'Weekly Off' ? 'Off' : `${d.start_time}–${d.end_time}`)).join(', ') : <span className="hm-muted">default</span>}</td>
                <td><Badge>{r.status}</Badge>{r.leave_code && <span className="sub">{r.leave_code}</span>}{r.missing_out && <span className="sub" style={{ color: '#b45309' }}>No out punch</span>}</td>
                <td className="hm-mono">{timeHM(r.first_in)}</td>
                <td className="hm-mono">{r.open_in && !r.last_out ? <span className="hm-muted">on duty</span> : timeHM(r.last_out)}</td>
                <td className="num">{hm(r.worked_minutes)}</td>
                <td className="num">{r.late_minutes ? <span style={{ color: '#b45309' }}>{r.late_minutes}m</span> : '—'}</td>
                <td className="num">{hm(r.ot_minutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmployeeMonth({ employeeId, period, onClose, showAlert }) {
  const [data, setData] = useState(null);
  const [fix, setFix] = useState(null);
  const hr = isHrAdmin();
  const load = useCallback(() => get(`/api/attendance/monthly?period=${period}&employee_id=${employeeId}`).then((r) => setData(r.data)), [employeeId, period]);
  useEffect(() => { load(); }, [load]);

  const saveFix = async () => {
    const r = await post('/api/attendance/manual', { employee_id: employeeId, ...fix });
    if (!r.ok) return showAlert(r.data.message || 'Could not save', 'error');
    setFix(null); load();
  };
  const removePunch = async (p) => {
    if (!window.confirm(`Delete the ${p.punch_type} punch at ${timeHM(p.punched_at)}?`)) return;
    const r = await del(`/api/attendance/punch/${p.id}`);
    if (!r.ok) return showAlert(r.data.message || 'Could not delete', 'error');
    load();
  };

  const punchesOn = (d) => (data?.punches || []).filter((p) => p.attendance_date === d);
  return (
    <Modal wide title={data?.employee ? `${fullName(data.employee)} · ${period}` : 'Attendance'} subtitle={data?.employee?.designation} onClose={onClose}>
      {data?.locked && <div className="hm-note">Payroll for this month is finalised; attendance is read-only.</div>}
      {data?.summary && (
        <div className="hm-stats">
          <Stat label="Paid days" value={data.summary.paid_days} />
          <Stat label="LOP days" value={data.summary.lop_days} tone={data.summary.lop_days ? 'bad' : ''} />
          <Stat label="Present" value={data.summary.present_days} />
          <Stat label="Late" value={data.summary.late_days} />
          <Stat label="OT" value={`${data.summary.ot_hours} h`} />
        </div>
      )}
      <div className="hm-table-wrap">
        <table className="hm-table">
          <thead><tr><th>Date</th><th>Status</th><th>Punches</th><th className="num">Worked</th><th className="num">Late</th>{hr && !data?.locked && <th />}</tr></thead>
          <tbody>
            {(data?.days || []).filter((d) => d.status !== 'Upcoming').map((d) => (
              <tr key={d.date}>
                <td>{weekdayShort(d.date)} {fmtDate(d.date, { day: '2-digit', month: 'short' })}</td>
                <td><Badge>{d.status}</Badge>{d.leave_code && <span className="sub">{d.leave_code}</span>}{d.holiday && <span className="sub">{d.holiday}</span>}</td>
                <td style={{ fontSize: 12 }}>
                  {punchesOn(d.date).map((p) => (
                    <span key={p.id} style={{ marginRight: 8, whiteSpace: 'nowrap' }}>
                      <Badge tone={p.punch_type === 'IN' ? 'green' : 'amber'}>{p.punch_type}</Badge> {timeHM(p.punched_at)}{p.source === 'Manual' && <span className="hm-muted" title={p.note}> (manual)</span>}
                      {hr && !data.locked && <button className="hm-x" title="Delete punch" onClick={() => removePunch(p)}><Trash2 size={12} /></button>}
                    </span>
                  ))}
                </td>
                <td className="num">{hm(d.worked_minutes)}</td>
                <td className="num">{d.late_minutes ? `${d.late_minutes}m` : '—'}</td>
                {hr && !data?.locked && <td><button className="hm-btn sm" onClick={() => setFix({ date: d.date, in_time: '', out_time: '', note: '' })}><Plus size={12} /> Correct</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {fix && (
        <Modal title={`Correct attendance · ${fmtDate(fix.date)}`} onClose={() => setFix(null)}
          footer={<><button className="hm-btn" onClick={() => setFix(null)}>Cancel</button><button className="hm-btn primary" onClick={saveFix}>Add punches</button></>}>
          <div className="hm-form">
            <Field label="In time"><input type="time" className="hm-input" value={fix.in_time} onChange={(e) => setFix({ ...fix, in_time: e.target.value })} /></Field>
            <Field label="Out time" hint="Earlier than in time = next morning"><input type="time" className="hm-input" value={fix.out_time} onChange={(e) => setFix({ ...fix, out_time: e.target.value })} /></Field>
            <Field label="Reason *" className="full"><input className="hm-input" value={fix.note} placeholder="e.g. Forgot to punch out; verified with ward register" onChange={(e) => setFix({ ...fix, note: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function MonthlySummary({ showAlert }) {
  const [period, setPeriod] = useState(thisPeriod());
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  useEffect(() => { get(`/api/attendance/monthly?period=${period}`).then((r) => setRows(r.data.rows || [])); }, [period, open]);
  const shown = useMemo(() => (rows || []).filter((r) => !q || `${fullName(r)} ${r.employee_code}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  return (
    <div className="hm-card">
      <div className="hm-card-head">
        <div className="hm-toolbar">
          <input type="month" className="hm-input" value={period} max={thisPeriod()} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
          <input className="hm-input" placeholder="Find employee" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="hm-muted" style={{ fontSize: 12.5 }}>Click a row for day-by-day detail and corrections</span>
      </div>
      <div className="hm-table-wrap">
        <table className="hm-table">
          <thead><tr><th>Employee</th><th className="num">Paid days</th><th className="num">LOP</th><th className="num">Present</th><th className="num">Absent</th><th className="num">Half days</th><th className="num">Leave</th><th className="num">Late</th><th className="num">Missed out</th><th className="num">OT hrs</th></tr></thead>
          <tbody>
            {!rows && <tr><td colSpan={10}><Empty>Loading…</Empty></td></tr>}
            {shown.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
                <td><strong>{fullName(r)}</strong><span className="sub">{r.employee_code} · {r.department_name || r.staff_category}</span></td>
                <td className="num">{r.paid_days}</td>
                <td className="num" style={{ color: r.lop_days ? '#b91c1c' : undefined }}>{r.lop_days}</td>
                <td className="num">{r.present_days}</td>
                <td className="num">{r.absent_days}</td>
                <td className="num">{r.half_days}</td>
                <td className="num">{r.leave_days}</td>
                <td className="num">{r.late_days}</td>
                <td className="num" style={{ color: r.missing_out ? '#b45309' : undefined }}>{r.missing_out}</td>
                <td className="num">{r.ot_hours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <EmployeeMonth employeeId={open} period={period} onClose={() => setOpen(null)} showAlert={showAlert} />}
    </div>
  );
}

const SETTING_FIELDS = [
  ['Attendance', [
    ['weekly_off', 'Weekly off', 'text', 'e.g. Sun or Sat,Sun'],
    ['late_grace_minutes', 'Late grace (minutes)', 'number'],
    ['half_day_ratio', 'Half day below (share of shift)', 'number', '0.5 = worked less than half the shift'],
  ]],
  ['Provident Fund', [
    ['pf_employee_pct', 'Employee %', 'number'], ['pf_employer_pct', 'Employer %', 'number'], ['pf_wage_ceiling', 'PF wage ceiling (₹)', 'number'],
  ]],
  ['ESI', [
    ['esi_employee_pct', 'Employee %', 'number'], ['esi_employer_pct', 'Employer %', 'number'], ['esi_gross_ceiling', 'Eligible up to gross (₹)', 'number'],
  ]],
  ['Professional Tax', [
    ['pt_threshold', 'Applies from gross (₹)', 'number', 'Your state\'s slab; leave amounts at 0 if PT does not apply'], ['pt_amount', 'Monthly amount (₹)', 'number'], ['pt_february_amount', 'February amount (₹)', 'number'],
  ]],
  ['Pay calculation', [
    ['ot_multiplier', 'Overtime multiplier', 'number', 'Default OT rate = basic ÷ 208 × this'],
  ]],
];

function SettingsTab({ showAlert }) {
  const [s, setS] = useState(null);
  const [branch, setBranch] = useState(null);
  const load = useCallback(() => get('/api/attendance/settings').then((r) => { setS(r.data.settings); setBranch(r.data.branch); }), []);
  useEffect(() => { load(); }, [load]);
  if (!s) return <Empty>Loading…</Empty>;

  const save = async () => {
    const r = await put('/api/attendance/settings', { ...s, latitude: branch?.latitude ?? null, longitude: branch?.longitude ?? null });
    if (!r.ok) return showAlert(r.data.message || 'Could not save', 'error');
    showAlert('Settings saved', 'success');
    load();
  };
  const here = async () => {
    const loc = await locate();
    if (!loc) return showAlert('Could not read this device\'s location', 'error');
    setBranch((b) => ({ ...b, latitude: loc.latitude.toFixed(7), longitude: loc.longitude.toFixed(7) }));
    showAlert(`Location captured (±${loc.accuracy} m). Save to apply.`, 'info');
  };

  return (
    <div className="hm-card">
      <div className="hm-card-head"><h3>Attendance & payroll rules{branch ? ` · ${branch.branch_name}` : ' · network defaults'}</h3><button className="hm-btn primary" onClick={save}>Save</button></div>
      <div className="hm-card-body hm-form">
        {branch && <>
          <div className="hm-section-title">Clock-in geo-fence</div>
          <Field label="Facility latitude"><input className="hm-input" value={branch.latitude ?? ''} onChange={(e) => setBranch({ ...branch, latitude: e.target.value })} /></Field>
          <Field label="Facility longitude"><input className="hm-input" value={branch.longitude ?? ''} onChange={(e) => setBranch({ ...branch, longitude: e.target.value })} /></Field>
          <Field label="Allowed radius (m)" hint="Blank = allow clock-in from anywhere">
            <input type="number" min="20" className="hm-input" value={s.geofence_radius_m ?? ''} onChange={(e) => setS({ ...s, geofence_radius_m: e.target.value === '' ? null : e.target.value })} />
          </Field>
          <Field label=" "><button className="hm-btn" onClick={here}><LocateFixed size={15} /> Use this device's location</button></Field>
        </>}
        {SETTING_FIELDS.map(([title, fields]) => [
          <div key={title} className="hm-section-title">{title}</div>,
          ...fields.map(([k, label, type, hint]) => (
            <Field key={k} label={label} hint={hint}>
              <input type={type} step="any" className="hm-input" value={s[k] ?? ''} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
            </Field>
          )),
        ])}
        <Field label="Loss-of-pay basis">
          <select className="hm-select" value={s.lop_basis} onChange={(e) => setS({ ...s, lop_basis: e.target.value })}>
            <option value="Calendar">Calendar days of the month</option>
            <option value="Fixed30">Fixed 30-day month</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

export default function Attendance() {
  const { alert, showAlert, hideAlert } = useAlert();
  const team = isRosterPlanner();
  const hr = isHrAdmin();
  const [tab, setTab] = useState('mine');
  const [departments, setDepartments] = useState([]);
  useEffect(() => { if (team) get('/api/departments?is_active=true').then((r) => setDepartments(r.data.departments || [])); }, [team]);
  return (
    <div className="hm-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={4500} />}
      <PageHead title="Attendance" subtitle="Clock in and out, daily register and monthly summary" />
      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'mine', label: 'My attendance' },
        team && { id: 'daily', label: 'Daily register' },
        team && { id: 'monthly', label: 'Monthly summary' },
        hr && { id: 'settings', label: 'Rules' },
      ]} />
      {tab === 'mine' && <MyAttendance showAlert={showAlert} />}
      {tab === 'daily' && <DailyRegister departments={departments} />}
      {tab === 'monthly' && <MonthlySummary showAlert={showAlert} />}
      {tab === 'settings' && <SettingsTab showAlert={showAlert} />}
    </div>
  );
}

