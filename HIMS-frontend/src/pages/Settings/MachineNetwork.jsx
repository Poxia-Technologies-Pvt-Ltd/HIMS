import { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { Download, RefreshCw, LifeBuoy, X } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import '../../assets/CSS/MachineNetwork.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const POLL_MS  = 30_000;
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });
const OFFLINE_ALERT_HOURS = 2;

const BRAND_COLORS = ['#3b82f6','#8b5cf6','#06b6d4','#f59e0b','#10b981','#ef4444','#ec4899'];
const PIE_COLORS   = { Online: '#22c55e', Offline: '#ef4444', Unknown: '#94a3b8' };

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
function fmtAgo(ts) { return ts ? fmtDuration(Date.now() - new Date(ts)) + ' ago' : 'Never'; }
function fmtDT(ts)  { return ts ? new Date(ts).toLocaleString([], { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'; }

function buildOfflineDurations(logs) {
  const byM = {};
  logs.forEach(l => { (byM[l.machine_id] = byM[l.machine_id] || []).push(l); });
  const res = {};
  for (const evts of Object.values(byM)) {
    const asc = [...evts].sort((a,b) => new Date(a.created_at)-new Date(b.created_at));
    for (let i = 0; i < asc.length; i++) {
      if (asc[i].event !== 'OFFLINE') continue;
      const offAt = new Date(asc[i].created_at);
      let nextOn = null;
      for (let j = i+1; j < asc.length; j++) { if (asc[j].event==='ONLINE'){nextOn=asc[j];break;} }
      const dur = nextOn ? new Date(nextOn.created_at)-offAt : Date.now()-offAt;
      res[asc[i].id] = (nextOn?'':'⏳ ') + fmtDuration(dur) + (nextOn?'':' (ongoing)');
    }
  }
  return res;
}

function buildUptimes(logs) {
  const byM = {};
  logs.forEach(l => { (byM[l.machine_id] = byM[l.machine_id] || []).push(l); });
  const res = {};
  for (const [mid, evts] of Object.entries(byM)) {
    const asc = [...evts].sort((a,b) => new Date(a.created_at)-new Date(b.created_at));
    const win = Date.now() - new Date(asc[0].created_at);
    if (win <= 0) { res[mid]=100; continue; }
    let onMs=0, lastOn=null;
    for (const e of asc) {
      if (e.event==='ONLINE') { lastOn=new Date(e.created_at); }
      else if (e.event==='OFFLINE'&&lastOn) { onMs+=new Date(e.created_at)-lastOn; lastOn=null; }
    }
    if (lastOn) onMs+=Date.now()-lastOn;
    res[mid] = Math.min(100, Math.round((onMs/win)*100));
  }
  return res;
}

function buildSparklines(logs) {
  const byM = {};
  logs.forEach(l => { (byM[l.machine_id] = byM[l.machine_id] || []).push(l); });
  const res = {};
  for (const [mid, evts] of Object.entries(byM)) {
    res[mid] = [...evts].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).slice(-8).map(e=>e.event);
  }
  return res;
}

// ─── small components ─────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active||!payload?.length) return null;
  return (
    <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:8, padding:'10px 14px', fontSize:12, boxShadow:'0 4px 12px #0001' }}>
      <div style={{ fontWeight:700, marginBottom:4 }}>{label}</div>
      {payload.map(p=><div key={p.name} style={{color:p.color}}>{p.name}: <strong>{p.value}</strong></div>)}
    </div>
  );
};

function StatusBadge({ status }) {
  const s = { Online:{bg:'#f0fdf4',c:'#166534',b:'#bbf7d0',dot:'#22c55e'}, Offline:{bg:'#fff1f2',c:'#991b1b',b:'#fecaca',dot:'#ef4444'}, Unknown:{bg:'#f8fafc',c:'#475569',b:'#e2e8f0',dot:'#94a3b8'} }[status]||{bg:'#f8fafc',c:'#475569',b:'#e2e8f0',dot:'#94a3b8'};
  return <span style={{ background:s.bg, color:s.c, border:`1px solid ${s.b}`, borderRadius:7, padding:'4px 10px', fontSize:11, fontWeight:800, display:'inline-flex', alignItems:'center', gap:5 }}>
    <span style={{ width:7, height:7, borderRadius:'50%', background:s.dot, display:'inline-block', boxShadow:status==='Online'?`0 0 0 2px ${s.dot}44`:undefined }} />
    {status}
  </span>;
}

function Sparkline({ events }) {
  if (!events?.length) return <span style={{color:'#94a3b8',fontSize:11}}>—</span>;
  return <div style={{display:'flex',gap:3}}>{events.map((e,i)=><div key={i} style={{width:9,height:9,borderRadius:'50%',background:e==='ONLINE'?'#22c55e':'#ef4444'}}/>)}</div>;
}

