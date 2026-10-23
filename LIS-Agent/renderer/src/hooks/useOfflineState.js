import { useState, useEffect, useCallback } from 'react';

// The offline queue (registrations / collections waiting to sync) and whether
// the server is reachable — kept live from the main process (offlineSync.js).
export default function useOfflineState() {
  const [state, setState] = useState(null);
  const [online, setOnline] = useState(true);

  const refresh = useCallback(() => {
    window.electronAPI?.offline?.getState()
      .then((s) => { setState(s); if (s.online !== null && s.online !== undefined) setOnline(s.online); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.offline) return undefined;
    const t = setTimeout(refresh, 0);
    const offUpdate = api.offline.onUpdated(refresh);
    const offNet = api.onNetworkStatus?.((s) => { setOnline(s.online); refresh(); });
    const poll = setInterval(refresh, 15000);
    return () => { clearTimeout(t); offUpdate?.(); offNet?.(); clearInterval(poll); };
  }, [refresh]);

  const waiting = state
    ? state.registrations.pending + state.registrations.review + state.registrations.failed + state.collections.pending + state.collections.failed
    : 0;
  return { state, online, waiting, refresh };
}
