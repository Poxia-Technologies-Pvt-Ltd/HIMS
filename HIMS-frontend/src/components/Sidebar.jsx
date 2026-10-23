import { useState, useEffect, useMemo } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Stethoscope, Users, UserPlus, FolderOpen, ListOrdered, Receipt, Globe, PackageOpen, Tags,
  SlidersHorizontal, FlaskConical, ClipboardList, TestTubes, TestTube, MapPinned, ClipboardCheck, AlertTriangle,
  FileText, Send, Unlink, ListChecks, History, Barcode, ScanLine, IdCard, ShieldCheck, Gauge, MapPin, Wrench,
  Beaker, Wifi, FileClock, Microscope, Cpu, Hash, Network, KeyRound, FileSignature, Boxes, LayoutGrid, Layers, Store, Wallet,
  ShoppingCart, Package, ArrowLeftRight, Repeat, Link, UserCog, CalendarClock, Building2, Hospital,
  Server, Settings, Map, Shield, Download, Search, ChevronDown, Phone, LogOut, X, Droplets, Activity,
  CalendarCheck, Fingerprint, Plane, BadgeIndianRupee, DoorOpen, HandCoins, Lock,
} from 'lucide-react';
import { useHospital } from '../hooks/useHospital';
import '../assets/CSS/Sidebar.css';
import { clearStaffSession } from '../utils/session';

