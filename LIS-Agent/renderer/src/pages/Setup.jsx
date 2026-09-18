import React, { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate, useLocation } from "react-router-dom";
import { API_BASE } from "../apiBase";
import {
  Plus, Sparkles, ArrowRight, Pencil, Trash2, Cloud, CloudOff,
  Wifi, WifiOff, Globe2, RefreshCw
} from "lucide-react";

export default function Setup() {
    const [labs, setLabs] = useState([]);
    const [savedMachines, setSavedMachines] = useState([]);
    const [ports, setPorts] = useState([]);
    const [activePorts, setActivePorts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [isFetching, setIsFetching] = useState(false);
    const [isEdit, setIsEdit] = useState(false);
    const [searchSerial, setSearchSerial] = useState('');

    const navigate = useNavigate();
    const location = useLocation();

    // Form State
    const [formData, setFormData] = useState({
        serialNumber: '',
        uniqueId: '',
        labId: '',
        labName: '',
        manufacturer: location.state?.prefill?.brand || '',
        model: location.state?.prefill?.model || '',
        portType: 'USB',
        port: '',
        baudRate: '9600',
        analyzerIp: ''
    });

    const manufacturers = {
        'Meril': ['CliniQuant Micro', 'CelQuant Edge', 'CelQuant Micro', 'CelQuant 5plus', 'AutoQuant 200i', 'Quantirase'],
        'Sysmex': ['XP-100', 'XN-350', 'XN-550', 'KX-21'],
        'Agape': ['Mispa Viva', 'Mispa i2', 'Mispa i3', 'Mispa CC', 'CXL Pro'],
        'HDC India': ['HDC-Lyte Plus', 'HDC-LYTE PRO'],
        'Erba Mannheim': ['LAURA Smart'],
        'Athenese Dx': ['ALTA Hematology', 'ADX-AUTOCHEM-200'],
        'Mindray': ['BC-5130'],
        'SENSA CORE': ['ST-200CL'],
        'NIHON KOHDEN': ['CelltacEs']
    };

    // The BC-5130 runs its own TCP server on the analyzer — this Agent must
    // dial out to it, so it needs the analyzer's IP address (unlike the other
    // TCP models, which listen for the analyzer to connect in to us).
    const needsAnalyzerIp = formData.model.includes('BC-5130');

    // Mirrors machineKey() in main/tcpManager.js: a dial-out analyzer's port
    // is fixed by the hardware and identical across every unit of that
    // model, so the ONLINE badge (like the port-conflict check) has to key
    // on ip:port for those, not port alone, or a second unit's badge would
    // read whichever state the first one happened to be in.
    const machineKey = (m) => (m.analyzer_ip ? `${m.analyzer_ip}:${m.port}` : String(m.port));

    const baudRates = ["1200", "2400", "4800", "9600", "19200", "38400", "57600", "115200"];

    const [localIp, setLocalIp] = useState('');

    useEffect(() => {
        if (location.state?.prefill) {
            setShowAddForm(true);
        }
        fetchInitialData();
        window.electronAPI.getLocalIp().then(setLocalIp);

        // Listen for real-time status changes
        let cleanup;
        if (window.electronAPI && window.electronAPI.onDeviceStatus) {
            cleanup = window.electronAPI.onDeviceStatus(() => {
                refreshStatus();
            });
        }

        // Poll connection status every 5 seconds to keep ONLINE/OFFLINE live
        const pollInterval = setInterval(() => {
            refreshStatus();
        }, 5000);

        return () => {
            if (cleanup) cleanup();
            clearInterval(pollInterval);
        };
    }, [location]);

    const refreshStatus = async () => {
        if (window.electronAPI && window.electronAPI.getActivePorts) {
            const active = await window.electronAPI.getActivePorts();
            // Normalize to strings for consistent comparison
            setActivePorts(active.map(p => String(p)));
        }
    };

    const fetchInitialData = async () => {
        try {
            const configs = await window.electronAPI.getConfig();

            // Redirect to onboarding if no machines exist and we didn't just come from onboarding
            if ((!configs || configs.length === 0) && !location.state?.prefill) {
                navigate('/onboarding');
                return;
            }

            setSavedMachines(Array.isArray(configs) ? configs : []);

            const branch_id = localStorage.getItem('branch_id') || '1';
            const resLabs = await axios.get(`${API_BASE}/api/infra?type=Lab&branch_id=${branch_id}`);
            setLabs(resLabs.data.items || []);

            const availablePorts = await window.electronAPI.listPorts();
            setPorts(availablePorts);

            await refreshStatus();
        } catch (err) {
            console.error("Setup initialization error:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleFetchBySerial = async () => {
        if (!searchSerial) return;
        setIsFetching(true);
        try {
            const res = await axios.get(`${API_BASE}/api/lab/machine-by-serial/${searchSerial}`);

            // Always sync the form's serial with the searched one
            setFormData(prev => ({ ...prev, serialNumber: searchSerial }));

            if (res.data.success && res.data.machine) {
                const m = res.data.machine;
                setFormData(prev => ({
                    ...prev,
                    uniqueId: m.machine_id,
                    manufacturer: m.manufacturer,
                    model: m.model,
                    portType: m.interface_type || 'USB',
                    port: m.port_ip || '',
                    baudRate: m.baud_rate ? m.baud_rate.toString() : '9600'
                }));
                alert("Found existing configuration on Cloud! Details auto-filled.");
            } else {
                // If not found, clear other fields but KEEP the serial number in the form
                setFormData(prev => ({
                    ...prev,
                    uniqueId: '',
                    manufacturer: '',
                    model: '',
                    port: '',
                }));
                generateUniqueId();
                alert("No record found. A new Unique Machine ID has been generated for this analyzer.");
            }
        } catch (err) {
            console.error("Fetch error:", err);
        } finally {
            setIsFetching(false);
        }
    };

    const generateUniqueId = async () => {
        try {
            const userStr = localStorage.getItem('user');
            const user = userStr ? JSON.parse(userStr) : { id: 1 };
            const res = await axios.get(`${API_BASE}/api/lab/hospital-code/${user.id}`);
            if (res.data.success) {
                const prefix = res.data.hospital_code || 'LAB';
                const randomNum = Math.floor(1000 + Math.random() * 9000);
                setFormData(prev => ({ ...prev, uniqueId: `${prefix}-MAC-${randomNum}` }));
            }
        } catch (err) {
            console.error("Error generating ID:", err);
            setFormData(prev => ({ ...prev, uniqueId: `LAB-MAC-${Math.floor(1000 + Math.random() * 9000)}` }));
        }
    };

    const handleSave = async () => {
        if (!formData.labId || !formData.manufacturer || !formData.model || !formData.port || !formData.serialNumber) {
            alert("Please complete all required fields");
            return;
        }
        if (needsAnalyzerIp && !formData.analyzerIp) {
            alert("This analyzer requires its IP address — the LIS Agent connects out to it, not the other way around.");
            return;
        }

        // 🚨 Prevent USB/TCP port conflicts. A dial-out analyzer like the
        // BC-5130 has its port fixed by the hardware (always 5100) and
        // legitimately shares it across every unit of that model — this
        // Agent dials OUT to a distinct IP, it doesn't bind anything locally,
        // so there's no real resource conflict unless the IP matches too.
        // analyzer_ip is always empty for USB/listening-TCP machines, so this
        // still catches a real same-port conflict for those exactly as before.
        const conflict = savedMachines.find(m =>
            m.port === formData.port &&
            (m.analyzer_ip || '') === (formData.analyzerIp || '') &&
            m.unique_id !== formData.uniqueId
        );

        if (conflict) {
            const detail = formData.analyzerIp
                ? `Port ${formData.port} on ${formData.analyzerIp} is`
                : `Port ${formData.port} is`;
            alert(`⚠️ Port Conflict: ${detail} already assigned to ${conflict.model} (${conflict.unique_id}).\n\nPlease select a different port or disconnect the other device.`);
            return;
        }

        const lab = labs.find(l => l.id == formData.labId);
        const config = {
            uniqueId: formData.uniqueId,
            name: formData.uniqueId,
            model: formData.model,
            port: formData.port,
            baud: parseInt(formData.baudRate),
            labId: lab.id,
            labName: lab.name,
            manufacturer: formData.manufacturer,
            serialNumber: formData.serialNumber,
            portType: formData.portType,
            analyzerIp: needsAnalyzerIp ? formData.analyzerIp : '',
        };

        // Sync to the cloud FIRST so the local save can honestly record
        // whether it actually reached the backend — previously the local
        // save always succeeded and the "CLOUD SYNCED" badge was shown
        // unconditionally even when this call failed, so a machine could
        // look fully set up here while being completely invisible on the
        // web dashboard.
        let synced = false;
        try {
            await axios.post(`${API_BASE}/api/lab/machines/sync`, {
                lab_id: lab.id,
                machine_id: formData.uniqueId,
                name: formData.uniqueId,
                model: formData.model,
                manufacturer: formData.manufacturer,
                serial_number: formData.serialNumber,
                interface_type: formData.portType,
                port_ip: formData.port,
                baud_rate: parseInt(formData.baudRate)
            });
            synced = true;
        } catch (err) {
            console.error("Cloud sync failed:", err);
        }

        try {
            await window.electronAPI.saveConfig({ ...config, synced });

            if (synced) {
                alert("Machine Synchronized!");
            } else {
                alert("Saved locally, but could NOT sync to the cloud — this machine will not appear on the web dashboard until it syncs. Check your connection, then Edit → Save this machine again.");
            }
            fetchInitialData();
            setShowAddForm(false);
            setSearchSerial('');
        } catch (err) {
            console.error("Error saving local config:", err);
            alert("Failed to save machine configuration.");
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm("Are you sure you want to remove this machine?")) {
            await window.electronAPI.deleteConfig(id);
            fetchInitialData();
        }
    };

    if (loading) {
        return (
            <div className="page loading-row">
                <div className="spinner" /> Initializing analyzer hub...
            </div>
        );
    }

    return (
        <div className="page" style={{ maxWidth: 1100 }}>
            <div className="page-header">
                <div className="page-title-group">
                    <h1 className="page-title">Analyzer Hub</h1>
                    <p className="page-subtitle">Cloud-synchronized laboratory connectivity</p>
                </div>
                {!showAddForm && (
                    <button
                        onClick={() => {
                            setIsEdit(false);
                            setShowAddForm(true);
                            setSearchSerial('');
                            // Fully reset form with a new object to clear any stale state
                            setFormData({
                                serialNumber: '',
                                uniqueId: '',
                                labId: '',
                                labName: '',
                                manufacturer: '',
                                model: '',
                                portType: 'USB',
                                port: '',
                                baudRate: '9600',
                                analyzerIp: ''
                            });
                        }}
                        className="btn btn-primary"
                    >
                        <Plus size={16} /> Link Analyzer
                    </button>
                )}
            </div>

            {!showAddForm ? (
                <>
                    <div
                        className="setup-kyro-banner"
                        onClick={() => navigate('/setup/cliniquant')}
                    >
                        <div className="setup-kyro-icon"><Sparkles size={22} /></div>
                        <div style={{ flex: 1 }}>
                            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Kyro AI Guided Setup</h3>
                            <p style={{ margin: '4px 0 0', opacity: 0.9, fontSize: 13.5 }}>Interactive visual setup for CliniQuant Micro Analyzer</p>
                        </div>
                        <div className="setup-kyro-cta">Start Setup <ArrowRight size={15} /></div>
                    </div>

                    <div className="setup-machine-grid">
                        {savedMachines.map((m) => (
                            <div key={m.id} className="card setup-machine-card">
                                <div className="flex-between" style={{ marginBottom: 14 }}>
                                    <div className="flex-row gap-8" style={{ flexWrap: 'wrap' }}>
                                        {m.synced ? (
                                            <span className="badge badge-info"><Cloud size={12} /> Synced</span>
                                        ) : (
                                            <span className="badge badge-danger" title="This machine won't show up on the web dashboard until it syncs — Edit → Save to retry."><CloudOff size={12} /> Not Synced</span>
                                        )}
                                        {activePorts.includes(machineKey(m)) ? (
                                            <span className="badge badge-success"><Wifi size={12} /> Online</span>
                                        ) : (
                                            <span className="badge badge-neutral"><WifiOff size={12} /> Offline</span>
                                        )}
                                    </div>
                                    <div className="flex-row gap-8">
                                        <button
                                            onClick={() => {
                                                setFormData({
                                                    serialNumber: m.serial_number,
                                                    uniqueId: m.unique_id,
                                                    labId: m.lab_id,
                                                    labName: m.lab_name,
                                                    manufacturer: m.manufacturer,
                                                    model: m.model,
                                                    portType: m.interface_type || 'USB',
                                                    port: m.port,
                                                    baudRate: m.baud.toString(),
                                                    analyzerIp: m.analyzer_ip || ''
                                                });
                                                setIsEdit(true);
                                                setSearchSerial(m.serial_number);
                                                setShowAddForm(true);
                                            }}
                                            className="btn btn-ghost btn-icon"
                                        >
                                            <Pencil size={15} />
                                        </button>
                                        <button onClick={() => handleDelete(m.id)} className="btn btn-ghost btn-icon" style={{ color: 'var(--color-danger)' }}>
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                </div>
                                <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>{m.unique_id}</h3>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>S/N: {m.serial_number}</div>
                                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}><strong>Brand:</strong> {m.manufacturer}</div>
                                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}><strong>Model:</strong> {m.model}</div>
                                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}><strong>Lab:</strong> {m.lab_name}</div>
                                <div className="setup-machine-portline">{m.port} @ {m.baud} bps</div>
                            </div>
                        ))}
                        {savedMachines.length === 0 && (
                            <div className="empty-state" style={{ gridColumn: '1/-1', border: '2px dashed var(--border-subtle)', borderRadius: 'var(--radius-lg)', background: 'var(--surface-sunken)', padding: '64px 24px' }}>
                                <div className="empty-state-icon"><Globe2 size={26} /></div>
                                <h3 style={{ color: 'var(--text-secondary)', margin: 0 }}>Connect your Analyzers</h3>
                                <p style={{ margin: 0 }}>Link a machine using its Serial Number to sync with Cloud</p>
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <div className="card" style={{ padding: 32 }}>

                    {/* STEP 1: Search by Serial */}
                    <div className="setup-search-block">
                        <label className="field-label" style={{ display: 'block', marginBottom: 10 }}>Search Analyzer by Serial Number</label>
                        <div className="flex-row gap-12">
                            <input
                                type="text"
                                placeholder="Enter Serial Number (e.g. SN-12345)"
                                value={searchSerial}
                                onChange={(e) => setSearchSerial(e.target.value)}
                                className="control"
                                style={{ flex: 1 }}
                            />
                            <button
                                onClick={handleFetchBySerial}
                                disabled={isFetching || !searchSerial}
                                className="btn btn-secondary"
                                style={{ background: 'var(--text-primary)', color: '#fff', borderColor: 'var(--text-primary)' }}
                            >
                                {isFetching ? 'Fetching...' : 'Fetch Settings'}
                            </button>
                        </div>
                    </div>

                    {/* STEP 2: Detailed Form */}
                    <div className="form-grid" style={{ marginTop: 28 }}>

                        <div className="field-group">
                            <label className="field-label">Confirmed Serial Number</label>
                            <input type="text" value={formData.serialNumber} readOnly className="control" style={{ background: 'var(--surface-sunken)', fontWeight: 700, color: 'var(--text-muted)' }} />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Unique Machine ID</label>
                            <input type="text" value={formData.uniqueId} readOnly className="control" style={{ background: 'var(--surface-sunken)', fontWeight: 800, color: 'var(--brand-blue)' }} />
                        </div>

                        <div className="field-group">
                            <label className="field-label">Target Laboratory</label>
                            <select value={formData.labId} onChange={(e) => setFormData({ ...formData, labId: e.target.value })} className="control">
                                <option value="">Select Lab</option>
                                {labs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                        </div>

                        <div className="field-group">
                            <label className="field-label">Select Brand</label>
                            <select value={formData.manufacturer} onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value, model: '' })} className="control">
                                <option value="">Choose Brand</option>
                                {Object.keys(manufacturers).map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>

                        <div className="field-group">
                            <label className="field-label">Analyzer Model</label>
                            <select
                                disabled={!formData.manufacturer}
                                value={formData.model}
                                onChange={(e) => {
                                    const model = e.target.value;
                                    // BC-5130 only ever talks over its own network connection —
                                    // force TCP mode so the Interface picker isn't left pointing
                                    // at an irrelevant USB/Serial choice.
                                    const forcesTcp = model.includes('BC-5130');
                                    setFormData({ ...formData, model, portType: forcesTcp ? 'TCP' : formData.portType, port: '' });
                                }}
                                className="control"
                            >
                                <option value="">Select Model</option>
                                {formData.manufacturer && manufacturers[formData.manufacturer].map(mod => <option key={mod} value={mod}>{mod}</option>)}
                            </select>
                        </div>

                        {!needsAnalyzerIp && (
                            <div className="field-group">
                                <label className="field-label">Interface</label>
                                <select value={formData.portType} onChange={(e) => setFormData({ ...formData, portType: e.target.value, port: '' })} className="control">
                                    <option value="USB">USB / Serial Port</option>
                                    <option value="TCP">TCP / IP (Network)</option>
                                </select>
                            </div>
                        )}

                        {needsAnalyzerIp ? (
                            <>
                                <div className="field-group">
                                    <label className="field-label">Analyzer IP Address</label>
                                    <div className="setup-tcp-hint">
                                        This analyzer runs its own server — the LIS Agent connects out to it, not the
                                        other way around. Enter its network IP below (check the analyzer's own network
                                        settings screen).
                                    </div>
                                    <input type="text" placeholder="e.g. 192.168.0.200" value={formData.analyzerIp} onChange={(e) => setFormData({ ...formData, analyzerIp: e.target.value })} className="control" />
                                </div>
                                <div className="field-group">
                                    <label className="field-label">Analyzer Port</label>
                                    <input type="text" placeholder="e.g. 5100" value={formData.port} onChange={(e) => setFormData({ ...formData, port: e.target.value })} className="control" />
                                </div>
                            </>
                        ) : (
                            <div className="field-group">
                                <div className="flex-between" style={{ marginBottom: 2 }}>
                                    <label className="field-label" style={{ marginBottom: 0 }}>
                                        {formData.portType === 'TCP' ? 'Listening Port' : 'Port'}
                                    </label>
                                    {formData.portType === 'USB' && (
                                        <button
                                            onClick={async (e) => {
                                                e.preventDefault();
                                                const availablePorts = await window.electronAPI.listPorts();
                                                setPorts(availablePorts);
                                            }}
                                            className="btn btn-ghost btn-sm"
                                            style={{ padding: '2px 8px' }}
                                        >
                                            <RefreshCw size={12} /> Refresh
                                        </button>
                                    )}
                                </div>
                                {formData.portType === 'USB' ? (
                                    <select value={formData.port} onChange={(e) => setFormData({ ...formData, port: e.target.value })} className="control">
                                        <option value="">Choose Port</option>
                                        {ports.map(p => (
                                            <option key={p.path} value={p.path}>
                                                {p.path} {p.manufacturer ? `(${p.manufacturer})` : ''} {p.friendlyName ? `- ${p.friendlyName}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <div>
                                        <div className="setup-tcp-hint">
                                            <strong>LIS Server IP:</strong> {localIp}<br/>
                                            <span style={{ fontSize: 11 }}>(Enter this IP and the port below into your Wi-Fi analyzer)</span>
                                        </div>
                                        <input type="text" placeholder="e.g. 9527" value={formData.port} onChange={(e) => setFormData({ ...formData, port: e.target.value })} className="control" />
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="field-group">
                            <label className="field-label">Baud Rate</label>
                            <select disabled={formData.portType === 'TCP'} value={formData.baudRate} onChange={(e) => setFormData({ ...formData, baudRate: e.target.value })} className="control">
                                {baudRates.map(rate => <option key={rate} value={rate}>{rate}</option>)}
                            </select>
                        </div>
                    </div>

                    <div style={{ marginTop: 32, display: 'flex', gap: 14 }}>
                        <button onClick={handleSave} className="btn btn-primary" style={{ flex: 1, padding: '15px', fontSize: 15 }}>Save &amp; Sync to Cloud</button>
                        <button onClick={() => setShowAddForm(false)} className="btn btn-secondary" style={{ padding: '15px 28px' }}>Cancel</button>
                    </div>
                </div>
            )}
        </div>
    );
}
