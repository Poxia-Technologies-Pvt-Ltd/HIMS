import { useState, useEffect, useCallback, useRef } from 'react';

const API = import.meta.env.VITE_API_URL || '';
const token = () => localStorage.getItem('hims_token');
const get = (path) =>
  fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token()}` } }).then((r) => r.json());

// ─── Helpers ────────────────────────────────────────────────────────────────

function age(dob) {
  if (!dob) return '—';
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

function initials(p) {
  return `${p.first_name?.[0] || ''}${p.last_name?.[0] || ''}`.toUpperCase() || '?';
}

function fmt(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function detectChronic(history) {
  const counts = {};
  for (const c of history) {
    const text = `${c.diagnosis || ''} ${(c.icd10_codes || []).map((x) => x.description || x.code || '').join(' ')}`;
    const words = text.match(/[A-Za-z]{4,}/g) || [];
    for (const w of words) {
      const key = w.toLowerCase();
      const stopWords = new Set(['with','that','this','from','have','been','were','will','your','they','their','there','when','then','also','some','more','only','into','over','after']);
      if (!stopWords.has(key)) counts[key] = (counts[key] || 0) + 1;
    }
    // ICD-10 descriptions
    for (const code of (c.icd10_codes || [])) {
      if (code.description) {
        const desc = code.description.replace(/[^a-zA-Z ]/g, '').toLowerCase();
        counts[desc] = (counts[desc] || 0) + 2;
      }
    }
  }
  const KNOWN_CHRONIC = {
    hypertension: 'Hypertension', diabetes: 'Diabetes', diabetic: 'Diabetes',
    asthma: 'Asthma', copd: 'COPD', arthritis: 'Arthritis', thyroid: 'Thyroid Disorder',
    epilepsy: 'Epilepsy', depression: 'Depression', anxiety: 'Anxiety',
    obesity: 'Obesity', anemia: 'Anaemia', anaemia: 'Anaemia',
    migraine: 'Migraine', ckd: 'CKD', renal: 'Renal Disease',
    cardiac: 'Cardiac Disease', heart: 'Heart Disease', liver: 'Liver Disease',
    hepatitis: 'Hepatitis', tuberculosis: 'Tuberculosis', hiv: 'HIV',
  };
  const found = new Set();
  for (const [key, count] of Object.entries(counts)) {
    if (count >= 2 && KNOWN_CHRONIC[key]) found.add(KNOWN_CHRONIC[key]);
  }
  return [...found];
}

function computeRisk(history, patient) {
  let score = 0;
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const recentVisits = history.filter((c) => new Date(c.consultation_date) >= sixMonthsAgo).length;
  if (recentVisits >= 4) score += 3;
  else if (recentVisits >= 2) score += 1;

  for (const c of history) {
    const v = c.vitals;
    if (v) {
      if (Number(v.bp_systolic) > 140 || Number(v.bp_diastolic) > 90) score += 2;
      if (Number(v.spo2) < 94) score += 2;
    }
    const diag = (c.diagnosis || '').toLowerCase();
    if (diag.includes('diabetes') || diag.includes('diabetic')) score += 2;
    if (diag.includes('cardiac') || diag.includes('heart failure')) score += 3;
    if (diag.includes('cancer') || diag.includes('malignant')) score += 4;
  }

  if (score >= 8) return { level: 'Critical', color: '#dc2626', bg: '#fee2e2' };
  if (score >= 5) return { level: 'High', color: '#ea580c', bg: '#ffedd5' };
  if (score >= 2) return { level: 'Medium', color: '#ca8a04', bg: '#fefce8' };
  return { level: 'Low', color: '#16a34a', bg: '#f0fdf4' };
}

function missedFollowUp(history) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const c of history) {
    if (!c.follow_up_date) continue;
    const fup = new Date(c.follow_up_date);
    fup.setHours(0, 0, 0, 0);
    if (fup < today) {
      const daysAgo = Math.floor((today - fup) / (24 * 60 * 60 * 1000));
      const hasVisitAfter = history.some(
        (h) => new Date(h.consultation_date) > fup
      );
      if (!hasVisitAfter) return { daysAgo, date: fmt(c.follow_up_date) };
    }
  }
  return null;
}

function medStatus(duration, consultation_date) {
  if (!duration || !consultation_date) return { label: 'Unknown', color: '#6b7280', bg: '#f3f4f6' };
  const days = parseInt(duration) || 0;
  const stop = new Date(consultation_date);
  stop.setDate(stop.getDate() + days);
  const today = new Date();
  if (stop < today) {
    const overdueDays = Math.floor((today - stop) / (24 * 60 * 60 * 1000));
    if (overdueDays > 14) return { label: 'Completed', color: '#16a34a', bg: '#dcfce7' };
    return { label: 'Overdue', color: '#ca8a04', bg: '#fefce8' };
  }
  return { label: 'Active', color: '#2563eb', bg: '#dbeafe' };
}

// ─── Pure-SVG sparkline ──────────────────────────────────────────────────────

function Sparkline({ values, color = '#3b82f6', width = 80, height = 28 }) {
  const nums = values.map(Number).filter((v) => !isNaN(v));
  if (nums.length < 2) return <span style={{ color: '#9ca3af', fontSize: 11 }}>—</span>;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const pts = nums
    .map((v, i) => {
      const x = (i / (nums.length - 1)) * (width - 4) + 2;
      const y = height - 4 - ((v - min) / range) * (height - 8);
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts.split(' ').pop().split(',')[0]} cy={pts.split(' ').pop().split(',')[1]} r="2.5" fill={color} />
    </svg>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function DoctorPatientSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [chart, setChart] = useState(null);
  const [history, setHistory] = useState([]);
  const [trends, setTrends] = useState({});
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('overview');
  const debounce = useRef(null);

  const search = useCallback((q) => {
    clearTimeout(debounce.current);
    if (!q.trim()) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await get(`/api/patients/search?q=${encodeURIComponent(q)}`);
        setResults(data.patients || data || []);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  useEffect(() => { search(query); }, [query, search]);

  async function selectPatient(p) {
    setSelected(p);
    setTab('overview');
    setLoading(true);
    setChart(null);
    setHistory([]);
    setTrends({});
    try {
      const [chartData, histData, trendData] = await Promise.all([
        get(`/api/patients/${p.reg_no}/chart`),
        get(`/api/consultations/patient/${p.reg_no}/history`),
        get(`/api/consultations/patient/${p.reg_no}/lab-trends`),
      ]);
      setChart(chartData.patient || p);
      setHistory(histData.history || []);
      setTrends(trendData.trends || {});
    } finally {
      setLoading(false);
    }
  }

  function whatsappSummary() {
    if (!chart || !history.length) return;
    const last = history[0];
    const msg = `Patient Summary\n---\nName: ${chart.first_name} ${chart.last_name}\nAge: ${age(chart.dob)} | Gender: ${chart.gender}\nReg No: ${chart.reg_no}\nLast Visit: ${fmt(last.consultation_date)}\nDiagnosis: ${last.diagnosis || '—'}\nDoctor: ${last.doctor || '—'}\nGenerated by HIMS`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  }

  const chronic = history.length ? detectChronic(history) : [];
  const risk = history.length ? computeRisk(history, chart) : null;
  const missed = history.length ? missedFollowUp(history) : null;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)', background: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
      <style>{`
        .dps-search-input { border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; font-size: 14px; width: 100%; outline: none; transition: border 0.2s; background: #fff; }
        .dps-search-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
        .dps-patient-card { padding: 12px; border-radius: 10px; cursor: pointer; border: 1.5px solid transparent; transition: all 0.15s; background: #fff; margin-bottom: 8px; }
        .dps-patient-card:hover { border-color: #3b82f6; box-shadow: 0 2px 8px rgba(59,130,246,0.1); }
        .dps-patient-card.active { border-color: #3b82f6; background: #eff6ff; }
        .dps-tab { padding: 8px 16px; border: none; background: none; cursor: pointer; font-size: 13px; font-weight: 500; color: #6b7280; border-bottom: 2px solid transparent; transition: all 0.15s; white-space: nowrap; }
        .dps-tab.active { color: #2563eb; border-bottom-color: #2563eb; }
        .dps-tab:hover:not(.active) { color: #374151; }
        .dps-btn { padding: 7px 14px; border-radius: 8px; border: none; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
        .dps-btn-primary { background: #2563eb; color: #fff; }
        .dps-btn-primary:hover { background: #1d4ed8; }
        .dps-btn-outline { background: #fff; color: #374151; border: 1.5px solid #e2e8f0; }
        .dps-btn-outline:hover { border-color: #3b82f6; color: #2563eb; }
        .dps-accordion-trigger { width: 100%; text-align: left; border: none; background: none; cursor: pointer; padding: 14px 16px; font-size: 13px; font-weight: 500; display: flex; align-items: center; justify-content: space-between; }
        .dps-accordion-trigger:hover { background: #f8fafc; }
        .dps-chip { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; margin: 2px; }
        .dps-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
        .dps-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .dps-table th { background: #f1f5f9; padding: 9px 12px; text-align: left; font-size: 12px; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0; }
        .dps-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #374151; vertical-align: middle; }
        .dps-table tr:hover td { background: #f8fafc; }
        .dps-section-title { font-size: 12px; font-weight: 700; color: #94a3b8; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 10px; }
        .dps-card-inner { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
        .scroll { overflow-y: auto; }
        .scroll::-webkit-scrollbar { width: 4px; }
        .scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
      `}</style>

      {/* ── LEFT: Search Panel ── */}
      <div style={{ width: 300, minWidth: 280, borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', background: '#fff' }}>
        <div style={{ padding: '16px 14px 12px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 10 }}>Patient Records</div>
          <div style={{ position: 'relative' }}>
            <svg style={{ position: 'absolute', left: 10, top: 10, opacity: 0.4 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input
              className="dps-search-input"
              style={{ paddingLeft: 32 }}
              placeholder="Name, phone, reg no..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        <div className="scroll" style={{ flex: 1, padding: '10px 10px' }}>
          {searching && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Searching...</div>}
          {!searching && !results.length && query && (
            <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No patients found</div>
          )}
          {!searching && !query && (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <svg style={{ opacity: 0.25, margin: '0 auto 10px', display: 'block' }} width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <div style={{ color: '#94a3b8', fontSize: 13 }}>Search to find a patient</div>
            </div>
          )}
          {results.map((p) => {
            const isActive = selected?.reg_no === p.reg_no;
            return (
              <div key={p.reg_no || p.id} className={`dps-patient-card${isActive ? ' active' : ''}`} onClick={() => selectPatient(p)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: isActive ? '#dbeafe' : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: isActive ? '#2563eb' : '#64748b', flexShrink: 0, overflow: 'hidden' }}>
                    {p.photo_base64
                      ? <img src={p.photo_base64} alt="" style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover' }} />
                      : initials(p)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.first_name} {p.last_name}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{p.reg_no} · {p.gender} · {age(p.dob)} yrs</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{p.telephone}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT: Patient Chart ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
            <svg style={{ opacity: 0.18 }} width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1"><path d="M9 11H4a2 2 0 00-2 2v7"/><path d="M20 11h-5"/><rect x="6" y="13" width="12" height="6" rx="1"/><path d="M12 4v8M9 7l3-3 3 3"/></svg>
            <div style={{ color: '#94a3b8', fontSize: 15, fontWeight: 500 }}>Select a patient to view their chart</div>
          </div>
        ) : (
          <>
            {/* Patient header */}
            <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '14px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18, color: '#2563eb', flexShrink: 0, overflow: 'hidden' }}>
                  {(chart || selected).photo_base64
                    ? <img src={(chart || selected).photo_base64} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} />
                    : initials(chart || selected)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 17, fontWeight: 700, color: '#1e293b' }}>{(chart || selected).first_name} {(chart || selected).middle_name ? (chart || selected).middle_name + ' ' : ''}{(chart || selected).last_name}</span>
                    {risk && <span className="dps-badge" style={{ background: risk.bg, color: risk.color }}>Risk: {risk.level}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                    {(chart || selected).reg_no} · {(chart || selected).gender} · {age((chart || selected).dob)} yrs · {(chart || selected).telephone}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="dps-btn dps-btn-outline" onClick={whatsappSummary} title="Share via WhatsApp">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 5, verticalAlign: 'middle' }}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    Share
                  </button>
                  <button className="dps-btn dps-btn-primary" onClick={() => window.open(`/doctor-dashboard`, '_self')}>
                    Start Consultation
                  </button>
                </div>
              </div>
              {missed && (
                <div style={{ marginTop: 10, padding: '8px 14px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, fontSize: 12, color: '#c2410c', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 15 }}>⚠️</span> Missed follow-up scheduled for {missed.date} — {missed.daysAgo} day{missed.daysAgo !== 1 ? 's' : ''} overdue
                </div>
              )}
            </div>

            {/* Tabs */}
            <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 0, paddingLeft: 12, overflowX: 'auto' }}>
              {['overview', 'consultations', 'rx', 'labs', 'vitals', 'billing'].map((t) => (
                <button key={t} className={`dps-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                  {{ overview: 'Overview', consultations: 'Consultations', rx: 'Prescriptions', labs: 'Labs', vitals: 'Vitals', billing: 'Billing' }[t]}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="scroll" style={{ flex: 1, padding: '18px 20px' }}>
              {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading chart...</div>
              ) : (
                <>
                  {tab === 'overview' && <OverviewTab chart={chart || selected} history={history} chronic={chronic} risk={risk} />}
                  {tab === 'consultations' && <ConsultationsTab history={history} />}
                  {tab === 'rx' && <RxTab history={history} />}
                  {tab === 'labs' && <LabsTab trends={trends} />}
                  {tab === 'vitals' && <VitalsTab history={history} />}
                  {tab === 'billing' && <BillingTab regNo={(chart || selected).reg_no} />}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Overview ───────────────────────────────────────────────────────────

function OverviewTab({ chart, history, chronic, risk }) {
  const last = history[0];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      {/* Demographics */}
      <div className="dps-card-inner">
        <p className="dps-section-title">Demographics</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
          {[
            ['Date of Birth', chart.dob ? fmt(chart.dob) : '—'],
            ['Blood Group', chart.blood_group || '—'],
            ['Email', chart.email_id || '—'],
            ['Address', [chart.address, chart.city, chart.country].filter(Boolean).join(', ') || '—'],
            ['Kin Name', chart.kin_name || '—'],
            ['Kin Contact', chart.kin_telephone || '—'],
            ['Insurance', chart.payer_type === 'Insurance' ? chart.insurance_provider || 'Insurance' : chart.payer_type || '—'],
          ].map(([label, val]) => (
            <div key={label}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{label}</div>
              <div style={{ color: '#1e293b', marginTop: 1, wordBreak: 'break-word' }}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Clinical Snapshot */}
      <div className="dps-card-inner">
        <p className="dps-section-title">Clinical Snapshot</p>
        {risk && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 4 }}>RISK SCORE</div>
            <span className="dps-badge" style={{ background: risk.bg, color: risk.color, fontSize: 13 }}>● {risk.level} Risk</span>
          </div>
        )}
        {chronic.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>CHRONIC CONDITIONS</div>
            <div>{chronic.map((c) => <span key={c} className="dps-chip" style={{ background: '#fee2e2', color: '#991b1b' }}>{c}</span>)}</div>
          </div>
        )}
        {last && (
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 4 }}>LAST VISIT</div>
            <div style={{ fontSize: 13, color: '#1e293b' }}>{fmt(last.consultation_date)}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{last.diagnosis || '—'}</div>
            {last.doctor && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>Dr. {last.doctor}</div>}
          </div>
        )}
        {!history.length && <div style={{ color: '#94a3b8', fontSize: 13 }}>No consultation history</div>}
      </div>

      {/* Last vitals */}
      {history[0]?.vitals && (
        <div className="dps-card-inner">
          <p className="dps-section-title">Latest Vitals ({fmt(history[0].consultation_date)})</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              ['BP', history[0].vitals.bp_systolic && history[0].vitals.bp_diastolic ? `${history[0].vitals.bp_systolic}/${history[0].vitals.bp_diastolic}` : '—', 'mmHg'],
              ['SpO2', history[0].vitals.spo2 || '—', '%'],
              ['Pulse', history[0].vitals.pulse || '—', 'bpm'],
              ['Weight', history[0].vitals.weight || '—', 'kg'],
              ['Temp', history[0].vitals.temperature || '—', '°F'],
              ['Height', history[0].vitals.height || '—', 'cm'],
            ].map(([label, val, unit]) => (
              <div key={label} style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginTop: 2 }}>{val}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>{unit}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Visit frequency */}
      <div className="dps-card-inner">
        <p className="dps-section-title">Visit Summary</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            ['Total Visits', history.length],
            ['Last 6 Months', history.filter((c) => new Date(c.consultation_date) >= new Date(Date.now() - 180 * 86400000)).length],
            ['With Prescription', history.filter((c) => c.prescriptions?.length > 0).length],
            ['With Lab Orders', history.filter((c) => c.labOrders?.length > 0).length],
          ].map(([label, val]) => (
            <div key={label} style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#1e293b' }}>{val}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Consultations ──────────────────────────────────────────────────────

function ConsultationsTab({ history }) {
  const [open, setOpen] = useState(null);
  if (!history.length) return <Empty msg="No consultations found" />;
  return (
    <div>
      {history.map((c) => (
        <div key={c.id} className="dps-card-inner" style={{ padding: 0, overflow: 'hidden' }}>
          <button className="dps-accordion-trigger" onClick={() => setOpen(open === c.id ? null : c.id)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{fmt(c.consultation_date || c.appt_date)}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>{c.diagnosis || 'No diagnosis'} {c.department ? `· ${c.department}` : ''}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {(c.icd10_codes || []).slice(0, 2).map((x, i) => (
                <span key={i} className="dps-chip" style={{ background: '#eff6ff', color: '#1d4ed8' }}>{x.code || x}</span>
              ))}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{ transform: open === c.id ? 'rotate(180deg)' : 'none', transition: '0.2s' }}><polyline points="6 9 12 15 18 9"/></svg>
            </div>
          </button>
          {open === c.id && (
            <div style={{ padding: '0 16px 16px', borderTop: '1px solid #f1f5f9' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                {[
                  ['Chief Complaints', c.chief_complaints],
                  ['Subjective (History)', c.soap_history],
                  ['Objective (Examination)', c.soap_exam],
                  ['Assessment / Diagnosis', c.diagnosis],
                  ['Plan / Instructions', c.patient_instructions || c.doctor_notes],
                  ['Follow-up Date', fmt(c.follow_up_date)],
                ].map(([label, val]) => val ? (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                    <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{val}</div>
                  </div>
                ) : null)}
              </div>
              {c.prescriptions?.length > 0 && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: '#f8fafc', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>MEDICINES ({c.prescriptions.length})</div>
                  {c.prescriptions.map((rx, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#374151', marginBottom: 3 }}>• {rx.medicine_name} {rx.dosage} — {rx.frequency} × {rx.duration}</div>
                  ))}
                </div>
              )}
              {c.labOrders?.length > 0 && (
                <div style={{ marginTop: 8, padding: '10px 14px', background: '#f0fdf4', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>LAB ORDERS ({c.labOrders.length})</div>
                  {c.labOrders.map((lo, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#374151', marginBottom: 3 }}>• {lo.test_name} {lo.urgency ? `[${lo.urgency}]` : ''}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Tab: Prescriptions ──────────────────────────────────────────────────────

function RxTab({ history }) {
  const all = history.flatMap((c) =>
    (c.prescriptions || []).map((rx) => ({ ...rx, consultation_date: c.consultation_date }))
  );
  if (!all.length) return <Empty msg="No prescriptions found" />;
  return (
    <table className="dps-table">
      <thead>
        <tr><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Route</th><th>Duration</th><th>Status</th><th>Date</th></tr>
      </thead>
      <tbody>
        {all.map((rx, i) => {
          const s = medStatus(rx.duration, rx.consultation_date);
          return (
            <tr key={i}>
              <td style={{ fontWeight: 500 }}>{rx.medicine_name}</td>
              <td>{rx.dosage || '—'}</td>
              <td>{rx.frequency || '—'}</td>
              <td>{rx.route || '—'}</td>
              <td>{rx.duration ? `${rx.duration} days` : '—'}</td>
              <td><span className="dps-badge" style={{ background: s.bg, color: s.color }}>{s.label}</span></td>
              <td style={{ color: '#94a3b8' }}>{fmt(rx.consultation_date)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Tab: Labs ───────────────────────────────────────────────────────────────

function LabsTab({ trends }) {
  const entries = Object.entries(trends);
  if (!entries.length) return <Empty msg="No lab results found" />;
  return (
    <table className="dps-table">
      <thead>
        <tr><th>Test</th><th>Latest</th><th>Previous Values</th><th>Ref Range</th><th>Trend</th><th>Status</th></tr>
      </thead>
      <tbody>
        {entries.map(([testName, results]) => {
          const [latest, ...prev] = results;
          const allValues = results.map((r) => r.result_value);
          const nums = allValues.map(Number).filter((v) => !isNaN(v));
          const trendDir = nums.length >= 2 ? (nums[0] > nums[1] ? '↑' : nums[0] < nums[1] ? '↓' : '→') : '→';
          const trendColor = trendDir === '↑' ? '#16a34a' : trendDir === '↓' ? '#dc2626' : '#94a3b8';
          return (
            <tr key={testName}>
              <td style={{ fontWeight: 500 }}>{testName}</td>
              <td style={{ fontWeight: 600, color: '#1e293b' }}>{latest.result_value} {latest.result_unit}</td>
              <td style={{ color: '#64748b' }}>{prev.slice(0, 2).map((r) => `${r.result_value}${r.result_unit ? ' ' + r.result_unit : ''}`).join(' · ') || '—'}</td>
              <td style={{ color: '#94a3b8', fontSize: 12 }}>{latest.reference_range || '—'}</td>
              <td>
                {nums.length >= 2 && <Sparkline values={nums.slice(0, 5).reverse()} color={trendColor} />}
                <span style={{ marginLeft: 4, fontWeight: 700, color: trendColor }}>{trendDir}</span>
              </td>
              <td>
                <span className="dps-badge" style={{
                  background: latest.status === 'Approved' ? '#dcfce7' : latest.status === 'Rejected' ? '#fee2e2' : '#fefce8',
                  color: latest.status === 'Approved' ? '#166534' : latest.status === 'Rejected' ? '#991b1b' : '#854d0e',
                }}>{latest.status || 'Pending'}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Tab: Vitals ─────────────────────────────────────────────────────────────

function VitalsTab({ history }) {
  const withVitals = history.filter((c) => c.vitals).slice(0, 10);
  if (!withVitals.length) return <Empty msg="No vitals recorded" />;

  const bpSys = withVitals.map((c) => c.vitals.bp_systolic).filter(Boolean).reverse();
  const wt = withVitals.map((c) => c.vitals.weight).filter(Boolean).reverse();
  const spo2 = withVitals.map((c) => c.vitals.spo2).filter(Boolean).reverse();

  return (
    <div>
      {/* Sparkline summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 16 }}>
        {[
          { label: 'BP Systolic (mmHg)', values: bpSys, color: '#ef4444', warn: (v) => v > 140 },
          { label: 'Weight (kg)', values: wt, color: '#8b5cf6', warn: () => false },
          { label: 'SpO2 (%)', values: spo2, color: '#06b6d4', warn: (v) => v < 94 },
        ].map(({ label, values, color, warn }) => {
          const last = values[values.length - 1];
          return (
            <div key={label} className="dps-card-inner">
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>{label.toUpperCase()}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: last && warn(Number(last)) ? '#dc2626' : '#1e293b' }}>{last || '—'}</div>
              <div style={{ marginTop: 8 }}><Sparkline values={values.map(Number)} color={color} width={100} height={32} /></div>
            </div>
          );
        })}
      </div>

      {/* Full vitals table */}
      <table className="dps-table">
        <thead>
          <tr><th>Date</th><th>BP</th><th>SpO2</th><th>Pulse</th><th>Temp</th><th>Weight</th><th>Height</th></tr>
        </thead>
        <tbody>
          {withVitals.map((c, i) => {
            const v = c.vitals;
            const bpHigh = Number(v.bp_systolic) > 140 || Number(v.bp_diastolic) > 90;
            return (
              <tr key={i}>
                <td style={{ color: '#94a3b8' }}>{fmt(c.consultation_date)}</td>
                <td style={{ color: bpHigh ? '#dc2626' : undefined, fontWeight: bpHigh ? 600 : undefined }}>{v.bp_systolic && v.bp_diastolic ? `${v.bp_systolic}/${v.bp_diastolic}` : '—'}</td>
                <td style={{ color: Number(v.spo2) < 94 ? '#dc2626' : undefined }}>{v.spo2 || '—'}</td>
                <td>{v.pulse || '—'}</td>
                <td>{v.temperature || '—'}</td>
                <td>{v.weight || '—'}</td>
                <td>{v.height || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Tab: Billing ─────────────────────────────────────────────────────────────

function BillingTab({ regNo }) {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    get(`/api/billing/patient/${regNo}`)
      .then((d) => setBills(d.bills || []))
      .catch(() => setBills([]))
      .finally(() => setLoading(false));
  }, [regNo]);

  if (loading) return <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>Loading...</div>;
  if (!bills.length) return <Empty msg="No billing records found" />;

  const total = bills.reduce((s, b) => s + Number(b.total_amount || 0), 0);
  const outstanding = bills.filter((b) => b.payment_status !== 'Paid').reduce((s, b) => s + Number(b.total_amount || 0), 0);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 16 }}>
        {[
          { label: 'Total Bills', val: bills.length },
          { label: 'Total Spent', val: `₹${total.toLocaleString('en-IN')}` },
          { label: 'Outstanding', val: `₹${outstanding.toLocaleString('en-IN')}`, warn: outstanding > 0 },
        ].map(({ label, val, warn }) => (
          <div key={label} className="dps-card-inner" style={{ borderColor: warn ? '#fca5a5' : undefined }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: warn ? '#dc2626' : '#1e293b' }}>{val}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>
      <div>
        {bills.map((b) => (
          <div key={b.id} className="dps-card-inner" style={{ padding: 0, overflow: 'hidden', marginBottom: 8 }}>
            <button className="dps-accordion-trigger" onClick={() => setOpen(open === b.id ? null : b.id)}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Bill #{b.id} · {fmt(b.created_at)}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>₹{Number(b.total_amount).toLocaleString('en-IN')}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="dps-badge" style={{
                  background: b.payment_status === 'Paid' ? '#dcfce7' : b.payment_status === 'Partial' ? '#fefce8' : '#fee2e2',
                  color: b.payment_status === 'Paid' ? '#166534' : b.payment_status === 'Partial' ? '#854d0e' : '#991b1b',
                }}>{b.payment_status || 'Pending'}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{ transform: open === b.id ? 'rotate(180deg)' : 'none', transition: '0.2s' }}><polyline points="6 9 12 15 18 9"/></svg>
              </div>
            </button>
            {open === b.id && b.items && (
              <div style={{ padding: '0 16px 12px', borderTop: '1px solid #f1f5f9' }}>
                {b.items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid #f8fafc' }}>
                    <span>{it.service_name} {it.quantity > 1 ? `×${it.quantity}` : ''}</span>
                    <span style={{ fontWeight: 500 }}>₹{Number(it.total_price || it.unit_price).toLocaleString('en-IN')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function Empty({ msg }) {
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <svg style={{ opacity: 0.2, margin: '0 auto 12px', display: 'block' }} width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8M12 8v8"/></svg>
      <div style={{ color: '#94a3b8', fontSize: 13 }}>{msg}</div>
    </div>
  );
}