// The navigation, grouped by what the work is about. Every entry keeps the id
// it had before regrouping — canSee() below decides per role, unchanged.
const SECTIONS = [
  {
    id: 'home', items: [
      { id: 'dashboard', label: 'Dashboard', path: '/dashboard', Icon: LayoutDashboard },
      { id: 'doctor-dashboard', label: 'Doctor Console', path: '/doctor-dashboard', Icon: Stethoscope },
    ],
  },
  {
    id: 'patients', label: 'Patients', Icon: Users, items: [
      { id: 'patients', label: 'Registration', path: '/patient-registration', Icon: UserPlus },
      { id: 'patient-records', label: 'Patient Records', path: '/doctor-patients', Icon: FolderOpen },
      { id: 'queue-log-reception', label: 'Queue Log', path: '/queue-audit', Icon: ListOrdered },
    ],
  },
  {
    id: 'opd-group', label: 'Outpatients (OPD)', Icon: Stethoscope, items: [
      { id: 'appointments', label: 'OP Appointments', path: '/appointments', Icon: CalendarCheck },
      { id: 'infra-board', label: 'Room Management', path: '/hospital-infra', Icon: DoorOpen },
      { id: 'imaging-desk', label: 'X-ray & Scans', path: '/imaging-desk', Icon: ScanLine },
    ],
  },
  {
    id: 'billing-group', label: 'Billing & Payments', Icon: Wallet, items: [
      { id: 'billing-desk', label: 'Billing Desk', path: '/billing-desk', Icon: HandCoins },
      { id: 'billing', label: 'Bills & Receipts', path: '/billing-overview', Icon: Receipt },
      { id: 'billing-approvals', label: 'Approvals', path: '/billing-approvals', Icon: ClipboardCheck },
      { id: 'cash-closing', label: 'Cash Closing', path: '/cash-closing', Icon: Lock },
      { id: 'billing-control', label: 'Billing Control', path: '/billing-control', Icon: Gauge },
      { id: 'service-prices', label: 'Service Prices', path: '/service-prices', Icon: Tags },
      { id: 'online-payments', label: 'Online Payments', path: '/online-payments', Icon: Globe },
      { id: 'billing-packages', label: 'Billing Packages', path: '/billing-packages', Icon: PackageOpen },
      { id: 'test-prices', label: 'Hospital Test Prices', path: '/test-prices', Icon: Tags },
      { id: 'payment-settings', label: 'Payment Settings', path: '/payment-settings', Icon: SlidersHorizontal },
    ],
  },
  {
    id: 'lab-group', label: 'Laboratory', Icon: FlaskConical, items: [
      { id: 'lab-worklist', label: 'Worklist', path: '/lab-worklist', Icon: ClipboardList },
      { id: 'sample-collection', label: 'Sample Collection', path: '/sample-collection', Icon: TestTube },
      { id: 'lab-sample-list', label: 'Sample List', path: '/lab-sample-list', Icon: TestTubes },
      { id: 'sample-tracking', label: 'Sample Tracking', path: '/sample-tracking', Icon: MapPinned },
      { id: 'lab-verification', label: 'Verification', path: '/lab-verification', Icon: ClipboardCheck },
      { id: 'blood-bank', label: 'Blood Bank', path: '/blood-bank', Icon: Droplets },
      { id: 'poct', label: 'Point-of-Care Tests', path: '/poct', Icon: Activity },
      { id: 'lab-critical', label: 'Critical Alerts', path: '/critical-alerts', Icon: AlertTriangle },
      { id: 'lab-reports', label: 'Reports', path: '/lab-reports', Icon: FileText },
      { id: 'report-delivery', label: 'Report Delivery', path: '/report-delivery', Icon: Send },
      { id: 'lab-unmapped', label: 'Unmatched Results', path: '/lab-unmapped', Icon: Unlink },
      { id: 'queue-management', label: 'Queue', path: '/queue-management', Icon: ListChecks },
      { id: 'queue-audit', label: 'Queue Audit', path: '/queue-audit', Icon: History },
      { id: 'barcode-generator', label: 'Barcode Generator', path: '/barcode-generator', Icon: Barcode },
      { id: 'prescription-scan', label: 'Prescription Scan', path: '/prescription-scan', Icon: ScanLine },
    ],
  },
  {
    id: 'quality-group', label: 'Quality & Equipment', Icon: ShieldCheck, items: [
      { id: 'quality-control', label: 'Quality Control', path: '/quality-control', Icon: ShieldCheck },
      { id: 'quality-dashboard', label: 'Quality & TAT', path: '/quality-dashboard', Icon: Gauge },
      { id: 'equipment', label: 'Equipment & Geo-fence', path: '/equipment', Icon: MapPin },
      { id: 'lab-equipment', label: 'Equipment Maintenance', path: '/equipment-maintenance', Icon: Wrench },
      { id: 'lab-reagents', label: 'Reagent Changes', path: '/reagent-changes', Icon: Beaker },
      { id: 'lab-analyzer-logs', label: 'Analyzer Connectivity', path: '/lab-analyzer-logs', Icon: Wifi },
      { id: 'lab-logs', label: 'Lab Activity Log', path: '/lab-logs', Icon: FileClock },
    ],
  },
  {
    id: 'lab-setup', label: 'Lab Setup', Icon: Microscope, items: [
      { id: 'lab-test-management', label: 'Test Management', path: '/lab-test-management', Icon: Microscope },
      { id: 'machine-master', label: 'Machine Master', path: '/machine-master', Icon: Cpu },
      { id: 'parameter-code-names', label: 'Parameter Names', path: '/parameter-code-names', Icon: Hash },
      { id: 'device-keys', label: 'LIS-Agent Keys', path: '/device-keys', Icon: KeyRound },
      { id: 'report-signing', label: 'Report Signing', path: '/report-signing', Icon: FileSignature },
    ],
  },
  {
    id: 'inventory', label: 'Inventory', Icon: Boxes, items: [
      { id: 'inventory-dashboard', label: 'Inventory Dashboard', path: '/inventory', Icon: LayoutGrid },
      { id: 'inventory-overview', label: 'Overall Stock', path: '/inventory/overview', Icon: Layers },
      { id: 'inventory-stock', label: 'Item-wise Stock', path: '/inventory/stock', Icon: Package },
      { id: 'inventory-items', label: 'Item Master', path: '/inventory/items', Icon: Boxes },
      { id: 'inventory-mappings', label: 'Test Mappings', path: '/inventory/mappings', Icon: Link },
      { id: 'inventory-purchase', label: 'Purchase', path: '/inventory/purchase', Icon: ShoppingCart },
      { id: 'inventory-vendors', label: 'Vendors', path: '/inventory/vendors', Icon: Store },
      { id: 'inventory-ap', label: 'Accounts Payable', path: '/inventory/ap', Icon: Wallet },
      { id: 'inventory-transactions', label: 'Transactions', path: '/inventory/transactions', Icon: Repeat },
    ],
  },
  {
    id: 'staff-group', label: 'Human Resources', Icon: UserCog, items: [
      { id: 'staff', label: 'Employee Management', path: '/staff-management', Icon: UserCog },
      { id: 'duty', label: 'Duty Roster', path: '/duty-scheduler', Icon: CalendarClock },
      { id: 'attendance', label: 'Attendance', path: '/attendance', Icon: Fingerprint },
      { id: 'leave', label: 'Leave', path: '/leave', Icon: Plane },
      { id: 'payroll', label: 'Payroll & Payslips', path: '/payroll', Icon: BadgeIndianRupee },
    ],
  },
  {
    id: 'admin-group', label: 'Administration', Icon: Building2, items: [
      { id: 'org-management', label: 'Hospital Setup', path: '/org-management', Icon: Building2 },
      { id: 'patient-field-config', label: 'Patient Field Config', path: '/patient-field-config', Icon: SlidersHorizontal },
      { id: 'referring-clinicians', label: 'Referring Clinicians', path: '/referring-clinicians', Icon: Stethoscope },
      { id: 'settings', label: 'Settings', path: '/settings', Icon: Settings },
    ],
  },
  {
    id: 'governance', label: 'Monitoring & Audit', Icon: Shield, items: [
      { id: 'audit-trail', label: 'Audit Trail', path: '/audit-trail', Icon: Shield },
      { id: 'privilege-review', label: 'Privilege Review', path: '/privilege-review', Icon: ClipboardCheck },
      { id: 'data-export', label: 'Data Export', path: '/data-export', Icon: Download },
    ],
  },
];

