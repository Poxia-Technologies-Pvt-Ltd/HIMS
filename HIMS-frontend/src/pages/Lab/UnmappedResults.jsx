import { useState, useEffect, useCallback, Fragment } from 'react';

// Analyzer results that arrived without a matching order.
//
// The analyzer only ever tells us a sample number. When that number matches
// nothing — a mistyped ID, a sample run before it was billed, a rack loaded in
// the wrong order — the result used to be dropped, which is the worst outcome
// available: the sample is consumed, the run happened, and nobody finds out it
// went nowhere. It is now parked against a placeholder patient and waits here.
//
// A technician finds the real patient, picks which of their ordered tests the
// result belongs to, and only then does it reach the doctor's queue. Nothing
// is auto-matched: the machine cannot know whose sample it was, and guessing
// would put one patient's numbers on another patient's report.

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

const fmtDateTime = (ts) => (!ts ? '—' : new Date(ts).toLocaleString([], {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
}));

const C = {
  ink: '#0f172a', muted: '#64748b', faint: '#94a3b8',
  line: '#e2e8f0', hair: '#f1f5f9', wash: '#f8fafc',
  amber: '#b45309', amberBg: '#fffbeb', amberLine: '#fde68a',
  green: '#15803d', greenBg: '#f0fdf4', greenLine: '#bbf7d0',
  red: '#b91c1c', redBg: '#fef2f2', redLine: '#fecaca',
  brand: '#4f46e5',
};

const th = {
  padding: '10px 16px', fontSize: 11, fontWeight: 700, color: C.muted,
  textTransform: 'uppercase', textAlign: 'left',
  borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap',
};
const td = { padding: '11px 16px', fontSize: 13, borderBottom: `1px solid ${C.hair}`, verticalAlign: 'top' };

