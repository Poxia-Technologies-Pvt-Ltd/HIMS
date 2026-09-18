import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import merilLogo from '../assets/meril.png';
import '../assets/CSS/Sidebar.css';
import { clearStaffSession } from '../utils/session';

const LOGO_SRC = '/meril_hims_logo.png';

const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    path: '/dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
      </svg>
    )
  },
  {
    id: 'doctor-dashboard',
    label: 'Doctor Console',
    path: '/doctor-dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/>
        <path d="M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4"/>
        <circle cx="20" cy="10" r="2"/>
      </svg>
    )
  },
  {
    id: 'hospitals',
    label: 'Hospital Network',
    path: '/hospitals',
    roles: ['Central', 'Sub-Central', 'Branch'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 21h18M3 7v14M21 7v14M6 21V5a2 2 0 012-2h8a2 2 0 012 2v16M9 9h6M9 13h6M9 17h6" />
      </svg>
    )
  },
  {
    id: 'org-management',
    label: 'Org Management',
    path: '/org-management',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
        <circle cx="12" cy="5" r="1" fill="currentColor" />
        <path d="M5 9v0M19 9v0" />
      </svg>
    )
  },
  {
    id: 'machine-network',
    label: 'Machine Network',
    path: '/machine-network',
    roles: ['Central'], // typically Admin/Central
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
        <path d="M22 10H2" />
        <path d="M12 10v4" />
        <path d="M8 10v4" />
        <path d="M16 10v4" />
      </svg>
    )
  },
  {
    id: 'cdac-mapping',
    label: 'CDAC Mapping',
    path: '/cdac-mapping',
    roles: ['Central', 'Sub-Central'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
        <path d="M9 12h6M12 9v6" />
      </svg>
    )
  },
  {
    id: 'parameter-code-names',
    label: 'Parameter Names',
    path: '/parameter-code-names',
    roles: ['Central', 'Sub-Central'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" />
      </svg>
    )
  },
  {
    id: 'machine-master',
    label: 'Machine Master',
    path: '/machine-master',
    roles: ['Central', 'Sub-Central'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9h6v6H9z" /><path d="M4 9h2M4 15h2M18 9h2M18 15h2M9 4v2M15 4v2M9 18v2M15 18v2" />
      </svg>
    )
  },
  {
    id: 'patient-field-config',
    label: 'Patient Field Config',
    path: '/patient-field-config',
    roles: ['Central', 'Sub-Central'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
        <path d="M18 8l2 2 3-3" />
      </svg>
    )
  },
  {
    id: 'device-keys',
    label: 'LIS-Agent Keys',
    path: '/device-keys',
    roles: ['Central', 'Sub-Central'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
      </svg>
    )
  },
  {
    id: 'patients',
    label: 'Registration',
    path: '/patient-registration',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="8.5" cy="7" r="4" /><path d="M20 8v6M23 11h-6" />
      </svg>
    )
  },
  {
    id: 'patient-records',
    label: 'Patient Records',
    path: '/doctor-patients',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 11H4a2 2 0 00-2 2v7a2 2 0 002 2h16a2 2 0 002-2v-7a2 2 0 00-2-2h-5" /><path d="M9 7l3-3 3 3" /><path d="M12 4v8" /><rect x="6" y="14" width="12" height="4" rx="1" />
      </svg>
    )
  },

  {
    id: 'staff',
    label: 'Employee Management',
    path: '/staff-management',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    )
  },
  {
    id: 'duty',
    label: 'Duty Roster',
    path: '/duty-scheduler',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
    )
  },
  {
    id: 'billing',
    label: 'Billing & Payments',
    path: '/billing-overview',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </svg>
    )
  },
  {
    id: 'billing-packages',
    label: 'Billing Packages',
    path: '/billing-packages',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="15" x2="15" y2="15" />
      </svg>
    )
  },

  {
    id: 'laboratory',
    label: 'Laboratory',
    path: '/lab-worklist',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M19.8 18.4L14 10.67V6.75l1.35-1.35c.18-.18.28-.43.28-.69V2.25c0-.41-.34-.75-.75-.75h-6c-.41 0-.75.34-.75.75v2.46c0 .26.1.51.28.69L10 6.75v3.92L4.2 18.4c-.77 1.16-.13 2.73 1.3 2.73h13c1.43 0 2.07-1.57 1.3-2.73z" />
        <path d="M10 15v2h4v-2" strokeLinecap="round" />
      </svg>
    ),
    children: [
      {
        id: 'lab-worklist',
        label: 'Worklist',
        path: '/lab-worklist',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            <path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" />
            <line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="15" y2="16" />
          </svg>
        )
      },
      {
        id: 'lab-sample-list',
        label: 'Sample List',
        path: '/lab-sample-list',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 2v6.5L4.5 17a3 3 0 0 0 2.6 4.5h9.8a3 3 0 0 0 2.6-4.5L15 8.5V2" />
            <path d="M8 2h8" /><path d="M8.5 13h7" />
          </svg>
        )
      },
      {
        id: 'lab-verification',
        label: 'Verification',
        path: '/lab-verification',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><polyline points="8 12 11 15 16 9" />
          </svg>
        )
      },
      {
        id: 'lab-reports',
        label: 'Reports',
        path: '/lab-reports',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="15" y2="17" />
          </svg>
        )
      },
      {
        id: 'lab-test-management',
        label: 'Test Management',
        path: '/lab-test-management',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
          </svg>
        )
      },
      {
        id: 'lab-logs',
        label: 'Audit Logs',
        path: '/lab-logs',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" />
          </svg>
        )
      },
      {
        id: 'abha-dashboard',
        label: 'ABHA Dashboard',
        path: '/abha-dashboard',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        )
      },
      {
        id: 'lab-unmapped',
        label: 'Unmatched Results',
        path: '/lab-unmapped',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
        )
      },
      {
        id: 'lab-analyzer-logs',
        label: 'Analyzer Connectivity',
        path: '/lab-analyzer-logs',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12.55a11 11 0 0 1 14.08 0" />
            <path d="M1.42 9a16 16 0 0 1 21.16 0" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        )
      },
      {
        id: 'barcode-generator',
        label: 'Barcode Generator',
        path: '/barcode-generator',
      },
      {
        id: 'prescription-scan',
        label: 'Prescription Scan',
        path: '/prescription-scan',
      },
    ]
  },
  {
    id: 'inventory',
    label: 'Inventory',
    path: '/inventory',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
    children: [
      { id: 'inventory-dashboard', label: 'Network Dashboard', path: '/inventory' },
      { id: 'inventory-overview', label: 'Overall Stock', path: '/inventory/overview' },
      { id: 'inventory-items', label: 'Master', path: '/inventory/items' },
      { id: 'inventory-vendors', label: 'Vendors', path: '/inventory/vendors' },
      { id: 'inventory-ap', label: 'Accounts Payable', path: '/inventory/ap' },
      { id: 'inventory-purchase', label: 'Purchase', path: '/inventory/purchase' },
      { id: 'inventory-stock', label: 'Item Wise Stock', path: '/inventory/stock' },
      { id: 'inventory-transfers', label: 'Transfers', path: '/inventory/transfers' },
      { id: 'inventory-transactions', label: 'Transactions', path: '/inventory/transactions' },
      { id: 'inventory-mappings', label: 'Test Mappings', path: '/inventory/mappings' },
    ]
  },
  {
    id: 'infra',
    label: 'Hospital Infrastructure',
    path: '/hospital-infra',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 21h18M3 7V5a2 2 0 012-2h14a2 2 0 012 2v2M3 7h18M3 7v14M21 7v14M9 3v4M15 3v4M9 21V11M15 21V11M3 11h18" />
      </svg>
    )
  },
  {
    id: 'disaster-dashboard',
    label: 'Disease Heatmap',
    path: '/disaster-dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /><path d="M21 5c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M12 12v10" strokeDasharray="3 3" /><circle cx="12" cy="12" r="3" fill="#ef4444" fillOpacity="0.3" stroke="#ef4444" />
      </svg>
    )
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    )
  },
];

