import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList, TestTube2, Wrench, FileBarChart2, Play, Square,
  Wifi, Activity, Radio, X, ChevronRight, Cpu
} from "lucide-react";

const shortcuts = [
  { title: "Worklist", desc: "Manage pending tests", path: "/worklist", Icon: ClipboardList, accent: "var(--brand-blue)", bg: "var(--brand-blue-light)" },
  { title: "Sample List", desc: "View patient samples", path: "/sample-list", Icon: TestTube2, accent: "#059669", bg: "var(--color-success-bg)" },
  { title: "Analyzer Setup", desc: "Configure machines", path: "/setup", Icon: Wrench, accent: "#b45309", bg: "var(--color-warning-bg)" },
  { title: "Reports", desc: "Generate lab reports", path: "/reports", Icon: FileBarChart2, accent: "var(--brand-purple)", bg: "#f5f0ff" },
];

const ShortcutCard = ({ title, desc, Icon, accent, bg, onClick }) => (
  <button type="button" onClick={onClick} className="card card-hover dash-shortcut">
    <div className="dash-shortcut-icon" style={{ background: bg, color: accent }}>
      <Icon size={22} strokeWidth={2} />
    </div>
    <div className="dash-shortcut-body">
      <div className="dash-shortcut-title">{title}</div>
      <div className="dash-shortcut-desc">{desc}</div>
    </div>
    <ChevronRight size={18} className="dash-shortcut-arrow" />
  </button>
);