// Laboratory-area pages (Laboratory, Quality & Equipment, Lab Setup) as the
// lab roles' allow-lists know them.
const LAB_IDS = new Set([
  'lab-worklist', 'lab-sample-list', 'sample-tracking', 'lab-verification', 'lab-critical', 'lab-reports',
  'report-delivery', 'lab-unmapped', 'queue-management', 'queue-audit', 'barcode-generator', 'prescription-scan', 'abha-dashboard',
  'quality-control', 'quality-dashboard', 'blood-bank', 'poct', 'equipment', 'lab-equipment', 'lab-reagents', 'lab-analyzer-logs', 'lab-logs', 'lab-test-management',
]);
const LAB_TECH_PAGES = ['quality-control', 'quality-dashboard', 'blood-bank', 'poct', 'equipment', 'report-delivery', 'lab-reagents', 'lab-equipment', 'lab-critical',
  'lab-verification', 'lab-worklist', 'queue-management', 'sample-tracking', 'lab-sample-list', 'lab-reports', 'lab-logs',
  'lab-analyzer-logs', 'lab-test-management', 'lab-unmapped'];
const LAB_DOCTOR_PAGES = ['lab-worklist', 'queue-management', 'sample-tracking', 'lab-sample-list', 'lab-reports', 'lab-logs',
  'lab-analyzer-logs', 'lab-test-management', 'lab-verification', 'lab-critical', 'lab-equipment', 'lab-reagents', 'lab-unmapped', 'abha-dashboard',
  'quality-control', 'quality-dashboard', 'blood-bank', 'poct', 'equipment', 'report-delivery'];

// Self-service pages every member of staff has, whatever their role.
const SELF_SERVICE = ['duty', 'attendance', 'leave', 'payroll'];

const OPEN_KEY = 'sidebar_open_sections';
const readOpen = () => { try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); return v && !Array.isArray(v) ? v : {}; } catch { return {}; } };

