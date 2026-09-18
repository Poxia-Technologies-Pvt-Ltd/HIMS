import { useState, useEffect, useCallback } from 'react';

// Results confirmed saved into CARE — and nothing else.
//
// CARE is what forwards a result to ABHA; we never push to ABHA ourselves. So
// the only thing this page can honestly report is which results a technician
// confirmed they saved on CARE's form, by pressing "Saved" in the browser
// extension after saving there.
//
// An earlier version also listed results that had NOT reached CARE, inferred
// from our own push tables. That presented our internal push state as if it
// were ABHA state — two different things — so it is gone. A row here means:
// this result is in CARE, and CARE carries it to the patient's ABHA record.

const API_BASE = import.meta.env.VITE_API_URL || '';
const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}` });

const fmt = (ts) => (!ts ? '—' : new Date(ts).toLocaleString([], {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}));

const C = {
  ink: '#0f172a', muted: '#64748b', faint: '#94a3b8',
  line: '#e2e8f0', hair: '#f1f5f9', wash: '#f8fafc',
  green: '#15803d', greenBg: '#f0fdf4', greenLine: '#bbf7d0',
  amber: '#b45309', red: '#b91c1c', redBg: '#fef2f2', redLine: '#fecaca',
  brand: '#4f46e5',
};

const th = {
  padding: '10px 16px', fontSize: 11, fontWeight: 700, color: C.muted,
  textTransform: 'uppercase', textAlign: 'left',
  borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap',
};
const td = { padding: '11px 16px', fontSize: 13, borderBottom: `1px solid ${C.hair}` };

function Stat({ label, value, tone }) {
  const t = tone || { bg: '#fff', line: C.line, ink: C.ink };
  return (
    <div style={{ background: t.bg, border: `1px solid ${t.line}`, borderRadius: 12,
      padding: '12px 16px', minWidth: 130, flex: '1 1 130px' }}>
      <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: t.ink, marginTop: 2, lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

export default function AbhaDashboard() {
  const [data, setData] = useState({ results: [], totals: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');

  const roleLevel = localStorage.getItem('role_level') || 'Branch';
  const branchParam = roleLevel === 'Central' ? 'all' : (localStorage.getItem('branch_id') || '1');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ branch_id: branchParam });
      if (term.trim()) qs.set('search', term.trim());
      const res = await fetch(`${API_BASE}/api/care/abha-dashboard?${qs}`, { headers: authHdr() });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message || `HTTP ${res.status}`);
      setData({ results: body.results || [], totals: body.totals });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [branchParam, term]);

  useEffect(() => { load(); }, [load]);

  const t = data.totals;

  return (
    <div style={{ padding: 24, background: '#f6f8fb', minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.ink }}>ABHA Dashboard</h1>
        <button onClick={load} style={{ marginLeft: 'auto', padding: '8px 14px', borderRadius: 9,
          cursor: 'pointer', border: `1px solid ${C.line}`, background: '#fff',
          fontWeight: 650, fontSize: 12.5, color: C.ink }}>Refresh</button>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: C.muted, maxWidth: 820, lineHeight: 1.55 }}>
        Results saved into CARE. CARE forwards these to the patient's ABHA record — so a result
        appears here only once a technician has saved it in CARE and confirmed it in the extension.
      </p>

      {t && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <Stat label="Saved in CARE" value={t.results}
            tone={{ bg: C.greenBg, line: C.greenLine, ink: C.green }} />
          <Stat label="Patients" value={t.patients} />
          <Stat label="With ABHA linked" value={t.with_abha} />
          <Stat label="Saved today" value={t.today} />
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); setTerm(search); }}
        style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="ABHA, UHID, phone, name, sample ID or test"
          style={{ padding: '9px 13px', borderRadius: 9, border: `1px solid ${C.line}`,
            fontSize: 13, width: 320 }} />
        <button type="submit" style={{ padding: '9px 17px', borderRadius: 9, border: 0,
          background: C.brand, color: '#fff', fontWeight: 650, fontSize: 13, cursor: 'pointer' }}>Search</button>
        {term && (
          <button type="button" onClick={() => { setSearch(''); setTerm(''); }}
            style={{ padding: '9px 15px', borderRadius: 9, border: `1px solid ${C.line}`,
              background: '#fff', color: C.muted, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Clear</button>
        )}
      </form>

      {error && (
        <div style={{ background: C.redBg, border: `1px solid ${C.redLine}`, color: C.red,
          borderRadius: 10, padding: '11px 14px', fontSize: 13, marginBottom: 14 }}>{error}</div>
      )}

      <div style={{ background: '#fff', borderRadius: 14, border: `1px solid ${C.line}`, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.wash }}>
                {['Patient', 'ABHA Number', 'Test', 'Sample ID', 'Facility', 'Saved in CARE'].map((h, i) => (
                  <th key={i} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} style={{ padding: 44, textAlign: 'center', color: C.faint }}>Loading…</td></tr>
              )}

              {!loading && !data.results.length && (
                <tr><td colSpan={6} style={{ padding: 48, textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, color: C.ink, fontSize: 14 }}>Nothing saved to CARE yet</div>
                  <div style={{ color: C.muted, fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>
                    Fill a result into CARE with the extension, save it there,<br />
                    then press <strong>Saved</strong> in the extension panel.
                  </div>
                </td></tr>
              )}

              {!loading && data.results.map((r) => (
                <tr key={r.bill_item_id}>
                  <td style={{ ...td, fontWeight: 650, color: C.ink, textTransform: 'capitalize' }}>
                    {r.patient_name}
                    <div style={{ fontSize: 11, color: C.faint, fontWeight: 400,
                      fontFamily: 'ui-monospace, Menlo, monospace', textTransform: 'none' }}>{r.reg_no}</div>
                  </td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: C.muted }}>
                    {/* Reported, never filtered on. A result saved into CARE for a
                        patient with no ABHA linked still reached CARE; hiding it
                        would misrepresent what was sent. */}
                    {r.abha_id || <span style={{ color: C.amber, fontWeight: 700, fontFamily: 'inherit' }}>not linked</span>}
                    {r.telephone && <div style={{ fontSize: 11, color: C.faint }}>{r.telephone}</div>}
                  </td>
                  <td style={{ ...td, fontWeight: 600 }}>{r.test_name}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5, color: C.muted }}>
                    {r.sample_id || '—'}
                  </td>
                  <td style={{ ...td, color: C.muted, fontSize: 12.5 }}>{r.branch_name || '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <span style={{ background: C.greenBg, border: `1px solid ${C.greenLine}`, color: C.green,
                      borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 700 }}>✓ In CARE</span>
                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3 }}>{fmt(r.care_saved_at)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
