import { useState, useEffect, useCallback, useMemo } from 'react';
import '../../assets/CSS/Governance.css';
import { api, saveCsv, role } from '../../utils/govApi';

const canEdit = () => ['admin', 'super admin'].includes(role());

// Each hospital's own price for each lab test. A blank facility price means
// the state default applies. Bills — at the counter, at the kiosk and through
// Razorpay — are always priced from this list on the server.
export default function TestPrices() {
  const [branchId, setBranchId] = useState(localStorage.getItem('branch_id') || '');
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({}); // test_id -> price string ('' = use default)
  const [q, setQ] = useState('');
  const [onlyOwn, setOnlyOwn] = useState(false);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => api(`/api/test-prices${branchId ? `?branch_id=${branchId}` : ''}`).then((d) => {
    if (!d.success) { setMsg({ ok: false, text: d.message }); return; }
    setData(d);
    setEdits({});
    if (!branchId && d.branch_id) setBranchId(String(d.branch_id));
  }), [branchId]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (data?.tests || []).filter((t) =>
    (!q || `${t.test_name} ${t.test_code} ${t.department}`.toLowerCase().includes(q.toLowerCase()))
    && (!onlyOwn || t.facility_price != null)), [data, q, onlyOwn]);
  const changed = Object.keys(edits).length;
  const ownCount = (data?.tests || []).filter((t) => t.facility_price != null).length;

  const value = (t) => (edits[t.id] !== undefined ? edits[t.id] : t.facility_price == null ? '' : String(Number(t.facility_price)));
  const effective = (t) => { const v = value(t); return v === '' ? Number(t.default_price) : Number(v); };

  const save = async () => {
    setSaving(true);
    const d = await api('/api/test-prices', { method: 'PUT', body: { branch_id: branchId, prices: Object.entries(edits).map(([test_id, price]) => ({ test_id: Number(test_id), price })) } });
    setSaving(false);
    setMsg({ ok: d.success, text: d.message });
    if (d.success) load();
  };

  const branchName = data?.branches?.find((b) => String(b.id) === String(branchId))?.branch_name || '';

  return (
    <div className="gv-page">
      <div className="gv-head">
        <div>
          <h1>Hospital Test Prices</h1>
          <p>Set this hospital's price for each test. Leave it blank to use the state default. Every bill — at the counter, at the kiosk and online through Razorpay — is priced from this list on the server. Free-scheme (NFDS) orders are always ₹0.</p>
        </div>
        <div className="gv-actions">
          <button className="gv-btn ghost" onClick={() => saveCsv(`test-prices-${branchName || branchId}.csv`, data?.tests || [], [
            ['Code', (t) => t.test_code], ['Test', (t) => t.test_name], ['Department', (t) => t.department], ['State default', (t) => t.default_price],
            ['Hospital price', (t) => t.facility_price ?? ''], ['Charged', (t) => t.facility_price ?? t.default_price]])}>Export CSV</button>
          {canEdit() && <button className="gv-btn" disabled={!changed || saving} onClick={save}>{saving ? 'Saving…' : `Save ${changed || ''} change${changed === 1 ? '' : 's'}`}</button>}
        </div>
      </div>

      <div className="gv-filters">
        {data?.branches?.length > 1 && (
          <label>Hospital<select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Choose…</option>{data.branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
          </select></label>
        )}
        <label>Find a test<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, code or department" /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, textTransform: 'none' }}>
          <input type="checkbox" checked={onlyOwn} onChange={(e) => setOnlyOwn(e.target.checked)} /> Only tests with a hospital price ({ownCount})
        </label>
      </div>
      {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}

      <div className="gv-table-wrap">
        <table className="gv-table">
          <thead><tr><th>Test</th><th>Department</th><th className="num">State default</th><th className="num">Hospital price</th><th className="num">Charged</th></tr></thead>
          <tbody>
            {!data && <tr><td colSpan={5} className="gv-empty">Loading…</td></tr>}
            {data && !branchId && <tr><td colSpan={5} className="gv-empty">Choose a hospital.</td></tr>}
            {rows.map((t) => (
              <tr key={t.id}>
                <td><b>{t.test_name}</b><div className="gv-sub">{t.test_code}</div></td>
                <td>{t.department || '—'}</td>
                <td className="num">₹{Number(t.default_price).toFixed(2)}</td>
                <td className="num">
                  {canEdit()
                    ? <input type="number" min="0" step="0.01" value={value(t)} placeholder="default"
                        onChange={(e) => setEdits({ ...edits, [t.id]: e.target.value })}
                        style={{ width: 110, padding: 6, border: `1.5px solid ${edits[t.id] !== undefined ? '#2563eb' : '#e2e8f0'}`, borderRadius: 6, textAlign: 'right' }} />
                    : (t.facility_price == null ? <span className="gv-sub">default</span> : `₹${Number(t.facility_price).toFixed(2)}`)}
                </td>
                <td className="num"><b>₹{effective(t).toFixed(2)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
