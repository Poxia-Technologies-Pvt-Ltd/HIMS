import { useState, useEffect } from 'react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import '../../assets/CSS/InventoryMaster.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://172.16.11.160:5001';

function VendorManagement() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [formData, setFormData] = useState({
    vendor_name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: '',
    gst_number: '',
    payment_terms: '',
    lead_time_days: 7,
    status: 'Active'
  });

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);

      const response = await fetch(`${API_URL}/api/inventory/vendors?${params}`);
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

  const handleSearch = () => {
    fetchVendors();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editingVendor
        ? `${API_URL}/api/inventory/vendors/${editingVendor.id}`
        : `${API_URL}/api/inventory/vendors`;
      const method = editingVendor ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();
      if (data.success) {
        showAlert('success', editingVendor ? 'Vendor updated successfully' : 'Vendor created successfully');
        setShowModal(false);
        resetForm();
        fetchVendors();
      } else {
        showAlert('error', data.message);
      }
    } catch {
      showAlert('error', 'Failed to save vendor');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this vendor?')) return;

    try {
      const response = await fetch(`${API_URL}/api/inventory/vendors/${id}`, {
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
      gst_number: vendor.gst_number || '',
      payment_terms: vendor.payment_terms || '',
      lead_time_days: vendor.lead_time_days || 7,
      status: vendor.status
    });
    setShowModal(true);
  };

  const handleAddNew = () => {
    setEditingVendor(null);
    resetForm();
    setShowModal(true);
  };

  const resetForm = () => {
    setFormData({
      vendor_name: '',
      contact_person: '',
      phone: '',
      email: '',
      address: '',
      gst_number: '',
      payment_terms: '',
      lead_time_days: 7,
      status: 'Active'
    });
  };

  return (
    <div className="inventory-master">
      {alert && <Alert type={alert.type} message={alert.message} onClose={hideAlert} />}

      <div className="page-header">
        <h1>Vendor Management</h1>
        <button className="btn-primary" onClick={handleAddNew}>
          + Add New Vendor
        </button>
      </div>

      <div className="filters">
        <div className="filter-group">
          <input
            type="text"
            placeholder="Search vendors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <button className="btn-secondary" onClick={handleSearch}>Search</button>
        </div>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="loading">Loading...</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Vendor Code</th>
                <th>Name</th>
                <th>Contact Person</th>
                <th>Phone</th>
                <th>Email</th>
                <th>GST Number</th>
                <th>Lead Time</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map(vendor => (
                <tr key={vendor.id}>
                  <td>{vendor.vendor_code}</td>
                  <td>{vendor.vendor_name}</td>
                  <td>{vendor.contact_person || '-'}</td>
                  <td>{vendor.phone || '-'}</td>
                  <td>{vendor.email || '-'}</td>
                  <td>{vendor.gst_number || '-'}</td>
                  <td>{vendor.lead_time_days} days</td>
                  <td>
                    <span className={`status-badge ${vendor.status.toLowerCase()}`}>
                      {vendor.status}
                    </span>
                  </td>
                  <td className="actions">
                    <button className="btn-icon" onClick={() => handleEdit(vendor)} title="Edit">✏️</button>
                    <button className="btn-icon delete" onClick={() => handleDelete(vendor.id)} title="Delete">🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>{editingVendor ? 'Edit Vendor' : 'Add New Vendor'}</h2>
              <button className="close-btn" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Vendor Name *</label>
                  <input
                    type="text"
                    value={formData.vendor_name}
                    onChange={(e) => setFormData({ ...formData, vendor_name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Contact Person</label>
                  <input
                    type="text"
                    value={formData.contact_person}
                    onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="form-group full-width">
                  <label>Address</label>
                  <textarea
                    rows="3"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    style={{ padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: '8px', fontSize: '14px', resize: 'vertical' }}
                  />
                </div>
                <div className="form-group">
                  <label>GST/Tax Number</label>
                  <input
                    type="text"
                    value={formData.gst_number}
                    onChange={(e) => setFormData({ ...formData, gst_number: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Payment Terms</label>
                  <input
                    type="text"
                    value={formData.payment_terms}
                    onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value })}
                    placeholder="e.g., Net 30"
                  />
                </div>
                <div className="form-group">
                  <label>Lead Time (days)</label>
                  <input
                    type="number"
                    value={formData.lead_time_days}
                    onChange={(e) => setFormData({ ...formData, lead_time_days: parseInt(e.target.value) })}
                  />
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingVendor ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default VendorManagement;
