import { useCallback, useEffect, useState } from 'react';
import { Plus, Check, X } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { PageHead, Tabs, Modal, Field, Badge, Stat, Empty } from '../../components/hmis/ui';
import { get, post, put, isHrAdmin, todayIST, fmtDate, fullName } from '../../utils/hmisApi';

const thisYear = () => Number(todayIST().slice(0, 4));
const dateSpan = (r) => (r.from_date === r.to_date ? fmtDate(r.from_date) : `${fmtDate(r.from_date)} – ${fmtDate(r.to_date)}`);

function ApplyModal({ employeeId, employees, onClose, onSaved, showAlert }) {
  const [types, setTypes] = useState([]);
  const [balances, setBalances] = useState([]);
  const [f, setF] = useState({ employee_id: employeeId || '', leave_type_id: '', from_date: todayIST(), to_date: todayIST(), half_day: 'None', reason: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { get('/api/leave/types').then((r) => setTypes(r.data.leave_types || [])); }, []);
  useEffect(() => {
    const who = f.employee_id ? `employee_id=${f.employee_id}&` : '';
    get(`/api/leave/balances?${who}year=${f.from_date.slice(0, 4)}`).then((r) => setBalances(r.data.balances || []));
  }, [f.employee_id, f.from_date]);

  const bal = balances.find((b) => String(b.leave_type_id) === String(f.leave_type_id));
  const available = balances.map((b) => b.leave_type_id);
  const submit = async () => {
    if (!f.leave_type_id) return showAlert('Choose the leave type', 'warning');
    if (!f.reason.trim()) return showAlert('Give a reason', 'warning');
    setSaving(true);
    const body = { ...f, to_date: f.half_day !== 'None' ? f.from_date : f.to_date };
    if (!body.employee_id) delete body.employee_id;
    const r = await post('/api/leave/requests', body);
    setSaving(false);
    if (!r.ok) return showAlert(r.data.message || 'Could not apply', 'error');
    showAlert(`Leave applied for ${r.data.days} day${r.data.days === 1 ? '' : 's'}`, 'success');
    onSaved();
  };

  return (
    <Modal title={employees ? 'Apply leave for an employee' : 'Apply for leave'} onClose={onClose}
      footer={<><button className="hm-btn" onClick={onClose}>Cancel</button><button className="hm-btn primary" disabled={saving} onClick={submit}>Apply</button></>}>
      <div className="hm-form">
        {employees && (
          <Field label="Employee" className="full">
            <select className="hm-select" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}>
              <option value="">Myself</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)} · {e.employee_code}</option>)}
            </select>
          </Field>
        )}
        <Field label="Leave type" className="full" hint={bal ? (bal.unlimited ? 'Unpaid — deducted from salary' : `${bal.available} day(s) available`) : ''}>
          <select className="hm-select" value={f.leave_type_id} onChange={(e) => setF({ ...f, leave_type_id: e.target.value })}>
            <option value="">Select…</option>
            {types.filter((t) => available.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
          </select>
        </Field>
        <Field label="Duration">
          <select className="hm-select" value={f.half_day} onChange={(e) => setF({ ...f, half_day: e.target.value })}>
            <option value="None">Full day(s)</option><option>First Half</option><option>Second Half</option>
          </select>
        </Field>
        <Field label="From"><input type="date" className="hm-input" value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value, to_date: f.to_date < e.target.value ? e.target.value : f.to_date })} /></Field>
        {f.half_day === 'None' && <Field label="To"><input type="date" className="hm-input" value={f.to_date} min={f.from_date} onChange={(e) => setF({ ...f, to_date: e.target.value })} /></Field>}
        <Field label="Reason" className="full"><textarea className="hm-textarea" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
      <div className="hm-note">Weekly offs and holidays inside the range are not counted, unless you are rostered to work that day.</div>
    </Modal>
  );
}

