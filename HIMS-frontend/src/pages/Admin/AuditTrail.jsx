import { useState, useEffect, useCallback } from 'react';
import '../../assets/CSS/Governance.css';
import { api, download, fmtDT, daysAgo, ymd } from '../../utils/govApi';

const OUTCOME_BADGE = { Success: 'ok', Failed: 'bad', Denied: 'warn' };

// System-wide audit trail (tender #103-106): who did what, when, from where,
// with before/after for master-data edits, a hash-chain integrity check and
// CSV export for auditors.
export default function AuditTrail() {
  const [f, setF] = useState({ from: daysAgo(6), to: ymd(), module: '', outcome: '', method: '', user: '', q: '', changes: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [verify, setVerify] = useState(null);
  const [msg, setMsg] = useState(null);
  const [integrity, setIntegrity] = useState(null);
  useEffect(() => { api('/api/audit/sync-integrity').then((d) => d.success && setIntegrity(d)).catch(() => {}); }, []);

  const qs = (extra = {}) => new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([, v]) => v !== '' && v != null)).toString();
  const load = useCallback(() => {
    api(`/api/audit?${qs({ page })}`).then((d) => (d.success ? setData(d) : setMsg({ ok: false, text: d.message })));
  }, [f, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => { setPage(1); setF({ ...f, [k]: e.target.value }); };

  const runVerify = async () => {
    setVerify({ running: true });
    const d = await api('/api/audit/verify');
    setVerify(d.success ? d : { error: d.message });
  };

  return (
    <div className="gv-page">
      <div className="gv-head">
        <div>
          <h1>Audit Trail</h1>
          <p>Every change made in the system — registrations, sample handling, results, verification, report release and delivery, configuration and user administration — with who did it, when and from where. Entries are hash-chained and cannot be edited or deleted.</p>
        </div>
        <div className="gv-actions">
          <button className="gv-btn ghost" onClick={runVerify} disabled={verify?.running}>{verify?.running ? 'Verifying…' : 'Verify integrity'}</button>
          <button className="gv-btn" onClick={() => download(`/api/audit/export?${qs()}`, 'audit-trail.csv').catch((e) => setMsg({ ok: false, text: e.message }))}>Export CSV</button>
        </div>
      </div>

      {verify && !verify.running && (
        <div className={`gv-msg ${verify.error ? 'bad' : verify.intact ? 'ok' : 'bad'}`}>
          {verify.error || (verify.intact
            ? `Integrity verified: all ${verify.checked.toLocaleString('en-IN')} entries link correctly and none has been altered.`
            : `INTEGRITY BROKEN at entry #${verify.broken_at}: ${verify.reason}. ${verify.checked} entries before it verified.`)}
        </div>
      )}
      {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
      {integrity && (
        <div className={`gv-msg ${integrity.mismatches_30d ? 'bad' : 'ok'}`}>
          Data transfer integrity (last 30 days): {Number(integrity.results_with_checksum_30d || 0).toLocaleString('en-IN')} analyzer results arrived with a verified checksum;{' '}
          {integrity.mismatches_30d
            ? `${integrity.mismatches_30d} transfer(s) were damaged in transit and refused (latest ${fmtDT(integrity.last_mismatch)}). The sending agent keeps them queued and sends them again.`
            : 'no transfer was damaged in transit.'}
        </div>
      )}

      <div className="gv-filters">
        <label>From<input type="date" value={f.from} onChange={set('from')} /></label>
        <label>To<input type="date" value={f.to} onChange={set('to')} /></label>
        <label>Module<select value={f.module} onChange={set('module')}><option value="">All</option>{(data?.modules || []).map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Action<select value={f.method} onChange={set('method')}><option value="">All</option><option value="POST">Create / action</option><option value="PUT">Update</option><option value="PATCH">Patch</option><option value="DELETE">Delete</option><option value="GET">View / export</option></select></label>
        <label>Outcome<select value={f.outcome} onChange={set('outcome')}><option value="">All</option><option>Success</option><option>Failed</option><option>Denied</option></select></label>
        <label>User<input value={f.user} onChange={set('user')} placeholder="Name or ID" /></label>
        <label>Search<input value={f.q} onChange={set('q')} placeholder="Path, sample ID, IP…" /></label>
        <label>Only<select value={f.changes} onChange={set('changes')}><option value="">All entries</option><option value="1">Master-data changes</option></select></label>
      </div>

      <div className="gv-table-wrap">
        <table className="gv-table">
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Outcome</th><th>From</th></tr></thead>
          <tbody>
            {!data && <tr><td colSpan={6} className="gv-empty">Loading…</td></tr>}
            {data?.rows.length === 0 && <tr><td colSpan={6} className="gv-empty">No entries match these filters.</td></tr>}
            {(data?.rows || []).map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setOpen(r)}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDT(r.occurred_at)}<div className="gv-sub">#{r.id}</div></td>
                <td>{r.user_name || '—'}<div className="gv-sub">{r.user_role || ''}</div></td>
                <td><span className="gv-mono">{r.action}</span>{r.request_data?.message ? <div className="gv-sub">{r.request_data.message}</div> : null}</td>
                <td>{r.entity || r.module}{r.entity_id ? <div className="gv-sub gv-mono">{r.entity_id}</div> : null}{r.before_data ? <span className="gv-badge info" style={{ marginTop: 4 }}>before / after</span> : null}</td>
                <td><span className={`gv-badge ${OUTCOME_BADGE[r.outcome]}`}>{r.outcome}</span><div className="gv-sub">{r.status_code}</div></td>
                <td className="gv-mono">{r.ip_address || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && data.pages > 1 && (
        <div className="gv-actions" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
          <span className="gv-sub">{data.total.toLocaleString('en-IN')} entries · page {data.page} of {data.pages}</span>
          <button className="gv-btn sm ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <button className="gv-btn sm ghost" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      {open && <EntryModal entry={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

const show = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function EntryModal({ entry, onClose }) {
  const before = entry.before_data || null;
  const after = entry.after_data || null;
  const keys = before || after ? [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])] : [];
  const changed = keys.filter((k) => show(before?.[k]) !== show(after?.[k]));
  const [all, setAll] = useState(false);
  return (
    <div className="gv-overlay" onClick={onClose}>
      <div className="gv-modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>Audit entry #{entry.id}</h2>
        <div className="gv-sub">{fmtDT(entry.occurred_at)} · {entry.user_name || 'Unknown'}{entry.user_role ? ` (${entry.user_role})` : ''} · {entry.ip_address || 'no IP'}</div>
        <table className="gv-table" style={{ margin: '12px 0' }}><tbody>
          <tr><td style={{ width: 140 }}><b>Action</b></td><td className="gv-mono">{entry.method} {entry.path}</td></tr>
          <tr><td><b>Outcome</b></td><td><span className={`gv-badge ${OUTCOME_BADGE[entry.outcome]}`}>{entry.outcome}</span> HTTP {entry.status_code}</td></tr>
          <tr><td><b>Record</b></td><td>{entry.entity || entry.module} {entry.entity_id ? <span className="gv-mono">{entry.entity_id}</span> : null}</td></tr>
          <tr><td><b>Hash</b></td><td className="gv-mono" style={{ wordBreak: 'break-all' }}>{entry.row_hash}</td></tr>
        </tbody></table>

        {keys.length > 0 && (
          <>
            <div className="gv-head" style={{ marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>{entry.method === 'DELETE' ? 'Record as it was before deletion' : `Changes (${changed.length} field${changed.length === 1 ? '' : 's'})`}</h3>
              {entry.method !== 'DELETE' && <label className="gv-sub"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show unchanged fields</label>}
            </div>
            <div className="gv-table-wrap">
              <table className="gv-table gv-diff">
                <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
                <tbody>{(all || entry.method === 'DELETE' ? keys : changed).map((k) => (
                  <tr key={k}><td className="gv-mono">{k}</td>
                    <td className={changed.includes(k) ? 'changed' : ''}>{show(before?.[k]) || <span className="gv-sub">—</span>}</td>
                    <td className={changed.includes(k) ? 'changed' : ''}>{show(after?.[k]) || <span className="gv-sub">—</span>}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </>
        )}
        <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>Request</h3>
        <pre className="gv-pre">{JSON.stringify(entry.request_data, null, 2)}</pre>
        <div className="gv-modal-actions"><button className="gv-btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
