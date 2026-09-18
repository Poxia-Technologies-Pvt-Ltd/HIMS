import { useState, useEffect, useRef, useCallback } from 'react';
import { searchICD10 } from '../../data/icd10Codes';
import { searchDrugs, getDrugInfo, checkInteractions } from '../../data/drugDatabase';
import { LAB_ORDER_SETS, suggestLabPanels } from '../../data/labOrderSets';
import { SYMPTOM_CHIPS, ALL_SYSTEMS } from '../../data/symptomChips';
import { CONSULTATION_TEMPLATES } from '../../data/consultationTemplates';
import CertificateGenerator from './CertificateGenerator';
import PostVisitSummary from './PostVisitSummary';
import PatientTimeline from './PatientTimeline';
import AmbientScribe from './AmbientScribe';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function calcAge(dob) {
  if (!dob) return null;
  const d = Math.floor((Date.now() - new Date(dob)) / (365.25 * 24 * 3600 * 1000));
  return d;
}
function calcBMI(h, w) {
  const hm = parseFloat(h) / 100, wk = parseFloat(w);
  if (!hm || !wk) return null;
  const b = wk / (hm * hm);
  let cat = 'Normal', color = '#16a34a';
  if (b < 18.5) { cat = 'Underweight'; color = '#0891b2'; }
  else if (b >= 25 && b < 30) { cat = 'Overweight'; color = '#d97706'; }
  else if (b >= 30) { cat = 'Obese'; color = '#dc2626'; }
  return { val: b.toFixed(1), cat, color };
}
function stopDate(duration) {
  if (!duration) return '';
  const today = new Date();
  const m = duration.match(/(\d+)\s*(day|week|month)/i);
  if (!m) return '';
  const n = parseInt(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'day') today.setDate(today.getDate() + n);
  else if (unit === 'week') today.setDate(today.getDate() + n * 7);
  else if (unit === 'month') today.setMonth(today.getMonth() + n);
  return today.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function initials(fn, ln) {
  return `${(fn || '')[0] || ''}${(ln || '')[0] || ''}`.toUpperCase();
}
const DRAFT_KEY = id => `cw_adv_draft_${id}`;

// ─── Empty medicine row ───────────────────────────────────────────────────────
const emptyMed = () => ({
  medicine_name: '', generic: '', dosage: '', frequency: '',
  duration: '', route: 'Oral', instructions: '',
  morning: false, afternoon: false, evening: false, night: false,
  _id: Math.random().toString(36).slice(2),
});

// ─── Vitals sparkline (tiny SVG chart) ───────────────────────────────────────
function Sparkline({ values, color }) {
  if (!values || values.length < 2) return <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>;
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 60;
    const y = 16 - ((v - min) / range) * 14;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width="60" height="18" style={{ display: 'block' }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={pts} />
      <circle cx={pts.split(' ').pop().split(',')[0]} cy={pts.split(' ').pop().split(',')[1]} r="2.5" fill={color} />
    </svg>
  );
}

// ─── ICD-10 Picker ────────────────────────────────────────────────────────────
function ICD10Picker({ selected, onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const ref = useRef();

  useEffect(() => {
    setResults(query.length >= 2 ? searchICD10(query) : []);
  }, [query]);

  const add = (code) => {
    if (!selected.find(s => s.code === code.code)) onChange([...selected, code]);
    setQuery(''); setResults([]);
  };
  const remove = (code) => onChange(selected.filter(s => s.code !== code));

  return (
    <div className="icd10-wrap">
      {/* Selected codes */}
      <div className="icd10-chips">
        {selected.map(c => (
          <span key={c.code} className="icd10-chip">
            <strong>{c.code}</strong> {c.description}
            <button onClick={() => remove(c.code)}>✕</button>
          </span>
        ))}
      </div>
      {/* Search */}
      <div className="icd10-search-wrap" ref={ref}>
        <input
          className="icd10-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search ICD-10 code or condition…"
        />
        {results.length > 0 && (
          <div className="icd10-dropdown">
            {results.map(r => (
              <div key={r.code} className="icd10-option" onClick={() => add(r)}>
                <strong>{r.code}</strong> — {r.description}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Drug Row ────────────────────────────────────────────────────────────────
function DrugRow({ med, idx, onChange, onRemove, interactions }) {
  const [drugQuery, setDrugQuery] = useState(med.medicine_name || '');
  const [drugResults, setDrugResults] = useState([]);
  const hasInteraction = interactions.some(
    w => w.drug1 === med.medicine_name || w.drug2 === med.medicine_name
  );

  useEffect(() => {
    setDrugResults(drugQuery.length >= 2 ? searchDrugs(drugQuery) : []);
  }, [drugQuery]);

  const selectDrug = (drug) => {
    setDrugQuery(drug.name);
    setDrugResults([]);
    onChange(idx, {
      medicine_name: drug.name,
      generic: drug.generic,
      dosage: drug.commonDosages[0] || '',
      route: drug.forms[0] || 'Oral',
    });
  };

  const FREQ_CHIPS = ['OD', 'BD', 'TID', 'QID', 'SOS', 'HS', 'AC', 'PC'];
  const DURATIONS = ['1 Day', '3 Days', '5 Days', '7 Days', '10 Days', '14 Days', '1 Month'];
  const ROUTES = ['Oral', 'IM', 'IV', 'Topical', 'Inhaled', 'Sublingual', 'Nasal', 'Ophthalmic', 'Otic'];
  const stop = stopDate(med.duration);

  return (
    <div className={`drug-row ${hasInteraction ? 'drug-row--warn' : ''}`}>
      {/* Drug name */}
      <div className="drug-row-top">
        <div className="drug-name-wrap">
          <input
            className="drug-name-input"
            value={drugQuery}
            onChange={e => { setDrugQuery(e.target.value); onChange(idx, { medicine_name: e.target.value }); }}
            placeholder="Drug name or generic…"
          />
          {hasInteraction && (
            <span className="drug-warn" title="Potential drug interaction">⚠️ Interaction</span>
          )}
          {med.generic && med.generic !== med.medicine_name && (
            <span className="drug-generic">Generic: {med.generic}</span>
          )}
          {drugResults.length > 0 && (
            <div className="drug-dropdown">
              {drugResults.map((d, i) => (
                <div key={i} className="drug-option" onClick={() => selectDrug(d)}>
                  <div>
                    <strong>{d.name}</strong>
                    <span className="drug-cat">{d.category}</span>
                  </div>
                  <span className="drug-forms">{d.forms.join(' / ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Dosage */}
        <input
          className="drug-dosage-input"
          value={med.dosage}
          onChange={e => onChange(idx, { dosage: e.target.value })}
          placeholder="Dosage"
        />

        {/* Route */}
        <select
          className="drug-select"
          value={med.route}
          onChange={e => onChange(idx, { route: e.target.value })}
        >
          {ROUTES.map(r => <option key={r}>{r}</option>)}
        </select>

        <button className="drug-remove" onClick={() => onRemove(idx)}>✕</button>
      </div>

      {/* Frequency chips */}
      <div className="drug-row-mid">
        <div className="freq-group">
          {FREQ_CHIPS.map(f => (
            <button key={f}
              className={`freq-chip ${med.frequency === f ? 'freq-chip--active' : ''}`}
              onClick={() => onChange(idx, { frequency: f })}
            >{f}</button>
          ))}
        </div>

        {/* SIG checkboxes */}
        <div className="sig-group">
          {[['morning','M'], ['afternoon','A'], ['evening','E'], ['night','N']].map(([key, label]) => (
            <label key={key} className="sig-label">
              <input type="checkbox" checked={!!med[key]}
                onChange={e => onChange(idx, { [key]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Duration + stop date */}
      <div className="drug-row-bot">
        <div className="dur-group">
          {DURATIONS.map(d => (
            <button key={d}
              className={`dur-chip ${med.duration === d ? 'dur-chip--active' : ''}`}
              onClick={() => onChange(idx, { duration: d })}
            >{d}</button>
          ))}
        </div>
        {stop && <span className="drug-stop">Until: {stop}</span>}
        <input
          className="drug-instructions"
          value={med.instructions}
          onChange={e => onChange(idx, { instructions: e.target.value })}
          placeholder="Special instructions…"
        />
      </div>
    </div>
  );
}

// ─── Lab Order Section ────────────────────────────────────────────────────────
function LabSection({ labTests, selected, onChange, suggestedPanels }) {
  const [labSearch, setLabSearch] = useState('');
  const [urgencyMap, setUrgencyMap] = useState({});
  const [panelExpanded, setPanelExpanded] = useState(true);

  const selectedIds = new Set(selected.map(s => s.test_id));

  const toggle = (test) => {
    if (selectedIds.has(test.id)) {
      onChange(selected.filter(s => s.test_id !== test.id));
    } else {
      onChange([...selected, { test_id: test.id, test_name: test.test_name, urgency: urgencyMap[test.id] || 'Routine' }]);
    }
  };

  const setUrgency = (testId, urgency) => {
    setUrgencyMap(m => ({ ...m, [testId]: urgency }));
    onChange(selected.map(s => s.test_id === testId ? { ...s, urgency } : s));
  };

  // Activate a panel: add all its tests whose names match
  const activatePanel = (panel) => {
    const panelNames = panel.tests.map(t => t.toLowerCase());
    const toAdd = labTests.filter(t =>
      panelNames.some(pn => t.test_name?.toLowerCase().includes(pn)) && !selectedIds.has(t.id)
    );
    if (toAdd.length) {
      onChange([...selected, ...toAdd.map(t => ({ test_id: t.id, test_name: t.test_name, urgency: 'Routine' }))]);
    }
  };

  const filtered = labTests.filter(t => {
    if (!labSearch) return true;
    const q = labSearch.toLowerCase();
    return t.test_name?.toLowerCase().includes(q) || t.test_code?.toLowerCase().includes(q);
  });

  const URGENCY_OPTS = [
    { val: 'Routine', color: '#16a34a', icon: '🟢' },
    { val: 'ASAP',    color: '#d97706', icon: '🟡' },
    { val: 'STAT',    color: '#dc2626', icon: '🔴' },
  ];

  return (
    <div className="lab-section">
      {/* Suggested + Order Sets */}
      <div className="lab-sets-hdr" onClick={() => setPanelExpanded(e => !e)}>
        <span>📋 Order Sets / Panels</span>
        <span>{panelExpanded ? '▲' : '▼'}</span>
      </div>
      {panelExpanded && (
        <div className="lab-sets-grid">
          {LAB_ORDER_SETS.map(panel => {
            const isSuggested = suggestedPanels.includes(panel.id);
            return (
              <button key={panel.id}
                className={`lab-set-btn ${isSuggested ? 'lab-set-btn--suggested' : ''}`}
                onClick={() => activatePanel(panel)}
                title={panel.description}
              >
                <span className="lab-set-icon">{panel.icon}</span>
                <span className="lab-set-name">{panel.name}</span>
                {isSuggested && <span className="lab-set-tag">Suggested</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Selected tests */}
      {selected.length > 0 && (
        <div className="lab-selected">
          <span className="lab-selected-label">Selected ({selected.length}):</span>
          <div className="lab-selected-chips">
            {selected.map(s => (
              <div key={s.test_id} className="lab-selected-chip">
                <span>{s.test_name}</span>
                <div className="lab-urgency-btns">
                  {URGENCY_OPTS.map(u => (
                    <button key={u.val}
                      className={`lab-urg-btn ${s.urgency === u.val ? 'lab-urg-btn--active' : ''}`}
                      style={s.urgency === u.val ? { borderColor: u.color, color: u.color } : {}}
                      onClick={() => setUrgency(s.test_id, u.val)}
                      title={u.val}
                    >{u.icon}</button>
                  ))}
                </div>
                <button className="lab-chip-remove" onClick={() => toggle({ id: s.test_id })}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search & individual tests */}
      <div className="lab-search-wrap">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          className="lab-search"
          value={labSearch}
          onChange={e => setLabSearch(e.target.value)}
          placeholder="Search individual tests…"
        />
      </div>
      <div className="lab-grid">
        {filtered.slice(0, 60).map(t => (
          <label key={t.id} className={`lab-item ${selectedIds.has(t.id) ? 'lab-item--checked' : ''}`}>
            <input type="checkbox"
              checked={selectedIds.has(t.id)}
              onChange={() => toggle(t)}
            />
            <span>{t.test_name}</span>
            {t.price && <span className="lab-price">₹{t.price}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}

// ─── Symptom Chip Picker ──────────────────────────────────────────────────────
function SymptomPicker({ onAdd }) {
  const [activeSystem, setActiveSystem] = useState(ALL_SYSTEMS[0]);
  const [open, setOpen] = useState(false);

  return (
    <div className="symptom-picker">
      <button className="symptom-toggle" onClick={() => setOpen(o => !o)}>
        💊 Quick Symptoms {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="symptom-panel">
          <div className="symptom-systems">
            {ALL_SYSTEMS.map(s => (
              <button key={s}
                className={`symptom-sys ${activeSystem === s ? 'symptom-sys--active' : ''}`}
                onClick={() => setActiveSystem(s)}
              >{s}</button>
            ))}
          </div>
          <div className="symptom-chips">
            {(SYMPTOM_CHIPS[activeSystem] || []).map(sym => (
              <button key={sym} className="symptom-chip" onClick={() => { onAdd(sym); }}>
                + {sym}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Voice Dictation ─────────────────────────────────────────────────────────
function VoiceBtn({ onTranscript }) {
  const [listening, setListening] = useState(false);
  const recogRef = useRef(null);

  const toggle = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Voice dictation not supported in this browser.'); return; }
    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return;
    }
    const recog = new SpeechRecognition();
    recog.continuous = true;
    recog.interimResults = false;
    recog.lang = 'en-IN';
    recog.onresult = e => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join(' ');
      onTranscript(transcript);
    };
    recog.onend = () => setListening(false);
    recog.start();
    recogRef.current = recog;
    setListening(true);
  };

  return (
    <button className={`voice-btn ${listening ? 'voice-btn--active' : ''}`} onClick={toggle}
      title={listening ? 'Stop dictation' : 'Start voice dictation (Web Speech API)'}>
      🎙 {listening ? 'Listening…' : 'Dictate'}
    </button>
  );
}

// ─── Template Picker ──────────────────────────────────────────────────────────
function TemplatePicker({ onApply }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tmpl-wrap">
      <button className="tmpl-btn" onClick={() => setOpen(o => !o)}>📋 Templates {open ? '▲' : '▼'}</button>
      {open && (
        <div className="tmpl-dropdown">
          {CONSULTATION_TEMPLATES.map(t => (
            <button key={t.id} className="tmpl-option" onClick={() => { onApply(t); setOpen(false); }}>
              {t.icon} {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Timer ────────────────────────────────────────────────────────────────────
function ConsultTimer({ startTime }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startTime]);
  const m = Math.floor(elapsed / 60), s = elapsed % 60;
  return (
    <span className="consult-timer">
      ⏱ {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </span>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
function Progress({ soap, rx, labs }) {
  const filled = [
    soap.chiefComplaints?.trim(),
    soap.history?.trim(),
    soap.examination?.trim(),
    soap.diagnosis?.trim(),
    rx.length > 0,
    labs.length > 0,
  ].filter(Boolean).length;
  const pct = Math.round((filled / 6) * 100);
  const color = pct < 40 ? '#dc2626' : pct < 80 ? '#d97706' : '#16a34a';
  return (
    <div className="progress-wrap" title={`${pct}% complete`}>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="progress-label" style={{ color }}>{pct}%</span>
    </div>
  );
}

// ─── Main ConsultationWorkspace ───────────────────────────────────────────────
export default function ConsultationWorkspace({ appointment: appt, onClose }) {
  const token = localStorage.getItem('hims_token');
  const doctorId = localStorage.getItem('user_id') || localStorage.getItem('id');
  const startTime = useRef(Date.now());

  // ── State ──
  const [vitals, setVitals] = useState({ height: '', weight: '', bp_systolic: '', bp_diastolic: '', pulse: '', temperature: '', spo2: '' });
  const [soap, setSoap] = useState({ chiefComplaints: '', history: '', examination: '', diagnosis: '', followUp: '', patientInstructions: '' });
  const [icd10Codes, setIcd10Codes] = useState([]);
  const [rx, setRx] = useState([emptyMed()]);
  const [selectedLabs, setSelectedLabs] = useState([]);
  const [labTests, setLabTests] = useState([]);
  const [history, setHistory] = useState([]);
  const [labTrends, setLabTrends] = useState({});
  const [rxTemplates, setRxTemplates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [activeSection, setActiveSection] = useState('soap');
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [showCertModal, setShowCertModal] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [showTimelineModal, setShowTimelineModal] = useState(false);
  const [showScribeModal, setShowScribeModal] = useState(false);
  const [autoBillingStatus, setAutoBillingStatus] = useState(null); // null | 'sending' | 'done'

  const bmi = calcBMI(vitals.height, vitals.weight);
  const interactions = checkInteractions(rx.filter(r => r.medicine_name));
  const suggestedPanels = suggestLabPanels(icd10Codes);

  // ── Load data ──
  useEffect(() => {
    const apptId = appt.appointment_id;

    // Restore draft
    const draft = localStorage.getItem(DRAFT_KEY(apptId));
    if (draft) {
      try {
        const d = JSON.parse(draft);
        if (d.ts && Date.now() - d.ts < 24 * 3600 * 1000) {
          if (d.vitals) setVitals(d.vitals);
          if (d.soap) setSoap(d.soap);
          if (d.icd10Codes) setIcd10Codes(d.icd10Codes);
          if (d.rx) setRx(d.rx);
          if (d.selectedLabs) setSelectedLabs(d.selectedLabs);
          setDraftRestored(true);
        }
      } catch {}
    }

    // Fetch existing consultation
    fetch(`/api/consultations/${apptId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        if (!data.consultation) return;
        const c = data.consultation;
        setSoap(s => ({
          ...s,
          chiefComplaints: c.chief_complaints || '',
          history: c.soap_history || c.doctor_notes || '',
          examination: c.soap_exam || '',
          diagnosis: c.diagnosis || '',
          followUp: c.follow_up_date || '',
          patientInstructions: c.patient_instructions || '',
        }));
        if (c.icd10_codes?.length) setIcd10Codes(c.icd10_codes);
        if (c.vitals) setVitals(v => ({ ...v, ...c.vitals }));
        if (c.prescriptions?.length) {
          setRx(c.prescriptions.map(p => ({
            ...emptyMed(),
            medicine_name: p.medicine_name || '',
            dosage: p.dosage || '',
            frequency: p.frequency || '',
            duration: p.duration || '',
            route: p.route || 'Oral',
            instructions: p.instructions || '',
            morning: !!p.sig_morning, afternoon: !!p.sig_afternoon,
            evening: !!p.sig_evening, night: !!p.sig_night,
          })));
        }
        if (c.labOrders?.length) {
          setSelectedLabs(c.labOrders.map(o => ({
            test_id: o.test_id, test_name: o.test_name, urgency: o.urgency || 'Routine',
          })));
        }
      })
      .catch(() => {});

    // Patient history
    fetch(`/api/consultations/patient/${appt.reg_no}/history`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.success) setHistory(d.history || []); })
      .catch(() => {});

    // Lab tests
    fetch('/api/lab/tests?limit=300', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setLabTests(d.tests || d.data || []))
      .catch(() => {});

    // Lab trends
    fetch(`/api/consultations/patient/${appt.reg_no}/lab-trends`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.success) setLabTrends(d.trends || {}); })
      .catch(() => {});

    // Rx templates
    if (doctorId) {
      fetch(`/api/consultations/templates/${doctorId}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => { if (d.success) setRxTemplates(d.templates || []); })
        .catch(() => {});
    }
  }, [appt.appointment_id, appt.reg_no]);

  // ── Auto-save draft ──
  useEffect(() => {
    const t = setInterval(() => {
      localStorage.setItem(DRAFT_KEY(appt.appointment_id), JSON.stringify({
        ts: Date.now(), vitals, soap, icd10Codes, rx, selectedLabs,
      }));
    }, 20000);
    return () => clearInterval(t);
  }, [vitals, soap, icd10Codes, rx, selectedLabs, appt.appointment_id]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); handlePrint(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [vitals, soap, icd10Codes, rx, selectedLabs]);

  // ── Vitals helpers ──
  const updateVital = (k, v) => setVitals(prev => ({ ...prev, [k]: v }));
  const updateSoap = (k, v) => setSoap(prev => ({ ...prev, [k]: v }));
  const updateMed = (idx, patch) => setRx(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  const removeMed = (idx) => setRx(prev => prev.filter((_, i) => i !== idx));
  const addMed = () => setRx(prev => [...prev, emptyMed()]);

  // Apply template
  const applyTemplate = (tmpl) => {
    setSoap(s => ({
      ...s,
      chiefComplaints: tmpl.soap.chiefComplaints || '',
      history: tmpl.soap.history || '',
      examination: tmpl.soap.examination || '',
      diagnosis: tmpl.soap.diagnosis || '',
    }));
    if (tmpl.soap.icd10Codes?.length) setIcd10Codes(tmpl.soap.icd10Codes);
    if (tmpl.prescriptions?.length) setRx(tmpl.prescriptions.map(p => ({ ...emptyMed(), ...p })));
  };

  // Save Rx template
  const saveRxTemplate = async () => {
    if (!templateNameInput.trim() || !doctorId) return;
    const validRx = rx.filter(r => r.medicine_name?.trim());
    if (!validRx.length) return;
    try {
      const res = await fetch('/api/consultations/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ doctorId, templateName: templateNameInput.trim(), medicines: validRx }),
      });
      const d = await res.json();
      if (d.success) {
        setRxTemplates(prev => [{ id: d.templateId, template_name: templateNameInput.trim(), medicines: validRx }, ...prev]);
        setTemplateNameInput('');
        setSaveTemplateOpen(false);
      }
    } catch {}
  };

  // Load Rx template
  const loadRxTemplate = (tmpl) => {
    setRx(tmpl.medicines.map(m => ({ ...emptyMed(), ...m, _id: Math.random().toString(36).slice(2) })));
  };

  // ── Save ──
  const handleSave = async () => {
    setSaving(true);
    try {
      const body = {
        appointmentId: appt.appointment_id,
        doctorId,
        patientRegNo: appt.reg_no,
        chiefComplaints: soap.chiefComplaints,
        diagnosis: soap.diagnosis,
        notes: soap.history,
        soapHistory: soap.history,
        soapExam: soap.examination,
        followUpDate: soap.followUp || null,
        patientInstructions: soap.patientInstructions,
        icd10Codes,
        vitals,
        prescriptions: rx.filter(r => r.medicine_name?.trim()),
        labOrders: selectedLabs,
      };
      const res = await fetch('/api/consultations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setSavedOk(true);
        localStorage.removeItem(DRAFT_KEY(appt.appointment_id));
        // Show post-visit summary
        setShowSummaryModal(true);
        setTimeout(() => setSavedOk(false), 3000);
      }
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  // ── Auto-bill ──
  const handleAutoBill = async () => {
    setAutoBillingStatus('sending');
    try {
      const res = await fetch('/api/consultations/auto-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          consultationId: null,
          patientRegNo: appt.reg_no,
          doctorId,
          prescriptions: rx.filter(r => r.medicine_name?.trim()),
          labOrders: selectedLabs,
        }),
      });
      const data = await res.json();
      if (data.success) setAutoBillingStatus(`done_${data.billId}`);
      else setAutoBillingStatus('error');
    } catch { setAutoBillingStatus('error'); }
    setTimeout(() => setAutoBillingStatus(null), 4000);
  };

  // ── Print ──
  const handlePrint = () => {
    const name = [appt.first_name, appt.last_name].filter(Boolean).join(' ');
    const age = calcAge(appt.dob);
    const hospital = localStorage.getItem('hospital_name') || 'Hospital';
    const icd = icd10Codes.map(c => `${c.code} — ${c.description}`).join('; ');
    const qrData = `${appt.reg_no}|${appt.appointment_id}|${new Date().toISOString().split('T')[0]}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(qrData)}`;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Prescription</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #1e293b; }
      .rx-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #4f46e5; padding-bottom: 10px; margin-bottom: 14px; }
      .rx-hospital { font-size: 1.2rem; font-weight: 700; color: #4f46e5; }
      .rx-sub { font-size: 0.75rem; color: #64748b; }
      .rx-patient { background: #f8fafc; border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; display: flex; gap: 30px; font-size: 0.88rem; }
      .rx-vitals { background: #eef2ff; border-radius: 8px; padding: 8px 14px; margin-bottom: 14px; font-size: 0.82rem; display: flex; gap: 16px; flex-wrap: wrap; }
      .rx-section { margin-bottom: 12px; }
      .rx-section h3 { font-size: 0.82rem; font-weight: 700; color: #4f46e5; text-transform: uppercase; margin: 0 0 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 2px; }
      .rx-section p { margin: 4px 0; font-size: 0.88rem; white-space: pre-wrap; }
      .med-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
      .med-table th { background: #4f46e5; color: #fff; padding: 6px 10px; text-align: left; }
      .med-table td { border-bottom: 1px solid #e2e8f0; padding: 6px 10px; }
      .med-table tr:nth-child(even) td { background: #f8fafc; }
      .lab-list { display: flex; flex-wrap: wrap; gap: 6px; }
      .lab-tag { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 3px 10px; font-size: 0.78rem; }
      .rx-footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 30px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 0.75rem; color: #64748b; }
      .rx-sig { border-top: 1px solid #1e293b; width: 180px; text-align: center; padding-top: 4px; font-size: 0.75rem; }
      @media print { body { margin: 0; } }
    </style></head><body>
    <div class="rx-header">
      <div><div class="rx-hospital">${hospital}</div><div class="rx-sub">e-Prescription</div></div>
      <div style="text-align:right">
        <div style="font-size:0.75rem;color:#64748b">Date: ${new Date().toLocaleDateString('en-IN')}</div>
        <img src="${qrUrl}" alt="QR" style="margin-top:4px" />
      </div>
    </div>
    <div class="rx-patient">
      <div><strong>Name:</strong> ${name}</div>
      <div><strong>Age/Gender:</strong> ${age ? age + 'y' : '—'} / ${appt.gender || '—'}</div>
      <div><strong>Reg No:</strong> ${appt.reg_no}</div>
    </div>
    ${Object.values(vitals).some(v => v) ? `
    <div class="rx-vitals">
      ${vitals.bp_systolic ? `<span><strong>BP:</strong> ${vitals.bp_systolic}/${vitals.bp_diastolic} mmHg</span>` : ''}
      ${vitals.pulse ? `<span><strong>Pulse:</strong> ${vitals.pulse} bpm</span>` : ''}
      ${vitals.temperature ? `<span><strong>Temp:</strong> ${vitals.temperature}°F</span>` : ''}
      ${vitals.spo2 ? `<span><strong>SpO₂:</strong> ${vitals.spo2}%</span>` : ''}
      ${vitals.weight ? `<span><strong>Wt:</strong> ${vitals.weight} kg</span>` : ''}
      ${bmi ? `<span><strong>BMI:</strong> ${bmi.val} (${bmi.cat})</span>` : ''}
    </div>` : ''}
    ${soap.chiefComplaints ? `<div class="rx-section"><h3>Chief Complaints</h3><p>${soap.chiefComplaints}</p></div>` : ''}
    ${soap.diagnosis ? `<div class="rx-section"><h3>Diagnosis${icd ? ' (ICD-10)' : ''}</h3><p>${soap.diagnosis}${icd ? '\n' + icd : ''}</p></div>` : ''}
    ${rx.filter(r => r.medicine_name).length > 0 ? `
    <div class="rx-section"><h3>℞ Prescription</h3>
    <table class="med-table">
      <thead><tr><th>#</th><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead>
      <tbody>
        ${rx.filter(r => r.medicine_name).map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${r.medicine_name}${r.generic && r.generic !== r.medicine_name ? `<br><small style="color:#64748b">${r.generic}</small>` : ''}</td>
          <td>${r.dosage}</td>
          <td>${r.frequency}</td>
          <td>${r.duration}${stopDate(r.duration) ? `<br><small>Until ${stopDate(r.duration)}</small>` : ''}</td>
          <td>${r.instructions}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>` : ''}
    ${selectedLabs.length > 0 ? `
    <div class="rx-section"><h3>Lab Investigations</h3>
    <div class="lab-list">
      ${selectedLabs.map(l => `<span class="lab-tag">${l.urgency === 'STAT' ? '🔴 ' : l.urgency === 'ASAP' ? '🟡 ' : ''}${l.test_name}</span>`).join('')}
    </div></div>` : ''}
    ${soap.followUp ? `<div class="rx-section"><h3>Follow-up</h3><p>${soap.followUp}</p></div>` : ''}
    ${soap.patientInstructions ? `<div class="rx-section"><h3>Patient Instructions</h3><p>${soap.patientInstructions}</p></div>` : ''}
    <div class="rx-footer">
      <div>
        <div>Reg No: ${appt.reg_no} | ${new Date().toLocaleString('en-IN')}</div>
        <div style="margin-top:4px;color:#94a3b8;font-size:10px">This is a digitally generated prescription.</div>
      </div>
      <div class="rx-sig">Dr. ${appt.doctor || ''}<br/>Signature</div>
    </div>
    </body></html>`;
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  // WhatsApp share
  const handleWhatsApp = () => {
    const name = [appt.first_name, appt.last_name].filter(Boolean).join(' ');
    let msg = `*Prescription — ${name}*\nDate: ${new Date().toLocaleDateString('en-IN')}\n\n`;
    if (soap.diagnosis) msg += `*Diagnosis:* ${soap.diagnosis}\n\n`;
    if (rx.filter(r => r.medicine_name).length) {
      msg += `*Medicines:*\n`;
      rx.filter(r => r.medicine_name).forEach((r, i) => {
        msg += `${i + 1}. ${r.medicine_name} — ${r.dosage} — ${r.frequency} — ${r.duration}\n`;
        if (r.instructions) msg += `   (${r.instructions})\n`;
      });
    }
    if (selectedLabs.length) msg += `\n*Lab Tests:* ${selectedLabs.map(l => l.test_name).join(', ')}`;
    if (soap.followUp) msg += `\n\n*Follow-up:* ${soap.followUp}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const patientName = [appt.first_name, appt.last_name].filter(Boolean).join(' ');
  const age = calcAge(appt.dob);

  return (
    <>
      <style>{CSS}</style>
      <div className="cwa-overlay">
        <div className="cwa-panel">

          {/* ── Top Bar ── */}
          <div className="cwa-topbar">
            <div className="cwa-topbar-left">
              <div className="cwa-patient-pill">
                <div className="cwa-pt-avatar">
                  {appt.photo_base64
                    ? <img src={`data:image/jpeg;base64,${appt.photo_base64}`} alt="" />
                    : <span>{initials(appt.first_name, appt.last_name)}</span>
                  }
                </div>
                <div>
                  <span className="cwa-pt-name">{patientName}</span>
                  <span className="cwa-pt-meta">{age ? `${age}y` : ''} {appt.gender || ''} · {appt.reg_no}</span>
                </div>
              </div>
              <ConsultTimer startTime={startTime.current} />
              <Progress soap={soap} rx={rx.filter(r => r.medicine_name)} labs={selectedLabs} />
              {draftRestored && <span className="cwa-draft-badge">Draft restored</span>}
              {savedOk && <span className="cwa-saved-badge">✓ Saved</span>}
            </div>
            <div className="cwa-topbar-right">
              <button className="cwa-action-btn" onClick={() => setShowScribeModal(true)} title="Ambient AI Scribe (voice)">
                🎙 Scribe
              </button>
              <button className="cwa-action-btn" onClick={() => setShowTimelineModal(true)} title="Patient history timeline">
                ⏱ Timeline
              </button>
              <button className="cwa-action-btn" onClick={() => setShowCertModal(true)} title="Generate medical certificate">
                📄 Cert
              </button>
              <button className="cwa-action-btn" onClick={() => setRightPanelOpen(o => !o)} title="Toggle patient context panel">
                📋 Context
              </button>
              <button className="cwa-action-btn" onClick={handleWhatsApp} title="Share via WhatsApp">
                📱 WhatsApp
              </button>
              <button className="cwa-action-btn" onClick={handlePrint}>🖨 Print</button>
              <button
                className="cwa-action-btn"
                onClick={handleAutoBill}
                disabled={autoBillingStatus === 'sending'}
                title="Auto-generate bill from this consultation"
                style={autoBillingStatus?.startsWith('done') ? { background: '#dcfce7', color: '#15803d' } : {}}
              >
                {autoBillingStatus === 'sending' ? '…' : autoBillingStatus?.startsWith('done') ? '✓ Billed' : '💳 Bill'}
              </button>
              <button className="cwa-save-btn" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : '💾 Save'}
              </button>
              <button className="cwa-close-btn" onClick={onClose}>✕</button>
            </div>
          </div>

          {/* ── Body ── */}
          <div className="cwa-body">

            {/* ── Left Panel ── */}
            <div className="cwa-left">
              {/* Patient card */}
              <div className="cwa-patient-card">
                <div className="cwa-pt-photo">
                  {appt.photo_base64
                    ? <img src={`data:image/jpeg;base64,${appt.photo_base64}`} alt="" />
                    : <div className="cwa-pt-initials">{initials(appt.first_name, appt.last_name)}</div>
                  }
                </div>
                <div className="cwa-pt-details">
                  <div className="cwa-pt-fullname">{patientName}</div>
                  <div className="cwa-pt-row"><span>Age</span><strong>{age ? `${age} yrs` : '—'}</strong></div>
                  <div className="cwa-pt-row"><span>Gender</span><strong>{appt.gender || '—'}</strong></div>
                  <div className="cwa-pt-row"><span>Reg No</span><strong>{appt.reg_no}</strong></div>
                  {appt.telephone && <div className="cwa-pt-row"><span>Phone</span><strong>{appt.telephone}</strong></div>}
                  {appt.department && <div className="cwa-pt-row"><span>Dept</span><strong>{appt.department}</strong></div>}
                </div>
              </div>

              {/* Vitals */}
              <div className="cwa-vitals-section">
                <div className="cwa-section-hdr">Vitals</div>
                <div className="cwa-vitals-grid">
                  {[
                    { key: 'height',       label: 'Height',  unit: 'cm',   icon: '📏' },
                    { key: 'weight',       label: 'Weight',  unit: 'kg',   icon: '⚖️' },
                    { key: 'bp_systolic',  label: 'BP Sys',  unit: 'mmHg', icon: '💉' },
                    { key: 'bp_diastolic', label: 'BP Dia',  unit: 'mmHg', icon: '💉' },
                    { key: 'pulse',        label: 'Pulse',   unit: 'bpm',  icon: '❤️' },
                    { key: 'temperature',  label: 'Temp',    unit: '°F',   icon: '🌡' },
                    { key: 'spo2',         label: 'SpO₂',   unit: '%',    icon: '🫁' },
                  ].map(f => (
                    <div key={f.key} className="cwa-vital-box">
                      <label>{f.icon} {f.label}</label>
                      <div className="cwa-vital-input-wrap">
                        <input
                          type="number"
                          value={vitals[f.key]}
                          onChange={e => updateVital(f.key, e.target.value)}
                          placeholder="—"
                        />
                        <span>{f.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {bmi && (
                  <div className="cwa-bmi" style={{ color: bmi.color }}>
                    BMI: {bmi.val} — {bmi.cat}
                  </div>
                )}
              </div>

              {/* Past Visits */}
              {history.length > 0 && (
                <div className="cwa-history-section">
                  <div className="cwa-section-hdr">Past Visits ({history.length})</div>
                  {history.slice(0, 5).map((h, i) => (
                    <div key={i} className="cwa-hist-card">
                      <div className="cwa-hist-date">
                        {new Date(h.appt_date || h.consultation_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                      {h.diagnosis && <div className="cwa-hist-dx">{h.diagnosis}</div>}
                      {h.prescriptions?.length > 0 && (
                        <div className="cwa-hist-rx">
                          {h.prescriptions.slice(0, 2).map((p, j) => (
                            <span key={j} className="cwa-hist-rx-chip">{p.medicine_name}</span>
                          ))}
                          {h.prescriptions.length > 2 && <span className="cwa-hist-rx-chip">+{h.prescriptions.length - 2}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Center: Main work area ── */}
            <div className="cwa-center">

              {/* Section nav tabs */}
              <div className="cwa-tabs">
                {[
                  { id: 'soap', label: '📝 SOAP Notes' },
                  { id: 'rx',   label: '💊 Prescriptions' },
                  { id: 'lab',  label: '🔬 Lab Orders' },
                ].map(tab => (
                  <button key={tab.id}
                    className={`cwa-tab ${activeSection === tab.id ? 'cwa-tab--active' : ''}`}
                    onClick={() => setActiveSection(tab.id)}
                  >{tab.label}</button>
                ))}
              </div>

              {/* ── SOAP Notes ── */}
              {activeSection === 'soap' && (
                <div className="cwa-soap">
                  {/* Templates + quick actions */}
                  <div className="soap-actions">
                    <TemplatePicker onApply={applyTemplate} />
                    {history.length > 0 && (
                      <button className="soap-copy-btn" onClick={() => {
                        const last = history[0];
                        if (last) {
                          setSoap(s => ({
                            ...s,
                            chiefComplaints: last.chief_complaints || s.chiefComplaints,
                            history: last.soap_history || last.doctor_notes || s.history,
                          }));
                        }
                      }}>↩ Copy from last visit</button>
                    )}
                  </div>

                  {/* S — Subjective */}
                  <div className="soap-block">
                    <div className="soap-block-hdr">
                      <span className="soap-label">S — Subjective</span>
                      <VoiceBtn onTranscript={t => updateSoap('chiefComplaints', soap.chiefComplaints + ' ' + t)} />
                    </div>
                    <SymptomPicker onAdd={sym => updateSoap('chiefComplaints', soap.chiefComplaints ? soap.chiefComplaints + ', ' + sym : sym)} />
                    <textarea
                      className="soap-textarea"
                      rows={4}
                      value={soap.chiefComplaints}
                      onChange={e => updateSoap('chiefComplaints', e.target.value)}
                      placeholder="Chief complaints and history of presenting illness…"
                    />
                    <div className="soap-char">{soap.chiefComplaints.length} chars</div>
                  </div>

                  {/* O — Objective */}
                  <div className="soap-block">
                    <div className="soap-block-hdr">
                      <span className="soap-label">O — Objective</span>
                      <VoiceBtn onTranscript={t => updateSoap('examination', soap.examination + ' ' + t)} />
                    </div>
                    <div className="soap-quick-exam">
                      {['General', 'Cardiovascular', 'Respiratory', 'Abdomen', 'CNS', 'MSK'].map(sys => (
                        <button key={sys} className="soap-nad-btn"
                          onClick={() => updateSoap('examination', soap.examination + `\n${sys}: No abnormality detected.`)}>
                          + {sys}
                        </button>
                      ))}
                    </div>
                    <textarea
                      className="soap-textarea"
                      rows={4}
                      value={soap.examination}
                      onChange={e => updateSoap('examination', e.target.value)}
                      placeholder="Physical examination findings…"
                    />
                  </div>

                  {/* A — Assessment */}
                  <div className="soap-block">
                    <div className="soap-block-hdr">
                      <span className="soap-label">A — Assessment</span>
                    </div>
                    <textarea
                      className="soap-textarea"
                      rows={3}
                      value={soap.diagnosis}
                      onChange={e => updateSoap('diagnosis', e.target.value)}
                      placeholder="Diagnosis / clinical impression…"
                    />
                    <div className="soap-icd-label">ICD-10 Codes</div>
                    <ICD10Picker selected={icd10Codes} onChange={setIcd10Codes} />
                  </div>

                  {/* P — Plan */}
                  <div className="soap-block">
                    <div className="soap-block-hdr">
                      <span className="soap-label">P — Plan</span>
                    </div>
                    <div className="soap-plan-row">
                      <div style={{ flex: 1 }}>
                        <label className="soap-field-label">Follow-up Date</label>
                        <div className="soap-followup-row">
                          <input type="date" className="soap-date-input"
                            value={soap.followUp}
                            onChange={e => updateSoap('followUp', e.target.value)}
                          />
                          <div className="soap-followup-presets">
                            {[
                              { label: '1 Week', days: 7 }, { label: '2 Weeks', days: 14 },
                              { label: '1 Month', days: 30 }, { label: '3 Months', days: 90 },
                            ].map(p => (
                              <button key={p.label} className="soap-preset-btn" onClick={() => {
                                const d = new Date(); d.setDate(d.getDate() + p.days);
                                updateSoap('followUp', d.toISOString().split('T')[0]);
                              }}>{p.label}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    <label className="soap-field-label" style={{ marginTop: 10 }}>Patient Instructions</label>
                    <textarea
                      className="soap-textarea"
                      rows={3}
                      value={soap.patientInstructions}
                      onChange={e => updateSoap('patientInstructions', e.target.value)}
                      placeholder="Instructions for the patient (diet, activity, red flags)…"
                    />
                  </div>
                </div>
              )}

              {/* ── Prescriptions ── */}
              {activeSection === 'rx' && (
                <div className="cwa-rx">
                  {/* Rx Templates */}
                  <div className="rx-tmpl-row">
                    {rxTemplates.length > 0 && (
                      <div className="rx-tmpl-chips">
                        <span className="rx-tmpl-label">⭐ Saved:</span>
                        {rxTemplates.map(t => (
                          <button key={t.id} className="rx-tmpl-chip" onClick={() => loadRxTemplate(t)}
                            title={`Load: ${t.template_name}`}>
                            {t.template_name}
                          </button>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      {!saveTemplateOpen ? (
                        <button className="rx-save-tmpl-btn" onClick={() => setSaveTemplateOpen(true)}>
                          ⭐ Save as Template
                        </button>
                      ) : (
                        <div className="rx-tmpl-save-form">
                          <input
                            value={templateNameInput}
                            onChange={e => setTemplateNameInput(e.target.value)}
                            placeholder="Template name…"
                          />
                          <button onClick={saveRxTemplate}>Save</button>
                          <button onClick={() => setSaveTemplateOpen(false)}>Cancel</button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Drug interactions banner */}
                  {interactions.length > 0 && (
                    <div className="rx-interaction-banner">
                      ⚠️ <strong>Drug Interaction Alert:</strong>{' '}
                      {interactions.map((w, i) => (
                        <span key={i}>{w.drug1} + {w.drug2}{i < interactions.length - 1 ? ' | ' : ''}</span>
                      ))}
                    </div>
                  )}

                  {/* Drug rows */}
                  {rx.map((med, idx) => (
                    <DrugRow key={med._id} med={med} idx={idx}
                      onChange={updateMed} onRemove={removeMed} interactions={interactions} />
                  ))}
                  <button className="rx-add-btn" onClick={addMed}>+ Add Medicine</button>
                </div>
              )}

              {/* ── Lab Orders ── */}
              {activeSection === 'lab' && (
                <LabSection
                  labTests={labTests}
                  selected={selectedLabs}
                  onChange={setSelectedLabs}
                  suggestedPanels={suggestedPanels}
                />
              )}
            </div>

            {/* ── Right Context Panel ── */}
            {rightPanelOpen && (
              <div className="cwa-right">
                <div className="cwa-section-hdr">Patient Context</div>

                {/* Allergies */}
                <div className="ctx-block">
                  <div className="ctx-block-title">⛔ Allergies</div>
                  <div className="ctx-placeholder">No allergies recorded. Add via Patient Profile.</div>
                </div>

                {/* Active problems */}
                <div className="ctx-block">
                  <div className="ctx-block-title">🏥 Diagnosis History</div>
                  {history.length > 0 ? (
                    <div className="ctx-dx-list">
                      {[...new Set(history.map(h => h.diagnosis).filter(Boolean))].slice(0, 6).map((dx, i) => (
                        <span key={i} className="ctx-dx-chip">{dx}</span>
                      ))}
                    </div>
                  ) : <div className="ctx-placeholder">No history available.</div>}
                </div>

                {/* Current medications */}
                <div className="ctx-block">
                  <div className="ctx-block-title">💊 Previous Medications</div>
                  {history.length > 0 && history[0]?.prescriptions?.length > 0 ? (
                    <div className="ctx-med-list">
                      {history[0].prescriptions.map((p, i) => (
                        <div key={i} className="ctx-med-row">
                          <span>{p.medicine_name}</span>
                          <span className="ctx-med-freq">{p.frequency}</span>
                        </div>
                      ))}
                    </div>
                  ) : <div className="ctx-placeholder">No previous medicines.</div>}
                </div>

                {/* Vitals trending */}
                <div className="ctx-block">
                  <div className="ctx-block-title">📈 Vitals Trend</div>
                  {history.filter(h => h.vitals).length >= 2 ? (
                    <div className="ctx-trends">
                      {['bp_systolic', 'weight', 'spo2'].map(key => {
                        const vals = history.filter(h => h.vitals?.[key]).map(h => parseFloat(h.vitals[key])).reverse();
                        if (!vals.length) return null;
                        const labels = { bp_systolic: 'BP Sys', weight: 'Weight', spo2: 'SpO₂' };
                        const colors = { bp_systolic: '#dc2626', weight: '#d97706', spo2: '#2563eb' };
                        return (
                          <div key={key} className="ctx-trend-row">
                            <span className="ctx-trend-label">{labels[key]}</span>
                            <Sparkline values={vals} color={colors[key]} />
                            <span className="ctx-trend-last">{vals[vals.length - 1]}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : <div className="ctx-placeholder">Need 2+ visits for trend.</div>}
                </div>

                {/* Lab trends */}
                {Object.keys(labTrends).length > 0 && (
                  <div className="ctx-block">
                    <div className="ctx-block-title">🔬 Recent Lab Results</div>
                    {Object.entries(labTrends).slice(0, 6).map(([name, results]) => {
                      const last = results[0];
                      const prev = results[1];
                      const arrow = prev && last.result_value && prev.result_value
                        ? parseFloat(last.result_value) > parseFloat(prev.result_value) ? '↑' : '↓'
                        : '';
                      return (
                        <div key={name} className="ctx-lab-row">
                          <span className="ctx-lab-name">{name}</span>
                          <span className="ctx-lab-val">
                            {last.result_value} {last.result_unit}
                            {arrow && <span style={{ color: arrow === '↑' ? '#dc2626' : '#16a34a' }}> {arrow}</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      {showCertModal && (
        <CertificateGenerator
          appt={appt}
          soap={soap}
          icd10Codes={icd10Codes}
          onClose={() => setShowCertModal(false)}
        />
      )}
      {showSummaryModal && (
        <PostVisitSummary
          appt={appt}
          soap={soap}
          prescriptions={rx.filter(r => r.medicine_name?.trim())}
          labOrders={selectedLabs}
          icd10Codes={icd10Codes}
          followUpDate={soap.followUp}
          onClose={() => setShowSummaryModal(false)}
        />
      )}
      {showTimelineModal && (
        <PatientTimeline
          regNo={appt.reg_no}
          patientName={[appt.first_name, appt.last_name].filter(Boolean).join(' ')}
          onClose={() => setShowTimelineModal(false)}
        />
      )}
      {showScribeModal && (
        <AmbientScribe
          onApplySOAP={(scribeResult) => {
            setSoap(prev => ({
              ...prev,
              chiefComplaints: scribeResult.chiefComplaints
                ? (prev.chiefComplaints ? prev.chiefComplaints + '\n' + scribeResult.chiefComplaints : scribeResult.chiefComplaints)
                : prev.chiefComplaints,
              history: scribeResult.soapHistory
                ? (prev.history ? prev.history + '\n' + scribeResult.soapHistory : scribeResult.soapHistory)
                : prev.history,
              examination: scribeResult.soapExam
                ? (prev.examination ? prev.examination + '\n' + scribeResult.soapExam : scribeResult.soapExam)
                : prev.examination,
              diagnosis: scribeResult.diagnosis
                ? (prev.diagnosis ? prev.diagnosis + '\n' + scribeResult.diagnosis : scribeResult.diagnosis)
                : prev.diagnosis,
            }));
          }}
          onClose={() => setShowScribeModal(false)}
        />
      )}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const CSS = `
  .cwa-overlay {
    position: fixed; inset: 0; background: rgba(15,23,42,.65); z-index: 1000;
    display: flex; align-items: stretch; justify-content: center;
    backdrop-filter: blur(3px);
  }
  .cwa-panel {
    background: #f8fafc; width: 100%; max-width: 1500px; display: flex;
    flex-direction: column; overflow: hidden; box-shadow: 0 24px 80px rgba(0,0,0,.35);
  }

  /* Top Bar */
  .cwa-topbar {
    display: flex; align-items: center; justify-content: space-between;
    background: linear-gradient(135deg,#312e81,#4f46e5,#6366f1);
    padding: 10px 18px; gap: 14px; flex-shrink: 0; flex-wrap: wrap;
  }
  .cwa-topbar-left { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .cwa-topbar-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

  .cwa-patient-pill {
    display: flex; align-items: center; gap: 10px;
    background: rgba(255,255,255,.15); border-radius: 99px; padding: 5px 14px 5px 6px;
  }
  .cwa-pt-avatar {
    width: 34px; height: 34px; border-radius: 50%;
    background: rgba(255,255,255,.25); display: flex; align-items: center;
    justify-content: center; font-weight: 700; color: #fff; font-size: 0.85rem; overflow: hidden;
  }
  .cwa-pt-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .cwa-pt-name { color: #fff; font-weight: 600; font-size: 0.9rem; display: block; }
  .cwa-pt-meta { color: rgba(255,255,255,.7); font-size: 0.72rem; display: block; }

  .consult-timer {
    color: rgba(255,255,255,.85); font-size: 0.8rem; font-variant-numeric: tabular-nums;
    background: rgba(255,255,255,.12); padding: 4px 10px; border-radius: 99px;
  }
  .progress-wrap { display: flex; align-items: center; gap: 6px; }
  .progress-bar { width: 80px; height: 5px; background: rgba(255,255,255,.25); border-radius: 99px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 99px; transition: width .4s; }
  .progress-label { font-size: 0.7rem; color: rgba(255,255,255,.8); font-weight: 600; }
  .cwa-draft-badge { font-size: 0.72rem; background: #fef3c7; color: #92400e; padding: 3px 10px; border-radius: 99px; }
  .cwa-saved-badge { font-size: 0.72rem; background: #f0fdf4; color: #15803d; padding: 3px 10px; border-radius: 99px; font-weight: 600; }

  .cwa-action-btn {
    padding: 6px 12px; border: 1.5px solid rgba(255,255,255,.3); border-radius: 7px;
    background: rgba(255,255,255,.12); color: #fff; font-size: 0.8rem; cursor: pointer;
    transition: background .15s;
  }
  .cwa-action-btn:hover { background: rgba(255,255,255,.22); }
  .cwa-save-btn {
    padding: 7px 16px; background: #fff; color: #4f46e5; border: none;
    border-radius: 8px; font-size: 0.85rem; font-weight: 700; cursor: pointer;
    transition: opacity .15s;
  }
  .cwa-save-btn:hover { opacity: .88; }
  .cwa-save-btn:disabled { opacity: .5; cursor: not-allowed; }
  .cwa-close-btn {
    width: 30px; height: 30px; border: none; border-radius: 50%;
    background: rgba(255,255,255,.15); color: #fff; font-size: 1rem;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: background .15s;
  }
  .cwa-close-btn:hover { background: rgba(255,255,255,.3); }

  /* Body layout */
  .cwa-body { display: flex; flex: 1; overflow: hidden; min-height: 0; }

  /* Left panel */
  .cwa-left {
    width: 270px; flex-shrink: 0; background: #fff; border-right: 1.5px solid #e2e8f0;
    overflow-y: auto; display: flex; flex-direction: column; gap: 0;
  }
  .cwa-left::-webkit-scrollbar { width: 4px; }
  .cwa-left::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 99px; }

  .cwa-patient-card { padding: 14px; border-bottom: 1.5px solid #f1f5f9; }
  .cwa-pt-photo {
    width: 60px; height: 60px; border-radius: 50%; overflow: hidden;
    background: linear-gradient(135deg,#4f46e5,#818cf8);
    display: flex; align-items: center; justify-content: center; margin: 0 auto 10px;
  }
  .cwa-pt-photo img { width: 100%; height: 100%; object-fit: cover; }
  .cwa-pt-initials { font-size: 1.2rem; font-weight: 700; color: #fff; }
  .cwa-pt-details { display: flex; flex-direction: column; gap: 4px; }
  .cwa-pt-fullname { font-weight: 700; color: #1e293b; font-size: 0.92rem; text-align: center; margin-bottom: 6px; }
  .cwa-pt-row { display: flex; justify-content: space-between; font-size: 0.78rem; color: #64748b; }
  .cwa-pt-row strong { color: #1e293b; }

  .cwa-vitals-section { padding: 12px 14px; border-bottom: 1.5px solid #f1f5f9; }
  .cwa-section-hdr {
    font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
    color: #94a3b8; letter-spacing: 0.8px; margin-bottom: 10px;
    padding: 0 0 6px; border-bottom: 1px solid #f1f5f9;
  }
  .cwa-vitals-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .cwa-vital-box { display: flex; flex-direction: column; gap: 3px; }
  .cwa-vital-box label { font-size: 0.68rem; color: #64748b; font-weight: 500; }
  .cwa-vital-input-wrap { display: flex; align-items: center; gap: 3px; }
  .cwa-vital-input-wrap input {
    flex: 1; width: 0; padding: 5px 6px; border: 1.5px solid #e2e8f0;
    border-radius: 6px; font-size: 0.82rem; color: #1e293b; outline: none;
    transition: border-color .15s;
  }
  .cwa-vital-input-wrap input:focus { border-color: #6366f1; }
  .cwa-vital-input-wrap span { font-size: 0.62rem; color: #94a3b8; white-space: nowrap; }
  .cwa-bmi {
    margin-top: 8px; font-size: 0.78rem; font-weight: 600;
    text-align: center; padding: 4px; background: #f8fafc; border-radius: 6px;
  }

  .cwa-history-section { padding: 12px 14px; }
  .cwa-hist-card {
    padding: 8px 10px; background: #f8fafc; border-radius: 8px;
    border: 1px solid #e2e8f0; margin-bottom: 6px;
  }
  .cwa-hist-date { font-size: 0.72rem; color: #64748b; margin-bottom: 2px; }
  .cwa-hist-dx { font-size: 0.78rem; font-weight: 500; color: #1e293b; margin-bottom: 4px; }
  .cwa-hist-rx { display: flex; flex-wrap: wrap; gap: 4px; }
  .cwa-hist-rx-chip {
    font-size: 0.68rem; background: #eef2ff; color: #4f46e5;
    padding: 1px 7px; border-radius: 99px;
  }

  /* Center */
  .cwa-center { flex: 1; overflow-y: auto; display: flex; flex-direction: column; min-width: 0; }
  .cwa-center::-webkit-scrollbar { width: 4px; }
  .cwa-center::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 99px; }

  .cwa-tabs {
    display: flex; border-bottom: 2px solid #e2e8f0;
    background: #fff; flex-shrink: 0; position: sticky; top: 0; z-index: 10;
  }
  .cwa-tab {
    padding: 12px 20px; border: none; background: transparent;
    font-size: 0.85rem; font-weight: 500; color: #64748b; cursor: pointer;
    border-bottom: 2px solid transparent; margin-bottom: -2px;
    transition: color .15s, border-color .15s;
  }
  .cwa-tab:hover { color: #4f46e5; }
  .cwa-tab--active { color: #4f46e5; border-bottom-color: #4f46e5; font-weight: 600; }

  /* SOAP */
  .cwa-soap { padding: 18px; display: flex; flex-direction: column; gap: 16px; }
  .soap-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
  .soap-copy-btn {
    padding: 6px 12px; border: 1.5px solid #e2e8f0; border-radius: 8px;
    background: #f8fafc; font-size: 0.8rem; color: #475569; cursor: pointer;
    transition: all .15s;
  }
  .soap-copy-btn:hover { border-color: #4f46e5; color: #4f46e5; }

  .soap-block {
    background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px;
    padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;
  }
  .soap-block-hdr { display: flex; align-items: center; justify-content: space-between; }
  .soap-label { font-size: 0.8rem; font-weight: 700; color: #4f46e5; text-transform: uppercase; letter-spacing: 0.5px; }
  .soap-textarea {
    width: 100%; box-sizing: border-box; padding: 10px 12px;
    border: 1.5px solid #e2e8f0; border-radius: 8px; resize: vertical;
    font-size: 0.88rem; color: #1e293b; font-family: inherit; line-height: 1.5;
    outline: none; transition: border-color .15s;
  }
  .soap-textarea:focus { border-color: #6366f1; }
  .soap-char { font-size: 0.68rem; color: #94a3b8; text-align: right; }

  .soap-quick-exam { display: flex; flex-wrap: wrap; gap: 6px; }
  .soap-nad-btn {
    padding: 4px 10px; border: 1.5px solid #e2e8f0; border-radius: 8px;
    background: #f8fafc; font-size: 0.75rem; color: #475569; cursor: pointer;
    transition: all .15s;
  }
  .soap-nad-btn:hover { border-color: #4f46e5; color: #4f46e5; background: #eef2ff; }

  .soap-icd-label { font-size: 0.72rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  .soap-plan-row { display: flex; gap: 16px; flex-wrap: wrap; }
  .soap-field-label { font-size: 0.75rem; font-weight: 600; color: #64748b; display: block; margin-bottom: 4px; }
  .soap-date-input {
    padding: 8px 10px; border: 1.5px solid #e2e8f0; border-radius: 8px;
    font-size: 0.85rem; color: #1e293b; outline: none; transition: border-color .15s;
  }
  .soap-date-input:focus { border-color: #6366f1; }
  .soap-followup-row { display: flex; flex-direction: column; gap: 8px; }
  .soap-followup-presets { display: flex; flex-wrap: wrap; gap: 6px; }
  .soap-preset-btn {
    padding: 4px 10px; border: 1.5px solid #e2e8f0; border-radius: 99px;
    background: #f8fafc; font-size: 0.75rem; color: #475569; cursor: pointer;
    transition: all .15s;
  }
  .soap-preset-btn:hover { border-color: #4f46e5; color: #4f46e5; background: #eef2ff; }

  /* ICD-10 */
  .icd10-wrap { display: flex; flex-direction: column; gap: 8px; }
  .icd10-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .icd10-chip {
    display: flex; align-items: center; gap: 6px;
    background: #eef2ff; color: #4f46e5; border-radius: 99px;
    padding: 3px 10px 3px 12px; font-size: 0.75rem;
  }
  .icd10-chip button {
    border: none; background: none; cursor: pointer; color: #818cf8;
    font-size: 0.7rem; padding: 0; line-height: 1;
  }
  .icd10-search-wrap { position: relative; }
  .icd10-input {
    width: 100%; box-sizing: border-box; padding: 8px 12px;
    border: 1.5px solid #e2e8f0; border-radius: 8px; font-size: 0.85rem;
    outline: none; transition: border-color .15s;
  }
  .icd10-input:focus { border-color: #6366f1; }
  .icd10-dropdown {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0;
    background: #fff; border: 1.5px solid #e2e8f0; border-radius: 10px;
    z-index: 50; box-shadow: 0 8px 30px rgba(0,0,0,.12); max-height: 250px; overflow-y: auto;
  }
  .icd10-option {
    padding: 9px 14px; font-size: 0.82rem; cursor: pointer; transition: background .1s;
  }
  .icd10-option:hover { background: #f0f4ff; }
  .icd10-option strong { color: #4f46e5; margin-right: 4px; }

  /* Symptom Picker */
  .symptom-picker { display: flex; flex-direction: column; gap: 8px; }
  .symptom-toggle {
    padding: 5px 12px; border: 1.5px solid #e2e8f0; border-radius: 8px;
    background: #f8fafc; font-size: 0.78rem; color: #475569; cursor: pointer;
    width: fit-content; transition: all .15s;
  }
  .symptom-toggle:hover { border-color: #4f46e5; color: #4f46e5; }
  .symptom-panel { background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 12px; }
  .symptom-systems { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
  .symptom-sys {
    padding: 3px 10px; border: 1.5px solid #e2e8f0; border-radius: 99px;
    background: #fff; font-size: 0.72rem; color: #64748b; cursor: pointer; transition: all .15s;
  }
  .symptom-sys:hover { border-color: #4f46e5; color: #4f46e5; }
  .symptom-sys--active { border-color: #4f46e5; background: #4f46e5; color: #fff; }
  .symptom-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .symptom-chip {
    padding: 4px 10px; border: 1.5px solid #e2e8f0; border-radius: 99px;
    background: #fff; font-size: 0.75rem; color: #475569; cursor: pointer; transition: all .15s;
  }
  .symptom-chip:hover { border-color: #16a34a; color: #16a34a; background: #f0fdf4; }

  /* Voice */
  .voice-btn {
    padding: 5px 12px; border: 1.5px solid #e2e8f0; border-radius: 8px;
    background: #f8fafc; font-size: 0.78rem; color: #475569; cursor: pointer; transition: all .15s;
  }
  .voice-btn:hover { border-color: #4f46e5; }
  .voice-btn--active { border-color: #dc2626; color: #dc2626; background: #fef2f2; animation: voice-pulse 1s ease-in-out infinite; }
  @keyframes voice-pulse { 0%,100% { opacity: 1; } 50% { opacity: .6; } }

  /* Template picker */
  .tmpl-wrap { position: relative; }
  .tmpl-btn {
    padding: 6px 12px; border: 1.5px solid #e2e8f0; border-radius: 8px;
    background: #f8fafc; font-size: 0.8rem; color: #475569; cursor: pointer; transition: all .15s;
  }
  .tmpl-btn:hover { border-color: #4f46e5; color: #4f46e5; }
  .tmpl-dropdown {
    position: absolute; top: calc(100% + 6px); left: 0; z-index: 100;
    background: #fff; border: 1.5px solid #e2e8f0; border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,.12); min-width: 220px;
  }
  .tmpl-option {
    display: block; width: 100%; padding: 9px 14px; border: none;
    background: transparent; font-size: 0.82rem; color: #1e293b;
    text-align: left; cursor: pointer; transition: background .1s;
  }
  .tmpl-option:hover { background: #f0f4ff; }

  /* Prescriptions */
  .cwa-rx { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .rx-tmpl-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .rx-tmpl-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .rx-tmpl-label { font-size: 0.72rem; color: #64748b; white-space: nowrap; }
  .rx-tmpl-chip {
    padding: 3px 10px; background: #fffbeb; border: 1.5px solid #fcd34d;
    border-radius: 99px; font-size: 0.72rem; color: #92400e; cursor: pointer; transition: all .15s;
  }
  .rx-tmpl-chip:hover { background: #fef3c7; }
  .rx-save-tmpl-btn {
    padding: 6px 12px; border: 1.5px dashed #d97706; border-radius: 8px;
    background: #fffbeb; font-size: 0.78rem; color: #92400e; cursor: pointer;
  }
  .rx-tmpl-save-form { display: flex; gap: 6px; align-items: center; }
  .rx-tmpl-save-form input {
    padding: 5px 10px; border: 1.5px solid #e2e8f0; border-radius: 7px;
    font-size: 0.82rem; outline: none;
  }
  .rx-tmpl-save-form button {
    padding: 5px 10px; border: none; border-radius: 7px;
    font-size: 0.78rem; cursor: pointer;
  }
  .rx-tmpl-save-form button:first-of-type { background: #4f46e5; color: #fff; }
  .rx-tmpl-save-form button:last-of-type { background: #f1f5f9; color: #475569; }

  .rx-interaction-banner {
    background: #fef2f2; border: 1.5px solid #fecaca; border-radius: 10px;
    padding: 10px 14px; font-size: 0.82rem; color: #991b1b;
  }

  .drug-row {
    background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px;
    padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;
    transition: border-color .15s;
  }
  .drug-row--warn { border-color: #fca5a5; background: #fff5f5; }
  .drug-row-top { display: flex; gap: 8px; align-items: flex-start; }
  .drug-name-wrap { flex: 1; position: relative; display: flex; flex-direction: column; gap: 3px; }
  .drug-name-input {
    width: 100%; padding: 8px 10px; border: 1.5px solid #e2e8f0; border-radius: 8px;
    font-size: 0.85rem; outline: none; transition: border-color .15s; box-sizing: border-box;
  }
  .drug-name-input:focus { border-color: #6366f1; }
  .drug-warn { font-size: 0.7rem; color: #dc2626; font-weight: 500; }
  .drug-generic { font-size: 0.68rem; color: #64748b; }
  .drug-dropdown {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0;
    background: #fff; border: 1.5px solid #e2e8f0; border-radius: 10px;
    z-index: 60; box-shadow: 0 8px 30px rgba(0,0,0,.12); max-height: 260px; overflow-y: auto;
  }
  .drug-option {
    padding: 9px 14px; cursor: pointer; font-size: 0.82rem;
    display: flex; justify-content: space-between; align-items: flex-start;
    transition: background .1s;
  }
  .drug-option:hover { background: #f0f4ff; }
  .drug-cat { font-size: 0.68rem; color: #64748b; display: block; margin-top: 1px; }
  .drug-forms { font-size: 0.7rem; color: #94a3b8; white-space: nowrap; padding-left: 8px; flex-shrink: 0; }
  .drug-dosage-input {
    width: 90px; padding: 8px 8px; border: 1.5px solid #e2e8f0; border-radius: 8px;
    font-size: 0.82rem; outline: none; transition: border-color .15s; flex-shrink: 0;
  }
  .drug-dosage-input:focus { border-color: #6366f1; }
  .drug-select {
    padding: 7px 8px; border: 1.5px solid #e2e8f0; border-radius: 8px;
    font-size: 0.78rem; color: #475569; outline: none; flex-shrink: 0;
  }
  .drug-remove {
    padding: 7px 9px; border: none; border-radius: 8px; background: #fef2f2;
    color: #dc2626; font-size: 0.75rem; cursor: pointer; flex-shrink: 0;
    transition: background .15s;
  }
  .drug-remove:hover { background: #fee2e2; }

  .drug-row-mid { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .freq-group { display: flex; gap: 4px; flex-wrap: wrap; }
  .freq-chip {
    padding: 4px 10px; border: 1.5px solid #e2e8f0; border-radius: 99px;
    background: #f8fafc; font-size: 0.72rem; font-weight: 500; color: #475569;
    cursor: pointer; transition: all .15s;
  }
  .freq-chip:hover { border-color: #4f46e5; color: #4f46e5; }
  .freq-chip--active { background: #4f46e5; border-color: #4f46e5; color: #fff; }

  .sig-group { display: flex; gap: 8px; }
  .sig-label {
    display: flex; align-items: center; gap: 4px;
    font-size: 0.72rem; color: #64748b; cursor: pointer; user-select: none;
  }
  .sig-label input { cursor: pointer; }

  .drug-row-bot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .dur-group { display: flex; gap: 4px; flex-wrap: wrap; }
  .dur-chip {
    padding: 4px 8px; border: 1.5px solid #e2e8f0; border-radius: 99px;
    background: #f8fafc; font-size: 0.7rem; color: #475569; cursor: pointer; transition: all .15s;
  }
  .dur-chip:hover { border-color: #0891b2; color: #0891b2; }
  .dur-chip--active { background: #0891b2; border-color: #0891b2; color: #fff; }
  .drug-stop { font-size: 0.7rem; color: #16a34a; font-weight: 500; white-space: nowrap; }
  .drug-instructions {
    flex: 1; min-width: 120px; padding: 5px 10px; border: 1.5px solid #e2e8f0;
    border-radius: 7px; font-size: 0.78rem; outline: none;
  }

  .rx-add-btn {
    padding: 9px; border: 2px dashed #c7d2fe; border-radius: 10px;
    background: #fafbff; font-size: 0.82rem; color: #4f46e5; cursor: pointer;
    transition: all .15s; font-weight: 500;
  }
  .rx-add-btn:hover { border-color: #4f46e5; background: #eef2ff; }

  /* Lab Section */
  .lab-section { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .lab-sets-hdr {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 0.82rem; font-weight: 600; color: #1e293b; cursor: pointer;
    background: #fff; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 10px 14px;
  }
  .lab-sets-hdr:hover { border-color: #4f46e5; }
  .lab-sets-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px;
  }
  .lab-set-btn {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 10px 8px; border: 1.5px solid #e2e8f0; border-radius: 10px;
    background: #fff; cursor: pointer; transition: all .15s; position: relative;
  }
  .lab-set-btn:hover { border-color: #4f46e5; background: #eef2ff; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,.06); }
  .lab-set-btn--suggested { border-color: #f59e0b; background: #fffbeb; }
  .lab-set-icon { font-size: 1.3rem; }
  .lab-set-name { font-size: 0.72rem; font-weight: 600; color: #1e293b; text-align: center; }
  .lab-set-tag { font-size: 0.6rem; background: #f59e0b; color: #fff; border-radius: 99px; padding: 1px 6px; position: absolute; top: 4px; right: 4px; }

  .lab-selected { background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 10px; padding: 10px 12px; }
  .lab-selected-label { font-size: 0.72rem; font-weight: 600; color: #16a34a; display: block; margin-bottom: 8px; }
  .lab-selected-chips { display: flex; flex-direction: column; gap: 6px; }
  .lab-selected-chip {
    display: flex; align-items: center; gap: 8px; background: #fff;
    border: 1px solid #bbf7d0; border-radius: 8px; padding: 5px 10px;
    font-size: 0.78rem; color: #1e293b;
  }
  .lab-selected-chip > span:first-child { flex: 1; }
  .lab-urgency-btns { display: flex; gap: 3px; }
  .lab-urg-btn {
    padding: 2px 6px; border: 1.5px solid #e2e8f0; border-radius: 6px;
    background: transparent; font-size: 0.68rem; cursor: pointer; transition: all .1s;
  }
  .lab-chip-remove { border: none; background: none; cursor: pointer; color: #94a3b8; font-size: 0.75rem; }

  .lab-search-wrap {
    display: flex; align-items: center; gap: 8px;
    background: #fff; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 7px 12px;
    transition: border-color .15s;
  }
  .lab-search-wrap:focus-within { border-color: #6366f1; }
  .lab-search { flex: 1; border: none; outline: none; font-size: 0.85rem; color: #1e293b; }
  .lab-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 6px; }
  .lab-item {
    display: flex; align-items: center; gap: 7px;
    padding: 7px 10px; border: 1.5px solid #e2e8f0; border-radius: 8px;
    background: #fff; font-size: 0.78rem; color: #475569; cursor: pointer;
    transition: all .1s; user-select: none;
  }
  .lab-item:hover { border-color: #6366f1; background: #f0f4ff; }
  .lab-item--checked { border-color: #6366f1; background: #eef2ff; color: #4f46e5; font-weight: 500; }
  .lab-price { margin-left: auto; font-size: 0.68rem; color: #94a3b8; }

  /* Right panel */
  .cwa-right {
    width: 300px; flex-shrink: 0; background: #fff; border-left: 1.5px solid #e2e8f0;
    overflow-y: auto; padding: 14px 14px 20px;
    display: flex; flex-direction: column; gap: 14px;
  }
  .cwa-right::-webkit-scrollbar { width: 4px; }
  .cwa-right::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 99px; }

  .ctx-block { display: flex; flex-direction: column; gap: 6px; }
  .ctx-block-title { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.6px; }
  .ctx-placeholder { font-size: 0.78rem; color: #94a3b8; }
  .ctx-dx-list { display: flex; flex-wrap: wrap; gap: 5px; }
  .ctx-dx-chip {
    font-size: 0.72rem; background: #f1f5f9; border-radius: 6px;
    padding: 3px 8px; color: #475569;
  }
  .ctx-med-list { display: flex; flex-direction: column; gap: 4px; }
  .ctx-med-row { display: flex; justify-content: space-between; font-size: 0.78rem; }
  .ctx-med-freq { font-size: 0.7rem; color: #64748b; }
  .ctx-trends { display: flex; flex-direction: column; gap: 6px; }
  .ctx-trend-row { display: flex; align-items: center; gap: 8px; }
  .ctx-trend-label { font-size: 0.72rem; color: #64748b; min-width: 55px; }
  .ctx-trend-last { font-size: 0.72rem; font-weight: 600; color: #1e293b; }
  .ctx-lab-row { display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; padding: 4px 0; border-bottom: 1px solid #f1f5f9; }
  .ctx-lab-name { color: #475569; flex: 1; }
  .ctx-lab-val { font-weight: 600; color: #1e293b; white-space: nowrap; }
`;
