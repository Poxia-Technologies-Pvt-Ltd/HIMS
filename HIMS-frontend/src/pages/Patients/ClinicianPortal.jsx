import { useState, useEffect, useCallback } from 'react';
import '../../assets/CSS/Login.css';
import '../../assets/CSS/Governance.css';
import OtpSignIn from '../../components/OtpSignIn';

const API = import.meta.env.VITE_API_URL || '';
const KEY = 'clinician_token';
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

// Referring-clinician portal (tender #41): sign in with a one-time code sent to the registered
// mobile number, then see the orders and reports that name you as the referrer.
export default function ClinicianPortal() {
  const [token, setToken] = useState(() => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } });
  const [me, setMe] = useState(null);
  const [state, setState] = useState('all');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const headers = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const signOut = useCallback(() => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } setToken(''); setMe(null); setData(null); }, []);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/clinician-portal/me`, { headers: headers() }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { signOut(); return; }
      setMe(d.clinician);
    }).catch(() => setErr('Could not reach the server.'));
  }, [token, headers, signOut]);

  const load = useCallback(() => {
    if (!token) return Promise.resolve();
    const p = new URLSearchParams({ state, page: String(page), ...(q && { q }), ...(from && { from }), ...(to && { to }) });
    return fetch(`${API}/api/clinician-portal/reports?${p}`, { headers: headers() })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (r.status === 401 || r.status === 403) { signOut(); return; } setErr(d.success ? '' : d.message || 'Could not load reports.'); if (d.success) setData(d); })
      .catch(() => setErr('Could not reach the server.'));
  }, [token, headers, signOut, state, page, q, from, to]);
  useEffect(() => { load(); }, [load]);

  const pdf = async (sampleId) => {
    const r = await fetch(`${API}/api/clinician-portal/reports/${encodeURIComponent(sampleId)}/pdf`, { headers: headers() });
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).message || 'The report could not be downloaded.'); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = `lab-report-${sampleId}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!token) {
    return (
      <div className="auth-page">
        <main className="auth-main">
          <div className="brand"><div className="brand-text"><span className="brand-name">HIMS</span><span className="brand-tagline">CLINICIAN PORTAL</span></div></div>
          <div className="auth-card">
            <header className="auth-header">
              <h1 className="auth-title">Clinician sign-in</h1>
              <p className="auth-subtitle">Reports of the patients you referred</p>
            </header>
            <OtpSignIn requestUrl="/api/clinician-portal/otp/request" verifyUrl="/api/clinician-portal/otp/verify"
              phoneLabel="Registered mobile number" hint="Use the mobile number registered with the laboratory. Not registered? Ask the laboratory to add you."
              onSuccess={(d) => { try { localStorage.setItem(KEY, d.token); } catch { /* ignore */ } setToken(d.token); }} />
          </div>
        </main>
        <aside className="auth-aside"><div className="auth-aside-overlay" /><div className="auth-aside-content">
          <h2 className="aside-title">Your patients'<br />results, promptly</h2><p className="aside-desc">See which reports are ready and download them securely.</p></div></aside>
      </div>
    );
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / 25)) : 1;
  return (
    <div className="gv-page" style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <div className="gv-head">
        <div><h1>Dr {me?.name || ''}</h1><p>{[me?.registration_no && `Reg. ${me.registration_no}`, me?.facility].filter(Boolean).join(' · ') || 'Referring clinician'} — orders and reports that name you as the referrer.</p></div>
        <div className="gv-actions"><button className="gv-btn ghost" onClick={load}>Refresh</button><button className="gv-btn ghost" onClick={signOut}>Sign out</button></div>
      </div>
      <div className="gv-filters">
        <div className="gv-tabs" style={{ marginBottom: 0 }}>
          {[['all', 'All'], ['ready', 'Reports ready'], ['pending', 'In progress']].map(([k, l]) => <button key={k} className={state === k ? 'active' : ''} onClick={() => { setPage(1); setState(k); }}>{l}</button>)}
        </div>
        <label>Search<input value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} placeholder="Patient, UHID, sample or test" /></label>
        <label>From<input type="date" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value); }} /></label>
        <label>To<input type="date" value={to} onChange={(e) => { setPage(1); setTo(e.target.value); }} /></label>
      </div>
      {err && <div className="gv-msg bad">{err}</div>}
      {!data && !err && <div className="gv-empty">Loading…</div>}
      {data && (
        <div className="gv-card">
          {data.reports.length === 0 ? <div className="gv-empty">Nothing found for these filters. Orders appear here when your name is entered as the referring clinician.</div> : (
            <table className="gv-table">
              <thead><tr><th>Patient</th><th>Test</th><th>Facility</th><th>Ordered</th><th>Status</th><th /></tr></thead>
              <tbody>{data.reports.map((r) => (
                <tr key={r.order_id}>
                  <td><b>{r.patient.name}</b><div className="gv-sub">{r.patient.reg_no} · {[r.patient.gender, r.patient.age != null && `${r.patient.age} y`].filter(Boolean).join(' · ')}</div></td>
                  <td>{r.test_name}{r.priority === 'Urgent' && <span className="gv-badge warn" style={{ marginLeft: 6 }}>Urgent</span>}</td>
                  <td>{r.facility || '—'}</td><td>{fmt(r.ordered_at)}</td>
                  <td><span className={`gv-badge ${r.ready ? 'ok' : 'warn'}`}>{r.status}</span>{r.critical && <span className="gv-badge bad" style={{ marginLeft: 6 }}>Critical value</span>}</td>
                  <td className="num">{r.ready && <button className="gv-btn sm" onClick={() => pdf(r.sample_id)}>Download PDF</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <div className="gv-sub" style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
            {data.total} order(s)
            <button className="gv-btn sm ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
            Page {page} of {pages}
            <button className="gv-btn sm ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
          </div>
        </div>
      )}
    </div>
  );
}
