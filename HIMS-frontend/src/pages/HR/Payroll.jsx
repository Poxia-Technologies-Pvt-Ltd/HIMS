import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileDown, Play, Lock, Unlock, Banknote, Trash2, RefreshCw } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { PageHead, Tabs, Modal, Field, Badge, Stat, Empty } from '../../components/hmis/ui';
import { get, post, put, del, openFile, isHrAdmin, todayIST, fmtDate, fullName, money } from '../../utils/hmisApi';

const COMPONENTS = [['basic', 'Basic'], ['hra', 'HRA'], ['conveyance', 'Conveyance'], ['medical', 'Medical'], ['special_allowance', 'Special allowance'], ['other_allowance', 'Other allowance']];
const lastMonth = () => {
  const [y, m] = todayIST().split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
const monthLabel = (p) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const pdf = (id, showAlert) => openFile(`/api/payroll/payslips/${id}/pdf`).catch((e) => showAlert(e.message, 'error'));

function StructureModal({ employee, onClose, onSaved, showAlert }) {
  const [history, setHistory] = useState([]);
  const [f, setF] = useState({
    effective_from: `${todayIST().slice(0, 7)}-01`, basic: '', hra: '', conveyance: '', medical: '', special_allowance: '', other_allowance: '',
    pf_applicable: true, pf_on_full_basic: false, esi_applicable: true, pt_applicable: true, monthly_tds: 0, ot_rate_per_hour: '', attendance_based: true, notes: '',
  });
  useEffect(() => {
    get(`/api/payroll/salary/${employee.employee_id}`).then((r) => {
      const list = r.data.structures || [];
      setHistory(list);
      if (list[0]) {
        const s = list[0];
        setF((p) => ({ ...p, ...Object.fromEntries(COMPONENTS.map(([k]) => [k, Number(s[k])])), pf_applicable: !!s.pf_applicable, pf_on_full_basic: !!s.pf_on_full_basic,
          esi_applicable: !!s.esi_applicable, pt_applicable: !!s.pt_applicable, monthly_tds: Number(s.monthly_tds), ot_rate_per_hour: s.ot_rate_per_hour ?? '',
          attendance_based: !!s.attendance_based }));
      }
    });
  }, [employee.employee_id]);
  const gross = COMPONENTS.reduce((n, [k]) => n + (Number(f[k]) || 0), 0);
  const save = async () => {
    const r = await post('/api/payroll/salary', { ...f, employee_id: employee.employee_id });
    if (!r.ok) return showAlert(r.data.message || 'Could not save', 'error');
    showAlert(`Salary saved: ${money(r.data.gross)} a month from ${fmtDate(f.effective_from)}`, 'success');
    onSaved();
  };
  const chk = (k, label) => <label className="hm-check"><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {label}</label>;
  return (
    <Modal wide title={`Salary · ${fullName(employee)}`} subtitle={`${employee.employee_code} · ${employee.designation || ''}`} onClose={onClose}
      footer={<><span style={{ marginRight: 'auto', fontWeight: 700 }}>Monthly gross {money(gross)} · CTC {money(gross * 12)} a year</span><button className="hm-btn" onClick={onClose}>Cancel</button><button className="hm-btn primary" onClick={save}>Save structure</button></>}>
      <div className="hm-form">
        <Field label="Effective from" hint="A change starts a new structure; earlier months keep the old one">
          <input type="date" className="hm-input" value={f.effective_from} onChange={(e) => setF({ ...f, effective_from: e.target.value })} />
        </Field>
        <div className="hm-field" style={{ justifyContent: 'flex-end' }}>
          {chk('attendance_based', 'Pay by attendance')}
          <small className="hm-muted">{f.attendance_based ? 'Absent days are loss of pay' : 'Fixed monthly pay — only unpaid leave is deducted'}</small>
        </div>
        <div className="hm-section-title">Monthly earnings (₹)</div>
        {COMPONENTS.map(([k, label]) => (
          <Field key={k} label={label}><input type="number" min="0" className="hm-input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
        ))}
        <div className="hm-section-title">Deductions</div>
        {chk('pf_applicable', 'PF applicable')}
        {f.pf_applicable && chk('pf_on_full_basic', 'PF on full basic (no ₹15,000 cap)')}
        {chk('esi_applicable', 'ESI applicable (only while gross is within the ESI limit)')}
        {chk('pt_applicable', 'Professional tax applicable')}
        <Field label="Monthly TDS (₹)"><input type="number" min="0" className="hm-input" value={f.monthly_tds} onChange={(e) => setF({ ...f, monthly_tds: e.target.value })} /></Field>
        <Field label="Overtime rate per hour (₹)" hint="Blank = basic ÷ 208 × OT multiplier"><input type="number" min="0" className="hm-input" value={f.ot_rate_per_hour} onChange={(e) => setF({ ...f, ot_rate_per_hour: e.target.value })} /></Field>
        <Field label="Note" className="full"><input className="hm-input" value={f.notes} placeholder="e.g. Annual increment 2026" onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {history.length > 0 && (
        <div className="hm-table-wrap">
          <table className="hm-table">
            <thead><tr><th>From</th><th className="num">Basic</th><th className="num">Gross</th><th className="num">TDS</th><th>Note</th></tr></thead>
            <tbody>{history.map((h) => <tr key={h.id}><td>{fmtDate(h.effective_from)}</td><td className="num">{money(h.basic)}</td><td className="num">{money(h.gross)}</td><td className="num">{money(h.monthly_tds)}</td><td>{h.notes || '—'}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function SalaryTab({ showAlert }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const load = useCallback(() => get('/api/payroll/salary').then((r) => setRows(r.data.employees || [])), []);
  useEffect(() => { load(); }, [load]);
  const shown = useMemo(() => (rows || []).filter((r) => !q || `${fullName(r)} ${r.employee_code}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const missing = (rows || []).filter((r) => !r.structure_id).length;
  return (
    <div className="hm-card">
      <div className="hm-card-head">
        <input className="hm-input" style={{ maxWidth: 280 }} placeholder="Find employee" value={q} onChange={(e) => setQ(e.target.value)} />
        {missing > 0 && <Badge tone="amber">{missing} without a salary structure — left out of payroll</Badge>}
      </div>
      <div className="hm-table-wrap">
        <table className="hm-table">
          <thead><tr><th>Employee</th><th>Type</th><th>Since</th><th className="num">Basic</th><th className="num">Gross / month</th><th>PF · ESI · PT</th><th>Bank</th><th /></tr></thead>
          <tbody>
            {!rows && <tr><td colSpan={8}><Empty>Loading…</Empty></td></tr>}
            {shown.map((r) => (
              <tr key={r.employee_id} className="clickable" onClick={() => setOpen(r)}>
                <td><strong>{fullName(r)}</strong><span className="sub">{r.employee_code} · {r.designation || r.department_name || ''}</span></td>
                <td>{r.employment_type}</td>
                <td>{r.effective_from ? fmtDate(r.effective_from) : '—'}</td>
                <td className="num">{r.structure_id ? money(r.basic) : '—'}</td>
                <td className="num"><strong>{r.structure_id ? money(r.gross) : <Badge tone="amber">Not set</Badge>}</strong></td>
                <td style={{ fontSize: 12 }}>{r.structure_id ? [r.pf_applicable && 'PF', r.esi_applicable && 'ESI', r.pt_applicable && 'PT'].filter(Boolean).join(' · ') || 'None' : '—'}{r.structure_id && !r.attendance_based && <> <Badge tone="teal">Fixed pay</Badge></>}</td>
                <td>{r.has_bank ? <Badge tone="green">Set</Badge> : <Badge tone="amber">Missing</Badge>}</td>
                <td><button className="hm-btn sm">Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <StructureModal employee={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} showAlert={showAlert} />}
    </div>
  );
}

function PayslipEdit({ slip, onClose, onSaved, showAlert }) {
  const [f, setF] = useState({ arrears: Number(slip.arrears), other_deductions: Number(slip.other_deductions), tds: Number(slip.tds), ot_hours: Number(slip.ot_hours), remarks: slip.remarks || '' });
  const save = async () => {
    const body = { arrears: f.arrears, other_deductions: f.other_deductions, remarks: f.remarks };
    if (Number(f.tds) !== Number(slip.tds)) body.tds = f.tds;
    if (Number(f.ot_hours) !== Number(slip.ot_hours)) body.ot_hours = f.ot_hours;
    const r = await put(`/api/payroll/payslips/${slip.id}`, body);
    if (!r.ok) return showAlert(r.data.message || 'Could not save', 'error');
    onSaved();
  };
  return (
    <Modal title={`Adjust payslip · ${fullName(slip)}`} subtitle="Rebuilding the run from attendance keeps these figures" onClose={onClose}
      footer={<><button className="hm-btn" onClick={onClose}>Cancel</button><button className="hm-btn primary" onClick={save}>Recalculate</button></>}>
      <div className="hm-form">
        <Field label="Arrears (₹)"><input type="number" min="0" className="hm-input" value={f.arrears} onChange={(e) => setF({ ...f, arrears: e.target.value })} /></Field>
        <Field label="Other deductions (₹)" hint="Advances, canteen, recoveries"><input type="number" min="0" className="hm-input" value={f.other_deductions} onChange={(e) => setF({ ...f, other_deductions: e.target.value })} /></Field>
        <Field label="TDS this month (₹)"><input type="number" min="0" className="hm-input" value={f.tds} onChange={(e) => setF({ ...f, tds: e.target.value })} /></Field>
        <Field label="Overtime hours"><input type="number" min="0" step="0.25" className="hm-input" value={f.ot_hours} onChange={(e) => setF({ ...f, ot_hours: e.target.value })} /></Field>
        <Field label="Remarks" className="full"><input className="hm-input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function RunDetail({ runId, onBack, showAlert }) {
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => get(`/api/payroll/runs/${runId}`).then((r) => setData(r.data)), [runId]);
  useEffect(() => { load(); }, [load]);
  if (!data?.run) return <Empty>Loading…</Empty>;
  const { run, payslips } = data;
  const draft = run.status === 'Draft';

  const act = async (fn, okMsg) => {
    const r = await fn();
    if (!r.ok) return showAlert(r.data.message || 'Could not complete', 'error');
    if (okMsg) showAlert(okMsg, 'success');
    load();
  };
  const sum = (k) => payslips.reduce((n, p) => n + Number(p[k] || 0), 0);
  const noBank = payslips.filter((p) => !p.has_bank).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="hm-card">
        <div className="hm-card-head">
          <div>
            <button className="hm-btn sm ghost" onClick={onBack}>← All runs</button>
            <h3 style={{ display: 'inline', marginLeft: 8 }}>{monthLabel(run.period)} · {run.branch_name}</h3> <Badge>{run.status}</Badge>
            {run.payment_reference && <span className="hm-muted" style={{ marginLeft: 8, fontSize: 12.5 }}>Ref {run.payment_reference}</span>}
          </div>
          <div className="hm-toolbar">
            {draft && <button className="hm-btn" onClick={() => act(() => post('/api/payroll/runs', { period: run.period, branch_id: run.branch_id }), 'Rebuilt from latest attendance')}><RefreshCw size={14} /> Rebuild</button>}
            {draft && <button className="hm-btn primary" onClick={() => window.confirm(`Finalise ${monthLabel(run.period)}? Attendance and salaries for the month are locked.`) && act(() => post(`/api/payroll/runs/${run.id}/finalize`), 'Payroll finalised')}><Lock size={14} /> Finalise</button>}
            {draft && <button className="hm-btn danger" onClick={() => window.confirm('Delete this draft?') && act(() => del(`/api/payroll/runs/${run.id}`)).then(onBack)}><Trash2 size={14} /></button>}
            {run.status === 'Finalized' && <button className="hm-btn" onClick={() => act(() => post(`/api/payroll/runs/${run.id}/reopen`), 'Reopened as draft')}><Unlock size={14} /> Reopen</button>}
            {run.status !== 'Draft' && <button className="hm-btn" onClick={() => openFile(`/api/payroll/runs/${run.id}/bank-file`, `salary-${run.period}.csv`).catch((e) => showAlert(e.message, 'error'))}><FileDown size={14} /> Bank file</button>}
            {run.status === 'Finalized' && <button className="hm-btn primary" onClick={() => { const ref = window.prompt('Bank payment / UTR reference'); if (ref) act(() => post(`/api/payroll/runs/${run.id}/paid`, { payment_reference: ref }), 'Marked as paid'); }}><Banknote size={14} /> Mark paid</button>}
          </div>
        </div>
        <div className="hm-card-body">
          <div className="hm-stats">
            <Stat label="Employees" value={run.employee_count} />
            <Stat label="Gross" value={money(run.total_gross)} />
            <Stat label="Deductions" value={money(run.total_deductions)} />
            <Stat label="Net pay" value={money(run.total_net)} tone="good" />
            <Stat label="Employer cost" value={money(run.total_employer_cost)} note={`PF ${money(sum('pf_employer'))} · ESI ${money(sum('esi_employer'))}`} />
          </div>
          {noBank > 0 && <div className="hm-note warn" style={{ marginTop: 12 }}>{noBank} employee(s) have no bank account or IFSC and will be missing from the bank file.</div>}
        </div>
      </div>
      <div className="hm-card">
        <div className="hm-table-wrap">
          <table className="hm-table">
            <thead><tr><th>Employee</th><th className="num">Paid days</th><th className="num">LOP</th><th className="num">OT h</th><th className="num">Gross</th><th className="num">PF</th><th className="num">ESI</th><th className="num">PT</th><th className="num">TDS</th><th className="num">Other</th><th className="num">Net pay</th><th /></tr></thead>
            <tbody>
              {payslips.map((p) => (
                <tr key={p.id}>
                  <td><strong>{fullName(p)}</strong><span className="sub">{p.employee_code}{p.remarks ? ` · ${p.remarks}` : ''}</span></td>
                  <td className="num">{Number(p.paid_days)}/{Number(p.days_in_month)}</td>
                  <td className="num" style={{ color: Number(p.lop_days) ? '#b91c1c' : undefined }}>{Number(p.lop_days)}</td>
                  <td className="num">{Number(p.ot_hours)}</td>
                  <td className="num">{money(p.gross)}{Number(p.arrears) > 0 && <span className="sub">incl. arrears {money(p.arrears)}</span>}</td>
                  <td className="num">{money(p.pf_employee)}</td>
                  <td className="num">{money(p.esi_employee)}</td>
                  <td className="num">{money(p.professional_tax)}</td>
                  <td className="num">{money(p.tds)}</td>
                  <td className="num">{money(p.other_deductions)}</td>
                  <td className="num"><strong>{money(p.net_pay)}</strong></td>
                  <td><div className="hm-actions">
                    {draft && <button className="hm-btn sm" onClick={() => setEdit(p)}>Adjust</button>}
                    <button className="hm-btn sm" title="Payslip PDF" onClick={() => pdf(p.id, showAlert)}><FileDown size={13} /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {edit && <PayslipEdit slip={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} showAlert={showAlert} />}
    </div>
  );
}

function RunsTab({ showAlert }) {
  const [runs, setRuns] = useState(null);
  const [period, setPeriod] = useState(lastMonth());
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => get('/api/payroll/runs').then((r) => setRuns(r.data.runs || [])), []);
  useEffect(() => { load(); }, [load]);

  const run = async () => {
    setBusy(true);
    const r = await post('/api/payroll/runs', { period });
    setBusy(false);
    if (!r.ok) return showAlert(r.data.message || 'Could not run payroll', 'error');
    showAlert(`${r.data.payslips} payslips calculated${r.data.without_structure ? `; ${r.data.without_structure} employees skipped (no salary structure)` : ''}`, r.data.without_structure ? 'warning' : 'success');
    setOpen(r.data.id);
  };

  if (open) return <RunDetail runId={open} onBack={() => { setOpen(null); load(); }} showAlert={showAlert} />;
  return (
    <div className="hm-card">
      <div className="hm-card-head">
        <h3>Payroll runs</h3>
        <div className="hm-toolbar">
          <input type="month" className="hm-input" value={period} max={todayIST().slice(0, 7)} onChange={(e) => setPeriod(e.target.value)} />
          <button className="hm-btn primary" disabled={busy} onClick={run}><Play size={14} /> {busy ? 'Calculating…' : 'Run payroll'}</button>
        </div>
      </div>
      <div className="hm-table-wrap">
        <table className="hm-table">
          <thead><tr><th>Month</th><th>Facility</th><th>Status</th><th className="num">Employees</th><th className="num">Gross</th><th className="num">Net pay</th><th>Finalised</th></tr></thead>
          <tbody>
            {!runs && <tr><td colSpan={7}><Empty>Loading…</Empty></td></tr>}
            {runs?.length === 0 && <tr><td colSpan={7}><Empty>No payroll yet. Set salary structures first, then run payroll for a month.</Empty></td></tr>}
            {runs?.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
                <td><strong>{monthLabel(r.period)}</strong></td>
                <td>{r.branch_name}</td>
                <td><Badge>{r.status}</Badge></td>
                <td className="num">{r.employee_count}</td>
                <td className="num">{money(r.total_gross)}</td>
                <td className="num"><strong>{money(r.total_net)}</strong></td>
                <td>{r.finalized_at ? fmtDate(String(r.finalized_at).slice(0, 10)) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MyPayslips({ showAlert }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { get('/api/payroll/my/payslips').then((r) => setRows(r.data.payslips || [])); }, []);
  return (
    <div className="hm-card">
      <div className="hm-table-wrap">
        <table className="hm-table">
          <thead><tr><th>Month</th><th className="num">Paid days</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net pay</th><th>Status</th><th /></tr></thead>
          <tbody>
            {!rows && <tr><td colSpan={7}><Empty>Loading…</Empty></td></tr>}
            {rows?.length === 0 && <tr><td colSpan={7}><Empty>No payslips yet.</Empty></td></tr>}
            {rows?.map((p) => (
              <tr key={p.id}>
                <td><strong>{monthLabel(p.period)}</strong></td>
                <td className="num">{Number(p.paid_days)}</td>
                <td className="num">{money(p.gross)}</td>
                <td className="num">{money(p.total_deductions)}</td>
                <td className="num"><strong>{money(p.net_pay)}</strong></td>
                <td><Badge>{p.status}</Badge></td>
                <td><button className="hm-btn sm" onClick={() => pdf(p.id, showAlert)}><FileDown size={13} /> PDF</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Payroll() {
  const { alert, showAlert, hideAlert } = useAlert();
  const hr = isHrAdmin();
  const [tab, setTab] = useState(hr ? 'runs' : 'mine');
  return (
    <div className="hm-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={5000} />}
      <PageHead title="Payroll" subtitle="Salary structures, monthly payroll with PF, ESI, Professional Tax and TDS, and payslips" />
      <Tabs active={tab} onChange={setTab} tabs={[
        hr && { id: 'runs', label: 'Payroll runs' },
        hr && { id: 'salary', label: 'Salary structures' },
        { id: 'mine', label: 'My payslips' },
      ]} />
      {tab === 'runs' && <RunsTab showAlert={showAlert} />}
      {tab === 'salary' && <SalaryTab showAlert={showAlert} />}
      {tab === 'mine' && <MyPayslips showAlert={showAlert} />}
    </div>
  );
}
