import { useState, useEffect } from 'react';
import '../../assets/CSS/Governance.css';
import { api, download, saveCsv, fmtDT } from '../../utils/govApi';

// Government data access without vendor involvement (tender #85-87, #125-127):
// every table as CSV, the data dictionary and the API catalogue. Each export
// is recorded in the audit trail.
export default function DataExport() {
  const [tables, setTables] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [apis, setApis] = useState(null);

  useEffect(() => { api('/api/export/tables').then((d) => (d.success ? setTables(d.tables) : setMsg({ ok: false, text: d.message }))); }, []);

  const get = async (key, path, name) => {
    setBusy(key); setMsg(null);
    try { await download(path, name); } catch (e) { setMsg({ ok: false, text: e.message }); }
    setBusy('');
  };
  const loadApis = async () => {
    const d = await api('/api/export/api-catalogue');
    if (d.success) setApis(d.endpoints); else setMsg({ ok: false, text: d.message });
  };

  const shown = (tables || []).filter((t) => t.name.includes(q.trim().toLowerCase()));
  return (
    <div className="gv-page">
      <div className="gv-head">
        <div>
          <h1>Data Export</h1>
          <p>All project data belongs to the Government of Karnataka. Any table can be downloaded here in open CSV format, with the data dictionary and the full API catalogue for successor systems. Passwords and access tokens are blanked; every download is recorded in the audit trail.</p>
        </div>
      </div>
      {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}

      <div className="gv-grid2">
        <div className="gv-card">
          <h3>Data dictionary</h3>
          <div className="gv-sub">Every table and column with type, nullability, keys, defaults and foreign-key references, generated from the live database.</div>
          <button className="gv-btn" disabled={busy === 'dd'} onClick={() => get('dd', '/api/export/data-dictionary', 'data-dictionary.csv')}>{busy === 'dd' ? 'Preparing…' : 'Download data dictionary (CSV)'}</button>
        </div>
        <div className="gv-card">
          <h3>API catalogue</h3>
          <div className="gv-sub">Every HTTP endpoint the platform exposes, for integration with Government systems.</div>
          <div className="gv-actions">
            <button className="gv-btn ghost" onClick={loadApis}>{apis ? `${apis.length} endpoints` : 'Show endpoints'}</button>
            {apis && <button className="gv-btn" onClick={() => saveCsv('api-catalogue.csv', apis, [['Method', (a) => a.method], ['Path', (a) => a.path]])}>Download (CSV)</button>}
          </div>
        </div>
      </div>

      {apis && (
        <div className="gv-card" style={{ maxHeight: 320, overflow: 'auto' }}>
          <table className="gv-table"><tbody>{apis.map((a) => <tr key={`${a.method} ${a.path}`}><td style={{ width: 80 }}><span className="gv-badge info">{a.method}</span></td><td className="gv-mono">{a.path}</td></tr>)}</tbody></table>
        </div>
      )}

      <div className="gv-filters">
        <label>Find a table<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. lab_test_result" /></label>
        <span className="gv-sub">{tables ? `${tables.length} tables` : ''}</span>
      </div>
      <div className="gv-table-wrap">
        <table className="gv-table">
          <thead><tr><th>Table</th><th className="num">Rows (approx.)</th><th className="num">Size</th><th>Last updated</th><th>Blanked columns</th><th /></tr></thead>
          <tbody>
            {!tables && <tr><td colSpan={6} className="gv-empty">Loading…</td></tr>}
            {shown.map((t) => (
              <tr key={t.name}>
                <td className="gv-mono">{t.name}</td>
                <td className="num">{Number(t.approx_rows || 0).toLocaleString('en-IN')}</td>
                <td className="num">{t.size_mb} MB</td>
                <td>{t.updated_at ? fmtDT(t.updated_at) : <span className="gv-sub">—</span>}</td>
                <td>{t.redacted.length ? t.redacted.map((c) => <span key={c} className="gv-badge warn" style={{ marginRight: 4 }}>{c}</span>) : <span className="gv-sub">none</span>}</td>
                <td><button className="gv-btn sm ghost" disabled={busy === t.name} onClick={() => get(t.name, `/api/export/table/${encodeURIComponent(t.name)}`, `${t.name}.csv`)}>{busy === t.name ? 'Exporting…' : 'Download CSV'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
