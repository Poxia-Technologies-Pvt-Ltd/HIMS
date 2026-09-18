import { useState, useEffect } from 'react';
import {
  Package,
  Download,
  Plus,
  Search,
  Edit2,
  Trash2,
  X
} from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import '../../assets/CSS/InventoryVendors.css';

const API_URL = import.meta.env.VITE_API_URL || '';

function InventoryItemMaster() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const initialFormState = {
    item_code: '',
    item_name: '',
    category: 'Consumable',
    unit: 'pcs',
    min_stock_level: 0,
    reorder_level: 0,
    status: 'Active',
    default_vendor_id: '',
    delivery_lead_time_days: 3,
    unit_price: 0
  };

  const [formData, setFormData] = useState(initialFormState);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (categoryFilter) params.append('category', categoryFilter);

      const response = await fetch(`${API_URL}/api/v2/inventory/items?${params}`);
      const data = await response.json();
      if (data.success) {
        setItems(data.data);
      }
    } catch {
      showAlert('error', 'Failed to fetch items');
    }
    setLoading(false);
  };

  const fetchVendors = async () => {
    try {
      const response = await fetch(`${API_URL}/api/v2/inventory/vendors?status=Active`);
      const data = await response.json();
      if (data.success) {
        setVendors(data.data);
      }
    } catch (error) {
      console.error('Error fetching vendors:', error);
    }
  };

  useEffect(() => {
    fetchItems();
    fetchVendors();
  }, [categoryFilter]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchItems();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editingItem
        ? `${API_URL}/api/v2/inventory/items/${editingItem.id}`
        : `${API_URL}/api/v2/inventory/items`;
      const method = editingItem ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          min_stock_level: parseInt(formData.min_stock_level) || 0,
          reorder_level: parseInt(formData.reorder_level) || 0,
          default_vendor_id: formData.default_vendor_id || null,
          delivery_lead_time_days: parseInt(formData.delivery_lead_time_days) || 3,
          unit_price: parseFloat(formData.unit_price) || 0
        })
      });

      const data = await response.json();
      if (data.success) {
        showAlert('success', editingItem ? 'Item updated successfully' : 'Item created successfully');
        setIsDrawerOpen(false);
        setFormData(initialFormState);
        fetchItems();
      } else {
        showAlert('error', data.message);
      }
    } catch {
      showAlert('error', 'Failed to save item');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to remove this item?')) return;

    try {
      const response = await fetch(`${API_URL}/api/v2/inventory/items/${id}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      if (data.success) {
        showAlert('success', 'Item deleted successfully');
        fetchItems();
      } else {
        showAlert('error', data.message);
      }
    } catch {
      showAlert('error', 'Failed to delete item');
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setFormData({
      item_code: item.item_code,
      item_name: item.item_name,
      category: item.category,
      unit: item.unit,
      min_stock_level: item.min_stock_level,
      reorder_level: item.reorder_level,
      status: item.status,
      default_vendor_id: item.default_vendor_id || '',
      delivery_lead_time_days: item.delivery_lead_time_days || 3,
      unit_price: item.unit_price || 0
    });
    setIsDrawerOpen(true);
  };

  const handleAddNew = () => {
    setEditingItem(null);
    setFormData(initialFormState);
    setIsDrawerOpen(true);
  };

  const handleExportCSV = () => {
    if (!items.length) {
      showAlert('error', 'No items to export');
      return;
    }
    const headers = ['Item Code', 'Item Name', 'Category', 'Unit', 'Default Vendor', 'Price', 'Lead Time', 'Min Stock', 'Status'];
    const csvRows = [headers.join(',')];

    items.forEach(item => {
      csvRows.push([
        item.item_code,
        `"${item.item_name}"`,
        item.category,
        item.unit,
        `"${item.vendor_name || '—'}"`,
        item.unit_price,
        item.delivery_lead_time_days,
        item.min_stock_level,
        item.status
      ].join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Inventory_Master_Export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showAlert('success', 'Master catalog exported to CSV');
  };

  return (
    <div className="inv-vendor-page">
      {alert && <Alert type={alert.type} message={alert.message} onClose={hideAlert} />}

      <div className="inv-header">
        <div>
          <h1 className="inv-title">Item Master Catalog</h1>
          <p className="inv-subtitle">Manage hospital consumables, reagents, and equipment</p>
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
            <Plus size={16} /> Add New Item
          </button>
        </div>
      </div>

      <div className="inv-card">
        <div className="inv-toolbar">
          <form className="inv-search" onSubmit={handleSearch} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Search size={16} color="var(--text-soft)" />
            <input
              type="text"
              placeholder="Search items by name, code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </form>

          <select
            className="inv-select"
            style={{ width: '200px', background: 'var(--bg-white)' }}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All Categories</option>
            <option value="Consumable">Consumable</option>
            <option value="Reagent">Reagent</option>
            <option value="Equipment">Equipment</option>
          </select>
        </div>

        <table className="inv-table">
          <thead>
            <tr>
              <th>Item Code</th>
              <th>Item Name</th>
              <th>Category</th>
              <th>Unit</th>
              <th>Default Vendor</th>
              <th>Price</th>
              <th>Lead Time</th>
              <th>Min Stock</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="12" style={{ textAlign: 'center' }}>Loading items...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan="12" style={{ textAlign: 'center' }}>No items found.</td></tr>
            ) : (
              items.map(item => (
                <tr key={item.id}>
                  <td><strong>{item.item_code}</strong></td>
                  <td style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{item.item_name}</td>
                  <td>
                    <span style={{
                      padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                      background: item.category === 'Reagent' ? '#e0e7ff' : item.category === 'Equipment' ? '#fce7f3' : '#f1f5f9',
                      color: item.category === 'Reagent' ? '#4338ca' : item.category === 'Equipment' ? '#be185d' : '#475569'
                    }}>
                      {item.category}
                    </span>
                  </td>
                  <td>{item.unit}</td>
                  <td>
                    {item.default_vendor_name ? (
                      <span style={{ color: 'var(--text-dark)', fontWeight: 500 }}>
                        {item.default_vendor_name}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-soft)', fontStyle: 'italic', fontSize: '12px' }}>
                        Not Assigned
                      </span>
                    )}
                  </td>
                  <td style={{ fontWeight: 600, color: 'var(--text-dark)' }}>
                    ₹{parseFloat(item.unit_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td>
                    <span style={{
                      padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                      background: '#fef3c7', color: '#92400e'
                    }}>
                      {item.delivery_lead_time_days} Days
                    </span>
                  </td>
                  <td>
                    <div style={{ color: 'var(--text-dark)' }}>{item.min_stock_level} {item.unit}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-soft)' }}>Reorder at: {item.reorder_level}</div>
                  </td>
                  <td>
                    <span className={`inv-badge ${item.status.toLowerCase()}`}>
                      {item.status}
                    </span>
                  </td>
                  <td>
                    <button className="action-btn" onClick={() => handleEdit(item)} title="Edit">
                      <Edit2 size={16} />
                    </button>
                    <button className="action-btn" onClick={() => handleDelete(item.id)} title="Delete" style={{ marginLeft: '8px', color: '#ef4444' }}>
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
              <h2>{editingItem ? 'Edit Item Details' : 'Add New Item'}</h2>
              <button className="inv-drawer-close" onClick={() => setIsDrawerOpen(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={20} />
              </button>
            </div>
            <div className="inv-drawer-body">
              <form id="item-form" onSubmit={handleSubmit}>

                <h4 style={{ marginBottom: '12px', color: 'var(--text-dark)' }}>Basic Information</h4>
                <div className="inv-grid-2">
                  <div className="inv-form-group">
                    <label>Item Code (Auto if blank)</label>
                    <input className="inv-input" value={formData.item_code} onChange={e => setFormData({ ...formData, item_code: e.target.value })} placeholder="e.g., REAG-001" />
                  </div>
                  <div className="inv-form-group">
                    <label>Item Name *</label>
                    <input className="inv-input" required value={formData.item_name} onChange={e => setFormData({ ...formData, item_name: e.target.value })} placeholder="e.g., EDTA Tube" />
                  </div>
                </div>

                <div className="inv-grid-2">
                  <div className="inv-form-group">
                    <label>Category *</label>
                    <select className="inv-select" required value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}>
                      <option value="Consumable">Consumable</option>
                      <option value="Reagent">Reagent</option>
                      <option value="Equipment">Equipment</option>
                    </select>
                  </div>
                  <div className="inv-form-group">
                    <label>Unit of Measure *</label>
                    <input className="inv-input" required value={formData.unit} onChange={e => setFormData({ ...formData, unit: e.target.value })} placeholder="e.g., pcs, box, ml" />
                  </div>
                </div>

                <h4 style={{ marginTop: '24px', marginBottom: '12px', color: 'var(--text-dark)' }}>Procurement Settings</h4>
                <div className="inv-grid-2">
                  <div className="inv-form-group">
                    <label>Default Vendor</label>
                    <select
                      className="inv-select"
                      value={formData.default_vendor_id}
                      onChange={e => setFormData({ ...formData, default_vendor_id: e.target.value })}
                    >
                      <option value="">Select a preferred vendor...</option>
                      {vendors.map(vendor => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.vendor_name} ({vendor.vendor_code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="inv-form-group">
                    <label>Per Unit Price (₹)</label>
                    <input
                      className="inv-input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.unit_price}
                      onChange={e => setFormData({ ...formData, unit_price: e.target.value })}
                      placeholder="e.g., 45.00"
                    />
                  </div>
                </div>
                <p style={{ fontSize: '11px', color: 'var(--text-soft)', marginTop: '-8px', marginBottom: '16px' }}>
                  Standard price used for automated purchase orders and financial tracking.
                </p>

                <h4 style={{ marginTop: '24px', marginBottom: '12px', color: 'var(--text-dark)' }}>Inventory Controls</h4>
                <div className="inv-grid-2">
                  <div className="inv-form-group">
                    <label>Minimum Stock Level</label>
                    <input className="inv-input" type="number" min="0" value={formData.min_stock_level} onChange={e => setFormData({ ...formData, min_stock_level: e.target.value })} />
                  </div>
                  <div className="inv-form-group">
                    <label>Reorder Level</label>
                    <input className="inv-input" type="number" min="0" value={formData.reorder_level} onChange={e => setFormData({ ...formData, reorder_level: e.target.value })} />
                  </div>
                </div>

                <div className="inv-form-group" style={{ marginTop: '16px' }}>
                  <label>Max Delivery Days (Lead Time)</label>
                  <input
                    className="inv-input"
                    type="number"
                    min="1"
                    value={formData.delivery_lead_time_days}
                    onChange={e => setFormData({ ...formData, delivery_lead_time_days: e.target.value })}
                  />
                  <p style={{ fontSize: '11px', color: 'var(--text-soft)', marginTop: '4px' }}>
                    Estimated days for delivery after placing a purchase order.
                  </p>
                </div>

                <h4 style={{ marginTop: '24px', marginBottom: '12px', color: 'var(--text-dark)' }}>System Status</h4>
                <div className="inv-form-group">
                  <label>Item Status</label>
                  <select className="inv-select" value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })}>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>

              </form>
            </div>
            <div className="inv-drawer-footer">
              <button type="button" className="action-btn" onClick={() => setIsDrawerOpen(false)} style={{ padding: '10px 20px', color: 'var(--text-mid)' }}>Cancel</button>
              <button type="submit" form="item-form" className="btn-primary">
                {editingItem ? 'Save Changes' : 'Create Item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InventoryItemMaster;
