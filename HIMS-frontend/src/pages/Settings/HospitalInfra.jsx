//hospital-infra.jsx
import { useState, useEffect } from 'react';
import {
  Plus,
  Building2,
  Layers,
  Cpu,
  Pencil,
  Trash2,
  X,
  Activity,
  Settings2
} from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import '../../assets/CSS/HospitalInfra.css';

const INFRA_TYPES = ['Room', 'Lab', 'Ward', 'ICU', 'Operation Theater', 'Pharmacy'];
const DEFAULT_STATUS = ['Available', 'Occupied', 'Maintenance'];

function HospitalInfra() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [items, setItems] = useState([]);
  const [activeTab, setActiveTab] = useState('Lab');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  // Lab Machines State
  const [showMachinesModal, setShowMachinesModal] = useState(false);
  const [selectedLab, setSelectedLab] = useState(null);
  const [labMachines, setLabMachines] = useState([]);
  const [machineForm, setMachineForm] = useState({
    machine_id: '',
    name: '',
    model: '',
    manufacturer: ''
  });

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    type: 'Lab',
    block: '',
    floor: '',
    capacity: '',
    machines_count: 1,
    status: 'Available'
  });

  useEffect(() => {
    fetchInfra();
  }, [activeTab]);

  const fetchInfra = async () => {
    setLoading(true);
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const branchId = localStorage.getItem('branch_id');
      const roleLevel = localStorage.getItem('role_level');

      let url = `${API_BASE}/api/infra?type=${activeTab}`;
      if (roleLevel !== '1' && branchId) {
        url += `&branch_id=${branchId}`;
      }

      const res = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('hims_token')}` } });
      const data = await res.json();
      if (data.success) setItems(data.items);
    } catch (err) {
      console.error('Error fetching infra:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleOpenAdd = () => {
    setEditingItem(null);
    setFormData({
      name: '', type: activeTab, block: '', floor: '',
      capacity: activeTab === 'Lab' ? '' : '',
      machines_count: activeTab === 'Lab' ? 1 : 1,
      status: 'Available'
    });
    setShowModal(true);
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      type: item.type,
      block: item.block || '',
      floor: item.floor || '',
      capacity: item.capacity || '',
      machines_count: item.machines_count || 1,
      status: item.status
    });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this facility?')) return;
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const branchId = localStorage.getItem('branch_id');
      const roleLevel = localStorage.getItem('role_level');
      const url = `${API_BASE}/api/infra/delete/${id}?branch_id=${branchId}&role_level=${roleLevel}`;

      const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('hims_token')}` } });
      const data = await res.json();
      if (data.success) fetchInfra();
    } catch (err) { console.error(err); }
  };

  // ── Lab Machines Handlers ──
  const API_BASE = import.meta.env.VITE_API_URL || '';
  const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}` });

  const openMachinesModal = async (lab) => {
    setSelectedLab(lab);
    setShowMachinesModal(true);
    setMachineForm({ machine_id: '', name: '', model: '', manufacturer: '' });
    await fetchLabMachines(lab.id);
  };

  const fetchLabMachines = async (labId) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab/machines/${labId}`, { headers: authHdr() });
      const data = await res.json();
      if (data.success) setLabMachines(data.machines);
    } catch (err) { console.error('Error fetching machines:', err); }
  };

  const handleAddMachine = async () => {
    if (!machineForm.machine_id || !machineForm.name) return;
    try {
      const res = await fetch(`${API_BASE}/api/lab/machines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          lab_id: selectedLab.id,
          machine_id: machineForm.machine_id,
          name: machineForm.name,
          model: machineForm.model,
          manufacturer: machineForm.manufacturer
        })
      });
      const data = await res.json();
      if (data.success) {
        setMachineForm({ machine_id: '', name: '', model: '', manufacturer: '' });
        await fetchLabMachines(selectedLab.id);
        showAlert('Machine added successfully', 'success');
      } else {
        showAlert(data.message || 'Failed to add machine', 'error');
      }
    } catch (err) {
      console.error('Error adding machine:', err);
      showAlert('Error adding machine', 'error');
    }
  };

  const updateMachineStatus = async (machineId, status) => {
    try {
      const res = await fetch(`${API_BASE}/api/lab/machines/${machineId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (data.success) await fetchLabMachines(selectedLab.id);
    } catch (err) { console.error('Error updating machine:', err); }
  };

  const handleDeleteMachine = async (machineId) => {
    if (!window.confirm('Are you sure you want to delete this machine?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/lab/machines/${machineId}`, { method: 'DELETE', headers: authHdr() });
      const data = await res.json();
      if (data.success) {
        await fetchLabMachines(selectedLab.id);
        showAlert('Machine deleted successfully', 'success');
      }
    } catch (err) { console.error('Error deleting machine:', err); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const API_BASE = import.meta.env.VITE_API_URL || '';
    const branchId = localStorage.getItem('branch_id');
    const roleLevel = localStorage.getItem('role_level');

    const url = editingItem
      ? `${API_BASE}/api/infra/update/${editingItem.id}?branch_id=${branchId}&role_level=${roleLevel}`
      : `${API_BASE}/api/infra/add`;
    const method = editingItem ? 'PUT' : 'POST';

    try {
      const branchId = localStorage.getItem('branch_id');
      const payload = {
        ...formData,
        branch_id: branchId ? parseInt(branchId) : null
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hims_token')}` },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        fetchInfra();
      } else {
        showAlert(data.message, 'error');
      }
    } catch (err) { console.error(err); }
  };

  return (
    <>
      {alert && (
        <Alert
          message={alert.message}
          type={alert.type}
          onClose={hideAlert}
          duration={4000}
        />
      )}
      <div className="infra-page">
        <div className="infra-header">
          <div>
            <h1>Hospital Infrastructure</h1>
            <p>Manage facility types, floor locations, and current availability</p>
          </div>
          <button className="btn-primary" onClick={handleOpenAdd} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} />
            Add New {activeTab}
          </button>
        </div>

        <div className="infra-tabs">
          {INFRA_TYPES.map(type => (
            <button
              key={type}
              className={`infra-tab-btn ${activeTab === type ? 'active' : ''}`}
              onClick={() => setActiveTab(type)}
            >
              {type}s
            </button>
          ))}
        </div>

        <div className="infra-grid">
          {loading ? (
            <div className="infra-empty"><p>Loading infrastructure assets...</p></div>
          ) : items.length > 0 ? (
            items.map(item => (
              <div className="infra-card" key={item.id}>
                <div className="infra-card-header">
                  <span className="infra-name">{item.name}</span>
                  <span
                    className={`infra-status-dot status-${item.status.toLowerCase()}`}
                    title={item.status}
                  ></span>
                </div>
                <div className="infra-details">
                  <div className="infra-detail-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Building2 size={14} color="#64748b" /> {item.block || 'Main Block'}
                  </div>
                  <div className="infra-detail-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Layers size={14} color="#64748b" /> Floor {item.floor || 0}
                  </div>
                  {item.capacity && activeTab !== 'Lab' && (
                    <div className="infra-detail-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Activity size={14} color="#64748b" /> Cap: {item.capacity}
                    </div>
                  )}
                  {item.machines_count && activeTab === 'Lab' && (
                    <div className="infra-detail-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Cpu size={14} color="#64748b" /> Machines: {item.machines_count}
                    </div>
                  )}
                </div>
                <div className="infra-actions">
                  {activeTab === 'Lab' && (
                    <button
                      className="btn-ghost"
                      style={{ height: 28, fontSize: 11, color: 'var(--brand-blue)', display: 'flex', alignItems: 'center', gap: '4px' }}
                      onClick={() => openMachinesModal(item)}
                    >
                      <Settings2 size={12} /> Machines
                    </button>
                  )}
                  <button className="btn-ghost" style={{ height: 28, fontSize: 11, display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => handleEdit(item)}>
                    <Pencil size={12} /> Edit
                  </button>
                  <button className="btn-ghost" style={{ height: 28, fontSize: 11, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => handleDelete(item.id)}>
                    <Trash2 size={12} /> Remove
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="infra-empty">
              <h3>No {activeTab}s Registered</h3>
              <p>Ready to start managing your facility? Add your first registration above.</p>
            </div>
          )}
        </div>

        {showModal && (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="modal-header">
                <h3>{editingItem ? 'Edit' : 'Add New'} {activeTab}</h3>
                <button
                  className="btn-ghost"
                  style={{ border: 'none', background: 'transparent', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onClick={() => setShowModal(false)}
                >
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="modal-body">
                  <div className="preg-field">
                    <label className="preg-label">{activeTab} Name / Number *</label>
                    <input
                      type="text"
                      className="preg-input"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      required
                      placeholder={`e.g., ${activeTab === 'Room' ? 'RM-101' : 'Main ' + activeTab}`}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="preg-field">
                      <label className="preg-label">Block / Wing</label>
                      <input type="text" className="preg-input" name="block" value={formData.block} onChange={handleChange} placeholder="e.g., Wing A" />
                    </div>
                    <div className="preg-field">
                      <label className="preg-label">Floor No.</label>
                      <input type="number" className="preg-input" name="floor" value={formData.floor} onChange={handleChange} placeholder="0" />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    {activeTab === 'Lab' ? (
                      <div className="preg-field">
                        <label className="preg-label">Number of Machines *</label>
                        <input type="number" className="preg-input" name="machines_count" value={formData.machines_count} onChange={handleChange} placeholder="Enter machine count" min="1" required />
                      </div>
                    ) : (
                      <div className="preg-field">
                        <label className="preg-label">Capacity (Max Patients)</label>
                        <input type="number" className="preg-input" name="capacity" value={formData.capacity} onChange={handleChange} placeholder="Optional" />
                      </div>
                    )}
                    <div className="preg-field">
                      <label className="preg-label">Current Status</label>
                      <select className="preg-select" name="status" value={formData.status} onChange={handleChange}>
                        {DEFAULT_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn-primary">
                    {editingItem ? 'Save Changes' : 'Register Asset'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Lab Machines Modal ── */}
        {showMachinesModal && selectedLab && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '600px' }}>
              <div className="modal-header">
                <h3>Analyser Machines — {selectedLab.name}</h3>
                <button
                  className="btn-ghost"
                  style={{ border: 'none', background: 'transparent', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onClick={() => setShowMachinesModal(false)}
                >
                  <X size={20} />
                </button>
              </div>

              <div className="modal-body">
                {/* Add New Machine Form */}
                <div style={{
                  padding: '16px',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  marginBottom: '20px',
                  border: '1px solid #e2e8f0'
                }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#475569' }}>Add New Machine</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="preg-field">
                      <label className="preg-label">Machine ID *</label>
                      <input
                        type="text"
                        className="preg-input"
                        value={machineForm.machine_id}
                        onChange={e => setMachineForm(p => ({ ...p, machine_id: e.target.value }))}
                        placeholder="e.g., ANAL-001"
                      />
                    </div>
                    <div className="preg-field">
                      <label className="preg-label">Name *</label>
                      <input
                        type="text"
                        className="preg-input"
                        value={machineForm.name}
                        onChange={e => setMachineForm(p => ({ ...p, name: e.target.value }))}
                        placeholder="e.g., Semi automatic Biochemistry analyser"
                      />
                    </div>
                    <div className="preg-field">
                      <label className="preg-label">Model</label>
                      <input
                        type="text"
                        className="preg-input"
                        value={machineForm.model}
                        onChange={e => setMachineForm(p => ({ ...p, model: e.target.value }))}
                        placeholder="e.g., XN-1000"
                      />
                    </div>
                    <div className="preg-field">
                      <label className="preg-label">Manufacturer</label>
                      <input
                        type="text"
                        className="preg-input"
                        value={machineForm.manufacturer}
                        onChange={e => setMachineForm(p => ({ ...p, manufacturer: e.target.value }))}
                        placeholder="e.g., Meril Diagnostics"
                      />
                    </div>
                  </div>
                  <button
                    className="btn-primary"
                    style={{ marginTop: '12px', height: '32px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}
                    onClick={handleAddMachine}
                    disabled={!machineForm.machine_id || !machineForm.name}
                  >
                    <Plus size={14} /> Add Machine
                  </button>
                </div>

                {/* Machines List */}
                <div>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#475569' }}>
                    Registered Machines ({labMachines.length})
                  </h4>
                  {labMachines.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
                      No machines registered yet.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {labMachines.map(machine => (
                        <div
                          key={machine.id}
                          style={{
                            padding: '12px 16px',
                            background: '#fff',
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '14px' }}>
                              {machine.name}
                            </div>
                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                              ID: {machine.machine_id}
                              {machine.model && `• Model: ${machine.model}`}
                              {machine.manufacturer && `• ${machine.manufacturer}`}
                            </div>
                            <div style={{ marginTop: '6px' }}>
                              <span style={{
                                fontSize: '11px',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                background: machine.status === 'Active' ? '#dcfce7' :
                                  machine.status === 'Maintenance' ? '#fef3c7' : '#f1f5f9',
                                color: machine.status === 'Active' ? '#166534' :
                                  machine.status === 'Maintenance' ? '#92400e' : '#64748b'
                              }}>
                                {machine.status}
                              </span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <select
                              style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                              value={machine.status}
                              onChange={(e) => updateMachineStatus(machine.id, e.target.value)}
                            >
                              <option value="Active">Active</option>
                              <option value="Inactive">Inactive</option>
                              <option value="Maintenance">Maintenance</option>
                            </select>
                            <button
                              className="btn-ghost"
                              style={{ height: '28px', width: '28px', padding: 0, color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              onClick={() => handleDeleteMachine(machine.id)}
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-ghost" onClick={() => setShowMachinesModal(false)}>Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default HospitalInfra;
