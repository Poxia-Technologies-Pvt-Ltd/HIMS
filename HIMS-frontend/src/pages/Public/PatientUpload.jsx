import { useState, useRef, useMemo } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';

const REQUIRED_KEYS = ['first_name', 'last_name', 'gender', 'phone', 'patient_type'];

// ---------------------------------------------------------------------------
// Public, no-login page: a walk-in patient photographs their doctor's
// prescription or an existing outside bill, the photo is read by Ollama Cloud
// vision (publicUploadController.analyzeUpload) against the real test catalog,
// and — once every required field is present and at least one test was
// confidently identified — this bills them automatically
// (publicUploadController.submitUpload), no staff involved. If the photo's
// tests can't be identified with confidence, the flow deliberately refuses to
// guess and sends the patient to the counter instead.
// ---------------------------------------------------------------------------

const STEPS = [
  { key: 'upload', label: 'Upload photo', hint: 'Prescription or bill' },
  { key: 'review', label: 'Confirm details', hint: 'Check what we read' },
  { key: 'done', label: 'Billed', hint: 'Collect your sample' },
];

// Which stepper node is active for a given internal stage.
const STAGE_TO_STEP = { upload: 0, error: 0, manual: 0, review: 1, done: 2 };

// -----------------------------------------------------------------------
// Global styles. Design language: a specimen-requisition slip rather than
// a generic SaaS card kit — a teal clinical palette, a graduated tracking
// rail borrowed from lab measurement scales, and a camera viewfinder frame
// for the one moment that actually matters: getting a readable photo.
// -----------------------------------------------------------------------
const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');

    .ka-root {
      --paper: #F3F6F5;
      --surface: #FFFFFF;
      --sunken: #EAEFED;
      --border: #D6DEDB;
      --border-strong: #B9C6C2;
      --ink: #12201D;
      --ink-sub: #5B6E68;
      --brand: #0C6B5E;
      --brand-deep: #084F45;
      --brand-tint: #E1F1EC;
      --warn: #9A5B0B;
      --warn-bg: #FBF0DE;
      --err: #AE342A;
      --err-bg: #FBEAE8;
      --ok: #0C6B5E;
      --ok-bg: #E1F1EC;
      --r-sm: 8px;
      --r-md: 12px;
      --r-lg: 20px;

      min-height: 100vh;
      background: var(--paper);
      background-image: radial-gradient(circle at 1px 1px, rgba(12,107,94,0.06) 1px, transparent 0);
      background-size: 22px 22px;
      color: var(--ink);
      font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      font-variant-numeric: tabular-nums;
      padding-bottom: 32px;
    }

    .ka-shell { max-width: 920px; margin: 0 auto; padding: 0 18px; }

    .ka-header { padding: 24px 0 18px; }
    .ka-brand { display: flex; align-items: center; gap: 9px; font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 14px; color: var(--brand-deep); }
    .ka-brand-mark { width: 22px; height: 22px; border-radius: 6px; background: var(--brand); display: grid; place-items: center; flex: none; }
    .ka-h1 { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: clamp(22px, 4.4vw, 30px); line-height: 1.18; margin: 20px 0 8px; letter-spacing: -0.01em; }
    .ka-lede { font-size: 14.5px; color: var(--ink-sub); line-height: 1.6; max-width: 58ch; margin: 0; }

    /* ---------------- tracking rail (signature element) ---------------- */
    .rail-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 22px 22px 18px; margin: 18px 0 20px; }
    .rail { position: relative; height: 34px; margin: 0 4px 2px; }
    .rail-line { position: absolute; top: 15px; left: 0; right: 0; height: 2px; background: var(--border-strong); }
    .rail-fill { position: absolute; top: 15px; left: 0; height: 2px; background: var(--brand); transition: width .4s cubic-bezier(.4,0,.2,1); }
    .rail-tick { position: absolute; top: 10px; width: 1px; height: 12px; background: var(--border-strong); }
    .rail-stop { position: absolute; top: 6px; width: 20px; height: 20px; margin-left: -10px; border-radius: 50%; background: var(--surface); border: 2px solid var(--border-strong); display: grid; place-items: center; font-size: 10px; font-weight: 700; color: var(--ink-sub); transition: all .25s ease; }
    .rail-stop.is-done { background: var(--brand); border-color: var(--brand); color: #fff; }
    .rail-stop.is-active { border-color: var(--brand); color: var(--brand); box-shadow: 0 0 0 4px var(--brand-tint); }
    .rail-labels { display: flex; justify-content: space-between; margin-top: 6px; }
    .rail-label { flex: 1; text-align: center; font-size: 12.5px; font-weight: 600; }
    .rail-label:first-child { text-align: left; }
    .rail-label:last-child { text-align: right; }
    .rail-hint { display: block; font-size: 11px; font-weight: 400; color: var(--ink-sub); margin-top: 1px; }

    /* ---------------- layout ---------------- */
    .ka-grid { display: grid; grid-template-columns: 1fr; gap: 18px; }
    @media (min-width: 780px) { .ka-grid { grid-template-columns: 1.5fr 1fr; align-items: start; } }

    .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 26px; }
    .card h2 { font-family: 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 600; margin: 0 0 5px; }
    .card-sub { font-size: 13.5px; color: var(--ink-sub); margin: 0 0 18px; line-height: 1.55; }

    /* ---------------- upload viewfinder ---------------- */
    .frame { position: relative; border-radius: var(--r-md); background: var(--sunken); padding: 38px 20px; text-align: center; cursor: pointer; transition: background .15s ease; }
    .frame:hover, .frame.is-drag { background: var(--brand-tint); }
    .frame:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
    .corner { position: absolute; width: 22px; height: 22px; border-color: var(--border-strong); transition: border-color .15s ease; }
    .frame.is-drag .corner, .frame:hover .corner { border-color: var(--brand); }
    .corner-tl { top: 10px; left: 10px; border-top: 2px solid; border-left: 2px solid; border-radius: 5px 0 0 0; }
    .corner-tr { top: 10px; right: 10px; border-top: 2px solid; border-right: 2px solid; border-radius: 0 5px 0 0; }
    .corner-bl { bottom: 10px; left: 10px; border-bottom: 2px solid; border-left: 2px solid; border-radius: 0 0 0 5px; }
    .corner-br { bottom: 10px; right: 10px; border-bottom: 2px solid; border-right: 2px solid; border-radius: 0 0 5px 0; }
    .frame-title { font-weight: 600; font-size: 15px; margin-top: 12px; }
    .frame-sub { font-size: 12.5px; color: var(--ink-sub); margin-top: 3px; }
    .preview-img { width: 100%; margin-top: 14px; border-radius: var(--r-md); border: 1px solid var(--border); display: block; }

    .spinner { width: 15px; height: 15px; border: 2px solid var(--brand); border-top-color: transparent; border-radius: 50%; display: inline-block; animation: ka-spin .7s linear infinite; }
    @keyframes ka-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 1.6s; } .rail-fill { transition: none; } }
    .busy-row { margin-top: 16px; color: var(--brand-deep); font-weight: 600; font-size: 13.5px; display: flex; align-items: center; gap: 10px; }

    /* ---------------- notes ---------------- */
    .note { padding: 13px 15px; border-radius: var(--r-sm); font-size: 13.5px; line-height: 1.55; }
    .note-err { background: var(--err-bg); color: var(--err); }
    .note-warn { background: var(--warn-bg); color: var(--warn); }
    .note-ok { background: var(--ok-bg); color: var(--ok); }

    /* ---------------- form ---------------- */
    .field { margin-top: 17px; }
    .field-label { display: block; font-size: 12.5px; font-weight: 600; color: var(--ink-sub); margin-bottom: 6px; }
    .field-label .req { color: var(--err); }
    .field-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .field-help { font-size: 11.5px; color: var(--ink-sub); margin-top: 5px; }
    .field-err { font-size: 11.5px; color: var(--err); margin-top: 5px; font-weight: 600; }
    .ka-input.is-invalid { border-color: var(--err); }
    .ka-input.is-invalid:focus-visible { box-shadow: 0 0 0 3px var(--err-bg); }
    .form-gate { font-size: 12.5px; color: var(--warn); margin-top: 10px; text-align: center; }
    .no-login { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--brand-deep); background: var(--brand-tint); padding: 5px 10px; border-radius: 999px; margin-top: 12px; }
    .ka-input {
      width: 100%; padding: 12px 13px; border-radius: var(--r-sm); border: 1px solid var(--border-strong);
      font-size: 14.5px; font-family: inherit; box-sizing: border-box; background: var(--surface); color: var(--ink);
      min-height: 46px; outline: none; transition: border-color .12s ease, box-shadow .12s ease;
    }
    .ka-input:focus-visible { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-tint); }
    .ka-input::placeholder { color: #93A29D; }

    /* ---------------- buttons ---------------- */
    .btn {
      width: 100%; padding: 13px 16px; border-radius: var(--r-sm); border: none; font-size: 15px;
      font-weight: 600; font-family: inherit; cursor: pointer; min-height: 48px;
      transition: background .12s ease, transform .05s ease, opacity .12s ease;
    }
    .btn:active { transform: translateY(1px); }
    .btn:disabled { cursor: default; opacity: .65; }
    .btn-primary { background: var(--brand); color: #fff; }
    .btn-primary:hover:not(:disabled) { background: var(--brand-deep); }
    .btn-ghost { background: var(--sunken); color: var(--ink); margin-top: 12px; }
    .btn-ghost:hover { background: var(--border); }
    .btn-link { background: transparent; color: var(--ink-sub); margin-top: 8px; padding: 8px; text-decoration: underline; text-underline-offset: 3px; }

    /* sticky primary action on the review step, so the button that finishes
       billing stays reachable while a patient scrolls a long form on a phone */
    .actions-flow { margin-top: 22px; }
    @media (max-width: 779px) {
      .ka-shell.has-sticky { padding-bottom: 108px; }
      .sticky-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; background: var(--paper); border-top: 1px solid var(--border); padding: 12px 18px calc(12px + env(safe-area-inset-bottom)); box-shadow: 0 -8px 20px -14px rgba(18,32,29,0.25); }
      .sticky-bar .btn-primary { margin-top: 0; }
    }
    @media (min-width: 780px) { .sticky-bar { margin-top: 22px; } }

    /* ---------------- sidebar ---------------- */
    .side-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 22px; }
    .side-title { font-size: 12.5px; font-weight: 700; color: var(--ink-sub); margin: 0 0 4px; }
    .side-note { font-size: 12px; color: var(--ink-sub); margin: 0 0 12px; }
    .test-list { list-style: none; padding: 0; margin: 0; }
    .test-row { display: flex; justify-content: space-between; gap: 10px; font-size: 13.5px; padding: 9px 0; border-bottom: 1px solid var(--border); }
    .test-row:last-child { border-bottom: none; }
    .test-price { font-weight: 700; white-space: nowrap; }
    .test-total { display: flex; justify-content: space-between; font-size: 14.5px; font-weight: 700; padding-top: 12px; margin-top: 4px; border-top: 1px solid var(--border-strong); }
    .facility-note { font-size: 12px; color: var(--ink-sub); margin-top: 10px; margin-bottom: 0; }
    .how-list { margin: 0; padding-left: 18px; font-size: 13.5px; line-height: 1.7; }
    .how-list li + li { margin-top: 2px; }
    .side-hr { border: 0; border-top: 1px solid var(--border); margin: 14px 0; }

    .done-badge { width: 54px; height: 54px; border-radius: 50%; background: var(--ok-bg); color: var(--ok); display: grid; place-items: center; font-size: 26px; font-weight: 700; margin: 0 auto 10px; }
    .sample-list { margin: 10px 0 0; padding-left: 18px; }

    @media print {
      .ka-root { background: #fff; }
      .ka-header, .rail-card, aside, .no-print { display: none !important; }
      .card { border: none; padding: 0; }
    }
  `}</style>
);

function CameraIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 8.5C4 7.67 4.67 7 5.5 7H8l1.1-1.65A1.5 1.5 0 0 1 10.35 4.7h3.3c.55 0 1.06.28 1.35.75L16.1 7h2.4c.83 0 1.5.67 1.5 1.5v9c0 .83-.67 1.5-1.5 1.5h-13c-.83 0-1.5-.67-1.5-1.5v-9Z" stroke="var(--brand)" strokeWidth="1.6" strokeLinejoin="round"/>
      <circle cx="12" cy="13" r="3.4" stroke="var(--brand)" strokeWidth="1.6"/>
    </svg>
  );
}

function TrackRail({ current }) {
  const majorPositions = [0, 50, 100];
  const minorTicks = Array.from({ length: 9 }, (_, i) => (i / 8) * 100);
  const fillPct = majorPositions[current] ?? 0;

  return (
    <div className="rail-card">
      <div className="rail">
        <div className="rail-line" />
        <div className="rail-fill" style={{ width: `${fillPct}%` }} />
        {minorTicks.map((pct) => (
          <span key={pct} className="rail-tick" style={{ left: `${pct}%` }} />
        ))}
        {STEPS.map((s, i) => {
          const state = i < current ? 'is-done' : i === current ? 'is-active' : '';
          return (
            <span
              key={s.key}
              className={`rail-stop ${state}`}
              style={{ left: `${majorPositions[i]}%` }}
              aria-current={i === current ? 'step' : undefined}
            >
              {i < current ? '✓' : i + 1}
            </span>
          );
        })}
      </div>
      <div className="rail-labels">
        {STEPS.map((s, i) => (
          <span key={s.key} className="rail-label" style={{ color: i <= current ? 'var(--ink)' : 'var(--ink-sub)' }}>
            {s.label}
            <span className="rail-hint">{s.hint}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Field({ label, required, help, error, children }) {
  return (
    <div className="field">
      <label className="field-label">{label}{required ? <span className="req"> *</span> : null}</label>
      {children}
      {error ? <div className="field-err">{error}</div> : help ? <div className="field-help">{help}</div> : null}
    </div>
  );
}

const digits = (v) => String(v || '').replace(/\D/g, '');

export default function PatientUpload() {
  const fileRef = useRef(null);
  const [stage, setStage] = useState('upload'); // upload | review | manual | done | error
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [touched, setTouched] = useState({});

  const [uploadId, setUploadId] = useState(null);
  const [matchedTests, setMatchedTests] = useState([]);
  const [fields, setFields] = useState({});
  const [missingKeys, setMissingKeys] = useState([]);
  const [manualReason, setManualReason] = useState('');
  const [result, setResult] = useState(null);
  const [sourceFacility, setSourceFacility] = useState('');

  const reset = () => {
    setStage('upload'); setBusy(false); setError(''); setPreview(null); setDragOver(false); setTouched({});
    setUploadId(null); setMatchedTests([]); setFields({}); setMissingKeys([]);
    setManualReason(''); setResult(null); setSourceFacility('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFile = async (file) => {
    if (!file) return;
    setError('');
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch(`${API_BASE}/api/public/upload/analyze`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || 'Could not analyze this photo.');
        setStage('error');
        return;
      }
      if (data.already_billed) {
        setError(data.message);
        setStage('error');
        return;
      }
      if (data.requires_manual_counter) {
        setManualReason(data.reason || 'Please complete billing at the counter.');
        setStage('manual');
        return;
      }
      setUploadId(data.upload_id);
      setMatchedTests(data.matched_tests || []);
      setMissingKeys(data.missing_fields || []);
      setFields({
        title: data.extracted.title || '',
        first_name: data.extracted.first_name || '',
        middle_name: data.extracted.middle_name || '',
        last_name: data.extracted.last_name || '',
        dob: data.extracted.dob || '',
        age_years: data.extracted.age_years ?? '',
        age_months: data.extracted.age_months ?? '',
        age_days: data.extracted.age_days ?? '',
        gender: data.extracted.gender || '',
        phone: data.extracted.phone || '',
        patient_type: data.extracted.patient_type || 'OP',
        consultant_name: data.extracted.consultant_name || '',
      });
      setSourceFacility(data.extracted.source_facility || '');
      setStage('review');
    } catch (err) {
      console.error(err);
      setError('Network error while analyzing the photo.');
      setStage('error');
    } finally {
      setBusy(false);
    }
  };

  const setField = (k, v) => setFields((prev) => ({ ...prev, [k]: v }));
  const blur = (k) => setTouched((prev) => ({ ...prev, [k]: true }));

  // Per-field validation, mirrored from the backend's submitUpload checks so a
  // first-time user is told what's wrong before the round-trip, not after.
  const fieldErrors = useMemo(() => {
    const e = {};
    if (!String(fields.first_name || '').trim()) e.first_name = 'Required';
    if (!String(fields.last_name || '').trim()) e.last_name = 'Required';
    if (!fields.gender) e.gender = 'Select one';
    if (!fields.patient_type) e.patient_type = 'Select one';
    const ph = digits(fields.phone);
    if (!ph) e.phone = 'Required';
    else if (ph.length !== 10) e.phone = 'Enter a 10-digit mobile number';
    return e;
  }, [fields]);

  const formValid = Object.keys(fieldErrors).length === 0;

  const testsTotal = useMemo(
    () => matchedTests.reduce((sum, t) => sum + (Number(t.price) || 0), 0),
    [matchedTests],
  );

  const handleSubmit = async () => {
    if (!formValid) {
      setTouched({ first_name: true, last_name: true, gender: true, phone: true, patient_type: true });
      setError('Please correct the highlighted fields before submitting.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/public/upload/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upload_id: uploadId, fields }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || 'Could not complete billing.');
        return;
      }
      setResult(data);
      setStage('done');
    } catch (err) {
      console.error(err);
      setError('Network error while submitting.');
    } finally {
      setBusy(false);
    }
  };

  const currentStep = STAGE_TO_STEP[stage] ?? 0;

  return (
    <div className="ka-root">
      <GlobalStyle />
      <div className={`ka-shell ${stage === 'review' ? 'has-sticky' : ''}`}>
        <header className="ka-header">
          <div className="ka-brand">
            <span className="ka-brand-mark" />
            KA LIMS
          </div>
          <h1 className="ka-h1">Self-service test booking</h1>
          <p className="ka-lede">
            Photograph your doctor's prescription or an existing outside bill. We read it, match your
            tests to our catalogue and bill you automatically — no queue, no counter.
          </p>
        </header>

        <TrackRail current={currentStep} />

        <div className="ka-grid">
          <main className="card">
            {/* ---------------------------------------------------------------- UPLOAD */}
            {stage === 'upload' && (
              <>
                <h2>Upload your photo</h2>
                <p className="card-sub">
                  Use good lighting and make sure the patient name, phone number and the list of tests are all readable.
                </p>

                <div
                  role="button"
                  tabIndex={0}
                  className={`frame ${dragOver ? 'is-drag' : ''}`}
                  onClick={() => !busy && fileRef.current?.click()}
                  onKeyDown={(e) => { if (!busy && (e.key === 'Enter' || e.key === ' ')) fileRef.current?.click(); }}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
                >
                  <span className="corner corner-tl" />
                  <span className="corner corner-tr" />
                  <span className="corner corner-bl" />
                  <span className="corner corner-br" />
                  <CameraIcon />
                  <div className="frame-title">Tap to take a photo or choose a file</div>
                  <div className="frame-sub">JPG or PNG · you can also drag an image here</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span className="no-login">✓ No account or login needed</span>
                </div>
                <p className="field-help" style={{ marginTop: 12 }}>
                  Don't have a prescription photo, or booking something not on a prescription?
                  Visit the billing counter and our staff will help you.
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                  disabled={busy}
                  style={{ display: 'none' }}
                />

                {preview && <img src={preview} alt="Upload preview" className="preview-img" />}

                {busy && (
                  <p className="busy-row">
                    <span className="spinner" />
                    Reading your photo…
                  </p>
                )}
              </>
            )}

            {/* ---------------------------------------------------------------- ERROR */}
            {stage === 'error' && (
              <>
                <h2>We couldn't process this photo</h2>
                <div className="note note-err">{error}</div>
                <button className="btn btn-ghost" onClick={reset}>Try again</button>
              </>
            )}

            {/* ---------------------------------------------------------------- MANUAL */}
            {stage === 'manual' && (
              <>
                <h2>Please finish at the counter</h2>
                {preview && <img src={preview} alt="Upload preview" className="preview-img" style={{ marginBottom: 14 }} />}
                <div className="note note-warn">
                  {manualReason}
                  <br /><br />
                  Take this photo or prescription to the billing counter and our staff will complete your booking.
                </div>
                <button className="btn btn-ghost" onClick={reset}>Upload a different photo</button>
              </>
            )}

            {/* ---------------------------------------------------------------- REVIEW */}
            {stage === 'review' && (
              <>
                <h2>Confirm your details</h2>
                <p className="card-sub">
                  We filled in everything we could read. Check each field and complete anything left blank.
                </p>

                {missingKeys.length > 0 && (
                  <div className="note note-warn" style={{ marginBottom: 4 }}>
                    Couldn't read from your photo: <strong>{missingKeys.join(', ')}</strong>. Please fill these in.
                  </div>
                )}

                <Field
                  label="Full name"
                  required
                  error={
                    (touched.first_name && fieldErrors.first_name && 'First name is required') ||
                    (touched.last_name && fieldErrors.last_name && 'Last name is required') ||
                    ''
                  }
                >
                  <div className="field-row">
                    <input className="ka-input" style={{ flex: '0 0 72px' }} placeholder="Title" value={fields.title} onChange={(e) => setField('title', e.target.value)} />
                    <input
                      className={`ka-input ${touched.first_name && fieldErrors.first_name ? 'is-invalid' : ''}`}
                      style={{ flex: 1, minWidth: 120 }} placeholder="First name" value={fields.first_name}
                      onChange={(e) => setField('first_name', e.target.value)} onBlur={() => blur('first_name')}
                    />
                    <input className="ka-input" style={{ flex: 1, minWidth: 100 }} placeholder="Middle" value={fields.middle_name} onChange={(e) => setField('middle_name', e.target.value)} />
                    <input
                      className={`ka-input ${touched.last_name && fieldErrors.last_name ? 'is-invalid' : ''}`}
                      style={{ flex: 1, minWidth: 120 }} placeholder="Last name" value={fields.last_name}
                      onChange={(e) => setField('last_name', e.target.value)} onBlur={() => blur('last_name')}
                    />
                  </div>
                </Field>

                <Field label="Date of birth">
                  <input type="date" className="ka-input" value={fields.dob} onChange={(e) => setField('dob', e.target.value)} />
                </Field>

                <Field label="Age (years / months / days)">
                  <div className="field-row">
                    <input className="ka-input" style={{ flex: 1 }} placeholder="Yrs" value={fields.age_years} onChange={(e) => setField('age_years', e.target.value)} />
                    <input className="ka-input" style={{ flex: 1 }} placeholder="Mo" value={fields.age_months} onChange={(e) => setField('age_months', e.target.value)} />
                    <input className="ka-input" style={{ flex: 1 }} placeholder="Day" value={fields.age_days} onChange={(e) => setField('age_days', e.target.value)} />
                  </div>
                </Field>

                <Field label="Gender" required error={touched.gender && fieldErrors.gender ? 'Please select a gender' : ''}>
                  <select
                    className={`ka-input ${touched.gender && fieldErrors.gender ? 'is-invalid' : ''}`}
                    value={fields.gender} onChange={(e) => { setField('gender', e.target.value); blur('gender'); }}
                  >
                    <option value="">Select</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </Field>

                <Field
                  label="Mobile number"
                  required
                  help="10-digit mobile number — your bill and reports are linked to this."
                  error={touched.phone && fieldErrors.phone ? fieldErrors.phone : ''}
                >
                  <input
                    className={`ka-input ${touched.phone && fieldErrors.phone ? 'is-invalid' : ''}`}
                    type="tel" inputMode="numeric" maxLength={14} placeholder="9876543210"
                    value={fields.phone} onChange={(e) => setField('phone', e.target.value)} onBlur={() => blur('phone')}
                  />
                </Field>

                <Field label="Patient type" required>
                  <select className="ka-input" value={fields.patient_type} onChange={(e) => setField('patient_type', e.target.value)}>
                    <option value="OP">OP</option>
                    <option value="IP">IP</option>
                    <option value="Emergency">Emergency</option>
                  </select>
                </Field>

                <Field label="Consultant name">
                  <input className="ka-input" placeholder="Type consultant name" value={fields.consultant_name} onChange={(e) => setField('consultant_name', e.target.value)} />
                </Field>

                {error && <div className="note note-err" style={{ marginTop: 16 }}>{error}</div>}

                <div className="sticky-bar">
                  <button className="btn btn-primary" disabled={busy || !formValid} onClick={handleSubmit}>
                    {busy ? 'Submitting…' : `Confirm & auto-bill${testsTotal ? ` · ₹${testsTotal}` : ''}`}
                  </button>
                  {!formValid && !busy && (
                    <div className="form-gate">Fill in name, gender, mobile number and patient type to continue.</div>
                  )}
                </div>
                <button className="btn btn-link" onClick={reset}>Use a different photo</button>
              </>
            )}

            {/* ---------------------------------------------------------------- DONE */}
            {stage === 'done' && (
              <>
                <div className="done-badge">✓</div>
                <h2 style={{ textAlign: 'center' }}>You're billed</h2>
                <div className="note note-ok" style={{ marginTop: 14 }}>
                  <strong>{result.message}</strong>
                  {result.bill_number && <div style={{ marginTop: 8 }}>Bill number: <strong>{result.bill_number}</strong></div>}
                  {result.total_amount != null && <div>Total paid: ₹{result.total_amount}</div>}
                  {result.lab_samples?.length > 0 && (
                    <ul className="sample-list">
                      {result.lab_samples.map((s) => <li key={s.sample_id}>{s.test_name} — {s.sample_id}</li>)}
                    </ul>
                  )}
                </div>
                <p style={{ fontSize: 13, color: 'var(--ink-sub)', marginTop: 14, textAlign: 'center' }}>
                  Show this screen (or your bill number) at the sample-collection room.
                  Save a screenshot for your records.
                </p>
                <button className="btn btn-primary no-print" onClick={() => window.print()}>Print / save this receipt</button>
                <button className="btn btn-ghost no-print" onClick={reset}>Upload another prescription</button>
              </>
            )}
          </main>

          {/* ---------------------------------------------------------------- SIDEBAR */}
          <aside style={{ display: 'grid', gap: 16 }}>
            {stage === 'review' && matchedTests.length > 0 && (
              <div className="side-card">
                <h3 className="side-title">Tests detected ({matchedTests.length})</h3>
                <p className="side-note">Billed automatically — nothing to select.</p>
                <ul className="test-list">
                  {matchedTests.map((t) => (
                    <li key={t.id} className="test-row">
                      <span>{t.test_name}</span>
                      <span className="test-price">{t.price ? `₹${t.price}` : '—'}</span>
                    </li>
                  ))}
                </ul>
                {testsTotal > 0 && (
                  <div className="test-total"><span>Estimated total</span><span>₹{testsTotal}</span></div>
                )}
                {sourceFacility && <p className="facility-note">Document from: {sourceFacility}</p>}
              </div>
            )}

            <div className="side-card">
              <h3 className="side-title">How it works</h3>
              <ol className="how-list">
                <li>Upload a clear photo of the prescription or outside bill.</li>
                <li>Confirm the patient details we read from it.</li>
                <li>Get billed instantly and collect your sample.</li>
              </ol>
              <hr className="side-hr" />
              <p className="side-note" style={{ marginBottom: 0 }}>
                If we can't confidently read the tests, we'll ask you to finish at the counter rather than guess.
                Your photo is used only for this booking.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}