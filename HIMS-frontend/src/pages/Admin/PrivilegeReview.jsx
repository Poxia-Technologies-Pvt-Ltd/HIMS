import { useState, useEffect, useCallback } from 'react';
import '../../assets/CSS/Governance.css';
import { api, download, fmtDT, role } from '../../utils/govApi';

const LEVEL = { bad: 'bad', warn: 'warn', info: '' };

// Periodic privilege review (tender #107): who has access to what, what a
// reviewer should question, and a signed-off record of each review.
export default function PrivilegeReview() {
  const [branchId, setBranchId] = useState(localStorage.getItem('role_level') === 'Central' ? '' : (localStorage.getItem('branch_id') || ''));
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [note, setNote] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [msg, setMsg] = useState(null);
  const canSign = ['admin', 'super admin'].includes(role());

  const load = useCallback(() => {
    const q = branchId ? `?branch_id=${branchId}` : '';
    api(`/api/privilege-review${q}`).then((d) => (d.success ? setData(d) : setMsg({ ok: false, text: d.message })));
    api(`/api/privilege-review/history${q}`).then((d) => d.success && setHistory(d.reviews));
  }, [branchId]);
  useEffect(() => { load(); }, [load]);

  const complete = async () => {
    const d = await api('/api/privilege-review/complete', { method: 'POST', body: { note, branch_id: branchId || undefined } });
    setMsg({ ok: d.success, text: d.message });
    if (d.success) { setNote(''); load(); }
  };

  const rows = (data?.rows || []).filter((r) => !onlyFlagged || r.flags.some((f) => f.level !== 'info'));
  const s = data?.summary;
  const dueText = !data ? '' : !data.last_review ? 'Never reviewed' : `Last reviewed ${fmtDT(data.last_review.reviewed_at)} by ${data.last_review.reviewer_name}`;

  return (
    <div className="gv-page">
      <div className="gv-head">
        <div>
          <h1>Privilege Review</h1>
          <p>Everyone who can sign in, the access they hold, and what a reviewer should question — dormant accounts, old passwords, people who have left but still hold a signing certificate, locked accounts and all-powerful roles. Review it every {data?.policy.review_every_days || 90} days and sign it off; each review is kept as a record.</p>
        </div>
        <div className="gv-actions">
          {data?.branches?.length > 1 && (
            <select className="ps-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Whole system</option>
              {data.branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
            </select>
          )}
          <button className="gv-btn ghost" onClick={() => download(`/api/privilege-review/export${branchId ? `?branch_id=${branchId}` : ''}`, 'privilege-review.csv')}>Export CSV</button>
        </div>
      </div>
      {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}

      {data && (
        <>
          <div className={`gv-msg ${data.overdue ? 'bad' : 'ok'}`}>
            <b>{data.overdue ? 'Review due' : 'Review up to date'}</b> — {dueText}.{data.next_due && !data.overdue ? ` Next due ${fmtDT(data.next_due)}.` : ''}
          </div>
          <div className="gv-kpis">
            <div><b>{s.active}</b><span>Active users</span></div>
            <div><b>{s.inactive}</b><span>Deactivated</span></div>
            <div className={s.flagged ? 'warn' : ''}><b>{s.flagged}</b><span>Need a decision</span></div>
            <div><b>{s.powerful}</b><span>Admin accounts</span></div>
          </div>

          <section className="gv-card">
            <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b>Users</b>
              <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> Only those needing a decision
              </label>
            </div>
            <table className="gv-table">
              <thead><tr><th>User</th><th>Role</th><th>Hospital</th><th>Last sign-in</th><th>Password</th><th>To question</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan="6" className="gv-empty">No users to show.</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id} style={r.active ? undefined : { opacity: 0.6 }}>
                    <td><b>{r.name}</b><div style={{ fontSize: 12, color: '#64748b' }}>{r.email}{r.active ? '' : ' · deactivated'}</div></td>
                    <td>{r.role}<div style={{ fontSize: 12, color: '#64748b' }}>{r.role_level}</div></td>
                    <td>{r.hospital}</td>
                    <td>{r.last_login_at ? <>{fmtDT(r.last_login_at)}<div style={{ fontSize: 12, color: '#64748b' }}>{r.days_since_login} days ago</div></> : <span style={{ color: '#94a3b8' }}>not recorded</span>}</td>
                    <td>{r.password_age_days != null ? `${r.password_age_days} days old` : '—'}</td>
                    <td>{r.flags.length === 0 ? <span className="gv-badge ok">OK</span> : r.flags.map((f) => <div key={f.code} style={{ marginBottom: 3 }}><span className={`gv-badge ${LEVEL[f.level]}`}>{f.text}</span></div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {canSign && (
            <section className="gv-card" style={{ padding: 18, marginTop: 16 }}>
              <h3 style={{ margin: '0 0 6px' }}>Sign off this review</h3>
              <p style={{ margin: '0 0 10px', fontSize: 13, color: '#64748b' }}>Deactivate or correct accounts first (Staff / Admin screens), then record the review.{s.flagged ? ' Because some accounts are flagged, say what you decided.' : ''}</p>
              <textarea className="gv-input" rows={2} style={{ width: '100%' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Deactivated 2 dormant accounts; Dr X's DSC revoked; remaining accepted." />
              <div className="gv-actions" style={{ marginTop: 10 }}><button className="gv-btn" onClick={complete}>Record review</button></div>
            </section>
          )}

          <section className="gv-card" style={{ marginTop: 16 }}>
            <div style={{ padding: '12px 16px' }}><b>Past reviews</b></div>
            <table className="gv-table">
              <thead><tr><th>When</th><th>Reviewed by</th><th>Users</th><th>Flagged</th><th>Note</th></tr></thead>
              <tbody>
                {history.length === 0 && <tr><td colSpan="5" className="gv-empty">No review has been recorded yet.</td></tr>}
                {history.map((h) => <tr key={h.id}><td>{fmtDT(h.reviewed_at)}</td><td>{h.reviewer_name}</td><td>{h.users_total}</td><td>{h.flagged_total}</td><td>{h.note || '—'}</td></tr>)}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
