import { useState, useEffect } from 'react';
import { UserCog, Plus, Trash2, Save } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'];

const inputStyle = { padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, width: '100%', boxSizing: 'border-box' };
const btnStyle = { padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 };

const EMPTY_NEW = { field_key: '', label: '', field_type: 'text', options_csv: '', is_required: false };

// Admin control over patient registration's demographic fields (spec item
// #1: "configurable identifiers and demographic fields"). 'system' rows map
// to a real patients.<column> — relabel/require/hide only, never delete or
// re-type, since the column and its meaning are fixed. 'custom' rows are
// fully admin-defined and store their values in patient_custom_field_values
// (no schema change needed to add one) — see patientFieldConfigController.js
// and PatientDetails.jsx's "Additional Information" section, which renders
// both kinds dynamically.
export default function PatientFieldConfig() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newField, setNewField] = useState(EMPTY_NEW);

  const fetchFields = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/patients/field-config`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) setFields(data.fields || []);
      else showAlert(data.message || 'Failed to load fields', 'error');
    } catch (err) {
      console.error(err);
      showAlert('Network error loading fields.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFields(); /* eslint-disable-next-line */ }, []);

  const updateField = (key, patch) => {
    setFields(prev => prev.map(f => (f.field_key === key ? { ...f, ...patch } : f)));
  };

  const saveField = async (f) => {
    setSaving(f.field_key);
    try {
      const res = await fetch(`${API_BASE}/api/patients/field-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          field_key: f.field_key,
          label: f.label,
          field_type: f.field_type,
          options_json: f.field_type === 'select'
            ? (Array.isArray(f.options_json) ? f.options_json : String(f.options_json || '').split(',').map(s => s.trim()).filter(Boolean))
            : null,
          is_required: f.is_required,
          is_enabled: f.is_enabled,
          display_order: f.display_order,
        }),
      });
      const data = await res.json();
      if (data.success) showAlert(`Saved "${f.label}".`, 'success');
      else showAlert(data.message || 'Save failed.', 'error');
    } catch (err) {
      console.error(err);
      showAlert('Network error saving.', 'error');
    } finally {
      setSaving(null);
    }
  };

  const createCustomField = async () => {
    if (!newField.field_key.trim() || !newField.label.trim()) {
      showAlert('Field key and label are required.', 'warning');
      return;
    }
    setSaving('__new__');
    try {
      const res = await fetch(`${API_BASE}/api/patients/field-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          field_key: newField.field_key.trim(),
          label: newField.label.trim(),
          field_type: newField.field_type,
          options_json: newField.field_type === 'select'
            ? newField.options_csv.split(',').map(s => s.trim()).filter(Boolean)
            : null,
          is_required: newField.is_required,
          is_enabled: true,
          display_order: (fields.length + 1) * 10,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showAlert(`Created "${newField.label}".`, 'success');
        setNewField(EMPTY_NEW);
        setShowAdd(false);
        fetchFields();
      } else {
        showAlert(data.message || 'Could not create field.', 'error');
      }
    } catch (err) {
      console.error(err);
      showAlert('Network error creating field.', 'error');
    } finally {
      setSaving(null);
    }
  };

  const deleteField = async (f) => {
    if (!window.confirm(`Delete custom field "${f.label}"? Any values already entered for it will be removed too.`)) return;
    setSaving(f.field_key);
    try {
      const res = await fetch(`${API_BASE}/api/patients/field-config/${f.field_key}`, { method: 'DELETE', headers: authHdr() });
      const data = await res.json();
      if (data.success) {
        showAlert(`Deleted "${f.label}".`, 'success');
        fetchFields();
      } else {
        showAlert(data.message || 'Delete failed.', 'error');
      }
    } catch (err) {
      console.error(err);
      showAlert('Network error deleting.', 'error');
    } finally {
      setSaving(null);
    }
  };

  const systemFields = fields.filter(f => f.field_source === 'system');
  const customFields = fields.filter(f => f.field_source === 'custom');

  return (
    <div style={{ padding: '28px 32px', background: '#f8fafc', minHeight: '100vh' }}>
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={4000} />}

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <UserCog size={22} color="#1d4ed8" /> Patient Field Config
        </h1>
        <p style={{ color: '#64748b', margin: '4px 0 0', fontSize: 14 }}>
          Control which demographic fields appear on patient registration, mark them required, and add new
          custom fields — no code change needed. Changes apply to every registration going forward.
        </p>
      </div>

      {/* System fields */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>Built-in Fields</h3>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94a3b8' }}>Relabel, require, or hide — these map to real database columns and can't be deleted.</p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Field', 'Label', 'Required', 'Shown', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading...</td></tr>}
              {!loading && systemFields.map(f => (
                <tr key={f.field_key} style={{ borderBottom: '1px solid #f8fafc', opacity: f.is_enabled ? 1 : 0.5 }}>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>{f.field_key}</td>
                  <td style={{ padding: '10px 14px', width: 220 }}>
                    <input style={inputStyle} value={f.label} onChange={e => updateField(f.field_key, { label: e.target.value })} />
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <input type="checkbox" checked={!!f.is_required} onChange={e => updateField(f.field_key, { is_required: e.target.checked })} />
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <input type="checkbox" checked={!!f.is_enabled} onChange={e => updateField(f.field_key, { is_enabled: e.target.checked })} />
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <button onClick={() => saveField(f)} disabled={saving === f.field_key}
                      style={{ ...btnStyle, background: '#eff6ff', color: '#1d4ed8', padding: '6px 12px', fontSize: 11 }}>
                      <Save size={12} /> {saving === f.field_key ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Custom fields */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>Custom Fields</h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94a3b8' }}>Fields you've added — no matching database column, values stored separately.</p>
          </div>
          <button onClick={() => setShowAdd(s => !s)} style={{ ...btnStyle, background: '#1d4ed8', color: '#fff' }}>
            <Plus size={14} /> {showAdd ? 'Cancel' : 'Add Field'}
          </button>
        </div>

        {showAdd && (
          <div style={{ padding: 20, borderBottom: '1px solid #f1f5f9', background: '#f8fafc', display: 'grid', gridTemplateColumns: '1fr 1fr 140px 1fr auto', gap: 10, alignItems: 'end' }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Field Key</label>
              <input style={inputStyle} placeholder="e.g. bloodDonorId" value={newField.field_key}
                onChange={e => setNewField(p => ({ ...p, field_key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') }))} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Label</label>
              <input style={inputStyle} placeholder="e.g. Blood Donor ID" value={newField.label}
                onChange={e => setNewField(p => ({ ...p, label: e.target.value }))} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Type</label>
              <select style={inputStyle} value={newField.field_type} onChange={e => setNewField(p => ({ ...p, field_type: e.target.value }))}>
                {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>
                {newField.field_type === 'select' ? 'Options (comma-separated)' : 'Required'}
              </label>
              {newField.field_type === 'select' ? (
                <input style={inputStyle} placeholder="A, B, C" value={newField.options_csv}
                  onChange={e => setNewField(p => ({ ...p, options_csv: e.target.value }))} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', height: 34 }}>
                  <input type="checkbox" checked={newField.is_required} onChange={e => setNewField(p => ({ ...p, is_required: e.target.checked }))} />
                </div>
              )}
            </div>
            <button onClick={createCustomField} disabled={saving === '__new__'} style={{ ...btnStyle, background: '#16a34a', color: '#fff' }}>
              {saving === '__new__' ? 'Creating…' : 'Create'}
            </button>
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Field', 'Label', 'Type', 'Required', 'Shown', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loading && customFields.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>No custom fields yet.</td></tr>
              )}
              {customFields.map(f => (
                <tr key={f.field_key} style={{ borderBottom: '1px solid #f8fafc', opacity: f.is_enabled ? 1 : 0.5 }}>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>{f.field_key}</td>
                  <td style={{ padding: '10px 14px', width: 200 }}>
                    <input style={inputStyle} value={f.label} onChange={e => updateField(f.field_key, { label: e.target.value })} />
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: '#475569' }}>{f.field_type}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <input type="checkbox" checked={!!f.is_required} onChange={e => updateField(f.field_key, { is_required: e.target.checked })} />
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <input type="checkbox" checked={!!f.is_enabled} onChange={e => updateField(f.field_key, { is_enabled: e.target.checked })} />
                  </td>
                  <td style={{ padding: '10px 14px', display: 'flex', gap: 6 }}>
                    <button onClick={() => saveField(f)} disabled={saving === f.field_key}
                      style={{ ...btnStyle, background: '#eff6ff', color: '#1d4ed8', padding: '6px 10px', fontSize: 11 }}>
                      <Save size={12} />
                    </button>
                    <button onClick={() => deleteField(f)} disabled={saving === f.field_key}
                      style={{ ...btnStyle, background: '#fef2f2', color: '#991b1b', padding: '6px 10px', fontSize: 11 }}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
