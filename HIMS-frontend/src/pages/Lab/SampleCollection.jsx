import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Printer, Merge, Split, Check, Search, Droplets } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { printSampleLabels } from '../../utils/sampleLabels';
import '../../assets/CSS/QueueManagement.css';
import '../../assets/CSS/SampleCollection.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}`, 'Content-Type': 'application/json' });
const POLL_MS = 15_000;
const branchId = () => localStorage.getItem('branch_id') || '';

const TUBE_COLORS = { purple: '#7c3aed', lavender: '#a78bfa', red: '#dc2626', yellow: '#eab308', gold: '#ca8a04', green: '#16a34a',
  blue: '#2563eb', 'light blue': '#38bdf8', grey: '#6b7280', gray: '#6b7280', black: '#111827', white: '#cbd5e1', pink: '#ec4899', orange: '#f97316' };
const tubeHex = (name) => TUBE_COLORS[String(name || '').toLowerCase().replace(/\s*tube$/, '').trim()] || '#94a3b8';
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// The barcode a collector sees on screen — same CODE128 (short ID) the printed label
// carries, so what they check against the tube is what will be scanned.
function Barcode({ value }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && value) JsBarcode(ref.current, value.slice(-4), { format: 'CODE128', width: 2, height: 46, displayValue: true, fontSize: 13, margin: 2 });
  }, [value]);
  return <svg ref={ref} className="sc-barcode" />;
}

