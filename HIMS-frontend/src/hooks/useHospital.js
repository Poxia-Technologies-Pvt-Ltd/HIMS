import { useEffect, useState } from 'react';

// The hospital's name and logo (Settings > About), for the start page,
// sign-in screens and sidebar. Public endpoint; cached for the session.
const KEY = 'hospital_branding';
const API_BASE = import.meta.env.VITE_API_URL || '';

const cached = () => {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
};

export const refreshHospitalBranding = () => {
  try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event('hospital-branding'));
};

export function useHospital() {
  const [branding, setBranding] = useState(() => cached() || { hospital_name: '' });
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${API_BASE}/api/settings/branding`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d.success || !d.branding) return;
        setBranding(d.branding);
        try { sessionStorage.setItem(KEY, JSON.stringify(d.branding)); } catch { /* storage unavailable */ }
      })
      .catch(() => {});
    if (!cached()) load();
    window.addEventListener('hospital-branding', load);
    return () => { alive = false; window.removeEventListener('hospital-branding', load); };
  }, []);
  useEffect(() => { if (branding.hospital_name) document.title = `${branding.hospital_name} · HMIS`; }, [branding.hospital_name]);
  return branding;
}
