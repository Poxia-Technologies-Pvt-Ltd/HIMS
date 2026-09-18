import { useState, useEffect } from 'react';
import {
  Box,
  Download,
  Plus,
  Search,
  Edit2,
  Trash2,
  X
} from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import Select from 'react-select';
import { fetchWithBranchContext, appendBranchContext } from '../../utils/branchContext';
import '../../assets/CSS/InventoryVendors.css';

const API_URL = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

function InventoryStockManagement() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [batches, setBatches] = useState([]);
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [branches, setBranches] = useState([]);

  const [loading, setLoading] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');

  const initialFormState = {
    item_id: '',
    vendor_id: '',
    branch_id: '',
    batch_number: '',
    expiry_date: '',
    quantity_available: 0,
    quantity_received: 0,
    status: 'Active'
  };

  const [formData, setFormData] = useState(initialFormState);

  const fetchBatches = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (statusFilter) params.append('status', statusFilter);
      if (branchFilter) params.append('branch_id', branchFilter);

      const url = appendBranchContext(`/api/inventory/batches?${params}`);
      const response = await fetch(`${API_URL}${url}`);
      const data = await response.json();
      if (data.success) {
        setBatches(data.data);
      }
    } catch {
      showAlert('error', 'Failed to fetch batches');
    }
    setLoading(false);
  };

  const fetchDropdownData = async () => {
    try {
      const [itemsRes, vendorsRes, branchesRes] = await Promise.all([
        fetch(`${API_URL}/api/v2/inventory/items`),
        fetch(`${API_URL}/api/v2/inventory/vendors`),
        fetch(`${API_URL}/api/branches`, { headers: authHdr() })
      ]);
      const itemsData = await itemsRes.json();
      const vendorsData = await vendorsRes.json();
      const branchesData = await branchesRes.json();

      if (itemsData.success) setItems(itemsData.data);
      if (vendorsData.success) setVendors(vendorsData.data);
      if (branchesData.success) {
        // Map branch_name to name for UI consistency if needed, or update usage
        const mappedBranches = (branchesData.branches || []).map(b => ({
          ...b,
          name: b.branch_name // Ensure it has .name for the dropdown usage
        }));
        setBranches(mappedBranches);
      }
    } catch {
      showAlert('error', 'Failed to load reference data');
    }
  };

  useEffect(() => {
    fetchBatches();
    fetchDropdownData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, branchFilter]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchBatches();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editingBatch
        ? `${API_URL}/api/v2/inventory/batches/${editingBatch.id}`
        : `${API_URL}/api/v2/inventory/batches`;
      const method = editingBatch ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          quantity_available: parseInt(formData.quantity_available) || 0,
          quantity_received: parseInt(formData.quantity_received) || parseInt(formData.quantity_available) || 0,
          item_id: formData.item_id ? parseInt(formData.item_id) : null,
          vendor_id: formData.vendor_id ? parseInt(formData.vendor_id) : null,
          branch_id: formData.branch_id ? parseInt(formData.branch_id) : null
        })
      });

      const data = await response.json();
      if (data.success) {
        showAlert('success', editingBatch ? 'Batch updated successfully' : 'Batch added successfully');
        setIsDrawerOpen(false);
        setFormData(initialFormState);
        fetchBatches();
      } else {
        showAlert('error', data.message);
      }
    } catch {
      showAlert('error', 'Failed to save batch');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to remove this batch?')) return;

    try {
      const response = await fetch(`${API_URL}/api/v2/inventory/batches/${id}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      if (data.success) {
        showAlert('success', 'Batch deleted successfully');
        fetchBatches();
      } else {
        showAlert('error', data.message);
      }
    } catch {
      showAlert('error', 'Failed to delete batch');
    }
  };

  const handleEdit = (batch) => {
    setEditingBatch(batch);
    setFormData({
      item_id: batch.item_id || '',
      vendor_id: batch.vendor_id || '',
      branch_id: batch.branch_id || '',
      batch_number: batch.batch_number,
      expiry_date: batch.expiry_date ? batch.expiry_date.split('T')[0] : '',
      quantity_available: batch.quantity_available,
      quantity_received: batch.quantity_received,
      status: batch.status
    });
    setIsDrawerOpen(true);
  };

  const handleAddNew = () => {
    setEditingBatch(null);
    setFormData(initialFormState);
    setIsDrawerOpen(true);
  };

  const handleExportCSV = () => {
    if (!batches.length) {
      showAlert('error', 'No stock data to export');
      return;
    }
    const headers = ['Batch Number', 'Item Name', 'Code', 'Branch', 'Vendor', 'Expiry', 'Available', 'Received', 'Status'];
    const csvRows = [headers.join(',')];

    batches.forEach(b => {
      csvRows.push([
        b.batch_number,
        `"${b.item_name}"`,
        b.item_code,
        `"${b.branch_name}"`,
        `"${b.vendor_name || '—'}"`,
        b.expiry_date ? b.expiry_date.split('T')[0] : '—',
        b.quantity_available,
        b.quantity_received,
        b.status
      ].join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Item_Wise_Stock_Report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    showAlert('success', 'Item-wise stock report exported to CSV');
  };

  return (
    <div className="inv-vendor-page">
      {alert && <Alert type={alert.type} message={alert.message} onClose={hideAlert} />}

      <div className="inv-header">
        <div>
          <h1 className="inv-title">Batch & Stock Management</h1>
          <p className="inv-subtitle">Track multiple batches, expiry dates, and current stock</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            className="btn-primary"
            onClick={handleExportCSV}
            style={{ background: '#10b981', borderColor: '#10b981', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Download size={16} /> Export CSV
          </button>
          <button className="btn-primary" onClick={handleAddNew} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Receive New Batch
          </button>
        </div>
      </div>

      <div className="inv-card">
        <div className="inv-toolbar" style={{ flexWrap: 'wrap' }}>
          <form className="inv-search" onSubmit={handleSearch} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Search size={16} color="var(--text-soft)" />
            <input
              type="text"
              placeholder="Search batches..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </form>

          <div style={{ display: 'flex', gap: '10px' }}>
            <select
              className="inv-select"
              style={{ width: '180px', background: 'var(--bg-white)' }}
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
            >
              <option value="">All Branches</option>
              {branches.map(branch => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>

            <select
              className="inv-select"
              style={{ width: '160px', background: 'var(--bg-white)' }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Quarantine">Quarantine</option>
              <option value="Expired">Expired</option>
              <option value="Empty">Empty</option>
            </select>
          </div>
        </div>

        <table className="inv-table">
          <thead>
            <tr>
              <th>Item Details</th>
              <th>Branch / Location</th>
              <th>Batch Number</th>
              <th>Supplier</th>
              <th>Expiry Date</th>
              <th>Stock Quantity</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" style={{ textAlign: 'center' }}>Loading batches...</td></tr>
            ) : batches.length === 0 ? (
              <tr><td colSpan="7" style={{ textAlign: 'center' }}>No batches found.</td></tr>
            ) : (
              batches.map(batch => (
                <tr key={batch.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{batch.item_name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-soft)' }}>{batch.item_code} • {batch.category}</div>
                  </td>
                  <td>
                    <span style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                      {batch.branch_name || 'Main'}
                    </span>
                  </td>
                  <td><strong>{batch.batch_number}</strong></td>
                  <td>{batch.vendor_name || '-'}</td>
                  <td>
                    <div style={{
                      color: batch.status === 'Expired' ? '#dc2626' : 'var(--text-dark)',
                      fontWeight: batch.status === 'Expired' ? 600 : 400
                    }}>
                      {batch.expiry_date ? new Date(batch.expiry_date).toLocaleDateString() : 'N/A'}
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: '16px', fontWeight: 600 }}>{batch.quantity_available} <span style={{ fontSize: '12px', fontWeight: 400 }}>{batch.unit}</span></div>
                  </td>
                  <td>
                    <span className={`inv-badge ${batch.status.toLowerCase()}`}>
                      {batch.status}
                    </span>
                  </td>
                  <td>
                    <button className="action-btn" onClick={() => handleEdit(batch)} title="Edit">
                      <Edit2 size={16} />
                    </button>
                    <button className="action-btn" onClick={() => handleDelete(batch.id)} title="Delete" style={{ marginLeft: '8px', color: '#ef4444' }}>
                      <Trash2 size={16} />
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
              <h2>{editingBatch ? 'Edit Batch Details' : 'Receive New Batch'}</h2>
              <button className="inv-drawer-close" onClick={() => setIsDrawerOpen(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={20} />
              </button>
            </div>
            <div className="inv-drawer-body">
              <form id="batch-form" onSubmit={handleSubmit}>

                <h4 style={{ marginBottom: '12px', color: 'var(--text-dark)' }}>Location & Item Details</h4>
                <div className="inv-form-group">
                  <label>Receiving Branch *</label>
                  <Select
                    options={branches.map(b => ({ value: b.id, label: b.name }))}
                    value={formData.branch_id ? {
                      value: formData.branch_id,
                      label: branches.find(b => b.id == formData.branch_id)?.name
                    } : null}
                    onChange={(selected) => setFormData({ ...formData, branch_id: selected ? selected.value : '' })}
                    placeholder="Search Branch..."
                    isClearable
                    required
                    styles={{
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
                    }}
                  />
                </div>

                <div className="inv-form-group">
                  <label>Select Item *</label>
                  <Select
                    options={items.map(i => ({ value: i.id, label: `${i.item_name} (${i.item_code})` }))}
                    value={formData.item_id ? {
                      value: formData.item_id,
                      label: items.find(i => i.id == formData.item_id)?.item_name + ' (' + items.find(i => i.id == formData.item_id)?.item_code + ')'
                    } : null}
                    onChange={(selected) => setFormData({ ...formData, item_id: selected ? selected.value : '' })}
                    placeholder="Search Item from Catalog..."
                    isClearable
                    required
                    styles={{
                      control: (base) => ({
                        ...base,
                        background: 'var(--bg-input)',
                        borderColor: 'var(--border-light)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '2px',
                        fontSize: '14px',
                        boxShadow: 'none',
                        '&:hover': {
                          borderColor: 'var(--blue-primary)'
                        }
                      })
                    }}
                  />
                </div>

                <div className="inv-form-group">
                  <label>Supplier (Vendor)</label>
                  <Select
                    options={vendors.map(v => ({ value: v.id, label: `${v.vendor_name} (${v.vendor_code})` }))}
                    value={formData.vendor_id ? {
                      value: formData.vendor_id,
                      label: vendors.find(v => v.id == formData.vendor_id)?.vendor_name + ' (' + vendors.find(v => v.id == formData.vendor_id)?.vendor_code + ')'
                    } : null}
                    onChange={(selected) => setFormData({ ...formData, vendor_id: selected ? selected.value : '' })}
                    placeholder="Search Supplier..."
                    isClearable
                    styles={{
                      control: (base) => ({
                        ...base,
                        background: 'var(--bg-input)',
                        borderColor: 'var(--border-light)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '2px',
                        fontSize: '14px',
                        boxShadow: 'none',
                        '&:hover': {
                          borderColor: 'var(--blue-primary)'
                        }
                      })
                    }}
                  />
                </div>

                <h4 style={{ marginTop: '24px', marginBottom: '12px', color: 'var(--text-dark)' }}>Batch Details</h4>
                <div className="inv-grid-2">
                  <div className="inv-form-group">
                    <label>Batch Number / Lot *</label>
                    <input className="inv-input" required value={formData.batch_number} onChange={e => setFormData({ ...formData, batch_number: e.target.value })} placeholder="e.g., LOT-2023-A" />
                  </div>
                  <div className="inv-form-group">
                    <label>Quantity Available *</label>
                    <input className="inv-input" type="number" min="0" required value={formData.quantity_available} onChange={e => setFormData({ ...formData, quantity_available: e.target.value })} />
                  </div>
                </div>

                <div className="inv-grid-2">
                  <div className="inv-form-group">
                    <label>Quantity Received</label>
                    <input className="inv-input" type="number" min="0" value={formData.quantity_received} onChange={e => setFormData({ ...formData, quantity_received: e.target.value })} />
                  </div>
                  <div className="inv-form-group">
                    <label>Expiry Date</label>
                    <input className="inv-input" type="date" value={formData.expiry_date} onChange={e => setFormData({ ...formData, expiry_date: e.target.value })} />
                  </div>
                </div>

                <h4 style={{ marginTop: '24px', marginBottom: '12px', color: 'var(--text-dark)' }}>Stock Status</h4>
                <div className="inv-form-group">
                  <label>Current Status</label>
                  <select className="inv-select" value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })}>
                    <option value="Active">Active (Ready to Use)</option>
                    <option value="Quarantine">Quarantine (Under Testing)</option>
                    <option value="Expired">Expired</option>
                    <option value="Empty">Empty (Out of Stock)</option>
                  </select>
                </div>

              </form>
            </div>
            <div className="inv-drawer-footer">
              <button type="button" className="action-btn" onClick={() => setIsDrawerOpen(false)} style={{ padding: '10px 20px', color: 'var(--text-mid)' }}>Cancel</button>
              <button type="submit" form="batch-form" className="btn-primary">
                {editingBatch ? 'Save Changes' : 'Receive Batch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InventoryStockManagement;
