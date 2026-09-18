import { useState, useEffect } from 'react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import '../../assets/CSS/PatientRegistration.css';
import '../../assets/CSS/BillingPackages.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');

const DEFAULT_ITEMS = [
  { name: 'Consultation Fee', amount: 0 },
  { name: 'Registration Fee', amount: 0 },
  { name: 'Lab Test', amount: 0 },
  { name: 'X-Ray', amount: 0 },
  { name: 'Ultrasound', amount: 0 },
  { name: 'ECG', amount: 0 },
  { name: 'Blood Test', amount: 0 },
  { name: 'Urine Test', amount: 0 },
  { name: 'Vaccination', amount: 0 },
  { name: 'Dressing', amount: 0 },
  { name: 'Injection', amount: 0 },
  { name: 'Medication', amount: 0 }
];

function BillingPackages() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [packages, setPackages] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDept, setFilterDept] = useState('All');

  const [formData, setFormData] = useState({
    name: '',
    department: '',
    description: '',
    items: [{ name: '', amount: 0 }],
    discountPercent: 0,
    isActive: true
  });

  const fetchDepartments = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/departments?is_active=true`, { headers: { Authorization: `Bearer ${tok()}` } });
      const data = await res.json();
      if (data.success && data.departments.length > 0) {
        setDepartments(data.departments.map(d => d.name));
        setFormData(prev => ({ ...prev, department: data.departments[0].name }));
      }
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  const fetchPackages = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/billing-packages?is_active=true`, { headers: { Authorization: `Bearer ${tok()}` } });
      const data = await res.json();
      if (data.success) {
        const mapped = data.packages.map(pkg => ({
          id: pkg.package_id,
          name: pkg.name,
          department: pkg.department,
          description: pkg.description,
          items: Array.isArray(pkg.items) ? pkg.items : JSON.parse(pkg.items),
          discountPercent: parseFloat(pkg.discount_percent),
          isActive: pkg.is_active === 1,
          createdAt: pkg.created_at,
          updatedAt: pkg.updated_at
        }));
        setPackages(mapped);
      }
    } catch (error) {
      console.error('Error fetching packages:', error);
      showAlert('Failed to load packages from server', 'error');
    }
  };

  useEffect(() => {
    fetchDepartments();
    fetchPackages();
  }, []);

  const handleOpenAdd = () => {
    setEditingPackage(null);
    setFormData({
      name: '',
      department: departments[0] || '',
      description: '',
      items: [{ name: '', amount: 0 }],
      discountPercent: 0,
      isActive: true
    });
    setShowModal(true);
  };

  const handleEdit = (pkg) => {
    setEditingPackage(pkg);
    setFormData({
      name: pkg.name,
      department: pkg.department,
      description: pkg.description,
      items: [...pkg.items],
      discountPercent: pkg.discountPercent,
      isActive: pkg.isActive
    });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this package?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/billing-packages/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tok()}` } });
      const data = await res.json();
      if (data.success) {
        setPackages(prev => prev.filter(p => p.id !== id));
        showAlert('Package deleted successfully', 'success');
      } else {
        showAlert(data.message || 'Failed to delete package', 'error');
      }
    } catch (error) {
      console.error('Error deleting package:', error);
      showAlert('Network error while deleting package', 'error');
    }
  };

  const handleAddItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { name: '', amount: 0 }]
    }));
  };

  const handleRemoveItem = (index) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  const handleItemChange = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === index
          ? { ...item, [field]: field === 'amount' ? parseFloat(value) || 0 : value }
          : item
      )
    }));
  };

  const handleQuickAddItem = (itemName) => {
    const defaultItem = DEFAULT_ITEMS.find(i => i.name === itemName);
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { name: itemName, amount: defaultItem?.amount || 0 }]
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      showAlert('Package name is required', 'warning');
      return;
    }

    if (formData.items.length === 0 || formData.items.every(i => !i.name.trim())) {
      showAlert('At least one item is required', 'warning');
      return;
    }

    const validItems = formData.items.filter(i => i.name.trim());

    const payload = {
      name: formData.name,
      department: formData.department,
      description: formData.description,
      items: validItems,
      discount_percent: formData.discountPercent,
      is_active: formData.isActive
    };

    try {
      if (editingPackage) {
        const res = await fetch(`${API_BASE}/api/billing-packages/${editingPackage.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          await fetchPackages();
          showAlert('Package updated successfully', 'success');
          setShowModal(false);
        } else {
          showAlert(data.message || 'Failed to update package', 'error');
        }
      } else {
        payload.package_id = 'PKG-' + Math.floor(1000 + Math.random() * 9000);
        const res = await fetch(`${API_BASE}/api/billing-packages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          await fetchPackages();
          showAlert('Package created successfully', 'success');
          setShowModal(false);
        } else {
          showAlert(data.message || 'Failed to create package', 'error');
        }
      }
    } catch (error) {
      console.error('Error saving package:', error);
      showAlert('Network error while saving package', 'error');
    }
  };

  const calculateTotal = (items, discount) => {
    const subtotal = items.reduce((sum, item) => sum + (item.amount || 0), 0);
    return subtotal - (subtotal * (discount / 100));
  };

  const filteredPackages = packages.filter(pkg => {
    const matchesSearch =
      pkg.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pkg.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDept = filterDept === 'All' || pkg.department === filterDept;
    return matchesSearch && matchesDept;
  });

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

      <div className="billing-packages-page">
        {/* ── Header ── */}
        <div className="billing-packages-header">
          <div>
            <h1>Billing Packages</h1>
            <p>Create and manage pre-defined billing packages by department</p>
          </div>
          <button className="btn-primary" onClick={handleOpenAdd}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create Package
          </button>
        </div>

        {/* ── Filters ── */}
        <div className="billing-filters">
          <input
            className="preg-input"
            placeholder="Search packages..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ width: 280, minWidth: 0 }}
          />
          <select
            className="preg-select"
            value={filterDept}
            onChange={e => setFilterDept(e.target.value)}
            style={{ width: 180, minWidth: 0 }}
          >
            <option value="All">All Departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <span style={{ color: 'var(--text-soft)', fontSize: 14, marginLeft: 'auto' }}>
            {filteredPackages.length} package{filteredPackages.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* ── Grid ── */}
        <div className="packages-grid">
          {filteredPackages.map(pkg => {
            const subtotal = pkg.items.reduce((sum, item) => sum + (item.amount || 0), 0);
            const total = calculateTotal(pkg.items, pkg.discountPercent);

            return (
              <div key={pkg.id} className={`package-card${!pkg.isActive ? ' inactive' : ''}`}>
                {/* Header */}
                <div className="package-card-header">
                  <div style={{ minWidth: 0 }}>
                    <div className="package-card-title">{pkg.name}</div>
                    <div className="package-card-id">{pkg.id}</div>
                  </div>
                  <span
                    className="preg-badge"
                    style={{
                      background: pkg.isActive ? 'var(--success-light)' : '#e2e8f0',
                      color: pkg.isActive ? 'var(--success)' : '#64748b'
                    }}
                  >
                    {pkg.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {/* Body */}
                <div className="package-card-body">
                  <div className="package-department-badge">{pkg.department}</div>

                  {pkg.description && (
                    <p className="package-description">{pkg.description}</p>
                  )}

                  <div className="package-items-preview">
                    <div className="package-item-count">
                      {pkg.items.length} item{pkg.items.length !== 1 ? 's' : ''}
                    </div>
                    {pkg.items.slice(0, 3).map((item, i) => (
                      <div key={i} className="package-item-row">
                        <span className="package-item-name">{item.name}</span>
                        <span className="package-item-amount">₹{item.amount.toFixed(2)}</span>
                      </div>
                    ))}
                    {pkg.items.length > 3 && (
                      <div className="package-more-items">
                        +{pkg.items.length - 3} more items
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer — OUTSIDE body so it never overlaps */}
                <div className="package-footer">
                  <div className="package-price-section">
                    {pkg.discountPercent > 0 && (
                      <div className="package-discount-text">
                        {pkg.discountPercent}% discount applied
                      </div>
                    )}
                    <div className="package-total">₹{total.toFixed(2)}</div>
                    {pkg.discountPercent > 0 && (
                      <div className="package-original-price">₹{subtotal.toFixed(2)}</div>
                    )}
                  </div>

                  <div className="package-actions">
                    <button
                      className="btn-ghost"
                      onClick={() => handleEdit(pkg)}
                    >
                      ✏️ Edit
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => handleDelete(pkg.id)}
                      style={{ color: 'var(--danger)' }}
                    >
                      🗑 Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filteredPackages.length === 0 && (
          <div className="packages-empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="9" x2="15" y2="9" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            <p>No packages found. Create your first billing package to get started.</p>
          </div>
        )}

        {/* ── Modal ── */}
        {showModal && (
          <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
            <div className="modal-container">
              <div className="modal-header">
                <h3>{editingPackage ? 'Edit Package' : 'Create Package'}</h3>
                <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
              </div>

              <form onSubmit={handleSubmit} className="modal-body">
                <div style={{ display: 'grid', gap: 16 }}>

                  <div className="preg-field">
                    <label className="preg-label">Package Name *</label>
                    <input
                      className="preg-input"
                      value={formData.name}
                      onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g., General Checkup"
                      required
                    />
                  </div>

                  <div className="preg-field">
                    <label className="preg-label">Department *</label>
                    <select
                      className="preg-select"
                      value={formData.department}
                      onChange={e => setFormData(prev => ({ ...prev, department: e.target.value }))}
                    >
                      {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>

                  <div className="preg-field">
                    <label className="preg-label">Description</label>
                    <textarea
                      className="preg-textarea"
                      value={formData.description}
                      onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Brief description of the package..."
                      rows={2}
                    />
                  </div>

                  <div>
                    <label className="preg-label">Quick Add Items</label>
                    <div className="quick-add-items">
                      {DEFAULT_ITEMS.map(item => (
                        <button
                          key={item.name}
                          type="button"
                          className="quick-add-btn"
                          onClick={() => handleQuickAddItem(item.name)}
                        >
                          + {item.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="preg-label">Package Items *</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                      {formData.items.map((item, index) => (
                        <div key={index} className="item-row">
                          <input
                            placeholder="Item name"
                            value={item.name}
                            onChange={e => handleItemChange(index, 'name', e.target.value)}
                          />
                          <input
                            type="number"
                            placeholder="Amount"
                            value={item.amount}
                            onChange={e => handleItemChange(index, 'amount', e.target.value)}
                            min="0"
                            step="0.01"
                          />
                          <button
                            type="button"
                            className="remove-item-btn"
                            onClick={() => handleRemoveItem(index)}
                            title="Remove item"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={handleAddItem}
                      style={{ marginTop: 8, fontSize: 13 }}
                    >
                      + Add Custom Item
                    </button>
                  </div>

                  <div className="preg-field">
                    <label className="preg-label">Package Discount (%)</label>
                    <input
                      className="preg-input"
                      type="number"
                      min="0"
                      max="100"
                      value={formData.discountPercent}
                      onChange={e =>
                        setFormData(prev => ({ ...prev, discountPercent: parseFloat(e.target.value) || 0 }))
                      }
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      id="isActive"
                      checked={formData.isActive}
                      onChange={e => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                    />
                    <label htmlFor="isActive" style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>
                      Active Package
                    </label>
                  </div>

                  {/* Preview */}
                  <div className="preview-card">
                    <div className="preview-card-header">Package Preview</div>
                    <div className="preview-row">
                      <span>Subtotal:</span>
                      <span>₹{formData.items.reduce((sum, i) => sum + (i.amount || 0), 0).toFixed(2)}</span>
                    </div>
                    {formData.discountPercent > 0 && (
                      <div className="preview-row" style={{ color: 'var(--success)' }}>
                        <span>Discount ({formData.discountPercent}%):</span>
                        <span>
                          -₹{(
                            formData.items.reduce((sum, i) => sum + (i.amount || 0), 0) *
                            (formData.discountPercent / 100)
                          ).toFixed(2)}
                        </span>
                      </div>
                    )}
                    <div className="preview-total">
                      <span>Total:</span>
                      <span>₹{calculateTotal(formData.items, formData.discountPercent).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    {editingPackage ? 'Update Package' : 'Create Package'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default BillingPackages;