import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Delete, Printer, UserPlus, IdCard, Check, QrCode, Smartphone, Users } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const IDLE_MS = 60000;
const RESULT_CLOSE_MS = 25000;
const POLL_MS = 3000;

// Kannada first is the kiosk convention for headings; every string is shown in both.
const T = {
  title:      { kn: 'ಸರದಿ ಟೋಕನ್ ಪಡೆಯಿರಿ',                       en: 'Get a queue token' },
  registered: { kn: 'ನಾನು ಈಗಾಗಲೇ ನೋಂದಾಯಿಸಿದ್ದೇನೆ',                  en: 'I am already registered' },
  registeredSub: { kn: 'ಮೊಬೈಲ್ ಸಂಖ್ಯೆ, ಆಭಾ ಅಥವಾ UHID ಬಳಸಿ',        en: 'Use your mobile number, ABHA or UHID' },
  newPatient: { kn: 'ಹೊಸ ರೋಗಿ — ನೋಂದಣಿ',                          en: 'New patient — Registration' },
  newPatientSub: { kn: 'ನೋಂದಣಿ ಕೌಂಟರ್‌ಗೆ ಟೋಕನ್',                    en: 'Token for the registration counter' },
  enterId:    { kn: 'ನಿಮ್ಮ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ, ಆಭಾ ಸಂಖ್ಯೆ ಅಥವಾ UHID ನಮೂದಿಸಿ', en: 'Enter your mobile number, ABHA number or UHID' },
  continue:   { kn: 'ಮುಂದುವರಿಸಿ',                                   en: 'Continue' },
  working:    { kn: 'ದಯವಿಟ್ಟು ನಿರೀಕ್ಷಿಸಿ…',                          en: 'Please wait…' },
  yourToken:  { kn: 'ನಿಮ್ಮ ಟೋಕನ್ ಸಂಖ್ಯೆ',                          en: 'Your token number' },
  'Registration':      { kn: 'ನೋಂದಣಿ',                             en: 'Registration' },
  'Sample Collection': { kn: 'ಮಾದರಿ ಸಂಗ್ರಹ',                       en: 'Sample Collection' },
  youAreNext: { kn: 'ಮುಂದಿನ ಸರದಿ ನಿಮ್ಮದು',                         en: 'You are next' },
  waitCall:   { kn: 'ನಿಮ್ಮ ಸಂಖ್ಯೆ ಕರೆಯುವವರೆಗೆ ದಯವಿಟ್ಟು ಕಾಯಿರಿ',        en: 'Please wait for your number to be called' },
  sameToken:  { kn: 'ನಿಮಗೆ ಈಗಾಗಲೇ ಈ ಟೋಕನ್ ನೀಡಲಾಗಿದೆ',               en: 'This token was already issued to you' },
  takeSlip:   { kn: 'ನಿಮ್ಮ ಟೋಕನ್ ಚೀಟಿಯನ್ನು ಪಡೆಯಿರಿ',                  en: 'Please collect your token slip' },
  printSlip:  { kn: 'ಚೀಟಿ ಮುದ್ರಿಸಿ',                                en: 'Print slip' },
  notFound:   { kn: 'ನೋಂದಣಿ ಕಂಡುಬಂದಿಲ್ಲ. ನೋಂದಣಿ ಟೋಕನ್ ಪಡೆಯಿರಿ.',     en: 'No registration found. Take a Registration token instead.' },
  takeReg:    { kn: 'ನೋಂದಣಿ ಟೋಕನ್ ಪಡೆಯಿರಿ',                        en: 'Take a Registration token' },
  back:       { kn: 'ಹಿಂದೆ',                                        en: 'Back' },
  clear:      { kn: 'ಅಳಿಸಿ',                                        en: 'Clear' },
  done:       { kn: 'ಮುಗಿಯಿತು',                                     en: 'Done' },
  failed:     { kn: 'ಟೋಕನ್ ನೀಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೌಂಟರ್‌ನಲ್ಲಿ ಕೇಳಿ.', en: 'Could not issue a token. Please ask at the counter.' },
  pickYou:    { kn: 'ಈ ಸಂಖ್ಯೆಯಲ್ಲಿ ಹಲವರಿದ್ದಾರೆ. ನಿಮ್ಮನ್ನು ಆರಿಸಿ',      en: 'Several patients use this number. Choose yourself' },
  isThisYou:  { kn: 'ಇದು ನೀವೇ ಆಗಿದ್ದೀರಾ?',                         en: 'Is this you?' },
  yes:        { kn: 'ಹೌದು, ಮುಂದುವರಿಸಿ',                             en: 'Yes, continue' },
  no:         { kn: 'ಇಲ್ಲ',                                          en: 'No' },
  chooseTests: { kn: 'ನಿಮ್ಮ ಪರೀಕ್ಷೆಗಳನ್ನು ಆರಿಸಿ',                    en: 'Choose your tests' },
  all:        { kn: 'ಎಲ್ಲಾ',                                         en: 'All' },
  total:      { kn: 'ಒಟ್ಟು',                                         en: 'Total' },
  tests:      { kn: 'ಪರೀಕ್ಷೆಗಳು',                                    en: 'tests' },
  noTests:    { kn: 'ಯಾವುದೇ ಪರೀಕ್ಷೆ ಕಂಡುಬಂದಿಲ್ಲ',                    en: 'No tests found' },
  payHow:     { kn: 'ಹೇಗೆ ಪಾವತಿಸುವಿರಿ?',                             en: 'How would you like to pay?' },
  payQr:      { kn: 'UPI QR ಮೂಲಕ ಪಾವತಿಸಿ',                          en: 'Pay with UPI QR' },
  payQrSub:   { kn: 'ಈ ಪರದೆಯ QR ಅನ್ನು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ',               en: 'Scan the QR on this screen' },
  payLink:    { kn: 'ನನ್ನ ಮೊಬೈಲ್‌ಗೆ ಲಿಂಕ್ ಕಳುಹಿಸಿ',                  en: 'Send a link to my mobile' },
  scan:       { kn: 'ಯಾವುದೇ UPI ಆ್ಯಪ್‌ನಲ್ಲಿ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ ಪಾವತಿಸಿ',    en: 'Scan with any UPI app and pay' },
  waitPay:    { kn: 'ನಿಮ್ಮ ಪಾವತಿಗಾಗಿ ಕಾಯಲಾಗುತ್ತಿದೆ…',                 en: 'Waiting for your payment…' },
  linkSent:   { kn: 'ಪಾವತಿ ಲಿಂಕ್ ಕಳುಹಿಸಲಾಗಿದೆ',                      en: 'Payment link sent to' },
  linkHelp:   { kn: 'ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ ಲಿಂಕ್ ತೆರೆದು ಪಾವತಿಸಿ. ಈ ಪರದೆ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಬದಲಾಗುತ್ತದೆ.', en: 'Open the link on your phone and pay. This screen updates by itself.' },
  cancel:     { kn: 'ರದ್ದುಮಾಡಿ',                                    en: 'Cancel' },
  expired:    { kn: 'ಪಾವತಿ ಅವಧಿ ಮುಗಿದಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',         en: 'This payment has expired. Please try again.' },
  paid:       { kn: 'ಪಾವತಿ ಸ್ವೀಕರಿಸಲಾಗಿದೆ',                           en: 'Payment received' },
  whatsapp:   { kn: 'ಇನ್‌ವಾಯ್ಸ್ ಮತ್ತು ಟೋಕನ್ ವಿವರಗಳನ್ನು ನಿಮ್ಮ ವಾಟ್ಸ್ಆ್ಯಪ್‌ಗೆ ಕಳುಹಿಸಲಾಗುತ್ತದೆ', en: 'Your invoice and token details are being sent to your WhatsApp' },
  proceed:    { kn: 'ಮಾದರಿ ಸಂಗ್ರಹ ಕೌಂಟರ್‌ಗೆ ಹೋಗಿ ನಿಮ್ಮ ಸಂಖ್ಯೆಗಾಗಿ ಕಾಯಿರಿ', en: 'Go to the sample collection counter and wait for your number' },
  noOnline:   { kn: 'ಆನ್‌ಲೈನ್ ಪಾವತಿ ಲಭ್ಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ಕೌಂಟರ್‌ನಲ್ಲಿ ಕೇಳಿ.', en: 'Online payment is not available. Please ask at the counter.' },
  amountDue:  { kn: 'ಪಾವತಿಸಬೇಕಾದ ಮೊತ್ತ',                            en: 'Amount due' },
  payAtCounter: { kn: 'ಅಥವಾ ಕೌಂಟರ್‌ನಲ್ಲಿ ಪಾವತಿಸಿ',                    en: 'or pay at the counter' },
};
const Bi = ({ k }) => (
  <span className="bi"><span className="bi-en">{T[k].en}</span><span className="bi-kn" lang="kn">{T[k].kn}</span></span>
);
const BiInline = ({ k }) => <>{T[k].en} <span lang="kn">{T[k].kn}</span></>;
const aheadText = (n) => (n === 0
  ? { en: T.youAreNext.en, kn: T.youAreNext.kn }
  : { en: `${n} ${n === 1 ? 'person' : 'people'} ahead of you`, kn: `ನಿಮ್ಮ ಮುಂದೆ ${n} ಜನರಿದ್ದಾರೆ` });
