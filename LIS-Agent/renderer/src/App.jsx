import { HashRouter, Routes, Route } from "react-router-dom";
import Activation from "./pages/Activation";
import Setup from "./pages/Setup";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Worklist from "./pages/Worklist";
import SampleList from "./pages/SampleList";
import Verification from "./pages/Verification";
import Reports from "./pages/Reports";
import Logs from "./pages/Logs";
import Layout from "./components/Layout";
import EditResults from "./pages/EditResults";
import KyroSetupCliniQuant from "./pages/KyroSetupCliniQuant";
import MasterSheet from "./pages/MasterSheet";
import TodayResults from "./pages/TodayResults";
import UnmappedTests from "./pages/UnmappedTests";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Activation />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/setup" element={<Layout><Setup /></Layout>} />
        <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
        <Route path="/worklist" element={<Layout><Worklist /></Layout>} />
        <Route path="/sample-list" element={<Layout><SampleList /></Layout>} />
        <Route path="/verification" element={<Layout><Verification /></Layout>} />
        <Route path="/reports" element={<Layout><Reports /></Layout>} />
        <Route path="/logs" element={<Layout><Logs /></Layout>} />
        <Route path="/edit-results" element={<Layout><EditResults /></Layout>} />
        <Route path="/setup/cliniquant" element={<Layout><KyroSetupCliniQuant /></Layout>} />
        <Route path="/master-sheet" element={<Layout><MasterSheet /></Layout>} />
        <Route path="/today-results" element={<Layout><TodayResults /></Layout>} />
        <Route path="/unmapped-tests" element={<Layout><UnmappedTests /></Layout>} />
      </Routes>
    </HashRouter>
  );
}