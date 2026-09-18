import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../assets/CSS/Login.css';

const API_URL = import.meta.env.VITE_API_URL || '';

// VAPT #16: self-service password change, also used as the forced landing
// page when a login response carries passwordChangeRequired (see
// RequireAuth in App.jsx and the flag set in Login.jsx).
function ChangePassword() {
  const navigate = useNavigate();
  const forced = localStorage.getItem('password_change_required') === '1';
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const blockClipboard = (e) => e.preventDefault();

  const handleChange = (e) => {
    setError('');
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('hims_token')}`,
        },
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Password change failed');

      localStorage.setItem('password_change_required', '0');
      setSuccess('Password changed successfully.');
      setTimeout(() => navigate('/dashboard', { replace: true }), 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <main className="auth-main" style={{ width: '100%' }}>
        <div className="auth-card-container">
          <div className="auth-card">
            <header className="auth-header">
              <h1 className="auth-title">Change Password</h1>
              <p className="auth-subtitle">
                {forced
                  ? 'Your account requires a password change before continuing.'
                  : 'Update your account password.'}
              </p>
            </header>

            {error && <div className="alert alert-error" role="alert">{error}</div>}
            {success && <div className="alert alert-success" role="alert">{success}</div>}

            <form className="auth-form" onSubmit={handleSubmit} noValidate autoComplete="off">
              <div className="form-group">
                <label className="field-label">Current Password</label>
                <input
                  type="password"
                  name="currentPassword"
                  className="field-input"
                  value={form.currentPassword}
                  onChange={handleChange}
                  autoComplete="off"
                  onCopy={blockClipboard}
                  onCut={blockClipboard}
                  onPaste={blockClipboard}
                  required
                />
              </div>
              <div className="form-group" style={{ marginTop: '20px' }}>
                <label className="field-label">New Password</label>
                <input
                  type="password"
                  name="newPassword"
                  className="field-input"
                  value={form.newPassword}
                  onChange={handleChange}
                  autoComplete="off"
                  onCopy={blockClipboard}
                  onCut={blockClipboard}
                  onPaste={blockClipboard}
                  required
                />
              </div>
              <div className="form-group" style={{ marginTop: '20px' }}>
                <label className="field-label">Confirm New Password</label>
                <input
                  type="password"
                  name="confirmPassword"
                  className="field-input"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  autoComplete="off"
                  onCopy={blockClipboard}
                  onCut={blockClipboard}
                  onPaste={blockClipboard}
                  required
                />
              </div>

              <button type="submit" className="btn-login-new" disabled={loading} style={{ marginTop: '24px' }}>
                {loading ? 'Saving...' : 'Change Password'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}

export default ChangePassword;
