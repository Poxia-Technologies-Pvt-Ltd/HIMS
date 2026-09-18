import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import merilLogo from '../assets/meril.png';
import '../assets/CSS/Login.css';

// Replaces the old email/password Login screen entirely — there is no user
// session here. An Admin generates one permanent key per machine
// (HIMS-backend /api/dev-keys), the technician pastes it in here exactly
// once, and it's stored encrypted on this machine (main/deviceKeyStore.js)
// for good. No more logins, no session timeouts logging an unattended lab
// PC out mid-shift — only an explicit Admin revoke ends it, at which point
// this screen reappears on its own (see onActivationRequired below).
export default function Activation() {
    const navigate = useNavigate();
    const [key, setKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        (async () => {
            try {
                const status = await window.electronAPI.getDeviceKeyStatus();
                if (status?.activated) {
                    navigate('/setup');
                    return;
                }
            } catch (err) {
                console.error('Could not check activation status:', err);
            }
            setChecking(false);
        })();

        // Fires if a previously-activated key is revoked while the app is
        // already running past this screen — brings the technician back here.
        const off = window.electronAPI.onActivationRequired?.(() => {
            setChecking(false);
            navigate('/');
        });
        return () => off?.();
    }, [navigate]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!key.trim()) {
            setError('Enter the device key given to you by your admin.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const result = await window.electronAPI.activateDeviceKey(key.trim());
            if (!result?.ok) {
                setError(result?.message || 'Could not activate this key.');
                return;
            }

            if (result.branch_id) {
                localStorage.setItem('branch_id', result.branch_id);
                localStorage.setItem('labId', result.branch_id);
                await window.electronAPI.saveSetting('labId', result.branch_id);
            }
            if (result.role) localStorage.setItem('role', result.role);
            localStorage.setItem('device_label', result.label || '');

            navigate('/setup');
        } catch (err) {
            setError(err.message || 'Network error while activating.');
        } finally {
            setLoading(false);
        }
    };

    if (checking) return null;

    return (
        <div className="auth-page">
            <main className="auth-main" style={{ width: '100%', flex: '1 1 100%', maxWidth: '100%' }}>
                <div className="auth-card-container">
                    <div className="brand-header">
                        <img src={merilLogo} alt="Karnataka LIMS Logo" className="brand-logo-img" />
                        <span className="product-name">Karnataka LIS Agent</span>
                        <p className="brand-motto">Machine Connectivity Hub</p>
                    </div>

                    <div className="auth-card">
                        <header className="auth-header">
                            <h1 className="auth-title">Activate this machine</h1>
                            <p className="auth-subtitle">
                                Paste the device key your admin generated for this workstation. No account or
                                password is needed — this only has to be done once.
                            </p>
                        </header>

                        {error && (
                            <div className="alert alert-error" role="alert">
                                {error}
                            </div>
                        )}

                        <form className="auth-form" onSubmit={handleSubmit}>
                            <div className="form-group">
                                <label className="field-label">Device key</label>
                                <input
                                    type="text"
                                    className="field-input"
                                    style={{ fontFamily: 'monospace' }}
                                    placeholder="Paste the key here"
                                    value={key}
                                    onChange={(e) => { setError(''); setKey(e.target.value); }}
                                    autoFocus
                                    required
                                />
                            </div>

                            <button type="submit" className="btn-login-new" style={{ marginTop: '24px' }} disabled={loading}>
                                {loading ? 'Activating…' : 'Activate'}
                            </button>
                        </form>

                        <p style={{ fontSize: 12, color: '#8a94a6', marginTop: 18, textAlign: 'center' }}>
                            Don't have a key? Ask your lab administrator to generate one for this machine.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}
