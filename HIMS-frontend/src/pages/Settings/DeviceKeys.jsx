import { useState, useEffect } from 'react';
import { KeyRound, Plus, Ban, Copy } from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

const thStyle = { textAlign: 'left', padding: '10px 12px', fontSize: '12px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', borderBottom: '2px solid #e2e8f0' };
const tdStyle = { padding: '8px 12px', fontSize: '13px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' };
const inputStyle = { padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', width: '100%', boxSizing: 'border-box' };
const btnStyle = { padding: '8px 16px', borderRadius: '8px', border: 'none', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' };
const badge = (bg, fg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, background: bg, color: fg });

// Issues and manages the permanent per-machine keys the LIS-Agent Electron
// app activates with instead of a staff login — see HIMS-backend
// controllers/deviceKeyController.js and middleware/auth.js's device-key
// branch. A key never expires on its own; this page is the only way to see
// what's out there and cut one off (a lost/decommissioned machine) without
// touching any other machine. Admin-only, same tier as Parameter Code Names.
export default function DeviceKeys() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState(null);
  const [justCreated, setJustCreated] = useState(null); // { id, label, key }

  const fetchBranches = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/branches`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) {
        setBranches(data.branches || []);
        // Single-hospital deployments (the common case) shouldn't force an
        // extra click — pre-select the only branch there is.
        if ((data.branches || []).length === 1) setBranchId(String(data.branches[0].id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/dev-keys`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) setRows(data.device_keys || []);
      else showAlert(data.message || 'Failed to load device keys', 'error');
    } catch (err) {
      console.error(err);
      showAlert('Network error loading device keys.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRows(); fetchBranches(); /* eslint-disable-next-line */ }, []);

  const createKey = async () => {
    if (!label.trim()) {
      showAlert('Give this machine a label (e.g. "Reception PC — Hematology").', 'warning');
      return;
    }
    if (!branchId) {
      showAlert('Select which hospital this machine belongs to.', 'warning');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/dev-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ label: label.trim(), branch_id: branchId }),
      });
      const data = await res.json();
      if (data.success) {
        setJustCreated(data.device_key);
        setLabel('');
        fetchRows();
      } else {
        showAlert(data.message || 'Could not create device key.', 'error');
      }
    } catch (err) {
      console.error(err);
      showAlert('Network error creating device key.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (row) => {
    if (!window.confirm(`Revoke the key for "${row.label}"? That machine's LIS-Agent will need a new key to reconnect.`)) return;
    setRevokingId(row.id);
    try {
      const res = await fetch(`${API_BASE}/api/dev-keys/${row.id}`, { method: 'DELETE', headers: authHdr() });
      const data = await res.json();
      if (data.success) {
        showAlert(`Revoked "${row.label}".`, 'success');
        fetchRows();
      } else {
        showAlert(data.message || 'Revoke failed.', 'error');
      }
    } catch (err) {
      console.error(err);
      showAlert('Network error revoking key.', 'error');
    } finally {
      setRevokingId(null);
    }
  };

  const copyKey = async (key) => {
    try {
      await navigator.clipboard.writeText(key);
      showAlert('Key copied to clipboard.', 'success');
    } catch {
      showAlert('Could not copy automatically — select and copy the key manually.', 'warning');
    }
  };

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={4000} />}

      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title"><KeyRound size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} />LIS-Agent Device Keys</h1>
          <p className="page-subtitle">
            One permanent key per machine — pasted into the LIS-Agent's activation screen once, instead of a
            staff login. A key never expires on its own; revoke it here if a machine is lost or reassigned.
          </p>
        </div>
      </div>

      {justCreated && (
        <div className="card" style={{ padding: 20, marginBottom: 20, border: '2px solid #16a34a', background: '#f0fdf4' }}>
          <div style={{ fontWeight: 700, color: '#166534', marginBottom: 8 }}>
            Key created for "{justCreated.label}" — copy it now. It will not be shown again.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{ flex: 1, background: '#fff', padding: '8px 10px', borderRadius: 6, border: '1px solid #bbf7d0', fontSize: 13, wordBreak: 'break-all' }}>
              {justCreated.key}
            </code>
            <button onClick={() => copyKey(justCreated.key)} style={{ ...btnStyle, background: '#16a34a', color: '#fff' }}>
              <Copy size={14} /> Copy
            </button>
          </div>
          <button onClick={() => setJustCreated(null)} style={{ ...btnStyle, background: 'transparent', color: '#166534', marginTop: 10, padding: '4px 0' }}>
            Done — I've copied it
          </button>
        </div>
      )}

      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 220px' }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Hospital</label>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={inputStyle}>
              <option value="">— Select hospital —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.branch_name}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Machine label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder='e.g. "Reception PC — Hematology"'
              style={inputStyle}
              onKeyDown={(e) => { if (e.key === 'Enter') createKey(); }}
            />
          </div>
          <button onClick={createKey} disabled={creating} style={{ ...btnStyle, background: '#2563eb', color: '#fff' }}>
            <Plus size={14} /> {creating ? 'Creating...' : 'Generate key'}
          </button>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Label</th>
                <th style={thStyle}>Branch</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Last used</th>
                <th style={thStyle}>Created</th>
                <th style={{ ...thStyle, width: 100 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{row.label}</td>
                  <td style={tdStyle}>{row.branch_name || '—'}</td>
                  <td style={tdStyle}>
                    {row.status === 'Active'
                      ? <span style={badge('#dcfce7', '#166534')}>Active</span>
                      : <span style={badge('#fee2e2', '#991b1b')}>Revoked</span>}
                  </td>
                  <td style={tdStyle}>{row.last_used_at ? new Date(row.last_used_at).toLocaleString() : 'Never'}</td>
                  <td style={tdStyle}>{new Date(row.created_at).toLocaleDateString()}</td>
                  <td style={tdStyle}>
                    {row.status === 'Active' && (
                      <button
                        onClick={() => revokeKey(row)}
                        disabled={revokingId === row.id}
                        style={{ ...btnStyle, background: '#fef2f2', color: '#991b1b', padding: '6px 12px' }}
                      >
                        <Ban size={13} /> {revokingId === row.id ? '...' : 'Revoke'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8' }}>No device keys yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
