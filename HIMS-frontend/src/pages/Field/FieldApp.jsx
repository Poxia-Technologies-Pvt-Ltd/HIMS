import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createFieldEngine } from '../../lib/fieldEngine';
import { fieldStore } from '../../lib/fieldStore';
import { hasStaffToken } from '../../utils/session';

const API = import.meta.env.VITE_API_URL || '';

// Mobile field app (tender #53, #54, #57, #58): installable on Android and iOS from the browser
// ("Add to Home screen"), and packaged for the stores with Capacitor (see docs/05). Registration
// and sample collection keep working with no network and are sent to the server when it is back.
const css = `
.fa{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;background:#f1f5f9;color:#0f172a;padding-bottom:72px}
.fa header{background:#0d2554;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:5}
.fa header h1{font-size:17px;margin:0}.fa header small{display:block;opacity:.8;font-size:12px}
.fa .pill{font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;background:#16a34a}.fa .pill.off{background:#d97706}
.fa main{padding:14px;max-width:560px;margin:0 auto}
.fa .card{background:#fff;border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.fa label{display:block;font-size:13px;font-weight:600;margin:10px 0 4px}
.fa input,.fa select{width:100%;box-sizing:border-box;font-size:17px;padding:12px;border:1px solid #cbd5e1;border-radius:10px;background:#fff}
.fa button{font-size:16px;font-weight:700;border:0;border-radius:12px;padding:13px 16px;background:#1a56db;color:#fff;cursor:pointer}
.fa button.ghost{background:#e2e8f0;color:#0f172a}.fa button.warn{background:#d97706}.fa button:disabled{opacity:.5}
.fa .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.fa .row>*{flex:1}
.fa nav{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e2e8f0;display:flex;z-index:6}
.fa nav button{flex:1;background:none;color:#475569;border-radius:0;padding:12px 4px;font-size:13px}.fa nav button.on{color:#1a56db;border-top:3px solid #1a56db}
.fa .tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#e2e8f0;margin-left:6px}
.fa .tag.ok{background:#dcfce7;color:#166534}.fa .tag.w{background:#fef3c7;color:#92400e}.fa .tag.bad{background:#fee2e2;color:#991b1b}
.fa .msg{padding:10px 12px;border-radius:10px;margin-bottom:12px;font-size:14px}.fa .msg.ok{background:#dcfce7;color:#166534}.fa .msg.bad{background:#fee2e2;color:#991b1b}
.fa .sub{font-size:13px;color:#64748b}
`;

