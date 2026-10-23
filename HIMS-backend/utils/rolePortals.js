import { normalizeRole } from '../middleware/auth.js';

// The sign-in screens offered on the HMIS start page, and the roles each one
// accepts. A login from the Receptionist screen only succeeds for a
// receptionist account, and so on. Mirrors HIMS-frontend/src/utils/rolePortals.js.
export const ROLE_PORTALS = {
  reception: { label: 'Reception', roles: ['Receptionist'] },
  doctor: { label: 'Doctor', roles: ['Doctor'] },
  nurse: { label: 'Nursing', roles: ['Nurse', 'Nursing Superintendent'] },
  lab: { label: 'Laboratory', roles: ['Lab Technician', 'Lab Doctor', 'Lab Head', 'Sample Collector'] },
  imaging: { label: 'X-ray & Scans', roles: ['Radiographer'] },
  pharmacy: { label: 'Pharmacy', roles: ['Pharmacist'] },
  accounts: { label: 'Accounts', roles: ['Accounts Manager'] },
  hr: { label: 'HR', roles: ['HR Manager'] },
  admin: { label: 'Administration', roles: ['Admin', 'Super Admin', 'Medical Superintendent', 'Auditor'] },
};

export const portalAccepts = (portal, role) => {
  const p = ROLE_PORTALS[portal];
  return !!p && p.roles.includes(normalizeRole(role || ''));
};
