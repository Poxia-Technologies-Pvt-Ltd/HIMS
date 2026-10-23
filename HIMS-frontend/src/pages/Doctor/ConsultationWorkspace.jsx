import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X, Save, Printer, MoreHorizontal, Mic, History, FileText, MessageCircle, Check, ChevronLeft, ChevronRight,
  Trash2, Plus, Search, Repeat, Star, AlertTriangle, PanelRightClose, PanelRightOpen, CheckCircle2,
} from 'lucide-react';
import { searchICD10 } from '../../data/icd10Codes';
import { searchDrugs, checkInteractions, DRUG_DATABASE } from '../../data/drugDatabase';
import { LAB_ORDER_SETS, suggestLabPanels } from '../../data/labOrderSets';
import { SYMPTOM_CHIPS, ALL_SYSTEMS } from '../../data/symptomChips';
import { CONSULTATION_TEMPLATES } from '../../data/consultationTemplates';
import { IMAGING_MODALITIES } from '../../data/imagingStudies';
import { useHospital } from '../../hooks/useHospital';
import { post } from '../../utils/hmisApi';
import CertificateGenerator from './CertificateGenerator';
import PostVisitSummary from './PostVisitSummary';
import PatientTimeline from './PatientTimeline';
import AmbientScribe from './AmbientScribe';
import '../../assets/CSS/Consultation.css';

// Consultation screen, built for doctors who are new to computers: five
// numbered steps with Back/Next, plain words instead of abbreviations, big
// buttons, and one "Finish consultation" that saves, marks the patient seen
// and shows the summary. Drafts save on their own every 20 seconds.

// ─── Helpers ─────────────────────────────────────────────────────────────────
const calcAge = (dob) => (dob ? Math.floor((Date.now() - new Date(dob)) / (365.25 * 24 * 3600 * 1000)) : null);
const initials = (fn, ln) => `${(fn || '')[0] || ''}${(ln || '')[0] || ''}`.toUpperCase();
const DRAFT_KEY = (id) => `cw_adv_draft_${id}`;
// Appointments already moved to "In Consultation" in this browser tab.
const STARTED = new Set();
const uid = () => Math.random().toString(36).slice(2);
const isoPlusDays = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmtDay = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function calcBMI(h, w) {
  const hm = parseFloat(h) / 100; const wk = parseFloat(w);
  if (!hm || !wk) return null;
  const b = wk / (hm * hm);
  if (b < 18.5) return { val: b.toFixed(1), cat: 'Underweight', tone: 'warn' };
  if (b < 25) return { val: b.toFixed(1), cat: 'Normal', tone: 'ok' };
  if (b < 30) return { val: b.toFixed(1), cat: 'Overweight', tone: 'warn' };
  return { val: b.toFixed(1), cat: 'Obese', tone: 'bad' };
}

// Vitals with their usual adult range, so out-of-range values light up.
const VITALS = [
  { key: 'bp_systolic', label: 'BP (upper)', unit: 'mmHg', lo: 90, hi: 140 },
  { key: 'bp_diastolic', label: 'BP (lower)', unit: 'mmHg', lo: 60, hi: 90 },
  { key: 'pulse', label: 'Pulse', unit: '/min', lo: 60, hi: 100 },
  { key: 'temperature', label: 'Temperature', unit: '°F', lo: 97, hi: 99.5 },
  { key: 'spo2', label: 'SpO₂', unit: '%', lo: 95, hi: 100 },
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'height', label: 'Height', unit: 'cm' },
];
const vitalTone = (f, v) => {
  const n = parseFloat(v);
  if (Number.isNaN(n) || f.lo === undefined) return '';
  return n < f.lo || n > f.hi ? 'bad' : 'ok';
};

// ─── Medicines ────────────────────────────────────────────────────────────────
// The doctor picks when to take it (Morning / Afternoon / Night), before or
// after food, and for how many days — no OD/BD/TID abbreviations. Saved as
// "1-0-1" with the morning/afternoon/night flags.
const TIMES = [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['night', 'Night']];
const DAY_CHIPS = [3, 5, 7, 10, 15, 30];
const FOOD = ['Before food', 'After food'];
const ROUTES = ['Oral', 'Topical', 'Inhaled', 'IM injection', 'IV injection', 'Sublingual', 'Eye', 'Ear', 'Nasal', 'Rectal'];
const FORM_ROUTE = { Tablet: 'Oral', Capsule: 'Oral', Syrup: 'Oral', Suspension: 'Oral', Granules: 'Oral', Injection: 'IM injection',
  Cream: 'Topical', Gel: 'Topical', Lotion: 'Topical', Ointment: 'Topical', 'Eye drops': 'Eye', 'Ear drops': 'Ear', Inhaler: 'Inhaled', Pessary: 'Topical' };
const LEGACY_FREQ = { OD: ['morning'], BD: ['morning', 'night'], TID: ['morning', 'afternoon', 'night'], QID: ['morning', 'afternoon', 'night'], HS: ['night'] };

const strengthOf = (drug) => {
  const m = /(\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|%|iu))/i.exec(drug.name);
  return m ? m[1].replace(/\s/g, '') : drug.commonDosages?.[0] || '';
};
const pattern = (m) => TIMES.map(([k]) => (m[k] ? '1' : '0')).join('-');
const perDay = (m) => TIMES.filter(([k]) => m[k]).length;
const countable = (form) => ['Tablet', 'Capsule'].includes(form);

const newMed = (drug) => ({
  _id: uid(),
  medicine_name: drug?.name || '', generic: drug?.generic || '', form: drug?.forms?.[0] || '', category: drug?.category || '',
  dosage: drug ? strengthOf(drug) : '', route: FORM_ROUTE[drug?.forms?.[0]] || 'Oral',
  morning: false, afternoon: false, night: false, food: 'After food', days: '', notes: '',
});

// Saved prescription row (from the API, a template or a past visit) -> editor row.
const fromSaved = (p) => {
  const drug = DRUG_DATABASE.find((d) => d.name === p.medicine_name);
  const m = { ...newMed(drug), medicine_name: p.medicine_name || '', dosage: p.dosage || (drug ? strengthOf(drug) : ''), route: p.route || 'Oral' };
  m.morning = !!(p.sig_morning ?? p.morning);
  m.afternoon = !!(p.sig_afternoon ?? p.afternoon);
  m.night = !!(p.sig_night ?? p.night) || !!(p.sig_evening ?? p.evening);
  if (!m.morning && !m.afternoon && !m.night) {
    const fq = String(p.frequency || '').trim();
    if (/^[01]-[01]-[01]$/.test(fq)) fq.split('-').forEach((b, i) => { m[TIMES[i][0]] = b === '1'; });
    else (LEGACY_FREQ[fq.toUpperCase()] || []).forEach((k) => { m[k] = true; });
  }
  const dur = /(\d+)\s*(day|week|month)/i.exec(String(p.duration || ''));
  if (dur) m.days = String(Number(dur[1]) * ({ day: 1, week: 7, month: 30 }[dur[2].toLowerCase()]));
  let notes = String(p.instructions || '');
  const food = FOOD.find((f) => notes.toLowerCase().startsWith(f.toLowerCase()));
  if (food) { m.food = food; notes = notes.slice(food.length).replace(/^[.,;\s]+/, ''); }
  else if (notes) m.food = '';
  m.notes = notes;
  return m;
};

