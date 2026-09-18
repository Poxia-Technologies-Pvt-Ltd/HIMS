import { useState, useEffect } from 'react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import '../../assets/CSS/InventoryMaster.css';

const CATEGORIES = [
  'Reagents', 'Consumables', 'Test Kits', 'Calibrators',
  'Controls', 'Glassware', 'General Lab Supplies'
];

const UNITS = ['ml', 'liter', 'test', 'box', 'pack', 'piece', 'mg', 'g', 'kg'];

const API_URL = import.meta.env.VITE_API_URL || 'http://172.16.11.160:5001';

function InventoryMaster() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [items, setItems] = useState([]);
  const [categories] = useState(CATEGORIES);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [filterCategory, setFilterCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showBatches, setShowBatches] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [batches, setBatches] = useState([]);

  const [formData, setFormData] = useState({
    item_name: '',
    category: '',
    brand: '',
    manufacturer: '',
    unit: 'ml',
    min_stock_level: 0,
    reorder_level: 0,
    storage_condition: '',
    cost_price: 0,
    selling_cost: 0,
    expiry_required: false,
    lot_tracking: false,
    status: 'Active'
  });

  const fetchItems = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterCategory) params.append('category', filterCategory);
      if (searchQuery) params.append('search', searchQuery);

      const response = await fetch(`${API_URL}/api/inventory/items?${params}`);
      const data = await response.json();
      if (data.success) {
        setItems(data.data);
      }
    } catch {
      showAlert('error', 'Failed to fetch items');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCategory]);

  const handleSearch = () => {
    fetchItems();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editingItem
        ? `${API_URL}/api/inventory/items/${editingItem.id}`
        : `${API_URL}/api/inventory/items`;
      const method = editingItem ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();
      if (data.success) {
        showAlert('success', editingItem ? 'Item updated successfully' : 'Item created successfully');
        setShowModal(false);
        resetForm();
        fetchItems();
      } else {
        showAlert('error', data.message);
      }
    } catch {
      showAlert('error', editingItem ? 'Failed to update item' : 'Failed to create item');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this item?')) return;

    try {
      const response = await fetch(`${API_URL}/api/inventory/items/${id}`, {
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
      item_name: item.item_name,
      category: item.category,
      brand: item.brand || '',
      manufacturer: item.manufacturer || '',
      unit: item.unit,
      min_stock_level: item.min_stock_level,
      reorder_level: item.reorder_level,
      storage_condition: item.storage_condition || '',
      cost_price: item.cost_price,
      selling_cost: item.selling_cost,
      expiry_required: item.expiry_required === 1,
      lot_tracking: item.lot_tracking === 1,
      status: item.status
    });
    setShowModal(true);
  };

  const handleAddNew = () => {
    setEditingItem(null);
    resetForm();
    setShowModal(true);
  };

  const resetForm = () => {
    setFormData({
      item_name: '',
      category: '',
      brand: '',
      manufacturer: '',
      unit: 'ml',
      min_stock_level: 0,
      reorder_level: 0,
      storage_condition: '',
      cost_price: 0,
      selling_cost: 0,
      expiry_required: false,
      lot_tracking: false,
      status: 'Active'
    });
  };

  const handleViewBatches = async (item) => {
    setSelectedItem(item);
    try {
      const response = await fetch(`${API_URL}/api/inventory/batches?item_id=${item.id}`);
      const data = await response.json();
      if (data.success) {
        setBatches(data.data);
        setShowBatches(true);
      }
    } catch {
      showAlert('error', 'Failed to fetch batches');
    }
  };

  const getStockStatus = (item) => {
    const available = item.available_stock || 0;
    if (available === 0) return { label: 'Out of Stock', class: 'status-out' };
    if (available <= item.min_stock_level) return { label: 'Critical', class: 'status-critical' };
    if (available <= item.reorder_level) return { label: 'Low', class: 'status-low' };
    return { label: 'OK', class: 'status-ok' };
  };

  return (
    <div className="inventory-master">
      {alert && <Alert type={alert.type} message={alert.message} onClose={hideAlert} />}

      <div className="page-header">
        <h1>Inventory Master</h1>
        <button className="btn-primary" onClick={handleAddNew}>
          + Add New Item
        </button>
      </div>

      <div className="filters">
        <div className="filter-group">
          <input
            type="text"
            placeholder="Search items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <button className="btn-secondary" onClick={handleSearch}>Search</button>
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="filter-select"
        >
          <option value="">All Categories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="loading">Loading...</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Brand</th>
                <th>Unit</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const stockStatus = getStockStatus(item);
                return (
                  <tr key={item.id}>
                    <td>{item.item_code}</td>
                    <td>{item.item_name}</td>
                    <td>{item.category}</td>
                    <td>{item.brand || '-'}</td>
                    <td>{item.unit}</td>
                    <td>
                      <span className={`stock-badge ${stockStatus.class}`}>
                        {item.available_stock || 0} {stockStatus.label}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${item.status.toLowerCase()}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="actions">
                      <button className="btn-icon" onClick={() => handleEdit(item)} title="Edit">✏️</button>
                      <button className="btn-icon" onClick={() => handleViewBatches(item)} title="Batches">📦</button>
                      <button className="btn-icon delete" onClick={() => handleDelete(item.id)} title="Delete">🗑️</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>{editingItem ? 'Edit Item' : 'Add New Item'}</h2>
              <button className="close-btn" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Item Name *</label>
                  <input
                    type="text"
                    value={formData.item_name}
                    onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Category *</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    required
                  >
                    <option value="">Select Category</option>
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Brand</label>
                  <input
                    type="text"
                    value={formData.brand}
                    onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Manufacturer</label>
                  <input
                    type="text"
                    value={formData.manufacturer}
                    onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Unit *</label>
                  <select
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    required
                  >
                    {UNITS.map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Min Stock Level</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.min_stock_level}
                    onChange={(e) => setFormData({ ...formData, min_stock_level: parseFloat(e.target.value) })}
                  />
                </div>
                <div className="form-group">
                  <label>Reorder Level</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.reorder_level}
                    onChange={(e) => setFormData({ ...formData, reorder_level: parseFloat(e.target.value) })}
                  />
                </div>
                <div className="form-group">
                  <label>Storage Condition</label>
                  <input
                    type="text"
                    value={formData.storage_condition}
                    onChange={(e) => setFormData({ ...formData, storage_condition: e.target.value })}
                    placeholder="e.g., 2-8°C"
                  />
                </div>
                <div className="form-group">
                  <label>Cost Price</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.cost_price}
                    onChange={(e) => setFormData({ ...formData, cost_price: parseFloat(e.target.value) })}
                  />
                </div>
                <div className="form-group">
                  <label>Selling/Usage Cost</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.selling_cost}
                    onChange={(e) => setFormData({ ...formData, selling_cost: parseFloat(e.target.value) })}
                  />
                </div>
                <div className="form-group checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={formData.expiry_required}
                      onChange={(e) => setFormData({ ...formData, expiry_required: e.target.checked })}
                    />
                    Expiry Date Required
                  </label>
                </div>
                <div className="form-group checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={formData.lot_tracking}
                      onChange={(e) => setFormData({ ...formData, lot_tracking: e.target.checked })}
                    />
                    Lot/Batch Tracking
                  </label>
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
                  {editingItem ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batches Modal */}
      {showBatches && selectedItem && (
        <div className="modal-overlay">
          <div className="modal modal-large">
            <div className="modal-header">
              <h2>Batches: {selectedItem.item_name}</h2>
              <button className="close-btn" onClick={() => setShowBatches(false)}>×</button>
            </div>
            <div className="modal-body">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Batch #</th>
                    <th>Lot #</th>
                    <th>Qty Available</th>
                    <th>Unit Cost</th>
                    <th>Expiry Date</th>
                    <th>Vendor</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map(batch => (
                    <tr key={batch.id}>
                      <td>{batch.batch_number}</td>
                      <td>{batch.lot_number || '-'}</td>
                      <td>{batch.quantity_available} {selectedItem.unit}</td>
                      <td>Rs. {batch.unit_cost}</td>
                      <td>{batch.expiry_date ? new Date(batch.expiry_date).toLocaleDateString() : '-'}</td>
                      <td>{batch.vendor_name || '-'}</td>
                      <td>
                        <span className={`status-badge ${batch.status.toLowerCase()}`}>
                          {batch.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InventoryMaster;
