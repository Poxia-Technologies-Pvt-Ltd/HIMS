import { useState, useEffect, useRef } from 'react';
import {
  Search,
  User,
  Camera,
  ArrowRight,
  Check
} from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import '../../assets/CSS/PatientRegistration.css';

const TITLES = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.'];
const GENDERS = ['Male', 'Female', 'Other'];
const PATIENT_TYPES = ['OP', 'IP', 'Emergency'];
const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed'];
const OCCS = ['Employed', 'Unemployed', 'Student', 'Retired', 'Self-employed'];
const LANGS = ['Kannada', 'English', 'Hindi', 'Tamil', 'Telugu', 'Marathi', 'Urdu', 'Other'];
// Consent to receive reports on WhatsApp / e-mail (tender #44).
const REPORT_CONSENT = ['Agreed', 'Declined'];
const EDUS = ['Primary', 'High School', "Bachelor's", "Master's", 'PhD', 'Other'];
const RELS = ['Christian', 'Muslim', 'Hindu', 'Buddhist', 'None', 'Other'];
const CITIZENS = ['Ghana', 'Nigeria', 'US', 'UK', 'Canada', 'India', 'Other'];
const COUNTRIES = ['Ghana', 'Nigeria', 'US', 'UK', 'Canada', 'India', 'Other'];
const KIN_RELS = ['Spouse', 'Parent', 'Child', 'Sibling', 'Friend', 'Guardian', 'Other'];
const PAYERS = ['Self / Out of Pocket', 'Insurance', 'Government / NHIS', 'Employer'];

const INIT = {
  regNo: '',
  regDate: new Date().toISOString().split('T')[0],
  patientType: 'OP',
  consultantName: '',
  title: '', firstName: '', middleName: '', lastName: '',
  dob: '', ageYears: '', ageMonths: '', ageDays: '',
  gender: '', aadharNumber: '', abhaId: '', maritalStatus: '', occupation: '', language: '',
  educationLevel: '', religion: '', citizen: '', emailId: '', telephone: '', reportConsent: '', fileRequired: false,
  address: '', suburb: '', city: '', country: '', postalCode: '', postalAddress: false,
  kinSameAddress: false, kinName: '', kinRelation: '', kinTelephone: '',
  kinAddress: '', kinSuburb: '', kinCity: '', kinCountry: '', kinCode: '',
  payerType: '', insuranceProvider: '', policyNumber: '',
};

const Field = ({ label, children, span }) => (
  <div className={`preg-field ${span ? `preg-col-span-${span}` : ''}`}>
    <label className="preg-label">{label}</label>
    {children}
  </div>
);

const Input = (props) => <input className="preg-input" {...props} />;

const Select = ({ options, placeholder = 'Select', ...props }) => (
  <select className="preg-select" {...props}>
    <option value="">{placeholder}</option>
    {options.map(o => <option key={o} value={o}>{o}</option>)}
  </select>
);