function Sidebar({ onPhoneLookup }) {
  const [collapsed, setCollapsed] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const userRoleLevel = localStorage.getItem('role_level') || 'Branch';
  const userRole = localStorage.getItem('role') || ''; // e.g., 'Lab Technician', 'Lab Doctor', 'Receptionist'

  const loggedInUser = JSON.parse(localStorage.getItem('user') || '{}');
  const displayName = [loggedInUser.firstName, loggedInUser.lastName].filter(Boolean).join(' ') || 'User';
  const displayRole = loggedInUser.role || userRole || 'Staff';
  const avatarInitials = ((loggedInUser.firstName?.[0] || '') + (loggedInUser.lastName?.[0] || '')).toUpperCase() || 'U';

  const lowerRole = userRole.toLowerCase();
  const isLabTech = lowerRole === 'lab technician' || lowerRole === 'lab_tech';
  const isLabDoctor = lowerRole === 'lab doctor' || lowerRole === 'lab_doctor';
  const isLabHead = lowerRole === 'lab head';

  const filteredNavItems = NAV_ITEMS.filter(item => {
    // Basic role level filtering
    if (item.roles && !item.roles.includes(userRoleLevel)) return false;

    // Lab Technician: only the Laboratory section, nothing else (no Dashboard/Settings)
    if (isLabTech) {
      if (item.id !== 'laboratory') return false;
    }

    // Lab Doctor: Laboratory section + Duty Roster, nothing else
    if (isLabDoctor) {
      if (!['laboratory', 'duty'].includes(item.id)) return false;
    }

    // Lab Head: Laboratory section + Duty Roster + Employee Management, nothing else
    if (isLabHead) {
      if (!['laboratory', 'duty', 'staff'].includes(item.id)) return false;
    }

    // Receptionist logic: remove Laboratory and Duty Roster
    if (lowerRole === 'receptionist') {
      if (item.id === 'laboratory' || item.id === 'duty') return false;
    }

    // Doctor logic: only show doctor-relevant modules
    const isDoctor = lowerRole === 'doctor';
    if (isDoctor) {
      const doctorAllowed = ['doctor-dashboard', 'patients', 'patient-records', 'billing', 'settings'];
      if (!doctorAllowed.includes(item.id)) return false;
    }

    // Staff Management logic: Only Admin and Lab Head
    if (item.id === 'staff') {
      if (!['admin', 'lab head'].includes(lowerRole)) return false;
    }

    return true;
  }).map(item => {
    if (item.id !== 'laboratory') return item;

    // Lab Technician: only their 6 approved Laboratory features
    if (isLabTech) {
      return {
        ...item,
        children: item.children.filter(child =>
          ['lab-worklist', 'lab-sample-list', 'lab-reports', 'lab-logs', 'lab-analyzer-logs', 'lab-test-management', 'lab-unmapped', 'abha-dashboard'].includes(child.id)
        )
      };
    }

    // Lab Doctor / Lab Head: the same 6 plus Verification
    if (isLabDoctor || isLabHead) {
      return {
        ...item,
        children: item.children.filter(child =>
          ['lab-worklist', 'lab-sample-list', 'lab-reports', 'lab-logs', 'lab-analyzer-logs', 'lab-test-management', 'lab-verification', 'lab-unmapped', 'abha-dashboard'].includes(child.id)
        )
      };
    }

    return item;
  });

  // Lab Technician / Lab Doctor / Lab Head: their menu is basically just Laboratory,
  // so skip the dropdown and show each approved feature as a direct top-level link.
  const navItems = (isLabTech || isLabDoctor || isLabHead)
    ? filteredNavItems.flatMap(item =>
        item.id === 'laboratory'
          ? item.children.map(child => ({ id: child.id, label: child.label, path: child.path, icon: child.icon || item.icon }))
          : [item]
      )
    : filteredNavItems;

  const handleLogout = () => {
    clearStaffSession();
    navigate('/', { replace: true });
  };

  const toggleDropdown = (id) => {
    setOpenDropdown(openDropdown === id ? null : id);
  };

  const isChildActive = (children) => {
    return children?.some(child => location.pathname === child.path);
  };

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Header */}
      <div className="sidebar-header">
        <div className="sidebar-logo-container" style={{ background: 'none' }}>
          <img src={merilLogo} alt="Meril Logo" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
        </div>
        <span className="sidebar-brand">MERIL LIS</span>

        {/* Toggle Hook */}
        <div className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const hasChildren = item.children && item.children.length > 0;
          const isDropdownOpen = openDropdown === item.id;
          const isActiveParent = hasChildren && isChildActive(item.children);

          if (hasChildren) {
            return (
              <div key={item.id} className="nav-dropdown">
                <button
                  className={`nav-item ${isActiveParent ? 'active' : ''}`}
                  onClick={() => toggleDropdown(item.id)}
                  title={collapsed ? item.label : ''}
                >
                  <div className="nav-icon">{item.icon}</div>
                  <span className="nav-text">{item.label}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`dropdown-arrow ${isDropdownOpen ? 'open' : ''}`}
                    style={{ marginLeft: 'auto', transition: 'transform 0.2s' }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {!collapsed && isDropdownOpen && (
                  <div className="nav-submenu">
                    {item.children.map((child) => (
                      <NavLink
                        key={child.id}
                        to={child.path}
                        className={({ isActive }) => `nav-subitem ${isActive ? 'active' : ''}`}
                      >
                        {child.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <NavLink
              key={item.id}
              to={item.path}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              title={collapsed ? item.label : ''}
            >
              <div className="nav-icon">{item.icon}</div>
              <span className="nav-text">{item.label}</span>
            </NavLink>
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

        <button className="logout-btn" onClick={onPhoneLookup} title="Phone Patient Lookup" style={{marginBottom:4}}>
          <div className="nav-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.01 1.18 2 2 0 012 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14v2.92z" />
            </svg>
          </div>
          <span className="nav-text">Phone Lookup</span>
        </button>

        <button className="logout-btn" onClick={handleLogout}>
          <div className="nav-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </div>
          <span className="nav-text">Sign Out</span>
        </button>
      </div>
    </div>
  );
}

export default Sidebar;
