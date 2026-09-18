import { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '';
const POLL_MS  = 30_000;
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

// ─── helpers ─────────────────────────────────────────────────────────────────
function fmtDuration(ms) {
  if (ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60)  return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function fmtAgo(ts) {
  if (!ts) return 'Never';
  return fmtDuration(Date.now() - new Date(ts)) + ' ago';
}

function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function buildOfflineDurations(logs) {
  const byMachine = {};
  logs.forEach(l => { (byMachine[l.machine_id] = byMachine[l.machine_id] || []).push(l); });
  const result = {};
  for (const events of Object.values(byMachine)) {
    const asc = [...events].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    for (let i = 0; i < asc.length; i++) {
      if (asc[i].event !== 'OFFLINE') continue;
      const offAt = new Date(asc[i].created_at);
      let nextOn = null;
      for (let j = i + 1; j < asc.length; j++) {
        if (asc[j].event === 'ONLINE') { nextOn = asc[j]; break; }
      }
      const dur = nextOn ? new Date(nextOn.created_at) - offAt : Date.now() - offAt;
      result[asc[i].id] = (nextOn ? '' : '⏳ ') + fmtDuration(dur) + (nextOn ? '' : ' (ongoing)');
    }
  }
  return result;
}

function buildUptimes(logs) {
  const byMachine = {};
  logs.forEach(l => { (byMachine[l.machine_id] = byMachine[l.machine_id] || []).push(l); });
  const result = {};
  for (const [mid, events] of Object.entries(byMachine)) {
    const asc = [...events].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const window = Date.now() - new Date(asc[0].created_at);
    if (window <= 0) { result[mid] = 100; continue; }
    let onlineMs = 0, lastOnline = null;
    for (const e of asc) {
      if (e.event === 'ONLINE') { lastOnline = new Date(e.created_at); }
      else if (e.event === 'OFFLINE' && lastOnline) { onlineMs += new Date(e.created_at) - lastOnline; lastOnline = null; }
    }
    if (lastOnline) onlineMs += Date.now() - lastOnline;
    result[mid] = Math.min(100, Math.round((onlineMs / window) * 100));
  }
  return result;
}

function buildSparklines(logs) {
  const byMachine = {};
  logs.forEach(l => { (byMachine[l.machine_id] = byMachine[l.machine_id] || []).push(l); });
  const result = {};
  for (const [mid, events] of Object.entries(byMachine)) {
    result[mid] = [...events]
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .slice(-10).map(e => e.event);
  }
  return result;
}

// ─── sub-components ──────────────────────────────────────────────────────────
function StatusDot({ status }) {
  const map = {
    Online:  { bg: '#22c55e', ring: '#bbf7d0', label: 'Online',  text: '#166534', lbg: '#f0fdf4', border: '#bbf7d0' },
    Offline: { bg: '#ef4444', ring: null,       label: 'Offline', text: '#991b1b', lbg: '#fff1f2', border: '#fecaca' },
    Unknown: { bg: '#94a3b8', ring: null,       label: 'Unknown', text: '#475569', lbg: '#f8fafc', border: '#e2e8f0' },
  };
  const s = map[status] || map.Unknown;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 7,
      background: s.lbg, border: `1px solid ${s.border}`, fontSize: 11, fontWeight: 800, color: s.text }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.bg, display: 'inline-block',
        boxShadow: s.ring ? `0 0 0 3px ${s.ring}` : 'none' }} />
      {s.label}
    </span>
  );
}

function Sparkline({ events }) {
  if (!events?.length) return <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>;
  return (
    <div style={{ display: 'flex', gap: 3 }} title={events.join(' → ')}>
      {events.map((e, i) => (
        <div key={i} style={{ width: 9, height: 9, borderRadius: '50%',
          background: e === 'ONLINE' ? '#22c55e' : '#ef4444' }} />
      ))}
    </div>
  );
}