export default function UnmappedResults() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [picker, setPicker] = useState(null);

  const selectedBranch = localStorage.getItem('branch_id') || '1';
  const roleLevel = localStorage.getItem('role_level') || 'Branch';
  // Central staff see every branch; everyone else only their own, matching how
  // the worklist scopes itself.
  const branchParam = roleLevel === 'Central' ? 'all' : selectedBranch;

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(
        `${API_BASE}/api/lab/unmapped-results?branch_id=${encodeURIComponent(branchParam)}`,
        { headers: authHdr() }
      );
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
      setRows(data.results || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [branchParam]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: 24, background: '#f6f8fb', minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.ink }}>Unmatched Results</h1>
        {!loading && (
          <span style={{
            background: rows.length ? C.amberBg : C.greenBg,
            border: `1px solid ${rows.length ? C.amberLine : C.greenLine}`,
            color: rows.length ? C.amber : C.green,
            borderRadius: 999, padding: '2px 11px', fontSize: 12, fontWeight: 700,
          }}>{rows.length} waiting</span>
        )}
        <button
          onClick={load}
          style={{
            marginLeft: 'auto', padding: '8px 14px', borderRadius: 9, cursor: 'pointer',
            border: `1px solid ${C.line}`, background: '#fff', fontWeight: 650, fontSize: 12.5, color: C.ink,
          }}
        >Refresh</button>
      </div>
      <p style={{ margin: '0 0 18px', fontSize: 13, color: C.muted, maxWidth: 760, lineHeight: 1.55 }}>
        Results an analyzer sent for a sample number that matches no order. They are held here —
        out of the doctor's verification queue — until someone confirms whose sample it was.
      </p>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redLine}`, color: C.red,
          borderRadius: 10, padding: '11px 14px', fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      <div style={{ background: '#fff', borderRadius: 14, border: `1px solid ${C.line}`, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.wash }}>
                {['Sample ID', 'Test reported', 'Analyzer', 'Run at', 'Values', ''].map((h, i) => (
                  <th key={i} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} style={{ padding: 44, textAlign: 'center', color: C.faint }}>Loading…</td></tr>
              )}

              {!loading && !rows.length && (
                <tr><td colSpan={6} style={{ padding: 48, textAlign: 'center' }}>
                  <div style={{ fontSize: 30, marginBottom: 8 }}>✓</div>
                  <div style={{ fontWeight: 700, color: C.ink, fontSize: 14 }}>Nothing unmatched</div>
                  <div style={{ color: C.muted, fontSize: 12.5, marginTop: 3 }}>
                    Every analyzer result has found its order.
                  </div>
                </td></tr>
              )}

              {!loading && rows.map((r) => (
                <Fragment key={r.result_id}>
                  <tr>
                    <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, fontWeight: 650 }}>
                      {r.sample_id}
                      {r.placeholder_name && (
                        <div style={{ color: C.faint, fontSize: 11, fontWeight: 400, marginTop: 2 }}>
                          {r.placeholder_name}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, fontWeight: 650, color: C.ink }}>{r.test_name || '—'}</td>
                    <td style={{ ...td, color: C.muted }}>{r.machine_no || '—'}</td>
                    <td style={{ ...td, color: C.muted, whiteSpace: 'nowrap' }}>{fmtDateTime(r.tested_at)}</td>
                    <td style={td}>
                      <button
                        onClick={() => setExpanded(expanded === r.result_id ? null : r.result_id)}
                        style={{
                          border: `1px solid ${C.line}`, background: '#fff', borderRadius: 8,
                          padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: C.muted, fontWeight: 600,
                        }}
                      >
                        {r.parameter_count} {expanded === r.result_id ? '▲' : '▼'}
                      </button>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button
                        onClick={() => setPicker(r)}
                        style={{
                          border: 0, borderRadius: 9, padding: '8px 15px', cursor: 'pointer',
                          background: C.brand, color: '#fff', fontWeight: 650, fontSize: 12.5, whiteSpace: 'nowrap',
                        }}
                      >Find patient</button>
                    </td>
                  </tr>

                  {expanded === r.result_id && (
                    <tr>
                      <td colSpan={6} style={{ padding: '4px 16px 16px', background: C.wash, borderBottom: `1px solid ${C.hair}` }}>
                        {/* Shown before choosing a patient on purpose: the values
                            themselves are often what tells the technician which
                            test this run actually was. */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {(r.results || []).map((p, i) => (
                            <div key={i} style={{
                              background: '#fff', border: `1px solid ${C.line}`, borderRadius: 9,
                              padding: '7px 11px', minWidth: 108,
                            }}>
                              <div style={{ fontSize: 10.5, color: C.faint, fontWeight: 700, textTransform: 'uppercase' }}>
                                {p.parameter_name}
                              </div>
                              <div style={{ fontSize: 14, fontWeight: 750, color: C.ink }}>
                                {p.result_value}
                                <span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}> {p.unit || ''}</span>
                                {p.flag && p.flag !== 'N' && (
                                  <span style={{ marginLeft: 5, fontSize: 11, fontWeight: 800,
                                    color: p.flag === 'H' ? C.red : C.brand }}>{p.flag}</span>
                                )}
                              </div>
                            </div>
                          ))}
                          {!(r.results || []).length && (
                            <span style={{ color: C.faint, fontSize: 12.5 }}>No parameter values stored.</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {picker && (
        <AttachDialog
          result={picker}
          branchParam={branchParam}
          onClose={() => setPicker(null)}
          onDone={() => { setPicker(null); load(); }}
        />
      )}
    </div>
  );
}

/** Search for the patient, then pick which of their open tests this result is. */
function AttachDialog({ result, branchParam, onClose, onDone }) {
  const [term, setTerm] = useState('');
  const [tests, setTests] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState(null);

  const search = async (e) => {
    e?.preventDefault();
    if (!term.trim()) return;
    setBusy(true); setError(''); setTests(null); setChosen(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/lab/open-tests?search=${encodeURIComponent(term.trim())}&branch_id=${encodeURIComponent(branchParam)}`,
        { headers: authHdr() }
      );
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
      setTests(data.tests || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const attach = async () => {
    if (!chosen) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/api/lab/attach-result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ result_id: result.result_id, bill_item_id: chosen.bill_item_id }),
      });
      const data = await res.json();
      // 409 means the target already holds a result. The server refuses rather
      // than overwriting, and the message says what to do instead.
      if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  // Group by patient: a CARE order is typically three or four tests at once,
  // and the choice being made is "which of this person's tests", not "which
  // row in a flat list".
  const byPatient = [];
  for (const t of tests || []) {
    let g = byPatient.find((x) => x.patient_id === t.patient_id);
    if (!g) { g = { ...t, items: [] }; byPatient.push(g); }
    g.items.push(t);
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{ background: '#fff', borderRadius: 16, width: 'min(680px, 100%)', maxHeight: '86vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.hair}` }}>
          <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 750, color: C.ink }}>
            Attach {result.test_name || 'result'} — {result.sample_id}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: C.muted }}>
            Find the patient, then choose which of their tests this run belongs to.
          </p>
        </div>

        <form onSubmit={search} style={{ padding: '14px 20px', display: 'flex', gap: 9 }}>
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="UHID, ABHA, phone, CARE ID, our reg no, sample ID or name"
            style={{ flex: 1, padding: '10px 13px', borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 13.5 }}
          />
          <button type="submit" disabled={busy || !term.trim()}
            style={{ border: 0, borderRadius: 10, padding: '10px 18px', background: C.brand, color: '#fff',
              fontWeight: 650, fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? .6 : 1 }}>
            {busy ? '…' : 'Search'}
          </button>
        </form>

        <div style={{ padding: '0 20px', overflowY: 'auto', flex: 1 }}>
          {error && (
            <div style={{ background: C.redBg, border: `1px solid ${C.redLine}`, color: C.red,
              borderRadius: 10, padding: '10px 13px', fontSize: 12.5, marginBottom: 12 }}>{error}</div>
          )}

          {tests && !tests.length && (
            <p style={{ color: C.muted, fontSize: 13, padding: '18px 0' }}>
              No patient with tests awaiting a result matched that. Try their UHID or phone.
            </p>
          )}

          {byPatient.map((g) => (
            <div key={g.patient_id} style={{ border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
              <div style={{ background: C.wash, padding: '10px 14px', borderBottom: `1px solid ${C.hair}` }}>
                <div style={{ fontWeight: 750, fontSize: 13.5, color: C.ink }}>{g.patient_name}</div>
                <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>
                  {[g.reg_no, g.telephone, g.abha_id].filter(Boolean).join(' · ')}
                </div>
              </div>
              {g.items.map((t) => {
                const taken = Number(t.has_result) > 0;
                const isChosen = chosen?.bill_item_id === t.bill_item_id;
                return (
                  <button
                    key={t.bill_item_id}
                    disabled={taken}
                    onClick={() => setChosen(t)}
                    style={{
                      width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '11px 14px', border: 0, borderBottom: `1px solid ${C.hair}`, cursor: taken ? 'not-allowed' : 'pointer',
                      background: isChosen ? '#eef2ff' : '#fff', opacity: taken ? .5 : 1,
                    }}
                  >
                    <span style={{
                      width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${isChosen ? C.brand : C.line}`,
                      background: isChosen ? C.brand : '#fff',
                    }} />
                    <span style={{ flex: 1 }}>
                      <span style={{ fontWeight: 650, fontSize: 13, color: C.ink }}>{t.test_name}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: C.muted,
                        fontFamily: 'ui-monospace, Menlo, monospace' }}>{t.sample_id}</span>
                    </span>
                    {/* A test that already holds a result is shown but not
                        selectable — attaching would destroy a finished test to
                        salvage an orphan, and the server refuses it anyway. */}
                    <span style={{ fontSize: 11, fontWeight: 700, color: taken ? C.amber : C.muted }}>
                      {taken ? 'has a result' : t.status}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.hair}`, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, color: C.muted, flex: 1 }}>
            {chosen ? `Attaching to ${chosen.test_name} · ${chosen.sample_id}` : 'Nothing selected yet.'}
          </span>
          <button onClick={onClose}
            style={{ border: `1px solid ${C.line}`, background: '#fff', borderRadius: 10, padding: '9px 16px',
              fontWeight: 600, fontSize: 13, cursor: 'pointer', color: C.muted }}>Cancel</button>
          <button onClick={attach} disabled={!chosen || busy}
            style={{ border: 0, borderRadius: 10, padding: '9px 18px', background: C.green, color: '#fff',
              fontWeight: 700, fontSize: 13, cursor: (!chosen || busy) ? 'not-allowed' : 'pointer',
              opacity: (!chosen || busy) ? .5 : 1 }}>
            {busy ? 'Attaching…' : 'Attach result'}
          </button>
        </div>
      </div>
    </div>
  );
}
