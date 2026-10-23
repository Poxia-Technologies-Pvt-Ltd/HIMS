// The sign-in screens on the start page and the roles each accepts. The
// server enforces the same mapping (HIMS-backend/utils/rolePortals.js).
export const ROLE_PORTALS = [
  { id: 'reception', label: 'Reception', hint: 'Registration, OP appointments, billing', roles: ['Receptionist'], color: '#0ea5e9' },
  { id: 'doctor', label: 'Doctor', hint: 'Consultations and patient records', roles: ['Doctor'], color: '#10b981' },
  { id: 'nurse', label: 'Nursing', hint: 'Wards, beds and patient care', roles: ['Nurse', 'Nursing Superintendent'], color: '#ec4899' },
  { id: 'lab', label: 'Laboratory', hint: 'Samples, results and reports', roles: ['Lab Technician', 'Lab Doctor', 'Lab Head', 'Sample Collector'], color: '#8b5cf6' },
  { id: 'imaging', label: 'X-ray & Scans', hint: 'X-ray, ultrasound, CT and ECG orders', roles: ['Radiographer'], color: '#0891b2' },
  { id: 'pharmacy', label: 'Pharmacy', hint: 'Medicines and stock', roles: ['Pharmacist'], color: '#f59e0b' },
  { id: 'accounts', label: 'Accounts', hint: 'Approvals, cash closing and billing control', roles: ['Accounts Manager'], color: '#059669' },
  { id: 'hr', label: 'HR', hint: 'Staff, roster, leave and payroll', roles: ['HR Manager'], color: '#6366f1' },
  { id: 'admin', label: 'Administration', hint: 'Hospital setup and management', roles: ['Admin', 'Super Admin', 'Medical Superintendent', 'Auditor'], color: '#1a6fd4' },
];

export const portalById = (id) => ROLE_PORTALS.find((p) => p.id === id);

// Where each role lands after signing in.
const HOME = {
  doctor: '/doctor-dashboard',
  'sample collector': '/sample-collection',
  'lab technician': '/lab-worklist', 'lab doctor': '/lab-worklist', 'lab head': '/lab-worklist',
  receptionist: '/appointments',
  'accounts manager': '/billing-control',
  radiographer: '/imaging-desk',
  nurse: '/hospital-infra', 'nursing superintendent': '/hospital-infra',
  'hr manager': '/staff-management',
  pharmacist: '/inventory/stock',
};
export const homeFor = (role) => HOME[String(role || '').toLowerCase()] || '/dashboard';
