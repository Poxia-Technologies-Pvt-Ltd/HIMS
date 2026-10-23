import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ConciergeBell, Stethoscope, HeartPulse, FlaskConical, Pill, Users, ShieldCheck, ChevronRight, Hospital, Play, TriangleAlert, ScanLine, Calculator } from 'lucide-react';
import { ROLE_PORTALS, homeFor } from '../utils/rolePortals';
import { useHospital } from '../hooks/useHospital';
import { storeStaffSession } from '../utils/session';
import '../assets/CSS/Hmis.css';

const ICONS = { reception: ConciergeBell, doctor: Stethoscope, nurse: HeartPulse, lab: FlaskConical, pharmacy: Pill, hr: Users, admin: ShieldCheck, imaging: ScanLine, accounts: Calculator };
const LAST_KEY = 'last_portal';
const API_BASE = import.meta.env.VITE_API_URL || '';

// Start page: choose who is signing in. Normally that opens the role's
// sign-in screen. With temporary access on (backend QUICK_ACCESS=true) the
// chosen role's session starts straight away, without an ID or password.
export default function RolePicker() {
  const navigate = useNavigate();
  const hospital = useHospital();
  const [config, setConfig] = useState(null);
  const [selected, setSelected] = useState(() => {
    try { return localStorage.getItem(LAST_KEY); } catch { return null; }
  });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/api/auth/config`).then((r) => r.json()).then(setConfig).catch(() => setConfig({ quickAccess: false }));
  }, []);
  const quick = !!config?.quickAccess;

  const pick = (id) => {
    setError('');
    try { localStorage.setItem(LAST_KEY, id); } catch { /* storage unavailable */ }
    if (quick) setSelected(id);
    else navigate(`/login/${id}`);
  };

  const start = async () => {
    if (!selected) return;
    setStarting(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/quick-session`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portal: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not start the session');
      storeStaffSession(data);
      navigate(homeFor(data.role));
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };

  const chosen = ROLE_PORTALS.find((p) => p.id === selected);
  const chosenAccount = quick && selected ? config.portals?.[selected] : null;

  return (
    <div className="rp-page">
      <div className="rp-wrap">
        <header className="rp-head">
          {hospital.logo_url
            ? <img src={hospital.logo_url} alt="" className="rp-logo" />
            : <span className="rp-logo rp-logo-fallback"><Hospital size={30} /></span>}
          <div>
            <h1>{hospital.hospital_name || 'Hospital'}</h1>
            <p>Hospital Management System</p>
          </div>
        </header>

        {quick && (
          <div className="hm-note warn" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <TriangleAlert size={16} /> Temporary access is on: sessions start without an ID or password. Turn it off (QUICK_ACCESS) before the hospital goes live.
          </div>
        )}

        <h2 className="rp-title">{quick ? 'Choose a role and start the session' : 'Who is signing in?'}</h2>
        <div className="rp-grid">
          {ROLE_PORTALS.map((p) => {
            const Icon = ICONS[p.id];
            const account = quick ? config.portals?.[p.id] : undefined;
            const isOn = quick && selected === p.id;
            return (
              <button key={p.id} type="button" className={`rp-tile${(quick ? isOn : selected === p.id) ? ' last' : ''}`}
                aria-pressed={quick ? isOn : undefined} onClick={() => pick(p.id)} style={{ '--rp': p.color, background: isOn ? `color-mix(in srgb, ${p.color} 8%, white)` : undefined }}>
                <span className="rp-icon"><Icon size={26} strokeWidth={1.9} /></span>
                <span className="rp-text">
                  <strong>{p.label}</strong>
                  <small>{quick ? (account ? `Opens as ${account.name} (${account.role})` : 'No account yet') : p.hint}</small>
                </span>
                {quick
                  ? <span className={`rp-radio${isOn ? ' on' : ''}`} />
                  : <ChevronRight size={18} className="rp-go" />}
              </button>
            );
          })}
        </div>

        {quick && (
          <div className="rp-start">
            {error && <span className="rp-error">{error}</span>}
            <button type="button" className="hm-btn primary lg" disabled={!selected || starting || !chosenAccount} onClick={start}
              style={chosen ? { background: chosen.color, borderColor: chosen.color } : undefined}>
              <Play size={17} /> {starting ? 'Starting…' : chosen ? `Start ${chosen.label} session` : 'Select a role'}
            </button>
          </div>
        )}

        <footer className="rp-foot">
          <Link to="/patient-login">Patient? View your reports and book a doctor's appointment →</Link>
          {hospital.phone && <span>Help desk: {hospital.phone}</span>}
        </footer>
      </div>
    </div>
  );
}