function RequestsTable({ rows, mode, myEmployeeId, onAction }) {
  return (
    <div className="hm-table-wrap">
      <table className="hm-table">
        <thead>
          <tr>{mode !== 'mine' && <th>Employee</th>}<th>Type</th><th>Dates</th><th className="num">Days</th><th>Reason</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7}><Empty>Nothing here.</Empty></td></tr>}
          {rows.map((r) => (
            <tr key={r.id}>
              {mode !== 'mine' && <td><strong>{fullName(r)}</strong><span className="sub">{r.designation || ''}{r.department_name ? ` · ${r.department_name}` : ''}</span></td>}
              <td><Badge tone={r.is_paid ? 'violet' : 'red'}>{r.leave_code}</Badge></td>
              <td>{dateSpan(r)}{r.half_day !== 'None' && <span className="sub">{r.half_day}</span>}</td>
              <td className="num">{Number(r.days)}</td>
              <td style={{ maxWidth: 260 }}>{r.reason}{r.decision_note && <span className="sub">{r.status}: {r.decision_note}{r.decided_by_name ? ` — ${r.decided_by_name}` : ''}</span>}</td>
              <td><Badge>{r.status}</Badge></td>
              <td>
                <div className="hm-actions">
                  {r.status === 'Pending' && mode !== 'mine' && r.employee_id !== myEmployeeId && <>
                    <button className="hm-btn sm success" onClick={() => onAction('approve', r)}><Check size={13} /> Approve</button>
                    <button className="hm-btn sm danger" onClick={() => onAction('reject', r)}><X size={13} /> Reject</button>
                  </>}
                  {['Pending', 'Approved'].includes(r.status) && (mode === 'mine' || (mode === 'all' && isHrAdmin())) && (
                    <button className="hm-btn sm" onClick={() => onAction('cancel', r)}>Cancel</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SetupTab({ showAlert }) {
  const [types, setTypes] = useState([]);
  const [edit, setEdit] = useState(null);
  const [year, setYear] = useState(thisYear());
  const [prorate, setProrate] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [adj, setAdj] = useState({ employee_id: '', leave_type_id: '', delta: 1 });
  const [balances, setBalances] = useState(null);

  const load = useCallback(() => get('/api/leave/types?all=1').then((r) => setTypes(r.data.leave_types || [])), []);
  useEffect(() => { load(); get('/api/employees/lookup').then((r) => setEmployees(r.data.employees || [])); }, [load]);
  useEffect(() => {
    if (!adj.employee_id) return setBalances(null);
    get(`/api/leave/balances?employee_id=${adj.employee_id}&year=${year}`).then((r) => setBalances(r.data.balances || []));
  }, [adj.employee_id, year]);

  const saveType = async () => {
    const r = edit.id ? await put(`/api/leave/types/${edit.id}`, edit) : await post('/api/leave/types', edit);
    if (!r.ok) return showAlert(r.data.message || 'Could not save', 'error');
    setEdit(null); load();
  };
  const allocate = async () => {
    if (!window.confirm(`Set ${year} leave quotas for every active employee${prorate ? ' (pro-rated for joiners)' : ''}? Existing allotments for ${year} are recalculated; usage and manual adjustments are kept.`)) return;
    const r = await post('/api/leave/allocate', { year, prorate });
    if (!r.ok) return showAlert(r.data.message || 'Could not allocate', 'error');
    showAlert(`Quotas set for ${r.data.employees} employees`, 'success');
  };
  const adjust = async () => {
    const r = await post('/api/leave/balances/adjust', { ...adj, year });
    if (!r.ok) return showAlert(r.data.message || 'Could not adjust', 'error');
    showAlert('Balance adjusted', 'success');
    setAdj({ ...adj });
    get(`/api/leave/balances?employee_id=${adj.employee_id}&year=${year}`).then((x) => setBalances(x.data.balances || []));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="hm-card">
        <div className="hm-card-head"><h3>Yearly allocation</h3></div>
        <div className="hm-card-body hm-toolbar">
          <input type="number" className="hm-input" style={{ width: 100 }} value={year} onChange={(e) => setYear(Number(e.target.value))} />
          <label className="hm-check"><input type="checkbox" checked={prorate} onChange={(e) => setProrate(e.target.checked)} /> Pro-rate for staff who joined during the year</label>
          <button className="hm-btn primary" onClick={allocate}>Allocate {year} quotas</button>
          <span className="hm-muted" style={{ fontSize: 12.5 }}>Unused leave of carry-forward types moves into {year}, up to each type's limit.</span>
        </div>
      </div>

      <div className="hm-card">
        <div className="hm-card-head"><h3>Leave types</h3><button className="hm-btn sm primary" onClick={() => setEdit({ name: '', code: '', annual_quota: 0, is_paid: true, carry_forward: false, max_carry_forward: 0, requires_document: false, applicable_gender: 'Any', is_active: true })}><Plus size={14} /> New type</button></div>
        <div className="hm-table-wrap">
          <table className="hm-table">
            <thead><tr><th>Type</th><th className="num">Per year</th><th>Paid</th><th>Carry forward</th><th>For</th><th>Status</th><th /></tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong> <span className="hm-muted">({t.code})</span></td>
                  <td className="num">{Number(t.annual_quota) || (t.is_paid ? 'Credited' : 'Unlimited')}</td>
                  <td>{t.is_paid ? 'Paid' : <Badge tone="red">Unpaid</Badge>}</td>
                  <td>{t.carry_forward ? `Up to ${Number(t.max_carry_forward)}` : '—'}</td>
                  <td>{t.applicable_gender}</td>
                  <td>{t.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  <td><div className="hm-actions"><button className="hm-btn sm" onClick={() => setEdit({ ...t, is_paid: !!t.is_paid, carry_forward: !!t.carry_forward, requires_document: !!t.requires_document, is_active: !!t.is_active })}>Edit</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="hm-card">
        <div className="hm-card-head"><h3>Balances & adjustments</h3></div>
        <div className="hm-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="hm-toolbar">
            <select className="hm-select" value={adj.employee_id} onChange={(e) => setAdj({ ...adj, employee_id: e.target.value })}>
              <option value="">Choose an employee…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)} · {e.employee_code}</option>)}
            </select>
            {adj.employee_id && <>
              <select className="hm-select" value={adj.leave_type_id} onChange={(e) => setAdj({ ...adj, leave_type_id: e.target.value })}>
                <option value="">Leave type…</option>{(balances || []).filter((b) => b.is_paid).map((b) => <option key={b.leave_type_id} value={b.leave_type_id}>{b.code}</option>)}
              </select>
              <input type="number" step="0.5" className="hm-input" style={{ width: 90 }} value={adj.delta} onChange={(e) => setAdj({ ...adj, delta: e.target.value })} />
              <button className="hm-btn" disabled={!adj.leave_type_id} onClick={adjust}>Credit / debit</button>
              <span className="hm-muted" style={{ fontSize: 12.5 }}>e.g. +1 CO for working a holiday, −1 to correct</span>
            </>}
          </div>
          {balances && (
            <table className="hm-table">
              <thead><tr><th>Type</th><th className="num">Allotted</th><th className="num">Carried</th><th className="num">Adjusted</th><th className="num">Used</th><th className="num">Pending</th><th className="num">Available</th></tr></thead>
              <tbody>{balances.map((b) => (
                <tr key={b.leave_type_id}><td>{b.name}</td><td className="num">{Number(b.allotted)}</td><td className="num">{Number(b.carried)}</td><td className="num">{Number(b.adjusted)}</td><td className="num">{b.used}</td><td className="num">{b.pending}</td><td className="num"><strong>{b.unlimited ? '∞' : b.available}</strong></td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : 'New leave type'} onClose={() => setEdit(null)}
          footer={<><button className="hm-btn" onClick={() => setEdit(null)}>Cancel</button><button className="hm-btn primary" onClick={saveType}>Save</button></>}>
          <div className="hm-form">
            <Field label="Name"><input className="hm-input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Code"><input className="hm-input" maxLength={10} value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
            <Field label="Days per year" hint="0 for leave credited by hand (e.g. comp-off)"><input type="number" min="0" step="0.5" className="hm-input" value={edit.annual_quota} onChange={(e) => setEdit({ ...edit, annual_quota: e.target.value })} /></Field>
            <Field label="Applies to"><select className="hm-select" value={edit.applicable_gender} onChange={(e) => setEdit({ ...edit, applicable_gender: e.target.value })}>{['Any', 'Female', 'Male'].map((g) => <option key={g}>{g}</option>)}</select></Field>
            <label className="hm-check"><input type="checkbox" checked={edit.is_paid} onChange={(e) => setEdit({ ...edit, is_paid: e.target.checked })} /> Paid leave</label>
            <label className="hm-check"><input type="checkbox" checked={edit.requires_document} onChange={(e) => setEdit({ ...edit, requires_document: e.target.checked })} /> Needs a supporting document</label>
            <label className="hm-check"><input type="checkbox" checked={edit.carry_forward} onChange={(e) => setEdit({ ...edit, carry_forward: e.target.checked })} /> Carry forward unused days</label>
            {edit.carry_forward && <Field label="Carry at most"><input type="number" min="0" className="hm-input" value={edit.max_carry_forward} onChange={(e) => setEdit({ ...edit, max_carry_forward: e.target.value })} /></Field>}
            <label className="hm-check"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> Active</label>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function LeaveManagement() {
  const { alert, showAlert, hideAlert } = useAlert();
  const hr = isHrAdmin();
  const [tab, setTab] = useState('mine');
  const [mine, setMine] = useState([]);
  const [team, setTeam] = useState([]);
  const [myEmployeeId, setMyEmployeeId] = useState(null);
  const [balances, setBalances] = useState([]);
  const [noRecord, setNoRecord] = useState(false);
  const [apply, setApply] = useState(null);
  const [employees, setEmployees] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [booked, setBooked] = useState(null);

  const load = useCallback(async () => {
    const [m, t, b] = await Promise.all([
      get('/api/leave/requests?mine=1'),
      get(`/api/leave/requests?status=${statusFilter}`),
      get(`/api/leave/balances?year=${thisYear()}`),
    ]);
    setMine(m.data.requests || []);
    setTeam(t.data.requests || []);
    setMyEmployeeId(t.data.my_employee_id || m.data.my_employee_id || null);
    setNoRecord(b.status === 404);
    setBalances(b.data.balances || []);
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (hr) get('/api/employees/lookup').then((r) => setEmployees(r.data.employees || [])); }, [hr]);

  const pending = team.filter((r) => r.status === 'Pending' && r.employee_id !== myEmployeeId);

  const onAction = async (action, r, extra = {}) => {
    let res;
    if (action === 'approve') res = await post(`/api/leave/requests/${r.id}/approve`, extra);
    if (action === 'reject') {
      const note = window.prompt(`Reason for rejecting ${fullName(r)}'s leave`);
      if (!note) return;
      res = await post(`/api/leave/requests/${r.id}/reject`, { note });
    }
    if (action === 'cancel') {
      if (!window.confirm('Cancel this leave request?')) return;
      res = await post(`/api/leave/requests/${r.id}/cancel`, {});
    }
    if (res.status === 409 && res.data.booked) return setBooked({ request: r, booked: res.data.booked });
    if (!res.ok) return showAlert(res.data.message || 'Could not update', 'error');
    const cancelled = res.data.cancelled_appointments?.length || 0;
    showAlert(action === 'approve'
      ? `Approved${res.data.released_duties ? `; ${res.data.released_duties} duties released` : ''}${cancelled ? `; ${cancelled} appointments cancelled — inform the patients` : ''}`
      : action === 'reject' ? 'Rejected' : 'Cancelled', cancelled ? 'warning' : 'success');
    setBooked(null);
    load();
  };

  return (
    <div className="hm-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={5000} />}
      <PageHead title="Leave" subtitle="Balances, applications and approvals">
        {hr && <button className="hm-btn" onClick={() => setApply({ forOthers: true })}>Apply for an employee</button>}
        {!noRecord && <button className="hm-btn primary" onClick={() => setApply({})}><Plus size={16} /> Apply for leave</button>}
      </PageHead>

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'mine', label: 'My leave' },
        { id: 'approvals', label: 'Approvals', count: pending.length },
        { id: 'all', label: hr ? 'All requests' : 'Team requests' },
        hr && { id: 'setup', label: 'Setup' },
      ]} />

      {tab === 'mine' && (
        noRecord ? <div className="hm-note">Your login is not linked to an employee record, so there is no leave to show. HR can link it from Employee Management.</div> : <>
          <div className="hm-stats">
            {balances.filter((b) => !b.unlimited).map((b) => (
              <Stat key={b.leave_type_id} label={b.name} value={b.available} note={`${b.used} used · ${b.pending} pending of ${b.total}`} />
            ))}
          </div>
          <div className="hm-card"><div className="hm-card-head"><h3>My requests</h3></div><RequestsTable rows={mine} mode="mine" onAction={onAction} /></div>
        </>
      )}
      {tab === 'approvals' && <div className="hm-card"><div className="hm-card-head"><h3>Waiting for a decision</h3></div><RequestsTable rows={pending} mode="approvals" myEmployeeId={myEmployeeId} onAction={onAction} /></div>}
      {tab === 'all' && (
        <div className="hm-card">
          <div className="hm-card-head">
            <h3>{hr ? 'All requests' : 'My team'}</h3>
            <select className="hm-select" style={{ width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>{['Pending', 'Approved', 'Rejected', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <RequestsTable rows={team} mode="all" myEmployeeId={myEmployeeId} onAction={onAction} />
        </div>
      )}
      {tab === 'setup' && hr && <SetupTab showAlert={showAlert} />}

      {apply && <ApplyModal employees={apply.forOthers ? employees : null} onClose={() => setApply(null)} onSaved={() => { setApply(null); load(); }} showAlert={showAlert} />}
      {booked && (
        <Modal title="Patients are booked" subtitle={`${fullName(booked.request)} has OP sessions with appointments during this leave`} onClose={() => setBooked(null)}
          footer={<>
            <button className="hm-btn" onClick={() => setBooked(null)}>Back</button>
            <button className="hm-btn danger" onClick={() => onAction('approve', booked.request, { release_duties: true })}>Approve and cancel these appointments</button>
          </>}>
          {booked.booked.map((b) => (
            <div key={b.roster_entry_id}>
              <strong>{fmtDate(b.duty_date)}</strong>
              <ul style={{ margin: '4px 0 0 18px', fontSize: 13 }}>{b.appointments.map((a) => <li key={a.id}>{a.appt_time} — {a.patient_name || a.reg_no} {a.telephone ? `(${a.telephone})` : ''}</li>)}</ul>
            </div>
          ))}
          <div className="hm-note warn">Better: reschedule these patients to another doctor on the OP Appointments page first, then approve.</div>
        </Modal>
      )}
    </div>
  );
}
