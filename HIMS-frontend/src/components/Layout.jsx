import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import PhoneDemographicModal from './PhoneDemographicModal';
import { useIdleLogout } from '../hooks/useIdleLogout';
import { clearStaffSession, hasStaffToken } from '../utils/session';

function Layout() {
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);
  const navigate = useNavigate();

  useIdleLogout(clearStaffSession);

  // VAPT #5 (Browser Refresh Attack): a page restored from the browser's
  // bfcache after logout would otherwise show stale authenticated content
  // without firing a fresh mount/request. `pageshow` fires on that restore
  // too, so re-check the token every time — not just on first mount.
  useEffect(() => {
    const onPageShow = (e) => {
      if (e.persisted && !hasStaffToken()) {
        navigate('/', { replace: true });
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [navigate]);

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflowX: 'clip' }}>
      <Sidebar onPhoneLookup={() => setPhoneModalOpen(true)} />

      <main style={{
        flex: 1,
        minWidth: 0,
        height: '100vh',
        background: 'var(--sys-bg)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        overflowX: 'clip',
      }}>
        <Outlet />
      </main>

      <PhoneDemographicModal open={phoneModalOpen} onClose={() => setPhoneModalOpen(false)} />
    </div>
  );
}

export default Layout;
