import { useState, useEffect, useCallback, useRef } from 'react';
import { X, CheckCircle, Delete, Printer, Send, Camera, QrCode, FileText, Ticket } from 'lucide-react';
import { BrowserMultiFormatReader } from '@zxing/library';
import { toKannadaName } from './kannadaName';
import KioskTokenModal from './KioskTokenModal';
import '../../assets/CSS/LabTVMode.css';
import merilLogo from '../../assets/meril.png';
// JPEG copies sized for a screen. The originals are 1.6 MB lossless PNGs that
// Chromium rasterises at full resolution behind the whole board — enough, with
// the portraits, to exhaust its tile memory and drop content mid-draw.
import m1 from '../../assets/kiosk-bg1.jpg';
import m2 from '../../assets/kiosk-bg2.jpg';
import m3 from '../../assets/kiosk-bg3.jpg';

// The same three the login page carries, so the lobby and the staff screen
// tell one story rather than two.
const MERIL_SLIDES = [
  { image: m1, en: 'Innovation for better healthcare', kn: 'ಉತ್ತಮ ಆರೋಗ್ಯ ಸೇವೆಗಾಗಿ ನಾವೀನ್ಯತೆ' },
  { image: m2, en: 'State-of-the-art diagnostic facilities', kn: 'ಅತ್ಯಾಧುನಿಕ ರೋಗನಿರ್ಣಯ ಸೌಲಭ್ಯಗಳು' },
  { image: m3, en: 'Serving humanity with care', kn: 'ಕಾಳಜಿಯಿಂದ ಮಾನವೀಯತೆಯ ಸೇವೆ' },
];

// Dropped into HIMS-frontend/public/ by deployment. Absent today, so the
// element hides itself rather than showing a broken-image box on a lobby TV.
const STATE_LOGO = '/karnataka-logo.png';
const API_BASE = import.meta.env.VITE_API_URL || '';

