import React from 'react';
import axios from 'axios';
import { API_BASE } from '../apiBase';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ClipboardList, TestTube2, PencilLine, ScrollText,
  Wrench, BookOpen, FileBarChart2, AlertTriangle, ListChecks, Ban, ArrowRightLeft, Siren, CalendarClock, FlaskConical,
  LogOut, UserPlus, Syringe, CloudOff
} from 'lucide-react';
import useOfflineState from '../hooks/useOfflineState';
import { loadLocalMachines, isLocalMachine } from '../utils/localMachines';

const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isConfigured, setIsConfigured] = React.useState(false);
  const [unmappedCount, setUnmappedCount] = React.useState(0);
  const [recollectCount, setRecollectCount] = React.useState(0);
  const [transferCount, setTransferCount] = React.useState(0);
  const [criticalCount, setCriticalCount] = React.useState(0);
  const [maintCount, setMaintCount] = React.useState(0);
  const [reagentCount, setReagentCount] = React.useState(0);
  const { waiting: offlineWaiting } = useOfflineState();

  React.useEffect(() => {
    window.electronAPI.getConfig().then(config => {
      if (config && config.lab_id) {
        setIsConfigured(true);
      }
    }).catch(err => console.error("Sidebar config check error:", err));
  }, []);

  // Live count of results still waiting on a technician to type in a sample
  // ID — the sidebar is the one place visible from every screen, so this is
  // the signal that something needs attention without having to visit the
  // Unmapped Test page just to check.
  React.useEffect(() => {
    const refresh = () => window.electronAPI.getUnmappedResults?.()
      .then((rows) => setUnmappedCount(rows?.length || 0))
      .catch(() => {});
    refresh();
    const off = window.electronAPI.onLocalResultsUpdated?.(refresh);
    const interval = setInterval(refresh, 20000);
    return () => { off?.(); clearInterval(interval); };
  }, []);

  // Patients awaiting recollection after a rejection — the alert stays
  // visible from every screen until the collection desk has redrawn them.
  React.useEffect(() => {
    const refresh = () => axios.get(`${API_BASE}/api/lab/rejections`, { params: { status: 'pending' } })
      .then((r) => setRecollectCount(r.data?.pending || 0)).catch(() => {});
    const refreshTransfers = () => axios.get(`${API_BASE}/api/lab/referrals`, { params: { direction: 'in' } })
      .then((r) => setTransferCount(r.data?.in_transit || 0)).catch(() => {});
    const refreshCritical = () => axios.get(`${API_BASE}/api/lab/critical-alerts`, { params: { status: 'open' } })
      .then((r) => setCriticalCount(r.data?.open || 0)).catch(() => {});
    // Counts cover only the analyzers set up on this computer — and are zero
    // when none are, without waiting on the server.
    const countFor = async (url, setCount) => {
      const local = await loadLocalMachines();
      if (local.count === 0) { setCount(0); return; }
      const r = await axios.get(`${API_BASE}${url}`);
      setCount((r.data?.alerts || []).filter((a) => isLocalMachine(local, a.machine_name)).length);
    };
    const refreshMaint = () => countFor('/api/lab/maintenance/alerts', setMaintCount).catch(() => {});
    const refreshReagents = () => countFor('/api/lab/reagents/alerts', setReagentCount).catch(() => {});
    refresh();
    refreshTransfers();
    refreshCritical();
    refreshMaint();
    refreshReagents();
    const interval = setInterval(() => { refresh(); refreshTransfers(); refreshCritical(); refreshMaint(); refreshReagents(); }, 15000);
    return () => clearInterval(interval);
  }, []);

  const menuItems = [
    { name: 'Dashboard', path: '/dashboard', Icon: LayoutDashboard },
    { name: 'Registration', path: '/registration', Icon: UserPlus },
    { name: 'Sample Collection', path: '/sample-collection', Icon: Syringe },
    { name: 'Worklist', path: '/worklist', Icon: ClipboardList },
    { name: 'Sample List', path: '/sample-list', Icon: TestTube2 },
    { name: "Today's Test Results", path: '/today-results', Icon: ListChecks },
    { name: 'Reagent Changes', path: '/reagents', Icon: FlaskConical },
    { name: 'Equipment Maintenance', path: '/maintenance', Icon: CalendarClock },
    { name: 'Critical Alerts', path: '/critical-alerts', Icon: Siren },
    { name: 'Sample Transfer', path: '/sample-transfer', Icon: ArrowRightLeft },
    { name: 'Sample Rejection', path: '/sample-rejection', Icon: Ban },
    { name: 'Unmapped Test', path: '/unmapped-tests', Icon: AlertTriangle },
    { name: 'Offline Queue', path: '/offline-queue', Icon: CloudOff },
    { name: 'Edit Results', path: '/edit-results', Icon: PencilLine },
    { name: 'Reports', path: '/reports', Icon: FileBarChart2 },
    { name: 'Activity Logs', path: '/logs', Icon: ScrollText },
    { name: 'Machine Setup', path: '/setup', Icon: Wrench },
    { name: 'Master Sheet', path: '/master-sheet', Icon: BookOpen },
  ];

  // "Logout" now means deactivating this machine's device key, not ending a
  // user session — there is no user session anymore. Clearing localStorage
  // alone isn't enough: the Activation screen checks getDeviceKeyStatus()
  // (backed by the encrypted key file main/deviceKeyStore.js persists) and
  // would just bounce straight back to /setup if the key were left in
  // place, making this button appear to do nothing.
  const handleLogout = () => {
    localStorage.removeItem('branch_id');
    localStorage.removeItem('labId');
    localStorage.removeItem('role');
    localStorage.removeItem('role_level');
    localStorage.removeItem('device_label');
    window.electronAPI.deactivateDeviceKey().catch(() => {});
    navigate('/');
  };

  return (
    <aside className="agent-sidebar no-print">
      <div className="agent-sidebar-brand">
        <div className="agent-sidebar-logo">M</div>
        <div>
          <h2>KARNATAKA LIMS</h2>
          <p>
            <span className={`agent-status-dot ${isConfigured ? 'online' : ''}`} />
            Serial Agent v1.0
          </p>
        </div>
      </div>

      <nav className="agent-sidebar-nav">
        {menuItems.map((item) => {
          const active = location.pathname === item.path;
          const { Icon } = item;
          const badgeCount = item.path === '/unmapped-tests' ? unmappedCount : item.path === '/sample-rejection' ? recollectCount : item.path === '/sample-transfer' ? transferCount : item.path === '/critical-alerts' ? criticalCount : item.path === '/maintenance' ? maintCount : item.path === '/reagents' ? reagentCount : item.path === '/offline-queue' ? offlineWaiting : 0;
          const showBadge = badgeCount > 0;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              className={`agent-nav-item ${active ? 'active' : ''}`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon size={18} strokeWidth={2} />
                <span>{item.name}</span>
              </span>
              {showBadge && (
                <span style={{
                  background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 800,
                  borderRadius: 999, padding: '1px 7px', lineHeight: '16px', minWidth: 18, textAlign: 'center',
                }}>
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="agent-sidebar-footer">
        <button type="button" className="agent-logout-btn" onClick={handleLogout}>
          <LogOut size={16} />
          <span>Deactivate machine</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
