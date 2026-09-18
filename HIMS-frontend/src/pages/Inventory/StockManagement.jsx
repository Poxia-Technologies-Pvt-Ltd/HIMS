import { useState, useEffect } from 'react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import '../../assets/CSS/InventoryMaster.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://172.16.11.160:5001';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

const TABS = [
  { id: 'stock', label: 'Current Stock', num: '1' },
  { id: 'batches', label: 'Batch/Lot Tracking', num: '2' },
  { id: 'transfers', label: 'Stock Transfers', num: '3' },
  { id: 'qc', label: 'QC/Controls', num: '4' }
];

function StockManagement() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [activeTab, setActiveTab] = useState('stock');
  const [items, setItems] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState('');
  const [selectedBatch, setSelectedBatch] = useState(null);

  const [formData, setFormData] = useState({
    item_id: '',
    batch_id: '',
    quantity: 0,
    reason: '',
    from_department: '',
    to_department: ''
  });

  const fetchDepartments = async () => {
    try {
      const response = await fetch(`${API_URL}/api/infra?type=Lab`, { headers: authHdr() });
      const data = await response.json();
      if (data.success) setDepartments(data.data);
    } catch {
      // silent
    }
  };

  const fetchInventoryItems = async () => {
    try {
      const response = await fetch(`${API_URL}/api/inventory/items?status=Active`, { headers: authHdr() });
      const data = await response.json();
      if (data.success) setInventoryItems(data.data);
    } catch {
      // silent
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      let endpoint = '';
      if (activeTab === 'stock') endpoint = '/api/inventory/stock';
      else if (activeTab === 'batches') endpoint = '/api/inventory/stock/batches';
      else if (activeTab === 'transfers') endpoint = '/api/inventory/transfers';
      else if (activeTab === 'qc') endpoint = '/api/inventory/qc-inventory';

      const response = await fetch(`${API_URL}${endpoint}`, { headers: authHdr() });
      const data = await response.json();
      if (data.success) setItems(data.data);
    } catch {
      showAlert('error', 'Failed to fetch data');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    fetchDepartments();
    fetchInventoryItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleAdjustStock = () => {
    setModalType('adjust');
    setFormData({ item_id: '', batch_id: '', quantity: 0, reason: '' });
    setShowModal(true);
  };

  const handleTransfer = () => {
    setModalType('transfer');
    setFormData({ from_department: '', to_department: '', transfer_date: new Date().toISOString().split('T')[0] });
    setShowModal(true);
  };

  const handleOpenVial = (batch) => {
    setSelectedBatch(batch);
    setModalType('openvial');
    setFormData({ open_vial_date: new Date().toISOString().split('T')[0], stability_days: 30 });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (modalType === 'adjust') {
        const response = await fetch(`${API_URL}/api/inventory/stock/adjust`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHdr() },
          body: JSON.stringify({
            item_id: formData.item_id,
            batch_id: formData.batch_id || null,
            adjustment_qty: parseFloat(formData.quantity),
            reason: formData.reason,
            performed_by: 1
          })
        });
        const data = await response.json();
        if (data.success) {
          showAlert('success', 'Stock adjusted successfully');
          setShowModal(false);
          fetchData();
        }
      } else if (modalType === 'transfer') {
        const response = await fetch(`${API_URL}/api/inventory/transfers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHdr() },
          body: JSON.stringify({
            from_department: formData.from_department,
            to_department: formData.to_department,
            transfer_date: formData.transfer_date,
            items: [{ item_id: formData.item_id, quantity: formData.quantity }],
            requested_by: 1
          })
        });
        const data = await response.json();
        if (data.success) {
          showAlert('success', 'Transfer created successfully');
          setShowModal(false);
          fetchData();
        }
      } else if (modalType === 'openvial' && selectedBatch) {
        const response = await fetch(`${API_URL}/api/inventory/batches/${selectedBatch.id}/open-vial`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHdr() },
          body: JSON.stringify({
            open_vial_date: formData.open_vial_date,
            stability_days: formData.stability_days
          })
        });
        const data = await response.json();
        if (data.success) {
          showAlert('success', 'Vial opened successfully');
          setShowModal(false);
          fetchData();
        }
      }
    } catch {
      showAlert('error', 'Failed to process');
    }
  };

  const getDaysUntilExpiry = (expiryDate) => {
    if (!expiryDate) return null;
    const days = Math.ceil((new Date(expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
    return days;
  };

  const getExpiryBadge = (days) => {
    if (days === null) return <span className="status-badge">-</span>;
    if (days < 0) return <span className="status-badge expired">Expired</span>;
    if (days <= 7) return <span className="status-badge critical">{days} days</span>;
    if (days <= 30) return <span className="status-badge low">{days} days</span>;
    return <span className="status-badge ok">{days} days</span>;
  };

  return (
    <div className="inventory-master">
      {alert && <Alert type={alert.type} message={alert.message} onClose={hideAlert} />}

      <div className="page-header">
        <h1>Stock Management</h1>
        <div className="header-actions">
          {activeTab === 'stock' && (
            <button className="btn-primary" onClick={handleAdjustStock}>Adjust Stock</button>
          )}
          {activeTab === 'transfers' && (
            <button className="btn-primary" onClick={handleTransfer}>+ New Transfer</button>
          )}
        </div>
      </div>

      <div className="tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-num">{tab.num}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="table-container">
        {loading ? (
          <div className="loading">Loading...</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                {activeTab === 'stock' && (
                  <>
                    <th>Item Code</th>
                    <th>Item Name</th>
                    <th>Category</th>
                    <th>Current Stock</th>
                    <th>Available</th>
                    <th>Reserved</th>
                    <th>Consumed</th>
                    <th>Expired</th>
                    <th>Status</th>
                  </>
                )}
                {activeTab === 'batches' && (
                  <>
                    <th>Item</th>
                    <th>Batch #</th>
                    <th>Lot #</th>
                    <th>Qty Available</th>
                    <th>Unit Cost</th>
                    <th>Expiry Date</th>
                    <th>Days Left</th>
                    <th>Vendor</th>
                  </>
                )}
                {activeTab === 'transfers' && (
                  <>
                    <th>Transfer #</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Date</th>
                    <th>Items</th>
                    <th>Status</th>
                  </>
                )}
                {activeTab === 'qc' && (
                  <>
                    <th>Item</th>
                    <th>Batch #</th>
                    <th>Open Vial Date</th>
                    <th>Stability (days)</th>
                    <th>Days Remaining</th>
                    <th>Expiry</th>
                    <th>Action</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  {activeTab === 'stock' && (
                    <>
                      <td>{item.item_code}</td>
                      <td>{item.item_name}</td>
                      <td>{item.category}</td>
                      <td>{item.current_stock} {item.unit}</td>
                      <td>{item.available_stock} {item.unit}</td>
                      <td>{item.reserved_stock} {item.unit}</td>
                      <td>{item.consumed_stock} {item.unit}</td>
                      <td>{item.expired_stock} {item.unit}</td>
                      <td>
                        {item.available_stock <= item.reorder_level ? (
                          <span className="status-badge critical">Low Stock</span>
                        ) : (
                          <span className="status-badge ok">OK</span>
                        )}
                      </td>
                    </>
                  )}
                  {activeTab === 'batches' && (
                    <>
                      <td>{item.item_name}</td>
                      <td>{item.batch_number}</td>
                      <td>{item.lot_number || '-'}</td>
                      <td>{item.quantity_available} {item.unit}</td>
                      <td>Rs. {item.unit_cost}</td>
                      <td>{item.expiry_date ? new Date(item.expiry_date).toLocaleDateString() : '-'}</td>
                      <td>{getExpiryBadge(getDaysUntilExpiry(item.expiry_date))}</td>
                      <td>{item.vendor_name || '-'}</td>
                    </>
                  )}
                  {activeTab === 'transfers' && (
                    <>
                      <td>{item.transfer_number}</td>
                      <td>{item.from_department_name}</td>
                      <td>{item.to_department_name}</td>
                      <td>{new Date(item.transfer_date).toLocaleDateString()}</td>
                      <td>{item.item_count}</td>
                      <td>
                        <span className={`status-badge ${item.status.toLowerCase()}`}>{item.status}</span>
                      </td>
                    </>
                  )}
                  {activeTab === 'qc' && (
                    <>
                      <td>{item.item_name}</td>
                      <td>{item.batch_number}</td>
                      <td>{item.open_vial_date ? new Date(item.open_vial_date).toLocaleDateString() : '-'}</td>
                      <td>{item.stability_days || '-'}</td>
                      <td>
                        {item.remaining_usable_days !== null ? (
                          <span className={`status-badge ${item.remaining_usable_days <= 7 ? 'critical' : item.remaining_usable_days <= 14 ? 'low' : 'ok'}`}>
                            {item.remaining_usable_days} days
                          </span>
                        ) : '-'}
                      </td>
                      <td>{getExpiryBadge(item.days_until_expiry)}</td>
                      <td>
                        {!item.open_vial_date && (
                          <button className="btn-primary" onClick={() => handleOpenVial(item)} style={{ padding: '4px 12px', fontSize: '12px' }}>
                            Open Vial
                          </button>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modals */}
      {showModal && modalType === 'adjust' && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Adjust Stock</h2>
              <button className="close-btn" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-group full-width">
                    <label>Item *</label>
                    <select
                      value={formData.item_id}
                      onChange={(e) => setFormData({ ...formData, item_id: e.target.value })}
                      required
                    >
                      <option value="">Select Item</option>
                      {inventoryItems.map(i => (
                        <option key={i.id} value={i.id}>{i.item_name} ({i.item_code})</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Adjustment Quantity *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.quantity}
                      onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                      required
                      placeholder="Use negative for reduction"
                    />
                  </div>
                  <div className="form-group">
                    <label>Reason *</label>
                    <input
                      type="text"
                      value={formData.reason}
                      onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                      required
                      placeholder="e.g., Damaged, Spillage, Correction"
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Adjust</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showModal && modalType === 'transfer' && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>New Stock Transfer</h2>
              <button className="close-btn" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-group">
                    <label>From Department *</label>
                    <select
                      value={formData.from_department}
                      onChange={(e) => setFormData({ ...formData, from_department: e.target.value })}
                      required
                    >
                      <option value="">Select</option>
                      {departments.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>To Department *</label>
                    <select
                      value={formData.to_department}
                      onChange={(e) => setFormData({ ...formData, to_department: e.target.value })}
                      required
                    >
                      <option value="">Select</option>
                      {departments.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Transfer Date</label>
                    <input
                      type="date"
                      value={formData.transfer_date}
                      onChange={(e) => setFormData({ ...formData, transfer_date: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group full-width">
                    <label>Item *</label>
                    <select
                      value={formData.item_id}
                      onChange={(e) => setFormData({ ...formData, item_id: e.target.value })}
                      required
                    >
                      <option value="">Select Item</option>
                      {inventoryItems.map(i => (
                        <option key={i.id} value={i.id}>{i.item_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Quantity *</label>
                    <input
                      type="number"
                      value={formData.quantity}
                      onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                      required
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Create Transfer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showModal && modalType === 'openvial' && selectedBatch && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Open Vial - {selectedBatch.item_name}</h2>
              <button className="close-btn" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-group">
                    <label>Open Vial Date</label>
                    <input
                      type="date"
                      value={formData.open_vial_date}
                      onChange={(e) => setFormData({ ...formData, open_vial_date: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Stability After Opening (days)</label>
                    <input
                      type="number"
                      value={formData.stability_days}
                      onChange={(e) => setFormData({ ...formData, stability_days: parseInt(e.target.value) })}
                      required
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Record</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default StockManagement;
