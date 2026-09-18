import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import '../assets/Onboarding.css';

import rs232cableImg from '../assets/img/rs232cable.png';
import cliniquantmicroImg from '../assets/img/cliniquantmicro.png';
import usbmaleImg from '../assets/img/usbmale.png';

import cqStep1Mp3 from '../assets/mp3/cq-step1.mp3';
import cqStep2Mp3 from '../assets/mp3/cq-step2.mp3';
import cqStep3Mp3 from '../assets/mp3/cq-step3.mp3';
import cqScanStartMp3 from '../assets/mp3/cq-scan-start.mp3';
import cqScanSuccessMp3 from '../assets/mp3/cq-scan-success.mp3';
import cqScanUsedMp3 from '../assets/mp3/cq-scan-used.mp3';
import cqScanFailMp3 from '../assets/mp3/cq-scan-fail.mp3';
import cqSuccessMp3 from '../assets/mp3/cq-succcess.mp3';
import { API_BASE } from '../apiBase';

const KyroSetupCliniQuant = () => {
  const navigate = useNavigate();
  const [currentIdx, setCurrentIdx] = useState(0);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = React.useRef(null);

  const [detectedPort, setDetectedPort] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [savedMachines, setSavedMachines] = useState([]);
  const [labs, setLabs] = useState([]);
  const [serialNumber, setSerialNumber] = useState('');
  const [labId, setLabId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [kyroMessage, setKyroMessage] = useState('');

  useEffect(() => {
    fetchInitialData();
    return () => {
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  const fetchInitialData = async () => {
    try {
      const configs = await window.electronAPI.getConfig();
      setSavedMachines(Array.isArray(configs) ? configs : []);
      const branch_id = localStorage.getItem('branch_id') || '1';
      const resLabs = await axios.get(`${API_BASE}/api/infra?type=Lab&branch_id=${branch_id}`);
      const labData = resLabs.data.items || [];
      setLabs(labData);
      if (labData.length === 1) setLabId(labData[0].id.toString());
    } catch (err) {
      console.error('Setup init error:', err);
    }
  };

  const speak = (type) => {
    let src = null;
    if (type === 'step1') src = cqStep1Mp3;
    if (type === 'step2') src = cqStep2Mp3;
    if (type === 'step3') src = cqStep3Mp3;
    if (type === 'scan-start') src = cqScanStartMp3;
    if (type === 'scan-success') src = cqScanSuccessMp3;
    if (type === 'scan-used') src = cqScanUsedMp3;
    if (type === 'scan-fail') src = cqScanFailMp3;
    if (type === 'success') src = cqSuccessMp3;

    if (src) {
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(src);
      audioRef.current = audio;
      
      audio.onplay = () => setIsSpeaking(true);
      audio.onended = () => setIsSpeaking(false);
      audio.onerror = () => setIsSpeaking(false);
      
      audio.play().catch(e => {
        console.error("Audio playback failed", e);
        setIsSpeaking(false);
      });
    }
  };

  useEffect(() => {
    if (currentIdx === 3) autoScanPort();
  }, [currentIdx]);

  const autoScanPort = async () => {
    setIsScanning(true);
    setDetectedPort(null);
    setKyroMessage("Let me check if your device is connected...");
    speak("scan-start");
    try {
      const availablePorts = await window.electronAPI.listPorts();
      const usedPorts = savedMachines.map(m => m.port);
      const free = availablePorts.filter(p => !usedPorts.includes(p.path));
      if (free.length > 0) {
        const port = free[0];
        setDetectedPort(port);
        const msg = `I found your CliniQuant Micro on ${port.path}. Just enter the serial number and I'll take care of the rest.`;
        setKyroMessage(msg);
        speak("scan-success");
      } else if (availablePorts.length > 0) {
        setKyroMessage("I can see a port but it's already assigned to another machine. Try a different USB slot.");
        speak("scan-used");
      } else {
        setKyroMessage("I couldn't find any connected device. Make sure the USB cable is plugged in firmly.");
        speak("scan-fail");
      }
    } catch (err) {
      console.error('Port scan error:', err);
      setKyroMessage("Something went wrong while scanning. Try reconnecting the cable.");
    } finally {
      setIsScanning(false);
    }
  };

  const generateUniqueId = async () => {
    try {
      const userStr = localStorage.getItem('user');
      const user = userStr ? JSON.parse(userStr) : { id: 1 };
      const res = await axios.get(`${API_BASE}/api/lab/hospital-code/${user.id}`);
      if (res.data.success) {
        const prefix = res.data.hospital_code || 'LAB';
        return `${prefix}-MAC-${Math.floor(1000 + Math.random() * 9000)}`;
      }
    } catch {
      return `LAB-MAC-${Math.floor(1000 + Math.random() * 9000)}`;
    }
    return `LAB-MAC-${Math.floor(1000 + Math.random() * 9000)}`;
  };

  const handleSave = async () => {
    if (!serialNumber.trim()) { alert('Please enter the Serial Number'); return; }
    if (!detectedPort) { alert('No device detected. Please check the USB connection.'); return; }
    if (!labId) { alert('Please select a Target Lab'); return; }
    setIsSaving(true);
    try {
      const uniqueId = await generateUniqueId();
      const lab = labs.find(l => l.id == labId);

      // Sync first so the local record can honestly reflect whether it
      // actually reached the backend, rather than always saving locally and
      // assuming the cloud call succeeded (see Setup.jsx for the same fix).
      let synced = false;
      try {
        await axios.post(`${API_BASE}/api/lab/machines/sync`, {
          lab_id: lab.id, machine_id: uniqueId, name: uniqueId,
          model: 'CliniQuant Micro', manufacturer: 'Meril',
          serial_number: serialNumber.trim(), interface_type: 'USB',
          port_ip: detectedPort.path, baud_rate: 9600,
        });
        synced = true;
      } catch (syncErr) {
        console.error('Cloud sync failed:', syncErr);
      }

      await window.electronAPI.saveConfig({
        uniqueId, name: uniqueId, model: 'CliniQuant Micro',
        port: detectedPort.path, baud: 9600,
        labId: lab.id, labName: lab.name,
        manufacturer: 'Meril', serialNumber: serialNumber.trim(),
        synced,
      });

      setIsSynced(synced);
      if (!synced) {
        alert('Saved locally, but could NOT sync to the cloud — this machine will not appear on the web dashboard yet. Check your connection and try Save again.');
      }
    } catch (err) {
      console.error('Save error:', err);
      alert('Error saving configuration.');
    } finally {
      setIsSaving(false);
    }
  };

  const STEPS = [
    {
      title: 'Take the RS232 to USB Cable', label: 'Cable',
      detailsTitle: 'Required Hardware',
      desc: 'Locate your RS232 to USB communication cable. This cable translates the serial signals from the analyzer to USB for the computer. Once you have the cable, click the next button.',
      checklist: ['Ensure cable is not physically damaged', 'Check both RS232 and USB ends'],
      tip: 'Tip: Always use a high-quality FTDI or Prolific chipset cable for reliable communication.',
      image: rs232cableImg,
    },
    {
      title: 'Connect 9-Pin to Analyzer', label: 'Connect Analyzer',
      detailsTitle: 'Analyzer Connection',
      desc: 'Connect the RS232 cable 9 pin to the Cliniquant Micro LIS Connection port. Once connected, click the next button.',
      checklist: ['Locate the serial port on the back of the analyzer', 'Plug in the 9-pin connector', 'Tighten the thumbscrews'],
      tip: 'Tip: Do not overtighten the screws. Hand-tight is sufficient.',
      image: cliniquantmicroImg,
    },
    {
      title: 'Connect USB to Computer', label: 'Connect PC',
      detailsTitle: 'PC Connection',
      desc: 'Plug the USB end of the cable into an available USB port directly on your computer. Once plugged in, click the next button.',
      checklist: ['Find an available USB port on your PC', 'Insert the USB male connector firmly'],
      tip: 'Tip: If Windows asks for drivers, allow it to download the latest serial drivers automatically.',
      image: usbmaleImg,
    },
    {
      title: 'Kyro is configuring your device', label: 'Configure',
      detailsTitle: 'Almost done!',
      desc: "Kyro will detect your device automatically. Just enter the serial number and hit Sync — that's it.",
      checklist: ['Device auto-detected via USB', 'Enter serial number only', 'Kyro syncs to cloud'],
      tip: 'Tip: The serial number is on the label at the bottom of the analyzer.',
      image: null,
    },
  ];

  const totalSteps = STEPS.length;
  const progressPct = ((currentIdx + 1) / totalSteps) * 100;

  useEffect(() => {
    if (currentIdx === 3) return;
    if (currentIdx === 0) speak('step1');
    else if (currentIdx === 1) speak('step2');
    else if (currentIdx === 2) speak('step3');
  }, [currentIdx]);

  useEffect(() => {
    if (isSynced) speak("success");
  }, [isSynced]);

  const handleNext = () => {
    if (currentIdx < totalSteps - 1) setCurrentIdx(currentIdx + 1);
    else navigate('/setup');
  };

  const handlePrev = () => {
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  };

  const renderConfigStep = () => {
    if (isSynced) {
      return (
        <div className="kyro-success-state">
          <div className="kyro-success-icon">✓</div>
          <h3 className="kyro-success-title">Machine synced!</h3>
          <p className="kyro-success-desc">Your CliniQuant Micro is ready to receive samples.</p>
        </div>
      );
    }

    return (
      <div className="kyro-config-wrap">
        <div className="kyro-bubble">
          <div className="kyro-bubble-avatar">K</div>
          <p className="kyro-bubble-text">
            {isScanning ? 'Scanning for your device...' : kyroMessage || 'Checking connection...'}
          </p>
        </div>

        <div className={`kyro-port-status ${detectedPort ? 'found' : ''}`}>
          <span className={`kyro-port-dot ${detectedPort ? 'found' : ''}`}></span>
          <span>
            {isScanning
              ? 'Scanning ports...'
              : detectedPort
                ? `Device found on ${detectedPort.path}${detectedPort.friendlyName ? ` — ${detectedPort.friendlyName}` : ''}`
                : 'No device detected'}
          </span>
          {!isScanning && (
            <button className="kyro-rescan-btn" onClick={autoScanPort}>Re-scan</button>
          )}
        </div>

        <div className="kyro-form-group">
          <label className="kyro-form-label">Serial Number</label>
          <input
            type="text"
            className="kyro-serial-input"
            placeholder="e.g. CQM-2024-0048"
            value={serialNumber}
            onChange={e => setSerialNumber(e.target.value)}
          />
          <span className="kyro-form-hint">Found on the label at the bottom of the analyzer</span>
        </div>

        {labs.length > 1 && (
          <div className="kyro-form-group">
            <label className="kyro-form-label">Target Lab</label>
            <select
              className="kyro-form-select"
              value={labId}
              onChange={e => setLabId(e.target.value)}
            >
              <option value="">-- Select Lab --</option>
              {labs.map(lab => (
                <option key={lab.id} value={lab.id}>{lab.name}</option>
              ))}
            </select>
          </div>
        )}

        <button
          className="kyro-sync-btn"
          onClick={handleSave}
          disabled={isSaving || !detectedPort || !serialNumber.trim()}
        >
          {isSaving ? 'Syncing...' : '☁ Sync Machine to Cloud'}
        </button>
      </div>
    );
  };

  return (
    <div className="kyro-setup-container">
      <header className="kyro-header">
        <div className="kyro-orb-wrapper">
          <div className="kyro-orb-container">
            <div className={`kyro-orb ${isSpeaking ? 'speaking' : ''}`}></div>
            <div className="kyro-ring"></div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="kyro-setup-label">Kyro AI Guided Setup</div>
          <button className="kyro-back-btn" onClick={() => navigate('/setup')}>
            ← Back to Settings
          </button>
        </div>

        <h1 className="kyro-main-title">CliniQuant Micro</h1>

        <div className="kyro-progress-steps">
          <div className="kyro-step-line-container">
            <div className="kyro-step-line-fill" style={{ width: `${(currentIdx / (totalSteps - 1)) * 100}%` }}></div>
          </div>
          {STEPS.map((s, i) => (
            <div key={i} className="kyro-step-item" onClick={() => setCurrentIdx(i)}>
              <div className={`kyro-step-circle ${i < currentIdx ? 'completed' : ''} ${i === currentIdx ? 'active' : ''}`}>
                {i < currentIdx ? '✓' : i + 1}
              </div>
              <div className="kyro-step-label">{s.label}</div>
            </div>
          ))}
        </div>
      </header>

      <main className="kyro-content-body">
        <div className="kyro-image-column">
          <div className="kyro-image-card">
            <div className="kyro-step-badge">Step {currentIdx + 1}</div>
            {currentIdx === 3
              ? renderConfigStep()
              : <img src={STEPS[currentIdx].image} className="kyro-main-img" alt="Step Visual" />}
          </div>
          {currentIdx !== 3 && (
            <div className="kyro-image-subtext">
              <h3>{STEPS[currentIdx].title}</h3>
              <p>Required for accurate results</p>
            </div>
          )}
        </div>

        <div className="kyro-details-column">
          <h2 className="kyro-details-title">{STEPS[currentIdx].detailsTitle}</h2>
          <p className="kyro-details-desc">{STEPS[currentIdx].desc}</p>
          <ul className="kyro-checklist">
            {STEPS[currentIdx].checklist.map((item, i) => (
              <li key={i} className="kyro-check-item">
                <div className="kyro-check-circle">✓</div>
                {item}
              </li>
            ))}
          </ul>
          <div className="kyro-tip-box">
            <div className="kyro-tip-icon">ⓘ</div>
            <div>{STEPS[currentIdx].tip}</div>
          </div>
        </div>
      </main>

      <footer className="kyro-footer">
        <div className="kyro-nav-buttons">
          <button className="kyro-nav-btn" onClick={handlePrev} disabled={currentIdx === 0}>
            ← Prev
          </button>
          <button
            className={`kyro-nav-btn next ${currentIdx === totalSteps - 1 ? 'complete' : ''}`}
            onClick={handleNext}
          >
            {currentIdx === totalSteps - 1 ? 'Complete ✓' : 'Next →'}
          </button>
        </div>
      </footer>

      <div className="kyro-bottom-bar">
        <div className="kyro-bottom-bar-fill" style={{ width: `${progressPct}%` }}></div>
      </div>
    </div>
  );
};

export default KyroSetupCliniQuant;