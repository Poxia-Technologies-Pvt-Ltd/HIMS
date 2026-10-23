import { useState, useEffect, useCallback, useRef } from 'react';
import { ScanLine, RefreshCw, Check, X, Printer, Split } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { printCustodyReport } from '../../utils/custodyReport';
import '../../assets/CSS/QueueManagement.css';
import '../../assets/CSS/SampleTracking.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}`, 'Content-Type': 'application/json' });
const POLL_MS = 20_000;

const STAGES = ['Accessioned', 'Collected', 'Received', 'Processing', 'Stored', 'Disposed'];

// The action a scan station performs. `to` is the stage the sample moves to.
const ACTIONS = [
  { to: 'Collected',  label: 'Collect',  hint: 'Specimen taken from the patient', location: 'optional', locLabel: 'Collection point' },
  { to: 'Received',   label: 'Receive',  hint: 'Arrived at / accepted by the lab', location: 'optional', locLabel: 'Received at' },
  { to: 'Processing', label: 'Process',  hint: 'On the bench / analyzer',          location: 'optional', locLabel: 'Bench / analyzer' },
  { to: 'Stored',     label: 'Store',    hint: 'Retained — record where',          location: 'required', locLabel: 'Storage location (rack / freezer / slot)' },
  { to: 'Disposed',   label: 'Dispose',  hint: 'Discarded — record the method',    location: 'none',     locLabel: '' },
];

