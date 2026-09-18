import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import '../assets/Onboarding.css';
import { Mic, ArrowRight, Check } from 'lucide-react';

const ANALYZERS = [
  { brand: 'Meril', model: 'CliniQuant Micro' },
  { brand: 'Meril', model: 'AutoQuant 200i' },
  { brand: 'Sysmex', model: 'XP-100' },
  { brand: 'HDC India', model: 'HDC-LYTE PRO' },
  { brand: 'Erba Mannheim', model: 'LAURA Smart' },
  { brand: 'Athenese Dx', model: 'ALTA Hematology' },
  { brand: 'Athenese Dx', model: 'ADX-AUTOCHEM-200' }
];

const DIALOGUE = {
  en: {
    welcome: "Welcome To Karnataka L I M S. My Name is Kyro, your virtual assistant. Let's connect the analyzers. Select all the analyzers you need to connect.",
    next: "Ok Perfect. Let's connect them one by one. Which instrument do you need to connect first?",
    subtitle_welcome: "Select all the analyzers you need to connect",
    subtitle_next: "Which instrument do you want to configure first?",
    btn_start: "Start Setup",
    btn_continue: "Continue"
  },
  hi: {
    welcome: "मेरिल के LIMS में आपका स्वागत है। मेरा नाम Kyro है, आपका वर्चुअल असिस्टेंट। आइए एनालाइजर्स को कनेक्ट करें। जिन्हें आप कनेक्ट करना चाहते हैं उन्हें चुनें।",
    next: "बहुत बढ़िया। आइए इन्हें एक-एक करके कनेक्ट करें। आप सबसे पहले कौन सा उपकरण कनेक्ट करना चाहेंगे?",
    subtitle_welcome: "जिन्हें आप कनेक्ट करना चाहते हैं उन्हें चुनें",
    subtitle_next: "आप सबसे पहले कौन सा उपकरण कनेक्ट करना चाहेंगे?",
    btn_start: "शुरू करें",
    btn_continue: "आगे बढ़ें"
  }
};

import hinWelcomeMp3 from '../assets/mp3/hin-welcome.mp3';
import hinNextMp3 from '../assets/mp3/hin-next.mp3';

export default function Onboarding() {
  const [step, setStep] = useState(0); // 0: Start, 1: Select Multiple, 2: Queue
  const [lang, setLang] = useState('en');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selected, setSelected] = useState([]);
  const navigate = useNavigate();
  
  const audioRef = useRef(null);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const speak = (type) => {
    let src = null;
    if (type === 'welcome') src = hinWelcomeMp3;
    if (type === 'next') src = hinNextMp3;

    if (src) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(src);
      audioRef.current = audio;
      
      audio.onplay = () => setIsSpeaking(true);
      audio.onended = () => setIsSpeaking(false);
      audio.onerror = (e) => {
        console.error("Audio error", e);
        setIsSpeaking(false);
      };
      
      audio.play().catch(e => {
        console.error("Audio playback failed", e);
        setIsSpeaking(false);
      });
    }
  };

  const startExperience = () => {
    setStep(1);
    speak('welcome');
  };

  const handleContinue = () => {
    if (selected.length === 0) return;
    setStep(2);
    speak('next');
  };

  const handleSelectAnalyzer = (machine) => {
    if (machine.model === 'CliniQuant Micro') {
      navigate('/setup/cliniquant', { state: { prefill: machine } });
    } else {
      navigate('/setup', { state: { prefill: machine } });
    }
  };

  const toggleSelection = (machine) => {
    const exists = selected.find(m => m.model === machine.model);
    if (exists) {
      setSelected(selected.filter(m => m.model !== machine.model));
    } else {
      setSelected([...selected, machine]);
    }
  };

  return (
    <div className="onboarding-container">
      {step === 0 && (
        <div className="language-selector">
          <button className={`lang-btn ${lang === 'en' ? 'active' : ''}`} onClick={() => setLang('en')}>English</button>
          <button className={`lang-btn ${lang === 'hi' ? 'active' : ''}`} onClick={() => setLang('hi')}>हिंदी</button>
        </div>
      )}

      {/* Kyro Visualizer */}
      {(step > 0 || isSpeaking) && (
        <div className="kyro-orb-container">
          <div className={`kyro-orb ${isSpeaking ? 'speaking' : ''}`}></div>
          <div className="kyro-ring"></div>
        </div>
      )}

      {step === 0 && (
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '48px', marginBottom: '20px' }}>Welcome to LIS</h1>
          <p className="subtitle" style={{ marginBottom: '40px' }}>Your Intelligent Laboratory Command Center</p>
          <button className="start-btn" onClick={startExperience}>
            <Mic size={24} style={{ marginRight: '12px', verticalAlign: 'middle' }} />
            {DIALOGUE[lang].btn_start}
          </button>
        </div>
      )}

      {step === 1 && (
        <>
          <p className="subtitle">{DIALOGUE[lang].subtitle_welcome}</p>
          <div className="analyzer-grid">
            {ANALYZERS.map((m, i) => {
              const isSelected = selected.some(s => s.model === m.model);
              return (
                <div 
                  key={i} 
                  className={`analyzer-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => toggleSelection(m)}
                >
                  <span className="brand-badge">{m.brand}</span>
                  <div className="model-name">{m.model}</div>
                  {isSelected && (
                    <div style={{ marginTop: '16px', color: '#38bdf8' }}>
                      <Check size={24} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {selected.length > 0 && (
            <button className="start-btn" onClick={handleContinue}>
              {DIALOGUE[lang].btn_continue}
              <ArrowRight size={20} style={{ marginLeft: '12px', verticalAlign: 'middle' }} />
            </button>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <p className="subtitle">{DIALOGUE[lang].subtitle_next}</p>
          <div className="queue-list">
            {selected.map((m, i) => (
              <div key={i} className="queue-item" onClick={() => handleSelectAnalyzer(m)}>
                <div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px' }}>{m.brand}</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold' }}>{m.model}</div>
                </div>
                <ArrowRight color="#38bdf8" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
