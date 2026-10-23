import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import DeveloperLogin from './pages/Developer/DeveloperLogin';
import DeveloperPanel from './pages/Developer/DeveloperPanel';
import Login from './pages/Login';
import RolePicker from './pages/RolePicker';
import PatientRegistration from './pages/Patients/PatientRegistration';
import EmployeeManagement from './pages/HR/EmployeeManagement';
import RoomManagement from './pages/HR/RoomManagement';
import DutyRoster from './pages/HR/DutyRoster';
import LeaveManagement from './pages/HR/LeaveManagement';
import Attendance from './pages/HR/Attendance';
import Payroll from './pages/HR/Payroll';
import OpAppointments from './pages/OPD/OpAppointments';
import PatientAppointments from './pages/Patients/PatientAppointments';
import DoctorDashboard from './pages/Doctor/DoctorDashboard';
import DoctorPatientSearch from './pages/Doctor/DoctorPatientSearch';
import BillingPackages from './pages/Billing/BillingPackages';
import LabTestManagement from './pages/Lab/LabTestManagement';
import LabWorklist from './pages/Lab/LabWorklist';
import QueueManagement from './pages/Queue/QueueManagement';
import QueueAudit from './pages/Queue/QueueAudit';
import SampleTracking from './pages/Lab/SampleTracking';
import CriticalAlerts from './pages/Lab/CriticalAlerts';
import EquipmentMaintenance from './pages/Lab/EquipmentMaintenance';
import ReagentChanges from './pages/Lab/ReagentChanges';
import VerifyReport from './pages/VerifyReport';
import SampleCollection from './pages/Lab/SampleCollection';
import SampleList from './pages/Lab/SampleList';
import LabVerification from './pages/Lab/LabVerification';
import LabReportDownload from './pages/Lab/LabReportDownload';
import LabActivityLogs from './pages/Lab/LabActivityLogs';
import LabAnalyzerLogs from './pages/Lab/LabAnalyzerLogs';
import UnmappedResults from './pages/Lab/UnmappedResults';
import InventoryDashboard from './pages/Inventory/InventoryDashboard';
import Billings from './pages/Billing/Billings';
import PatientLogin from './pages/Patients/PatientLogin';
import ClinicianPortal from './pages/Patients/ClinicianPortal';
import FieldApp from './pages/Field/FieldApp';
import ReferringClinicians from './pages/Admin/ReferringClinicians';
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
import PurchasePayments from './pages/Inventory/PurchasePayments';
import BillingOverview from './pages/Billing/BillingOverview';
import BillingDesk from './pages/Billing/BillingDesk';
import BillingApprovals from './pages/Billing/BillingApprovals';
import CashClosing from './pages/Billing/CashClosing';
import BillingControl from './pages/Billing/BillingControl';
import ServicePrices from './pages/Billing/ServicePrices';
import ImagingDesk from './pages/Imaging/ImagingDesk';
import Settings from './pages/Settings/Settings';
import Dashboard from './pages/Dashboard';
import Layout from './components/Layout';
import PatientLayout from './components/PatientLayout';
import BarcodeGenerator from './pages/Prescriptions/BarcodeGenerator';
import PrescriptionScan from './pages/Prescriptions/PrescriptionScan';
import OrgManagement from './pages/Settings/OrgManagement';
import ParameterCodeNames from './pages/Settings/ParameterCodeNames';
import DeviceKeys from './pages/Settings/DeviceKeys';
import MachineMaster from './pages/Settings/MachineMaster';
import PatientFieldConfig from './pages/Settings/PatientFieldConfig';
import ChangePassword from './pages/ChangePassword';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import QualityControl from './pages/Quality/QualityControl';
import QualityDashboard from './pages/Quality/QualityDashboard';
import BloodBank from './pages/Lab/BloodBank';
import Poct from './pages/Lab/Poct';
import ReportDelivery from './pages/Lab/ReportDelivery';
import EquipmentManagement from './pages/Equipment/EquipmentManagement';
import AuditTrail from './pages/Admin/AuditTrail';
import PrivilegeReview from './pages/Admin/PrivilegeReview';
import DataExport from './pages/Admin/DataExport';
import PaymentReconciliation from './pages/Billing/PaymentReconciliation';
import TestPrices from './pages/Settings/TestPrices';
import PaymentSettings from './pages/Settings/PaymentSettings';
import ReportSigning from './pages/Settings/ReportSigning';
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

