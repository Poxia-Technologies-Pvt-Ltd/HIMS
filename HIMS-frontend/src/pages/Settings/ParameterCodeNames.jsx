import { useState, useEffect } from 'react';
import { Save, Plus, Search } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

const thStyle = { textAlign: 'left', padding: '10px 12px', fontSize: '12px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' };
const tdStyle = { padding: '8px 12px', fontSize: '13px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' };
const inputStyle = { padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', width: '100%', boxSizing: 'border-box' };
const btnStyle = { padding: '8px 16px', borderRadius: '8px', border: 'none', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' };

// Every parameter code a report's PDF might show — driven by
// parameter_code_names (see pdfGenerator.js's displayParameterName), which
// is what turns a raw analyzer code like "WBC" into "White Blood Cell
// Count" on the printed report. Admin-only: reviewable and editable here so
// anything an analyzer sends that isn't covered yet can be added, or a
// wrong name corrected, without a code change.
export default function ParameterCodeNames() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(null); // id (or 'new') currently saving
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/lab/parameter-codes`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) setRows(data.parameters || []);
      else showAlert(data.message || 'Failed to load parameter names', 'error');
    } catch (err) {
      console.error(err);
      showAlert('Network error loading parameter names.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRows(); /* eslint-disable-next-line */ }, []);

  const handleNameChange = (id, value) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, name: value } : r)));
  };

  const saveRow = async (row) => {
    if (!row.name.trim()) {
      showAlert('Name cannot be empty.', 'warning');
      return;
    }
    setSaving(row.id);
    try {
      const res = await fetch(`${API_BASE}/api/lab/parameter-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ code: row.code, name: row.name }),
      });
      const data = await res.json();
      if (data.success) showAlert(`Saved "${row.code}".`, 'success');
      else showAlert(data.message || 'Save failed.', 'error');
    } catch (err) {
      console.error(err);
      showAlert('Network error saving.', 'error');
    } finally {
      setSaving(null);
    }
  };

  const addNew = async () => {
    const code = newCode.trim();
    const name = newName.trim();
    if (!code || !name) {
      showAlert('Enter both a code and a name.', 'warning');
      return;
    }
    setSaving('new');
    try {
      const res = await fetch(`${API_BASE}/api/lab/parameter-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ code, name }),
      });
      const data = await res.json();
      if (data.success) {
        showAlert(`Added "${code}".`, 'success');
        setNewCode('');
        setNewName('');
        fetchRows();
      } else {
        showAlert(data.message || 'Add failed.', 'error');
      }
    } catch (err) {
      console.error(err);
      showAlert('Network error adding.', 'error');
    } finally {
      setSaving(null);
    }
  };

  const filtered = rows.filter((r) =>
    !search.trim() ||
    r.code.toLowerCase().includes(search.toLowerCase()) ||
    r.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={4000} />}

      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Parameter Code Names</h1>
          <p className="page-subtitle">
            What lab reports show for each analyzer code — e.g. "WBC" prints as "White Blood Cell Count".
            Add anything missing, or correct a name below.
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Code</label>
            <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="e.g. WBC" style={inputStyle} />
          </div>
          <div style={{ flex: 2 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. White Blood Cell Count" style={inputStyle} />
          </div>
          <button
            onClick={addNew}
            disabled={saving === 'new'}
            style={{ ...btnStyle, background: '#2563eb', color: '#fff' }}
          >
            <Plus size={14} /> {saving === 'new' ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>

      <div style={{ position: 'relative', maxWidth: 320, marginBottom: 12 }}>
        <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: 10, top: 10 }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code or name..."
          style={{ ...inputStyle, paddingLeft: 32 }}
        />
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 160 }}>Code</th>
                <th style={thStyle}>Name</th>
                <th style={{ ...thStyle, width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 700 }}>{row.code}</td>
                  <td style={tdStyle}>
                    <input
                      value={row.name}
                      onChange={(e) => handleNameChange(row.id, e.target.value)}
                      style={inputStyle}
                    />
                  </td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => saveRow(row)}
                      disabled={saving === row.id}
                      style={{ ...btnStyle, background: '#f1f5f9', color: '#0f172a', padding: '6px 12px' }}
                    >
                      <Save size={13} /> {saving === row.id ? '...' : 'Save'}
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={3} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8' }}>No matches.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