function MiniBar({ value, max, color }) {
  const pct = max>0 ? Math.round((value/max)*100) : 0;
  return <div style={{display:'flex',alignItems:'center',gap:8}}>
    <div style={{flex:1,height:6,background:'#f1f5f9',borderRadius:4,overflow:'hidden'}}>
      <div style={{width:`${pct}%`,height:'100%',background:color||'#3b82f6',borderRadius:4}}/>
    </div>
    <span style={{fontSize:12,fontWeight:700,color:'#475569',minWidth:24}}>{value}</span>
  </div>;
}

// ─── main ─────────────────────────────────────────────────────────────────────
export default function MachineNetwork() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [stats,   setStats]   = useState(null);
  const [logs,    setLogs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState('overview');
  const [logFilter, setLogFilter] = useState({ event:'', search:'' });
  // Diff Type / Department come from Machine Master (Settings > Machine
  // Master) — configured once per manufacturer+model, not per machine —
  // see labMachineController.js getMachineStats/getAnalyzerLogs.
  const [machineFilter, setMachineFilter] = useState({ diff_type:'', department:'' });

  // support ticket state
  const [showSupport, setShowSupport] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [supportForm, setSupportForm] = useState({ issueType:'Machine Fault', description:'' });
  const [tickets, setTickets] = useState([
    { id:'TKT-1001', machineId:'M-103', machineName:'Merilyzer CelQuant 5 Plus', branch:'Central Hospital', category:'Maintenance Required', status:'Pending', date:'2026-04-29', description:'Monthly preventive calibration required.' }
  ]);

  const timerRef = useRef(null);

  const fetchAll = async () => {
    try {
      const [sRes, lRes] = await Promise.all([
        axios.get(`${API_BASE}/api/lab/machine-stats`, { headers: authHdr() }),
        axios.get(`${API_BASE}/api/lab/analyzer-logs`, { params: { limit: 1000 }, headers: authHdr() }),
      ]);
      if (sRes.data.success) setStats(sRes.data);
      if (lRes.data.success) setLogs(lRes.data.logs || []);
    } catch { /* */ }
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, []);

  const offlineDurations = useMemo(() => buildOfflineDurations(logs), [logs]);
  const uptimes          = useMemo(() => buildUptimes(logs),          [logs]);
  const sparklines       = useMemo(() => buildSparklines(logs),        [logs]);

  const longOffline = useMemo(() => (stats?.machines||[]).filter(m =>
    m.status==='Offline' && m.last_offline && (Date.now()-new Date(m.last_offline)) > OFFLINE_ALERT_HOURS*3_600_000
  ), [stats]);

  const avgUptime = useMemo(() => {
    const vals = Object.values(uptimes);
    return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length)+'%' : '—';
  }, [uptimes]);

  const filteredLogs = useMemo(() => logs.filter(l => {
    if (logFilter.event && l.event!==logFilter.event) return false;
    if (machineFilter.diff_type && (l.diff_type||'N/A')!==machineFilter.diff_type) return false;
    if (machineFilter.department && (l.department||'Unconfigured')!==machineFilter.department) return false;
    if (logFilter.search) {
      const q = logFilter.search.toLowerCase();
      return (l.machine_id||'').toLowerCase().includes(q)
          || (l.model||'').toLowerCase().includes(q)
          || (l.lab_name||'').toLowerCase().includes(q)
          || (l.port||'').toLowerCase().includes(q);
    }
    return true;
  }), [logs, logFilter, machineFilter]);

  const filteredMachines = useMemo(() => (stats?.machines||[]).filter(m => {
    if (machineFilter.diff_type && (m.diff_type||'N/A')!==machineFilter.diff_type) return false;
    if (machineFilter.department && (m.department||'Unconfigured')!==machineFilter.department) return false;
    return true;
  }), [stats, machineFilter]);

  const pieData = stats ? [
    { name:'Online',  value: Number(stats.totals.online)  || 0 },
    { name:'Offline', value: Number(stats.totals.offline) || 0 },
    { name:'Unknown', value: Number(stats.totals.unknown) || 0 },
  ].filter(d=>d.value>0) : [];

  const maxBrand      = Math.max(1, ...(stats?.brands||[]).map(b=>Number(b.total)));
  const maxModel      = Math.max(1, ...(stats?.models||[]).map(m=>Number(m.total)));
  const maxDepartment = Math.max(1, ...(stats?.departments||[]).map(d=>Number(d.total)));

  // Diff Type values are now department-scoped (Machine Master's
  // DEPARTMENT_DIFF_TYPES) — derive the filter's options from what's
  // actually configured rather than a hardcoded 3-Part/5-Part list.
  const diffTypeOptions = useMemo(() =>
    [...new Set((stats?.machines||[]).map(m=>m.diff_type||'N/A'))].sort()
  , [stats]);
  const t = stats?.totals;

  const handleExportAll = () => {
    const rows = [['Machine ID','Model','Brand','Lab','Status','Uptime%','LastOnline','LastOffline','TestsToday']];
    (stats?.machines||[]).forEach(m => rows.push([
      m.machine_id, m.model, m.brand, m.lab_name, m.status,
      uptimes[m.machine_id]??'—',
      m.last_online ? new Date(m.last_online).toLocaleString() : '—',
      m.last_offline ? new Date(m.last_offline).toLocaleString() : '—',
      m.tests_today,
    ]));
    const blob = new Blob([rows.map(r=>r.join(',')).join('\n')], {type:'text/csv'});
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=`jharkhand_analyzers_${new Date().toISOString().split('T')[0]}.csv`; a.click();
  };

  const handleSupportSubmit = (e) => {
    e.preventDefault();
    if (!supportForm.description.trim()) { showAlert('error','Please provide a description.'); return; }
    setTickets([{
      id:`TKT-${Math.floor(1000+Math.random()*9000)}`,
      machineId: selectedMachine.machine_id,
      machineName: selectedMachine.model||selectedMachine.machine_id,
      branch: selectedMachine.lab_name,
      category: supportForm.issueType,
      status:'Open',
      date: new Date().toISOString().split('T')[0],
      description: supportForm.description,
    }, ...tickets]);
    setShowSupport(false);
    showAlert('success',`Support ticket raised for ${selectedMachine.machine_id}`);
  };

  const tabStyle = (id) => ({
    padding:'10px 20px', borderRadius:8, fontWeight:700, fontSize:13, border:'none', cursor:'pointer',
    background: tab===id ? '#1e40af' : '#f1f5f9',
    color:      tab===id ? '#fff'    : '#475569',
    transition:'all .15s',
  });

  if (loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'60vh',flexDirection:'column',gap:12}}>
      <div style={{width:40,height:40,borderRadius:'50%',border:'4px solid #e2e8f0',borderTopColor:'#3b82f6',animation:'spin .8s linear infinite'}}/>
      <div style={{color:'#94a3b8',fontWeight:600}}>Loading Jharkhand network…</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{ padding:'28px 32px', background:'#f8fafc', minHeight:'100vh' }}>
      {alert && <Alert type={alert.type} message={alert.message} onClose={hideAlert} />}

      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:900,color:'#0f172a',margin:0}}>Machine Network — Jharkhand</h1>
          <p style={{color:'#64748b',margin:'4px 0 0',fontSize:14}}>
            Central view of all lab analyzers across every facility &nbsp;·&nbsp;
            <span style={{color:'#94a3b8'}}>auto-refreshes every 30s</span>
          </p>
        </div>
        <div style={{display:'flex',gap:10}}>
          <button onClick={fetchAll} style={{display:'flex',alignItems:'center',gap:6,padding:'9px 16px',borderRadius:9,background:'#fff',border:'1px solid #e2e8f0',fontWeight:700,fontSize:13,color:'#475569',cursor:'pointer'}}>
            <RefreshCw size={14}/> Refresh
          </button>
          <button onClick={handleExportAll} style={{display:'flex',alignItems:'center',gap:6,padding:'9px 16px',borderRadius:9,background:'#1e40af',border:'none',fontWeight:700,fontSize:13,color:'#fff',cursor:'pointer'}}>
            <Download size={14}/> Export CSV
          </button>
        </div>
      </div>

      {/* Alert banner */}
      {longOffline.length > 0 && (
        <div style={{background:'#fff1f2',border:'1px solid #fecaca',borderRadius:10,padding:'12px 18px',marginBottom:20,display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:18}}>🔴</span>
          <div>
            <strong style={{color:'#991b1b'}}>{longOffline.length} analyzer{longOffline.length>1?'s':''} offline &gt; {OFFLINE_ALERT_HOURS}h</strong>
            <div style={{fontSize:12,color:'#b91c1c',marginTop:2}}>
              {longOffline.map(m=>`${m.machine_id} (${m.lab_name})`).join(' · ')}
            </div>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div style={{display:'flex',gap:14,marginBottom:24,flexWrap:'wrap'}}>
        {[
          { label:'Total Analyzers',    value: t?.total||0,                              color:'#0f172a', icon:'🔬' },
          { label:'Online Now',         value: t?.online||0,                             color:'#16a34a', icon:'🟢', sub:'currently connected' },
          { label:'Offline Now',        value: t?.offline||0,                            color:'#dc2626', icon:'🔴', sub: longOffline.length ? `${longOffline.length} > ${OFFLINE_ALERT_HOURS}h` : undefined },
          { label:'Avg Network Uptime', value: avgUptime,                               color:'#2563eb', icon:'📶' },
          { label:'Tests Run Today',    value: (t?.tests_today||0).toLocaleString(),     color:'#7c3aed', icon:'🧪' },
          { label:'Labs / Facilities',  value: stats?.labs?.length||0,                  color:'#0891b2', icon:'🏥' },
        ].map(c => (
          <div key={c.label} style={{background:'#fff',borderRadius:13,border:'1px solid #e2e8f0',padding:'18px 22px',flex:1,minWidth:130}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:5}}>{c.label}</div>
                <div style={{fontSize:30,fontWeight:900,color:c.color,lineHeight:1}}>{c.value}</div>
                {c.sub && <div style={{fontSize:10,color:'#94a3b8',marginTop:3}}>{c.sub}</div>}
              </div>
              <div style={{fontSize:24,opacity:.15}}>{c.icon}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:8,marginBottom:20}}>
        {[['overview','Overview & Charts'],['machines','Machine Health'],['logs','Connection Logs'],['support','Support Tickets']].map(([id,label]) => (
          <button key={id} style={tabStyle(id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab==='overview' && <>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 280px',gap:16,marginBottom:20}}>
          {/* Brand bar chart */}
          <div style={{background:'#fff',borderRadius:14,border:'1px solid #e2e8f0',padding:'20px 16px'}}>
            <h3 style={{margin:'0 0 16px',fontSize:14,fontWeight:800}}>Brand-wise Analyzer Count</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats?.brands||[]} barSize={22} margin={{left:-20}}>
                <XAxis dataKey="brand" tick={{fontSize:11}}/>
                <YAxis allowDecimals={false} tick={{fontSize:11}}/>
                <Tooltip content={<CustomTooltip/>}/>
                <Legend wrapperStyle={{fontSize:11}}/>
                <Bar dataKey="online"  name="Online"  stackId="a" fill="#22c55e"/>
                <Bar dataKey="offline" name="Offline" stackId="a" fill="#ef4444" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Model bar chart */}
          <div style={{background:'#fff',borderRadius:14,border:'1px solid #e2e8f0',padding:'20px 16px'}}>
            <h3 style={{margin:'0 0 16px',fontSize:14,fontWeight:800}}>Model-wise Analyzer Count</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats?.models||[]} barSize={18} margin={{left:-20}}>
                <XAxis dataKey="model" tick={{fontSize:10}} interval={0} angle={-15} textAnchor="end" height={40}/>
                <YAxis allowDecimals={false} tick={{fontSize:11}}/>
                <Tooltip content={<CustomTooltip/>}/>
                <Legend wrapperStyle={{fontSize:11}}/>
                <Bar dataKey="online"  name="Online"  stackId="a" fill="#3b82f6"/>
                <Bar dataKey="offline" name="Offline" stackId="a" fill="#f87171" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Donut */}
          <div style={{background:'#fff',borderRadius:14,border:'1px solid #e2e8f0',padding:'20px 16px'}}>
            <h3 style={{margin:'0 0 8px',fontSize:14,fontWeight:800}}>Network Status</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={52} outerRadius={80}
                  dataKey="value" label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`}
                  labelLine={false} fontSize={11}>
                  {pieData.map(e=><Cell key={e.name} fill={PIE_COLORS[e.name]||'#94a3b8'}/>)}
                </Pie>
                <Tooltip/>
              </PieChart>
            </ResponsiveContainer>
            <div style={{display:'flex',justifyContent:'center',gap:12,flexWrap:'wrap'}}>
              {pieData.map(d=>(
                <div key={d.name} style={{display:'flex',alignItems:'center',gap:4,fontSize:11,fontWeight:700}}>
                  <div style={{width:10,height:10,borderRadius:'50%',background:PIE_COLORS[d.name]}}/>
                  {d.name}: {d.value}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Brand + Model tables */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>
          <div style={{background:'#fff',borderRadius:14,border:'1px solid #e2e8f0',overflow:'hidden'}}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid #f1f5f9'}}><h3 style={{margin:0,fontSize:14,fontWeight:800}}>Brand Breakdown</h3></div>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:'#f8fafc'}}>
                {['Brand','Count','Online','Offline'].map(h=><th key={h} style={{padding:'9px 16px',fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',textAlign:'left',borderBottom:'1px solid #e2e8f0'}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {(stats?.brands||[]).map((b,i)=>(
                  <tr key={i} style={{borderBottom:'1px solid #f8fafc'}}>
                    <td style={{padding:'10px 16px',fontWeight:700,color:'#1e293b',fontSize:13}}>
                      <span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:BRAND_COLORS[i%BRAND_COLORS.length],marginRight:8}}/>
                      {b.brand}
                    </td>
                    <td style={{padding:'10px 16px'}}><MiniBar value={Number(b.total)} max={maxBrand} color={BRAND_COLORS[i%BRAND_COLORS.length]}/></td>
                    <td style={{padding:'10px 16px',color:'#16a34a',fontWeight:700,fontSize:13}}>{b.online}</td>
                    <td style={{padding:'10px 16px',color:'#dc2626',fontWeight:700,fontSize:13}}>{b.offline}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{background:'#fff',borderRadius:14,border:'1px solid #e2e8f0',overflow:'hidden'}}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid #f1f5f9'}}><h3 style={{margin:0,fontSize:14,fontWeight:800}}>Model Breakdown</h3></div>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:'#f8fafc'}}>
                {['Model','Brand','Count','Online','Offline'].map(h=><th key={h} style={{padding:'9px 16px',fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',textAlign:'left',borderBottom:'1px solid #e2e8f0'}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {(stats?.models||[]).map((m,i)=>(
                  <tr key={i} style={{borderBottom:'1px solid #f8fafc'}}>
                    <td style={{padding:'10px 16px',fontWeight:700,fontSize:13}}>{m.model}</td>
                    <td style={{padding:'10px 16px',fontSize:12,color:'#64748b'}}>{m.brand}</td>
                    <td style={{padding:'10px 16px'}}><MiniBar value={Number(m.total)} max={maxModel} color="#3b82f6"/></td>
                    <td style={{padding:'10px 16px',color:'#16a34a',fontWeight:700,fontSize:13}}>{m.online}</td>
                    <td style={{padding:'10px 16px',color:'#dc2626',fontWeight:700,fontSize:13}}>{m.offline}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Department (category) breakdown — from Machine Master's per-model
            Department config, see getMachineStats' `departments` query. */}
        <div style={{background:'#fff',borderRadius:14,border:'1px solid #e2e8f0',overflow:'hidden',marginBottom:20}}>
          <div style={{padding:'14px 20px',borderBottom:'1px solid #f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <h3 style={{margin:0,fontSize:14,fontWeight:800}}>Department-wise Analyzer Count</h3>
            <span style={{fontSize:12,color:'#94a3b8'}}>{(stats?.departments||[]).length} categories</span>
          </div>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:'#f8fafc'}}>
              {['Department / Category','Count','Online','Offline'].map(h=><th key={h} style={{padding:'9px 16px',fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',textAlign:'left',borderBottom:'1px solid #e2e8f0'}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {(stats?.departments||[]).map((d,i)=>(
                <tr key={i} style={{borderBottom:'1px solid #f8fafc'}}>
                  <td style={{padding:'10px 16px',fontWeight:700,color: d.department==='Unconfigured' ? '#94a3b8' : '#1e293b',fontSize:13}}>
                    {d.department==='Unconfigured' && '⚠️ '}{d.department}
                  </td>
                  <td style={{padding:'10px 16px'}}><MiniBar value={Number(d.total)} max={maxDepartment} color={BRAND_COLORS[i%BRAND_COLORS.length]}/></td>
                  <td style={{padding:'10px 16px',color:'#16a34a',fontWeight:700,fontSize:13}}>{d.online}</td>
                  <td style={{padding:'10px 16px',color:'#dc2626',fontWeight:700,fontSize:13}}>{d.offline}</td>
                </tr>
              ))}
              {!(stats?.departments||[]).length && (
                <tr><td colSpan={4} style={{padding:30,textAlign:'center',color:'#94a3b8'}}>No department data yet — configure models in Machine Master.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Hospital / Lab-wise */}
        <div style={{background:'#fff',borderRadius:14,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{padding:'14px 20px',borderBottom:'1px solid #f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <h3 style={{margin:0,fontSize:14,fontWeight:800}}>Hospital / Lab-wise Machine Status — Jharkhand</h3>
            <span style={{fontSize:12,color:'#94a3b8'}}>{(stats?.labs||[]).length} facilities</span>
          </div>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:'#f8fafc'}}>
              {['Facility','Total','Online','Offline','Network Health'].map(h=><th key={h} style={{padding:'10px 20px',fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',textAlign:'left',borderBottom:'1px solid #e2e8f0'}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {(stats?.labs||[]).map((lab,i)=>{
                const pct = lab.total>0 ? Math.round((lab.online/lab.total)*100) : 0;
                const hc  = pct>=80 ? '#22c55e' : pct>=50 ? '#f59e0b' : '#ef4444';
                return (
                  <tr key={i} style={{borderBottom:'1px solid #f8fafc'}}>
                    <td style={{padding:'14px 20px'}}><div style={{fontWeight:700,color:'#1e293b',fontSize:13}}>🏥 {lab.lab_name}</div></td>
                    <td style={{padding:'14px 20px',fontWeight:900,fontSize:18,color:'#0f172a'}}>{lab.total}</td>
                    <td style={{padding:'14px 20px'}}><span style={{background:'#f0fdf4',color:'#16a34a',padding:'4px 10px',borderRadius:6,fontWeight:700,fontSize:13}}>{lab.online} Online</span></td>
                    <td style={{padding:'14px 20px'}}>
                      {lab.offline>0
                        ? <span style={{background:'#fff1f2',color:'#dc2626',padding:'4px 10px',borderRadius:6,fontWeight:700,fontSize:13}}>{lab.offline} Offline</span>
                        : <span style={{color:'#94a3b8',fontSize:12}}>None</span>}
                    </td>
                    <td style={{padding:'14px 20px',minWidth:180}}>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <div style={{flex:1,height:8,background:'#f1f5f9',borderRadius:4,overflow:'hidden'}}>
                          <div style={{width:`${pct}%`,height:'100%',background:hc,borderRadius:4,transition:'width .4s'}}/>
                        </div>
                        <span style={{fontSize:12,fontWeight:700,color:hc,minWidth:36}}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>}

      {/* ── MACHINE HEALTH ── */}
      {tab==='machines' && (
        <div style={{background:'#fff',borderRadius:14,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{padding:'14px 20px',borderBottom:'1px solid #f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
            <h3 style={{margin:0,fontSize:14,fontWeight:800}}>All Analyzers — Health Dashboard</h3>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <select value={machineFilter.diff_type} onChange={e=>setMachineFilter(f=>({...f,diff_type:e.target.value}))}
                style={{padding:'6px 10px',borderRadius:6,border:'1px solid #cbd5e1',fontSize:12}}>
                <option value="">All Diff Types</option>
                {diffTypeOptions.map(dt=><option key={dt} value={dt}>{dt}</option>)}
              </select>
              <select value={machineFilter.department} onChange={e=>setMachineFilter(f=>({...f,department:e.target.value}))}
                style={{padding:'6px 10px',borderRadius:6,border:'1px solid #cbd5e1',fontSize:12}}>
                <option value="">All Departments</option>
                {[...new Set((stats?.machines||[]).map(m=>m.department||'Unconfigured'))].sort().map(d=>(
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <span style={{fontSize:12,color:'#94a3b8'}}>{filteredMachines.length} devices</span>
            </div>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',minWidth:1000}}>
              <thead><tr style={{background:'#f8fafc'}}>
                {['Machine ID','Model','Brand','Diff Type','Department','Lab / Facility','Status','Uptime %','Last Online','Last Offline','Tests Today','Activity',''].map(h=>(
                  <th key={h} style={{padding:'10px 14px',fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',textAlign:'left',borderBottom:'1px solid #e2e8f0',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filteredMachines.map((m,i)=>{
                  const upt = uptimes[m.machine_id];
                  const uc = upt===undefined?'#94a3b8':upt>=90?'#16a34a':upt>=70?'#d97706':'#dc2626';
                  return (
                    <tr key={i} style={{borderBottom:'1px solid #f8fafc',background:m.status==='Offline'?'#fff8f8':'#fff'}}>
                      <td style={{padding:'11px 14px'}}>
                        <div style={{fontWeight:800,color:'#1e40af',fontSize:13}}>{m.machine_id}</div>
                        {m.serial_number&&<div style={{fontSize:10,color:'#94a3b8'}}>S/N: {m.serial_number}</div>}
                      </td>
                      <td style={{padding:'11px 14px',fontSize:13,fontWeight:600}}>{m.model||'—'}</td>
                      <td style={{padding:'11px 14px',fontSize:12,color:'#475569'}}>{m.brand}</td>
                      <td style={{padding:'11px 14px',fontSize:12}}>
                        {m.diff_type
                          ? <span style={{background:'#eff6ff',color:'#1d4ed8',borderRadius:6,padding:'2px 8px',fontSize:11,fontWeight:700}}>{m.diff_type}</span>
                          : <span style={{color:'#cbd5e1'}}>—</span>}
                      </td>
                      <td style={{padding:'11px 14px',fontSize:12,color:'#475569'}}>{m.department||'—'}</td>
                      <td style={{padding:'11px 14px',fontSize:12,color:'#475569'}}>🏥 {m.lab_name}</td>
                      <td style={{padding:'11px 14px'}}><StatusBadge status={m.status}/></td>
                      <td style={{padding:'11px 14px'}}>
                        {upt!==undefined
                          ? <span style={{background:upt>=90?'#f0fdf4':upt>=70?'#fffbeb':'#fff1f2',color:uc,border:`1px solid ${uc}22`,borderRadius:6,padding:'3px 8px',fontSize:11,fontWeight:800}}>{upt}%</span>
                          : <span style={{color:'#94a3b8',fontSize:12}}>—</span>}
                      </td>
                      <td style={{padding:'11px 14px',fontSize:12,whiteSpace:'nowrap'}}>
                        <div style={{color:m.last_online?'#16a34a':'#94a3b8',fontWeight:600}}>{fmtAgo(m.last_online)}</div>
                        {m.last_online&&<div style={{fontSize:10,color:'#94a3b8'}}>{fmtDT(m.last_online)}</div>}
                      </td>
                      <td style={{padding:'11px 14px',fontSize:12,whiteSpace:'nowrap'}}>
                        <div style={{color:m.last_offline?'#dc2626':'#94a3b8',fontWeight:600}}>{fmtAgo(m.last_offline)}</div>
                        {m.last_offline&&<div style={{fontSize:10,color:'#94a3b8'}}>{fmtDT(m.last_offline)}</div>}
                      </td>
                      <td style={{padding:'11px 14px',fontWeight:900,fontSize:15,color:m.tests_today>0?'#7c3aed':'#94a3b8'}}>{m.tests_today||0}</td>
                      <td style={{padding:'11px 14px'}}><Sparkline events={sparklines[m.machine_id]}/></td>
                      <td style={{padding:'11px 14px'}}>
                        <button onClick={() => { setSelectedMachine(m); setSupportForm({issueType:'Machine Fault',description:''}); setShowSupport(true); }}
                          style={{display:'flex',alignItems:'center',gap:5,background:'#eff6ff',color:'#1d4ed8',border:'none',padding:'6px 10px',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer'}}>
                          <LifeBuoy size={12}/> Support
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!filteredMachines.length&&<tr><td colSpan={13} style={{padding:40,textAlign:'center',color:'#94a3b8'}}>No analyzers found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── CONNECTION LOGS ── */}
      {tab==='logs' && (
        <div style={{background:'#fff',borderRadius:14,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{padding:'13px 20px',borderBottom:'1px solid #f1f5f9',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
            <select value={logFilter.event} onChange={e=>setLogFilter(f=>({...f,event:e.target.value}))}
              style={{padding:'8px 12px',borderRadius:8,border:'1px solid #e2e8f0',fontWeight:600,fontSize:13}}>
              <option value="">All Events</option>
              <option value="ONLINE">Online</option>
              <option value="OFFLINE">Offline</option>
            </select>
            <select value={machineFilter.diff_type} onChange={e=>setMachineFilter(f=>({...f,diff_type:e.target.value}))}
              style={{padding:'8px 12px',borderRadius:8,border:'1px solid #e2e8f0',fontWeight:600,fontSize:13}}>
              <option value="">All Diff Types</option>
              {diffTypeOptions.map(dt=><option key={dt} value={dt}>{dt}</option>)}
            </select>
            <select value={machineFilter.department} onChange={e=>setMachineFilter(f=>({...f,department:e.target.value}))}
              style={{padding:'8px 12px',borderRadius:8,border:'1px solid #e2e8f0',fontWeight:600,fontSize:13}}>
              <option value="">All Departments</option>
              {[...new Set((stats?.machines||[]).map(m=>m.department||'Unconfigured'))].sort().map(d=>(
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <div style={{display:'flex',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,padding:'4px 12px',alignItems:'center',flex:1,maxWidth:300}}>
              <span style={{color:'#94a3b8',marginRight:8}}>🔍</span>
              <input type="text" placeholder="Machine ID, model, lab…" value={logFilter.search}
                onChange={e=>setLogFilter(f=>({...f,search:e.target.value}))}
                style={{border:'none',background:'transparent',outline:'none',fontSize:13,width:'100%'}}/>
            </div>
            <span style={{fontSize:12,color:'#94a3b8',marginLeft:'auto'}}>{filteredLogs.length} events</span>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',minWidth:800}}>
              <thead><tr style={{background:'#f8fafc'}}>
                {['Timestamp','Machine ID','Model','Lab','Port / IP','Event','Offline Duration'].map(h=>(
                  <th key={h} style={{padding:'10px 18px',fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',textAlign:'left',borderBottom:'1px solid #e2e8f0',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filteredLogs.length===0
                  ? <tr><td colSpan={7} style={{padding:40,textAlign:'center',color:'#94a3b8'}}>No events found.</td></tr>
                  : filteredLogs.map(log=>(
                  <tr key={log.id} style={{borderBottom:'1px solid #f8fafc',background:log.event==='OFFLINE'?'#fff8f8':'#fff'}}>
                    <td style={{padding:'10px 18px',fontSize:12,color:'#475569',whiteSpace:'nowrap'}}>{fmtDT(log.created_at)}</td>
                    <td style={{padding:'10px 18px'}}><strong style={{color:'#1e40af',fontSize:13}}>{log.machine_id}</strong></td>
                    <td style={{padding:'10px 18px',fontSize:13}}>{log.model||'—'}</td>
                    <td style={{padding:'10px 18px',fontSize:12,color:'#475569'}}>{log.lab_name||'—'}</td>
                    <td style={{padding:'10px 18px',fontSize:12,fontFamily:'monospace',color:'#475569'}}>
                      {log.port||'—'}{log.ip_address&&<div style={{fontSize:10,color:'#94a3b8'}}>{log.ip_address}</div>}
                    </td>
                    <td style={{padding:'10px 18px'}}>
                      <span style={{padding:'4px 10px',borderRadius:6,fontSize:11,fontWeight:800,
                        background:log.event==='ONLINE'?'#f0fdf4':'#fff1f2',
                        color:log.event==='ONLINE'?'#166534':'#991b1b',
                        border:`1px solid ${log.event==='ONLINE'?'#bbf7d0':'#fecaca'}`}}>
                        {log.event==='ONLINE'?'● ONLINE':'○ OFFLINE'}
                      </span>
                    </td>
                    <td style={{padding:'10px 18px',fontSize:12,fontWeight:600}}>
                      {log.event==='OFFLINE'
                        ? <span style={{color:offlineDurations[log.id]?.includes('ongoing')?'#dc2626':'#64748b'}}>{offlineDurations[log.id]||'—'}</span>
                        : <span style={{color:'#94a3b8'}}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SUPPORT TICKETS ── */}
      {tab==='support' && (
        <div style={{background:'#fff',borderRadius:14,border:'1px solid #e2e8f0',overflow:'hidden'}}>
          <div style={{padding:'14px 20px',borderBottom:'1px solid #f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <h3 style={{margin:0,fontSize:14,fontWeight:800}}>Support Tickets</h3>
            <span style={{fontSize:12,color:'#94a3b8'}}>{tickets.length} tickets</span>
          </div>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:'#f8fafc'}}>
              {['Ticket ID','Date','Machine','Lab / Branch','Category','Status'].map(h=>(
                <th key={h} style={{padding:'10px 20px',fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',textAlign:'left',borderBottom:'1px solid #e2e8f0'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {tickets.map(tk=>(
                <tr key={tk.id} style={{borderBottom:'1px solid #f8fafc'}}>
                  <td style={{padding:'12px 20px',fontWeight:700,color:'#1e40af'}}>{tk.id}</td>
                  <td style={{padding:'12px 20px',fontSize:12,color:'#475569'}}>{tk.date}</td>
                  <td style={{padding:'12px 20px',fontSize:13,fontWeight:600}}>{tk.machineId} — {tk.machineName}</td>
                  <td style={{padding:'12px 20px',fontSize:12,color:'#475569'}}>{tk.branch}</td>
                  <td style={{padding:'12px 20px',fontSize:12}}>{tk.category}</td>
                  <td style={{padding:'12px 20px'}}>
                    <span style={{padding:'4px 8px',borderRadius:6,fontSize:11,fontWeight:800,
                      background:tk.status==='Open'?'#fee2e2':'#fef3c7',
                      color:tk.status==='Open'?'#991b1b':'#92400e'}}>
                      {tk.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Support modal */}
      {showSupport && selectedMachine && (
        <div className="modal-overlay">
          <div className="modal-content" style={{maxWidth:500}}>
            <div className="modal-header">
              <h3>Create Support Ticket</h3>
              <button style={{border:'none',background:'transparent',cursor:'pointer',color:'#64748b'}} onClick={()=>setShowSupport(false)}>
                <X size={20}/>
              </button>
            </div>
            <form onSubmit={handleSupportSubmit}>
              <div className="modal-body">
                <div style={{padding:'12px',background:'#f8fafc',borderRadius:8,marginBottom:16,border:'1px solid #e2e8f0'}}>
                  <p style={{margin:0,fontSize:14,color:'var(--text-mid)'}}><strong>Machine:</strong> {selectedMachine.model||selectedMachine.machine_id} ({selectedMachine.machine_id})</p>
                  <p style={{margin:'4px 0 0',fontSize:13,color:'var(--text-soft)'}}><strong>Facility:</strong> {selectedMachine.lab_name}</p>
                </div>
                <div style={{marginBottom:16}}>
                  <label style={{display:'block',fontSize:13,fontWeight:600,marginBottom:8}}>Support Category *</label>
                  <select style={{width:'100%',padding:'10px',borderRadius:6,border:'1px solid var(--border-light)'}}
                    value={supportForm.issueType} onChange={e=>setSupportForm(p=>({...p,issueType:e.target.value}))}>
                    <option>Machine Fault / Hardware Error</option>
                    <option>Preventive Maintenance Required</option>
                    <option>Software / Integration Help</option>
                    <option>Reagents / Consumables Query</option>
                    <option>Other</option>
                  </select>
                </div>
                <div style={{marginBottom:16}}>
                  <label style={{display:'block',fontSize:13,fontWeight:600,marginBottom:8}}>Description *</label>
                  <textarea rows="4" required style={{width:'100%',padding:'10px',borderRadius:6,border:'1px solid var(--border-light)',resize:'vertical'}}
                    placeholder="Describe the issue…"
                    value={supportForm.description} onChange={e=>setSupportForm(p=>({...p,description:e.target.value}))}/>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" style={{background:'#e2e8f0',color:'#475569',border:'none',padding:'8px 16px',borderRadius:6,fontWeight:700,cursor:'pointer'}} onClick={()=>setShowSupport(false)}>Cancel</button>
                <button type="submit" style={{background:'var(--blue-primary)',color:'white',border:'none',padding:'8px 16px',borderRadius:6,fontWeight:700,cursor:'pointer'}}>Submit</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