// Every member of staff marks their own attendance, applies for leave, sees
// their duties and downloads payslips, whatever else their role confines them to.
const SELF_SERVICE_PATHS = ['/attendance', '/leave', '/duty-scheduler', '/payroll'];

// Confines Lab Technician / Lab Doctor to their exact approved pages,
// closing the gap where a hidden sidebar link could still be reached by typing the URL
const LAB_TECHNICIAN_PATHS = ['/reagent-changes', '/equipment-maintenance', '/critical-alerts', '/lab-verification', '/lab-worklist', '/queue-management', '/sample-tracking', '/lab-sample-list', '/lab-reports', '/lab-logs', '/lab-analyzer-logs', '/lab-test-management',
  '/quality-control', '/quality-dashboard', '/blood-bank', '/poct', '/equipment', '/report-delivery', ...SELF_SERVICE_PATHS];
const LAB_DOCTOR_PATHS = LAB_TECHNICIAN_PATHS;
const LAB_HEAD_PATHS = [...LAB_DOCTOR_PATHS, '/queue-audit', '/sample-collection'];
// Oversight roles see evidence, not the lab bench (mirrors the backend route guards).
const AUDITOR_PATHS = ['/audit-trail', '/privilege-review', '/quality-dashboard', '/blood-bank', '/poct', '/report-delivery', '/equipment', '/data-export', '/online-payments', ...SELF_SERVICE_PATHS];

function RequireLabAccess() {
  const role = (localStorage.getItem('role') || '').toLowerCase();
  const location = useLocation();

  let allowed = null;
  if (role === 'lab technician' || role === 'lab_tech') allowed = LAB_TECHNICIAN_PATHS;
  else if (role === 'lab doctor' || role === 'lab_doctor') allowed = LAB_DOCTOR_PATHS;
  else if (role === 'lab head') allowed = LAB_HEAD_PATHS;
  // Sample collectors get exactly one workspace — the collection desk.
  else if (role === 'sample collector') allowed = ['/sample-collection', ...SELF_SERVICE_PATHS];
  else if (role === 'auditor') allowed = AUDITOR_PATHS;

  if (allowed && !allowed.includes(location.pathname)) {
    return <Navigate to={allowed[0]} replace />;
  }
  return <Outlet />;
}

// Employee Management: HR (Admin / Super Admin / HR Manager), mirroring the
// HR_ADMIN_ROLES guard on /api/employees.
function RequireStaffAccess() {
  const role = (localStorage.getItem('role') || '').toLowerCase();
  return ['admin', 'super admin', 'hr manager'].includes(role)
    ? <Outlet />
    : <Navigate to="/dashboard" replace />;
}

// Audit trail and Government data export: Admin / Super Admin / Auditor (mirrors auditRoutes.js / dataExportRoutes.js).
function RequireAuditAccess() {
  const role = (localStorage.getItem('role') || '').toLowerCase();
  return ['admin', 'super admin', 'auditor'].includes(role) ? <Outlet /> : <Navigate to="/dashboard" replace />;
}