const inr = (n) => `₹${Number(n).toFixed(2)}`;
const KEY_ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM-'];

const post = (path, body) => fetch(`${API_BASE}/api/lab/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

// Prints the slip: straight to the kiosk printer inside the kiosk shell, the
// browser's print dialog anywhere else.
async function printSlip(base64) {
  if (window.kiosk?.printPdf) return window.kiosk.printPdf(base64);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.src = url;
  frame.onload = () => { frame.contentWindow.focus(); frame.contentWindow.print(); };
  document.body.appendChild(frame);
  setTimeout(() => { URL.revokeObjectURL(url); frame.remove(); }, 60000);
  return { success: true };
}

// Self-service at the lobby kiosk (tender #9, #47).
//   Registered patient: UHID / mobile → (if the mobile is shared, choose your
//   name) → confirm it is you → choose tests → pay by UPI QR or a link to
//   your mobile → token + invoice on WhatsApp. A patient already billed at
//   the counter just gets their token; a new patient a Registration token.
export default function KioskTokenModal({ branchId, onClose }) {
  const [step, setStep] = useState('choose'); // choose | enter | pick | confirm | tests | pay | wait | paid | result
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);       // { en, kn, offerRegistration }
  const [result, setResult] = useState(null);
  const [choices, setChoices] = useState([]);
  const [who, setWho] = useState(null);       // { pick, label, has_order_today, can_pay_online, sms_to }
  const [catalogue, setCatalogue] = useState([]);
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState({}); // test id → test
  const [session, setSession] = useState(null); // { txn_id, key, kind, qr_image, expires_at, sent_to, due, items }
  const [paid, setPaid] = useState(null);       // { receipt, token }
  const [left, setLeft] = useState(0);
  const [alpha, setAlpha] = useState(false); // letters keyboard, for a UHID such as GHJ-2026-000001
  const printFromKiosk = !!window.kiosk?.printPdf;
  const timer = useRef(null);
  const live = useRef(null); // the payment being waited on, for cleanup on close
  const body = (extra = {}) => ({ branch_id: branchId || undefined, query: input, pick: who?.pick, ...extra });

  const armTimer = useCallback((ms = IDLE_MS) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(onClose, ms);
  }, [onClose]);
  useEffect(() => { armTimer(); return () => clearTimeout(timer.current); }, [armTimer]);

  // Leaving with an unpaid QR / link on screen closes it at Razorpay.
  useEffect(() => () => {
    const s = live.current;
    if (s) fetch(`${API_BASE}/api/lab/kiosk-payment/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({ txn_id: s.txn_id, key: s.key }),
    }).catch(() => {});
  }, []);

  // ── Issue a token for an existing order / a new registration ──
  const request = async (query, pick) => {
    setBusy(true); setErr(null); armTimer();
    try {
      const data = await post('kiosk-token', { branch_id: branchId || undefined, query: query || undefined, pick });
      if (!data.success) {
        setErr(data.not_found
          ? { en: T.notFound.en, kn: T.notFound.kn, offerRegistration: true }
          : { en: data.message || T.failed.en, kn: T.failed.kn });
        return;
      }
      setResult(data);
      setStep('result');
      armTimer(RESULT_CLOSE_MS);
      // An unattended kiosk prints the slip by itself.
      if (window.kiosk?.printPdf && data.slip_pdf) printSlip(data.slip_pdf).catch(() => {});
    } catch {
      setErr({ en: T.failed.en, kn: T.failed.kn });
    } finally {
      setBusy(false);
    }
  };

  // ── Who is this? ──
  const identify = async (pick) => {
    setBusy(true); setErr(null); armTimer();
    try {
      const d = await post('kiosk-payment/identify', { branch_id: branchId || undefined, query: input, pick });
      if (d.choose) { setChoices(d.choices); setStep('pick'); return; }
      if (d.not_found) { setErr({ en: T.notFound.en, kn: T.notFound.kn, offerRegistration: true }); return; }
      if (!d.success) { setErr({ en: d.message || T.failed.en, kn: T.failed.kn }); return; }
      setWho({ pick, label: d.label, has_order_today: d.has_order_today, can_pay_online: d.can_pay_online, sms_to: d.sms_to });
      setStep('confirm');
    } catch {
      setErr({ en: T.failed.en, kn: T.failed.kn });
    } finally {
      setBusy(false);
    }
  };

  // ── Confirmed: existing order → token; otherwise choose tests ──
  const confirmed = async () => {
    if (who.has_order_today) { request(input, who.pick); return; }
    if (!who.can_pay_online) { setErr({ en: T.noOnline.en, kn: T.noOnline.kn }); return; }
    setBusy(true); setErr(null); armTimer();
    try {
      const d = await fetch(`${API_BASE}/api/lab/kiosk-payment/tests?branch_id=${branchId || ''}`).then((r) => r.json());
      if (!d.success) { setErr({ en: d.message || T.failed.en, kn: T.failed.kn }); return; }
      setCatalogue(d.tests); setSelected({}); setCategory('');
      setStep('tests');
    } catch {
      setErr({ en: T.failed.en, kn: T.failed.kn });
    } finally {
      setBusy(false);
    }
  };

  const categories = useMemo(() => [...new Set(catalogue.map((t) => t.category).filter(Boolean))].sort(), [catalogue]);
  const shown = useMemo(() => catalogue.filter((t) => !category || t.category === category), [catalogue, category]);
  const chosen = Object.values(selected);
  const total = chosen.reduce((s, t) => s + t.price, 0);
  const toggle = (t) => { armTimer(); setSelected((s) => { const n = { ...s }; if (n[t.id]) delete n[t.id]; else n[t.id] = t; return n; }); };

  // ── Pay: a UPI QR on this screen, or a link to the registered mobile ──
  const startPay = async (mode) => {
    setBusy(true); setErr(null); clearTimeout(timer.current);
    try {
      const extra = step === 'result' ? {} : { test_ids: chosen.map((t) => t.id) };
      const d = await post(`kiosk-payment/${mode}`, body(extra));
      if (!d.success) {
        setErr({ en: d.message || T.failed.en, kn: T.failed.kn }); armTimer(RESULT_CLOSE_MS); return;
      }
      live.current = { txn_id: d.txn_id, key: d.key };
      setSession({ ...d, mode });
      setStep('wait');
    } catch {
      setErr({ en: T.failed.en, kn: T.failed.kn }); armTimer(RESULT_CLOSE_MS);
    } finally {
      setBusy(false);
    }
  };

  const leavePayment = async (nextStep) => {
    const s = live.current;
    live.current = null;
    if (s) await post('kiosk-payment/cancel', { txn_id: s.txn_id, key: s.key }).catch(() => {});
    setSession(null);
    setStep(nextStep);
    armTimer();
  };

  // Polls Razorpay (through our server) until the payment lands.
  const txn = session?.txn_id; const txnKey = session?.key; const expiresAt = session?.expires_at;
  useEffect(() => {
    if (step !== 'wait' || !txn) return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const d = await fetch(`${API_BASE}/api/lab/kiosk-payment/status/${txn}?key=${txnKey}`).then((r) => r.json());
        if (stop || !d.success) return;
        if (d.status === 'Paid') {
          live.current = null;
          setPaid({ receipt: d.receipt_no, token: d.queue_token?.token_number, refund: d.refund_due });
          setStep('paid'); armTimer(RESULT_CLOSE_MS);
        } else if (['Expired', 'Cancelled', 'Failed'].includes(d.status)) {
          live.current = null;
          setSession(null);
          setErr({ en: T.expired.en, kn: T.expired.kn });
          setStep(chosen.length ? 'tests' : 'result'); armTimer();
        }
      } catch { /* a missed poll is retried */ }
    };
    const iv = setInterval(tick, POLL_MS);
    const clock = setInterval(() => setLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000))), 1000);
    return () => { stop = true; clearInterval(iv); clearInterval(clock); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, txn, txnKey, expiresAt]);

  const reprint = (slip) => { armTimer(RESULT_CLOSE_MS); printSlip(slip).catch(() => {}); };

  const press = (k) => {
    armTimer(); setErr(null);
    if (k === 'del') setInput((v) => v.slice(0, -1));
    else if (k === 'clr') setInput('');
    else setInput((v) => (v.length < 20 ? v + k : v));
  };
  const restart = () => { setStep('enter'); setErr(null); setWho(null); setChoices([]); armTimer(); };
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <div className="tv-modal-bg">
      <div className="tv-modal tv-token-modal">
        <button className="tv-close" onClick={onClose}><X size={22} /></button>

        {step === 'choose' && (
          <>
            <h2><Bi k="title" /></h2>
            <div className="tv-token-choices">
              <button className="tv-token-choice" onClick={() => { setStep('enter'); armTimer(); }}>
                <IdCard size={40} />
                <Bi k="registered" />
                <small>{T.registeredSub.en} · <span lang="kn">{T.registeredSub.kn}</span></small>
              </button>
              <button className="tv-token-choice alt" disabled={busy} onClick={() => request(null)}>
                <UserPlus size={40} />
                <Bi k="newPatient" />
                <small>{T.newPatientSub.en} · <span lang="kn">{T.newPatientSub.kn}</span></small>
              </button>
            </div>
            {busy && <p className="tv-muted">{T.working.en} · <span lang="kn">{T.working.kn}</span></p>}
            {err && <p className="tv-err">{err.en}<br /><span lang="kn">{err.kn}</span></p>}
          </>
        )}

        {step === 'enter' && (
          <>
            <h2><Bi k="enterId" /></h2>
            <div className="tv-input">{input || <span className="tv-ph">………</span>}</div>
            {err && <p className="tv-err">{err.en}<br /><span lang="kn">{err.kn}</span></p>}
            {alpha ? (
              <div className="tv-keys">
                {KEY_ROWS.map((row) => (
                  <div key={row} className="tv-keys-row">{row.split('').map((k) => <button key={k} onClick={() => press(k)}>{k}</button>)}</div>
                ))}
                <div className="tv-keys-row">
                  <button className="wide" onClick={() => setAlpha(false)}>123</button>
                  <button className="wide" onClick={() => press('clr')}>{T.clear.en}</button>
                  <button className="wide" onClick={() => press('del')}><Delete size={22} /></button>
                </div>
              </div>
            ) : (
              <div className="tv-pad">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => <button key={k} onClick={() => press(k)}>{k}</button>)}
                <button onClick={() => press('clr')} className="sm">{T.clear.en}<i lang="kn">{T.clear.kn}</i></button>
                <button onClick={() => press('0')}>0</button>
                <button onClick={() => press('del')} className="sm"><Delete size={22} /></button>
              </div>
            )}
            {!alpha && <button className="tv-alpha" onClick={() => setAlpha(true)}>ABC · UHID</button>}
            <div className="tv-actions">
              <button className="tv-btn ghost" onClick={() => { setStep('choose'); setErr(null); setInput(''); }}><BiInline k="back" /></button>
              {err?.offerRegistration
                ? <button className="tv-btn" disabled={busy} onClick={() => request(null)}><BiInline k="takeReg" /></button>
                : <button className="tv-btn" disabled={busy || input.length < 4} onClick={() => identify(undefined)}>
                    {busy ? <BiInline k="working" /> : <BiInline k="continue" />}
                  </button>}
            </div>
          </>
        )}

        {step === 'pick' && (
          <>
            <h2><Bi k="pickYou" /></h2>
            <div className="tv-who-list">
              {choices.map((c) => (
                <button key={c.pick} className="tv-who" disabled={busy} onClick={() => identify(c.pick)}>
                  <Users size={26} /> <span>{c.label}</span>
                </button>
              ))}
            </div>
            {err && <p className="tv-err">{err.en}<br /><span lang="kn">{err.kn}</span></p>}
            <div className="tv-actions">
              <button className="tv-btn ghost" onClick={restart}><BiInline k="back" /></button>
            </div>
          </>
        )}

        {step === 'confirm' && who && (
          <>
            <h2><Bi k="isThisYou" /></h2>
            <div className="tv-who-card"><IdCard size={34} /><strong>{who.label}</strong></div>
            {err && <p className="tv-err">{err.en}<br /><span lang="kn">{err.kn}</span></p>}
            <div className="tv-actions">
              <button className="tv-btn ghost" onClick={restart}><BiInline k="no" /></button>
              <button className="tv-btn" disabled={busy} onClick={confirmed}>
                {busy ? <BiInline k="working" /> : <><Check size={20} /> <BiInline k="yes" /></>}
              </button>
            </div>
          </>
        )}

        {step === 'tests' && (
          <>
            <h2><Bi k="chooseTests" /></h2>
            {categories.length > 1 && (
              <div className="tv-letters">
                <button className={!category ? 'on' : ''} onClick={() => { setCategory(''); armTimer(); }}>{T.all.en}</button>
                {categories.map((c) => <button key={c} className={category === c ? 'on' : ''} onClick={() => { setCategory(c === category ? '' : c); armTimer(); }}>{c}</button>)}
              </div>
            )}
            <div className="tv-tests">
              {shown.map((t) => (
                <button key={t.id} className={`tv-test${selected[t.id] ? ' on' : ''}`} onClick={() => toggle(t)}>
                  <span className="tv-test-check">{selected[t.id] ? <Check size={18} strokeWidth={3} /> : null}</span>
                  <span className="tv-test-name">{t.name}</span>
                  <b>{inr(t.price)}</b>
                </button>
              ))}
              {!shown.length && <p className="tv-muted">{T.noTests.en} · <span lang="kn">{T.noTests.kn}</span></p>}
            </div>
            {err && <p className="tv-err">{err.en}<br /><span lang="kn">{err.kn}</span></p>}
            <div className="tv-cart">
              <div><span>{chosen.length} {T.tests.en}</span><strong>{T.total.en}: {inr(total)}</strong></div>
              <button className="tv-btn ghost sm" onClick={restart}><BiInline k="back" /></button>
              <button className="tv-btn sm" disabled={!chosen.length} onClick={() => { setErr(null); setStep('pay'); armTimer(); }}>
                <BiInline k="continue" />
              </button>
            </div>
          </>
        )}

        {step === 'pay' && (
          <>
            <h2><Bi k="payHow" /></h2>
            <p className="tv-pay-due">{T.total.en} · <span lang="kn">{T.total.kn}</span>: <strong>{inr(total)}</strong></p>
            <div className="tv-token-choices">
              <button className="tv-token-choice" disabled={busy} onClick={() => startPay('qr')}>
                <QrCode size={40} /><Bi k="payQr" /><small>{T.payQrSub.en} · <span lang="kn">{T.payQrSub.kn}</span></small>
              </button>
              <button className="tv-token-choice alt" disabled={busy || !who?.sms_to} onClick={() => startPay('link')}>
                <Smartphone size={40} /><Bi k="payLink" /><small>{who?.sms_to || '—'}</small>
              </button>
            </div>
            {busy && <p className="tv-muted"><BiInline k="working" /></p>}
            {err && <p className="tv-err">{err.en}<br /><span lang="kn">{err.kn}</span></p>}
            <div className="tv-actions">
              <button className="tv-btn ghost" disabled={busy} onClick={() => { setStep('tests'); setErr(null); armTimer(); }}><BiInline k="back" /></button>
            </div>
          </>
        )}

        {step === 'wait' && session && (
          <>
            {session.mode === 'qr' ? (
              <>
                <h2><Bi k="scan" /></h2>
                <p className="tv-pay-due">{T.amountDue.en} · <span lang="kn">{T.amountDue.kn}</span>: <strong>{inr(session.due)}</strong></p>
                <div className="tv-qr"><img src={session.qr_image} alt="UPI QR" /></div>
              </>
            ) : (
              <>
                <h2><Bi k="linkSent" /></h2>
                <p className="tv-pay-due"><strong>{session.sent_to}</strong> · {inr(session.due)}</p>
                <p className="tv-muted">{T.linkHelp.en}<br /><span lang="kn">{T.linkHelp.kn}</span></p>
              </>
            )}
            <p className="tv-muted tv-waiting">{T.waitPay.en} · <span lang="kn">{T.waitPay.kn}</span> {left > 0 && <b>{mmss}</b>}</p>
            <div className="tv-actions">
              <button className="tv-btn ghost" onClick={() => leavePayment(chosen.length ? 'pay' : 'result')}><BiInline k="cancel" /></button>
            </div>
          </>
        )}

        {step === 'paid' && paid && (
          <>
            <div className="tv-paid-tick"><Check size={44} strokeWidth={3} /></div>
            <h2><Bi k="paid" /></h2>
            {paid.receipt && <p className="tv-muted">{paid.receipt}</p>}
            {paid.token && (
              <>
                <p className="tv-token-queue">{T['Sample Collection'].en} · <span lang="kn">{T['Sample Collection'].kn}</span></p>
                <h3 className="tv-yt"><Bi k="yourToken" /></h3>
                <div className="tv-token-number">{paid.token}</div>
              </>
            )}
            <p className="tv-done">{T.whatsapp.en}<br /><span lang="kn">{T.whatsapp.kn}</span></p>
            <p className="tv-muted">{T.proceed.en}<br /><span lang="kn">{T.proceed.kn}</span></p>
            <div className="tv-actions">
              <button className="tv-btn" onClick={onClose}><BiInline k="done" /></button>
            </div>
          </>
        )}

        {step === 'result' && result && (
          <>
            <p className="tv-token-queue">{T[result.service_point]?.en || result.service_point} · <span lang="kn">{T[result.service_point]?.kn}</span></p>
            <h2><Bi k="yourToken" /></h2>
            <div className="tv-token-number">{result.token_number}</div>
            <p className="tv-token-ahead">{aheadText(result.ahead).en}<br /><span lang="kn">{aheadText(result.ahead).kn}</span></p>
            {result.payment_due > 0 && result.pay_options && (
              <div className="tv-pay">
                <p className="tv-pay-due">{T.amountDue.en} · <span lang="kn">{T.amountDue.kn}</span>: <strong>{inr(result.payment_due)}</strong></p>
                <div className="tv-pay-two">
                  <button className="tv-btn" disabled={busy} onClick={() => startPay('qr')}>
                    <QrCode size={20} /> <BiInline k="payQr" />
                  </button>
                  {result.pay_options.sms_to && (
                    <button className="tv-btn ghost" disabled={busy} onClick={() => startPay('link')}>
                      <Smartphone size={20} /> <BiInline k="payLink" />
                    </button>
                  )}
                </div>
                <p className="tv-muted">{T.payAtCounter.en} · <span lang="kn">{T.payAtCounter.kn}</span></p>
                {err && <p className="tv-err">{err.en}<br /><span lang="kn">{err.kn}</span></p>}
              </div>
            )}
            {result.reused && <p className="tv-muted">{T.sameToken.en} · <span lang="kn">{T.sameToken.kn}</span></p>}
            <p className="tv-muted">{T.waitCall.en}<br /><span lang="kn">{T.waitCall.kn}</span></p>
            {printFromKiosk && <p className="tv-done">{T.takeSlip.en} · <span lang="kn">{T.takeSlip.kn}</span></p>}
            <div className="tv-actions">
              {result.slip_pdf && (
                <button className="tv-btn ghost" onClick={() => reprint(result.slip_pdf)}>
                  <Printer size={20} /> <BiInline k="printSlip" />
                </button>
              )}
              <button className="tv-btn" onClick={onClose}><BiInline k="done" /></button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