export default function Dashboard() {
    const navigate = useNavigate();
    const [machines, setMachines] = useState([]);
    const [selectedMachine, setSelectedMachine] = useState(null);
    const [isListening, setIsListening] = useState(false);
    const [logs, setLogs] = useState([]);
    const [testResults, setTestResults] = useState([]);
    const [showPicker, setShowPicker] = useState(false);

    const [localIp, setLocalIp] = useState("");

    // Incoming data from serialManager
    useEffect(() => {
        fetchMachines();
        window.electronAPI.getLocalIp().then(setLocalIp);
        const cleanup = window.electronAPI.onTestCompleted((data) => {
            console.log("Test Completed Data:", data);
            setTestResults(prev => [data, ...prev]);
            setLogs(prev => [`[${data.test_name}] Result: ${data.result_value} ${data.unit}`, ...prev]);
        });
        return cleanup;
    }, []);

    const fetchMachines = async () => {
        const configs = await window.electronAPI.getConfig();
        setMachines(Array.isArray(configs) ? configs : []);
        if (configs && configs.length === 1) {
            setSelectedMachine(configs[0]);
        }
    };

    const handleToggleListening = async () => {
        if (isListening) {
            await window.electronAPI.stopListening();
            setIsListening(false);
            setLogs(prev => ["Stopped listening", ...prev]);
        } else {
            if (!selectedMachine && machines.length > 1) {
                setShowPicker(true);
                return;
            }

            const machineToUse = selectedMachine || machines[0];
            if (!machineToUse) {
                alert("Please configure a machine in Setup first.");
                return;
            }

            startEngine(machineToUse);
        }
    };

    const startEngine = async (machine) => {
        setLogs(prev => [`Starting listener on ${machine.port}...`, ...prev]);
        const success = await window.electronAPI.startListening({
            port: machine.port,
            baud: machine.baud,
            machineId: machine.id
        });

        if (success) {
            setIsListening(true);
            setSelectedMachine(machine);
            setShowPicker(false);
        } else {
            alert("Failed to open port. Check connection.");
        }
    };

    return (
        <div className="page">
            <div className="page-header">
                <div className="page-title-group">
                    <span className="badge badge-info" style={{ width: 'fit-content' }}>Karnataka LIMS Agent</span>
                    <h1 className="page-title">Laboratory Dashboard</h1>
                    <p className="page-subtitle">
                        {selectedMachine ? `Connected to ${selectedMachine.unique_id} (${selectedMachine.model})` : 'No analyzer selected'}
                    </p>
                </div>

                <button
                    onClick={handleToggleListening}
                    className={`btn ${isListening ? 'btn-danger' : 'btn-primary'}`}
                    style={{ padding: '12px 26px', fontSize: 14 }}
                >
                    {isListening ? <Square size={16} /> : <Play size={16} />}
                    {isListening ? 'Stop Capture' : 'Start Capture'}
                </button>
            </div>

            <div className="stat-grid">
                <div className="stat-card" style={{ '--stat-icon-bg': isListening ? 'var(--color-success-bg)' : 'var(--color-neutral-bg)', '--stat-icon-color': isListening ? 'var(--color-success)' : 'var(--text-muted)' }}>
                    <div className="stat-icon"><Radio size={20} /></div>
                    <div className="stat-body">
                        <span className="stat-value" style={{ fontSize: 18 }}>{isListening ? 'Listening' : 'Idle'}</span>
                        <span className="stat-label">Capture Status</span>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon"><Cpu size={20} /></div>
                    <div className="stat-body">
                        <span className="stat-value">{machines.length}</span>
                        <span className="stat-label">Configured Analyzers</span>
                    </div>
                </div>
                <div className="stat-card" style={{ '--stat-icon-bg': 'var(--color-success-bg)', '--stat-icon-color': 'var(--color-success)' }}>
                    <div className="stat-icon"><Activity size={20} /></div>
                    <div className="stat-body">
                        <span className="stat-value">{testResults.length}</span>
                        <span className="stat-label">Results This Session</span>
                    </div>
                </div>
                <div className="stat-card" style={{ '--stat-icon-bg': '#f5f0ff', '--stat-icon-color': 'var(--brand-purple)' }}>
                    <div className="stat-icon"><Wifi size={20} /></div>
                    <div className="stat-body">
                        <span className="stat-value" style={{ fontSize: 15 }}>{localIp || '—'}</span>
                        <span className="stat-label">LIS Server IP</span>
                    </div>
                </div>
            </div>

            <div className="dash-grid">
                <div>
                    <h3 className="dash-section-title">Quick Actions</h3>
                    <div className="dash-shortcut-grid">
                        {shortcuts.map(s => (
                            <ShortcutCard key={s.path} {...s} onClick={() => navigate(s.path)} />
                        ))}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3>Live Activity</h3>
                        {isListening && <span className="badge badge-success"><span className="badge-dot" />Live</span>}
                    </div>
                    <div className="card-body-flush dash-activity-list">
                        {logs.length === 0 ? (
                            <div className="empty-state" style={{ padding: '32px 20px' }}>
                                <div className="empty-state-icon"><Activity size={24} /></div>
                                <p style={{ fontSize: 13, margin: 0 }}>No activity yet. Start capture to see live results here.</p>
                            </div>
                        ) : (
                            logs.slice(0, 12).map((log, i) => (
                                <div key={i} className="dash-activity-row">{log}</div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Machine Picker Modal */}
            {showPicker && (
                <div className="modal-overlay" onClick={() => setShowPicker(false)}>
                    <div className="modal-card" onClick={e => e.stopPropagation()} style={{ padding: 32 }}>
                        <div className="flex-between" style={{ marginBottom: 8 }}>
                            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Select Analyzer</h2>
                            <button className="btn btn-ghost btn-icon" onClick={() => setShowPicker(false)}><X size={18} /></button>
                        </div>
                        <p className="text-secondary" style={{ marginBottom: 20, fontSize: 13.5 }}>Multiple machines detected. Which one are you running?</p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {machines.map(m => (
                                <button
                                    key={m.id}
                                    onClick={() => startEngine(m)}
                                    className="dash-machine-option"
                                >
                                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{m.unique_id}</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.manufacturer} {m.model} • {m.port}</div>
                                </button>
                            ))}
                        </div>

                        <button onClick={() => setShowPicker(false)} className="btn btn-secondary" style={{ width: '100%', marginTop: 18 }}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
