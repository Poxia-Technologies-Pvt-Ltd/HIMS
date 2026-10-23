import { useState, useEffect, useCallback } from 'react';
import '../../assets/CSS/Governance.css';
import { api, fmtDT } from '../../utils/govApi';

const EMPTY = { name: '', registration_no: '', phone: '', email: '', facility: '', name_aliases: '', status: 'Active' };

// Register of referring clinicians who may sign in to the clinician portal (tender #41).
export default function ReferringClinicians() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(() => api(`/api/clinicians?q=${encodeURIComponent(q)}`).then((d) => (d.success ? setRows(d.clinicians) : setMsg({ ok: false, text: d.message }))), [q]);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    const d = form.id ? await api(`/api/clinicians/${form.id}`, { method: 'PUT', body: form }) : await api('/api/clinicians', { method: 'POST', body: form });
    setMsg({ ok: d.success, text: d.success ? 'Saved.' : d.message });
    if (d.success) { setForm(null); load(); }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="gv-page">
      <div className="gv-head">
        <div>
          <h1>Referring Clinicians</h1>
          <p>Clinicians who may sign in at <b>/clinician-portal</b> with a one-time code sent to their mobile number. They see only the orders and reports that name them as the referring clinician. Add other spellings used on orders under <i>Other spellings</i>.</p>
        </div>
        <div className="gv-actions"><button className="gv-btn" onClick={() => setForm({ ...EMPTY })}>Add clinician</button></div>
      </div>
      {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
      <div className="gv-filters"><label>Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, mobile or registration no." /></label></div>

      {form && (
        <form className="gv-card" onSubmit={save}>
          <h3>{form.id ? 'Edit clinician' : 'New clinician'}</h3>
          <div className="gv-filters">
            <label>Name<input value={form.name} onChange={set('name')} required /></label>
            <label>Mobile (receives the code)<input value={form.phone} onChange={set('phone')} inputMode="numeric" required /></label>
            <label>Registration no.<input value={form.registration_no || ''} onChange={set('registration_no')} /></label>
            <label>Facility / practice<input value={form.facility || ''} onChange={set('facility')} /></label>
            <label>E-mail<input type="email" value={form.email || ''} onChange={set('email')} /></label>
            <label>Other spellings (separate with |)<input value={form.name_aliases || ''} onChange={set('name_aliases')} placeholder="A Kumar|Dr Kumar A" /></label>
            {form.id && <label>Status<select value={form.status} onChange={set('status')}><option>Active</option><option>Inactive</option></select></label>}
          </div>
          <div className="gv-actions"><button className="gv-btn" type="submit">Save</button><button className="gv-btn ghost" type="button" onClick={() => setForm(null)}>Cancel</button></div>
        </form>
      )}

      <div className="gv-card">
        {rows.length === 0 ? <div className="gv-empty">No clinicians registered yet.</div> : (
          <table className="gv-table">
            <thead><tr><th>Name</th><th>Mobile</th><th>Registration</th><th>Facility</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td><b>{r.name}</b>{r.name_aliases && <div className="gv-sub">also: {r.name_aliases}</div>}</td><td>{r.phone}</td><td>{r.registration_no || '—'}</td><td>{r.facility || '—'}</td>
                <td><span className={`gv-badge ${r.status === 'Active' ? 'ok' : ''}`}>{r.status}</span></td><td>{fmtDT(r.last_login_at)}</td>
                <td className="num"><button className="gv-btn sm ghost" onClick={() => setForm({ ...r })}>Edit</button></td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
