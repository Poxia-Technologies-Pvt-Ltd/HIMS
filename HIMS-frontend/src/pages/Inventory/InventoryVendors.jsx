import { useState, useEffect } from 'react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import '../../assets/CSS/InventoryVendors.css';

const API_URL = import.meta.env.VITE_API_URL || ''; // Backend port is 7005 as per .env

function InventoryVendors() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const initialFormState = {
    vendor_name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: '',
    tax_id: '',
    payment_terms: '',
    lead_time_days: 7,
    bank_name: '',
    account_number: '',
    ifsc_code: '',
    status: 'Active',
    rating: 0.00
  };

  const [formData, setFormData] = useState(initialFormState);

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);

      const response = await fetch(`${API_URL}/api/v2/inventory/vendors?${params}`);
      const data = await response.json();
      if (data.success) {
        setVendors(data.data);
      }
    } catch {
      showAlert('error', 'Failed to fetch vendors');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchVendors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchVendors();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editingVendor
        ? `${API_URL}/api/v2/inventory/vendors/${editingVendor.id}`
        : `${API_URL}/api/v2/inventory/vendors`;
      const method = editingVendor ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();
      if (data.success) {
        showAlert('success', editingVendor ? 'Vendor updated successfully' : 'Vendor created successfully');
        setIsDrawerOpen(false);
        setFormData(initialFormState);
        fetchVendors();
      } else {
        showAlert('error', data.message);
      }
    } catch {
      showAlert('error', 'Failed to save vendor');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to remove this vendor?')) return;

    try {
      const response = await fetch(`${API_URL}/api/v2/inventory/vendors/${id}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      if (data.success) {
        showAlert('success', 'Vendor deleted successfully');
        fetchVendors();
      } else {
        showAlert('error', data.message);
      }
    } catch {
      showAlert('error', 'Failed to delete vendor');
    }
  };

  const handleEdit = (vendor) => {
    setEditingVendor(vendor);
    setFormData({
      vendor_name: vendor.vendor_name,
      contact_person: vendor.contact_person || '',
      phone: vendor.phone || '',
      email: vendor.email || '',
      address: vendor.address || '',
      tax_id: vendor.tax_id || '',
      payment_terms: vendor.payment_terms || '',
      lead_time_days: vendor.lead_time_days || 7,
      bank_name: vendor.bank_name || '',
      account_number: vendor.account_number || '',
      ifsc_code: vendor.ifsc_code || '',
      status: vendor.status,
      rating: vendor.rating || 0.00
    });
    setIsDrawerOpen(true);
  };

  const handleAddNew = () => {
    setEditingVendor(null);
    setFormData(initialFormState);
    setIsDrawerOpen(true);
  };

  return (
    <div className="inv-vendor-page">
      {alert && <Alert type={alert.type} message={alert.message} onClose={hideAlert} />}

      <div className="inv-header">
        <div>
          <h1 className="inv-title">Vendor Management</h1>
          <p className="inv-subtitle">Manage inventory suppliers and external partners</p>
        </div>
        <button className="btn-primary" onClick={handleAddNew}>
          + Add New Vendor
        </button>
      </div>

      <div className="inv-card">
        <div className="inv-toolbar">
          <form className="inv-search" onSubmit={handleSearch}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-soft)" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search vendors by name, code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </form>
        </div>

        <table className="inv-table">
          <thead>
            <tr>
              <th>Vendor ID</th>
              <th>Vendor Name</th>
              <th>Contact Info</th>
              <th>Tax ID / GST</th>
              <th>Lead Time</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" style={{ textAlign: 'center' }}>Loading vendors...</td></tr>
            ) : vendors.length === 0 ? (
              <tr><td colSpan="7" style={{ textAlign: 'center' }}>No vendors found.</td></tr>
            ) : (
              vendors.map(vendor => (
                <tr key={vendor.id}>
                  <td><strong>{vendor.vendor_code}</strong></td>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{vendor.vendor_name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-soft)' }}>{vendor.contact_person}</div>
                  </td>
                  <td>
                    <div>{vendor.phone || '-'}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-soft)' }}>{vendor.email || '-'}</div>
                  </td>
                  <td>{vendor.tax_id || '-'}</td>
                  <td>{vendor.lead_time_days} days</td>
                  <td>
                    <span className={`inv-badge ${vendor.status.toLowerCase()}`}>
                      {vendor.status}
                    </span>
                  </td>
                  <td>
                    <button className="action-btn" onClick={() => handleEdit(vendor)} title="Edit">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button className="action-btn" onClick={() => handleDelete(vendor.id)} title="Delete" style={{ marginLeft: '8px' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Sliding Drawer Modal */}
      {isDrawerOpen && (
        <div className="inv-modal-overlay" onClick={() => setIsDrawerOpen(false)}>
          <div className="inv-drawer" onClick={e => e.stopPropagation()}>
            <div className="inv-drawer-header">
              <h2>{editingVendor ? 'Edit Vendor Details' : 'Register New Vendor'}</h2>
              <button className="inv-drawer-close" onClick={() => setIsDrawerOpen(false)}>&times;</button>
            </div>
            <div className="inv-drawer-body">
              <form id="vendor-form" onSubmit={handleSubmit}>

                <h4 style={{ marginBottom: '12px', color: 'var(--text-dark)' }}>Basic Information</h4>
                <div className="inv-form-group">
                  <label>Vendor Name *</label>
                  <input className="inv-input" required value={formData.vendor_name} onChange={e => setFormData({ ...formData, vendor_name: e.target.value })} />
                </div>

                <div className="inv-grid-2">
                  <div className="inv-form-group">
                    <label>Contact Person</label>
                    <input className="inv-input" value={formData.contact_person} onChange={e => setFormData({ ...formData, contact_person: e.target.value })} />
                  </div>
                  <div className="inv-form-group">
                    <label>Phone Number</label>
                    <input className="inv-input" type="tel" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                  </div>
                </div>

                <div className="inv-form-group">
                  <label>Email Address</label>
                  <input className="inv-input" type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                </div>

                <div className="inv-form-group">
                  <label>Physical Address</label>
                  <textarea className="inv-textarea" rows="3" value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} />
                </div>

                <h4 style={{ marginTop: '24px', marginBottom: '12px', color: 'var(--text-dark)' }}>Commercial Details</h4>
                <div className="inv-grid-2">
                  <div className="inv-form-group">
                    <label>Tax ID / GST Number</label>
                    <input className="inv-input" value={formData.tax_id} onChange={e => setFormData({ ...formData, tax_id: e.target.value })} />
                  </div>
                  <div className="inv-form-group">
                    <label>Lead Time (Days)</label>
                    <input className="inv-input" type="number" min="1" value={formData.lead_time_days} onChange={e => setFormData({ ...formData, lead_time_days: parseInt(e.target.value) || 7 })} />
                  </div>
                </div>

                <h4 style={{ marginTop: '24px', marginBottom: '12px', color: 'var(--text-dark)' }}>Banking Information</h4>
                <div className="inv-form-group">
                  <label>Bank Name</label>
                  <input className="inv-input" value={formData.bank_name} onChange={e => setFormData({ ...formData, bank_name: e.target.value })} />
                </div>
                <div className="inv-grid-2">
                  <div className="inv-form-group">
                    <label>Account Number</label>
                    <input className="inv-input" value={formData.account_number} onChange={e => setFormData({ ...formData, account_number: e.target.value })} />
                  </div>
                  <div className="inv-form-group">
                    <label>IFSC / Routing Code</label>
                    <input className="inv-input" value={formData.ifsc_code} onChange={e => setFormData({ ...formData, ifsc_code: e.target.value })} />
                  </div>
                </div>

                <h4 style={{ marginTop: '24px', marginBottom: '12px', color: 'var(--text-dark)' }}>System Status</h4>
                <div className="inv-form-group">
                  <label>Vendor Status</label>
                  <select className="inv-select" value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })}>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Blacklisted">Blacklisted</option>
                  </select>
                </div>

              </form>
            </div>
            <div className="inv-drawer-footer">
              <button type="button" className="action-btn" onClick={() => setIsDrawerOpen(false)} style={{ padding: '10px 20px', color: 'var(--text-mid)' }}>Cancel</button>
              <button type="submit" form="vendor-form" className="btn-primary">
                {editingVendor ? 'Save Changes' : 'Register Vendor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InventoryVendors;