// Kiosk auto-closes after a minute idle: whoever walks away must not leave
// their results on screen for the next person in the queue.
const KIOSK_TIMEOUT = 60000;
const SLIDE_MS = 12000;
// The stats slide holds twice as long as the others because it says two
// things: today first, then the month. Twenty seconds each — long enough to
// read from across a waiting room, short enough that nobody waits for the
// board to move on.
const STATS_SLIDE = 3;
const STATS_PHASE_MS = 20000;
const STATS_DWELL_MS = STATS_PHASE_MS * 2;

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// Every caption the waiting room sees, in both languages — English leading,
// Kannada beneath it, both at a size that reads from across the room.
const T = {
  howTitle:  { kn: 'ನಿಮ್ಮ ವರದಿಯನ್ನು ಪಡೆಯುವುದು ಹೇಗೆ',                 en: 'How to collect your report' },
  step1:     { kn: 'ಪರದೆಯ ಮೇಲೆ "ನನ್ನ ವರದಿ" ಒತ್ತಿರಿ',                  en: 'Touch "My Report" on the screen' },
  step2:     { kn: 'ನಿಮ್ಮ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ, ಆಭಾ ಸಂಖ್ಯೆ ಅಥವಾ UHID ನಮೂದಿಸಿ', en: 'Enter your mobile number, ABHA number or UHID' },
  step2b:    { kn: 'ಅಥವಾ ರಸೀದಿಯ QR ಕೋಡ್ ಅನ್ನು ಕ್ಯಾಮೆರಾದ ಮುಂದೆ ಹಿಡಿಯಿರಿ', en: 'or hold your slip’s QR code up to the camera' },
  step3:     { kn: 'WhatsApp ಗೆ ಕಳುಹಿಸಿ ಅಥವಾ ಇಲ್ಲಿಯೇ ಮುದ್ರಿಸಿ',       en: 'Send to WhatsApp, or print it here' },
  ready:     { kn: 'ಸಿದ್ಧ ವರದಿಗಳು',                                   en: 'Reports ready' },
  todayLbl:  { kn: 'ಇಂದು',                                            en: 'Today' },
  monthLbl:  { kn: 'ಈ ತಿಂಗಳು',                                         en: 'This month' },
  weekLbl:   { kn: 'ಈ ವಾರ',                                           en: 'This week' },
  yearLbl:   { kn: 'ಈ ವರ್ಷ',                                          en: 'This year' },
  booked:    { kn: 'ನೋಂದಾಯಿತ ಪರೀಕ್ಷೆಗಳು',                              en: 'Tests booked' },
  completed: { kn: 'ಪೂರ್ಣಗೊಂಡಿದೆ',                                    en: 'Completed' },
  running:   { kn: 'ಪ್ರಗತಿಯಲ್ಲಿದೆ',                                    en: 'In progress' },
  patients:  { kn: 'ರೋಗಿಗಳು',                                         en: 'Patients' },
  common:    { kn: 'ಹೆಚ್ಚು ನಡೆಸಿದ ಪರೀಕ್ಷೆಗಳು',                         en: 'Most performed tests' },
  commonWeek:  { kn: 'ಈ ವಾರ ಹೆಚ್ಚು ನಡೆಸಿದ ಪರೀಕ್ಷೆಗಳು',                 en: 'Most performed this week' },
  commonMonth: { kn: 'ಈ ತಿಂಗಳು ಹೆಚ್ಚು ನಡೆಸಿದ ಪರೀಕ್ಷೆಗಳು',              en: 'Most performed this month' },
  recent:    { kn: 'ಇತ್ತೀಚೆಗೆ ಪೂರ್ಣಗೊಂಡ ಪರೀಕ್ಷೆಗಳು',                   en: 'Recently completed' },
  myReport:  { kn: 'ನನ್ನ ವರದಿ',                                       en: 'My Report' },
  reportsReady: { kn: 'ವರದಿ ಸಿದ್ಧವಾಗಿದೆ',                              en: 'REPORTS READY' },
  colPatient:{ kn: 'ರೋಗಿ',                                            en: 'PATIENT' },
  colTest:   { kn: 'ಪರೀಕ್ಷೆ',                                         en: 'TEST' },
  colStatus: { kn: 'ಸ್ಥಿತಿ',                                          en: 'STATUS' },
  statusReady: { kn: 'ಸಿದ್ಧ',                                         en: 'READY' },
  tapCta:    { kn: 'ವರದಿ ಪಡೆಯಲು "ನನ್ನ ವರದಿ" ಒತ್ತಿರಿ',                  en: 'TAP "MY REPORT" TO COLLECT' },
  bootLoading: { kn: 'ಬೋರ್ಡ್ ಲೋಡ್ ಆಗುತ್ತಿದೆ…',                         en: 'Loading the board…' },
  loading:   { kn: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…',                                  en: 'Loading…' },
  queueTitle:{ kn: 'ಮಾದರಿ ಸಂಗ್ರಹ',                                     en: 'Sample Collection' },
  regQueueTitle: { kn: 'ನೋಂದಣಿ',                                        en: 'Registration' },
  getToken:  { kn: 'ಟೋಕನ್ ಪಡೆಯಿರಿ',                                    en: 'Get Token' },
  nextInLine:{ kn: 'ಮುಂದಿನ ಸರದಿ',                                     en: 'Next in line' },
  waiting:   { kn: 'ಕಾಯುತ್ತಿದ್ದಾರೆ',                                   en: 'waiting' },
  noOne:     { kn: 'ಯಾರೂ ಕಾಯುತ್ತಿಲ್ಲ',                                  en: 'No one is waiting' },
  next:      { kn: 'ಮುಂದೆ',                                           en: 'Next' },
  poweredBy: { kn: 'ಮೆರಿಲ್ ಡಯಾಗ್ನೋಸ್ಟಿಕ್ಸ್ ಮೂಲಕ ಚಾಲಿತ',                en: 'Powered by Meril Diagnostics' },
  noReports: { kn: 'ಈಗ ಯಾವುದೇ ವರದಿ ಸಿದ್ಧವಿಲ್ಲ',                        en: 'No reports ready just yet' },
  noReportsNote: { kn: 'ವೈದ್ಯರು ಪರಿಶೀಲಿಸಿದ ತಕ್ಷಣ ಪೂರ್ಣಗೊಂಡ ವರದಿಗಳು ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತವೆ.', en: 'Completed reports appear here as soon as a doctor verifies them.' },
  sendTitle: { kn: 'ಈ ವರದಿಯನ್ನು WhatsApp ಗೆ ಕಳುಹಿಸಿ',                  en: 'Send this report to WhatsApp' },
  sendNote:  { kn: 'ಈ ವರದಿಯು ರೋಗಿಯ ನೋಂದಾಯಿತ ಮೊಬೈಲ್ ಸಂಖ್ಯೆಗೆ ಕಳುಹಿಸಲಾಗುತ್ತದೆ.', en: 'It goes to the mobile number registered for this patient.' },
  sendBtn:   { kn: 'WhatsApp ಗೆ ಕಳುಹಿಸಿ',                              en: 'Send to WhatsApp' },
  sending:   { kn: 'ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ…',                                 en: 'Sending…' },
  print:     { kn: 'ಮುದ್ರಿಸಿ',                                        en: 'Print' },
  printing:  { kn: 'ಮುದ್ರಿಸಲಾಗುತ್ತಿದೆ…',                                en: 'Printing…' },
  view:      { kn: 'ವೀಕ್ಷಿಸಿ',                                        en: 'View' },
  opening:   { kn: 'ತೆರೆಯಲಾಗುತ್ತಿದೆ…',                                 en: 'Opening…' },
  openingReport: { kn: 'ನಿಮ್ಮ ವರದಿ ತೆರೆಯಲಾಗುತ್ತಿದೆ…',                  en: 'Opening your report…' },
  verified:  { kn: 'ಪರಿಶೀಲಿಸಲಾಗಿದೆ',                                   en: 'Verified' },
  thTest:    { kn: 'ಪರೀಕ್ಷೆ',                                         en: 'Test' },
  thResult:  { kn: 'ಫಲಿತಾಂಶ',                                        en: 'Result' },
  thUnit:    { kn: 'ಘಟಕ',                                             en: 'Unit' },
  thRange:   { kn: 'ಸಾಮಾನ್ಯ ಮಿತಿ',                                    en: 'Reference range' },
  high:      { kn: 'ಹೆಚ್ಚು',                                          en: 'High' },
  low:       { kn: 'ಕಡಿಮೆ',                                           en: 'Low' },
  noValues:  { kn: 'ಈ ವರದಿಯಲ್ಲಿ ತೋರಿಸಲು ಅಳತೆ ಮೌಲ್ಯಗಳಿಲ್ಲ. ದಯವಿಟ್ಟು ಮುದ್ರಿಸಿ ಅಥವಾ ಕೌಂಟರ್‌ನಲ್ಲಿ ಕೇಳಿ.', en: 'This report has no measured values to show. Please use Print or ask at the counter.' },
  note:      { kn: 'ಸೂಚನೆ',                                           en: 'Note' },
  verifiedBy:{ kn: 'ಪರಿಶೀಲಿಸಿದವರು',                                   en: 'Verified by' },
  correlate: { kn: 'ದಯವಿಟ್ಟು ವೈದ್ಯರೊಂದಿಗೆ ಫಲಿತಾಂಶಗಳನ್ನು ಚರ್ಚಿಸಿ',      en: 'Please correlate results clinically' },
  touchHere: { kn: 'ಇಲ್ಲಿ ಒತ್ತಿ',                                       en: 'Touch here' },
  holdQr:    { kn: 'QR ಕೋಡ್ ಅನ್ನು ಕ್ಯಾಮೆರಾದ ಮುಂದೆ ಸ್ಥಿರವಾಗಿ ಹಿಡಿಯಿರಿ',   en: 'Hold the QR code steady in front of the camera' },
  cancel:    { kn: 'ರದ್ದುಮಾಡಿ',                                       en: 'Cancel' },
  clear:     { kn: 'ಅಳಿಸಿ',                                           en: 'Clear' },
  scanQr:    { kn: 'QR ಸ್ಕ್ಯಾನ್',                                     en: 'Scan QR' },
  find:      { kn: 'ನನ್ನ ವರದಿ ಹುಡುಕಿ',                                 en: 'Find my report' },
  searching: { kn: 'ಹುಡುಕಲಾಗುತ್ತಿದೆ…',                                  en: 'Searching…' },
  nothing:   { kn: 'ನಿಮಗಾಗಿ ಇನ್ನೂ ಏನೂ ಕಂಡುಬಂದಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೌಂಟರ್‌ನಲ್ಲಿ ವಿಚಾರಿಸಿ.', en: 'Nothing found for you yet. Please check at the counter.' },
  stillInLab:{ kn: 'ಇನ್ನೂ ಪ್ರಯೋಗಾಲಯದಲ್ಲಿದೆ',                            en: 'Still in the laboratory' },
  done:      { kn: 'ಮುಗಿಯಿತು',                                        en: 'Done' },
  welcomeTitle: { kn: 'ಕರ್ನಾಟಕ ಆರೋಗ್ಯ ಮತ್ತು ಕುಟುಂಬ ಕಲ್ಯಾಣ — ಪ್ರಯೋಗಾಲಯ ಸೇವೆಗಳು', en: 'Karnataka Health & Family Welfare — Laboratory Services' },
  welcomeTag:{ kn: 'ವಿಶ್ವಾಸಾರ್ಹ ರೋಗನಿರ್ಣಯ, ನಿಮ್ಮ ಹತ್ತಿರದಲ್ಲೇ',           en: 'Reliable diagnostics, close to home' },
  govt:      { kn: 'ಕರ್ನಾಟಕ ಸರ್ಕಾರ',                                   en: 'Government of Karnataka' },
  lis:       { kn: 'ಪ್ರಯೋಗಾಲಯ ಮಾಹಿತಿ ವ್ಯವಸ್ಥೆ',                        en: 'Laboratory Information System' },
  dept:      { kn: 'ಆರೋಗ್ಯ ಮತ್ತು ಕುಟುಂಬ ಕಲ್ಯಾಣ ಇಲಾಖೆ',                 en: 'Department of Health & Family Welfare' },
};

// Kannada for the lab's own status words (kept in English in the database).
const STATUS_KN = { Pending: 'ಬಾಕಿ', Collected: 'ಸಂಗ್ರಹಿಸಲಾಗಿದೆ', 'In Progress': 'ಪ್ರಗತಿಯಲ್ಲಿ', 'Test Done': 'ಪರೀಕ್ಷೆ ಮುಗಿದಿದೆ', Processing: 'ಪ್ರಕ್ರಿಯೆಯಲ್ಲಿ', Received: 'ಸ್ವೀಕರಿಸಲಾಗಿದೆ' };
const PRIORITY_KN = { STAT: 'ತುರ್ತು', Urgent: 'ತುರ್ತು' };

const Bi = ({ k, cls = '' }) => (
  <span className={`bi ${cls}`}>
    <span className="bi-en">{T[k].en}</span>
    <span className="bi-kn" lang="kn">{T[k].kn}</span>
  </span>
);

const dateLine = (now) => ({
  en: now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }),
  kn: now.toLocaleDateString('kn-IN', { weekday: 'long', day: 'numeric', month: 'long' }),
});

