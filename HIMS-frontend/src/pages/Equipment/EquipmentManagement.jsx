import { useState, useEffect, useCallback, useRef } from 'react';
import '../../assets/CSS/Governance.css';
import { api, fmtDT, fmtDate, fmtMin, role, saveCsv } from '../../utils/govApi';
import { KARNATAKA_CENTER, loadKarnatakaDistricts } from '../../utils/karnatakaDistricts';

const isManager = () => ['admin', 'super admin', 'lab head', 'lab doctor', 'lab_doctor'].includes(role());
const canReport = () => isManager() || ['lab technician', 'lab_tech'].includes(role());
const VALIDATION_BADGE = { Validated: 'ok', 'In validation': 'info', 'Not validated': '', Suspended: 'bad' };
const TICKET_BADGE = { Open: 'bad', 'In Progress': 'warn', Resolved: 'ok', Closed: '' };
const PRIORITY_BADGE = { Critical: 'bad', High: 'warn', Medium: 'info', Low: '' };
const GEO_BADGE = { Inside: 'ok', Outside: 'bad', Unknown: '' };
const online = (m) => m.status === 'Online' || m.status === 'Active';

// Equipment: analyzer integration registry, breakdown tickets and geo-mapping
// with geo-fencing (tender #27, #78-82, #130-132).
export default function EquipmentManagement() {
  const [tab, setTab] = useState('registry');
  const [machines, setMachines] = useState(null);
  const [msg, setMsg] = useState(null);
  const loadMachines = useCallback(() => api('/api/equipment/registry').then((d) => setMachines(d.success ? d.machines : [])), []);
  useEffect(() => { loadMachines(); }, [loadMachines]);

  const list = machines || [];
  const kpis = {
    total: list.length,
    online: list.filter(online).length,
    validated: list.filter((m) => m.validation_status === 'Validated').length,
    outside: list.filter((m) => m.geofence_status === 'Outside').length,
    tickets: list.reduce((a, m) => a + Number(m.open_tickets || 0), 0),
    unmapped: list.filter((m) => m.install_lat == null).length,
  };

  return (
    <div className="gv-page">
      <div className="gv-head">
        <div>
          <h1>Equipment</h1>
          <p>Every analyzer with its interface details, validation status, breakdown history and approved installation point. Moving an analyzer outside its geo-fence raises a critical ticket automatically.</p>
        </div>
      </div>
      <div className="gv-kpis">
        <div className="gv-kpi"><b>{kpis.total}</b><span>Analyzers</span></div>
        <div className="gv-kpi"><b>{kpis.online}</b><span>Online now</span></div>
        <div className={`gv-kpi ${kpis.validated < kpis.total ? 'warn' : 'ok'}`}><b>{kpis.validated}/{kpis.total}</b><span>Interface validated</span></div>
        <div className={`gv-kpi ${kpis.tickets ? 'warn' : ''}`}><b>{kpis.tickets}</b><span>Open tickets</span></div>
        <div className={`gv-kpi ${kpis.outside ? 'bad' : ''}`}><b>{kpis.outside}</b><span>Outside geo-fence</span></div>
        <div className={`gv-kpi ${kpis.unmapped ? 'warn' : ''}`}><b>{kpis.unmapped}</b><span>No install point</span></div>
      </div>
      <div className="gv-tabs">
        {[['registry', 'Integration registry'], ['tickets', 'Breakdown tickets'], ['geo', 'Geo-map & geo-fence']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => { setTab(k); setMsg(null); }}>{l}</button>
        ))}
      </div>
      {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
      {tab === 'registry' && <Registry machines={machines} reload={loadMachines} setMsg={setMsg} />}
      {tab === 'tickets' && <Tickets machines={list} reloadMachines={loadMachines} setMsg={setMsg} />}
      {tab === 'geo' && <GeoMap machines={list} reload={loadMachines} setMsg={setMsg} />}
    </div>
  );
}

