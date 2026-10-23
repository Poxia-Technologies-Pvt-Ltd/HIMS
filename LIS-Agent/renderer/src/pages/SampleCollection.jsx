import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Search, CheckCircle2, Printer, Droplet, CloudOff, Clock, TestTube2 } from 'lucide-react';
import useOfflineState from '../hooks/useOfflineState';
import { printSampleLabels } from '../utils/labelPrint';
import '../assets/CSS/Offline.css';

const ago = (iso) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ${m % 60} min ago`;
};
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// The sample collection desk, kept on this computer: today's orders are
// refreshed from the server while it is reachable, and an order can be marked
// collected (and its labels printed) with no network. The collection is sent
// to the server with the time it really happened as soon as the network is back.
export default function SampleCollection() {
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState({ snapshot_at: null, snapshot_error: null });
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState(null);
  const { online } = useOfflineState();
  const searchRef = useRef(search);
  const selectedRef = useRef(selectedId);

  const load = useCallback(async () => {
    const res = await window.electronAPI.offline.listOrders({ search: searchRef.current });
    setOrders(res.orders);
    setMeta({ snapshot_at: res.snapshot_at, snapshot_error: res.snapshot_error });
    if (selectedRef.current) setOrder(await window.electronAPI.offline.getOrder(selectedRef.current));
  }, []);

  useEffect(() => { searchRef.current = search; load().catch(() => {}); }, [search, load]);
  useEffect(() => { selectedRef.current = selectedId; load().catch(() => {}); }, [selectedId, load]);
  useEffect(() => {
    const off = window.electronAPI.offline.onUpdated(() => load().catch(() => {}));
    const poll = setInterval(() => load().catch(() => {}), 20000);
    return () => { off?.(); clearInterval(poll); };
  }, [load]);

  const refresh = async () => {
    setRefreshing(true); setMessage(null);
    const res = await window.electronAPI.offline.refreshOrders();
    if (!res.ok) setMessage({ kind: 'warn', text: `Could not refresh from the server (${res.message}). Showing the orders saved on this computer.` });
    await load();
    setRefreshing(false);
  };

  const collect = async () => {
    setBusy(true); setMessage(null);
    const res = await window.electronAPI.offline.collectOrder(selectedId);
    setBusy(false);
    if (!res.ok) { setMessage({ kind: 'error', text: res.message }); return; }
    setMessage(res.mode === 'offline'
      ? { kind: 'offline', text: 'Marked collected on this computer. It will be sent to the server automatically when the network is back.' }
      : { kind: 'ok', text: 'Marked collected.' });
    await load();
  };

  const labelsFor = (containers) => containers.filter((c) => c.sample_id).map((c) => ({
    sample_id: c.sample_id, patient_name: order.patient_name, tests: c.tests.map((t) => t.test_name),
  }));

  const pending = orders.filter((o) => !o.collected).length;

  return (
    <div className="page ofl-page">
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Sample Collection</h1>
          <p className="page-subtitle">Today's orders waiting at the collection desk. Works without the network — collections are saved here and synced when the server is reachable.</p>
        </div>
        <div className="page-actions">
          <span className={`badge ${online ? 'badge-success' : 'badge-danger'}`}><span className="badge-dot" />{online ? 'Online' : 'Offline'}</span>
          <button type="button" className="btn btn-secondary" onClick={refresh} disabled={refreshing || !online} title={online ? 'Fetch the latest orders' : 'Needs the network'}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} /> Refresh orders
          </button>
        </div>
      </div>

      <div className="ofl-fresh">
        <Clock size={13} /> Orders last updated <b>{ago(meta.snapshot_at)}</b>
        {!online && ' — a patient billed in the last couple of minutes may not be listed yet.'}
        {meta.snapshot_error && online && <span className="ofl-err-text"> · {meta.snapshot_error}</span>}
      </div>

      <div className="ofl-grid collect">
        <section className="card">
          <div className="card-header">
            <h3>Orders <span className="ofl-count">{pending} waiting</span></h3>
            <div className="ofl-search"><Search size={14} />
              <input value={search} placeholder="Name, CRN, bill or token" onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          {orders.length === 0 ? (
            <p className="ofl-empty">{meta.snapshot_at ? 'No orders for today.' : 'No orders saved on this computer yet. Connect to the network once and press Refresh orders.'}</p>
          ) : (
            <ul className="ofl-orders">
              {orders.map((o) => (
                <li key={o.bill_id}>
                  <button type="button" className={`ofl-order${selectedId === o.bill_id ? ' active' : ''}${o.collected ? ' done' : ''}`} onClick={() => { setSelectedId(o.bill_id); setMessage(null); }}>
                    <span className="ofl-token">{o.token_number || '—'}</span>
                    <span className="ofl-order-main">
                      <b>{o.patient_name}</b>
                      <small>{o.reg_no} · {o.tests.slice(0, 3).join(', ')}{o.tests.length > 3 ? ` +${o.tests.length - 3}` : ''}</small>
                    </span>
                    {o.priority && o.priority !== 'Routine' && <span className="badge badge-danger">{o.priority}</span>}
                    {o.collected
                      ? <span className={`badge ${o.collected_offline ? 'badge-warning' : 'badge-success'}`}>{o.collected_offline ? (o.sync_status === 'failed' ? 'Sync failed' : 'Collected · to sync') : 'Collected'}</span>
                      : <span className="badge badge-neutral">Waiting</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card ofl-detail">
          {!order ? (
            <div className="ofl-empty big"><TestTube2 size={34} /><p>Select an order to see its sample containers.</p></div>
          ) : (
            <>
              <div className="card-header">
                <div>
                  <h3>{order.patient_name}</h3>
                  <small className="ofl-sub">{order.reg_no}{order.gender ? ` · ${order.gender}` : ''} · bill {order.bill_number}{order.token_number ? ` · token ${order.token_number}` : ''}</small>
                </div>
              </div>
              <div className="card-body">
                {message && <div className={`ofl-msg ${message.kind}`}>{message.kind === 'offline' && <CloudOff size={15} />}{message.text}</div>}
                {order.clinical_notes && <div className="ofl-note">Clinical notes: {order.clinical_notes}</div>}
                <ul className="ofl-containers">
                  {order.containers.map((c) => (
                    <li key={c.sample_id || c.tests[0]?.bill_item_id}>
                      <span className="ofl-tube" style={{ background: c.tube_color || '#cbd5e1' }}><Droplet size={14} /></span>
                      <div className="ofl-container-main">
                        <b className="ofl-sample-id">{c.sample_id || 'No sample ID'}</b>
                        <small>{c.sample_type || 'Sample'}{c.tube_color ? ` · ${c.tube_color} tube` : ''}</small>
                        <div className="ofl-chips">{c.tests.map((t) => <span key={t.bill_item_id} className="ofl-chip">{t.test_name}</span>)}</div>
                      </div>
                      <span className={`badge ${c.stage === 'Accessioned' ? 'badge-neutral' : 'badge-success'}`}>{c.stage === 'Accessioned' ? 'Not collected' : 'Collected'}</span>
                    </li>
                  ))}
                </ul>

                {order.collected_offline && (
                  <div className={`ofl-msg ${order.sync_status === 'failed' ? 'error' : 'offline'}`}>
                    <CloudOff size={15} />
                    {order.sync_status === 'failed'
                      ? <>Collected at {clock(order.collected_offline_at)}, but the server did not accept it: {order.sync_error}. See Offline Queue.</>
                      : <>Collected at {clock(order.collected_offline_at)} — waiting to reach the server.</>}
                  </div>
                )}

                <div className="ofl-actions">
                  <button type="button" className="btn btn-secondary" disabled={!labelsFor(order.containers).length} onClick={() => printSampleLabels(labelsFor(order.containers))}>
                    <Printer size={14} /> Print labels ({labelsFor(order.containers).length})
                  </button>
                  <button type="button" className="btn btn-primary" onClick={collect} disabled={busy || order.collected}>
                    <CheckCircle2 size={14} /> {order.collected ? 'Collected' : busy ? 'Saving…' : 'Mark as collected'}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
