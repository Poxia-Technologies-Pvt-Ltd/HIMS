import { useEffect, useRef, useState, useCallback } from 'react';

// Keyword-based SOAP classifier — pure local, no API
const SOAP_PATTERNS = {
  chiefComplaints: [
    /(?:complain|complaint|present|presenting|came with|c\/o|h\/o|patient (?:has|with|reports?|says?|feels?|c\/o)|chief (?:complaint|c\/o))\s*[:\-]?\s*(.+?)(?:\.|,|\n|$)/i,
    /(?:fever|pain|cough|cold|headache|vomiting|diarrhoea|diarrhea|shortness of breath|sob|breathlessness|rash|swelling|itching|weakness|fatigue|nausea|chest pain|back pain|joint pain|abdominal pain|stomach ache|dysuria|burning|discharge|bleeding|dizziness|palpitations|loss of appetite|weight loss)/i,
  ],
  history: [
    /(?:history|since|started|duration|onset|for (?:the )?(?:past|last)|associated with|h\/o|past medical|past history|known case of|known diabetic|known hypertensive|on (?:medication|treatment)|was (?:admitted|diagnosed))/i,
  ],
  examination: [
    /(?:examination|on examination|o\/e|findings?|vitals?|bp|pulse|temperature|spo2|auscultation|palpation|percussion|abdomen|heart sounds?|breath sounds?|pupils?|reflexes?|tenderness|guarding|rigidity|edema|jaundice|pallor|lymph node)/i,
  ],
  diagnosis: [
    /(?:diagnosis|impression|assessment|diagnosed|most likely|probably|r\/o|rule out|provisional|final diagnosis|working diagnosis|suggests?|consistent with|in keeping with|features? of)/i,
  ],
  plan: [
    /(?:plan|treatment|prescrib|medication|tablet|capsule|syrup|injection|advised|recommend|counsel|follow[- ]?up|refer|discharge|review|continue|start|stop|increase|decrease|dosage|dose|times? (?:daily|a day)|once|twice|thrice|bd|tds|od|qid)/i,
  ],
};