function Registry({ machines, reload, setMsg }) {
  const [editing, setEditing] = useState(null);
  return (
    <>
      <div className="gv-actions" style={{ marginBottom: 12 }}>
        <button className="gv-btn ghost" onClick={() => saveCsv('analyzer-integration-registry.csv', machines || [], [
          ['Facility', (m) => m.branch_name], ['District', (m) => m.district], ['Lab', (m) => m.lab_name], ['Machine ID', (m) => m.machine_id], ['Make', (m) => m.manufacturer],
          ['Model', (m) => m.model], ['Serial', (m) => m.serial_number], ['Interface', (m) => m.interface_type], ['Port / IP', (m) => m.port_ip], ['Protocol', (m) => m.protocol],
          ['Mapping version', (m) => m.mapping_version], ['Validation', (m) => m.validation_status], ['Validated on', (m) => m.validated_on], ['Validated by', (m) => m.validated_by],
          ['Status', (m) => m.status], ['Uptime 7d %', (m) => m.uptime_7d], ['Tests 30d', (m) => m.tests_30d]])}>Export registry</button>
      </div>
      <div className="gv-table-wrap">
        <table className="gv-table">
          <thead><tr><th>Analyzer</th><th>Facility</th><th>Interface</th><th>Mapping</th><th>Validation</th><th className="num">Uptime 7d</th><th className="num">Tests today / 30d</th><th /></tr></thead>
          <tbody>
            {!machines && <tr><td colSpan={8} className="gv-empty">Loading…</td></tr>}
            {machines?.length === 0 && <tr><td colSpan={8} className="gv-empty">No analyzers registered.</td></tr>}
            {(machines || []).map((m) => (
              <tr key={m.id}>
                <td><b>{m.manufacturer} {m.model}</b><div className="gv-sub">{m.machine_id} · S/N {m.serial_number || '—'}</div>
                  <span className={`gv-badge ${online(m) ? 'ok' : ''}`}>{m.status || 'Unknown'}</span></td>
                <td>{m.branch_name || '—'}<div className="gv-sub">{m.lab_name || ''}{m.district ? ` · ${m.district}` : ''}</div></td>
                <td>{m.interface_type || '—'}{m.port_ip ? <div className="gv-sub gv-mono">{m.port_ip}{m.baud_rate && m.interface_type !== 'TCP' ? ` @ ${m.baud_rate}` : ''}</div> : null}<div className="gv-sub">{m.protocol || 'protocol not recorded'}</div></td>
                <td>{m.mapping_version ? `v${m.mapping_version}` : <span className="gv-sub">—</span>}</td>
                <td><span className={`gv-badge ${VALIDATION_BADGE[m.validation_status]}`}>{m.validation_status}</span>
                  {m.validated_on ? <div className="gv-sub">{fmtDate(m.validated_on)}{m.validated_by ? ` · ${m.validated_by}` : ''}</div> : null}</td>
                <td className="num">{m.uptime_7d == null ? '—' : `${m.uptime_7d}%`}</td>
                <td className="num">{m.tests_today} / {m.tests_30d}</td>
                <td>{isManager() && <button className="gv-btn sm ghost" onClick={() => setEditing(m)}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <RegistryModal m={editing} onClose={() => setEditing(null)} onSaved={(d) => { setEditing(null); setMsg({ ok: true, text: d.message }); reload(); }} />}
    </>
  );
}

function RegistryModal({ m, onClose, onSaved }) {
  const [f, setF] = useState({ protocol: m.protocol || '', mapping_version: m.mapping_version || '', validation_status: m.validation_status, validated_on: m.validated_on ? String(m.validated_on).slice(0, 10) : '', validated_by: m.validated_by || '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="gv-overlay" onClick={onClose}>
      <div className="gv-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{m.manufacturer} {m.model}</h2>
        <div className="gv-sub">{m.machine_id} · S/N {m.serial_number || '—'} · {m.interface_type || 'interface not set'}</div>
        <div className="gv-form">
          <label>Protocol<input value={f.protocol} onChange={set('protocol')} placeholder="e.g. ASTM E1394 / HL7 v2.3.1" /></label>
          <label>Mapping version<input value={f.mapping_version} onChange={set('mapping_version')} placeholder="e.g. 1.2" /></label>
          <label>Validation status<select value={f.validation_status} onChange={set('validation_status')}>{['Not validated', 'In validation', 'Validated', 'Suspended'].map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>Validated on<input type="date" value={f.validated_on} onChange={set('validated_on')} /></label>
          <label className="full">Validated by<input value={f.validated_by} onChange={set('validated_by')} placeholder="Name and designation" /></label>
        </div>
        {err && <div className="gv-msg bad">{err}</div>}
        <div className="gv-modal-actions"><button className="gv-btn ghost" onClick={onClose}>Cancel</button>
          <button className="gv-btn" onClick={async () => { const d = await api(`/api/equipment/registry/${m.id}`, { method: 'PUT', body: f }); if (d.success) onSaved(d); else setErr(d.message); }}>Save</button></div>
      </div>
    </div>
  );
}

function Tickets({ machines, reloadMachines, setMsg }) {
  const [filter, setFilter] = useState('active');
  const [data, setData] = useState(null);
  const [raising, setRaising] = useState(false);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api(`/api/equipment/tickets?status=${filter === 'all' ? '' : filter}`).then((d) => d.success && setData(d)), [filter]);
  useEffect(() => { load(); }, [load]);
  const s = data?.summary || {};
  const done = (d) => { setMsg({ ok: d.success, text: d.message }); load(); reloadMachines(); };
  return (
    <>
      <div className="gv-kpis">
        <div className={`gv-kpi ${Number(s.open) ? 'bad' : ''}`}><b>{Number(s.open || 0)}</b><span>Open</span></div>
        <div className={`gv-kpi ${Number(s.in_progress) ? 'warn' : ''}`}><b>{Number(s.in_progress || 0)}</b><span>In progress</span></div>
        <div className="gv-kpi"><b>{Number(s.resolved_30d || 0)}</b><span>Resolved (30 days)</span></div>
        <div className="gv-kpi"><b>{s.mttr_hours_30d == null ? '—' : `${s.mttr_hours_30d}h`}</b><span>Mean time to repair</span></div>
      </div>
      <div className="gv-filters">
        <div className="gv-tabs" style={{ marginBottom: 0 }}>
          {[['active', 'Open & in progress'], ['Resolved', 'Resolved'], ['Closed', 'Closed'], ['all', 'All']].map(([k, l]) => <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
        {canReport() && <button className="gv-btn" onClick={() => setRaising(true)}>Raise ticket</button>}
      </div>
      <div className="gv-table-wrap">
        <table className="gv-table">
          <thead><tr><th>Ticket</th><th>Analyzer</th><th>Problem</th><th>Status</th><th className="num">Downtime</th><th>Assigned / resolution</th><th /></tr></thead>
          <tbody>
            {!data && <tr><td colSpan={7} className="gv-empty">Loading…</td></tr>}
            {data?.tickets.length === 0 && <tr><td colSpan={7} className="gv-empty">No tickets here.</td></tr>}
            {(data?.tickets || []).map((t) => (
              <tr key={t.id}>
                <td><b className="gv-mono">{t.ticket_no}</b><div className="gv-sub">{fmtDT(t.reported_at)}</div><div className="gv-sub">{t.reported_by_name || 'System'}</div></td>
                <td>{t.machine_name}<div className="gv-sub">{t.manufacturer} {t.model} · {t.branch_name || ''}</div></td>
                <td><span className={`gv-badge ${PRIORITY_BADGE[t.priority]}`}>{t.priority}</span> <b>{t.category}</b><div className="gv-sub" style={{ maxWidth: 320 }}>{t.description}</div></td>
                <td><span className={`gv-badge ${TICKET_BADGE[t.status]}`}>{t.status}</span>{t.resolved_at ? <div className="gv-sub">{fmtDT(t.resolved_at)}</div> : null}</td>
                <td className="num">{fmtMin(t.downtime_minutes)}</td>
                <td>{t.assigned_to || <span className="gv-sub">unassigned</span>}{t.resolution ? <div className="gv-sub" style={{ maxWidth: 260 }}>{t.resolution}</div> : null}</td>
                <td>{canReport() && t.status !== 'Closed' && <button className="gv-btn sm ghost" onClick={() => setEditing(t)}>Update</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {raising && <RaiseModal machines={machines} categories={data?.categories || []} onClose={() => setRaising(false)} onSaved={(d) => { setRaising(false); done(d); }} />}
      {editing && <UpdateModal t={editing} onClose={() => setEditing(null)} onSaved={(d) => { setEditing(null); done(d); }} />}
    </>
  );
}

function RaiseModal({ machines, categories, onClose, onSaved }) {
  const [f, setF] = useState({ machine_id: '', category: 'Breakdown', priority: 'High', description: '', assigned_to: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="gv-overlay" onClick={onClose}>
      <div className="gv-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Raise a breakdown ticket</h2>
        <div className="gv-form">
          <label className="full">Analyzer *<select value={f.machine_id} onChange={set('machine_id')}><option value="">Choose…</option>{machines.map((m) => <option key={m.id} value={m.id}>{m.machine_id} — {m.manufacturer} {m.model} ({m.branch_name || '—'})</option>)}</select></label>
          <label>Category<select value={f.category} onChange={set('category')}>{categories.filter((c) => c !== 'Geo-fence breach').map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Priority<select value={f.priority} onChange={set('priority')}>{['Critical', 'High', 'Medium', 'Low'].map((p) => <option key={p}>{p}</option>)}</select></label>
          <label className="full">What is wrong? *<textarea rows={3} value={f.description} onChange={set('description')} placeholder="Error code, what the analyzer was doing, tests affected" /></label>
          <label className="full">Assigned to<input value={f.assigned_to} onChange={set('assigned_to')} placeholder="Service engineer / vendor (optional)" /></label>
        </div>
        <div className="gv-sub">If tests cannot wait, refer the pending samples to another lab from Sample Referrals.</div>
        {err && <div className="gv-msg bad">{err}</div>}
        <div className="gv-modal-actions"><button className="gv-btn ghost" onClick={onClose}>Cancel</button>
          <button className="gv-btn" disabled={!f.machine_id || !f.description.trim()} onClick={async () => { const d = await api('/api/equipment/tickets', { method: 'POST', body: f }); if (d.success) onSaved(d); else setErr(d.message); }}>Raise ticket</button></div>
      </div>
    </div>
  );
}

const NEXT = { Open: ['In Progress', 'Resolved'], 'In Progress': ['Resolved'], Resolved: ['Closed', 'In Progress'] };

const ACTION_CLASS = { Referred: 'info', 'Moved to another analyzer': 'ok', Held: 'warn' };

// The samples a breakdown touched (tender #18): sent to another lab or hospital, moved to
// another analyzer, or held — and whether each one's final report has been released.
function AffectedSamples({ ticket }) {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState(null);
  const [alt, setAlt] = useState('');
  const load = useCallback(() => api(`/api/equipment/tickets/${ticket.id}/samples`).then((r) => r.success && setD(r)), [ticket.id]);
  useEffect(() => { load(); }, [load]);
  const link = async (sample_id, action) => {
    const r = await api(`/api/equipment/tickets/${ticket.id}/samples`, { method: 'POST', body: { sample_id, action, alt_machine_id: action === 'Moved to another analyzer' ? alt || undefined : undefined } });
    setMsg({ ok: r.success, text: r.message });
    if (r.success) load();
  };
  if (!d) return null;
  const done = d.linked.length - d.pending_reports;
  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Affected samples {d.linked.length > 0 && <span className="gv-sub">— {done} of {d.linked.length} reports released</span>}</h3>
      {msg && <div className={`gv-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
      {d.linked.length > 0 && (
        <table className="gv-table" style={{ fontSize: 12.5 }}>
          <thead><tr><th>Sample</th><th>What was done</th><th>Where it is</th><th>Report</th></tr></thead>
          <tbody>{d.linked.map((l) => (
            <tr key={l.id}>
              <td><b className="gv-mono">{String(l.sample_id).slice(-4)}</b><div className="gv-sub">{l.patient_name} · {l.tests}</div></td>
              <td><span className={`gv-badge ${ACTION_CLASS[l.action]}`}>{l.action}</span>{l.alt_machine && <div className="gv-sub">{l.alt_machine}</div>}</td>
              <td>{l.action === 'Referred' && l.to_facility ? <>{l.to_facility}{l.to_lab ? ` · ${l.to_lab}` : ''}<div className="gv-sub">{l.referral_status}{l.received_at ? ` · received ${fmtDT(l.received_at)}` : ''}</div></> : (l.stage || '—')}</td>
              <td>{l.report_status === 'Approved' ? <span className="gv-badge ok">Released {l.report_released_at ? fmtDT(l.report_released_at) : ''}</span> : <span className="gv-badge warn">{l.report_status || 'No result yet'}</span>}</td>
            </tr>))}
          </tbody>
        </table>
      )}
      {d.at_risk.length > 0 && (
        <>
          <div className="gv-sub" style={{ margin: '12px 0 6px' }}>Waiting for this analyzer's lab — record what is being done with each. To send one to another lab or hospital, refer it from <i>Sample Referrals</i> and choose this ticket.</div>
          <label className="gv-sub">Other analyzer to use{' '}
            <select value={alt} onChange={(e) => setAlt(e.target.value)}><option value="">—</option>{d.other_machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <table className="gv-table" style={{ fontSize: 12.5 }}>
            <tbody>{d.at_risk.map((a) => (
              <tr key={a.sample_id}>
                <td><b className="gv-mono">{String(a.sample_id).slice(-4)}</b><div className="gv-sub">{a.patient_name} · {a.tests}</div></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="gv-btn ghost" onClick={() => link(a.sample_id, 'Moved to another analyzer')}>Moved to another analyzer</button>{' '}
                  <button className="gv-btn ghost" onClick={() => link(a.sample_id, 'Held')}>Held</button>
                </td>
              </tr>))}
            </tbody>
          </table>
        </>
      )}
      {d.linked.length === 0 && d.at_risk.length === 0 && <div className="gv-sub">No samples are waiting on this analyzer, and none have been linked to this ticket.</div>}
    </div>
  );
}

function UpdateModal({ t, onClose, onSaved }) {
  const [f, setF] = useState({ status: t.status, assigned_to: t.assigned_to || '', resolution: t.resolution || '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="gv-overlay" onClick={onClose}>
      <div className="gv-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.ticket_no} — {t.machine_name}</h2>
        <div className="gv-sub">{t.category}: {t.description}</div>
        <AffectedSamples ticket={t} />
        <div className="gv-form" style={{ marginTop: 14 }}>
          <label>Status<select value={f.status} onChange={set('status')}><option>{t.status}</option>{(NEXT[t.status] || []).map((s) => <option key={s}>{s}</option>)}</select></label>
          <label>Assigned to<input value={f.assigned_to} onChange={set('assigned_to')} /></label>
          <label className="full">Resolution {f.status === 'Resolved' ? '*' : ''}<textarea rows={3} value={f.resolution} onChange={set('resolution')} placeholder="What was done, parts replaced, QC / calibration after repair" /></label>
        </div>
        {err && <div className="gv-msg bad">{err}</div>}
        <div className="gv-modal-actions"><button className="gv-btn ghost" onClick={onClose}>Cancel</button>
          <button className="gv-btn" onClick={async () => { const d = await api(`/api/equipment/tickets/${t.id}`, { method: 'PUT', body: f }); if (d.success) onSaved(d); else setErr(d.message); }}>Save</button></div>
      </div>
    </div>
  );
}

// Leaflet is loaded on demand, the same way the Hospital Network map does.
function useLeaflet() {
  const [ready, setReady] = useState(!!window.L);
  useEffect(() => {
    if (window.L) return;
    if (!document.querySelector('link[href*="leaflet@1.9.4"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    const existing = document.querySelector('script[src*="leaflet@1.9.4"]');
    const script = existing || document.createElement('script');
    script.addEventListener('load', () => setReady(true));
    if (!existing) { script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; document.head.appendChild(script); }
  }, []);
  return ready;
}

const coordsOf = (m) => (m.install_lat != null ? [Number(m.install_lat), Number(m.install_lng)] : m.branch_lat != null ? [Number(m.branch_lat), Number(m.branch_lng)] : null);
// Popups are HTML: escape every value that comes from the database.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const colorOf = (m) => (m.geofence_status === 'Outside' ? '#dc2626' : online(m) ? '#16a34a' : '#64748b');

function GeoMap({ machines, reload, setMsg }) {
  const ready = useLeaflet();
  const mapEl = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const [placing, setPlacing] = useState(null);
  const [checking, setChecking] = useState(null);

  useEffect(() => {
    if (!ready || !mapEl.current || map.current) return;
    const L = window.L;
    map.current = L.map(mapEl.current, { center: KARNATAKA_CENTER, zoom: 7 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map.current);
    loadKarnatakaDistricts().then((geo) => {
      if (!map.current) return;
      L.geoJSON(geo, { style: { color: '#1a56db', weight: 1, fillOpacity: 0.04 }, onEachFeature: (ft, l) => l.bindTooltip(ft.properties.name, { sticky: true }) }).addTo(map.current);
    }).catch(() => {});
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, [ready]);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    const L = window.L;
    layer.current.clearLayers();
    const pts = [];
    for (const m of machines) {
      const c = coordsOf(m);
      if (!c) continue;
      pts.push(c);
      if (m.install_lat != null) L.circle(c, { radius: m.geofence_radius_m, color: colorOf(m), weight: 1, fillOpacity: 0.08, dashArray: '4 4' }).addTo(layer.current);
      L.circleMarker(c, { radius: 8, color: '#fff', weight: 2, fillColor: colorOf(m), fillOpacity: 1 })
        .bindPopup(`<b>${esc(m.manufacturer)} ${esc(m.model)}</b><br>${esc(m.machine_id)}<br>${esc(m.branch_name)}<br>Status: ${esc(m.status || 'Unknown')} · Uptime 7d: ${m.uptime_7d ?? '—'}%<br>Geo-fence: ${m.geofence_status}${m.install_lat == null ? ' (facility location — install point not recorded)' : ` · ${m.geofence_radius_m} m`}`)
        .addTo(layer.current);
      if (m.geofence_status === 'Outside' && m.last_seen_lat != null) {
        const seen = [Number(m.last_seen_lat), Number(m.last_seen_lng)];
        L.polyline([c, seen], { color: '#dc2626', dashArray: '6 6' }).addTo(layer.current);
        L.circleMarker(seen, { radius: 6, color: '#dc2626', fillColor: '#fff', fillOpacity: 1 }).bindPopup(`<b>${esc(m.machine_id)}</b> last reported here<br>${fmtDT(m.last_seen_at)}`).addTo(layer.current);
      }
    }
    if (pts.length) map.current.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
  }, [machines, ready]);

  return (
    <>
      <div className="gv-card" style={{ padding: 10 }}>
        <div ref={mapEl} className="gv-map" />
        <div className="gv-legend">
          <span><i style={{ background: '#16a34a' }} />Online</span><span><i style={{ background: '#64748b' }} />Offline</span><span><i style={{ background: '#dc2626' }} />Outside geo-fence</span>
          <span>Dashed circle = approved geo-fence</span>
        </div>
      </div>
      <div className="gv-table-wrap">
        <table className="gv-table">
          <thead><tr><th>Analyzer</th><th>Facility</th><th>Install point</th><th>Geo-fence</th><th>Last location check</th><th /></tr></thead>
          <tbody>
            {machines.map((m) => (
              <tr key={m.id}>
                <td><b>{m.machine_id}</b><div className="gv-sub">{m.manufacturer} {m.model}</div></td>
                <td>{m.branch_name || '—'}<div className="gv-sub">{m.district || ''}</div></td>
                <td className="gv-mono">{m.install_lat != null ? `${Number(m.install_lat).toFixed(5)}, ${Number(m.install_lng).toFixed(5)}` : <span className="gv-sub">not recorded</span>}
                  {m.installed_on ? <div className="gv-sub">installed {fmtDate(m.installed_on)}</div> : null}</td>
                <td><span className={`gv-badge ${GEO_BADGE[m.geofence_status]}`}>{m.geofence_status}</span><div className="gv-sub">{m.geofence_radius_m} m radius</div></td>
                <td>{m.last_seen_at ? fmtDT(m.last_seen_at) : <span className="gv-sub">never</span>}</td>
                <td><div className="gv-actions">
                  {isManager() && <button className="gv-btn sm ghost" onClick={() => setPlacing(m)}>Set install point</button>}
                  {canReport() && m.install_lat != null && <button className="gv-btn sm" onClick={() => setChecking(m)}>Check location</button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {placing && <InstallModal m={placing} onClose={() => setPlacing(null)} onSaved={(d) => { setPlacing(null); setMsg({ ok: true, text: d.message }); reload(); }} />}
      {checking && <CheckModal m={checking} onClose={() => setChecking(null)} onDone={(d) => { setChecking(null); setMsg({ ok: d.status !== 'Outside', text: d.message }); reload(); }} />}
    </>
  );
}

// The browser's own position — taken on a device standing next to the analyzer.
const here = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) return reject(new Error('This browser cannot report its location.'));
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude.toFixed(7), lng: p.coords.longitude.toFixed(7), accuracy: Math.round(p.coords.accuracy) }),
    (e) => reject(new Error(e.code === 1 ? 'Location permission was denied.' : 'Could not get a location fix.')),
    { enableHighAccuracy: true, timeout: 15000 });
});

function InstallModal({ m, onClose, onSaved }) {
  const [f, setF] = useState({ lat: m.install_lat ?? m.branch_lat ?? '', lng: m.install_lng ?? m.branch_lng ?? '', radius_m: m.geofence_radius_m || 200, installed_on: m.installed_on ? String(m.installed_on).slice(0, 10) : '' });
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="gv-overlay" onClick={onClose}>
      <div className="gv-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Installation point — {m.machine_id}</h2>
        <div className="gv-sub">Stand beside the analyzer and use this device's location, or enter the commissioning coordinates.</div>
        <div className="gv-form">
          <label>Latitude<input value={f.lat} onChange={set('lat')} /></label>
          <label>Longitude<input value={f.lng} onChange={set('lng')} /></label>
          <label>Geo-fence radius (m)<input type="number" min={25} value={f.radius_m} onChange={set('radius_m')} /></label>
          <label>Installed on<input type="date" value={f.installed_on} onChange={set('installed_on')} /></label>
        </div>
        <button className="gv-btn ghost sm" onClick={async () => { try { const p = await here(); setF({ ...f, lat: p.lat, lng: p.lng }); setNote(`Location captured (±${p.accuracy} m).`); } catch (e) { setErr(e.message); } }}>Use this device's location</button>
        {note && <div className="gv-msg info" style={{ marginTop: 10 }}>{note}</div>}
        {err && <div className="gv-msg bad" style={{ marginTop: 10 }}>{err}</div>}
        <div className="gv-modal-actions"><button className="gv-btn ghost" onClick={onClose}>Cancel</button>
          <button className="gv-btn" onClick={async () => { const d = await api(`/api/equipment/machines/${m.id}/install-location`, { method: 'PUT', body: f }); if (d.success) onSaved(d); else setErr(d.message); }}>Save</button></div>
      </div>
    </div>
  );
}

function CheckModal({ m, onClose, onDone }) {
  const [state, setState] = useState('Getting this device\'s location…');
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    here().then(async (p) => {
      setState(`Location fixed (±${p.accuracy} m). Checking against the geo-fence…`);
      const d = await api(`/api/equipment/machines/${m.id}/location-check`, { method: 'POST', body: { lat: p.lat, lng: p.lng, accuracy_m: p.accuracy } });
      if (d.success) onDone(d); else setState(d.message);
    }).catch((e) => setState(e.message));
  }, [m.id, onDone]);
  return (
    <div className="gv-overlay" onClick={onClose}>
      <div className="gv-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Location check — {m.machine_id}</h2>
        <div className="gv-msg info">{state}</div>
        <div className="gv-sub">Run this on a device standing beside the analyzer. A reading outside the {m.geofence_radius_m} m geo-fence raises a critical ticket.</div>
        <div className="gv-modal-actions"><button className="gv-btn ghost" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
