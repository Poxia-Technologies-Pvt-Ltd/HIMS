import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Play, CheckCircle2, Lock, FileText } from 'lucide-react';
import { PageHead, Badge, Empty, Modal, Field, Tabs } from '../../components/hmis/ui';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { get, patch, money, todayIST, hasRole } from '../../utils/hmisApi';

// X-ray, ultrasound, CT, ECG… ordered by doctors or billed at the desk. A study
// can be started only once it is paid (or on approved pay-later / free scheme):
// unpaid orders are shown locked, with where the patient must go.
const STATUS_LABEL = { Ordered: 'Waiting', Scheduled: 'Called', InProgress: 'In progress', Completed: 'Done', Cancelled: 'Cancelled' };
const STATUS_TONE = { Ordered: 'amber', Scheduled: 'blue', InProgress: 'teal', Completed: 'green', Cancelled: 'red' };

export default function ImagingDesk() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [date, setDate] = useState(todayIST());
  const [tab, setTab] = useState('open');
  const [orders, setOrders] = useState([]);
  const [report, setReport] = useState(null);
  const canPerform = hasRole('radiographer', 'doctor', 'admin', 'super admin');

  const load = useCallback(async () => {
    const r = await get(`/api/imaging/orders?date=${date}`);
    if (r.ok) setOrders(r.data.orders || []);
  }, [date]);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => clearInterval(t);
  }, [load]);

  const move = async (o, body) => {
    const r = await patch(`/api/imaging/orders/${o.id}`, body);
    if (!r.ok) { showAlert(r.data.message || 'Could not update.', 'error'); return false; }
    load();
    return true;
  };

  const open = orders.filter((o) => ['Ordered', 'Scheduled', 'InProgress'].includes(o.status));
  const done = orders.filter((o) => ['Completed', 'Cancelled'].includes(o.status));
  const list = tab === 'open' ? open : done;

  return (
    <div className="hm-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} />}
      <PageHead title="X-ray & Scans" subtitle="Studies are done only after payment. Locked orders are waiting at the billing desk.">
        <input type="date" className="hm-input" style={{ width: 160 }} value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
        <button type="button" className="hm-btn" onClick={load}><RefreshCw size={14} /> Refresh</button>
      </PageHead>
      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'open', label: 'To do', count: open.length }, { id: 'done', label: 'Done', count: done.length }]} />

      <div className="hm-card">
        {list.length === 0 ? <Empty>{tab === 'open' ? 'No studies waiting.' : 'Nothing done yet on this day.'}</Empty> : (
          <div className="hm-table-wrap">
            <table className="hm-table">
              <thead><tr><th>Patient</th><th>Study</th><th>Doctor</th><th>Payment</th><th>Status</th><th /></tr></thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id}>
                    <td><b>{o.patient_name || o.reg_no}</b><span className="sub">{o.reg_no}{o.age != null ? ` · ${o.age} y` : ''}{o.gender ? ` · ${o.gender}` : ''}</span></td>
                    <td><b>{o.modality}</b> {o.body_part}
                      {o.urgency !== 'Routine' && <> <Badge tone="red">{o.urgency}</Badge></>}
                      {o.clinical_indication && <span className="sub">{o.clinical_indication}</span>}
                    </td>
                    <td>{o.doctor_name || <span className="hm-muted">Desk / outside</span>}</td>
                    <td>
                      {o.cleared ? <Badge tone="green">{o.on_credit ? 'Pay-later approved' : o.billing_type === 'Free_Scheme' ? 'Free scheme' : 'Paid'}</Badge>
                        : o.charge_status === 'Unbilled' ? <Badge tone="red"><Lock size={11} /> Not billed</Badge>
                          : <Badge tone="red"><Lock size={11} /> Payment pending</Badge>}
                      {o.invoice_no && <span className="sub">{o.invoice_no}</span>}
                      {!o.cleared && o.amount && <span className="sub">{money(o.amount)} — send to billing</span>}
                    </td>
                    <td><Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge></td>
                    <td>
                      <div className="hm-actions">
                        {canPerform && ['Ordered', 'Scheduled'].includes(o.status) && (
                          <button type="button" className="hm-btn sm primary" disabled={!o.cleared} title={o.cleared ? 'Start the study' : 'Not paid yet'}
                            onClick={() => move(o, { status: 'InProgress' })}><Play size={13} /> Start</button>
                        )}
                        {canPerform && o.status === 'InProgress' && (
                          <button type="button" className="hm-btn sm success" onClick={() => setReport({ o, text: o.report_text || '' })}><CheckCircle2 size={13} /> Finish</button>
                        )}
                        {o.status === 'Completed' && (
                          <button type="button" className="hm-btn sm" onClick={() => setReport({ o, text: o.report_text || '', view: !canPerform })}><FileText size={13} /> Report</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {report && (
        <Modal title={`${report.o.modality} ${report.o.body_part || ''} — ${report.o.patient_name}`} subtitle="Findings / impression (optional; the films go with the patient)" onClose={() => setReport(null)}
          footer={report.view ? <button type="button" className="hm-btn" onClick={() => setReport(null)}>Close</button> : (
            <>
              <button type="button" className="hm-btn" onClick={() => setReport(null)}>Close</button>
              <button type="button" className="hm-btn primary" onClick={async () => {
                const body = report.o.status === 'InProgress' ? { status: 'Completed', report_text: report.text } : { report_text: report.text };
                if (await move(report.o, body)) { setReport(null); showAlert('Saved.', 'success'); }
              }}>{report.o.status === 'InProgress' ? 'Mark done' : 'Save report'}</button>
            </>
          )}>
          <Field label="Report">
            <textarea className="hm-textarea" style={{ minHeight: 160 }} value={report.text} readOnly={report.view} autoFocus
              onChange={(e) => setReport((r) => ({ ...r, text: e.target.value }))} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