// Sample Collection desk — the Sample Collector role's whole workspace:
// today's orders in queue order, one order's tests and containers, barcode
// reprint, and merging tests into a single container.
export default function SampleCollection() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('waiting');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [order, setOrder] = useState(null);
  const [picked, setPicked] = useState([]);       // bill_item_ids ticked for merging
  const [busy, setBusy] = useState(false);
  const [mergeNotice, setMergeNotice] = useState(null);

  const loadOrders = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (search.trim()) q.set('search', search.trim());
      if (branchId()) q.set('branch_id', branchId());
      const res = await fetch(`${API_BASE}/api/lab/collection/orders?${q}`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) setOrders(data.orders || []);
    } catch { /* keep last list */ }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { loadOrders(); const t = setInterval(loadOrders, POLL_MS); return () => clearInterval(t); }, [loadOrders]);

  const loadOrder = useCallback(async (billId) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab/collection/orders/${billId}${branchId() ? `?branch_id=${branchId()}` : ''}`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) setOrder(data.order); else showAlert(data.message, 'warning');
    } catch { showAlert('Network error.', 'error'); }
  }, [showAlert]);

  const select = (o) => { setSelectedId(o.bill_id); setPicked([]); setMergeNotice(null); loadOrder(o.bill_id); };

  const labelsFor = (containers) => containers.filter((c) => c.sample_id).map((c) => ({
    sample_id: c.sample_id, patient_name: order.patient_name, tests: c.tests.map((t) => t.test_name),
  }));

  // Every print from this desk is a reprint — logged, so the custody record
  // shows each time a label identifying a patient's blood was produced again.
  const print = async (containers) => {
    const labels = labelsFor(containers);
    if (labels.length === 0) return;
    if (!printSampleLabels(labels)) { showAlert('Allow pop-ups to print labels.', 'warning'); return; }
    await Promise.all(labels.map((l) => fetch(`${API_BASE}/api/lab/collection/reprint`, {
      method: 'POST', headers: authHdr(), body: JSON.stringify({ sample_id: l.sample_id, branch_id: branchId() || undefined }),
    }).catch(() => {})));
  };

  const togglePick = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const merge = async () => {
    if (picked.length < 2 || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/lab/merge-samples`, { method: 'POST', headers: authHdr(), body: JSON.stringify({ bill_item_ids: picked }) });
      const data = await res.json();
      if (data.success) {
        setMergeNotice({ sample_id: data.sample_id, released: data.released_sample_ids || [], tests: data.merged });
        setPicked([]);
        await loadOrder(selectedId);
        loadOrders();
      } else showAlert(data.message || 'Could not merge.', 'error');
    } catch { showAlert('Network error.', 'error'); }
    finally { setBusy(false); }
  };

  const split = async (billItemId) => {
    if (!window.confirm('Give this test its own container and barcode again?')) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/lab/unmerge-sample`, { method: 'POST', headers: authHdr(), body: JSON.stringify({ bill_item_id: billItemId }) });
      const data = await res.json();
      if (data.success) { showAlert(data.message, 'success'); setMergeNotice(null); await loadOrder(selectedId); loadOrders(); }
      else showAlert(data.message || 'Could not split.', 'error');
    } catch { showAlert('Network error.', 'error'); }
    finally { setBusy(false); }
  };

  const collect = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/lab/collection/orders/${selectedId}/collect`, {
        method: 'POST', headers: authHdr(), body: JSON.stringify({ branch_id: branchId() || undefined }),
      });
      const data = await res.json();
      if (data.success) { showAlert(data.message, 'success'); setOrder(data.order); loadOrders(); }
      else showAlert(data.message || 'Could not update.', 'error');
    } catch { showAlert('Network error.', 'error'); }
    finally { setBusy(false); }
  };

  const shown = orders.filter((o) => (filter === 'all' ? true : filter === 'collected' ? o.collected : !o.collected));
  const waiting = orders.filter((o) => !o.collected).length;
  const allCollected = order?.containers?.every((c) => c.stage && c.stage !== 'Accessioned');

  return (
    <div className="qm-page sc-page">
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={3500} />}

      <div className="qm-header">
        <div>
          <h1>Sample Collection</h1>
          <p>Today's patients in queue order. Open a patient to see their tests, reprint barcodes, or combine tests into one container.</p>
        </div>
        <button className="qm-btn qm-btn-ghost" onClick={loadOrders}><RefreshCw size={14} />Refresh</button>
      </div>

      <div className="sc-layout">
        {/* ── Patient list ── */}
        <aside className="qm-card sc-list">
          <div className="sc-list-head">
            <div className="sc-search"><Search size={14} /><input placeholder="Name, reg no, token" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <div className="sc-filter">
              {[['waiting', `Waiting (${waiting})`], ['collected', 'Collected'], ['all', 'All']].map(([k, l]) => (
                <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="sc-rows">
            {loading && <div className="sc-empty">Loading…</div>}
            {!loading && shown.length === 0 && <div className="sc-empty">No patients here.</div>}
            {shown.map((o) => (
              <button key={o.bill_id} className={`sc-row${selectedId === o.bill_id ? ' active' : ''}${o.collected ? ' done' : ''}`} onClick={() => select(o)}>
                <span className="sc-token">{o.token_number ?? '–'}</span>
                <span className="sc-row-main">
                  <b>{o.patient_name}</b>
                  <small>{o.reg_no} · {fmtTime(o.created_at)}</small>
                </span>
                <span className="sc-row-side">
                  {o.recollections > 0 && <span className="sc-recollect-badge">Recollect</span>}
                  {o.priority !== 'Routine' && <span className={`qm-pri qm-pri-${o.priority.toLowerCase()}`}>{o.priority}</span>}
                  <span className="sc-count">{o.test_count} test{o.test_count !== 1 ? 's' : ''}</span>
                  {o.collected && <Check size={14} className="sc-tick" />}
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* ── Order detail ── */}
        <section className="sc-detail">
          {!order && <div className="qm-card sc-placeholder"><Droplets size={30} /><p>Select a patient to see their tests and barcodes.</p></div>}

          {order && (
            <>
              <div className="qm-card sc-head">
                <div className="sc-head-main">
                  {order.token_number && <div className="sc-bigtoken"><small>Token</small>{order.token_number}</div>}
                  <div>
                    <h2>{order.patient_name}</h2>
                    <div className="qm-sub">{order.reg_no}{order.gender ? ` · ${order.gender}` : ''}</div>
                  </div>
                  {order.priority !== 'Routine' && <span className={`qm-pri qm-pri-${order.priority.toLowerCase()}`}>{order.priority}</span>}
                </div>
                <div className="sc-summary">
                  <span><b>{order.tests}</b> test{order.tests !== 1 ? 's' : ''}</span>
                  <span><b>{order.containers.length}</b> container{order.containers.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="sc-head-actions">
                  <button className="qm-btn qm-btn-ghost" onClick={() => print(order.containers)}><Printer size={14} />Print all labels</button>
                  <button className="qm-btn qm-btn-success" onClick={collect} disabled={busy || allCollected}>
                    <Check size={14} />{allCollected ? 'Collected' : 'Mark collected'}
                  </button>
                </div>
                {order.clinical_notes && <div className="sc-notes">Clinical notes: {order.clinical_notes}</div>}
              </div>

              {mergeNotice && (
                <div className="sc-notice">
                  <b>Tests combined.</b> Use barcode <b>{mergeNotice.sample_id}</b> for the shared container — print it below.
                  {mergeNotice.released.length > 0 && <> Discard the other label{mergeNotice.released.length > 1 ? 's' : ''}: {mergeNotice.released.map((r) => r.slice(-4)).join(', ')}.</>}
                </div>
              )}

              <div className="sc-hint">Tick two or more tests that can go in the same tube, then merge them.</div>

              <div className="sc-containers">
                {order.containers.map((c) => (
                  <div key={c.sample_id || c.tests[0].bill_item_id} className={`qm-card sc-container${c.sample_id === mergeNotice?.sample_id ? ' fresh' : ''}`}>
                    {c.recollection && (
                      <div className="sc-recollect">
                        <b>Recollection required</b> — previous sample {c.recollection.of.slice(-4)} rejected: {c.recollection.reason}. Draw a fresh specimen and use this new barcode.
                      </div>
                    )}
                    <div className="sc-container-barcode">
                      {c.sample_id ? <><div className="sc-fullid">{c.sample_id}</div><Barcode value={c.sample_id} /></> : <div className="qm-sub">No barcode yet</div>}
                      <div className="sc-container-meta">
                        <span className={`st-stage st-stage-${(c.stage || 'Accessioned').toLowerCase()}`}>{c.stage || 'Accessioned'}</span>
                        {c.merged && <span className="sc-merged">Shared container</span>}
                      </div>
                    </div>
                    <ul className="sc-tests">
                      {c.tests.map((t) => (
                        <li key={t.bill_item_id}>
                          <label className={t.has_result ? 'locked' : ''}>
                            <input type="checkbox" disabled={t.has_result || busy} checked={picked.includes(t.bill_item_id)} onChange={() => togglePick(t.bill_item_id)} />
                            <i className="sc-tube" style={{ background: tubeHex(t.tube_color) }} />
                            <span className="sc-test-name">{t.test_name}</span>
                            <small>{[t.sample_type, t.tube_color].filter(Boolean).join(' · ')}</small>
                          </label>
                          {c.merged && !t.has_result && (
                            <button className="sc-split" onClick={() => split(t.bill_item_id)} title="Give this test its own container" disabled={busy}><Split size={12} />Split</button>
                          )}
                        </li>
                      ))}
                    </ul>
                    <button className="qm-btn qm-btn-ghost" onClick={() => print([c])} disabled={!c.sample_id}><Printer size={13} />Print label</button>
                  </div>
                ))}
              </div>

              {picked.length > 0 && (
                <div className="sc-mergebar">
                  <span>{picked.length} test{picked.length !== 1 ? 's' : ''} selected</span>
                  <button className="qm-btn qm-btn-ghost" onClick={() => setPicked([])}>Clear</button>
                  <button className="qm-btn qm-btn-primary" onClick={merge} disabled={picked.length < 2 || busy}>
                    <Merge size={14} />{busy ? 'Merging…' : 'Merge into one container'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