// Editor row -> what the API stores.
const toSaved = (m) => ({
  medicine_name: m.medicine_name.trim(),
  dosage: m.dosage,
  frequency: perDay(m) ? pattern(m) : '',
  duration: m.days ? `${m.days} day${Number(m.days) === 1 ? '' : 's'}` : '',
  route: m.route,
  instructions: [m.food, m.notes].filter(Boolean).join('. '),
  morning: m.morning, afternoon: m.afternoon, evening: false, night: m.night,
});

const timesText = (m) => TIMES.filter(([k]) => m[k]).map(([, l]) => l).join(', ');

// Search box that adds a medicine. Picking one (click or Enter) adds it and clears the box.
// Pharmacy stock for a medicine: the same medicine and strength, else the same
// generic in another strength. Null when the pharmacy keeps neither.
function stockFor(stock, name, generic) {
  if (!stock?.length || !name) return null;
  const total = (rows) => rows.reduce((n, s) => n + s.available, 0);
  const exact = stock.filter((s) => s.name.toLowerCase().includes(name.toLowerCase()));
  if (exact.length) return { n: total(exact) };
  const key = String(generic || name).toLowerCase().split(/[\s(]/)[0];
  const similar = key.length >= 3 ? stock.filter((s) => s.name.toLowerCase().includes(key)) : [];
  return similar.length ? { n: total(similar), other: similar.filter((s) => s.available > 0).map((s) => s.name).join(', ') } : null;
}

function StockTag({ stock, name, generic, need }) {
  if (!stock?.length) return null;
  const s = stockFor(stock, name, generic);
  if (s === null) return <span className="cw-stock none">Not in pharmacy</span>;
  if (s.other !== undefined) return s.n > 0 ? <span className="cw-stock low" title={s.other}>Other strength in stock</span> : <span className="cw-stock out">Out of stock</span>;
  if (s.n <= 0) return <span className="cw-stock out">Out of stock</span>;
  if (need && s.n < need) return <span className="cw-stock low">Only {s.n} in stock</span>;
  return <span className="cw-stock ok">In stock · {s.n}</span>;
}

function MedicineSearch({ onPick, autoFocus, stock }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const results = useMemo(() => (q.trim().length >= 2 ? searchDrugs(q.trim()) : []), [q]);
  const pick = (drug) => { onPick(drug); setQ(''); setHi(0); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    if (e.key === 'Escape') setQ('');
    if (e.key === 'Enter' && q.trim()) {
      e.preventDefault();
      if (results[hi]) pick(results[hi]);
      else pick({ name: q.trim(), generic: '', forms: [], commonDosages: [], category: '' });
    }
  };
  return (
    <div className="cw-msearch">
      <Search size={18} />
      <input autoFocus={autoFocus} value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={onKey}
        placeholder="Type medicine name to add (e.g. para, amox, cetiri)…" aria-label="Add medicine" />
      {q.trim().length >= 2 && (
        <div className="cw-msearch-list" role="listbox">
          {results.map((d, i) => (
            <button key={d.name} type="button" role="option" aria-selected={i === hi}
              className={i === hi ? 'on' : ''} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(d); }}>
              <span><strong>{d.name}</strong><small>{d.generic} · {d.category}</small></span>
              <span className="cw-msearch-side"><StockTag stock={stock} name={d.name} generic={d.generic} /><em>{d.forms.join(' / ')}</em></span>
            </button>
          ))}
          <button type="button" className={hi === results.length ? 'on' : ''} onMouseEnter={() => setHi(results.length)}
            onMouseDown={(e) => { e.preventDefault(); pick({ name: q.trim(), generic: '', forms: [], commonDosages: [], category: '' }); }}>
            <span><strong>Add “{q.trim()}” as typed</strong><small>Not in the list — use the name exactly as written</small></span>
          </button>
        </div>
      )}
    </div>
  );
}

