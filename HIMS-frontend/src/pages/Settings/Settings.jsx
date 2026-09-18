import { useState, useEffect } from 'react';
import {
  Building2,
  Mail,
  CreditCard,
  Bell,
  Globe,
  Hospital,
  Plus,
  Trash2,
  Pencil,
  Save,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';

const API_URL = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });
// VAPT #23 (Clipboard Data Stealing Attack): matches Login.jsx/ChangePassword.jsx.
const blockClipboard = (e) => e.preventDefault();

function Settings() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [activeTab, setActiveTab] = useState('about');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Facility Setup State
  const [categories, setCategories] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editDistrict, setEditDistrict] = useState(null);
  const [editDistrictName, setEditDistrictName] = useState('');

  const roleLevel = localStorage.getItem('role_level') || 'Branch';

  const [form, setForm] = useState({
    hospital_name: 'MERIL HIMS',
    logo_url: '/meril_hims_logo.png',
    address: '',
    phone: '',
    website: '',
    email: '',
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_pass: '',
    smtp_from_name: 'HIMS Procurement',
    registration_fee: 15.00,
  });

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/settings`, { headers: authHdr() });
      const data = await res.json();
      if (data.success && data.data) {
        setForm({
          hospital_name: data.data.hospital_name || 'MERIL HIMS',
          logo_url: data.data.logo_url || '',
          address: data.data.address || '',
          phone: data.data.phone || '',
          website: data.data.website || '',
          email: data.data.email || '',
          smtp_host: data.data.smtp_host || '',
          smtp_port: data.data.smtp_port || 587,
          smtp_user: data.data.smtp_user || '',
          smtp_pass: data.data.smtp_pass || '',
          smtp_from_name: data.data.smtp_from_name || 'HIMS Procurement',
          registration_fee: data.data.registration_fee || 15.00,
        });
      }
    } catch {
      showAlert('error', 'Failed to fetch settings');
    }
    setLoading(false);
  };

  const fetchFacilities = async () => {
    try {
      const res = await fetch(`${API_URL}/api/branches`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) {
        setCategories(data.categories || []);
        setDistricts(data.districts || []);
      }
    } catch (err) {
      console.error('Failed to fetch facilities', err);
    }
  };

  useEffect(() => {
    fetchSettings();
    if (roleLevel === 'Central' || roleLevel === 'Sub-Central') {
      fetchFacilities();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        // Create an image to get its dimensions and draw to canvas
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          // Export as PNG (guaranteed compatibility with PDF generator)
          const pngData = canvas.toDataURL('image/png');
          setForm({ ...form, logo_url: pngData });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (data.success) {
        showAlert('success', 'Hospital Settings updated successfully');
        // This won't automatically update Sidebar unless Sidebar uses Context,
        // but for now, we'll force a reload if they want to see the new logo globally.
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        showAlert('error', data.message);
      }
    } catch {
      showAlert('error', 'Failed to update settings');
    }
    setSaving(false);
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/branches/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ name: newCategoryName })
      });
      const data = await res.json();
      if (data.success) {
        setNewCategoryName('');
        fetchFacilities();
        showAlert('success', 'Category added');
      } else showAlert('error', data.message || 'Error creating category');
    } catch { showAlert('error', 'Server error'); }
  };

  const handleDeleteCategory = async (id) => {
    if (!window.confirm('Delete this category?')) return;
    try {
      const res = await fetch(`${API_URL}/api/branches/categories/${id}`, { method: 'DELETE', headers: authHdr() });
      const data = await res.json();
      if (data.success) { fetchFacilities(); showAlert('success', 'Category deleted'); }
      else showAlert('error', data.message || 'Error deleting category');
    } catch { showAlert('error', 'Server error'); }
  };

  const handleUpdateDistrict = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/branches/district/${editDistrict.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ name: editDistrictName })
      });
      const data = await res.json();
      if (data.success) {
        setEditDistrict(null);
        fetchFacilities();
        showAlert('success', 'District updated');
      } else showAlert('error', data.message || 'Error updating district');
    } catch { showAlert('error', 'Server error'); }
  };

  const handleDeleteDistrict = async (id) => {
    if (!window.confirm('Delete this district?')) return;
    try {
      const res = await fetch(`${API_URL}/api/branches/district/${id}`, { method: 'DELETE', headers: authHdr() });
      const data = await res.json();
      if (data.success) { fetchFacilities(); showAlert('success', 'District deleted'); }
      else showAlert('error', data.message || 'Error deleting district');
    } catch { showAlert('error', 'Server error'); }
  };

  return (
    <div style={{ flex: 1, padding: '32px', overflowY: 'auto', background: 'var(--sys-bg)', fontFamily: 'Outfit, sans-serif' }}>
      {alert && <Alert type={alert.type} message={alert.message} onClose={hideAlert} />}

      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, margin: 0, color: 'var(--text-dark)' }}>System Settings</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-soft)', marginTop: '4px' }}>Configure hospital-wide configurations and preferences.</p>
      </div>

      <div style={{ display: 'flex', gap: '24px' }}>
        {/* Settings Sidebar Tabs */}
        <div style={{ width: '250px', background: 'white', borderRadius: 'var(--radius-lg)', padding: '16px', boxShadow: 'var(--shadow-sm)', alignSelf: 'flex-start' }}>
          <button
            onClick={() => setActiveTab('about')}
            style={{ width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', background: activeTab === 'about' ? 'var(--blue-pale)' : 'transparent', color: activeTab === 'about' ? 'var(--blue-primary)' : 'var(--text-mid)', fontWeight: 600, borderRadius: '8px', cursor: 'pointer', marginBottom: '8px', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '10px' }}
          >
            <Building2 size={18} /> About (Hospital Profile)
          </button>
          <button
            onClick={() => setActiveTab('email')}
            style={{ width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', background: activeTab === 'email' ? 'var(--blue-pale)' : 'transparent', color: activeTab === 'email' ? 'var(--blue-primary)' : 'var(--text-mid)', fontWeight: 600, borderRadius: '8px', cursor: 'pointer', marginBottom: '8px', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '10px' }}
          >
            <Mail size={18} /> Email & SMTP
          </button>
          <button
            onClick={() => setActiveTab('billing')}
            style={{ width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', background: activeTab === 'billing' ? 'var(--blue-pale)' : 'transparent', color: activeTab === 'billing' ? 'var(--blue-primary)' : 'var(--text-mid)', fontWeight: 600, borderRadius: '8px', cursor: 'pointer', marginBottom: '8px', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '10px' }}
          >
            <CreditCard size={18} /> Billing & Taxes
          </button>
          <button
            onClick={() => setActiveTab('notifications')}
            style={{ width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', background: activeTab === 'notifications' ? 'var(--blue-pale)' : 'transparent', color: activeTab === 'notifications' ? 'var(--blue-primary)' : 'var(--text-mid)', fontWeight: 600, borderRadius: '8px', cursor: 'pointer', marginBottom: '8px', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '10px' }}
          >
            <Bell size={18} /> Notifications
          </button>
          <button
            onClick={() => setActiveTab('localization')}
            style={{ width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', background: activeTab === 'localization' ? 'var(--blue-pale)' : 'transparent', color: activeTab === 'localization' ? 'var(--blue-primary)' : 'var(--text-mid)', fontWeight: 600, borderRadius: '8px', cursor: 'pointer', marginBottom: '8px', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '10px' }}
          >
            <Globe size={18} /> Localization
          </button>
          {(roleLevel === 'Central' || roleLevel === 'Sub-Central') && (
            <button
              onClick={() => setActiveTab('facilities')}
              style={{ width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', background: activeTab === 'facilities' ? 'var(--blue-pale)' : 'transparent', color: activeTab === 'facilities' ? 'var(--blue-primary)' : 'var(--text-mid)', fontWeight: 600, borderRadius: '8px', cursor: 'pointer', marginBottom: '8px', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '10px' }}
            >
              <Hospital size={18} /> Facility Setup
            </button>
          )}
        </div>

        {/* Main Content Area */}
        <div style={{ flex: 1, background: 'white', borderRadius: 'var(--radius-lg)', padding: '32px', boxShadow: 'var(--shadow-sm)' }}>
          {activeTab === 'about' && (
            <form onSubmit={handleSave}>
              <h2 style={{ fontSize: '20px', margin: '0 0 24px 0', borderBottom: '1px solid var(--border-light)', paddingBottom: '16px' }}>Hospital Profile Configuration</h2>

              {loading ? (
                <p>Loading settings...</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

                  {/* Left Column */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-label)', marginBottom: '8px' }}>Hospital Name *</label>
                      <input
                        type="text"
                        required
                        value={form.hospital_name}
                        onChange={e => setForm({ ...form, hospital_name: e.target.value })}
                        style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-light)', borderRadius: '6px', background: 'var(--bg-input)' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-label)', marginBottom: '8px' }}>Hospital Logo</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        {form.logo_url && (
                          <div style={{ width: '60px', height: '60px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-light)', background: '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img src={form.logo_url} alt="Logo Preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                          </div>
                        )}
                        <div style={{ flex: 1 }}>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleLogoUpload}
                            style={{ width: '100%', padding: '8px', border: '1px dashed var(--border-light)', borderRadius: '6px', background: 'var(--bg-input)', cursor: 'pointer' }}
                          />
                          <small style={{ color: 'var(--text-soft)', marginTop: '4px', display: 'block' }}>Upload a high-quality logo (PNG, JPG, SVG).</small>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-label)', marginBottom: '8px' }}>Official Email</label>
                      <input
                        type="email"
                        value={form.email}
                        onChange={e => setForm({ ...form, email: e.target.value })}
                        style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-light)', borderRadius: '6px', background: 'var(--bg-input)' }}
                      />
                    </div>
                  </div>

                  {/* Right Column */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-label)', marginBottom: '8px' }}>Phone Number</label>
                      <input
                        type="text"
                        value={form.phone}
                        onChange={e => setForm({ ...form, phone: e.target.value })}
                        style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-light)', borderRadius: '6px', background: 'var(--bg-input)' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-label)', marginBottom: '8px' }}>Website</label>
                      <input
                        type="text"
                        value={form.website}
                        onChange={e => setForm({ ...form, website: e.target.value })}
                        style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-light)', borderRadius: '6px', background: 'var(--bg-input)' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-label)', marginBottom: '8px' }}>Full Address</label>
                      <textarea
                        rows="4"
                        value={form.address}
                        onChange={e => setForm({ ...form, address: e.target.value })}
                        style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-light)', borderRadius: '6px', background: 'var(--bg-input)', resize: 'vertical' }}
                      />
                    </div>
                  </div>

                </div>
              )}
              <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="submit"
                  disabled={saving || loading}
                  style={{ background: 'var(--blue-primary)', color: 'white', padding: '10px 24px', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <Save size={18} /> {saving ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'email' && (
            <form onSubmit={handleSave}>
              <h2 style={{ fontSize: '20px', margin: '0 0 8px 0', borderBottom: '1px solid var(--border-light)', paddingBottom: '16px' }}>Email & SMTP Configuration</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-soft)', marginBottom: '24px' }}>These credentials are used to send Purchase Order emails to vendors automatically.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-label)', marginBottom: '8px' }}>SMTP Host</label>
                  <input type="text" placeholder="smtp.gmail.com" value={form.smtp_host} onChange={e => setForm({ ...form, smtp_host: e.target.value })}
                    style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-light)', borderRadius: '6px', background: 'var(--bg-input)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-label)', marginBottom: '8px' }}>SMTP Port</label>
                  <input type="number" placeholder="587" value={form.smtp_port} onChange={e => setForm({ ...form, smtp_port: e.target.value })}
                    style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-light)', borderRadius: '6px', background: 'var(--bg-input)' }} />
                  <small style={{ color: 'var(--text-soft)' }}>Use 587 for TLS, 465 for SSL</small>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-label)', marginBottom: '8px' }}>SMTP Username (Email)</label>
                  <input type="text" placeholder="yourmail@gmail.com" value={form.smtp_user} onChange={e => setForm({ ...form, smtp_user: e.target.value })}
                    style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-light)', borderRadius: '6px', background: 'var(--bg-input)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-label)', marginBottom: '8px' }}>SMTP Password / App Password</label>
                  <input type="password" placeholder="••••••••••••" value={form.smtp_pass} onChange={e => setForm({ ...form, smtp_pass: e.target.value })}
                    onCopy={blockClipboard} onCut={blockClipboard} onPaste={blockClipboard} autoComplete="new-password"
                    style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-light)', borderRadius: '6px', background: 'var(--bg-input)' }} />
                  <small style={{ color: 'var(--text-soft)' }}>For Gmail: use an App Password, not your login password</small>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-label)', marginBottom: '8px' }}>From Display Name</label>
                  <input type="text" placeholder="HIMS Procurement" value={form.smtp_from_name} onChange={e => setForm({ ...form, smtp_from_name: e.target.value })}
                    style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-light)', borderRadius: '6px', background: 'var(--bg-input)' }} />
                  <small style={{ color: 'var(--text-soft)' }}>This name appears as the sender in vendor emails</small>
                </div>
              </div>
              <div style={{ marginTop: '24px', padding: '16px', background: '#fefce8', borderRadius: '8px', border: '1px solid #fde68a' }}>
                <strong style={{ color: '#92400e' }}>💡 Gmail Tip:</strong>
                <span style={{ color: '#78350f', fontSize: '13px' }}> Enable 2FA on your Google account → go to <em>Security → App Passwords</em> → generate a password for "Mail". Use that as SMTP password.</span>
              </div>
              <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" disabled={saving} style={{ background: 'var(--blue-primary)', color: 'white', padding: '10px 24px', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Save size={18} /> {saving ? 'Saving...' : 'Save SMTP Settings'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'facilities' && (roleLevel === 'Central' || roleLevel === 'Sub-Central') && (
            <div>
              <h2 style={{ fontSize: '20px', margin: '0 0 24px 0', borderBottom: '1px solid var(--border-light)', paddingBottom: '16px' }}>Facility & Network Setup</h2>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
                {/* Categories */}
                <div>
                  <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Facility Categories</h3>
                  <form onSubmit={handleAddCategory} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                    <input type="text" required value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder="New category name" style={{ flex: 1, padding: '8px', border: '1px solid var(--border-light)', borderRadius: '6px' }} />
                    <button type="submit" style={{ background: 'var(--blue-primary)', color: 'white', padding: '8px 16px', border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Plus size={16} /> Add
                    </button>
                  </form>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {categories.map(c => (
                      <li key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', border: '1px solid var(--border-light)', borderRadius: '6px', marginBottom: '8px', background: 'var(--bg-input)', alignItems: 'center' }}>
                        {c.name}
                        <button onClick={() => handleDeleteCategory(c.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Trash2 size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Districts */}
                <div>
                  <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Manage Districts</h3>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {districts.map(d => (
                      <li key={d.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', border: '1px solid var(--border-light)', borderRadius: '6px', marginBottom: '8px', background: 'var(--bg-input)' }}>
                        {editDistrict && editDistrict.id === d.id ? (
                          <form onSubmit={handleUpdateDistrict} style={{ display: 'flex', gap: '8px', width: '100%', alignItems: 'center' }}>
                            <input autoFocus required value={editDistrictName} onChange={e => setEditDistrictName(e.target.value)} style={{ flex: 1, padding: '8px', border: '1px solid var(--blue-primary)', borderRadius: '4px' }} />
                            <button type="submit" style={{ background: 'var(--blue-primary)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: '8px 12px' }}>Save</button>
                            <button type="button" onClick={() => setEditDistrict(null)} style={{ background: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: '8px 12px' }}>Cancel</button>
                          </form>
                        ) : (
                          <>
                            {d.name}
                            <div style={{ display: 'flex', gap: '12px' }}>
                              <button onClick={() => { setEditDistrict(d); setEditDistrictName(d.name); }} style={{ background: 'none', border: 'none', color: 'var(--blue-primary)', cursor: 'pointer', fontWeight: 600 }}>
                                <Pencil size={16} />
                              </button>
                              <button onClick={() => handleDeleteDistrict(d.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 600 }}>
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'localization' && (
            <div>
              <h2 style={{ fontSize: '20px', margin: '0 0 8px 0', borderBottom: '1px solid var(--border-light)', paddingBottom: '16px' }}>System Language & Localization</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-soft)', marginBottom: '24px' }}>Choose your preferred language. The system will automatically translate the entire interface.</p>

              <div style={{ maxWidth: '400px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-label)', marginBottom: '8px' }}>Select Display Language</label>
                <select
                  className="notranslate"
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-light)', borderRadius: '6px', background: 'var(--bg-input)', fontSize: '14px' }}
                  onChange={(e) => {
                    const lang = e.target.value;
                    const hostname = window.location.hostname;
                    if (lang === 'en') {
                      const paths = ['/', '/settings', window.location.pathname];
                      paths.forEach(p => {
                        document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=${p};`;
                        document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; domain=${hostname}; path=${p};`;
                        document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; domain=.${hostname}; path=${p};`;
                      });
                    } else {
                      document.cookie = `googtrans=/en/${lang}; path=/; domain=${hostname}`;
                      document.cookie = `googtrans=/en/${lang}; path=/; domain=.${hostname}`;
                      document.cookie = `googtrans=/en/${lang}; path=/;`;
                    }
                    window.location.reload();
                  }}
                  defaultValue={() => {
                    const match = document.cookie.match(/googtrans=\/en\/([a-z]{2})/);
                    return match ? match[1] : 'en';
                  }}
                >
                  <option value="en">English (Default)</option>
                  <option value="hi">Hindi (हिंदी)</option>
                  <option value="ta">Tamil (தமிழ்)</option>
                  <option value="kn">Kannada (ಕನ್ನಡ)</option>
                  <option value="te">Telugu (తెలుగు)</option>
                  <option value="ml">Malayalam (മലയാളം)</option>
                  <option value="mr">Marathi (मराठी)</option>
                  <option value="bn">Bengali (বাংলা)</option>
                  <option value="gu">Gujarati (ગુજરાતી)</option>
                </select>
                <div style={{ marginTop: '24px', padding: '16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <Sparkles size={20} color="#166534" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <strong style={{ color: '#166534', fontSize: '14px' }}>Real-Time Translation</strong>
                    <p style={{ color: '#15803d', fontSize: '13px', margin: '4px 0 0 0' }}>This feature uses Google Translate to instantly localize all dashboard text, patient records, and system settings into your local Indian language.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'billing' && (
            <form onSubmit={handleSave}>
              <h2 style={{ fontSize: '20px', margin: '0 0 8px 0', borderBottom: '1px solid var(--border-light)', paddingBottom: '16px' }}>Billing & Financial Settings</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-soft)', marginBottom: '24px' }}>Configure default fees and billing-related parameters.</p>

              <div style={{ maxWidth: '400px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-label)', marginBottom: '8px' }}>Patient Registration Fee (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={form.registration_fee}
                  onChange={e => setForm({ ...form, registration_fee: e.target.value ? parseFloat(e.target.value) : '' })}
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-light)', borderRadius: '6px', background: 'var(--bg-input)' }}
                />
                <small style={{ color: 'var(--text-soft)', marginTop: '4px', display: 'block' }}>This fee is automatically applied in the Billing tab for new patient registrations.</small>
              </div>

              <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="submit"
                  disabled={saving || loading}
                  style={{ background: 'var(--blue-primary)', color: 'white', padding: '10px 24px', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <Save size={18} /> {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          )}

          {activeTab !== 'about' && activeTab !== 'email' && activeTab !== 'facilities' && activeTab !== 'localization' && activeTab !== 'billing' && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-soft)' }}>
              <h3>Module Under Construction</h3>
              <p>Additional configuration options will be available soon.</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default Settings;
