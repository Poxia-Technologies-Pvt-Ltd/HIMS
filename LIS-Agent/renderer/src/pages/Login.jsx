import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import DOMPurify from 'dompurify';
import m1 from '../assets/m1.png';
import m2 from '../assets/m2.png';
import m3 from '../assets/m3.png';
import merilLogo from '../assets/meril.png';
import '../assets/CSS/Login.css';
import { API_BASE } from '../apiBase';
import { useCaptcha } from '../hooks/useCaptcha';

// Only lab staff may use this agent — mirrors the backend's ROLE_ALIASES normalization
// (HIMS-backend/middleware/auth.js) so legacy slug values like "lab_tech" still match.
const ROLE_ALIASES = {
    'lab_tech': 'Lab Technician',
    'lab_doctor': 'Lab Head',
    'lab doctor': 'Lab Head',
};
const ALLOWED_ROLES = ['Lab Technician', 'Lab Head', 'Lab Admin'];

const isLabRole = (role) => {
    const normalized = ROLE_ALIASES[(role || '').toLowerCase()] || role;
    return ALLOWED_ROLES.includes(normalized);
};

export default function Login() {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [captchaText, setCaptchaText] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [currentSlide, setCurrentSlide] = useState(0);
    const { svg: captchaSvg, captchaId, refresh: refreshCaptcha, applyCaptcha } = useCaptcha();

    const slides = [
        { image: m1, text: 'Innovation for better healthcare' },
        { image: m2, text: 'State-of-the-art diagnostic facilities' },
        { image: m3, text: 'Serving humanity with care' }
    ];

    useEffect(() => {
        // Auto-login check — the session itself lives in an HttpOnly cookie
        // (unreadable from here by design), so `user` being present is the
        // best signal available that a previous login succeeded. If the
        // cookie has since expired, the first authenticated API call 401s
        // and main.jsx's response interceptor already bounces back here.
        const user = localStorage.getItem('user');
        if (user) {
            navigate('/setup');
        }

        const timer = setInterval(() => {
            setCurrentSlide(prev => (prev + 1) % slides.length);
        }, 5000);
        return () => clearInterval(timer);
    }, [navigate, slides.length]);

    const handleChange = (e) => {
        setError('');
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.email || !formData.password) {
            setError('Please fill in all fields.');
            return;
        }
        if (!captchaText) {
            setError('Please enter the captcha text.');
            return;
        }
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    email: formData.email,
                    password: formData.password,
                    captchaId,
                    captchaText
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                const err = new Error(data.message || 'Login failed');
                err.status = response.status;
                err.captcha = data.captcha;
                throw err;
            }

            if (!isLabRole(data.role)) {
                throw new Error('This app is restricted to lab staff (Lab Technician, Lab Head, Lab Admin).');
            }

            // Store auth data — the session token itself lives only in the
            // HttpOnly cookie the login response just set (never handed to
            // renderer JS), so there's no token here to persist locally.
            // The CSRF token is different — it's deliberately returned in the
            // JSON body (not the cookie) because every mutating request
            // (POST/PUT/PATCH/DELETE) needs to send it back as an
            // X-CSRF-Token header, and it rotates on every such request
            // (see main.jsx's response interceptor, which keeps it updated).
            if (data.csrfToken) localStorage.setItem('csrf_token', data.csrfToken);
            if (data.branch_id) localStorage.setItem('branch_id', data.branch_id);
            if (data.role) localStorage.setItem('role', data.role);
            if (data.role_level) localStorage.setItem('role_level', data.role_level);

            // Store user object for easier access to ID
            localStorage.setItem('user', JSON.stringify(data));

            // For LIS Agent specific context
            localStorage.setItem("labId", data.branch_id);
            await window.electronAPI.saveSetting('labId', data.branch_id);

            navigate('/setup');
        } catch (err) {
            setError(err.message);
            if (err.status === 429) {
                // IP is locked out for 24h — nothing left to retry, no captcha comes
                // back with this response, so just leave the form as-is.
            } else {
                // The captcha is single-use on the server regardless of outcome, so
                // a failed attempt needs a fresh one before the user can retry.
                setCaptchaText('');
                applyCaptcha(err.captcha);
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page">
            {/* ── Left Panel: Carousel ── */}
            <aside className="auth-aside" aria-hidden="true">
                <div className="carousel-container">
                    {slides.map((slide, index) => (
                        <div
                            key={index}
                            className={`carousel-slide ${index === currentSlide ? 'active' : ''}`}
                            style={{ backgroundImage: `url(${slide.image})` }}
                        >
                            <div className="carousel-content">
                                <div className="carousel-badge">
                                    <span className="carousel-badge-dot"></span>
                                    Karnataka LIS — Agent
                                </div>
                                <p className="carousel-text">{slide.text}</p>
                            </div>
                        </div>
                    ))}
                    <div className="carousel-indicators">
                        {slides.map((_, index) => (
                            <div
                                key={index}
                                className={`indicator ${index === currentSlide ? 'active' : ''}`}
                                onClick={() => setCurrentSlide(index)}
                            />
                        ))}
                    </div>
                </div>
            </aside>

            {/* ── Right Panel: Form ── */}
            <main className="auth-main">
                <div className="auth-card-container">
                    <div className="brand-header">
                        <img src={merilLogo} alt="Karnataka LIMS Logo" className="brand-logo-img" />
                        <span className="product-name">Karnataka LIS Agent</span>
                        <p className="brand-motto">Machine Connectivity Hub</p>
                    </div>

                    <div className="auth-card">
                        <header className="auth-header">
                            <h1 className="auth-title">Agent Login</h1>
                            <p className="auth-subtitle">Connect your machines to Karnataka LIS</p>
                        </header>

                        {error && (
                            <div className="alert alert-error" role="alert">
                                {error}
                            </div>
                        )}

                        <form className="auth-form" onSubmit={handleSubmit}>
                            <div className="form-group">
                                <label className="field-label">Email</label>
                                <input
                                    type="email"
                                    name="email"
                                    className="field-input"
                                    placeholder="admin@test.com"
                                    value={formData.email}
                                    onChange={handleChange}
                                    required
                                />
                            </div>

                            <div className="form-group" style={{ marginTop: '20px' }}>
                                <label className="field-label">Password</label>
                                <div className="input-with-toggle">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        name="password"
                                        className="field-input"
                                        placeholder="••••••••"
                                        value={formData.password}
                                        onChange={handleChange}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="toggle-eye"
                                        onClick={() => setShowPassword(!showPassword)}
                                    >
                                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                            <circle cx="12" cy="12" r="3" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            <div className="form-group" style={{ marginTop: '20px' }}>
                                <label className="field-label">Captcha</label>
                                <div className="captcha-row">
                                    <div
                                        className="captcha-image"
                                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(captchaSvg, { USE_PROFILES: { svg: true, svgFilters: true } }) }}
                                    />
                                    <button
                                        type="button"
                                        className="captcha-refresh"
                                        onClick={() => { setCaptchaText(''); refreshCaptcha(); }}
                                        aria-label="Refresh captcha"
                                        title="Refresh captcha"
                                    >
                                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M23 4v6h-6M1 20v-6h6" />
                                            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                                        </svg>
                                    </button>
                                </div>
                                <input
                                    type="text"
                                    name="captchaText"
                                    className="field-input"
                                    placeholder="Enter the text shown above"
                                    value={captchaText}
                                    onChange={(e) => setCaptchaText(e.target.value)}
                                    autoComplete="off"
                                    required
                                />
                            </div>

                            <button
                                type="submit"
                                className="btn-login-new"
                                style={{ marginTop: '20px' }}
                                disabled={loading}
                            >
                                {loading ? 'Authenticating...' : 'Connect Agent'}
                            </button>
                        </form>
                    </div>
                </div>
            </main>
        </div>
    );
}