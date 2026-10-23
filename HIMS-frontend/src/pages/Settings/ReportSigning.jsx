import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, FileSignature, PlayCircle, Upload, Trash2, KeyRound } from 'lucide-react';
import '../../assets/CSS/Governance.css';
import '../../assets/CSS/PaymentSettings.css';
import { api } from '../../utils/govApi';

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const toBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Could not read the file.'));
  r.readAsDataURL(file);
});

function CertBadge({ dsc }) {
  if (!dsc) return <span className="gv-badge bad">No certificate</span>;
  if (dsc.expired) return <span className="gv-badge bad">Expired {fmt(dsc.valid_to)}</span>;
  if (dsc.days_left <= 30) return <span className="gv-badge warn">Expires in {dsc.days_left} days</span>;
  return <span className="gv-badge ok">Valid to {fmt(dsc.valid_to)}</span>;
}

// Settings → Report Signing. Each hospital's admin sets up its doctors'
// Digital Signature Certificates here (tender #36). The doctor then enters the
// certificate's password when authorising a report, and the report is signed
// with it. Passwords are never stored.
export default function ReportSigning({ embedded = false }) {
  const [data, setData] = useState(null);
  const [branchId, setBranchId] = useState(localStorage.getItem('branch_id') || '');
  const [msg, setMsg] = useState(null);
  const [upload, setUpload] = useState(null);   // { user, file, password, busy, error }
  const [server, setServer] = useState(null);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(() => api(`/api/lab/dsc/users${branchId ? `?branch_id=${branchId}` : ''}`).then((d) => {
    if (!d.success) { setMsg({ ok: false, text: d.message }); return; }
    setData(d);
    if (!branchId && d.branches?.length === 1) setBranchId(String(d.branches[0].id));
  }), [branchId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api('/api/lab/report-signing/status').then(setServer); }, []);

  const doUpload = async () => {
    const { user, file, password, remember } = upload;
    setUpload((u) => ({ ...u, busy: true, error: '' }));
    try {
      const d = await api('/api/lab/dsc/upload', {
        method: 'POST',
        body: { kind: user ? 'Doctor' : 'Hospital', user_id: user?.id, branch_id: branchId, p12_base64: await toBase64(file), password, remember_password: remember },
      });
      if (!d.success) { setUpload((u) => ({ ...u, busy: false, error: d.message })); return; }
      setUpload(null); setMsg({ ok: true, text: d.message }); load();
    } catch (e) {
      setUpload((u) => ({ ...u, busy: false, error: e.message }));
    }
  };

  const revoke = async (u) => {
    if (!window.confirm(`Remove ${u.name}'s certificate? They will no longer be able to sign with it. Reports already signed stay valid.`)) return;
    const d = await api(`/api/lab/dsc/${u.dsc.id}/revoke`, { method: 'POST', body: {} });
    setMsg({ ok: d.success, text: d.message }); load();
  };

  const saveRequire = async (value) => {
    const d = await api('/api/lab/dsc/settings', { method: 'PUT', body: { branch_id: branchId, require_dsc: value } });
    setMsg({ ok: d.success, text: d.message });
    if (d.success) setData((x) => ({ ...x, require_dsc: value }));
  };

  const saveAgent = async (value) => {
    const d = await api('/api/lab/dsc/settings', { method: 'PUT', body: { branch_id: branchId, use_agent: value } });
    setMsg({ ok: d.success, text: d.message });
    if (d.success) setData((x) => ({ ...x, use_agent: value }));
  };

  const resetToken = async (u) => {
    if (!window.confirm(`Reset ${u.name}'s registered USB token certificate? Their next signing registers whichever certificate they use then. Reports already signed stay valid.`)) return;
    const d = await api(`/api/lab/dsc/${u.token.id}/revoke`, { method: 'POST', body: {} });
    setMsg({ ok: d.success, text: d.success ? 'Registered certificate reset.' : d.message }); load();
  };

  const runTest = async () => {
    setTesting(true); setTest(null);
    setTest(await api('/api/lab/report-signing/test', { method: 'POST', body: {} }));
    setTesting(false);
  };

  const users = data?.users || [];
  const withCert = users.filter((u) => u.dsc && !u.dsc.expired).length;

  return (
    <div className={embedded ? '' : 'gv-page'} style={embedded ? undefined : { maxWidth: 980 }}>
      <div className="gv-head">
        <div>
          {embedded ? <h2 style={{ fontSize: '20px', margin: '0 0 8px 0' }}>Digital Signature (DSC)</h2> : <h1>Report Signing</h1>}
          <p>Every authorised report is already authenticated with the doctor's login signature, a content seal and a verification QR. Here you set up each doctor's <b>Digital Signature Certificate (DSC)</b>: when they authorise a report, they also enter the certificate's password and the report PDF is digitally signed with it, so any PDF reader can show who signed it and whether it was changed afterwards.</p>
        </div>
        <div className="gv-actions">
          {data?.branches?.length > 1 && (
            <select className="ps-select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Choose hospital…</option>
              {data.branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
            </select>
          )}
        </div>
      </div>
      {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}

      {data && !data.branch_id && <div className="gv-empty">Choose a hospital to manage its doctors' certificates.</div>}

      {data?.branch_id && (
        <>
          <section className="gv-card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <h3 style={{ margin: '0 0 4px' }}>Hospital certificate <span style={{ fontWeight: 500, color: '#64748b', fontSize: 13 }}>(recommended)</span></h3>
                <p style={{ margin: '0 0 8px', fontSize: 13.5, color: '#475569' }}>
                  One Document Signer Certificate for this hospital, set up once. Every report a doctor authorises is then digitally signed with it automatically.
                </p>
                {data.hospital ? (
                  <div>
                    <CertBadge dsc={data.hospital} />
                    <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 4 }}>
                      {data.hospital.common_name} · {String(data.hospital.issuer || '').replace(/^CN=/, '').split(',')[0]} ·{' '}
                      {data.hospital.auto ? 'signs automatically' : 'password asked at each signing'}
                    </div>
                  </div>
                ) : <span className="gv-badge bad">Not set up</span>}
              </div>
              <div style={{ whiteSpace: 'nowrap' }}>
                <button className="gv-btn" onClick={() => setUpload({ user: null, file: null, password: '', remember: true, busy: false, error: '' })}>
                  <Upload size={14} /> {data.hospital ? 'Replace' : 'Set up'}
                </button>
                {data.hospital && <button className="gv-btn ghost" onClick={() => revoke({ name: 'this hospital', dsc: data.hospital })} title="Remove this certificate"><Trash2 size={14} /></button>}
              </div>
            </div>
          </section>

          <section className="gv-card" style={{ padding: 20, marginBottom: 16 }}>
            <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!data.use_agent} onChange={(e) => saveAgent(e.target.checked)} style={{ marginTop: 4 }} />
              <span>
                <b>Doctors sign with their own USB token (Poxia DSC Agent)</b>
                <small style={{ display: 'block', color: '#64748b', marginTop: 3 }}>
                  When on, pressing <i>Sign &amp; Approve</i> hands the report to the <b>Poxia DSC Agent</b> installed on the doctor's computer: the doctor chooses their certificate and types the token PIN there, the token signs the report, and the report is released only once it is signed. The PIN never reaches the LIMS. A doctor's certificate is registered the first time they sign. This replaces the uploaded certificates above for this hospital.
                </small>
              </span>
            </label>
          </section>

          <section className="gv-card" style={{ padding: 20, marginBottom: 16 }}>
            <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!data.require_dsc} onChange={(e) => saveRequire(e.target.checked)} style={{ marginTop: 4 }} />
              <span>
                <b>Require a Digital Signature Certificate to authorise reports at this hospital</b>
                <small style={{ display: 'block', color: '#64748b', marginTop: 3 }}>
                  When on, a doctor without a valid certificate cannot authorise a report. When off, doctors without one authorise with their login signature as before, and those with one sign with it. Now: {data.hospital && !data.hospital.expired ? 'the hospital certificate covers every doctor' : `${withCert} of ${users.length} doctors have their own valid certificate`}.
                </small>
              </span>
            </label>
          </section>

          <h3 style={{ margin: '4px 4px 8px' }}>Doctors' own certificates <span style={{ fontWeight: 500, color: '#64748b', fontSize: 13 }}>(optional — used instead of the hospital's)</span></h3>
          <section className="gv-card">
            <table className="gv-table">
              <thead><tr><th>Doctor</th><th>Role</th><th>Reg. no.</th><th>Certificate</th><th /></tr></thead>
              <tbody>
                {users.length === 0 && <tr><td colSpan="5" className="gv-empty">No doctors found at this hospital.</td></tr>}
                {users.map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.name}</b></td>
                    <td>{u.role}</td>
                    <td>{u.registration_no || <span style={{ color: '#b91c1c' }}>missing</span>}</td>
                    <td>
                      <CertBadge dsc={u.dsc} />
                      {u.dsc && <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>{u.dsc.common_name} · {String(u.dsc.issuer || '').replace(/^CN=/, '').split(',')[0]}</div>}
                      {u.token && (
                        <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                          USB token: <b>{u.token.common_name}</b> · serial {u.token.serial} · valid to {fmt(u.token.valid_to)}
                          <button className="gv-btn ghost" style={{ marginLeft: 8, padding: '2px 8px' }} onClick={() => resetToken(u)}>Reset</button>
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="gv-btn" onClick={() => setUpload({ user: u, file: null, password: '', remember: false, busy: false, error: '' })}>
                        <Upload size={14} /> {u.dsc ? 'Replace' : 'Set up'}
                      </button>
                      {u.dsc && <button className="gv-btn ghost" onClick={() => revoke(u)} title="Remove this certificate"><Trash2 size={14} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <p style={{ color: '#64748b', fontSize: 13, margin: '10px 4px 18px' }}>
            Upload the certificate as a PKCS#12 file (<code>.pfx</code> / <code>.p12</code>) with its password. A doctor's personal Class 3 certificate on a USB token cannot be exported, so for most hospitals the practical choice is the <b>hospital certificate</b> above: ask your Certifying Authority (e.g. eMudhra, Sify, nCode, NIC) for a <b>Document Signer Certificate</b> in <code>.pfx</code> format. With <b>Sign automatically</b> on, the password is kept encrypted on the server (protect the server's <code>DSC_VAULT_KEY</code>); with it off, the password is never stored and the signer types it each time.
          </p>
        </>
      )}

      {upload && (
        <div className="gv-overlay" onClick={() => !upload.busy && setUpload(null)}>
          <div className="gv-modal" onClick={(e) => e.stopPropagation()}>
            <h2><KeyRound size={18} style={{ verticalAlign: -3 }} /> {upload.user ? `Certificate for ${upload.user.name}` : 'Hospital certificate'}</h2>
            <div className="gv-form" style={{ gridTemplateColumns: '1fr', margin: '12px 0' }}>
              <label>Certificate file (.pfx / .p12)
                <input type="file" accept=".pfx,.p12" onChange={(e) => setUpload((u) => ({ ...u, file: e.target.files?.[0] || null, error: '' }))} />
              </label>
              <label>Certificate password
                <input type="password" autoComplete="off" value={upload.password} onChange={(e) => setUpload((u) => ({ ...u, password: e.target.value, error: '' }))} />
              </label>
            </div>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '4px 0 10px', cursor: 'pointer' }}>
              <input type="checkbox" checked={upload.remember} onChange={(e) => setUpload((u) => ({ ...u, remember: e.target.checked }))} style={{ marginTop: 3 }} />
              <span style={{ fontSize: 13.5 }}><b>Sign automatically</b> — remember the password (stored encrypted) so reports are signed the moment a doctor approves them, with nothing more to type.
                <small style={{ display: 'block', color: '#64748b' }}>Untick to make the signer type the password every time instead.</small></span>
            </label>
            {upload.error && <div className="gv-msg bad">{upload.error}</div>}
            <div className="gv-actions">
              <button className="gv-btn ghost" disabled={upload.busy} onClick={() => setUpload(null)}>Cancel</button>
              <button className="gv-btn" disabled={upload.busy || !upload.file || !upload.password} onClick={doUpload}>{upload.busy ? 'Checking…' : 'Save certificate'}</button>
            </div>
          </div>
        </div>
      )}

      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Server-wide certificate (optional)</summary>
        <section className="gv-card" style={{ padding: 20, marginTop: 10 }}>
          <p style={{ marginTop: 0, color: '#475569', fontSize: 13.5 }}>
            Separate from the doctors' certificates: a single certificate set on the server (<code>REPORT_DSC_P12_PATH</code>, <code>REPORT_DSC_P12_PASSWORD</code>) signs authorised reports that were <i>not</i> signed by a doctor's own certificate. Leave it unset if every doctor has their own.
          </p>
          {server && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {!server.configured ? <FileSignature size={22} color="#64748b" /> : server.ok ? <ShieldCheck size={22} color="#15803d" /> : server.expired ? <ShieldX size={22} color="#b91c1c" /> : <ShieldAlert size={22} color="#b45309" />}
                <b>{!server.configured ? 'Not configured' : server.error ? server.error : `${server.common_name} — valid to ${fmt(server.valid_to)}`}</b>
              </div>
              {server.last_error && <p className="gv-msg bad">Last signing problem: {server.last_error}</p>}
              {server.configured && !server.error && (
                <div style={{ marginTop: 12 }}>
                  <button className="gv-btn" onClick={runTest} disabled={testing}><PlayCircle size={15} /> {testing ? 'Testing…' : 'Test signing'}</button>
                  {test && <div className={`gv-msg ${test.ok ? 'ok' : 'bad'}`} style={{ marginTop: 10 }}>{test.message}</div>}
                </div>
              )}
            </>
          )}
        </section>
      </details>
    </div>
  );
}