/**
 * The reports-ready board, in the visual language of an airport departures
 * screen — a solved problem for "a room full of people scanning for the one
 * line that is theirs, from a distance".
 *
 * `inline` renders it inside a slide; without it the board floats over the
 * whole screen as the two-minute pop-up.
 */
function ReadyBoard({ rows, now, inline = false, onPick }) {
  return (
    <div className={`tv-board ${inline ? 'inline' : ''}`}>
      <div className="tv-board-head">
        <span className="tv-board-icon">🧪</span>
        <h2>{T.reportsReady.en}</h2>
        <span className="tv-board-kn" lang="kn">{T.reportsReady.kn}</span>
      </div>

      {/* Two columns of eight. A single column of sixteen on a wide screen
          leaves half the panel empty and pushes the type down to where it
          cannot be read from the back of the room. */}
      <div className="tv-board-body">
        {[rows.slice(0, 8), rows.slice(8, 16)].map((col, ci) => (
          <div className="tv-board-col" key={ci}>
            <div className="tv-board-cols">
              <span>{T.colPatient.en} · <i lang="kn">{T.colPatient.kn}</i></span><span>{T.colTest.en} · <i lang="kn">{T.colTest.kn}</i></span><span>{T.colStatus.en} · <i lang="kn">{T.colStatus.kn}</i></span>
            </div>
            <div className="tv-board-rows">
              {col.map((r, i) => (
                <div className={`tv-board-row ${i % 2 ? 'alt' : ''} ${onPick ? 'tappable' : ''}`}
                  key={r.sample_id} onClick={onPick ? () => onPick(r) : undefined}>
                  <span className="c-name">
                    {r.name}
                    {/* Transliterated at display time — no Kannada name exists in
                        the record. See kannadaName.js for what that can and
                        cannot get right. */}
                    <em lang="kn">{toKannadaName(r.name)}</em>
                  </span>
                  <span className="c-test">{r.test_name}</span>
                  <span className="c-status">{T.statusReady.en}<i lang="kn">{T.statusReady.kn}</i></span>
                </div>
              ))}
              {/* Empty slots keep both columns the same height, so the board
                  does not lurch when the second column is short. */}
              {col.length === 0 && ci === 1 && <div className="tv-board-empty" />}
            </div>
          </div>
        ))}
      </div>

      <div className="tv-board-foot">
        <span className="tv-board-cta">{T.tapCta.en}<i lang="kn">{T.tapCta.kn}</i></span>
        <span className="tv-board-meril">Powered by <b>Meril</b></span>
        <span className="tv-board-clock">
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          <em>{dateLine(now).en}</em>
          <em lang="kn">{dateLine(now).kn}</em>
        </span>
      </div>
    </div>
  );
}

/** Completion as a ring — the one number a waiting room actually cares about. */
function Donut({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const R = 78, C = 2 * Math.PI * R;
  return (
    <div className="tv-donut">
      <svg viewBox="0 0 200 200">
        <circle cx="100" cy="100" r={R} className="ring-bg" />
        <circle cx="100" cy="100" r={R} className="ring-fg"
          strokeDasharray={`${(C * pct) / 100} ${C}`} />
      </svg>
      <div className="tv-donut-mid">
        <b>{pct}%</b>
        <span>{T.completed.en}</span>
        <em lang="kn">{T.completed.kn}</em>
      </div>
    </div>
  );
}

/** Horizontal bars for the week's most-run tests. */
function BarList({ items }) {
  const max = Math.max(1, ...items.map((i) => Number(i.count)));
  return (
    <div className="tv-bars">
      {items.slice(0, 5).map((t, i) => (
        <div className="tv-bar-row" key={t.test_name} style={{ animationDelay: `${i * 0.08}s` }}>
          <span className="tv-bar-label">{t.test_name}</span>
          <span className="tv-bar-track">
            <span className="tv-bar-fill" style={{ width: `${(Number(t.count) / max) * 100}%` }} />
          </span>
          <span className="tv-bar-val">{t.count}</span>
        </div>
      ))}
    </div>
  );
}

/** Counts up to a number when it appears — a still figure reads as a label. */
function CountUp({ to = 0, ms = 1400 }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const target = Number(to) || 0;
    if (!target) { setN(0); return undefined; }
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / ms);
      // Ease-out: fast at first, settling on the real figure.
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <>{n.toLocaleString('en-IN')}</>;
}