const fmt = (ts) => (ts ? new Date(ts).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const stageClass = (s) => `st-stage st-stage-${s.toLowerCase()}`;

function Stepper({ stage }) {
  const at = STAGES.indexOf(stage);
  return (
    <ol className="st-stepper">
      {STAGES.map((s, i) => (
        <li key={s} className={i < at ? 'done' : i === at ? 'current' : ''}>
          <span className="st-dot">{i < at ? <Check size={11} /> : i + 1}</span>
          <span className="st-step-label">{s}</span>
        </li>
      ))}
    </ol>
  );
}

const PURPOSES = ['Analysis', 'Archive', 'Referral', 'Retest', 'Other'];
const TUBE_COLORS = { purple: '#7c3aed', lavender: '#a78bfa', red: '#dc2626', yellow: '#eab308', gold: '#ca8a04', green: '#16a34a',
  blue: '#2563eb', 'light blue': '#38bdf8', grey: '#6b7280', gray: '#6b7280', black: '#111827', white: '#cbd5e1', pink: '#ec4899', orange: '#f97316' };
const tubeHex = (name) => TUBE_COLORS[String(name || '').toLowerCase().replace(/\s*tube$/, '').trim()] || '#94a3b8';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One label per tube, CODE128 of the sample ID — the same symbology and
// content the primary sample labels use, so the same scanners read them.
function printLabels(labels) {
  const body = labels.map((l) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, l.id, { format: 'CODE128', width: 1.6, height: 42, displayValue: true, fontSize: 11, margin: 4 });
    return `<div class="lbl"><div class="cap">${esc(l.caption)}</div><div class="sub">${esc(l.sub)}</div>${svg.outerHTML}</div>`;
  }).join('');
  const w = window.open('', '_blank', 'width=440,height=640');
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><title>Aliquot labels</title><style>
    body{font-family:Arial,sans-serif;margin:8px}
    .lbl{width:62mm;border:1px dashed #999;padding:4px 6px;margin:0 0 6px;page-break-inside:avoid;text-align:center}
    .cap{font-weight:700;font-size:12px}.sub{font-size:10px;color:#444;margin-bottom:2px}svg{max-width:100%}
    @media print{.lbl{border:none}}</style></head><body>${body}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
  return true;
}

// Scan station + tracking board for the physical sample lifecycle
// (Accessioned -> Collected -> Received -> Processing -> Stored -> Disposed).
// A USB barcode scanner types the sample ID and presses Enter, so the station
// works hands-free: pick the action once, then scan tube after tube.
export default function SampleTracking() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [action, setAction] = useState(ACTIONS[1]);
  const [location, setLocation] = useState('');
  const [method, setMethod] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(null);   // sample shown in the detail card
  const [feed, setFeed] = useState([]);            // this session's scans
  const [samples, setSamples] = useState([]);
  const [summary, setSummary] = useState({});
  const [stageFilter, setStageFilter] = useState('');
  const [search, setSearch] = useState('');
  const [days, setDays] = useState(1);
  const scanRef = useRef(null);
  const [alqCount, setAlqCount] = useState(1);
  const [alqPurpose, setAlqPurpose] = useState('Analysis');
  const [alqVolume, setAlqVolume] = useState('');
  const [alqBusy, setAlqBusy] = useState(false);
  const [justCreated, setJustCreated] = useState([]);

  const loadBoard = useCallback(async () => {
    try {
      const q = new URLSearchParams({ days });
      if (stageFilter) q.set('stage', stageFilter);
      if (search.trim()) q.set('search', search.trim());
      const branch = localStorage.getItem('branch_id');
      if (branch) q.set('branch_id', branch);
      const res = await fetch(`${API_BASE}/api/lab/samples?${q}`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) { setSamples(data.samples || []); setSummary(data.summary || {}); }
    } catch { /* keep last board */ }
  }, [days, stageFilter, search]);

  useEffect(() => { loadBoard(); const t = setInterval(loadBoard, POLL_MS); return () => clearInterval(t); }, [loadBoard]);
  useEffect(() => { scanRef.current?.focus(); }, [action]);

  const open = async (sampleCode) => {
    try {
      const branch = localStorage.getItem('branch_id');
      const res = await fetch(`${API_BASE}/api/lab/samples/lookup?code=${encodeURIComponent(sampleCode)}${branch ? `&branch_id=${branch}` : ''}`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) { setCurrent(data.sample); setJustCreated([]); } else showAlert(data.message, 'warning');
    } catch { showAlert('Network error.', 'error'); }
  };

  const scan = async (e) => {
    e.preventDefault();
    const value = code.trim();
    if (!value || busy) return;
    if (action.location === 'required' && !location.trim()) { showAlert('Enter the storage location before scanning.', 'warning'); return; }
    if (action.to === 'Disposed' && !method.trim()) { showAlert('Enter the disposal method before scanning.', 'warning'); return; }

    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/lab/samples/scan`, {
        method: 'POST', headers: authHdr(),
        body: JSON.stringify({
          code: value, to: action.to,
          location: action.to === 'Disposed' ? undefined : location.trim() || undefined,
          note: action.to === 'Disposed' ? method.trim() : undefined,
          branch_id: localStorage.getItem('branch_id') || undefined,
        }),
      });
      const data = await res.json();
      setFeed((f) => [{ id: Date.now(), code: value, ok: !!data.success, message: data.message, time: new Date() }, ...f].slice(0, 12));
      if (data.success) { setCurrent(data.sample); loadBoard(); }
      else showAlert(data.message || 'Scan failed.', 'error');
    } catch {
      showAlert('Network error.', 'error');
    } finally {
      setBusy(false);
      setCode('');
      scanRef.current?.focus();
    }
  };

  const createAliquots = async () => {
    if (!current || alqBusy) return;
    setAlqBusy(true);
    try {
      const branch = localStorage.getItem('branch_id');
      const res = await fetch(`${API_BASE}/api/lab/samples/${encodeURIComponent(current.sample_id)}/aliquots`, {
        method: 'POST', headers: authHdr(),
        body: JSON.stringify({ count: alqCount, purpose: alqPurpose, volume_ml: alqVolume || undefined, branch_id: branch || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setCurrent(data.sample);
        setJustCreated(data.created);
        showAlert(data.message, 'success');
        loadBoard();
      } else showAlert(data.message || 'Could not create aliquots.', 'error');
    } catch { showAlert('Network error.', 'error'); }
    finally { setAlqBusy(false); }
  };

  const labelFor = (a) => ({
    id: a.sample_id,
    caption: `${a.purpose || 'Aliquot'} · A${a.aliquot_no}${a.volume_ml ? ` · ${Number(a.volume_ml)} ml` : ''}`,
    sub: current?.patient_name || '',
  });

  const openCustodyReport = async () => {
    try {
      const branch = localStorage.getItem('branch_id');
      const res = await fetch(`${API_BASE}/api/lab/samples/custody?code=${encodeURIComponent(current.sample_id)}${branch ? `&branch_id=${branch}` : ''}`, { headers: authHdr() });
      const data = await res.json();
      if (!data.success) return showAlert(data.message || 'Could not build the report.', 'error');
      if (!printCustodyReport(data.report)) showAlert('Allow pop-ups to print the report.', 'warning');
    } catch { showAlert('Network error.', 'error'); }
  };

  return (
    <div className="qm-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={3500} />}

      <div className="qm-header">
        <div>
          <h1>Sample Tracking</h1>
          <p>Scan a sample barcode to record collection, receipt, processing, storage or disposal. Every scan is logged with who, where and when.</p>
        </div>
        <button className="qm-btn qm-btn-ghost" onClick={loadBoard}><RefreshCw size={14} />Refresh</button>
      </div>

      {/* ── Scan station ── */}
      <div className="qm-card st-station">
        <div className="st-actions" role="tablist">
          {ACTIONS.map((a) => (
            <button key={a.to} role="tab" className={`st-action${action.to === a.to ? ' active' : ''}`} onClick={() => setAction(a)}>
              {a.label}
            </button>
          ))}
        </div>
        <p className="st-hint">{action.hint}</p>

        <form className="st-scanrow" onSubmit={scan}>
          <div className="st-scanbox">
            <ScanLine size={20} />
            <input ref={scanRef} className="st-scaninput" value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="Scan or type the sample barcode, then press Enter" autoComplete="off" spellCheck={false} />
          </div>
          {action.location !== 'none' && (
            <input className="qm-input st-loc" value={location} onChange={(e) => setLocation(e.target.value)}
              placeholder={`${action.locLabel}${action.location === 'required' ? ' *' : ' (optional)'}`} />
          )}
          {action.to === 'Disposed' && (
            <input className="qm-input st-loc" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Disposal method * (e.g. autoclave, incineration)" />
          )}
          <button className="qm-btn qm-btn-primary" disabled={busy || !code.trim()}>{busy ? 'Recording…' : `Record ${action.label}`}</button>
        </form>

        <div className="st-lower">
          <div className="st-detail">
            {!current && <div className="st-empty">Scan a sample to see its details and history.</div>}
            {current && (
              <>
                <div className="st-detail-head">
                  <div>
                    <div className="st-sampleid">{current.sample_id}</div>
                    <div className="qm-sub">{current.patient_name || '—'}{current.reg_no ? ` · ${current.reg_no}` : ''}</div>
                  </div>
                  {current.priority !== 'Routine' && <span className={`qm-pri qm-pri-${current.priority.toLowerCase()}`}>{current.priority}</span>}
                </div>
                {current.parent_sample_id && (
                  <div className="st-parent">
                    Aliquot A{current.aliquot_no} of{' '}
                    <button className="st-link" onClick={() => open(current.parent_sample_id)}>{current.parent_sample_id}</button>
                    {current.purpose ? ` · ${current.purpose}` : ''}{current.volume_ml ? ` · ${Number(current.volume_ml)} ml` : ''}
                  </div>
                )}
                <div className="st-tests">
                  {current.tests.map((t) => (
                    <span key={t.test_name} className="st-test">
                      <i className="st-tube" style={{ background: tubeHex(t.tube_color) }} />
                      {t.test_name}
                      {(t.sample_type || t.tube_color) && <small>{[t.sample_type, t.tube_color].filter(Boolean).join(' · ')}</small>}
                    </span>
                  ))}
                </div>
                <Stepper stage={current.stage} />
                <div className="st-facts">
                  <span><b>Location</b>{current.location || '—'}</span>
                  <span><b>Last update</b>{fmt(current.updated_at)}</span>
                  {current.disposal_method && <span><b>Disposal</b>{current.disposal_method}</span>}
                </div>
                {current.order_samples?.length > 0 && (
                  <>
                    <div className="st-history-title">Other samples in this order</div>
                    <div className="st-chips">
                      {current.order_samples.map((o) => (
                        <button key={o.sample_id} className="st-chip" onClick={() => open(o.sample_id)}>
                          <b>{o.sample_id.slice(-4)}</b> {o.tests}
                          <span className={o.stage ? stageClass(o.stage) : 'st-stage st-stage-disposed'}>{o.stage || 'not tracked yet'}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {(current.aliquots?.length > 0 || current.can_aliquot) && (
                  <>
                    <div className="st-history-title">Aliquots</div>
                    {current.aliquots.length > 0 && (
                      <div className="st-chips">
                        {current.aliquots.map((a) => (
                          <button key={a.sample_id} className="st-chip" onClick={() => open(a.sample_id)}>
                            <b>A{a.aliquot_no}</b> {a.purpose || 'Aliquot'}{a.volume_ml ? ` · ${Number(a.volume_ml)} ml` : ''}
                            <span className={stageClass(a.stage)}>{a.stage}</span>
                          </button>
                        ))}
                        <button className="qm-btn qm-btn-ghost st-printall" onClick={() => printLabels(current.aliquots.map(labelFor))}>
                          <Printer size={13} />Print all labels
                        </button>
                      </div>
                    )}
                    {current.can_aliquot && (
                      <div className="st-alq-form">
                        <input type="number" min="1" max="10" className="qm-input" style={{ width: 64 }} value={alqCount}
                          onChange={(e) => setAlqCount(Number(e.target.value))} title="How many aliquots" />
                        <select className="qm-input" value={alqPurpose} onChange={(e) => setAlqPurpose(e.target.value)}>
                          {PURPOSES.map((p) => <option key={p}>{p}</option>)}
                        </select>
                        <input type="number" step="0.1" min="0" className="qm-input" style={{ width: 96 }} placeholder="ml each"
                          value={alqVolume} onChange={(e) => setAlqVolume(e.target.value)} />
                        <button className="qm-btn qm-btn-primary" onClick={createAliquots} disabled={alqBusy}>
                          <Split size={13} />{alqBusy ? 'Creating…' : 'Create aliquots'}
                        </button>
                        {justCreated.length > 0 && (
                          <button className="qm-btn qm-btn-ghost" onClick={() => printLabels(justCreated.map(labelFor))}>
                            <Printer size={13} />Print {justCreated.length} new label{justCreated.length > 1 ? 's' : ''}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}

                <div className="st-history-head">
                  <div className="st-history-title">Custody history</div>
                  <button className="qm-btn qm-btn-ghost" onClick={openCustodyReport}><Printer size={13} />Custody report</button>
                </div>
                <ul className="st-history">
                  {current.events.slice().reverse().map((e) => (
                    <li key={e.id}>
                      <span className={stageClass(e.to_stage)}>{e.event_type === 'Registered' ? 'Tracked' : e.event_type}</span>
                      <span className="st-h-main">{fmt(e.created_at)} · {e.actor_name || e.actor_role || (e.auto ? 'System' : '—')}{e.station ? ` · ${e.station}` : ''}{e.location ? ` · Placed: ${e.location}` : ''}{e.note ? ` · ${e.note}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="st-feed">
            <div className="st-history-title">This session</div>
            {feed.length === 0 && <div className="st-empty small">No scans yet.</div>}
            <ul>
              {feed.map((f) => (
                <li key={f.id} className={f.ok ? 'ok' : 'bad'}>
                  {f.ok ? <Check size={13} /> : <X size={13} />}
                  <span className="st-feed-code">{f.code}</span>
                  <span className="st-feed-msg">{f.ok ? '' : f.message}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ── Board ── */}
      <div className="qm-kpis st-kpis">
        {STAGES.map((s) => (
          <button key={s} className={`qm-kpi st-kpi${stageFilter === s ? ' active' : ''}`} onClick={() => setStageFilter(stageFilter === s ? '' : s)}>
            <span className="qm-kpi-label">{s}</span>
            <span className="qm-kpi-value">{summary[s] || 0}</span>
          </button>
        ))}
      </div>

      <div className="qm-card">
        <div className="qm-toolbar">
          <strong style={{ fontSize: 14 }}>Samples{stageFilter ? ` · ${stageFilter}` : ''}</strong>
          <div className="qm-toolbar-right">
            <input className="qm-input" style={{ width: 200 }} placeholder="Search ID, patient, location" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="qm-input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={1}>Today + open</option><option value={7}>Last 7 days + open</option><option value={30}>Last 30 days + open</option>
            </select>
          </div>
        </div>
        <div className="qm-table-wrap">
          <table className="qm-table">
            <thead><tr><th>Sample ID</th><th>Patient</th><th>Tests</th><th>Stage</th><th>Location</th><th>Accessioned</th><th>Last update</th></tr></thead>
            <tbody>
              {samples.length === 0 && <tr><td colSpan={7} className="qm-empty">No samples to show.</td></tr>}
              {samples.map((s) => (
                <tr key={s.sample_id} className="st-row" onClick={() => open(s.sample_id)}>
                  <td className="st-sampleid sm">{s.parent_sample_id ? <span className="st-arrow">↳ </span> : null}{s.sample_id}</td>
                  <td>{s.patient_name || '—'}</td>
                  <td className="qm-sub" style={{ maxWidth: 240 }}>{s.tests || '—'}</td>
                  <td><span className={stageClass(s.stage)}>{s.stage}</span></td>
                  <td>{s.location || '—'}</td>
                  <td>{fmt(s.accessioned_at)}</td>
                  <td>{fmt(s.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
