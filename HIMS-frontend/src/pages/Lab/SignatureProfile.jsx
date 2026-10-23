import { useState, useEffect, useRef } from 'react';
import '../../assets/CSS/ResultFlagSettings.css';
import '../../assets/CSS/SignatureProfile.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}`, 'Content-Type': 'application/json' });

// The authorizing doctor's signature profile: registration number, designation
// and signature image (drawn or uploaded). Printed on every report they sign.
export default function SignatureProfile({ onClose, onSaved }) {
  const [regNo, setRegNo] = useState('');
  const [designation, setDesignation] = useState('');
  const [image, setImage] = useState(null);       // data URL to save (new)
  const [current, setCurrent] = useState(null);   // data URL already on file
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/lab/my-signature`, { headers: authHdr() }).then((r) => r.json()).then((d) => {
      if (d.success) { setRegNo(d.profile.registration_no); setDesignation(d.profile.designation); setCurrent(d.profile.signature_image); }
    }).catch(() => {});
  }, []);

  const pos = (e) => {
    const c = canvasRef.current; const r = c.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: (p.clientX - r.left) * (c.width / r.width), y: (p.clientY - r.top) * (c.height / r.height) };
  };
  const start = (e) => { drawing.current = true; const ctx = canvasRef.current.getContext('2d'); const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext('2d'); const { x, y } = pos(e);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.strokeStyle = '#111'; ctx.lineTo(x, y); ctx.stroke(); e.preventDefault();
  };
  const end = () => {
    if (!drawing.current) return; drawing.current = false;
    setImage(canvasRef.current.toDataURL('image/png'));
  };
  const clear = () => { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setImage(null); };

  const upload = (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) { setMessage({ ok: false, text: 'Use a PNG or JPEG image.' }); return; }
    if (file.size > 250 * 1024) { setMessage({ ok: false, text: 'Image is too large (limit 250 KB).' }); return; }
    const fr = new FileReader();
    fr.onload = () => { setImage(fr.result); setMessage(null); };
    fr.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/lab/my-signature`, { method: 'PUT', headers: authHdr(), body: JSON.stringify({ registration_no: regNo, designation, signature_image: image || undefined }) });
      const d = await res.json();
      if (d.success) { setMessage({ ok: true, text: 'Saved.' }); onSaved?.(); setTimeout(onClose, 600); }
      else setMessage({ ok: false, text: d.message || 'Could not save.' });
    } catch { setMessage({ ok: false, text: 'Network error.' }); }
    finally { setSaving(false); }
  };

  const shown = image || current;
  return (
    <div className="rfs-overlay" onClick={onClose}>
      <div className="rfs-modal sp-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>My Signature</h2>
          <p>Printed on every report you authorize, with your registration number. Authorizing a report also needs your login password each time.</p>
        </header>

        <div className="rfs-fields">
          <label><span className="rfs-label">Medical registration number</span><input value={regNo} maxLength={60} onChange={(e) => setRegNo(e.target.value)} placeholder="e.g. KMC 12345" /></label>
          <label><span className="rfs-label">Designation</span><input value={designation} maxLength={100} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Consultant Pathologist" /></label>
        </div>

        <div className="sp-pad-block">
          <div className="sp-pad-head"><span className="rfs-label">Draw your signature</span><button type="button" className="sp-link" onClick={clear}>Clear</button></div>
          <canvas ref={canvasRef} width={560} height={170} className="sp-pad"
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
          <div className="sp-or">or upload an image <input type="file" accept="image/png,image/jpeg" onChange={(e) => upload(e.target.files?.[0])} /></div>
        </div>

        {shown && (
          <div className="sp-preview"><span className="rfs-label">{image ? 'New signature' : 'Signature on file'}</span><img src={shown} alt="Signature" /></div>
        )}

        {message && <div className={`rfs-msg ${message.ok ? 'ok' : 'bad'}`}>{message.text}</div>}
        <footer>
          <button className="rfs-btn ghost" onClick={onClose}>Cancel</button>
          <button className="rfs-btn primary" onClick={save} disabled={saving || regNo.trim().length < 3 || !(image || current)}>{saving ? 'Saving…' : 'Save signature'}</button>
        </footer>
      </div>
    </div>
  );
}
