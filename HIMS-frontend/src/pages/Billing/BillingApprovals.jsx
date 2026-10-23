import { useCallback, useEffect, useState } from 'react';
import { Check, X, RefreshCw, Undo2 } from 'lucide-react';
import { PageHead, Tabs, Badge, Empty, Modal, Field } from '../../components/hmis/ui';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { get, post, money, currentUser } from '../../utils/hmisApi';

// Requests the billing desk cannot carry out alone. An approver (Admin,
// Super Admin, Accounts Manager) approves or rejects; approving does the
// work at once — cancels, re-totals, and records any refund.
const KIND_TONE = { Credit: 'blue', 'Cancel bill': 'red', 'Cancel item': 'amber', Concession: 'violet' };
const STATUS_TONE = { Pending: 'amber', Approved: 'green', Used: 'teal', Rejected: 'red', Withdrawn: '' };
const what = (a) => {
  if (a.kind === 'Credit') return `Pay later ${money(a.amount)}`;
  if (a.kind === 'Concession') return `Concession ${money(a.amount)} on ${a.invoice_no || a.bill_number}`;
  if (a.kind === 'Cancel item') return `Cancel "${a.item_name}" (${money(a.amount)}) on ${a.invoice_no || a.bill_number}`;
  return `Cancel bill ${a.invoice_no || a.bill_number} (${money(a.net_amount)})`;
};
const when = (dt) => (dt ? new Date(dt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const resultText = (r) => { try { return (typeof r === 'string' ? JSON.parse(r) : r)?.message || ''; } catch { return ''; } };

export default function BillingApprovals() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [tab, setTab] = useState('Pending');
  const [rows, setRows] = useState([]);
  const [canApprove, setCanApprove] = useState(false);
  const [busy, setBusy] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const me = Number(currentUser().id || localStorage.getItem('user_id'));

  const load = useCallback(async () => {
    const r = await get(`/api/billing/approvals?status=${tab === 'Pending' ? 'Pending' : 'all'}`);
    if (r.ok) { setRows(r.data.approvals || []); setCanApprove(!!r.data.can_approve); }
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const act = async (a, action, body = {}) => {
    setBusy(a.id);
    const r = await post(`/api/billing/approvals/${a.id}/${action}`, body);
    setBusy(null);
    if (!r.ok) { showAlert(r.data.message || 'Could not complete.', 'error'); return false; }
    showAlert(action === 'approve' ? (r.data.message || 'Approved') : action === 'reject' ? 'Rejected' : 'Withdrawn', 'success');
    load();
    return true;
  };

  return (
    <div className="hm-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} />}
      <PageHead title="Billing Approvals"
        subtitle={canApprove ? 'Approve or reject what the desk has asked for. Approving carries it out immediately, including any refund.' : 'Your requests and their status. An Admin or the Accounts Manager decides.'}>
        <button type="button" className="hm-btn" onClick={load}><RefreshCw size={14} /> Refresh</button>
      </PageHead>
      <Tabs tabs={[{ id: 'Pending', label: 'Waiting', count: tab === 'Pending' ? rows.length : undefined }, { id: 'all', label: 'All requests' }]} active={tab} onChange={setTab} />

      <div className="hm-card">
        {rows.length === 0 ? <Empty>{tab === 'Pending' ? 'Nothing is waiting for approval.' : 'No requests yet.'}</Empty> : (
          <div className="hm-table-wrap">
            <table className="hm-table">
              <thead><tr><th>Request</th><th>Patient</th><th>Reason</th><th>Asked by</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((a) => {
                  const mine = Number(a.requested_by) === me;
                  return (
                    <tr key={a.id}>
                      <td><Badge tone={KIND_TONE[a.kind]}>{a.kind}</Badge><span className="sub" style={{ marginTop: 4 }}>{what(a)}</span>
                        {Number(a.paid_amount) > 0 && a.kind !== 'Credit' && a.status === 'Pending' && a.refund_method && <span className="sub">Refund by {a.refund_method}</span>}
                      </td>
                      <td>{a.patient_name || '—'}<span className="sub">{a.reg_no}</span></td>
                      <td style={{ maxWidth: 260 }}>{a.reason}{a.decision_note && <span className="sub">Note: {a.decision_note}</span>}</td>
                      <td>{a.requested_by_name}<span className="sub">{when(a.requested_at)}</span></td>
                      <td><Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                        {a.decided_by_name && <span className="sub">{a.decided_by_name} · {when(a.decided_at)}</span>}
                        {resultText(a.result) && <span className="sub">{resultText(a.result)}</span>}
                      </td>
                      <td>
                        <div className="hm-actions">
                          {a.status === 'Pending' && canApprove && !mine && (
                            <>
                              <button type="button" className="hm-btn sm success" disabled={busy === a.id}
                                onClick={() => { if (window.confirm(`Approve: ${what(a)}?`)) act(a, 'approve'); }}><Check size={13} /> Approve</button>
                              <button type="button" className="hm-btn sm danger" disabled={busy === a.id} onClick={() => setRejecting({ a, note: '' })}><X size={13} /> Reject</button>
                            </>
                          )}
                          {a.status === 'Pending' && mine && canApprove && <span className="hm-muted" style={{ fontSize: 12 }}>Another approver must decide</span>}
                          {mine && (a.status === 'Pending' || (a.status === 'Approved' && a.kind === 'Credit')) && (
                            <button type="button" className="hm-btn sm ghost" disabled={busy === a.id} onClick={() => act(a, 'withdraw')}><Undo2 size={13} /> Withdraw</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rejecting && (
        <Modal title="Reject request" subtitle={what(rejecting.a)} onClose={() => setRejecting(null)}
          footer={(
            <>
              <button type="button" className="hm-btn" onClick={() => setRejecting(null)}>Close</button>
              <button type="button" className="hm-btn danger" disabled={!rejecting.note.trim()}
                onClick={async () => { if (await act(rejecting.a, 'reject', { note: rejecting.note })) setRejecting(null); }}>Reject</button>
            </>
          )}>
          <Field label="Why? (the desk will see this)">
            <textarea className="hm-textarea" autoFocus value={rejecting.note} onChange={(e) => setRejecting((r) => ({ ...r, note: e.target.value }))} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
