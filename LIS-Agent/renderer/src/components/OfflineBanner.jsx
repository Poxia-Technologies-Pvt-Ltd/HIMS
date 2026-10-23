import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WifiOff, CloudUpload, RefreshCw, AlertTriangle } from 'lucide-react';
import useOfflineState from '../hooks/useOfflineState';
import '../assets/CSS/Offline.css';

// Shown on every screen while the server cannot be reached, and afterwards for
// as long as anything saved offline is still waiting to reach it.
export default function OfflineBanner() {
  const { state, online, waiting } = useOfflineState();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!state) return null;

  const needsAttention = state.registrations.review + state.registrations.failed + state.collections.failed;
  if (online && !waiting) return null;

  const sync = async () => {
    setBusy(true);
    try { await window.electronAPI.offline.syncNow(); } finally { setBusy(false); }
  };

  const parts = [];
  const r = state.registrations.pending + state.registrations.review + state.registrations.failed;
  const c = state.collections.pending + state.collections.failed;
  if (r) parts.push(`${r} registration${r > 1 ? 's' : ''}`);
  if (c) parts.push(`${c} collection${c > 1 ? 's' : ''}`);

  return (
    <div className={`ofl-banner no-print ${online ? 'syncing' : 'offline'}`} role="status">
      {online ? <CloudUpload size={18} /> : <WifiOff size={18} />}
      <div className="ofl-banner-text">
        {online ? (
          <><b>{state.syncing || busy ? 'Syncing…' : 'Waiting to sync'}</b> {parts.join(' and ')} saved on this computer {state.syncing ? 'are being sent to the server.' : 'will be sent to the server.'}</>
        ) : (
          <><b>No connection to the server.</b> Registration and sample collection keep working — everything is saved on this computer{parts.length ? ` (${parts.join(', ')} waiting)` : ''} and is sent automatically when the network returns.</>
        )}
        {needsAttention > 0 && <span className="ofl-attn"><AlertTriangle size={14} /> {needsAttention} need{needsAttention === 1 ? 's' : ''} your attention</span>}
      </div>
      {online && waiting > 0 && (
        <button type="button" className="btn btn-sm btn-secondary" onClick={sync} disabled={busy || state.syncing}>
          <RefreshCw size={13} className={busy || state.syncing ? 'spin' : ''} /> Sync now
        </button>
      )}
      {waiting > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate('/offline-queue')}>View queue</button>}
    </div>
  );
}
