import { useState, useRef, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_BASE_URL || '';
const token = () => localStorage.getItem('hims_token');
const hdr = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

function age(dob) {
  if (!dob) return '—';
  const d = new Date(dob), n = new Date();
  let y = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) y--;
  return `${y} yrs`;
}

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Badge({ label, color }) {
  const colors = {
    green:  { bg: '#dcfce7', text: '#166534' },
    red:    { bg: '#fee2e2', text: '#991b1b' },
    blue:   { bg: '#dbeafe', text: '#1e40af' },
    yellow: { bg: '#fef9c3', text: '#854d0e' },
    grey:   { bg: '#f1f5f9', text: '#475569' },
  };
  const c = colors[color] || colors.grey;
  return (
    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:12, fontSize:11, fontWeight:600, background:c.bg, color:c.text }}>
      {label}
    </span>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display:'flex', gap:8, padding:'5px 0', borderBottom:'1px solid #f1f5f9' }}>
      <span style={{ width:140, flexShrink:0, fontSize:12, color:'#94a3b8', fontWeight:500 }}>{label}</span>
      <span style={{ fontSize:13, color:'#1e293b', fontWeight:500 }}>{value || '—'}</span>
    </div>
  );
}

export default function PhoneDemographicModal({ open, onClose }) {
  const [phone, setPhone]     = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState(null);
  const [error, setError]     = useState('');
  const [tab, setTab]         = useState('demographics');
  const [showAadhaar, setShowAadhaar] = useState(false);
  const inputRef              = useRef(null);
  const debounceRef           = useRef(null);

  useEffect(() => {
    if (open) {
      setPhone(''); setData(null); setError(''); setTab('demographics'); setShowAadhaar(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const lookup = useCallback(async (q) => {
    if (q.length < 5) { setData(null); setError(''); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch(`${API}/api/patients/phone-lookup/${encodeURIComponent(q)}`, { headers: hdr() });
      const json = await res.json();
      if (!json.success) { setError(json.message || 'Patient not found'); setData(null); }
      else setData(json);
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }, []);

  const onPhoneChange = (e) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 15);
    setPhone(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => lookup(v), 400);
  };

  if (!open) return null;

  const p = data?.patient;

  return (
    <>
      <style>{`
        .pdm-overlay {
          position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:9000;
          display:flex; align-items:flex-start; justify-content:flex-end;
          animation:pdmFade .18s ease;
        }
        @keyframes pdmFade { from{opacity:0} to{opacity:1} }
        .pdm-panel {
          width:480px; max-width:100vw; height:100vh; background:#fff;
          display:flex; flex-direction:column; box-shadow:-8px 0 32px rgba(0,0,0,0.18);
          animation:pdmSlide .22s ease;
        }
        @keyframes pdmSlide { from{transform:translateX(100%)} to{transform:translateX(0)} }
        .pdm-header {
          padding:18px 20px 14px; border-bottom:1px solid #e2e8f0;
          display:flex; align-items:center; gap:12px; background:#f8fafc;
        }
        .pdm-phone-input {
          flex:1; height:40px; border:1.5px solid #cbd5e1; border-radius:8px;
          padding:0 14px; font-size:15px; outline:none; font-family:monospace;
          letter-spacing:1px; transition:border .15s;
        }
        .pdm-phone-input:focus { border-color:#4f46e5; }
        .pdm-close {
          width:36px; height:36px; border:none; background:#f1f5f9; border-radius:8px;
          cursor:pointer; display:flex; align-items:center; justify-content:center;
          font-size:18px; color:#64748b;
        }
        .pdm-close:hover { background:#e2e8f0; }
        .pdm-body { flex:1; overflow-y:auto; padding:0; }
        .pdm-hero {
          padding:20px; background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);
          color:#fff; display:flex; gap:16px; align-items:center;
        }
        .pdm-avatar {
          width:72px; height:72px; border-radius:50%; border:3px solid rgba(255,255,255,.4);
          overflow:hidden; background:rgba(255,255,255,.2); display:flex;
          align-items:center; justify-content:center; font-size:28px; font-weight:700; flex-shrink:0;
        }
        .pdm-avatar img { width:100%; height:100%; object-fit:cover; }
        .pdm-name { font-size:20px; font-weight:700; margin-bottom:4px; }
        .pdm-sub { font-size:13px; opacity:.85; margin-bottom:8px; }
        .pdm-badges { display:flex; gap:6px; flex-wrap:wrap; }
        .pdm-badge-white {
          background:rgba(255,255,255,.2); color:#fff; padding:3px 10px;
          border-radius:12px; font-size:11px; font-weight:600;
        }
        .pdm-tabs {
          display:flex; border-bottom:1.5px solid #e2e8f0; background:#f8fafc;
        }
        .pdm-tab {
          flex:1; padding:10px 4px; font-size:12px; font-weight:600; cursor:pointer;
          border:none; background:none; color:#64748b; border-bottom:2.5px solid transparent;
          transition:all .15s; text-align:center;
        }
        .pdm-tab.active { color:#4f46e5; border-bottom-color:#4f46e5; }
        .pdm-tab:hover:not(.active) { color:#334155; background:#f1f5f9; }
        .pdm-section { padding:16px 20px; }
        .pdm-section-title {
          font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase;
          letter-spacing:.8px; margin:0 0 10px;
        }
        .pdm-card {
          background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;
          padding:12px 14px; margin-bottom:10px;
        }
        .pdm-card-title { font-size:13px; font-weight:600; color:#1e293b; margin-bottom:4px; }
        .pdm-card-sub { font-size:12px; color:#64748b; }
        .pdm-empty { text-align:center; padding:32px 20px; color:#94a3b8; font-size:13px; }
        .pdm-stat-row { display:flex; gap:8px; margin-bottom:16px; }
        .pdm-stat {
          flex:1; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;
          padding:12px; text-align:center;
        }
        .pdm-stat-val { font-size:22px; font-weight:700; color:#4f46e5; }
        .pdm-stat-lbl { font-size:11px; color:#94a3b8; margin-top:2px; }
      `}</style>

      <div className="pdm-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="pdm-panel">

          {/* Header — phone search */}
          <div className="pdm-header">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.01 1.18 2 2 0 012 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14v2.92z" />
            </svg>
            <input
              ref={inputRef}
              className="pdm-phone-input"
              type="tel"
              placeholder="Enter phone number…"
              value={phone}
              onChange={onPhoneChange}
              maxLength={15}
            />
            {loading && <span style={{fontSize:12,color:'#94a3b8'}}>…</span>}
            <button className="pdm-close" onClick={onClose}>✕</button>
          </div>

          <div className="pdm-body">
            {/* Empty / error states */}
            {!data && !loading && !error && (
              <div className="pdm-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" style={{margin:'0 auto 12px',display:'block'}}>
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.01 1.18 2 2 0 012 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14v2.92z" />
                </svg>
                Type a phone number to look up a patient
              </div>
            )}
            {error && (
              <div className="pdm-empty" style={{color:'#ef4444'}}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" strokeWidth="1.5" style={{margin:'0 auto 10px',display:'block'}}>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            {/* Patient found */}
            {p && (
              <>
                {/* Hero card */}
                <div className="pdm-hero">
                  <div className="pdm-avatar">
                    {p.photo_base64
                      ? <img src={p.photo_base64.startsWith('data:') ? p.photo_base64 : `data:image/jpeg;base64,${p.photo_base64}`} alt="patient" />
                      : (p.first_name?.[0] || '?')}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div className="pdm-name">{[p.title,p.first_name,p.middle_name,p.last_name].filter(Boolean).join(' ')}</div>
                    <div className="pdm-sub">{p.reg_no} &bull; {p.gender} &bull; {age(p.dob)} &bull; DOB: {fmt(p.dob)}</div>
                    <div className="pdm-badges">
                      {p.payer_type && <span className="pdm-badge-white">{p.payer_type}</span>}
                      {p.insurance_provider && <span className="pdm-badge-white">{p.insurance_provider}</span>}
                    </div>
                  </div>
                </div>

                {/* Quick stats */}
                <div style={{padding:'14px 20px 0'}}>
                  <div className="pdm-stat-row">
                    <div className="pdm-stat">
                      <div className="pdm-stat-val">{data.consultations?.length || 0}</div>
                      <div className="pdm-stat-lbl">Visits</div>
                    </div>
                    <div className="pdm-stat">
                      <div className="pdm-stat-val">{data.bills?.length || 0}</div>
                      <div className="pdm-stat-lbl">Bills</div>
                    </div>
                    <div className="pdm-stat">
                      <div className="pdm-stat-val">{data.labs?.length || 0}</div>
                      <div className="pdm-stat-lbl">Lab Results</div>
                    </div>
                  </div>
                </div>

                {/* Tabs */}
                <div className="pdm-tabs">
                  {['demographics','visits','bills','labs'].map(t => (
                    <button key={t} className={`pdm-tab ${tab===t?'active':''}`} onClick={() => setTab(t)}>
                      {t.charAt(0).toUpperCase()+t.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Demographics tab */}
                {tab === 'demographics' && (
                  <div className="pdm-section">
                    <p className="pdm-section-title">Personal</p>
                    <Row label="Full Name" value={[p.title,p.first_name,p.middle_name,p.last_name].filter(Boolean).join(' ')} />
                    <Row label="Date of Birth" value={fmt(p.dob)} />
                    <Row label="Gender" value={p.gender} />
                    <Row label="Marital Status" value={p.marital_status} />
                    <Row label="Occupation" value={p.occupation} />
                    <Row label="Religion" value={p.religion} />
                    <Row label="Nationality" value={p.citizen} />
                    <Row label="Language" value={p.language} />

                    <p className="pdm-section-title" style={{marginTop:14}}>Contact</p>
                    <Row label="Phone" value={p.telephone} />
                    <Row label="Email" value={p.email_id} />
                    <Row label="Address" value={[p.address,p.suburb,p.city,p.country,p.postal_code].filter(Boolean).join(', ')} />

                    <p className="pdm-section-title" style={{marginTop:14}}>Identity</p>
                    <Row label="Reg No" value={p.reg_no} />
                    <Row label="Reg Date" value={fmt(p.reg_date)} />
                    <Row
                      label="Aadhaar"
                      value={
                        p.aadhar_number ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            {showAadhaar ? p.aadhar_number : `XXXX-XXXX-${p.aadhar_number.slice(-4)}`}
                            <button
                              type="button"
                              onClick={() => setShowAadhaar(v => !v)}
                              style={{ border: 'none', background: 'none', color: '#4f46e5', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0 }}
                            >
                              {showAadhaar ? 'Hide' : 'Show'}
                            </button>
                          </span>
                        ) : null
                      }
                    />

                    <p className="pdm-section-title" style={{marginTop:14}}>Insurance / Payment</p>
                    <Row label="Payer Type" value={p.payer_type} />
                    <Row label="Provider" value={p.insurance_provider} />
                    <Row label="Policy No" value={p.policy_number} />

                    <p className="pdm-section-title" style={{marginTop:14}}>Next of Kin</p>
                    <Row label="Name" value={p.kin_name} />
                    <Row label="Relation" value={p.kin_relation} />
                    <Row label="Phone" value={p.kin_telephone} />
                  </div>
                )}

                {/* Visits tab */}
                {tab === 'visits' && (
                  <div className="pdm-section">
                    <p className="pdm-section-title">Recent Consultations</p>
                    {(!data.consultations?.length)
                      ? <div className="pdm-empty">No visit history</div>
                      : data.consultations.map(c => (
                          <div key={c.id} className="pdm-card">
                            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                              <span className="pdm-card-title">{c.diagnosis || c.chief_complaints || 'OPD Visit'}</span>
                              <Badge label={c.status || 'Pending'} color={c.status==='Completed'?'green':'yellow'} />
                            </div>
                            <div className="pdm-card-sub">
                              {c.department && <span>{c.department} &bull; </span>}
                              {c.doctor && <span>Dr. {c.doctor} &bull; </span>}
                              {fmt(c.created_at)}
                            </div>
                            {c.doctor_notes && <div style={{marginTop:6,fontSize:12,color:'#475569',background:'#f1f5f9',borderRadius:6,padding:'5px 8px'}}>{c.doctor_notes}</div>}
                          </div>
                        ))}
                  </div>
                )}

                {/* Bills tab */}
                {tab === 'bills' && (
                  <div className="pdm-section">
                    <p className="pdm-section-title">Recent Bills</p>
                    {(!data.bills?.length)
                      ? <div className="pdm-empty">No billing history</div>
                      : data.bills.map(b => (
                          <div key={b.id} className="pdm-card">
                            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                              <span className="pdm-card-title">{b.bill_number}</span>
                              <Badge
                                label={b.payment_status}
                                color={b.payment_status==='Paid'?'green':b.payment_status==='Partial'?'yellow':'red'}
                              />
                            </div>
                            <div style={{display:'flex',justifyContent:'space-between'}}>
                              <span className="pdm-card-sub">Total: ₹{Number(b.total_amount).toLocaleString()}</span>
                              <span className="pdm-card-sub">Paid: ₹{Number(b.paid_amount).toLocaleString()}</span>
                            </div>
                            <div className="pdm-card-sub" style={{marginTop:3}}>{b.payment_method} &bull; {fmt(b.created_at)}</div>
                          </div>
                        ))}
                  </div>
                )}

                {/* Labs tab */}
                {tab === 'labs' && (
                  <div className="pdm-section">
                    <p className="pdm-section-title">Recent Lab Results</p>
                    {(!data.labs?.length)
                      ? <div className="pdm-empty">No lab results</div>
                      : data.labs.map(l => (
                          <div key={l.id} className="pdm-card">
                            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                              <span className="pdm-card-title">{l.test_name}</span>
                              <Badge label={l.status} color={l.status==='Approved'||l.status==='Verified'?'green':'blue'} />
                            </div>
                            <div style={{display:'flex',gap:12,fontSize:13}}>
                              <span style={{color:'#1e293b',fontWeight:600}}>{l.result_value} {l.unit}</span>
                              {l.reference_range && <span style={{color:'#94a3b8'}}>Ref: {l.reference_range}</span>}
                            </div>
                            <div className="pdm-card-sub" style={{marginTop:3}}>Sample: {l.sample_id} &bull; {fmt(l.created_at)}</div>
                          </div>
                        ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
