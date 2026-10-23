import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import Sidebar from './Sidebar';
import OfflineBanner from './OfflineBanner';

const Layout = ({ children }) => {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (window.electronAPI) {
      const removeStatus = window.electronAPI.onDeviceStatus((status) => {
        setToast(status);
        setTimeout(() => setToast(null), 5000);
      });

        return () => {
          removeStatus();
        };
    }
  }, []);

  const connected = toast?.status === 'Connected';

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <OfflineBanner />
        {children}
      </main>

      {toast && (
        <div className={`toast ${connected ? 'toast-success' : 'toast-error'}`}>
          {connected ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>Device {toast.status}</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{toast.model} on {toast.port}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Layout;
