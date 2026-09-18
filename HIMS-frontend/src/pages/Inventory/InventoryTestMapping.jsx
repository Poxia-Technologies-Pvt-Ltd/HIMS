import { useState, useEffect } from 'react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import Select from 'react-select';
import '../../assets/CSS/InventoryVendors.css'; // Reusing glassmorphic CSS

const API_URL = import.meta.env.VITE_API_URL || '';

function InventoryTestMapping() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [mappings, setMappings] = useState([]);
  const [tests, setTests] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const initialFormState = {
    test_id: '',
    item_id: '',
    quantity_required: 1
  };

  const [formData, setFormData] = useState(initialFormState);

  const fetchMappings = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/v2/inventory/mappings`);
      const data = await response.json();
      if (data.success) {
        setMappings(data.data);
      }
    } catch {
      showAlert('error', 'Failed to fetch test mappings');
    }
    setLoading(false);
  };

  const fetchDropdownData = async () => {
    try {
      const [testsRes, itemsRes] = await Promise.all([
        fetch(`${API_URL}/api/lab/tests`),
        fetch(`${API_URL}/api/v2/inventory/items`)
      ]);
      const testsData = await testsRes.json();
      const itemsData = await itemsRes.json();

      if (testsData.success) setTests(testsData.tests || []);
      if (itemsData.success) setItems(itemsData.data || []);
    } catch {
      showAlert('error', 'Failed to load reference data');
    }
  };

  useEffect(() => {
    fetchMappings();
    fetchDropdownData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/api/v2/inventory/mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_id: parseInt(formData.test_id),
          item_id: parseInt(formData.item_id),
          quantity_required: parseFloat(formData.quantity_required)
        })
      });

      const data = await response.json();
      if (data.success) {
        showAlert('success', 'Mapping created successfully');
        setIsDrawerOpen(false);
        setFormData(initialFormState);
        fetchMappings();
      } else {
        showAlert('error', data.message);
      }
    } catch {
      showAlert('error', 'Failed to save mapping');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this mapping?')) return;
    try {
      const response = await fetch(`${API_URL}/api/v2/inventory/mappings/${id}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      if (data.success) {
        showAlert('success', 'Mapping deleted successfully');
        fetchMappings();
      } else {
        showAlert('error', data.message);
      }
    } catch {
      showAlert('error', 'Failed to delete mapping');
    }
  };

  const handleAddNew = () => {
    setFormData(initialFormState);
    setIsDrawerOpen(true);
  };

  const selectStyles = {
    control: (base) => ({
      ...base,
      background: 'var(--bg-input)',
      borderColor: 'var(--border-light)',
      borderRadius: 'var(--radius-sm)',
      padding: '2px',
      fontSize: '14px',
      boxShadow: 'none',
      '&:hover': { borderColor: 'var(--blue-primary)' }
    })
  };

  return (
    <div className="inv-vendor-page">
      {alert && <Alert type={alert.type} message={alert.message} onClose={hideAlert} />}

      <div className="inv-header">
        <div>
          <h1 className="inv-title">Test ↔ Inventory Mappings</h1>
          <p className="inv-subtitle">Smart auto-deduction rules for Lab Tests</p>
        </div>
        <button className="btn-primary" onClick={handleAddNew}>
          + Create New Mapping
        </button>
      </div>

      <div className="inv-card">
        <table className="inv-table">
          <thead>
            <tr>
              <th>Lab Test</th>
              <th>Inventory Item</th>
              <th>Quantity Deducted per Test</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="4" style={{ textAlign: 'center' }}>Loading mappings...</td></tr>
            ) : mappings.length === 0 ? (
              <tr><td colSpan="4" style={{ textAlign: 'center' }}>No mappings configured yet.</td></tr>
            ) : (
              mappings.map(map => (
                <tr key={map.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{map.test_name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-soft)' }}>{map.test_code}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{map.item_name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-soft)' }}>{map.item_code} • {map.category}</div>
                  </td>
                  <td>
                    <span style={{
                      padding: '4px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                      background: '#fef2f2', color: '#dc2626'
                    }}>
                      -{map.quantity_required} {map.unit}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => handleDelete(map.id)}
                      style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isDrawerOpen && (
        <div className="inv-modal-overlay" onClick={() => setIsDrawerOpen(false)}>
          <div className="inv-drawer" onClick={e => e.stopPropagation()}>
            <div className="inv-drawer-header">
              <h2>Configure Auto-Deduct Rule</h2>
              <button className="inv-drawer-close" onClick={() => setIsDrawerOpen(false)}>&times;</button>
            </div>
            <div className="inv-drawer-body">
              <form id="mapping-form" onSubmit={handleSubmit}>

                <h4 style={{ marginBottom: '12px', color: 'var(--text-dark)' }}>Select Lab Test</h4>
                <div className="inv-form-group">
                  <label>Lab Test *</label>
                  <Select
                    options={tests.map(t => ({ value: t.id, label: `${t.test_name} (${t.test_code})` }))}
                    value={formData.test_id ? {
                      value: formData.test_id,
                      label: tests.find(t => t.id == formData.test_id)?.test_name + ' (' + tests.find(t => t.id == formData.test_id)?.test_code + ')'
                    } : null}
                    onChange={(selected) => setFormData({ ...formData, test_id: selected ? selected.value : '' })}
                    placeholder="Search Lab Test..."
                    isClearable
                    required
                    styles={selectStyles}
                  />
                </div>

                <h4 style={{ marginTop: '24px', marginBottom: '12px', color: 'var(--text-dark)' }}>Inventory Item to Deduct</h4>
                <div className="inv-form-group">
                  <label>Inventory Item *</label>
                  <Select
                    options={items.map(i => ({ value: i.id, label: `${i.item_name} (${i.item_code})` }))}
                    value={formData.item_id ? {
                      value: formData.item_id,
                      label: items.find(i => i.id == formData.item_id)?.item_name + ' (' + items.find(i => i.id == formData.item_id)?.item_code + ')'
                    } : null}
                    onChange={(selected) => setFormData({ ...formData, item_id: selected ? selected.value : '' })}
                    placeholder="Search Item..."
                    isClearable
                    required
                    styles={selectStyles}
                  />
                </div>

                <div className="inv-form-group">
                  <label>Quantity Deducted per Test *</label>
                  <input
                    className="inv-input"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={formData.quantity_required}
                    onChange={e => setFormData({ ...formData, quantity_required: e.target.value })}
                  />
                  <div style={{ fontSize: '12px', color: 'var(--text-soft)', marginTop: '4px' }}>
                    Selected Item Unit: {formData.item_id ? items.find(i => i.id == formData.item_id)?.unit : '-'}
                  </div>
                </div>

              </form>
            </div>
            <div className="inv-drawer-footer">
              <button type="button" className="action-btn" onClick={() => setIsDrawerOpen(false)} style={{ padding: '10px 20px', color: 'var(--text-mid)' }}>Cancel</button>
              <button type="submit" form="mapping-form" className="btn-primary" style={{ background: 'var(--blue-primary)' }}>
                Save Mapping Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InventoryTestMapping;