// ─── main ─────────────────────────────────────────────────────────────────────
export default function LabAnalyzerLogs() {
  // This is a branches.id, NOT a lab_machines.lab_id (which is actually an
  // infrastructure.id — a specific lab/department, and a branch can have
  // zero, one, or several). Sent as branch_id below; the backend resolves it
  // to the right infrastructure records rather than filtering lab_id against
  // it directly, which would silently match nothing (or the wrong lab) for
  // any branch whose id doesn't coincidentally equal a real infrastructure.id.
  const branchId = localStorage.getItem('branch_id');
  const labName = (() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').branch_name || 'This Lab'; } catch { return 'This Lab'; }
  })();

  const [stats,   setStats]   = useState(null);
  const [logs,    setLogs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState({ event: '', search: '' });
  // Diff Type / Department come from Machine Master (Settings > Machine
  // Master) — configured once per manufacturer+model, not per machine.
  const [machineFilter, setMachineFilter] = useState({ diff_type: '', department: '' });
  const timerRef = useRef(null);

  const fetchAll = async () => {
    try {
      const params = { limit: 500 };
      if (branchId) params.branch_id = branchId;

      const [sRes, lRes] = await Promise.all([
        axios.get(`${API_BASE}/api/lab/machine-stats`, { params: branchId ? { branch_id: branchId } : {}, headers: authHdr() }),
        axios.get(`${API_BASE}/api/lab/analyzer-logs`, { params, headers: authHdr() }),
      ]);
      if (sRes.data.success) setStats(sRes.data);
      if (lRes.data.success) setLogs(lRes.data.logs || []);
    } catch { /* non-critical */ }
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, []);

  const offlineDurations = useMemo(() => buildOfflineDurations(logs), [logs]);
  const uptimes          = useMemo(() => buildUptimes(logs),          [logs]);
  const sparklines       = useMemo(() => buildSparklines(logs),       [logs]);

  const filteredLogs = useMemo(() => logs.filter(l => {
    if (filter.event && l.event !== filter.event) return false;
    if (machineFilter.diff_type && (l.diff_type || 'N/A') !== machineFilter.diff_type) return false;
    if (machineFilter.department && (l.department || 'Unconfigured') !== machineFilter.department) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      return (l.machine_id||'').toLowerCase().includes(q)
          || (l.model||'').toLowerCase().includes(q)
          || (l.port||'').toLowerCase().includes(q);
    }
    return true;
  }), [logs, filter, machineFilter]);

  const filteredMachines = useMemo(() => (stats?.machines || []).filter(m => {
    if (machineFilter.diff_type && (m.diff_type || 'N/A') !== machineFilter.diff_type) return false;
    if (machineFilter.department && (m.department || 'Unconfigured') !== machineFilter.department) return false;
    return true;
  }), [stats, machineFilter]);

  const t = stats?.totals;

  return (
    <div style={{ padding: '28px 32px', background: '#f8fafc', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: '#0f172a', margin: 0 }}>Analyzer Connectivity</h1>
          <p style={{ color: '#64748b', margin: '4px 0 0', fontSize: 14 }}>
            {labName} &nbsp;·&nbsp; Live status of connected analyzers
            <span style={{ color: '#94a3b8' }}> · auto-refreshes every 30s</span>
          </p>
        </div>
        <button onClick={fetchAll}
          style={{ padding: '9px 18px', borderRadius: 9, background: '#fff', border: '1px solid #e2e8f0', fontWeight: 700, fontSize: 13, color: '#475569', cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Analyzers', value: t?.total   || 0, icon: '🔬', color: '#0f172a' },
          { label: 'Online',          value: t?.online  || 0, icon: '🟢', color: '#16a34a' },
          { label: 'Offline',         value: t?.offline || 0, icon: '🔴', color: '#dc2626' },
          { label: 'Tests Today',     value: (t?.tests_today || 0).toLocaleString(), icon: '🧪', color: '#7c3aed' },
        ].map(c => (
          <div key={c.label} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
            padding: '18px 22px', flex: 1, minWidth: 130, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{c.label}</div>
              <div style={{ fontSize: 30, fontWeight: 900, color: c.color, lineHeight: 1 }}>{loading ? '—' : c.value}</div>
            </div>
            <div style={{ fontSize: 24, opacity: 0.15 }}>{c.icon}</div>
          </div>
        ))}
      </div>

      {/* Machine status cards */}
      {!loading && (stats?.machines?.length > 0) && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', margin: 0 }}>Analyzers in This Lab</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={machineFilter.diff_type} onChange={e => setMachineFilter(f => ({ ...f, diff_type: e.target.value }))}
                style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontWeight: 600, fontSize: 12 }}>
                <option value="">All Diff Types</option>
                <option value="3-Part">3-Part</option>
                <option value="5-Part">5-Part</option>
                <option value="N/A">N/A</option>
              </select>
              <select value={machineFilter.department} onChange={e => setMachineFilter(f => ({ ...f, department: e.target.value }))}
                style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontWeight: 600, fontSize: 12 }}>
                <option value="">All Departments</option>
                {[...new Set((stats?.machines || []).map(m => m.department || 'Unconfigured'))].sort().map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {filteredMachines.map((m, i) => {
              const upt = uptimes[m.machine_id];
              const sparks = sparklines[m.machine_id];
              const uptColor = upt === undefined ? '#94a3b8' : upt >= 90 ? '#16a34a' : upt >= 70 ? '#d97706' : '#dc2626';
              return (
                <div key={i} style={{
                  background: '#fff', borderRadius: 12, border: `1px solid ${m.status === 'Offline' ? '#fecaca' : '#e2e8f0'}`,
                  padding: 18, display: 'flex', flexDirection: 'column', gap: 10,
                  background: m.status === 'Offline' ? '#fff8f8' : '#fff',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 800, color: '#1e40af', fontSize: 14 }}>{m.machine_id}</div>
                      <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{m.model || m.machine_name || '—'}</div>
                      {m.serial_number && <div style={{ fontSize: 10, color: '#94a3b8' }}>S/N: {m.serial_number}</div>}
                      {(m.diff_type || m.department) && (
                        <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                          {m.diff_type && <span style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: 6, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{m.diff_type}</span>}
                          {m.department && <span style={{ background: '#f0fdf4', color: '#166534', borderRadius: 6, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{m.department}</span>}
                        </div>
                      )}
                    </div>
                    <StatusDot status={m.status} />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Last Online</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', marginTop: 2 }}>{fmtAgo(m.last_online)}</div>
                      {m.last_online && <div style={{ fontSize: 10, color: '#94a3b8' }}>{fmtDateTime(m.last_online)}</div>}
                    </div>
                    <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Tests Today</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: m.tests_today > 0 ? '#7c3aed' : '#94a3b8', marginTop: 2 }}>
                        {m.tests_today || 0}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Uptime</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: uptColor }}>{upt !== undefined ? `${upt}%` : '—'}</span>
                    </div>
                    <Sparkline events={sparks} />
                  </div>

                  {m.status === 'Offline' && m.last_offline && (
                    <div style={{ background: '#fff1f2', border: '1px solid #fecaca', borderRadius: 7, padding: '6px 10px', fontSize: 11, color: '#991b1b', fontWeight: 600 }}>
                      ⚠️ Offline since {fmtDateTime(m.last_offline)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Connection log */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Connection Log</h2>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <select value={filter.event} onChange={e => setFilter(f => ({ ...f, event: e.target.value }))}
              style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontWeight: 600, fontSize: 12 }}>
              <option value="">All Events</option>
              <option value="ONLINE">Online</option>
              <option value="OFFLINE">Offline</option>
            </select>
            <div style={{ display: 'flex', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '4px 10px', alignItems: 'center' }}>
              <span style={{ color: '#94a3b8', marginRight: 6, fontSize: 12 }}>🔍</span>
              <input type="text" placeholder="Machine ID or port…" value={filter.search}
                onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 12, width: 160 }} />
            </div>
            <span style={{ fontSize: 11, color: '#94a3b8', alignSelf: 'center' }}>{filteredLogs.length} events</span>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Timestamp', 'Machine ID', 'Model', 'Port / IP', 'Event', 'Offline Duration'].map(h => (
                  <th key={h} style={{ padding: '10px 18px', fontSize: 11, fontWeight: 700, color: '#64748b',
                    textTransform: 'uppercase', textAlign: 'left', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading…</td></tr>
              ) : filteredLogs.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No events recorded yet.</td></tr>
              ) : filteredLogs.map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid #f8fafc', background: log.event === 'OFFLINE' ? '#fff8f8' : '#fff' }}>
                  <td style={{ padding: '10px 18px', fontSize: 12, color: '#475569', whiteSpace: 'nowrap' }}>{fmtDateTime(log.created_at)}</td>
                  <td style={{ padding: '10px 18px' }}>
                    <strong style={{ color: '#1e40af', fontSize: 13 }}>{log.machine_id}</strong>
                  </td>
                  <td style={{ padding: '10px 18px', fontSize: 12, color: '#475569' }}>{log.model || '—'}</td>
                  <td style={{ padding: '10px 18px', fontSize: 12, fontFamily: 'monospace', color: '#475569' }}>
                    {log.port || '—'}{log.ip_address && <div style={{ fontSize: 10, color: '#94a3b8' }}>{log.ip_address}</div>}
                  </td>
                  <td style={{ padding: '10px 18px' }}>
                    <span style={{
                      padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 800,
                      background: log.event === 'ONLINE' ? '#f0fdf4' : '#fff1f2',
                      color:      log.event === 'ONLINE' ? '#166534' : '#991b1b',
                      border: `1px solid ${log.event === 'ONLINE' ? '#bbf7d0' : '#fecaca'}`,
                    }}>
                      {log.event === 'ONLINE' ? '● ONLINE' : '○ OFFLINE'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 18px', fontSize: 12, fontWeight: 600 }}>
                    {log.event === 'OFFLINE'
                      ? <span style={{ color: offlineDurations[log.id]?.includes('ongoing') ? '#dc2626' : '#64748b' }}>
                          {offlineDurations[log.id] || '—'}
                        </span>
                      : <span style={{ color: '#94a3b8' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
