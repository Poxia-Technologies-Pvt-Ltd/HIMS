import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import DeveloperLogin from './pages/Developer/DeveloperLogin';
import DeveloperPanel from './pages/Developer/DeveloperPanel';
import Login from './pages/Login';
import PatientRegistration from './pages/Patients/PatientRegistration';
import StaffManagement from './pages/Staff/StaffManagement';
import HospitalInfra from './pages/Settings/HospitalInfra';
import DutyScheduler from './pages/Staff/DutyScheduler';
import DoctorDashboard from './pages/Doctor/DoctorDashboard';
import DoctorPatientSearch from './pages/Doctor/DoctorPatientSearch';
import BillingPackages from './pages/Billing/BillingPackages';
import LabTestManagement from './pages/Lab/LabTestManagement';
import LabWorklist from './pages/Lab/LabWorklist';
import SampleList from './pages/Lab/SampleList';
import LabVerification from './pages/Lab/LabVerification';
import LabReportDownload from './pages/Lab/LabReportDownload';
import LabActivityLogs from './pages/Lab/LabActivityLogs';
import LabAnalyzerLogs from './pages/Lab/LabAnalyzerLogs';
import UnmappedResults from './pages/Lab/UnmappedResults';
import AbhaDashboard from './pages/Lab/AbhaDashboard';
import InventoryDashboard from './pages/Inventory/InventoryDashboard';
import Billings from './pages/Billing/Billings';
import PatientLogin from './pages/Patients/PatientLogin';
import PatientUpload from './pages/Public/PatientUpload';
import LabTVMode from './pages/Lab/LabTVMode';
import LabTrack from './pages/Lab/LabTrack';
import PatientProfile from './pages/Patients/PatientProfile';
import PatientReports from './pages/Patients/PatientReports';
import InventoryItemMaster from './pages/Inventory/InventoryItemMaster';
import InventoryVendors from './pages/Inventory/InventoryVendors';
import VendorManagement from './pages/Inventory/VendorManagement';
import PurchaseManagement from './pages/Inventory/PurchaseManagement';
import InventoryStockManagement from './pages/Inventory/InventoryStockManagement';
import InventoryTransactions from './pages/Inventory/InventoryTransactions';
import InventoryTestMapping from './pages/Inventory/InventoryTestMapping';
import InventoryNetworkDashboard from './pages/Inventory/InventoryNetworkDashboard';
import InventoryOverview from './pages/Inventory/InventoryOverview';
import InventoryTransfers from './pages/Inventory/InventoryTransfers';
import PurchasePayments from './pages/Inventory/PurchasePayments';
import BillingOverview from './pages/Billing/BillingOverview';
import Settings from './pages/Settings/Settings';
import Hospitals from './pages/Settings/Hospitals';
import Dashboard from './pages/Dashboard';
import DisasterDashboard from './pages/DisasterDashboard';
import MachineNetwork from './pages/Settings/MachineNetwork';
import Layout from './components/Layout';
import PatientLayout from './components/PatientLayout';
import BarcodeGenerator from './pages/Prescriptions/BarcodeGenerator';
import PrescriptionScan from './pages/Prescriptions/PrescriptionScan';
import OrgManagement from './pages/Settings/OrgManagement';
import CdacMapping from './pages/Settings/CdacMapping';
import ParameterCodeNames from './pages/Settings/ParameterCodeNames';
import DeviceKeys from './pages/Settings/DeviceKeys';
import MachineMaster from './pages/Settings/MachineMaster';
import PatientFieldConfig from './pages/Settings/PatientFieldConfig';
import ChangePassword from './pages/ChangePassword';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import { hasStaffToken } from './utils/session';