function classifySentence(sentence) {
  const s = sentence.trim();
  if (!s || s.length < 4) return null;
  const scores = {};
  for (const [section, patterns] of Object.entries(SOAP_PATTERNS)) {
    scores[section] = patterns.filter(p => p.test(s)).length;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : null;
}

function buildSOAPFromTranscript(transcript) {
  const sentences = transcript
    .replace(/([.!?])\s*/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const soap = { chiefComplaints: [], history: [], examination: [], diagnosis: [], plan: [] };

  let lastSection = 'chiefComplaints';
  for (const sentence of sentences) {
    const section = classifySentence(sentence) || lastSection;
    lastSection = section;
    soap[section].push(sentence);
  }

  return {
    chiefComplaints: soap.chiefComplaints.join(' '),
    soapHistory: soap.history.join(' '),
    soapExam: soap.examination.join(' '),
    diagnosis: soap.diagnosis.join(' '),
    plan: soap.plan.join(' '),
  };
}

export default function AmbientScribe({ onApplySOAP, onClose }) {
  const [state, setState] = useState('idle'); // idle | listening | paused | done
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [soap, setSoap] = useState(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [volume, setVolume] = useState(0);

  const recognitionRef = useRef(null);
  const timerRef = useRef(null);
  const analyserRef = useRef(null);
  const animRef = useRef(null);
  const micStreamRef = useRef(null);

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = Boolean(SpeechRecognition);

  // Volume visualiser
  const startVolumeMonitor = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyserRef.current = analyser;

      const tick = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setVolume(Math.min(100, avg * 2));
        animRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* mic permission denied */ }
  };

  const stopVolumeMonitor = () => {
    cancelAnimationFrame(animRef.current);
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
  };

  const startListening = useCallback(() => {
    if (!SpeechRecognition) return;
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-IN';
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let fin = '';
      let int_ = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) fin += text + ' ';
        else int_ += text;
      }
      if (fin) setTranscript(prev => prev + fin);
      setInterim(int_);
    };

    rec.onerror = (e) => {
      if (e.error === 'no-speech') return;
      if (e.error === 'not-allowed') setError('Microphone permission denied. Please allow mic access in your browser.');
      else setError(`Speech recognition error: ${e.error}`);
      setState('idle');
    };

    rec.onend = () => {
      if (recognitionRef.current && state !== 'paused' && state !== 'done') {
        // Auto-restart for continuous listening
        try { recognitionRef.current.start(); } catch { /* already started */ }
      }
    };

    recognitionRef.current = rec;
    rec.start();
    setState('listening');

    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    startVolumeMonitor();
  }, [SpeechRecognition, state]);

  const pauseListening = () => {
    recognitionRef.current?.stop();
    clearInterval(timerRef.current);
    stopVolumeMonitor();
    setVolume(0);
    setState('paused');
  };

  const resumeListening = () => {
    startListening();
  };

  const stopAndAnalyse = () => {
    recognitionRef.current?.stop();
    clearInterval(timerRef.current);
    stopVolumeMonitor();
    setVolume(0);
    setInterim('');
    setState('done');
    const result = buildSOAPFromTranscript(transcript);
    setSoap(result);
  };

  const handleApply = () => {
    if (soap) onApplySOAP(soap);
    onClose();
  };

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      clearInterval(timerRef.current);
      stopVolumeMonitor();
    };
  }, []);

  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const bars = Array.from({ length: 20 }, (_, i) => {
    const h = state === 'listening' ? Math.max(4, (volume / 100) * 40 * Math.abs(Math.sin(i * 0.8 + Date.now() / 200))) : 4;
    return h;
  });

  return (
    <>
      <style>{CSS}</style>
      <div className="sc-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="sc-modal">
          <div className="sc-header">
            <div>
              <span>🎙 Ambient AI Scribe</span>
              <span className="sc-sub">Listens to consultation and auto-fills SOAP notes</span>
            </div>
            <button onClick={onClose}>✕</button>
          </div>

          {!supported && (
            <div className="sc-warning">⚠️ Your browser does not support Web Speech API. Please use Chrome or Edge.</div>
          )}

          {error && <div className="sc-error">{error}</div>}

          <div className="sc-body">
            {/* Status display */}
            <div className="sc-status-area">
              <div className={`sc-mic-ring ${state === 'listening' ? 'sc-mic-ring--active' : ''}`}>
                <span className="sc-mic-icon">{state === 'listening' ? '🎙' : state === 'paused' ? '⏸' : state === 'done' ? '✓' : '🎤'}</span>
              </div>
              <div className="sc-status-text">
                {state === 'idle' && 'Ready to listen'}
                {state === 'listening' && `Recording… ${fmtTime(duration)}`}
                {state === 'paused' && `Paused — ${fmtTime(duration)} recorded`}
                {state === 'done' && 'Analysis complete'}
              </div>
            </div>

            {/* Waveform bars */}
            {state === 'listening' && (
              <div className="sc-waveform">
                {bars.map((h, i) => (
                  <div key={i} className="sc-bar" style={{ height: Math.max(4, volume > 5 ? h : 4) }} />
                ))}
              </div>
            )}

            {/* Controls */}
            <div className="sc-controls">
              {state === 'idle' && (
                <button className="sc-btn sc-btn--primary" onClick={startListening} disabled={!supported}>
                  🎙 Start Listening
                </button>
              )}
              {state === 'listening' && (
                <>
                  <button className="sc-btn sc-btn--warning" onClick={pauseListening}>⏸ Pause</button>
                  <button className="sc-btn sc-btn--danger" onClick={stopAndAnalyse}>⏹ Stop & Analyse</button>
                </>
              )}
              {state === 'paused' && (
                <>
                  <button className="sc-btn sc-btn--primary" onClick={resumeListening}>▶ Resume</button>
                  <button className="sc-btn sc-btn--danger" onClick={stopAndAnalyse}>⏹ Stop & Analyse</button>
                </>
              )}
            </div>

            {/* Live transcript */}
            {(transcript || interim) && (
              <div className="sc-section">
                <div className="sc-section-label">Live Transcript</div>
                <div className="sc-transcript">
                  {transcript}
                  {interim && <span className="sc-interim">{interim}</span>}
                </div>
              </div>
            )}

            {/* SOAP result */}
            {soap && (
              <div className="sc-soap">
                <div className="sc-section-label">Auto-generated SOAP Notes</div>
                {[
                  ['S — Chief Complaints', soap.chiefComplaints, '#f59e0b'],
                  ['S — History', soap.soapHistory, '#6366f1'],
                  ['O — Examination', soap.soapExam, '#0891b2'],
                  ['A — Assessment / Diagnosis', soap.diagnosis, '#16a34a'],
                  ['P — Plan', soap.plan, '#dc2626'],
                ].map(([label, text, color]) => text ? (
                  <div key={label} className="sc-soap-row" style={{ borderLeft: `3px solid ${color}` }}>
                    <div className="sc-soap-label" style={{ color }}>{label}</div>
                    <div className="sc-soap-text">{text}</div>
                  </div>
                ) : null)}

                <div className="sc-tip">
                  💡 Review and edit the notes in the consultation form before saving. This is a smart suggestion, not a final record.
                </div>
              </div>
            )}
          </div>

          <div className="sc-footer">
            {state !== 'done' && (
              <button className="sc-btn sc-btn--ghost" onClick={onClose}>Cancel</button>
            )}
            {state === 'done' && (
              <>
                <button className="sc-btn sc-btn--ghost" onClick={() => { setState('idle'); setTranscript(''); setSoap(null); setDuration(0); }}>
                  🔄 Start Over
                </button>
                <button className="sc-btn sc-btn--primary" onClick={handleApply}>
                  ✓ Apply to SOAP Notes
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const CSS = `
  .sc-overlay {
    position: fixed; inset: 0; background: rgba(15,23,42,.7); z-index: 1200;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(4px);
  }
  .sc-modal {
    background: #0f172a; border-radius: 18px; width: 100%; max-width: 620px;
    box-shadow: 0 32px 100px rgba(0,0,0,.6); display: flex; flex-direction: column;
    max-height: 88vh; overflow: hidden; font-family: 'Inter', system-ui, sans-serif;
    border: 1px solid rgba(255,255,255,.08);
  }
  .sc-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; background: rgba(255,255,255,.04); border-bottom: 1px solid rgba(255,255,255,.08);
    color: #fff;
  }
  .sc-header > div { display: flex; flex-direction: column; gap: 2px; }
  .sc-header span:first-child { font-weight: 700; font-size: 1rem; }
  .sc-sub { font-size: 0.73rem; opacity: .5; }
  .sc-header button {
    background: rgba(255,255,255,.1); border: none; border-radius: 50%;
    width: 28px; height: 28px; color: #fff; cursor: pointer; align-self: flex-start;
  }
  .sc-warning, .sc-error {
    margin: 12px 20px; padding: 10px 14px; border-radius: 8px; font-size: 0.82rem;
  }
  .sc-warning { background: #78350f22; border: 1.5px solid #b45309; color: #fbbf24; }
  .sc-error { background: #7f1d1d22; border: 1.5px solid #dc2626; color: #fca5a5; }
  .sc-body { padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; flex: 1; }
  .sc-status-area { display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .sc-mic-ring {
    width: 80px; height: 80px; border-radius: 50%;
    background: rgba(255,255,255,.06); border: 2px solid rgba(255,255,255,.1);
    display: flex; align-items: center; justify-content: center; transition: all .3s;
  }
  .sc-mic-ring--active {
    background: rgba(239,68,68,.12); border-color: #ef4444;
    box-shadow: 0 0 0 8px rgba(239,68,68,.08), 0 0 0 16px rgba(239,68,68,.04);
    animation: sc-pulse 1.5s ease-in-out infinite;
  }
  @keyframes sc-pulse {
    0%,100% { box-shadow: 0 0 0 8px rgba(239,68,68,.08), 0 0 0 16px rgba(239,68,68,.04); }
    50% { box-shadow: 0 0 0 14px rgba(239,68,68,.12), 0 0 0 24px rgba(239,68,68,.06); }
  }
  .sc-mic-icon { font-size: 1.8rem; }
  .sc-status-text { font-size: 0.85rem; color: #94a3b8; text-align: center; }
  .sc-waveform {
    display: flex; align-items: center; justify-content: center; gap: 3px; height: 48px;
  }
  .sc-bar {
    width: 4px; border-radius: 2px; background: linear-gradient(to top, #6366f1, #a78bfa);
    transition: height .08s ease;
    min-height: 4px;
  }
  .sc-controls { display: flex; gap: 10px; justify-content: center; }
  .sc-btn {
    padding: 10px 20px; border-radius: 10px; font-size: 0.85rem; font-weight: 600;
    cursor: pointer; border: none; transition: all .15s;
  }
  .sc-btn--primary { background: #6366f1; color: #fff; }
  .sc-btn--primary:hover { background: #4f46e5; }
  .sc-btn--primary:disabled { opacity: .4; cursor: not-allowed; }
  .sc-btn--warning { background: rgba(234,179,8,.15); color: #fbbf24; border: 1.5px solid #ca8a04; }
  .sc-btn--danger { background: rgba(239,68,68,.15); color: #fca5a5; border: 1.5px solid #dc2626; }
  .sc-btn--ghost { background: rgba(255,255,255,.06); color: #94a3b8; border: 1.5px solid rgba(255,255,255,.1); }
  .sc-section { display: flex; flex-direction: column; gap: 6px; }
  .sc-section-label { font-size: 0.72rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .5px; }
  .sc-transcript {
    background: rgba(255,255,255,.04); border: 1.5px solid rgba(255,255,255,.08);
    border-radius: 10px; padding: 12px; font-size: 0.82rem; color: #cbd5e1;
    line-height: 1.7; max-height: 150px; overflow-y: auto;
  }
  .sc-interim { color: #64748b; }
  .sc-soap { display: flex; flex-direction: column; gap: 8px; }
  .sc-soap-row {
    background: rgba(255,255,255,.04); border-radius: 8px; padding: 10px 14px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .sc-soap-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
  .sc-soap-text { font-size: 0.82rem; color: #cbd5e1; line-height: 1.6; }
  .sc-tip {
    background: rgba(99,102,241,.08); border: 1.5px solid rgba(99,102,241,.2);
    border-radius: 8px; padding: 10px 14px; font-size: 0.78rem; color: #818cf8;
  }
  .sc-footer {
    display: flex; gap: 10px; padding: 14px 20px;
    border-top: 1px solid rgba(255,255,255,.06); justify-content: flex-end;
    background: rgba(255,255,255,.02);
  }
`;