function LabTVMode() {
  const [stats, setStats] = useState(null);
  const [booting, setBooting] = useState(true);
  const [logoOk, setLogoOk] = useState(true);
  const [slide, setSlide] = useState(0);
  const [statsPhase, setStatsPhase] = useState(0);   // 0 = today, 1 = this month
  const now = useClock();

  const [showModal, setShowModal] = useState(false);
  const [kioskInput, setKioskInput] = useState('');
  const [kioskStep, setKioskStep] = useState('input');
  const [patient, setPatient] = useState(null);
  const [reports, setReports] = useState([]);
  const [pending, setPending] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [doneMsg, setDoneMsgRaw] = useState({ text: '', ok: true });
  const setDoneMsg = (text, ok = true) => setDoneMsgRaw({ text, ok });
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState('');
  const [picked, setPicked] = useState(null);   // row tapped on the board
  const [sendState, setSendState] = useState({ busy: false, msg: '' });
  const [viewing, setViewing] = useState(null); // report shown on screen
  const [tokenOpen, setTokenOpen] = useState(false); // self-service token flow

  const inactivityTimer = useRef(null);
  const videoRef = useRef(null);
  const readerRef = useRef(null);

  const branchId = new URLSearchParams(window.location.search).get('branch_id');

  // ── Live token board (Registration + Sample Collection) ─────────────────
  // Public endpoint, token numbers only — this screen is read by the whole
  // waiting room, so no names or registration numbers ever reach it.
  const [tokenBoards, setTokenBoards] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const q = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : '';
        const res = await fetch(`${API_BASE}/api/lab/kiosk-tokens${q}`);
        const data = await res.json();
        if (alive && data.success) setTokenBoards(data.boards);
      } catch { /* keep the last good board on a network blip */ }
    };
    load();
    const id = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); };
  }, [branchId]);

  // ── Slideshow data ───────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (branchId) params.set('branch_id', branchId);
      const res = await fetch(`${API_BASE}/api/lab/kiosk-stats?${params}`);
      const data = await res.json();
      if (data.success) setStats(data);
    } catch {
      /* the board keeps showing the last good numbers */
    } finally {
      setBooting(false);
    }
  }, [branchId]);

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, 60000);
    return () => clearInterval(id);
  }, [fetchStats]);

  // Slides pause while someone is collecting a report — moving the screen
  // under them would be worse than a stale slide.
  useEffect(() => {
    if (showModal) return undefined;
    const dwell = slide === STATS_SLIDE ? STATS_DWELL_MS : SLIDE_MS;
    const id = setTimeout(() => setSlide((s) => (s + 1) % 6), dwell);
    return () => clearTimeout(id);
  }, [showModal, slide]);

  // Today for the first twenty seconds, then the month — counted up rather
  // than swapped, so the larger figure reads as growth instead of a different
  // screen.
  useEffect(() => {
    if (slide !== STATS_SLIDE) { setStatsPhase(0); return undefined; }
    setStatsPhase(0);
    const id = setTimeout(() => setStatsPhase(1), STATS_PHASE_MS);
    return () => clearTimeout(id);
  }, [slide]);

  // ── Idle close ───────────────────────────────────────────────────────────
  const resetIdle = useCallback(() => {
    clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(() => closeModal(), KIOSK_TIMEOUT);
  }, []);

  const stopScan = useCallback(() => {
    try { readerRef.current?.reset(); } catch { /* already stopped */ }
    readerRef.current = null;
    setScanning(false);
  }, []);

  const closeModal = useCallback(() => {
    stopScan();
    setShowModal(false);
    setKioskStep('input');
    setKioskInput('');
    setPatient(null);
    setReports([]);
    setPending([]);
    setSearchErr('');
    setDoneMsg('');
    setPicked(null);
    setViewing(null);
    clearTimeout(inactivityTimer.current);
  }, [stopScan]);

  useEffect(() => () => { stopScan(); clearTimeout(inactivityTimer.current); }, [stopScan]);

  // ── QR scanning ──────────────────────────────────────────────────────────
  // The QR carries a UHID or a CARE request id; the lookup accepts either, so
  // whatever the code contains is simply handed to it verbatim.
  // Flips the panel to camera mode. The reader itself starts in the effect
  // below — not here — because the <video> element does not exist until React
  // has re-rendered with `scanning` true. Starting the reader in this handler
  // handed zxing a null element, so the stream attached to an internal one and
  // the visible panel stayed black.
  const startScan = () => {
    setScanErr('');
    setScanning(true);
    resetIdle();
  };

  useEffect(() => {
    if (!scanning) return undefined;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    const onResult = (result) => {
      if (!result || cancelled) return;
      const text = result.getText().trim();
      stopScan();

      // A report's QR now carries a signed link to that PDF. Scanned at the
      // kiosk it should open the report, not be typed into a search box that
      // has no idea what a URL is.
      const link = /\/api\/lab\/report\/([^?\s]+)/.exec(text);
      if (link) {
        window.open(text, '_blank', 'noopener');
        closeModal();
        return;
      }

      setKioskInput(text);
      doSearch(text);
    };

    (async () => {
      // A lobby PC has a single user-facing webcam. "environment" is expressed
      // as a preference, not a requirement, so a machine without a rear camera
      // still opens the one it has instead of failing outright.
      const attempts = [
        { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } } },
        { video: true },
      ];

      for (const constraints of attempts) {
        try {
          await reader.decodeFromConstraints(constraints, videoRef.current, onResult);
          return;
        } catch (err) {
          if (err?.name === 'NotAllowedError') {
            if (!cancelled) {
              setScanning(false);
              setScanErr('Camera permission was refused on this machine.');
            }
            return;
          }
          // Otherwise fall through and try the plainer constraint.
        }
      }

      if (!cancelled) {
        setScanning(false);
        setScanErr('No camera found — please type your number instead.');
      }
    })();

    return () => { cancelled = true; try { reader.reset(); } catch { /* already stopped */ } };
    // doSearch is stable enough here; re-running on every keystroke would
    // restart the camera mid-scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  // Tapping a row on the board sends that report to the number already
  // registered against it. No identifier is asked for, and none can be: the
  // report goes to the patient's own phone, never to whoever is standing at
  // the screen, so a tap by a stranger discloses nothing.
  const pickFromBoard = (row) => {
    setPicked(row);
    setSendState({ busy: false, msg: '' });
    resetIdle();
  };

  const sendPickedToWhatsApp = async () => {
    if (!picked) return;
    setSendState({ busy: true, msg: '' });
    resetIdle();
    try {
      const res = await fetch(`${API_BASE}/api/lab/kiosk-send-ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleId: picked.sample_id }),
      });
      const data = await res.json();
      setSendState({
        busy: false,
        msg: data.success
          ? 'Sent to your registered WhatsApp number.'
          : (data.message || 'Could not send right now.'),
        ok: !!data.success,
      });
      if (data.success) setTimeout(() => setPicked(null), 4000);
    } catch {
      setSendState({ busy: false, msg: 'Could not reach the lab system.' });
    }
  };

  // ── Lookup ───────────────────────────────────────────────────────────────
  const doSearch = async (value) => {
    const q = (value ?? kioskInput).trim();
    if (q.length < 4) { setSearchErr('Enter at least 4 characters'); return; }
    setSearching(true);
    setSearchErr('');
    resetIdle();
    try {
      const res = await fetch(`${API_BASE}/api/lab/kiosk-reports?query=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.ambiguous) { setSearchErr(data.message); return; }
      if (!data.patient) { setSearchErr('No reports found for that. Please check at the counter.'); return; }
      setPatient(data.patient);
      setReports(data.reports || []);
      setPending(data.pending || []);
      setKioskStep('results');
    } catch {
      setSearchErr('Could not reach the lab system. Please ask at the counter.');
    } finally {
      setSearching(false);
    }
  };

  // ── Delivery ─────────────────────────────────────────────────────────────
  const sendWhatsApp = async (report) => {
    setBusyId(report.sample_id + ':wa');
    setDoneMsg('');
    resetIdle();
    try {
      const res = await fetch(`${API_BASE}/api/lab/whatsapp-send-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sampleId: report.sample_id,
          phone: patient.phone,
          patientName: patient.name,
          testName: report.test_name || report.service_name,
        }),
      });
      const data = await res.json();
      setDoneMsg(data.success ? 'Sent to your WhatsApp number.' : (data.message || 'Could not send.'));
    } catch {
      setDoneMsg('Could not send right now.');
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Opens the report on screen as data.
   *
   * Not the PDF: that is typeset for A4, and the embedded viewer needed to
   * display one is absent in a locked-down kiosk — which is why this panel
   * showed nothing but "use Print". The values are laid out for the screen
   * instead, at a size readable from arm's length.
   */
  const viewReport = async (report) => {
    setBusyId(report.sample_id + ':vw');
    setDoneMsg('');
    resetIdle();
    // Shown immediately, empty, with a spinner. Waiting for the fetch before
    // opening anything left the screen unchanged for several seconds after a
    // tap, which reads as the touch not having registered.
    setViewing({ report, data: null });
    try {
      const res = await fetch(`${API_BASE}/api/lab/kiosk-view-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleId: report.sample_id, query: kioskInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setViewing(null);
        setDoneMsg(data.message || 'Could not open the report.');
        return;
      }
      setViewing({ report, data });
    } catch {
      setViewing(null);
      setDoneMsg('Could not open the report right now.');
    } finally {
      setBusyId(null);
    }
  };

  const closeViewer = () => {
    setViewing(null);
    resetIdle();
  };

  const printReport = async (report) => {
    setBusyId(report.sample_id + ':pr');
    setDoneMsg('');
    resetIdle();
    try {
      const res = await fetch(`${API_BASE}/api/lab/kiosk-print-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleId: report.sample_id, query: kioskInput.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setDoneMsg(err.message || 'Could not prepare the report.', false);
        return;
      }
      const blob = await res.blob();

      // Inside the kiosk shell the print goes straight to the default printer:
      // a frameless lobby screen has no window chrome for a patient to drive a
      // print dialog with. In a normal browser it falls back to the dialog.
      if (window.kiosk?.printPdf) {
        const bytes = new Uint8Array(await blob.arrayBuffer());

        // Converted in blocks. `String.fromCharCode(...bytes)` spreads one
        // argument per byte, so a 600 KB report passed ~600,000 arguments and
        // threw "Maximum call stack size exceeded" — every print failed with a
        // generic message that pointed nowhere near the cause.
        let binary = '';
        const BLOCK = 0x8000;
        for (let i = 0; i < bytes.length; i += BLOCK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BLOCK));
        }

        const out = await window.kiosk.printPdf(btoa(binary));
        setDoneMsg(
          out?.success
            ? `${out.message || 'Printing'} — please collect your report.`
            : (out?.message || 'Printer not ready.'),
          !!out?.success,
        );
        return;
      }

      const url = URL.createObjectURL(blob);
      const frame = document.createElement('iframe');
      frame.style.display = 'none';
      frame.src = url;
      frame.onload = () => { frame.contentWindow.focus(); frame.contentWindow.print(); };
      document.body.appendChild(frame);
      setDoneMsg('Opening the print dialog…', true);
      setTimeout(() => { URL.revokeObjectURL(url); frame.remove(); }, 60000);
    } catch (err) {
      // Logged as well as shown: the generic message told nobody which step
      // failed, and a lobby machine cannot be questioned after the fact.
      console.error('print failed:', err);
      setDoneMsg(`Could not print right now — ${err.message || 'unknown error'}`, false);
    } finally {
      setBusyId(null);
    }
  };

  const pressKey = (k) => {
    resetIdle();
    setSearchErr('');
    if (k === 'del') setKioskInput((v) => v.slice(0, -1));
    else if (k === 'clr') setKioskInput('');
    else setKioskInput((v) => (v.length < 20 ? v + k : v));
  };

  const t = stats?.today;
  // Today for the first phase, the month for the second — the same fields
  // either way, which is what lets one layout serve both.
  const period = statsPhase === 0 ? stats?.today : stats?.month;
  const w = stats?.week;

  if (booting) {
    // Branded rather than blank: a lobby screen that shows nothing for five
    // seconds while the photographs download looks broken to everyone waiting.
    return (
      <div className="tv-root tv-boot">
        <img src={STATE_LOGO} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
        <span className="tv-spinner big" />
        <p><strong>{T.lis.en} · <span lang="kn">{T.lis.kn}</span></strong>
           <span>{T.bootLoading.en} <span lang="kn">{T.bootLoading.kn}</span></span></p>
      </div>
    );
  }

  return (
    <div className="tv-root" onClick={showModal ? resetIdle : undefined}>
      {/* Meril photography sits behind the whole board, slowly panning, with a
          white veil over it so every caption stays legible from across the
          room. The image changes with the slide, so the screen never looks
          static even when the numbers have not moved. */}
      <div className="tv-bg" aria-hidden>
        {MERIL_SLIDES.map((m, i) => (
          <div key={m.en} className={`tv-bg-img ${i === slide % MERIL_SLIDES.length ? 'on' : ''}`}
            style={{ backgroundImage: `url(${m.image})` }} />
        ))}
        <div className="tv-bg-veil" />
      </div>

      <header className="tv-head">
        <div className="tv-brand">
          {/* The State emblem (public/karnataka-logo.png). The lettered badge
              below is only a fallback until it is supplied — a wall-mounted
              screen must never show an image-not-found box. */}
          {logoOk
            ? <img className="tv-logo" src={STATE_LOGO} alt="Government of Karnataka"
                onError={() => setLogoOk(false)} />
            : <div className="tv-emblem"><span>KA</span></div>}
          <div>
            <div className="tv-govt">{T.govt.en} · <span lang="kn">{T.govt.kn}</span></div>
            <h1>{T.lis.en} <span className="tv-h1-kn" lang="kn">{T.lis.kn}</span></h1>
            <p>{T.dept.en} · <span lang="kn">{T.dept.kn}</span></p>
          </div>
        </div>
        <div className="tv-right">
          <div className="tv-clock">
            <div className="tv-time">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            <div className="tv-date">{dateLine(now).en}</div>
            <div className="tv-date kn" lang="kn">{dateLine(now).kn}</div>
          </div>
          <div className="tv-meril-mark">
            <img className="tv-logo meril" src={merilLogo} alt="Meril" />
            <span>Powered by Meril · <span lang="kn">ಮೆರಿಲ್ ಮೂಲಕ ಚಾಲಿತ</span></span>
          </div>
        </div>
      </header>

      {tokenBoards && [['Registration', 'regQueueTitle'], ['Sample Collection', 'queueTitle']].map(([sp, titleKey]) => {
        // Lobby board: only who is next, token numbers only — this screen is
        // visible to the whole waiting room. The Registration queue appears
        // only while kiosk-issued registration tokens are open.
        const b = tokenBoards[sp] || { waiting: [], serving: [], waiting_count: 0 };
        if (sp === 'Registration' && !b.waiting_count && !(b.serving || []).length) return null;
        const next = b.waiting.slice(0, 4);
        return (
          <section key={sp} className="tv-queue" aria-label={`${sp} queue`}>
            <div className="tv-queue-head">
              <span className="tv-queue-eyebrow">{T[titleKey].en} · <i lang="kn">{T[titleKey].kn}</i></span>
              <h2 className="tv-queue-heading">{T.nextInLine.en} <i lang="kn">{T.nextInLine.kn}</i></h2>
              <span className="tv-queue-pill">{b.waiting_count} {T.waiting.en} · <i lang="kn">{b.waiting_count} {T.waiting.kn}</i></span>
            </div>
            <div className="tv-queue-tiles">
              {next.length === 0 && <span className="tv-queue-empty">{T.noOne.en} · <i lang="kn">{T.noOne.kn}</i></span>}
              {next.map((t, i) => (
                <div key={t.token_number} className={`tv-tile${i === 0 ? ' first' : ''}${t.priority !== 'Routine' ? ' pri' : ''}`}>
                  <span className="tv-tile-tag">
                    {t.priority !== 'Routine'
                      ? <>{t.priority}{PRIORITY_KN[t.priority] && <i lang="kn"> · {PRIORITY_KN[t.priority]}</i>}</>
                      : i === 0 ? <>{T.next.en} <i lang="kn">· {T.next.kn}</i></> : `#${i + 1}`}
                  </span>
                  <strong>{t.token_number}</strong>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <main className="tv-stage">
        {/* ── Slide 1: welcome ───────────────────────────────────────────── */}
        {slide === 0 && (
          <section className="tv-slide tv-welcome">
            <h2 className="tv-slide-title"><Bi k="welcomeTitle" /></h2>
            <p className="tv-welcome-tag"><Bi k="welcomeTag" /></p>
          </section>
        )}

        {/* ── Slide 2: how to collect a report ─────────────────────────── */}
        {slide === 2 && (
          <section className="tv-slide">
            <h2 className="tv-slide-title"><Bi k="howTitle" /></h2>
            <ol className="tv-steps">
              <li><span className="tv-step-n">1</span><Bi k="step1" /></li>
              <li><span className="tv-step-n">2</span><Bi k="step2" /><Bi k="step2b" cls="bi-sub" /></li>
              <li><span className="tv-step-n">3</span><Bi k="step3" /></li>
            </ol>
          </section>
        )}

        {/* ── Slide 2: today's numbers ─────────────────────────────────── */}
        {slide === 3 && (
          // One layout, one graph. Twenty seconds in, the same figures count
          // up to the month's — the period changes, the screen does not. The
          // key forces a remount so every counter and the ring animate to
          // their new values instead of snapping.
          <section className="tv-slide" key={statsPhase}>
            <h2 className="tv-slide-title">
              {statsPhase === 0
                ? <Bi k="todayLbl" />
                : <Bi k="monthLbl" />}
            </h2>
            <div className="tv-analytics">
              <Donut done={period?.completed || 0} total={period?.booked || 0} />
              <div className="tv-analytics-right">
                <div className="tv-figures">
                  <div className="tv-fig"><b><CountUp to={period?.booked} /></b><Bi k="booked" /></div>
                  <div className="tv-fig ok"><b><CountUp to={period?.completed} /></b><Bi k="completed" /></div>
                  <div className="tv-fig run"><b><CountUp to={period?.in_progress} /></b><Bi k="running" /></div>
                </div>

                <div className="tv-panel">
                  <h3>
                    <strong>{statsPhase === 0 ? T.commonWeek.en : T.commonMonth.en}</strong>
                    <span lang="kn">{statsPhase === 0 ? T.commonWeek.kn : T.commonMonth.kn}</span>
                  </h3>
                  <BarList items={(statsPhase === 0 ? stats?.top_tests : stats?.top_tests_month) || []} />
                </div>

                <div className="tv-periods">
                  <div className="tv-period">
                    <b><CountUp to={period?.patients ?? w?.patients} /></b>
                    <span>{T.patients.en}</span><em lang="kn">{T.patients.kn}</em>
                  </div>
                  <div className="tv-period year">
                    <b><CountUp to={stats?.year?.tests} ms={2200} /></b>
                    <span>{T.yearLbl.en}</span><em lang="kn">{T.yearLbl.kn}</em>
                  </div>
                  <div className="tv-period">
                    <b><CountUp to={w?.tests} /></b>
                    <span>{T.weekLbl.en}</span><em lang="kn">{T.weekLbl.kn}</em>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {slide === 4 && (
          <section className="tv-slide">
            <h2 className="tv-slide-title"><Bi k="recent" /></h2>
            {/* Counts per test only. A waiting room is full of strangers, so
                the board never names who was tested for what. */}
            <div className="tv-tests">
              {(stats?.recent_completed?.length ? stats.recent_completed : stats?.top_tests || []).map((x) => (
                <div className="tv-test" key={x.test_name}>
                  <CheckCircle size={26} />
                  <span className="tv-test-name">{x.test_name}</span>
                  <span className="tv-test-count">{x.count}</span>
                </div>
              ))}
              {!stats && <p className="tv-muted">{T.loading.en} <span lang="kn">{T.loading.kn}</span></p>}
            </div>
          </section>
        )}

        {/* ── Slide 4: who runs this lab system ─────────────────────── */}
        {slide === 5 && (
          <section className="tv-slide">
            <h2 className="tv-slide-title"><Bi k="poweredBy" /></h2>
            <div className="tv-meril">
              {MERIL_SLIDES.map((m, i) => (
                <figure className="tv-card3d" key={m.en} style={{ animationDelay: `${i * 0.12}s` }}>
                  <img src={m.image} alt="" />
                  <figcaption>
                    <strong>{m.en}</strong>
                    <span lang="kn">{m.kn}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* The same board the two-minute pop-up shows, but as a scheduled
            slide — it is the single most useful thing on this screen, and a
            patient who arrives between pop-ups should still see it. */}
        {slide === 1 && (
          <section className="tv-slide tv-slide-board">
            {stats?.ready?.length
              ? <ReadyBoard rows={stats.ready} now={now} inline onPick={pickFromBoard} />
              : <>
                  <h2 className="tv-slide-title"><Bi k="noReports" /></h2>
                  <p className="tv-muted">{T.noReportsNote.en}<br /><span lang="kn">{T.noReportsNote.kn}</span></p>
                </>}
          </section>
        )}

        <div className="tv-dots">
          {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className={i === slide ? 'on' : ''} />)}
        </div>
      </main>

      {/* One tap, one button. */}
      {picked && (
        <div className="tv-modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setPicked(null); }}>
          <div className="tv-modal tv-send">
            <button className="tv-close" onClick={() => setPicked(null)}><X size={22} /></button>
            <h2><Bi k="sendTitle" /></h2>
            <p className="tv-send-what">
              <strong>{picked.test_name}</strong>
              <span>{picked.name} · {picked.sample_id.slice(-4)}</span>
            </p>
            <p className="tv-muted">
              {T.sendNote.en}<br />
              <span lang="kn">{T.sendNote.kn}</span>
            </p>

            {sendState.msg && (
              <p className={sendState.ok ? 'tv-done' : 'tv-err'}>{sendState.msg}</p>
            )}

            <button className="tv-btn wide" disabled={sendState.busy || sendState.ok}
              onClick={sendPickedToWhatsApp}>
              <Send size={20} /> {sendState.busy ? <>{T.sending.en} <span lang="kn">{T.sending.kn}</span></> : <>{T.sendBtn.en} <span lang="kn">{T.sendBtn.kn}</span></>}
            </button>
          </div>
        </div>
      )}

      {/* Report on screen. An <object> rather than a download: the kiosk has no
          file manager and no browser chrome for a patient to find a file in. */}
      {viewing && (
        <div className="tv-viewer-bg" onClick={closeViewer}>
          <div className="tv-viewer" onClick={(e) => e.stopPropagation()}>
            <div className="tv-viewer-head">
              <div>
                <strong>{viewing.report.test_name || viewing.report.service_name}</strong>
                <span>{viewing.report.sample_id}</span>
              </div>
              <button className="tv-btn sm" onClick={() => printReport(viewing.report)}>
                <Printer size={17} /> {T.print.en} <span lang="kn">{T.print.kn}</span>
              </button>
              <button className="tv-close" onClick={closeViewer}><X size={22} /></button>
            </div>
            <div className="tv-viewer-doc">
              {!viewing.data && (
                <div className="tv-loading">
                  <span className="tv-spinner" />
                  <p><strong>{T.openingReport.en}</strong><span lang="kn">{T.openingReport.kn}</span></p>
                </div>
              )}
              {viewing.data && <>
              <div className="tv-rep-head">
                <div>
                  <strong>{viewing.data.patient_name}</strong>
                  <span>{viewing.data.reg_no}{viewing.data.gender ? ` · ${viewing.data.gender}` : ''}</span>
                </div>
                <div className="tv-rep-when">
                  <span>{T.verified.en} · <i lang="kn">{T.verified.kn}</i></span>
                  <em>{viewing.data.verified_at
                    ? new Date(viewing.data.verified_at).toLocaleString([], {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit' })
                    : '—'}</em>
                </div>
              </div>

              {viewing.data.parameters.length ? (
                <table className="tv-rep-table">
                  <thead>
                    <tr>
                      <th>{T.thTest.en}<i lang="kn">{T.thTest.kn}</i></th><th>{T.thResult.en}<i lang="kn">{T.thResult.kn}</i></th><th>{T.thUnit.en}<i lang="kn">{T.thUnit.kn}</i></th><th>{T.thRange.en}<i lang="kn">{T.thRange.kn}</i></th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewing.data.parameters.map((p, i) => (
                      <tr key={i}>
                        <td className="p-name">{p.name}</td>
                        {/* A value outside the range is the reason anyone reads
                            a report; it is coloured and marked rather than left
                            for the patient to compare two columns by eye. */}
                        <td className={`p-val ${p.flag === 'H' ? 'high' : p.flag === 'L' ? 'low' : ''}`}>
                          {p.value}
                          {p.flag === 'H' && <b> ▲ {T.high.en} <span lang="kn">{T.high.kn}</span></b>}
                          {p.flag === 'L' && <b> ▼ {T.low.en} <span lang="kn">{T.low.kn}</span></b>}
                        </td>
                        <td className="p-unit">{p.unit}</td>
                        <td className="p-ref">{p.ref_range || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="tv-muted" style={{ padding: 24 }}>
                  {T.noValues.en}<br /><span lang="kn">{T.noValues.kn}</span>
                </p>
              )}

              {viewing.data.notes && (
                <p className="tv-rep-note"><strong>{T.note.en} · <span lang="kn">{T.note.kn}</span>:</strong> {viewing.data.notes}</p>
              )}
              <p className="tv-rep-foot">
                {T.verifiedBy.en} {viewing.data.verified_by || 'the laboratory'} ·
                {' '}{T.correlate.en} · <span lang="kn">{T.verifiedBy.kn}: {viewing.data.verified_by || 'ಪ್ರಯೋಗಾಲಯ'} · {T.correlate.kn}</span>
              </p>
              </>}
            </div>
          </div>
        </div>
      )}

      {!showModal && !viewing && !tokenOpen && (
        <div className="tv-touch-hint">
          <span>{T.touchHere.en} · <i lang="kn">{T.touchHere.kn}</i></span><span aria-hidden>👉</span>
        </div>
      )}
      <button className="tv-cta tv-cta-token" onClick={() => setTokenOpen(true)}>
        <Ticket size={30} /><Bi k="getToken" />
      </button>
      <button className="tv-cta" onClick={() => { setShowModal(true); resetIdle(); }}>
        <QrCode size={30} /><Bi k="myReport" />
      </button>
      {tokenOpen && <KioskTokenModal branchId={branchId} onClose={() => setTokenOpen(false)} />}

      {/* ── Collection modal ──────────────────────────────────────────── */}
      {showModal && (
        <div className="tv-modal-bg">
          <div className="tv-modal">
            <button className="tv-close" onClick={closeModal}><X size={22} /></button>

            {kioskStep === 'input' ? (
              <>
                <h2><Bi k="step2" /></h2>


                {scanning ? (
                  <div className="tv-scan">
                    <div className="tv-scan-frame">
                      <video ref={videoRef} className="tv-video" autoPlay muted playsInline />
                    </div>
                    <p className="tv-muted">
                      <strong>{T.holdQr.en}</strong><br />
                      <span lang="kn">{T.holdQr.kn}</span>
                    </p>
                    <button className="tv-btn ghost" onClick={stopScan}>{T.cancel.en} <span lang="kn">{T.cancel.kn}</span></button>
                  </div>
                ) : (
                  <>
                    <div className="tv-input">{kioskInput || <span className="tv-ph">………</span>}</div>
                    {searchErr && <p className="tv-err">{searchErr}</p>}
                    {scanErr && <p className="tv-err">{scanErr}</p>}

                    <div className="tv-pad">
                      {['1','2','3','4','5','6','7','8','9'].map((k) => (
                        <button key={k} onClick={() => pressKey(k)}>{k}</button>
                      ))}
                      <button onClick={() => pressKey('clr')} className="sm">{T.clear.en}<i lang="kn">{T.clear.kn}</i></button>
                      <button onClick={() => pressKey('0')}>0</button>
                      <button onClick={() => pressKey('del')} className="sm"><Delete size={22} /></button>
                    </div>

                    <div className="tv-actions">
                      <button className="tv-btn ghost" onClick={startScan}>
                        <Camera size={20} /> {T.scanQr.en} <span lang="kn">{T.scanQr.kn}</span>
                      </button>
                      <button className="tv-btn" disabled={searching || kioskInput.length < 4}
                        onClick={() => doSearch()}>
                        {searching ? <>{T.searching.en} <span lang="kn">{T.searching.kn}</span></> : <>{T.find.en} <span lang="kn">{T.find.kn}</span></>}
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <h2>{patient?.name}</h2>
                <p className="tv-muted"><Bi k="ready" /> · {reports.length}</p>
                {doneMsg.text && <p className={doneMsg.ok ? 'tv-done' : 'tv-err'}>{doneMsg.text}</p>}

                <div className="tv-reports">
                  {!reports.length && !pending.length && (
                    <p className="tv-muted">{T.nothing.en}<br /><span lang="kn">{T.nothing.kn}</span></p>
                  )}
                  {reports.map((r) => (
                    <div className="tv-report" key={r.sample_id}>
                      <div>
                        <div className="tv-report-name">{r.test_name || r.service_name}</div>
                        <div className="tv-report-id">{r.sample_id}</div>
                      </div>
                      <div className="tv-report-btns">
                        <button className="tv-btn sm" disabled={busyId === r.sample_id + ':wa'}
                          onClick={() => sendWhatsApp(r)}>
                          <Send size={17} /> {busyId === r.sample_id + ':wa' ? <>{T.sending.en} <span lang="kn">{T.sending.kn}</span></> : 'WhatsApp'}
                        </button>
                        <button className="tv-btn sm ghost" disabled={busyId === r.sample_id + ':vw'}
                          onClick={() => viewReport(r)}>
                          <FileText size={17} /> {busyId === r.sample_id + ':vw' ? <>{T.opening.en} <span lang="kn">{T.opening.kn}</span></> : <>{T.view.en} <span lang="kn">{T.view.kn}</span></>}
                        </button>
                        <button className="tv-btn sm ghost" disabled={busyId === r.sample_id + ':pr'}
                          onClick={() => printReport(r)}>
                          <Printer size={17} /> {busyId === r.sample_id + ':pr' ? <>{T.printing.en} <span lang="kn">{T.printing.kn}</span></> : <>{T.print.en} <span lang="kn">{T.print.kn}</span></>}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Still with the lab. Shown even when no report is ready, so
                    "not finished yet" never looks like "we lost your sample". */}
                {pending.length > 0 && (
                  <>
                    <h3 className="tv-sub">
                      <strong>{T.stillInLab.en}</strong>
                      <span lang="kn">{T.stillInLab.kn}</span>
                    </h3>
                    <div className="tv-reports">
                      {pending.map((t) => (
                        <div className="tv-report waiting" key={t.sample_id}>
                          <div>
                            <div className="tv-report-name">{t.test_name}</div>
                            <div className="tv-report-id">{t.sample_id}</div>
                          </div>
                          <span className="tv-chip">{t.status}{STATUS_KN[t.status] && <i lang="kn"> · {STATUS_KN[t.status]}</i>}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <button className="tv-btn ghost wide" onClick={closeModal}>{T.done.en} <span lang="kn">{T.done.kn}</span></button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default LabTVMode;