function Sidebar({ onPhoneLookup }) {
  const hospital = useHospital();
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const userRole = localStorage.getItem('role') || '';

  const loggedInUser = JSON.parse(localStorage.getItem('user') || '{}');
  const displayName = [loggedInUser.firstName, loggedInUser.lastName].filter(Boolean).join(' ') || 'User';
  const displayRole = loggedInUser.role || userRole || 'Staff';
  const avatarInitials = ((loggedInUser.firstName?.[0] || '') + (loggedInUser.lastName?.[0] || '')).toUpperCase() || 'U';

  const lowerRole = userRole.toLowerCase();
  const isAdmin = ['admin', 'super admin'].includes(lowerRole);
  const isLabTech = lowerRole === 'lab technician' || lowerRole === 'lab_tech';
  const isLabDoctor = lowerRole === 'lab doctor' || lowerRole === 'lab_doctor';
  const isLabHead = lowerRole === 'lab head';
  const isCollector = lowerRole === 'sample collector';
  const isAuditor = lowerRole === 'auditor';
  const isReceptionist = lowerRole === 'receptionist';
  const isDoctor = lowerRole === 'doctor';
  const isHrManager = lowerRole === 'hr manager';
  const isNurse = lowerRole === 'nurse' || lowerRole === 'nursing superintendent';
  const isPharmacist = lowerRole === 'pharmacist';
  const isAccounts = lowerRole === 'accounts manager';
  const isRadiographer = lowerRole === 'radiographer';

  // Who sees what — the same rules as before the regrouping (and in step with
  // the route guards in App.jsx and the API's role checks).
  const canSee = (item) => {
    const { id } = item;
    if (id === 'staff') return isAdmin || isHrManager;
    if (id === 'doctor-dashboard') return isDoctor;
    if (SELF_SERVICE.includes(id)) return true;
    if (isAccounts) return ['dashboard', 'billing-desk', 'billing', 'billing-approvals', 'cash-closing', 'billing-control', 'service-prices', 'online-payments', 'imaging-desk'].includes(id);
    if (isRadiographer) return id === 'imaging-desk';
    if (id === 'billing-control' && !isAdmin) return false;
    if (isHrManager) return ['dashboard', 'infra-board'].includes(id);
    if (isNurse) return ['dashboard', 'patients', 'patient-records', 'appointments', 'infra-board'].includes(id);
    if (isPharmacist) return id === 'dashboard' || id.startsWith('inventory');
    if (isCollector) return id === 'sample-collection';
    if (isAuditor) return ['quality-dashboard', 'blood-bank', 'poct', 'report-delivery', 'equipment', 'audit-trail', 'privilege-review', 'data-export', 'online-payments'].includes(id);
    if (['test-prices', 'payment-settings', 'report-signing', 'audit-trail', 'privilege-review', 'data-export', 'referring-clinicians'].includes(id) && !isAdmin) return false;
    if (id === 'sample-collection' && !isAdmin && !isLabHead) return false;
    // The receptionist reaches the queue log from Patients; others from Laboratory.
    if (id === 'queue-log-reception') return isReceptionist;
    if (isLabTech) return LAB_TECH_PAGES.includes(id);
    if (isLabDoctor) return LAB_DOCTOR_PAGES.includes(id);
    if (isLabHead) return LAB_DOCTOR_PAGES.includes(id) || ['queue-audit', 'sample-collection'].includes(id);
    if (isReceptionist) return !LAB_IDS.has(id);
    if (isDoctor) return ['doctor-dashboard', 'patient-records', 'appointments', 'imaging-desk'].includes(id);
    return true;
  };

  const q = query.trim().toLowerCase();
  const sections = useMemo(() => SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((i) => canSee(i) && (!q || i.label.toLowerCase().includes(q) || (s.label || '').toLowerCase().includes(q))) }))
    .filter((s) => s.items.length > 0),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [q, userRole]);

  const visibleCount = sections.reduce((n, s) => n + s.items.length, 0);
  const activeSection = sections.find((s) => s.items.some((i) => i.path === location.pathname))?.id;

  // Open/closed per section, remembered between visits. A section never
  // opened or closed by hand is open when it holds the current page.
  const [openState, setOpenState] = useState(readOpen);
  const isSectionOpen = (id) => openState[id] ?? id === activeSection;
  useEffect(() => { try { localStorage.setItem(OPEN_KEY, JSON.stringify(openState)); } catch { /* storage unavailable */ } }, [openState]);
  const toggle = (id) => setOpenState((o) => ({ ...o, [id]: !(o[id] ?? id === activeSection) }));
  const openSection = (id) => setOpenState((o) => ({ ...o, [id]: true }));

  // Few pages (lab roles, auditors…) → show them flat, without section headers.
  const flat = visibleCount <= 12 && !q;

  const handleLogout = () => {
    clearStaffSession();
    navigate('/', { replace: true });
  };

  const link = (item) => (
    <NavLink key={item.id} to={item.path} title={collapsed ? item.label : undefined}
      className={({ isActive }) => `nav-item nav-leaf${isActive ? ' active' : ''}`}>
      <span className="nav-icon"><item.Icon size={17} strokeWidth={1.9} /></span>
      <span className="nav-text">{item.label}</span>
    </NavLink>
  );

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Header */}
      <div className="sidebar-header">
        <div className="sidebar-logo-container" style={{ background: 'none' }}>
          {hospital.logo_url
            ? <img src={hospital.logo_url} alt="" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
            : <Hospital size={26} color="#60a5fa" />}
        </div>
        <span className="sidebar-brand" title={hospital.hospital_name}
          style={{ whiteSpace: 'normal', lineHeight: 1.2, fontSize: (hospital.hospital_name || '').length > 18 ? 12 : undefined, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {hospital.hospital_name || 'HMIS'}
        </span>
        <div className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points={collapsed ? '9 18 15 12 9 6' : '15 18 9 12 15 6'} />
          </svg>
        </div>
      </div>

      {/* Find a page */}
      {!collapsed && visibleCount > 12 && (
        <div className="nav-search">
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a page…" aria-label="Find a page" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear"><X size={13} /></button>}
        </div>
      )}

      {/* Navigation */}
      <nav className="sidebar-nav">
        {sections.length === 0 && <div className="nav-empty">No page matches “{query}”.</div>}
        {sections.map((section) => {
          if (!section.label || flat) {
            return <div key={section.id} className="nav-flat">{section.items.map(link)}</div>;
          }
          const isOpen = !!q || isSectionOpen(section.id);
          const hasActive = section.id === activeSection;
          if (collapsed) {
            // Icon rail: the section icon opens the sidebar on that section.
            return (
              <button key={section.id} type="button" title={section.label}
                className={`nav-item nav-section-rail${hasActive ? ' active' : ''}`}
                onClick={() => { setCollapsed(false); openSection(section.id); }}>
                <span className="nav-icon"><section.Icon size={18} strokeWidth={1.9} /></span>
              </button>
            );
          }
          return (
            <div key={section.id} className={`nav-section${hasActive ? ' has-active' : ''}`}>
              <button type="button" className="nav-section-head" onClick={() => toggle(section.id)} aria-expanded={isOpen}>
                <section.Icon size={15} strokeWidth={2} />
                <span>{section.label}</span>
                <em>{section.items.length}</em>
                <ChevronDown size={14} className={`nav-chevron${isOpen ? ' open' : ''}`} />
              </button>
              {isOpen && <div className="nav-section-items">{section.items.map(link)}</div>}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="user-profile">
          <div className="user-avatar">{avatarInitials}</div>
          <div className="user-info">
            <span className="user-name">{displayName}</span>
            <span className="user-role">{displayRole}</span>
          </div>
        </div>
        <button className="logout-btn" onClick={onPhoneLookup} title="Phone Patient Lookup" style={{ marginBottom: 4 }}>
          <div className="nav-icon"><Phone size={17} /></div>
          <span className="nav-text">Phone Lookup</span>
        </button>
        <button className="logout-btn" onClick={handleLogout}>
          <div className="nav-icon"><LogOut size={17} /></div>
          <span className="nav-text">Sign Out</span>
        </button>
      </div>
    </div>
  );
}

export default Sidebar;