// Redirects to login if no session is present; forces a password change
// first if the account was flagged for one (VAPT #16) — everything else in
// the app is unreachable until that's cleared. This is a UI convenience
// only (VAPT #9: the real token is an HttpOnly cookie, not readable here) —
// the actual access control is enforced server-side on every request.
function RequireAuth() {
  const location = useLocation();
  if (!hasStaffToken()) return <Navigate to="/" replace />;
  if (localStorage.getItem('password_change_required') === '1' && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

// Restricts a route to Doctor role only; other roles go to /dashboard
function RequireDoctor() {
  if (!hasStaffToken()) return <Navigate to="/" replace />;
  return localStorage.getItem('role') === 'Doctor' ? <Outlet /> : <Navigate to="/dashboard" replace />;
}

// Redirects Doctors away from admin dashboard to their own console
function DashboardGate() {
  return localStorage.getItem('role') === 'Doctor'
    ? <Navigate to="/doctor-dashboard" replace />
    : <Dashboard />;
}

// Confines Lab Technician / Lab Doctor to their exact approved pages,
// closing the gap where a hidden sidebar link could still be reached by typing the URL
const LAB_TECHNICIAN_PATHS = ['/lab-worklist', '/lab-sample-list', '/lab-reports', '/lab-logs', '/lab-analyzer-logs', '/lab-test-management'];
const LAB_DOCTOR_PATHS = [...LAB_TECHNICIAN_PATHS, '/lab-verification', '/duty-scheduler'];
const LAB_HEAD_PATHS = [...LAB_DOCTOR_PATHS, '/staff-management'];

function RequireLabAccess() {
  const role = (localStorage.getItem('role') || '').toLowerCase();
  const location = useLocation();

  let allowed = null;
  if (role === 'lab technician' || role === 'lab_tech') allowed = LAB_TECHNICIAN_PATHS;
  else if (role === 'lab doctor' || role === 'lab_doctor') allowed = LAB_DOCTOR_PATHS;
  else if (role === 'lab head') allowed = LAB_HEAD_PATHS;

  if (allowed && !allowed.includes(location.pathname)) {
    return <Navigate to={allowed[0]} replace />;
  }
  return <Outlet />;
}

// Staff Management: Admin / Super Admin / Lab Head only (mirrors Sidebar.jsx's
// universal "only admin and lab head" rule for the 'staff' nav item — previously
// enforced only by hiding the link, not by the route itself).
function RequireStaffAccess() {
  const role = (localStorage.getItem('role') || '').toLowerCase();
  return ['admin', 'super admin', 'lab head'].includes(role)
    ? <Outlet />
    : <Navigate to="/dashboard" replace />;
}

// Central/org-tier admin pages a Doctor shouldn't reach (per Sidebar.jsx's own
// doctorAllowed allowlist, which excludes all of these) — previously enforced
// only by hiding the links, not by the routes themselves.
const CENTRAL_ADMIN_PATHS = ['/hospitals', '/org-management', '/machine-network', '/hospital-infra'];
function RequireNonDoctorArea() {
  const role = (localStorage.getItem('role') || '').toLowerCase();
  const location = useLocation();
  if (role === 'doctor' && CENTRAL_ADMIN_PATHS.includes(location.pathname)) {
    return <Navigate to="/doctor-dashboard" replace />;
  }
  return <Outlet />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Developer Portal — standalone, no shared layout */}
        <Route path="/developer"        element={<DeveloperLogin />} />
        <Route path="/developer/panel"  element={<DeveloperPanel />} />

        {/* Auth Routes */}
        <Route path="/" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/patient-login" element={<PatientLogin />} />

        {/* Public App Routes */}
        <Route path="/patient-upload" element={<PatientUpload />} />
        <Route path="/lab-tv" element={<LabTVMode />} />
        <Route path="/track" element={<LabTrack />} />
        <Route path="/track/:referenceId" element={<LabTrack />} />
        <Route path="/disaster-dashboard" element={<DisasterDashboard />} />
        
        {/* All layout routes require a valid token */}
        <Route element={<RequireAuth />}>
        {/* Outside RequireLabAccess/Layout so a forced password change isn't
            blocked by a role's route allowlist or hidden behind the sidebar chrome */}
        <Route path="/change-password" element={<ChangePassword />} />
        <Route element={<RequireLabAccess />}>
        <Route element={<RequireNonDoctorArea />}>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<DashboardGate />} />

          {/* Doctor-only routes */}
          <Route element={<RequireDoctor />}>
            <Route path="/doctor-dashboard" element={<DoctorDashboard />} />
            <Route path="/doctor-patients" element={<DoctorPatientSearch />} />
          </Route>
          <Route path="/patient-registration" element={<PatientRegistration />} />
          <Route element={<RequireStaffAccess />}>
            <Route path="/staff-management" element={<StaffManagement />} />
          </Route>
          <Route path="/hospital-infra" element={<HospitalInfra />} />
          <Route path="/duty-scheduler" element={<DutyScheduler />} />
          <Route path="/billing-packages" element={<BillingPackages />} />
          <Route path="/billing-overview" element={<BillingOverview />} />
          <Route path="/lab-test-management" element={<LabTestManagement />} />
          <Route path="/lab-worklist" element={<LabWorklist />} />
          <Route path="/lab-sample-list" element={<SampleList />} />
          <Route path="/lab-verification" element={<LabVerification />} />
          <Route path="/lab-reports" element={<LabReportDownload />} />
          <Route path="/lab-logs" element={<LabActivityLogs />} />
          <Route path="/lab-analyzer-logs" element={<LabAnalyzerLogs />} />
          <Route path="/lab-unmapped" element={<UnmappedResults />} />
          <Route path="/abha-dashboard" element={<AbhaDashboard />} />
          <Route path="/inventory/dashboard" element={<InventoryDashboard />} />
          <Route path="/inventory" element={<InventoryNetworkDashboard />} />
          <Route path="/inventory/overview" element={<InventoryOverview />} />
          <Route path="/inventory/items" element={<InventoryItemMaster />} />
          <Route path="/inventory/vendors" element={<InventoryVendors />} />
          <Route path="/inventory/ap" element={<PurchasePayments />} />
          <Route path="/inventory/purchase" element={<PurchaseManagement />} />
          <Route path="/inventory/stock" element={<InventoryStockManagement />} />
          <Route path="/inventory/transactions" element={<InventoryTransactions />} />
          <Route path="/inventory/transfers" element={<InventoryTransfers />} />
          <Route path="/inventory/mappings" element={<InventoryTestMapping />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/hospitals" element={<Hospitals />} />
          <Route path="/machine-network" element={<MachineNetwork />} />
          <Route path="/barcode-generator" element={<BarcodeGenerator />} />
          <Route path="/prescription-scan" element={<PrescriptionScan />} />
          <Route path="/org-management" element={<OrgManagement />} />
          <Route path="/cdac-mapping" element={<CdacMapping />} />
          <Route path="/parameter-code-names" element={<ParameterCodeNames />} />
          <Route path="/device-keys" element={<DeviceKeys />} />
          <Route path="/machine-master" element={<MachineMaster />} />
          <Route path="/patient-field-config" element={<PatientFieldConfig />} />
        </Route>
        </Route> {/* end RequireNonDoctorArea */}
        </Route> {/* end RequireLabAccess */}
        </Route> {/* end RequireAuth */}

        {/* Patient Portal Routes */}
        <Route element={<PatientLayout />}>
          <Route path="/patient-portal/profile" element={<PatientProfile />} />
          <Route path="/patient-portal/reports" element={<PatientReports />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