const rawApi = async (method, url, body) => {
  const bearer = localStorage.getItem('hims_token');
  const res = await fetch(`${API}${url}`, {
    method, credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null; try { data = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, data };
};

function deviceCode() {
  try {
    let c = localStorage.getItem('field_device');
    if (!c) { c = Math.random().toString(16).slice(2, 6).toUpperCase(); localStorage.setItem('field_device', c); }
    return c;
  } catch { return 'FLD'; }
}

const BLANK = { firstName: '', lastName: '', gender: '', ageOrYear: '', telephone: '', aadharNumber: '' };

export default function FieldApp() {
  const engine = useMemo(() => createFieldEngine({ store: fieldStore, api: rawApi, deviceCode: deviceCode() }), []);
  const [tab, setTab] = useState('register');
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [form, setForm] = useState(BLANK);
  const [msg, setMsg] = useState(null);
  const [regs, setRegs] = useState([]);
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [counts, setCounts] = useState({});
  const [snapAt, setSnapAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [signedIn] = useState(() => { try { return hasStaffToken(); } catch { return false; } });
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    setRegs(await engine.listRegistrations()); setOrders(await engine.listOrders(search)); setCounts(await engine.counts()); setSnapAt(await engine.snapshotAt());
  }, [engine, search]);

  const sync = useCallback(async (loadOrders = false) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const out = await engine.syncAll();
      if (out.held?.unauthorized) setMsg({ ok: false, text: 'Your session has ended. Sign in again, then press Sync.' });
      if (loadOrders && navigator.onLine) await engine.refreshOrders();
    } finally { busyRef.current = false; setBusy(false); await refresh(); }
  }, [engine, refresh]);

  // service worker + install manifest, only for this page
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/field-sw.js').catch(() => {});
    const link = document.createElement('link'); link.rel = 'manifest'; link.href = '/field.webmanifest'; document.head.appendChild(link);
    const meta = document.createElement('meta'); meta.name = 'theme-color'; meta.content = '#0d2554'; document.head.appendChild(meta);
    return () => { link.remove(); meta.remove(); };
  }, []);

  useEffect(() => {
    const on = () => { setOnline(true); sync(true); }; const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    const t = setInterval(() => { if (navigator.onLine) sync(false); }, 30000);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(t); };
  }, [sync]);
  useEffect(() => { sync(true); }, [sync]);
  useEffect(() => { const t = setTimeout(refresh, 0); return () => clearTimeout(t); }, [refresh]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setMsg(null);
    const r = await engine.register(form);
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
    const rec = r.record;
    setMsg({ ok: true, text: rec.status === 'synced' ? `Registered: ${rec.officialRegNo}` : rec.status === 'review' ? 'Saved. A similar patient already exists — see Sync.' : `Saved on this phone as ${rec.provisionalId}. It will be registered when the network is back.` });
    setForm(BLANK); await refresh();
  };
  const collect = async (o) => { const r = await engine.collect(o.bill_id); setMsg({ ok: r.ok, text: r.ok ? (r.record?.status === 'synced' ? `Marked collected for ${o.patient_name}.` : `Collected for ${o.patient_name} — will be sent when the network is back.`) : r.message }); await refresh(); };
  const resolve = async (id, action) => { await engine.resolveRegistration(id, action); await refresh(); };
  const waiting = (counts.pendingRegistrations || 0) + (counts.pendingCollections || 0);
  const attention = (counts.reviewRegistrations || 0) + (counts.failedRegistrations || 0) + (counts.failedCollections || 0);

  if (!signedIn) {
    return (<div className="fa"><style>{css}</style><header><h1>Karnataka LIMS — Field</h1></header>
      <main><div className="card"><p>Sign in once with your staff login (needs a network). After that this app works without one.</p><div className="row"><a href="/"><button type="button">Go to sign-in</button></a></div></div></main></div>);
  }

  return (
    <div className="fa">
      <style>{css}</style>
      <header>
        <div><h1>Field collection</h1><small>{waiting ? `${waiting} waiting to send` : 'Everything sent'}</small></div>
        <span className={`pill ${online ? '' : 'off'}`}>{online ? 'Online' : 'Offline'}</span>
      </header>
      <main>
        {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} onClick={() => setMsg(null)}>{msg.text}</div>}

        {tab === 'register' && (
          <form className="card" onSubmit={save} noValidate>
            <b>Register a patient</b>
            <label htmlFor="f1">First name</label><input id="f1" value={form.firstName} onChange={set('firstName')} autoComplete="off" />
            <label htmlFor="f2">Last name</label><input id="f2" value={form.lastName} onChange={set('lastName')} autoComplete="off" />
            <label htmlFor="f3">Gender</label>
            <select id="f3" value={form.gender} onChange={set('gender')}><option value="">Choose…</option><option>Male</option><option>Female</option><option>Other</option></select>
            <label htmlFor="f4">Age or birth year</label><input id="f4" inputMode="numeric" value={form.ageOrYear} onChange={set('ageOrYear')} placeholder="35 or 1990" />
            <label htmlFor="f5">Mobile number</label><input id="f5" inputMode="tel" value={form.telephone} onChange={set('telephone')} placeholder="10 digits" />
            <label htmlFor="f6">Aadhaar number (optional)</label><input id="f6" inputMode="numeric" value={form.aadharNumber} onChange={set('aadharNumber')} placeholder="12 digits" />
            <div className="row"><button type="submit">Save patient</button></div>
          </form>
        )}

        {tab === 'collect' && (
          <>
            <div className="card">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, UHID, bill or token" />
              <div className="row"><button type="button" className="ghost" disabled={!online || busy} onClick={() => sync(true)}>{busy ? 'Working…' : 'Refresh list'}</button></div>
              <div className="sub" style={{ marginTop: 8 }}>{snapAt ? `List saved ${new Date(snapAt).toLocaleString('en-IN')}` : 'No list saved yet — press Refresh while online.'}</div>
            </div>
            {orders.length === 0 && <div className="card sub">No orders to show.</div>}
            {orders.map((o) => (
              <div className="card" key={o.bill_id}>
                <b>{o.patient_name}</b>{o.token_number ? <span className="tag">Token {o.token_number}</span> : null}
                {o.priority && o.priority !== 'Routine' && <span className="tag w">{o.priority}</span>}
                <div className="sub">{o.reg_no} · {o.bill_number} · {o.tests} test(s) · {(o.containers || []).filter((c) => c.sample_id).length} tube(s)</div>
                {o.collected
                  ? <div style={{ marginTop: 8 }}><span className={`tag ${o.pending ? 'w' : 'ok'}`}>{o.pending ? 'Collected — not sent yet' : 'Collected'}</span></div>
                  : <div className="row"><button type="button" onClick={() => collect(o)}>Mark collected</button></div>}
              </div>
            ))}
          </>
        )}

        {tab === 'sync' && (
          <>
            <div className="card">
              <b>Waiting to send</b>
              <div className="sub">{counts.pendingRegistrations || 0} registration(s) · {counts.pendingCollections || 0} collection(s)</div>
              <div className="row"><button type="button" disabled={!online || busy} onClick={() => sync(true)}>{busy ? 'Sending…' : 'Sync now'}</button></div>
              {!online && <div className="sub" style={{ marginTop: 8 }}>No network. Records stay safely on this phone.</div>}
            </div>
            {regs.length === 0 && <div className="card sub">No patients registered on this phone yet.</div>}
            {regs.map((r) => (
              <div className="card" key={r.id}>
                <b>{r.name}</b><span className={`tag ${r.status === 'synced' ? 'ok' : r.status === 'pending' ? 'w' : 'bad'}`}>{r.status === 'synced' ? (r.officialRegNo || 'Registered') : r.status === 'review' ? 'Check' : r.status === 'failed' ? 'Failed' : 'Waiting'}</span>
                <div className="sub">{r.phone} · {r.provisionalId}{r.linked ? ' · linked to an existing patient' : ''}</div>
                {r.error && <div className="sub" style={{ color: '#991b1b' }}>{r.error}</div>}
                {r.status === 'review' && (
                  <>
                    <div className="sub">Possibly the same as: {(r.matches || []).map((m) => `${m.name} (${m.reg_no})`).join(', ')}</div>
                    <div className="row"><button type="button" onClick={() => resolve(r.id, 'same-person')}>Same person</button><button type="button" className="warn" onClick={() => resolve(r.id, 'different-person')}>Different person</button></div>
                  </>
                )}
                {r.status === 'failed' && <div className="row"><button type="button" onClick={() => resolve(r.id, 'retry')}>Try again</button><button type="button" className="ghost" onClick={() => resolve(r.id, 'discard')}>Discard</button></div>}
              </div>
            ))}
          </>
        )}
      </main>
      <nav>
        <button className={tab === 'register' ? 'on' : ''} onClick={() => setTab('register')}>Register</button>
        <button className={tab === 'collect' ? 'on' : ''} onClick={() => setTab('collect')}>Collect</button>
        <button className={tab === 'sync' ? 'on' : ''} onClick={() => setTab('sync')}>Sync{attention ? ` (${attention}!)` : waiting ? ` (${waiting})` : ''}</button>
      </nav>
    </div>
  );
}