// ── Merge Modal ──────────────────────────────────────────────────────────────
function MergeModal({ defaultSecondary, onClose, onMerged }) {
  const [primaryQ, setPrimaryQ]     = useState('');
  const [secondaryQ, setSecondaryQ] = useState(defaultSecondary?.telephone || '');
  const [primary, setPrimary]       = useState(null);
  const [secondary, setSecondary]   = useState(defaultSecondary || null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const API_BASE = import.meta.env.VITE_API_URL || '';
  const hdr = { Authorization: `Bearer ${localStorage.getItem('hims_token')}` };

  const search = async (q, setter) => {
    if (!q.trim()) return;
    try {
      const res  = await fetch(`${API_BASE}/api/patients/search?q=${encodeURIComponent(q)}`, { headers: hdr });
      const json = await res.json();
      if (json.success && json.patients?.length) setter(json.patients[0]);
      else setter(null);
    } catch { setter(null); }
  };

  const doMerge = async () => {
    if (!primary || !secondary) { setError('Search and select both patients first'); return; }
    if (primary.reg_no === secondary.reg_no) { setError('Primary and secondary must be different patients'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch(`${API_BASE}/api/patients/merge`, {
        method: 'POST',
        headers: { ...hdr, 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryRegNo: primary.reg_no, secondaryRegNo: secondary.reg_no })
      });
      const json = await res.json();
      if (json.success) onMerged(primary.reg_no);
      else setError(json.message || 'Merge failed');
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  };

  const PCard = ({ p, label, color }) => p ? (
    <div style={{border:`1.5px solid ${color}`,borderRadius:10,padding:'12px 14px',background:'#fafafa'}}>
      <div style={{fontSize:10,fontWeight:700,color,textTransform:'uppercase',marginBottom:6}}>{label}</div>
      <div style={{fontWeight:700,fontSize:14,color:'#1e293b'}}>{[p.first_name,p.middle_name,p.last_name].filter(Boolean).join(' ')}</div>
      <div style={{fontSize:12,color:'#64748b',marginTop:2}}>{p.reg_no} · {p.gender} · {p.telephone}</div>
      {p.dob && <div style={{fontSize:11,color:'#94a3b8'}}>DOB: {new Date(p.dob).toLocaleDateString('en-IN')}</div>}
    </div>
  ) : <div style={{border:'1.5px dashed #e2e8f0',borderRadius:10,padding:'20px',textAlign:'center',color:'#94a3b8',fontSize:12}}>Search a patient above</div>;

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'#fff',borderRadius:16,padding:'28px',width:600,maxWidth:'95vw',boxShadow:'0 20px 60px rgba(0,0,0,.2)'}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:20}}>
          <h2 style={{margin:0,fontSize:18,fontWeight:700,color:'#1e293b'}}>Merge Duplicate Patients</h2>
          <button onClick={onClose} style={{marginLeft:'auto',border:'none',background:'none',fontSize:20,cursor:'pointer',color:'#94a3b8'}}>✕</button>
        </div>

        <div style={{background:'#fef9c3',border:'1px solid #fde047',borderRadius:8,padding:'10px 14px',marginBottom:18,fontSize:12,color:'#854d0e'}}>
          All appointments, bills, consultations and labs from the <strong>secondary</strong> will move to the <strong>primary</strong>. The secondary record will be permanently deleted.
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:18}}>
          <div>
            <label style={{fontSize:12,fontWeight:600,color:'#475569',display:'block',marginBottom:6}}>Keep (Primary)</label>
            <div style={{display:'flex',gap:6}}>
              <input value={primaryQ} onChange={e=>setPrimaryQ(e.target.value)}
                placeholder="Search name or phone…"
                style={{flex:1,padding:'8px 10px',border:'1.5px solid #e2e8f0',borderRadius:7,fontSize:13,outline:'none'}} />
              <button onClick={()=>search(primaryQ,setPrimary)}
                style={{padding:'8px 12px',background:'#4f46e5',color:'#fff',border:'none',borderRadius:7,fontSize:12,fontWeight:600,cursor:'pointer'}}>Find</button>
            </div>
          </div>
          <div>
            <label style={{fontSize:12,fontWeight:600,color:'#475569',display:'block',marginBottom:6}}>Delete (Secondary)</label>
            <div style={{display:'flex',gap:6}}>
              <input value={secondaryQ} onChange={e=>setSecondaryQ(e.target.value)}
                placeholder="Search name or phone…"
                style={{flex:1,padding:'8px 10px',border:'1.5px solid #e2e8f0',borderRadius:7,fontSize:13,outline:'none'}} />
              <button onClick={()=>search(secondaryQ,setSecondary)}
                style={{padding:'8px 12px',background:'#64748b',color:'#fff',border:'none',borderRadius:7,fontSize:12,fontWeight:600,cursor:'pointer'}}>Find</button>
            </div>
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',gap:12,alignItems:'center',marginBottom:20}}>
          <PCard p={primary}   label="Keep (Primary)"   color="#4f46e5" />
          <div style={{fontSize:22,color:'#94a3b8',fontWeight:300}}>→</div>
          <PCard p={secondary} label="Delete (Secondary)" color="#ef4444" />
        </div>

        {error && <div style={{color:'#ef4444',fontSize:12,marginBottom:12,padding:'8px 12px',background:'#fee2e2',borderRadius:6}}>{error}</div>}

        <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
          <button onClick={onClose} style={{padding:'9px 18px',border:'1.5px solid #e2e8f0',background:'none',borderRadius:8,fontSize:13,cursor:'pointer'}}>Cancel</button>
          <button onClick={doMerge} disabled={loading||!primary||!secondary}
            style={{padding:'9px 20px',background:loading||!primary||!secondary?'#cbd5e1':'#dc2626',color:'#fff',border:'none',borderRadius:8,fontSize:13,fontWeight:700,cursor:'pointer'}}>
            {loading ? 'Merging…' : 'Merge & Delete Secondary'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PatientDetails({ onSaveSuccess }) {
  const { alert, showAlert, hideAlert } = useAlert();
  // regNo is no longer generated here — it used to be a client-side random
  // number ('REG-' + Math.random()) with no real collision protection, just
  // a generic error if two happened to land on the same value. The backend
  // now reserves the next number in an atomic per-branch-per-year sequence
  // (see reserveRegNo in patientController.js) and returns it on save.
  const [data, setData] = useState(() => ({ ...INIT }));
  // Most walk-ins know their age, not their exact birth date — Age entry is
  // the default; DOB entry is there for whoever does have the real date.
  const [dobEntryMode, setDobEntryMode] = useState('age'); // 'age' | 'dob'
  const [photo, setPhoto] = useState(null);
  const [cam, setCam] = useState(false);
  const [stream, setStream] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef(null);

  // Consultant Name — free text with autocomplete suggestions pulled live
  // from whatever's already been typed into other patients' records
  // (SELECT DISTINCT consultant_name FROM patients...). No separate
  // doctors/consultants master table or registration step — the list just
  // grows organically from real usage.
  const [consultantSuggestions, setConsultantSuggestions] = useState([]);
  const [showConsultantDropdown, setShowConsultantDropdown] = useState(false);
  const consultantRef = useRef(null);

  // Duplicate detection state
  const [duplicates, setDuplicates] = useState([]);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [proceedAnyway, setProceedAnyway] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);

  // Admin-configurable fields (Settings > Patient Field Config). Fields
  // already hand-built into this form (name, dob/age, gender, phone,
  // patient type, consultant, address, kin, payer) stay as-is — rewriting a
  // working, polished layout for per-field show/hide isn't worth the risk.
  // What's genuinely dynamic here: (a) system fields that have a DB column
  // and validation but previously had NO input anywhere on this form
  // (aadharNumber, abhaId, maritalStatus, occupation, language,
  // educationLevel, religion, citizen — silently uncollectable before this),
  // and (b) true custom fields an Admin defines with no code change at all.
  // Both render generically in the "Additional Information" section below.
  const DYNAMIC_SYSTEM_KEYS = ['aadharNumber', 'abhaId', 'maritalStatus', 'occupation', 'language', 'educationLevel', 'religion', 'citizen'];
  const [fieldConfig, setFieldConfig] = useState([]);
  const [customFields, setCustomFields] = useState({});

  useEffect(() => {
    const API_BASE = import.meta.env.VITE_API_URL || '';
    fetch(`${API_BASE}/api/patients/field-config`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('hims_token')}` }
    })
      .then(r => r.json())
      .then(json => { if (json.success) setFieldConfig(json.fields || []); })
      .catch(() => { /* form still works with defaults if this fails */ });
  }, []);

  const dynamicSystemFields = fieldConfig.filter(f => f.is_enabled && DYNAMIC_SYSTEM_KEYS.includes(f.field_key));
  const customFieldDefs    = fieldConfig.filter(f => f.is_enabled && f.field_source === 'custom');

  // setValue receives the raw new value (string/boolean) — callers close
  // over either setData (dynamic system fields, keyed into the same `data`
  // state as every hand-built field) or setCustomFields (true custom
  // fields, which have no slot in `data` since their keys are admin-defined
  // at runtime).
  const renderConfigField = (f, value, setValue) => {
    const label = f.label + (f.is_required ? ' *' : '');
    if (f.field_type === 'select') {
      const opts = Array.isArray(f.options_json) ? f.options_json : [];
      return <Field key={f.field_key} label={label}><Select options={opts} value={value || ''} onChange={e => setValue(e.target.value)} /></Field>;
    }
    if (f.field_type === 'textarea') {
      return <Field key={f.field_key} label={label}><textarea className="preg-input" rows={2} value={value || ''} onChange={e => setValue(e.target.value)} /></Field>;
    }
    if (f.field_type === 'checkbox') {
      return <Field key={f.field_key} label={label}><input type="checkbox" checked={!!value} onChange={e => setValue(e.target.checked)} /></Field>;
    }
    return (
      <Field key={f.field_key} label={label}>
        <Input
          type={f.field_type === 'number' ? 'number' : f.field_type === 'date' ? 'date' : 'text'}
          value={value || ''}
          onChange={e => setValue(e.target.value)}
        />
      </Field>
    );
  };

  // Close dropdown if clicked outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
      if (consultantRef.current && !consultantRef.current.contains(e.target)) {
        setShowConsultantDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // DOB -> Age. Only live in 'dob' mode — in 'age' mode the reverse effect
  // below is what's driving data.dob, and running both directions at once
  // would have them fighting over which value is the source of truth.
  useEffect(() => {
    if (dobEntryMode !== 'dob' || !data.dob) return;
    const b = new Date(data.dob), now = new Date();
    let y = now.getFullYear() - b.getFullYear();
    let m = now.getMonth() - b.getMonth();
    let d = now.getDate() - b.getDate();
    if (d < 0) { m--; d += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
    if (m < 0) { y--; m += 12; }
    setData(p => ({ ...p, ageYears: y, ageMonths: m, ageDays: d }));
  }, [data.dob, dobEntryMode]);

  // Age -> DOB (the default mode). Keeps data.dob populated with an
  // approximate birth date so validation, duplicate-checking and the save
  // payload all keep treating dob as the single source of truth regardless
  // of which mode was actually used to enter it.
  useEffect(() => {
    if (dobEntryMode !== 'age') return;
    if (data.ageYears === '' && data.ageMonths === '' && data.ageDays === '') return;
    const y = parseInt(data.ageYears, 10) || 0;
    const m = parseInt(data.ageMonths, 10) || 0;
    const d = parseInt(data.ageDays, 10) || 0;
    const now = new Date();
    const dobDate = new Date(now.getFullYear() - y, now.getMonth() - m, now.getDate() - d);
    const iso = dobDate.toISOString().slice(0, 10);
    setData(p => (p.dob === iso ? p : { ...p, dob: iso }));
  }, [data.ageYears, data.ageMonths, data.ageDays, dobEntryMode]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setCam(true);
        navigator.mediaDevices.getUserMedia({ video: true })
          .then(s => {
            setStream(s);
            setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s; }, 50);
          })
          .catch(() => { showAlert('Camera access denied.', 'error'); setCam(false); });
      }
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        document.querySelector('input[name="firstName"]')?.focus();
      }
      if (e.altKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        document.querySelector('input[name="address"]')?.focus();
      }
      if (e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        document.querySelector('input[name="address"]')?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleConsultantChange = async (e) => {
    const val = e.target.value;
    setData(p => ({ ...p, consultantName: val }));

    if (!val.trim()) {
      setConsultantSuggestions([]);
      setShowConsultantDropdown(false);
      return;
    }

    setShowConsultantDropdown(true);
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${API_BASE}/api/patients/consultants?q=${encodeURIComponent(val)}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('hims_token')}` }
      });
      const result = await res.json();
      setConsultantSuggestions(result.success ? (result.consultants || []) : []);
    } catch (err) {
      console.error(err);
    }
  };

  const selectConsultant = (name) => {
    setData(p => ({ ...p, consultantName: name }));
    setShowConsultantDropdown(false);
  };

  const ch = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === 'kinSameAddress' && checked) {
      setData(p => ({
        ...p, kinSameAddress: true,
        kinAddress: p.address, kinSuburb: p.suburb,
        kinCity: p.city, kinCountry: p.country, kinCode: p.postalCode,
      }));
      return;
    }
    setData(p => ({ ...p, [name]: type === 'checkbox' ? checked : value }));
  };

  /* Camera */
  const openCam = async () => {
    setCam(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch { showAlert('Camera access denied.', 'error'); setCam(false); }
  };

  const closeCam = () => {
    stream?.getTracks().forEach(t => t.stop());
    setStream(null); setCam(false);
  };

  const capturePhoto = () => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    setPhoto(c.toDataURL('image/png'));
    closeCam();
  };

  const checkForDuplicates = async (telephone, firstName, lastName, dob) => {
    if (!telephone || telephone.length < 5) return;
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const params = new URLSearchParams();
      if (telephone) params.set('telephone', telephone);
      if (firstName) params.set('firstName', firstName);
      if (lastName)  params.set('lastName', lastName);
      if (dob)       params.set('dob', dob);
      const res  = await fetch(`${API_BASE}/api/patients/check-duplicate?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('hims_token')}` }
      });
      const json = await res.json();
      if (json.success && json.duplicates.length > 0) {
        setDuplicates(json.duplicates);
        setShowDuplicates(true);
        setProceedAnyway(false);
      } else {
        setDuplicates([]);
        setShowDuplicates(false);
      }
    } catch { /* silent */ }
  };

  const onPhoneBlur = () => {
    if (!proceedAnyway) checkForDuplicates(data.telephone, data.firstName, data.lastName, data.dob);
  };

  const useExistingPatient = (patient) => {
    setShowDuplicates(false);
    if (onSaveSuccess) onSaveSuccess(patient.reg_no);
  };

  const handleSave = async () => {
    if (!data.firstName || !data.lastName || !data.dob || !data.gender || !data.telephone) {
      showAlert('First Name, Last Name, DOB, Gender and Phone Number are required!', 'warning');
      return;
    }

    const missingDynamic = [...dynamicSystemFields, ...customFieldDefs].filter(f => {
      if (!f.is_required) return false;
      const v = f.field_source === 'custom' ? customFields[f.field_key] : data[f.field_key];
      return v === undefined || v === null || String(v).trim() === '';
    });
    if (missingDynamic.length > 0) {
      showAlert(`Required: ${missingDynamic.map(f => f.label).join(', ')}`, 'warning');
      return;
    }

    // Final duplicate check before save
    if (!proceedAnyway && duplicates.length > 0) {
      setShowDuplicates(true);
      showAlert('Possible duplicate patients found. Please review before saving.', 'warning');
      return;
    }

    try {
      const payload = {
        ...data,
        photo_base64: photo,
        branch_id: localStorage.getItem('branch_id'),
        customFields,
      };

      const API_BASE = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${API_BASE}/api/patients/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('hims_token')}`
        },
        body: JSON.stringify(payload)
      });
      const result = await res.json();

      if (result.success) {
        setData(d => ({ ...d, regNo: result.regNo }));
        onSaveSuccess(result.regNo);
      } else {
        showAlert(result.message || 'Error saving patient.', 'error');
      }
    } catch (err) {
      console.error(err);
      showAlert('Network error while saving patient.', 'error');
    }
  };

  const handleSearchChange = async (e) => {
    const val = e.target.value;
    setSearchQuery(val);

    if (!val.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    setIsSearching(true);
    setShowDropdown(true);
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${API_BASE}/api/patients/search?q=${encodeURIComponent(val)}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('hims_token')}` }
      });
      const result = await res.json();
      if (result.success) {
        setSearchResults(result.patients || []);
      } else {
        setSearchResults([]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const selectPatient = (patient) => {
    setShowDropdown(false);
    setSearchQuery('');
    showAlert(`Returning patient selected: ${patient.first_name} ${patient.last_name}`, 'success');
    if (onSaveSuccess) onSaveSuccess(patient.reg_no);
  };

  return (
    <>
      {alert && (
        <Alert
          message={alert.message}
          type={alert.type}
          onClose={hideAlert}
          duration={4000}
        />
      )}
      <div className="preg-body" style={{ paddingBottom: '80px' }}>
        <div className="preg-card">
          <div className="preg-card-header">
            <span className="preg-card-title">Registration Info</span>
          </div>
          <div className="preg-card-body">
            <div className="preg-meta-strip">
              <div className="preg-meta-item">
                <span className="preg-meta-label">Reg. No.</span>
                <span className="preg-meta-value" style={!data.regNo ? { color: '#94a3b8', fontStyle: 'italic' } : undefined}>
                  {data.regNo || 'Auto-generated on save'}
                </span>
              </div>
              <div className="preg-meta-item">
                <span className="preg-meta-label">Date</span>
                <Input type="date" name="regDate" value={data.regDate} onChange={ch} />
              </div>

              <div style={{ marginLeft: 24, position: 'relative', flex: 1, maxWidth: '300px' }} ref={searchRef}>
                <div style={{ position: 'relative' }}>
                  <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: 12, top: 11 }} />
                  <input
                    type="text"
                    className="preg-input"
                    placeholder="Search patient by name, phone..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                    onFocus={() => { if (searchQuery.trim()) setShowDropdown(true); }}
                    style={{ paddingLeft: '36px', width: '100%', boxSizing: 'border-box', background: '#f8fafc' }}
                  />
                  {isSearching && (
                    <div style={{ position: 'absolute', right: 12, top: 12, width: 14, height: 14, border: '2px solid #e2e8f0', borderTop: '2px solid var(--blue-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  )}
                </div>

                {showDropdown && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '8px', background: '#fff', borderRadius: '12px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0', zIndex: 100, overflow: 'hidden' }}>
                    {searchResults.length > 0 ? (
                      <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        {searchResults.map((p) => (
                          <div
                            key={p.id}
                            onClick={() => selectPatient(p)}
                            style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', transition: 'background 0.2s', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                            onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
                          >
                            <div>
                              <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '13px' }}>{p.first_name} {p.last_name}</div>
                              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{p.reg_no} • {p.telephone || 'No phone'}</div>
                            </div>
                            <ArrowRight size={16} color="var(--blue-primary)" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: '16px', textAlign: 'center', fontSize: '13px', color: '#64748b' }}>
                        No patients found matching "{searchQuery}"
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Avatar */}
              <div className="preg-avatar" onClick={openCam} title="Add Photo (Alt + C)">
                {photo
                  ? <img src={photo} alt="patient" />
                  : <>
                    <User size={22} color="currentColor" strokeWidth={1.5} />
                    <span>Add Photo</span>
                  </>
                }
              </div>
            </div>
          </div>
        </div>

        {/* ── Personal Details ── */}
        <div className="preg-card">
          <div className="preg-card-header">
            <span className="preg-card-title">Personal Details</span>
          </div>
          <div className="preg-card-body">
            <div className="preg-grid">

              <Field label="Full Name *" span={2}>
                <div className="preg-inline">
                  <Select options={TITLES} name="title" value={data.title} onChange={ch} className="preg-select sm" style={{ flex: '0 0 72px' }} placeholder="Title" />
                  <Input name="firstName" value={data.firstName} onChange={ch} placeholder="First Name" />
                  <Input name="middleName" value={data.middleName} onChange={ch} placeholder="Middle" />
                  <Input name="lastName" value={data.lastName} onChange={ch} placeholder="Last Name" />
                </div>
              </Field>

              <Field label={dobEntryMode === 'dob' ? 'Date of Birth' : 'Date of Birth (auto)'}>
                <Input
                  type="date"
                  name="dob"
                  value={data.dob}
                  onChange={ch}
                  readOnly={dobEntryMode === 'age'}
                  style={dobEntryMode === 'age' ? { background: 'var(--surface-sunken, #f8fafc)', color: 'var(--text-muted, #64748b)' } : undefined}
                />
                <button
                  type="button"
                  onClick={() => setDobEntryMode(m => (m === 'age' ? 'dob' : 'age'))}
                  style={{ marginTop: 4, fontSize: 12, background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                >
                  {dobEntryMode === 'age' ? 'Enter Date of Birth instead' : 'Enter Age instead'}
                </button>
              </Field>

              <Field label={dobEntryMode === 'age' ? 'Age (Y / M / D)*' : 'Age (Y / M / D) — auto'}>
                <div className="preg-age-group">
                  <Input name="ageYears" value={data.ageYears} onChange={ch} readOnly={dobEntryMode === 'dob'} placeholder="Yrs" />
                  <Input name="ageMonths" value={data.ageMonths} onChange={ch} readOnly={dobEntryMode === 'dob'} placeholder="Mo" />
                  <Input name="ageDays" value={data.ageDays} onChange={ch} readOnly={dobEntryMode === 'dob'} placeholder="Day" />
                </div>
              </Field>

              <Field label="Gender*">
                <Select options={GENDERS} name="gender" value={data.gender} onChange={ch} />
              </Field>

              <Field label="Email">
                <Input type="email" name="emailId" value={data.emailId} onChange={ch} placeholder="patient@email.com" />
              </Field>

              <Field label="Phone Number*">
                <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch' }}>
                  <div className="preg-phone-prefix" style={{ flex: 1, minWidth: 0 }}>
                    <span className="country-code">+91</span>
                    <Input type="tel" name="telephone" value={data.telephone} onChange={ch} onBlur={onPhoneBlur} placeholder="12345 67890" />
                  </div>
                </div>
              </Field>

              <Field label="Digital report delivery">
                <Select options={REPORT_CONSENT} placeholder="Not asked" name="reportConsent" value={data.reportConsent} onChange={ch} />
              </Field>

              <Field label="Patient Type*">
                <Select options={PATIENT_TYPES} name="patientType" value={data.patientType} onChange={ch} />
              </Field>

              <Field label="Consultant Name">
                <div style={{ position: 'relative' }} ref={consultantRef}>
                  <Input
                    type="text"
                    name="consultantName"
                    value={data.consultantName}
                    onChange={handleConsultantChange}
                    onFocus={() => { if (data.consultantName.trim()) setShowConsultantDropdown(true); }}
                    placeholder="Type or pick a consultant"
                    autoComplete="off"
                  />
                  {showConsultantDropdown && consultantSuggestions.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', borderRadius: 8, boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0', zIndex: 100, maxHeight: 220, overflowY: 'auto' }}>
                      {consultantSuggestions.map((name) => (
                        <div
                          key={name}
                          onClick={() => selectConsultant(name)}
                          style={{ padding: '10px 14px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
                          onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                          onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
                        >
                          {name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Field>

            </div>
          </div>
        </div>

        {/* ── Home Address ── */}
        <div className="preg-card">
          <div className="preg-card-header">
            <span className="preg-card-title">Home Address</span>
          </div>
          <div className="preg-card-body">
            <div className="preg-grid">
              <Field label="Street Address" span={2}>
                <Input name="address" value={data.address} onChange={ch} placeholder="House no. & street" />
              </Field>
              <Field label="Suburb / Area">
                <Input name="suburb" value={data.suburb} onChange={ch} />
              </Field>
              <Field label="City">
                <Input name="city" value={data.city} onChange={ch} />
              </Field>
              <Field label="Country">
                <Select options={COUNTRIES} name="country" value={data.country} onChange={ch} />
              </Field>
              <Field label="Postal Code">
                <Input name="postalCode" value={data.postalCode} onChange={ch} />
              </Field>
              <Field label="">
                <label className="preg-checkbox-row" style={{ paddingTop: 18 }}>
                  <input type="checkbox" name="postalAddress" checked={data.postalAddress} onChange={ch} />
                  Postal Address
                </label>
              </Field>
            </div>
          </div>
        </div>

        {/* ── Next of Kin ── */}
        <div className="preg-card">
          <div className="preg-card-header">
            <span className="preg-card-title">Next of Kin</span>
            <label className="preg-checkbox-row" style={{ fontSize: 12 }}>
              <input type="checkbox" name="kinSameAddress" checked={data.kinSameAddress} onChange={ch} />
              Same address as patient
            </label>
          </div>
          <div className="preg-card-body">
            <div className="preg-grid">
              <Field label="Full Name" span={2}>
                <Input name="kinName" value={data.kinName} onChange={ch} />
              </Field>
              <Field label="Relation">
                <Select options={KIN_RELS} name="kinRelation" value={data.kinRelation} onChange={ch} />
              </Field>
              <Field label="Telephone">
                <Input type="tel" name="kinTelephone" value={data.kinTelephone} onChange={ch} />
              </Field>
              <Field label="Address" span={2}>
                <Input name="kinAddress" value={data.kinAddress} onChange={ch} />
              </Field>
              <Field label="Suburb">
                <Input name="kinSuburb" value={data.kinSuburb} onChange={ch} />
              </Field>
              <Field label="City">
                <Input name="kinCity" value={data.kinCity} onChange={ch} />
              </Field>
              <Field label="Country">
                <Select options={COUNTRIES} name="kinCountry" value={data.kinCountry} onChange={ch} />
              </Field>
              <Field label="Code">
                <Input name="kinCode" value={data.kinCode} onChange={ch} />
              </Field>
            </div>
          </div>
        </div>

        {/* ── Payer ── */}
        <div className="preg-card">
          <div className="preg-card-header">
            <span className="preg-card-title">Payer Information</span>
          </div>
          <div className="preg-card-body">
            <div className="preg-grid preg-grid-3">
              <Field label="Payer Type">
                <Select options={PAYERS} name="payerType" value={data.payerType} onChange={ch} />
              </Field>
              <Field label="Insurance Provider">
                <Input name="insuranceProvider" value={data.insuranceProvider} onChange={ch} />
              </Field>
              <Field label="Policy Number">
                <Input name="policyNumber" value={data.policyNumber} onChange={ch} />
              </Field>
            </div>
          </div>
        </div>

        {/* ── Additional Information — Settings > Patient Field Config ──
            Admin-configurable: aadhar/ABHA/marital status/etc. (real DB
            columns that had no input anywhere on this form before) plus any
            fully custom field an Admin defines, with no code change. */}
        {(dynamicSystemFields.length > 0 || customFieldDefs.length > 0) && (
          <div className="preg-card">
            <div className="preg-card-header">
              <span className="preg-card-title">Additional Information</span>
            </div>
            <div className="preg-card-body">
              <div className="preg-grid preg-grid-3">
                {dynamicSystemFields.map(f =>
                  renderConfigField(f, data[f.field_key], (v) => setData(p => ({ ...p, [f.field_key]: v })))
                )}
                {customFieldDefs.map(f =>
                  renderConfigField(f, customFields[f.field_key], (v) => setCustomFields(p => ({ ...p, [f.field_key]: v })))
                )}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── Duplicate Warning Banner ── */}
      {showDuplicates && duplicates.length > 0 && !proceedAnyway && (
        <div style={{
          position:'sticky', bottom:56, zIndex:100, margin:'0 24px',
          background:'#fff7ed', border:'1.5px solid #f97316', borderRadius:12,
          padding:'14px 18px', boxShadow:'0 4px 20px rgba(249,115,22,.15)'
        }}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span style={{fontWeight:700,color:'#c2410c',fontSize:14}}>
              {duplicates.length} possible duplicate{duplicates.length>1?'s':''} found with this phone number
            </span>
            <button onClick={() => setShowDuplicates(false)} style={{marginLeft:'auto',border:'none',background:'none',cursor:'pointer',color:'#9a3412',fontSize:18,lineHeight:1}}>✕</button>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:200,overflowY:'auto'}}>
            {duplicates.map(p => (
              <div key={p.id} style={{
                display:'flex',alignItems:'center',gap:12,padding:'10px 12px',
                background:'#fff',border:'1px solid #fed7aa',borderRadius:8
              }}>
                <div style={{
                  width:38,height:38,borderRadius:'50%',background:'#ffedd5',
                  display:'flex',alignItems:'center',justifyContent:'center',
                  fontWeight:700,color:'#ea580c',fontSize:15,flexShrink:0,overflow:'hidden'
                }}>
                  {p.photo_base64
                    ? <img src={p.photo_base64.startsWith('data:')?p.photo_base64:`data:image/jpeg;base64,${p.photo_base64}`} style={{width:'100%',height:'100%',objectFit:'cover'}} alt="" />
                    : (p.first_name?.[0]||'?')}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:13,color:'#1e293b'}}>
                    {[p.first_name,p.middle_name,p.last_name].filter(Boolean).join(' ')}
                  </div>
                  <div style={{fontSize:11,color:'#64748b'}}>
                    {p.reg_no} · {p.gender} · {p.telephone}
                    {p.dob && ` · DOB: ${new Date(p.dob).toLocaleDateString('en-IN')}`}
                  </div>
                </div>
                <button
                  onClick={() => useExistingPatient(p)}
                  style={{padding:'6px 12px',background:'#4f46e5',color:'#fff',border:'none',borderRadius:6,fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}
                >
                  Use This Patient
                </button>
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:8,marginTop:12}}>
            <button
              onClick={() => setShowMergeModal(true)}
              style={{padding:'7px 14px',background:'none',border:'1.5px solid #f97316',color:'#c2410c',borderRadius:6,fontSize:12,fontWeight:600,cursor:'pointer'}}
            >
              Merge Duplicates
            </button>
            <button
              onClick={() => { setProceedAnyway(true); setShowDuplicates(false); }}
              style={{padding:'7px 14px',background:'none',border:'1.5px solid #cbd5e1',color:'#64748b',borderRadius:6,fontSize:12,fontWeight:600,cursor:'pointer'}}
            >
              Proceed as New Patient
            </button>
          </div>
        </div>
      )}

      {/* ── Merge Patient Modal ── */}
      {showMergeModal && (
        <MergeModal
          defaultSecondary={duplicates[0]}
          onClose={() => setShowMergeModal(false)}
          onMerged={(primaryRegNo) => {
            setShowMergeModal(false);
            setShowDuplicates(false);
            if (onSaveSuccess) onSaveSuccess(primaryRegNo);
          }}
        />
      )}

      {/* ── Sticky Action Bar ── */}
      <div className="preg-action-bar">
        <span style={{ fontSize: 12, color: 'var(--text-soft)', marginRight: 'auto' }}>
          Fields marked * are required
        </span>
        <button className="btn-ghost" onClick={() => window.history.back()}>Cancel</button>
        <button className="btn-primary" onClick={handleSave}>
          <Check size={15} strokeWidth={2.5} />
          Save & Continue
        </button>
      </div>

      {/* ── Camera Modal ── */}
      {cam && (
        <div className="camera-overlay">
          <div className="camera-box">
            <h3>Capture Patient Photo</h3>
            <div className="camera-video">
              <video ref={videoRef} autoPlay playsInline />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>
            <div className="camera-actions">
              <button type="button" className="btn-ghost" onClick={closeCam}>Cancel</button>
              <button type="button" className="btn-primary" onClick={capturePhoto}>
                <Camera size={14} />
                Capture
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}

export default PatientDetails;