function MedicineCard({ med, index, onChange, onRemove, warn, stock }) {
  const drug = DRUG_DATABASE.find((d) => d.name === med.medicine_name);
  const set = (patch) => onChange(med._id, patch);
  const n = perDay(med);
  const days = parseInt(med.days, 10);
  const total = countable(med.form) && n && days ? n * days : null;
  return (
    <div className={`cw-med${warn ? ' warn' : ''}`}>
      <div className="cw-med-head">
        <span className="cw-med-no">{index + 1}</span>
        <div className="cw-med-name">
          <input value={med.medicine_name} onChange={(e) => set({ medicine_name: e.target.value })} aria-label="Medicine name" />
          <small>{[med.generic && med.generic !== med.medicine_name ? med.generic : null, med.form, med.category].filter(Boolean).join(' · ')}</small>
        </div>
        <StockTag stock={stock} name={med.medicine_name} generic={med.generic} need={total} />
        <button type="button" className="cw-icon-btn danger" onClick={() => onRemove(med._id)} title="Remove medicine" aria-label="Remove medicine"><Trash2 size={17} /></button>
      </div>
      {warn && <div className="cw-med-warn"><AlertTriangle size={14} /> May interact with another medicine in this prescription</div>}

      <div className="cw-med-grid">
        <div className="cw-field">
          <label>Dose</label>
          <input className="cw-input" value={med.dosage} onChange={(e) => set({ dosage: e.target.value })} placeholder="e.g. 500mg" />
          {drug?.commonDosages?.length > 1 && (
            <div className="cw-chips sm">
              {drug.commonDosages.map((d) => <button key={d} type="button" className={`cw-chip${med.dosage === d ? ' on' : ''}`} onClick={() => set({ dosage: d })}>{d}</button>)}
            </div>
          )}
        </div>

        <div className="cw-field">
          <label>When to take</label>
          <div className="cw-times">
            {TIMES.map(([k, l]) => (
              <button key={k} type="button" className={`cw-time${med[k] ? ' on' : ''}`} onClick={() => set({ [k]: !med[k] })} aria-pressed={!!med[k]}>
                {med[k] ? <Check size={15} /> : null}{l}
              </button>
            ))}
          </div>
          <div className="cw-chips sm">
            {FOOD.map((f) => <button key={f} type="button" className={`cw-chip${med.food === f ? ' on' : ''}`} onClick={() => set({ food: med.food === f ? '' : f })}>{f}</button>)}
          </div>
        </div>

        <div className="cw-field">
          <label>For how many days</label>
          <div className="cw-chips">
            {DAY_CHIPS.map((d) => <button key={d} type="button" className={`cw-chip${String(d) === String(med.days) ? ' on' : ''}`} onClick={() => set({ days: String(d) })}>{d}</button>)}
            <span className="cw-days-custom">
              <input type="number" min="1" max="365" inputMode="numeric" value={med.days} onChange={(e) => set({ days: e.target.value.replace(/[^\d]/g, '').slice(0, 3) })} placeholder="Other" aria-label="Number of days" />
              days
            </span>
          </div>
        </div>
      </div>

      <div className="cw-med-foot">
        <select className="cw-input" style={{ width: 160 }} value={med.route} onChange={(e) => set({ route: e.target.value })} aria-label="Route">
          {ROUTES.map((r) => <option key={r}>{r}</option>)}
        </select>
        <input className="cw-input" style={{ flex: 1 }} value={med.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Any other instruction (optional)" />
        <span className="cw-med-sum">
          {n ? <b>{pattern(med)}</b> : <span className="cw-muted">choose when to take</span>}
          {med.days ? ` · ${med.days} days` : ''}{total ? ` · ${total} ${med.form.toLowerCase()}s` : ''}
        </span>
      </div>
    </div>
  );
}

// ─── Lab tests ────────────────────────────────────────────────────────────────
function LabPicker({ labTests, selected, onChange, suggested }) {
  const [q, setQ] = useState('');
  const ids = new Set(selected.map((s) => s.test_id));
  const toggle = (t) => (ids.has(t.id)
    ? onChange(selected.filter((s) => s.test_id !== t.id))
    : onChange([...selected, { test_id: t.id, test_name: t.test_name, urgency: 'Routine' }]));
  const addPanel = (panel) => {
    const names = panel.tests.map((t) => t.toLowerCase());
    const add = labTests.filter((t) => names.some((n) => t.test_name?.toLowerCase().includes(n)) && !ids.has(t.id));
    if (add.length) onChange([...selected, ...add.map((t) => ({ test_id: t.id, test_name: t.test_name, urgency: 'Routine' }))]);
  };
  const shown = labTests.filter((t) => !q || `${t.test_name} ${t.test_code || ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 48);
  return (
    <div className="cw-stack">
      <div className="cw-chips">
        {LAB_ORDER_SETS.map((p) => (
          <button key={p.id} type="button" className={`cw-chip lg${suggested.includes(p.id) ? ' sug' : ''}`} onClick={() => addPanel(p)} title={p.description}>
            {p.icon} {p.name}{suggested.includes(p.id) ? ' · suggested' : ''}
          </button>
        ))}
      </div>
      <div className="cw-search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a test (e.g. CBC, sugar, thyroid)…" /></div>
      <div className="cw-testgrid">
        {shown.map((t) => (
          <button key={t.id} type="button" className={`cw-test${ids.has(t.id) ? ' on' : ''}`} onClick={() => toggle(t)} aria-pressed={ids.has(t.id)}>
            <span className="cw-tick">{ids.has(t.id) ? <Check size={14} /> : null}</span>
            <span>{t.test_name}</span>
            {Number(t.price) > 0 ? <em>₹{Number(t.price)}</em> : null}
          </button>
        ))}
        {shown.length === 0 && <span className="cw-muted">No test matches “{q}”.</span>}
      </div>
    </div>
  );
}

// ─── Imaging (X-ray, ultrasound, CT, MRI, ECG …) ─────────────────────────────
function ImagingPicker({ selected, onChange }) {
  const [mod, setMod] = useState(IMAGING_MODALITIES[0].id);
  const [custom, setCustom] = useState('');
  const modality = IMAGING_MODALITIES.find((m) => m.id === mod);
  const has = (study) => selected.some((s) => s.modality === mod && s.body_part === study);
  const toggle = (study) => (has(study)
    ? onChange(selected.filter((s) => !(s.modality === mod && s.body_part === study)))
    : onChange([...selected, { _id: uid(), modality: mod, body_part: study, urgency: 'Routine', clinical_indication: '' }]));
  const addCustom = () => {
    if (!custom.trim()) return;
    onChange([...selected, { _id: uid(), modality: mod, body_part: custom.trim(), urgency: 'Routine', clinical_indication: '' }]);
    setCustom('');
  };
  return (
    <div className="cw-stack">
      <div className="cw-modalities">
        {IMAGING_MODALITIES.map((m) => {
          const n = selected.filter((s) => s.modality === m.id).length;
          return (
            <button key={m.id} type="button" className={`cw-modality${mod === m.id ? ' on' : ''}`} onClick={() => setMod(m.id)}>
              <span className="cw-mod-icon">{m.icon}</span>{m.label}{n ? <b>{n}</b> : null}
            </button>
          );
        })}
      </div>
      <div className="cw-chips">
        {modality.studies.map((s) => (
          <button key={s} type="button" className={`cw-chip lg${has(s) ? ' on' : ''}`} onClick={() => toggle(s)} aria-pressed={has(s)}>
            {has(s) ? <Check size={14} /> : <Plus size={14} />} {s}
          </button>
        ))}
      </div>
      <div className="cw-row">
        <input className="cw-input" style={{ flex: 1 }} value={custom} onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCustom()} placeholder={`Other ${modality.label} (type the part, press Enter)`} />
        <button type="button" className="cw-btn" onClick={addCustom}><Plus size={15} /> Add</button>
      </div>
    </div>
  );
}

// ─── Small pieces ─────────────────────────────────────────────────────────────
function VoiceBtn({ onTranscript }) {
  const [on, setOn] = useState(false);
  const ref = useRef(null);
  const toggle = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { window.alert('Voice typing works in Google Chrome.'); return; }
    if (on) { ref.current?.stop(); setOn(false); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = false; r.lang = 'en-IN';
    r.onresult = (e) => onTranscript(Array.from(e.results).slice(e.resultIndex).map((x) => x[0].transcript).join(' '));
    r.onend = () => setOn(false);
    r.start(); ref.current = r; setOn(true);
  };
  return (
    <button type="button" className={`cw-btn sm${on ? ' rec' : ''}`} onClick={toggle} title="Speak instead of typing">
      <Mic size={15} /> {on ? 'Listening… tap to stop' : 'Speak'}
    </button>
  );
}

function Timer({ start }) {
  const [s, setS] = useState(0);
  useEffect(() => { const t = setInterval(() => setS(Math.floor((Date.now() - start) / 1000)), 1000); return () => clearInterval(t); }, [start]);
  return <span className="cw-timer">{String(Math.floor(s / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}</span>;
}

const ADVICE = ['Drink plenty of water', 'Take rest', 'Light, home-cooked food', 'Avoid oily and spicy food', 'Avoid cold drinks',
  'Walk 30 minutes daily', 'Reduce salt', 'Reduce sugar', 'Come back if fever continues beyond 3 days', 'Come back at once if breathing difficulty'];
const FOLLOW_UPS = [['3 days', 3], ['1 week', 7], ['2 weeks', 14], ['1 month', 30], ['3 months', 90]];
const EXAM_QUICK = ['General', 'Throat', 'Chest / Lungs', 'Heart', 'Abdomen', 'Nervous system', 'Joints'];
const COMMON_SYMPTOMS = ['Fever', 'Cough', 'Cold', 'Headache', 'Body pain', 'Sore throat', 'Vomiting', 'Loose stools', 'Stomach pain', 'Breathlessness', 'Giddiness', 'Weakness'];

const STEPS = [
  { id: 'complaints', label: 'Vitals & Complaints' },
  { id: 'diagnosis', label: 'Examination & Diagnosis' },
  { id: 'medicines', label: 'Medicines' },
  { id: 'tests', label: 'Lab tests & X-ray' },
  { id: 'advice', label: 'Advice & Finish' },
];

// ─── Main ────────────────────────────────────────────────────────────────────
export default function ConsultationWorkspace({ appointment: appt, onClose }) {
  const doctorId = localStorage.getItem('user_id') || localStorage.getItem('id');
  const hospital = useHospital();
  const [startedAt] = useState(() => Date.now());

  const [vitals, setVitals] = useState({ height: '', weight: '', bp_systolic: '', bp_diastolic: '', pulse: '', temperature: '', spo2: '' });
  const [soap, setSoap] = useState({ chiefComplaints: '', history: '', examination: '', diagnosis: '', followUp: '', patientInstructions: '' });
  const [icd10Codes, setIcd10Codes] = useState([]);
  const [icdQ, setIcdQ] = useState('');
  const [rx, setRx] = useState([]);
  const [labs, setLabs] = useState([]);
  const [imaging, setImaging] = useState([]);
  const [labTests, setLabTests] = useState([]);
  const [stock, setStock] = useState([]);
  const [history, setHistory] = useState([]);
  const [labTrends, setLabTrends] = useState({});
  const [rxTemplates, setRxTemplates] = useState([]);
  const [step, setStep] = useState(0);
  const [system, setSystem] = useState(ALL_SYSTEMS[0]);
  const [showMore, setShowMore] = useState(false);
  const [contextOpen, setContextOpen] = useState(window.innerWidth > 1300);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [tmplName, setTmplName] = useState('');
  const [showCert, setShowCert] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showScribe, setShowScribe] = useState(false);

  const flash = (msg, tone = 'ok') => { setToast({ msg, tone }); setTimeout(() => setToast(null), 3500); };
  const bmi = calcBMI(vitals.height, vitals.weight);
  const validRx = rx.filter((m) => m.medicine_name.trim());
  const interactions = checkInteractions(validRx);
  const suggested = suggestLabPanels(icd10Codes);
  const patientName = [appt.first_name, appt.middle_name, appt.last_name].filter(Boolean).join(' ');
  const age = calcAge(appt.dob);

  // ── Load ──
  useEffect(() => {
    const id = appt.appointment_id;
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY(id)) || 'null');
      if (d?.ts && Date.now() - d.ts < 24 * 3600 * 1000) {
        if (d.vitals) setVitals(d.vitals);
        if (d.soap) setSoap(d.soap);
        if (d.icd10Codes) setIcd10Codes(d.icd10Codes);
        if (Array.isArray(d.rx)) setRx(d.rx.map((m) => (m.days !== undefined ? m : fromSaved(m))));
        if (d.selectedLabs) setLabs(d.selectedLabs);
        if (d.imaging) setImaging(d.imaging);
        flash('Your unsaved work from earlier was brought back.', 'info');
      }
    } catch { /* corrupt draft: start fresh */ }

    fetch(`/api/consultations/${id}`).then((r) => r.json()).then((data) => {
      const c = data.consultation;
      if (!c) return;
      setSoap((s) => ({ ...s, chiefComplaints: c.chief_complaints || '', history: c.soap_history || c.doctor_notes || '', examination: c.soap_exam || '',
        diagnosis: c.diagnosis || '', followUp: c.follow_up_date ? String(c.follow_up_date).slice(0, 10) : '', patientInstructions: c.patient_instructions || '' }));
      if (c.icd10_codes?.length) setIcd10Codes(c.icd10_codes);
      if (c.vitals) setVitals((v) => ({ ...v, ...Object.fromEntries(Object.keys(v).map((k) => [k, c.vitals[k] ?? ''])) }));
      if (c.prescriptions?.length) setRx(c.prescriptions.map(fromSaved));
      if (c.labOrders?.length) setLabs(c.labOrders.map((o) => ({ test_id: o.test_id, test_name: o.test_name, urgency: o.urgency || 'Routine' })));
      if (c.imagingOrders?.length) setImaging(c.imagingOrders.map((o) => ({ ...o, _id: uid() })));
    }).catch(() => {});
    fetch(`/api/consultations/patient/${appt.reg_no}/history`).then((r) => r.json()).then((d) => d.success && setHistory(d.history || [])).catch(() => {});
    fetch('/api/consultations/medicine-stock').then((r) => r.json()).then((d) => d.success && setStock(d.medicines || [])).catch(() => {});
    fetch('/api/lab/tests?limit=300').then((r) => r.json()).then((d) => setLabTests(d.tests || d.data || [])).catch(() => {});
    fetch(`/api/consultations/patient/${appt.reg_no}/lab-trends`).then((r) => r.json()).then((d) => d.success && setLabTrends(d.trends || {})).catch(() => {});
    if (doctorId) fetch(`/api/consultations/templates/${doctorId}`).then((r) => r.json()).then((d) => d.success && setRxTemplates(d.templates || [])).catch(() => {});
    // Opening the patient means the consultation has started (front desk sees it).
    if (['Scheduled', 'Checked In'].includes(appt.appt_status) && !STARTED.has(id)) {
      STARTED.add(id);
      post(`/api/appointments/${id}/start`).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appt.appointment_id, appt.reg_no]);

  // ── Draft every 20 s ──
  useEffect(() => {
    const t = setInterval(() => {
      try { localStorage.setItem(DRAFT_KEY(appt.appointment_id), JSON.stringify({ ts: Date.now(), vitals, soap, icd10Codes, rx, selectedLabs: labs, imaging })); } catch { /* storage full */ }
    }, 20000);
    return () => clearInterval(t);
  }, [vitals, soap, icd10Codes, rx, labs, imaging, appt.appointment_id]);

  const setSoapField = (k, v) => setSoap((p) => ({ ...p, [k]: v }));
  const appendTo = (k, text, sep = ', ') => setSoap((p) => ({ ...p, [k]: p[k] ? `${p[k]}${sep}${text}` : text }));
  const updateMed = (id, patch) => setRx((p) => p.map((m) => (m._id === id ? { ...m, ...patch } : m)));
  const removeMed = (id) => setRx((p) => p.filter((m) => m._id !== id));
  const addDrug = (drug) => setRx((p) => [...p, newMed(drug)]);

  const lastVisitRx = history.find((h) => h.prescriptions?.length)?.prescriptions || [];
  const repeatLast = () => {
    setRx((p) => [...p, ...lastVisitRx.map(fromSaved)]);
    flash(`${lastVisitRx.length} medicine(s) copied from the last visit. Check the days.`, 'info');
  };
  const applyTemplate = (t) => {
    setSoap((s) => ({ ...s, chiefComplaints: t.soap.chiefComplaints || s.chiefComplaints, history: t.soap.history || s.history,
      examination: t.soap.examination || s.examination, diagnosis: t.soap.diagnosis || s.diagnosis }));
    if (t.soap.icd10Codes?.length) setIcd10Codes(t.soap.icd10Codes);
    if (t.prescriptions?.length) setRx(t.prescriptions.map(fromSaved));
    flash(`“${t.name}” template filled in. Edit anything that differs.`, 'info');
  };
  const saveTemplate = async () => {
    if (!tmplName.trim() || !validRx.length || !doctorId) return;
    const r = await post('/api/consultations/templates', { doctorId, templateName: tmplName.trim(), medicines: validRx.map(toSaved) });
    if (r.ok) { setRxTemplates((p) => [{ id: r.data.templateId, template_name: tmplName.trim(), medicines: validRx.map(toSaved) }, ...p]); setTmplName(''); flash('Saved as your template'); }
  };

  // ── Save ──
  const save = useCallback(async ({ finish = false } = {}) => {
    const missingTimes = validRx.filter((m) => !perDay(m) || !m.days);
    if (finish && missingTimes.length) {
      setStep(2);
      flash(`Please choose when to take and for how many days: ${missingTimes.map((m) => m.medicine_name).join(', ')}`, 'bad');
      return false;
    }
    setSaving(true);
    const r = await post('/api/consultations', {
      appointmentId: appt.appointment_id, doctorId, patientRegNo: appt.reg_no,
      chiefComplaints: soap.chiefComplaints, diagnosis: soap.diagnosis, notes: soap.history, soapHistory: soap.history, soapExam: soap.examination,
      followUpDate: soap.followUp || null, patientInstructions: soap.patientInstructions, icd10Codes, vitals,
      prescriptions: validRx.map(toSaved), labOrders: labs,
      imagingOrders: imaging.map(({ modality, body_part, urgency, clinical_indication, status }) => ({ modality, body_part, urgency, clinical_indication, status })),
    });
    setSaving(false);
    if (!r.ok) { flash(r.data.message || 'Could not save. Check the connection and try again.', 'bad'); return false; }
    try { localStorage.removeItem(DRAFT_KEY(appt.appointment_id)); } catch { /* ignore */ }
    if (finish) {
      await post(`/api/appointments/${appt.appointment_id}/complete`).catch(() => {});
      setShowSummary(true);
    } else flash('Saved');
    return true;
  }, [appt, doctorId, soap, icd10Codes, vitals, validRx, labs, imaging]);

  // ── Print ──
  function handlePrint() {
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const icd = icd10Codes.map((c) => `${c.code} — ${c.description}`).join('; ');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Prescription — ${esc(patientName)}</title><style>
      body{font-family:Arial,sans-serif;margin:0;padding:22px;color:#0f1f33}
      .hd{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1a6fd4;padding-bottom:10px;margin-bottom:12px}
      .hn{font-size:20px;font-weight:700;color:#1a6fd4}.sub{font-size:12px;color:#6b87a2}
      .pt{background:#f0f6ff;border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;gap:28px;flex-wrap:wrap;font-size:14px}
      .vt{font-size:13px;margin-bottom:12px;display:flex;gap:16px;flex-wrap:wrap}
      h3{font-size:13px;color:#1a6fd4;text-transform:uppercase;margin:14px 0 6px;border-bottom:1px solid #dce8f5;padding-bottom:3px}
      p{margin:4px 0;font-size:14px;white-space:pre-wrap}
      table{width:100%;border-collapse:collapse;font-size:14px}th{background:#1a6fd4;color:#fff;padding:7px 9px;text-align:left}
      td{border-bottom:1px solid #dce8f5;padding:7px 9px;vertical-align:top}.big{font-size:16px;font-weight:700;letter-spacing:1px}
      .tag{display:inline-block;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:6px;padding:3px 9px;margin:2px;font-size:13px}
      .ft{display:flex;justify-content:space-between;align-items:flex-end;margin-top:36px;font-size:12px;color:#6b87a2}
      .sg{border-top:1px solid #0f1f33;width:200px;text-align:center;padding-top:4px;color:#0f1f33}</style></head><body>
      <div class="hd"><div>${hospital.logo_url ? `<img src="${hospital.logo_url}" style="height:48px;vertical-align:middle;margin-right:10px">` : ''}<span class="hn">${esc(hospital.hospital_name || 'Hospital')}</span>
        <div class="sub">${esc(hospital.address || '')}${hospital.phone ? ` · ${esc(hospital.phone)}` : ''}</div></div>
        <div class="sub">Date: ${new Date().toLocaleDateString('en-IN')}</div></div>
      <div class="pt"><span><b>Name:</b> ${esc(patientName)}</span><span><b>Age/Sex:</b> ${age ?? '—'} / ${esc(appt.gender || '—')}</span><span><b>UHID:</b> ${esc(appt.reg_no)}</span></div>
      ${Object.values(vitals).some(Boolean) ? `<div class="vt">${vitals.bp_systolic ? `<span><b>BP</b> ${esc(vitals.bp_systolic)}/${esc(vitals.bp_diastolic)}</span>` : ''}${vitals.pulse ? `<span><b>Pulse</b> ${esc(vitals.pulse)}</span>` : ''}${vitals.temperature ? `<span><b>Temp</b> ${esc(vitals.temperature)}°F</span>` : ''}${vitals.spo2 ? `<span><b>SpO₂</b> ${esc(vitals.spo2)}%</span>` : ''}${vitals.weight ? `<span><b>Wt</b> ${esc(vitals.weight)} kg</span>` : ''}</div>` : ''}
      ${soap.chiefComplaints ? `<h3>Complaints</h3><p>${esc(soap.chiefComplaints)}</p>` : ''}
      ${soap.diagnosis ? `<h3>Diagnosis</h3><p>${esc(soap.diagnosis)}${icd ? `\n${esc(icd)}` : ''}</p>` : ''}
      ${validRx.length ? `<h3>℞ Medicines</h3><table><thead><tr><th>#</th><th>Medicine</th><th>Dose</th><th>When</th><th>Days</th><th>Instructions</th></tr></thead><tbody>
        ${validRx.map((m, i) => `<tr><td>${i + 1}</td><td><b>${esc(m.medicine_name)}</b>${m.generic && m.generic !== m.medicine_name ? `<br><small>${esc(m.generic)}</small>` : ''}</td><td>${esc(m.dosage)}</td>
        <td><span class="big">${pattern(m)}</span><br><small>${esc(timesText(m))}</small></td><td>${esc(m.days)}</td><td>${esc([m.food, m.notes].filter(Boolean).join('. '))}${m.route !== 'Oral' ? `<br><small>${esc(m.route)}</small>` : ''}</td></tr>`).join('')}
        </tbody></table><p style="font-size:11px;color:#6b87a2">1-0-1 = morning – afternoon – night</p>` : ''}
      ${labs.length ? `<h3>Lab tests</h3>${labs.map((l) => `<span class="tag">${esc(l.test_name)}${l.urgency !== 'Routine' ? ` (${esc(l.urgency)})` : ''}</span>`).join('')}` : ''}
      ${imaging.length ? `<h3>X-ray / Scans</h3>${imaging.map((l) => `<span class="tag">${esc(l.modality)} – ${esc(l.body_part)}${l.urgency !== 'Routine' ? ` (${esc(l.urgency)})` : ''}</span>`).join('')}` : ''}
      ${soap.patientInstructions ? `<h3>Advice</h3><p>${esc(soap.patientInstructions)}</p>` : ''}
      ${soap.followUp ? `<h3>Next visit</h3><p>${esc(fmtDay(soap.followUp))}</p>` : ''}
      <div class="ft"><span>UHID ${esc(appt.reg_no)} · ${new Date().toLocaleString('en-IN')}</span><span class="sg">${esc(appt.doctor || 'Doctor')}<br>Signature</span></div>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { flash('Allow pop-ups for this site to print', 'bad'); return; }
    w.document.write(html); w.document.close();
    setTimeout(() => w.print(), 400);
  }

  // Ctrl+S saves, Ctrl+P prints.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); handlePrint(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const whatsapp = () => {
    setShowMore(false);
    let msg = `*${hospital.hospital_name || 'Prescription'}*\n${patientName} · ${new Date().toLocaleDateString('en-IN')}\n\n`;
    if (soap.diagnosis) msg += `*Diagnosis:* ${soap.diagnosis}\n\n`;
    if (validRx.length) msg += `*Medicines:*\n${validRx.map((m, i) => `${i + 1}. ${m.medicine_name} ${m.dosage} — ${pattern(m)} (${timesText(m)}) — ${m.days} days${m.food ? ` — ${m.food}` : ''}`).join('\n')}\n`;
    if (labs.length) msg += `\n*Tests:* ${labs.map((l) => l.test_name).join(', ')}`;
    if (imaging.length) msg += `\n*X-ray / Scans:* ${imaging.map((l) => `${l.modality} ${l.body_part}`).join(', ')}`;
    if (soap.followUp) msg += `\n\n*Next visit:* ${fmtDay(soap.followUp)}`;
    const phone = String(appt.telephone || '').replace(/\D/g, '').slice(-10);
    window.open(`https://wa.me/${phone ? `91${phone}` : ''}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const stepDone = [
    !!(soap.chiefComplaints.trim() || Object.values(vitals).some(Boolean)),
    !!(soap.examination.trim() || soap.diagnosis.trim()),
    validRx.length > 0,
    labs.length + imaging.length > 0,
    !!(soap.patientInstructions.trim() || soap.followUp),
  ];

  return (
    <div className="cw-overlay">
      <div className="cw-panel">
        {/* ── Header ── */}
        <header className="cw-top">
          <div className="cw-pt">
            <span className="cw-avatar">{appt.photo_base64 ? <img src={`data:image/jpeg;base64,${appt.photo_base64}`} alt="" /> : initials(appt.first_name, appt.last_name)}</span>
            <div>
              <strong>{patientName}</strong>
              <span>{[age !== null ? `${age} yrs` : null, appt.gender, appt.reg_no, appt.token_number ? `Token ${appt.token_number}` : null].filter(Boolean).join(' · ')}</span>
            </div>
            {appt.reason && <span className="cw-reason">“{appt.reason}”</span>}
          </div>
          <div className="cw-top-actions">
            <Timer start={startedAt} />
            <button type="button" className="cw-btn" onClick={() => save()} disabled={saving} title="Save (Ctrl+S)"><Save size={16} /> {saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="cw-btn" onClick={handlePrint} title="Print prescription (Ctrl+P)"><Printer size={16} /> Print</button>
            <div className="cw-more">
              <button type="button" className="cw-btn" onClick={() => setShowMore((o) => !o)} aria-expanded={showMore}><MoreHorizontal size={16} /> More</button>
              {showMore && (
                <div className="cw-menu" onMouseLeave={() => setShowMore(false)}>
                  <button type="button" onClick={() => { setShowMore(false); setShowScribe(true); }}><Mic size={16} /> Voice scribe (listen to the visit)</button>
                  <button type="button" onClick={() => { setShowMore(false); setShowTimeline(true); }}><History size={16} /> Patient's past visits</button>
                  <button type="button" onClick={() => { setShowMore(false); setShowCert(true); }}><FileText size={16} /> Medical certificate</button>
                  <button type="button" onClick={whatsapp}><MessageCircle size={16} /> Send on WhatsApp</button>
                </div>
              )}
            </div>
            <button type="button" className="cw-icon-btn" onClick={() => setContextOpen((o) => !o)} title={contextOpen ? 'Hide patient history' : 'Show patient history'}>
              {contextOpen ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}
            </button>
            <button type="button" className="cw-icon-btn" onClick={onClose} title="Close" aria-label="Close"><X size={20} /></button>
          </div>
        </header>

        {/* ── Steps ── */}
        <nav className="cw-steps">
          {STEPS.map((s, i) => (
            <button key={s.id} type="button" className={`cw-step${step === i ? ' on' : ''}${stepDone[i] ? ' done' : ''}`} onClick={() => setStep(i)}>
              <span className="cw-step-no">{stepDone[i] && step !== i ? <Check size={14} /> : i + 1}</span>{s.label}
            </button>
          ))}
        </nav>

        <div className="cw-body">
          <main className="cw-main">
            {/* 1 — Vitals & complaints */}
            {step === 0 && (
              <div className="cw-stack">
                <section className="cw-card">
                  <h2>Vitals</h2>
                  <div className="cw-vitals">
                    {VITALS.map((f) => (
                      <label key={f.key} className={`cw-vital ${vitalTone(f, vitals[f.key])}`}>
                        <span>{f.label}</span>
                        <span className="cw-vital-in">
                          <input type="number" inputMode="decimal" value={vitals[f.key]} onChange={(e) => setVitals((v) => ({ ...v, [f.key]: e.target.value }))} placeholder="—" />
                          <em>{f.unit}</em>
                        </span>
                      </label>
                    ))}
                    {bmi && <div className={`cw-vital ${bmi.tone}`}><span>BMI</span><b style={{ fontSize: 20 }}>{bmi.val}</b><small>{bmi.cat}</small></div>}
                  </div>
                </section>

                <section className="cw-card">
                  <div className="cw-card-head">
                    <h2>What is the problem? <small>(complaints)</small></h2>
                    <div className="cw-row">
                      {history.length > 0 && <button type="button" className="cw-btn sm" onClick={() => appendTo('chiefComplaints', history[0].chief_complaints || '', '\n')}><Repeat size={14} /> Same as last visit</button>}
                      <VoiceBtn onTranscript={(t) => appendTo('chiefComplaints', t, ' ')} />
                    </div>
                  </div>
                  <div className="cw-chips">
                    {COMMON_SYMPTOMS.map((s) => <button key={s} type="button" className="cw-chip lg" onClick={() => appendTo('chiefComplaints', s)}><Plus size={14} /> {s}</button>)}
                  </div>
                  <textarea className="cw-text" rows={4} value={soap.chiefComplaints} onChange={(e) => setSoapField('chiefComplaints', e.target.value)}
                    placeholder="Tap the buttons above or type, e.g. Fever and cough for 3 days" />
                  <details className="cw-details">
                    <summary>More symptoms by body system</summary>
                    <div className="cw-chips">{ALL_SYSTEMS.map((s) => <button key={s} type="button" className={`cw-chip${system === s ? ' on' : ''}`} onClick={() => setSystem(s)}>{s}</button>)}</div>
                    <div className="cw-chips">{(SYMPTOM_CHIPS[system] || []).map((s) => <button key={s} type="button" className="cw-chip" onClick={() => appendTo('chiefComplaints', s)}>+ {s}</button>)}</div>
                  </details>
                  <label className="cw-label">History / details (optional)</label>
                  <textarea className="cw-text" rows={3} value={soap.history} onChange={(e) => setSoapField('history', e.target.value)} placeholder="Since when, how it started, past illnesses…" />
                </section>

                <section className="cw-card">
                  <h2>Ready-made templates <small>(fills complaints, diagnosis and medicines)</small></h2>
                  <div className="cw-chips">
                    {CONSULTATION_TEMPLATES.map((t) => <button key={t.id} type="button" className="cw-chip lg" onClick={() => applyTemplate(t)}>{t.icon} {t.name}</button>)}
                  </div>
                </section>
              </div>
            )}

            {/* 2 — Examination & diagnosis */}
            {step === 1 && (
              <div className="cw-stack">
                <section className="cw-card">
                  <div className="cw-card-head">
                    <h2>Examination findings</h2>
                    <VoiceBtn onTranscript={(t) => appendTo('examination', t, ' ')} />
                  </div>
                  <p className="cw-hint">Tap a part to write “normal”, then change what is not normal.</p>
                  <div className="cw-chips">
                    {EXAM_QUICK.map((sys) => <button key={sys} type="button" className="cw-chip lg" onClick={() => appendTo('examination', `${sys}: normal`, '\n')}><Plus size={14} /> {sys}: normal</button>)}
                  </div>
                  <textarea className="cw-text" rows={5} value={soap.examination} onChange={(e) => setSoapField('examination', e.target.value)} placeholder="e.g. Throat: congested. Chest: clear." />
                </section>
                <section className="cw-card">
                  <h2>Diagnosis</h2>
                  <textarea className="cw-text" rows={2} value={soap.diagnosis} onChange={(e) => setSoapField('diagnosis', e.target.value)} placeholder="e.g. Viral fever" />
                  <label className="cw-label">Find a disease code (ICD-10, optional)</label>
                  <div className="cw-search">
                    <Search size={16} />
                    <input value={icdQ} onChange={(e) => setIcdQ(e.target.value)} placeholder="Type a disease name, e.g. fever, diabetes" />
                  </div>
                  {icdQ.length >= 2 && (
                    <div className="cw-chips">
                      {searchICD10(icdQ).slice(0, 12).map((c) => (
                        <button key={c.code} type="button" className="cw-chip" onClick={() => {
                          if (!icd10Codes.some((x) => x.code === c.code)) setIcd10Codes((p) => [...p, c]);
                          if (!soap.diagnosis.trim()) setSoapField('diagnosis', c.description);
                          setIcdQ('');
                        }}><b>{c.code}</b>&nbsp;{c.description}</button>
                      ))}
                    </div>
                  )}
                  {icd10Codes.length > 0 && (
                    <div className="cw-chips">
                      {icd10Codes.map((c) => (
                        <span key={c.code} className="cw-chip on">{c.code} {c.description}
                          <button type="button" className="cw-x" onClick={() => setIcd10Codes((p) => p.filter((x) => x.code !== c.code))} aria-label={`Remove ${c.code}`}><X size={13} /></button>
                        </span>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* 3 — Medicines */}
            {step === 2 && (
              <div className="cw-stack">
                <section className="cw-card">
                  <div className="cw-card-head">
                    <h2>Medicines {validRx.length > 0 && <small>({validRx.length})</small>}</h2>
                    <div className="cw-row">
                      {lastVisitRx.length > 0 && <button type="button" className="cw-btn sm" onClick={repeatLast}><Repeat size={14} /> Repeat last visit's medicines</button>}
                    </div>
                  </div>
                  <MedicineSearch onPick={addDrug} autoFocus stock={stock} />
                  {rxTemplates.length > 0 && (
                    <div className="cw-chips">
                      <span className="cw-muted"><Star size={13} /> My templates:</span>
                      {rxTemplates.map((t) => <button key={t.id} type="button" className="cw-chip" onClick={() => { setRx((p) => [...p, ...(t.medicines || []).map(fromSaved)]); flash(`Added “${t.template_name}”`, 'info'); }}>{t.template_name}</button>)}
                    </div>
                  )}
                </section>

                {interactions.length > 0 && (
                  <div className="cw-alert bad"><AlertTriangle size={17} /> Possible interaction: {interactions.map((w) => `${w.drug1} + ${w.drug2}`).join('; ')}</div>
                )}

                {rx.length === 0 && <div className="cw-empty">No medicines yet. Type a name in the box above to add one.</div>}
                {rx.map((m, i) => (
                  <MedicineCard key={m._id} med={m} index={i} onChange={updateMed} onRemove={removeMed} stock={stock}
                    warn={interactions.some((w) => w.drug1 === m.medicine_name || w.drug2 === m.medicine_name)} />
                ))}

                {validRx.length > 0 && (
                  <div className="cw-row" style={{ justifyContent: 'flex-end' }}>
                    <input className="cw-input" style={{ width: 240 }} value={tmplName} onChange={(e) => setTmplName(e.target.value)} placeholder="Name, e.g. Viral fever adult" />
                    <button type="button" className="cw-btn" onClick={saveTemplate} disabled={!tmplName.trim()}><Star size={15} /> Save these as my template</button>
                  </div>
                )}
              </div>
            )}

            {/* 4 — Lab tests & imaging */}
            {step === 3 && (
              <div className="cw-stack">
                <section className="cw-card">
                  <div className="cw-card-head"><h2>X-ray, scans & ECG</h2></div>
                  <ImagingPicker selected={imaging} onChange={setImaging} />
                </section>
                <section className="cw-card">
                  <div className="cw-card-head"><h2>Lab tests</h2></div>
                  <LabPicker labTests={labTests} selected={labs} onChange={setLabs} suggested={suggested} />
                </section>
                {(labs.length > 0 || imaging.length > 0) && (
                  <section className="cw-card">
                    <h2>Ordered ({labs.length + imaging.length})</h2>
                    <div className="cw-orders">
                      {imaging.map((o) => (
                        <div key={o._id} className="cw-order">
                          <b>{o.modality}</b> {o.body_part}
                          <Urgency value={o.urgency} options={['Routine', 'Urgent', 'STAT']} onChange={(u) => setImaging((p) => p.map((x) => (x._id === o._id ? { ...x, urgency: u } : x)))} />
                          <button type="button" className="cw-icon-btn danger" onClick={() => setImaging((p) => p.filter((x) => x._id !== o._id))} aria-label="Remove"><Trash2 size={15} /></button>
                        </div>
                      ))}
                      {labs.map((o) => (
                        <div key={o.test_id} className="cw-order">
                          <b>Lab</b> {o.test_name}
                          <Urgency value={o.urgency} options={['Routine', 'ASAP', 'STAT']} onChange={(u) => setLabs((p) => p.map((x) => (x.test_id === o.test_id ? { ...x, urgency: u } : x)))} />
                          <button type="button" className="cw-icon-btn danger" onClick={() => setLabs((p) => p.filter((x) => x.test_id !== o.test_id))} aria-label="Remove"><Trash2 size={15} /></button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* 5 — Advice & finish */}
            {step === 4 && (
              <div className="cw-stack">
                <section className="cw-card">
                  <h2>Advice for the patient</h2>
                  <div className="cw-chips">{ADVICE.map((a) => <button key={a} type="button" className="cw-chip lg" onClick={() => appendTo('patientInstructions', a, '\n')}><Plus size={14} /> {a}</button>)}</div>
                  <textarea className="cw-text" rows={4} value={soap.patientInstructions} onChange={(e) => setSoapField('patientInstructions', e.target.value)} placeholder="Tap the advice above or type your own" />
                </section>
                <section className="cw-card">
                  <h2>Next visit</h2>
                  <div className="cw-chips">
                    {FOLLOW_UPS.map(([l, n]) => <button key={l} type="button" className={`cw-chip lg${soap.followUp === isoPlusDays(n) ? ' on' : ''}`} onClick={() => setSoapField('followUp', isoPlusDays(n))}>After {l}</button>)}
                    <input type="date" className="cw-input" style={{ width: 170 }} value={soap.followUp} onChange={(e) => setSoapField('followUp', e.target.value)} aria-label="Follow-up date" />
                    {soap.followUp && <button type="button" className="cw-chip" onClick={() => setSoapField('followUp', '')}>No follow-up</button>}
                  </div>
                  {soap.followUp && <p className="cw-hint">Next visit on <b>{fmtDay(soap.followUp)}</b></p>}
                </section>
                <section className="cw-card cw-review">
                  <h2>Check before finishing</h2>
                  <ul>
                    <li className={soap.chiefComplaints.trim() ? 'ok' : ''}>Complaints: {soap.chiefComplaints.trim() || <em>not written</em>}</li>
                    <li className={soap.diagnosis.trim() ? 'ok' : ''}>Diagnosis: {soap.diagnosis.trim() || <em>not written</em>}</li>
                    <li className={validRx.length ? 'ok' : ''}>Medicines: {validRx.length ? validRx.map((m) => `${m.medicine_name} ${perDay(m) ? pattern(m) : '(time not chosen)'}${m.days ? ` × ${m.days}d` : ' (days not set)'}`).join(', ') : <em>none</em>}</li>
                    <li className={labs.length + imaging.length ? 'ok' : ''}>Tests / X-ray: {[...labs.map((l) => l.test_name), ...imaging.map((o) => `${o.modality} ${o.body_part}`)].join(', ') || <em>none</em>}</li>
                  </ul>
                  <button type="button" className="cw-finish" onClick={() => save({ finish: true })} disabled={saving}>
                    <CheckCircle2 size={22} /> {saving ? 'Saving…' : 'Finish consultation'}
                  </button>
                  <p className="cw-hint" style={{ textAlign: 'center' }}>Saves everything, marks the patient as seen and shows the summary to print or send.</p>
                </section>
              </div>
            )}

            {/* Back / Next */}
            <div className="cw-nav">
              <button type="button" className="cw-btn lg" disabled={step === 0} onClick={() => setStep((s) => s - 1)}><ChevronLeft size={18} /> Back</button>
              {step < STEPS.length - 1
                ? <button type="button" className="cw-btn lg primary" onClick={() => setStep((s) => s + 1)}>Next: {STEPS[step + 1].label} <ChevronRight size={18} /></button>
                : <button type="button" className="cw-btn lg primary" onClick={() => save({ finish: true })} disabled={saving}><CheckCircle2 size={18} /> Finish consultation</button>}
            </div>
          </main>

          {/* ── Patient history ── */}
          {contextOpen && (
            <aside className="cw-side">
              <h3>Patient history</h3>
              <div className="cw-side-block">
                <h4>Allergies</h4>
                <p className="cw-muted">None recorded.</p>
              </div>
              <div className="cw-side-block">
                <h4>Past visits ({history.length})</h4>
                {history.length === 0 && <p className="cw-muted">First visit.</p>}
                {history.slice(0, 5).map((h, i) => (
                  <div key={i} className="cw-visit">
                    <b>{new Date(h.appt_date || h.consultation_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</b>
                    {h.diagnosis && <span>{h.diagnosis}</span>}
                    {h.prescriptions?.length > 0 && <small>{h.prescriptions.map((p) => p.medicine_name).join(', ')}</small>}
                  </div>
                ))}
              </div>
              {Object.keys(labTrends).length > 0 && (
                <div className="cw-side-block">
                  <h4>Recent lab results</h4>
                  {Object.entries(labTrends).slice(0, 8).map(([name, results]) => (
                    <div key={name} className="cw-lab"><span>{name}</span><b>{results[0].result_value} {results[0].result_unit}</b></div>
                  ))}
                </div>
              )}
            </aside>
          )}
        </div>

        {toast && <div className={`cw-toast ${toast.tone}`} role="status">{toast.msg}</div>}
      </div>

      {showCert && <CertificateGenerator appt={appt} soap={soap} icd10Codes={icd10Codes} onClose={() => setShowCert(false)} />}
      {showSummary && (
        <PostVisitSummary appt={appt} soap={soap} prescriptions={validRx.map((m) => ({ ...toSaved(m), frequency: `${pattern(m)} (${timesText(m)})` }))}
          labOrders={[...labs, ...imaging.map((o) => ({ test_name: `${o.modality} – ${o.body_part}` }))]}
          icd10Codes={icd10Codes} followUpDate={soap.followUp} onClose={() => { setShowSummary(false); onClose(); }} />
      )}
      {showTimeline && <PatientTimeline regNo={appt.reg_no} patientName={patientName} onClose={() => setShowTimeline(false)} />}
      {showScribe && (
        <AmbientScribe
          onApplySOAP={(r) => setSoap((p) => ({
            ...p,
            chiefComplaints: r.chiefComplaints ? [p.chiefComplaints, r.chiefComplaints].filter(Boolean).join('\n') : p.chiefComplaints,
            history: r.soapHistory ? [p.history, r.soapHistory].filter(Boolean).join('\n') : p.history,
            examination: r.soapExam ? [p.examination, r.soapExam].filter(Boolean).join('\n') : p.examination,
            diagnosis: r.diagnosis ? [p.diagnosis, r.diagnosis].filter(Boolean).join('\n') : p.diagnosis,
          }))}
          onClose={() => setShowScribe(false)}
        />
      )}
    </div>
  );
}

function Urgency({ value, options, onChange }) {
  return (
    <span className="cw-urg">
      {options.map((o) => <button key={o} type="button" className={`${value === o ? 'on' : ''} ${o.toLowerCase()}`} onClick={() => onChange(o)}>{o === 'STAT' ? 'Emergency' : o}</button>)}
    </span>
  );
}