// Central/org-tier admin pages a Doctor shouldn't reach (per Sidebar.jsx's own
// doctorAllowed allowlist, which excludes all of these) — previously enforced
// only by hiding the links, not by the routes themselves.
const CENTRAL_ADMIN_PATHS = ['/org-management'];
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
        {/* Start page: choose a role, then that role's sign-in screen */}
        <Route path="/" element={<RolePicker />} />
        <Route path="/login/:portal" element={<Login />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/patient-login" element={<PatientLogin />} />
        <Route path="/clinician-portal" element={<ClinicianPortal />} />
        <Route path="/field" element={<FieldApp />} />

        {/* Public App Routes */}
        <Route path="/patient-upload" element={<PatientUpload />} />
        <Route path="/lab-tv" element={<LabTVMode />} />
        <Route path="/verify-report/:id" element={<VerifyReport />} />
        <Route path="/track" element={<LabTrack />} />
        <Route path="/track/:referenceId" element={<LabTrack />} />

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
            <Route path="/staff-management" element={<EmployeeManagement />} />
          </Route>
          <Route path="/hospital-infra" element={<RoomManagement />} />
          <Route path="/duty-scheduler" element={<DutyRoster />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/leave" element={<LeaveManagement />} />
          <Route path="/payroll" element={<Payroll />} />
          <Route path="/appointments" element={<OpAppointments />} />
          <Route path="/billing-packages" element={<BillingPackages />} />
          <Route path="/billing-overview" element={<BillingOverview />} />
          <Route path="/billing-desk" element={<BillingDesk />} />
          <Route path="/billing-approvals" element={<BillingApprovals />} />
          <Route path="/cash-closing" element={<CashClosing />} />
          <Route path="/billing-control" element={<BillingControl />} />
          <Route path="/service-prices" element={<ServicePrices />} />
          <Route path="/imaging-desk" element={<ImagingDesk />} />
          <Route path="/lab-test-management" element={<LabTestManagement />} />
          <Route path="/lab-worklist" element={<LabWorklist />} />
          <Route path="/queue-management" element={<QueueManagement />} />
          <Route path="/queue-audit" element={<QueueAudit />} />
          <Route path="/sample-tracking" element={<SampleTracking />} />
          <Route path="/sample-collection" element={<SampleCollection />} />
          <Route path="/lab-sample-list" element={<SampleList />} />
          <Route path="/lab-verification" element={<LabVerification />} />
          <Route path="/critical-alerts" element={<CriticalAlerts />} />
          <Route path="/equipment-maintenance" element={<EquipmentMaintenance />} />
          <Route path="/reagent-changes" element={<ReagentChanges />} />
          <Route path="/lab-reports" element={<LabReportDownload />} />
          <Route path="/lab-logs" element={<LabActivityLogs />} />
          <Route path="/lab-analyzer-logs" element={<LabAnalyzerLogs />} />
          <Route path="/lab-unmapped" element={<UnmappedResults />} />
          <Route path="/inventory/dashboard" element={<InventoryDashboard />} />
          <Route path="/inventory" element={<InventoryNetworkDashboard />} />
          <Route path="/inventory/overview" element={<InventoryOverview />} />
          <Route path="/inventory/items" element={<InventoryItemMaster />} />
          <Route path="/inventory/vendors" element={<InventoryVendors />} />
          <Route path="/inventory/ap" element={<PurchasePayments />} />
          <Route path="/inventory/purchase" element={<PurchaseManagement />} />
          <Route path="/inventory/stock" element={<InventoryStockManagement />} />
          <Route path="/inventory/transactions" element={<InventoryTransactions />} />
          <Route path="/inventory/mappings" element={<InventoryTestMapping />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/barcode-generator" element={<BarcodeGenerator />} />
          <Route path="/prescription-scan" element={<PrescriptionScan />} />
          <Route path="/org-management" element={<OrgManagement />} />
          <Route path="/parameter-code-names" element={<ParameterCodeNames />} />
          <Route path="/device-keys" element={<DeviceKeys />} />
          <Route path="/machine-master" element={<MachineMaster />} />
          <Route path="/patient-field-config" element={<PatientFieldConfig />} />
          <Route path="/referring-clinicians" element={<ReferringClinicians />} />
          <Route path="/quality-control" element={<QualityControl />} />
          <Route path="/quality-dashboard" element={<QualityDashboard />} />
          <Route path="/blood-bank" element={<BloodBank />} />
          <Route path="/poct" element={<Poct />} />
          <Route path="/report-delivery" element={<ReportDelivery />} />
          <Route path="/equipment" element={<EquipmentManagement />} />
          <Route path="/online-payments" element={<PaymentReconciliation />} />
          <Route path="/test-prices" element={<TestPrices />} />
          <Route path="/payment-settings" element={<PaymentSettings />} />
          <Route path="/report-signing" element={<ReportSigning />} />
          <Route element={<RequireAuditAccess />}>
            <Route path="/audit-trail" element={<AuditTrail />} />
            <Route path="/privilege-review" element={<PrivilegeReview />} />
            <Route path="/data-export" element={<DataExport />} />
          </Route>
        </Route>
        </Route> {/* end RequireNonDoctorArea */}
        </Route> {/* end RequireLabAccess */}
        </Route> {/* end RequireAuth */}

        {/* Patient Portal Routes */}
        <Route element={<PatientLayout />}>
          <Route path="/patient-portal/profile" element={<PatientProfile />} />
          <Route path="/patient-portal/reports" element={<PatientReports />} />
          <Route path="/patient-portal/appointments" element={<PatientAppointments />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
