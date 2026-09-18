import { useState, useEffect } from 'react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import Select from 'react-select';
import { fetchWithBranchContext, appendBranchContext } from '../../utils/branchContext';
import '../../assets/CSS/InventoryVendors.css'; // Reusing glassmorphic CSS

const API_URL = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

function InventoryTransfers() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [transfers, setTransfers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [items, setItems] = useState([]);
  const [batches, setBatches] = useState([]);

  const [loading, setLoading] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const initialFormState = {
    from_branch_id: '',
    to_branch_id: '',
    notes: '',
    items: [{ item_id: '', batch_id: '', quantity: '' }]
  };

  const [formData, setFormData] = useState(initialFormState);

  const fetchTransfers = async () => {
    setLoading(true);
    try {
      const result = await fetchWithBranchContext('/api/v2/inventory/transfers');
      if (result.success) {
        setTransfers(result.data);
      }
    } catch {
      showAlert('error', 'Failed to fetch transfers');
    }
    setLoading(false);
  };

  const fetchDropdownData = async () => {
    try {
      const [infraRes, itemsRes, batchesRes] = await Promise.all([
        fetch(`${API_URL}/api/branches`, { headers: authHdr() }),
        fetch(`${API_URL}/api/v2/inventory/items`),
        fetch(`${API_URL}/api/v2/inventory/batches`)
      ]);
      const infraData = await infraRes.json();
      const itemsData = await itemsRes.json();
      const batchesData = await batchesRes.json();

      if (infraData.success) {
        setBranches((infraData.branches || []).map(b => ({
          ...b,
          name: b.branch_name
        })));
      }
      if (itemsData.success) setItems(itemsData.data);
      if (batchesData.success) {
        // Sort batches by expiry date ASC to support FIFO suggestion
        const sortedBatches = batchesData.data.sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));
        setBatches(sortedBatches);
      }
    } catch {
      showAlert('error', 'Failed to load reference data');
    }
  };

  useEffect(() => {
    fetchTransfers();
    fetchDropdownData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/api/v2/inventory/transfers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          created_by: 1 // Mock user ID for now
        })
      });

      const data = await response.json();
      if (data.success) {
        showAlert('success', 'Transfer request created successfully');
        setIsDrawerOpen(false);
        setFormData(initialFormState);
        fetchTransfers();
      } else {
        showAlert('error', data.message);
      }
    } catch {
      showAlert('error', 'Failed to create transfer');
    }
  };

  const updateStatus = async (id, status) => {
    try {
      const response = await fetch(`${API_URL}/api/v2/inventory/transfers/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, user_id: 1 })
      });
      const data = await response.json();
      if (data.success) {
        showAlert('success', `Transfer status updated to ${status}`);
        fetchTransfers();
      } else {
        showAlert('error', data.message);
      }
    } catch {
      showAlert('error', 'Failed to update transfer status');
    }
  };

  const handleAddNew = () => {
    const assignedBranchId = localStorage.getItem('branch_id');
    setFormData({
      ...initialFormState,
      from_branch_id: assignedBranchId ? parseInt(assignedBranchId) : ''
    });
    setIsDrawerOpen(true);
  };

  const addLineItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { item_id: '', batch_id: '', quantity: '' }]
    });
  };

  const updateLineItem = (index, field, value) => {
    const newItems = [...formData.items];
    newItems[index][field] = value;
    // Auto-select first available batch (FIFO) if item changes
    if (field === 'item_id') {
      const availableBatches = batches.filter(b => b.item_id === value && b.branch_id === formData.from_branch_id && b.status === 'Active');
      if (availableBatches.length > 0) {
        newItems[index].batch_id = availableBatches[0].id; // Suggest earliest expiry (since we sorted earlier)
      } else {
        newItems[index].batch_id = '';
      }
    }
    setFormData({ ...formData, items: newItems });
  };

  const removeLineItem = (index) => {
    const newItems = formData.items.filter((_, i) => i !== index);
    setFormData({ ...formData, items: newItems });
  };

  const getStatusBadge = (status) => {
    const styles = {
      PENDING: { bg: '#fefce8', color: '#ca8a04' },
      APPROVED: { bg: '#dbeafe', color: '#2563eb' },
      IN_TRANSIT: { bg: '#f3e8ff', color: '#9333ea' },
      COMPLETED: { bg: '#dcfce7', color: '#166534' },
      CANCELLED: { bg: '#fee2e2', color: '#dc2626' }
    };
    const s = styles[status] || styles.PENDING;
    return <span style={{ padding: '4px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, background: s.bg, color: s.color }}>{status}</span>;
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
          <h1 className="inv-title">Stock Transfer Operations</h1>
          <p className="inv-subtitle">Manage internal supply chain across multiple lab branches</p>
        </div>
        <button className="btn-primary" onClick={handleAddNew}>
          + New Transfer Request
        </button>
      </div>

      <div className="inv-card">
        <table className="inv-table">
          <thead>
            <tr>
              <th>Transfer Ref #</th>
              <th>From Branch</th>
              <th>To Branch</th>
              <th>Status</th>
              <th>Requested By</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" style={{ textAlign: 'center' }}>Loading transfers...</td></tr>
            ) : transfers.length === 0 ? (
              <tr><td colSpan="6" style={{ textAlign: 'center' }}>No transfers found.</td></tr>
            ) : (
              transfers.map(txn => (
                <tr key={txn.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{txn.transfer_number}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-soft)' }}>{new Date(txn.created_at).toLocaleDateString()}</div>
                  </td>
                  <td><span style={{ fontWeight: 600 }}>{txn.from_branch_name}</span></td>
                  <td><span style={{ fontWeight: 600 }}>{txn.to_branch_name}</span></td>
                  <td>{getStatusBadge(txn.status)}</td>
                  <td>{txn.created_by_name}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {txn.status === 'PENDING' && (
                        <>
                          <button onClick={() => updateStatus(txn.id, 'APPROVED')} className="btn-primary" style={{ padding: '4px 8px', fontSize: '12px' }}>Approve</button>
                          <button onClick={() => updateStatus(txn.id, 'CANCELLED')} className="btn-secondary" style={{ padding: '4px 8px', fontSize: '12px', color: 'red' }}>Cancel</button>
                        </>
                      )}
                      {txn.status === 'APPROVED' && (
                        <button onClick={() => updateStatus(txn.id, 'IN_TRANSIT')} className="btn-primary" style={{ padding: '4px 8px', fontSize: '12px', background: '#9333ea' }}>Dispatch</button>
                      )}
                      {txn.status === 'IN_TRANSIT' && (
                        <button onClick={() => updateStatus(txn.id, 'COMPLETED')} className="btn-primary" style={{ padding: '4px 8px', fontSize: '12px', background: '#166534' }}>Receive</button>
                      )}
                    </div>
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
          <div className="inv-drawer" style={{ width: '800px', maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
            <div className="inv-drawer-header">
              <h2>New Stock Transfer Request</h2>
              <button className="inv-drawer-close" onClick={() => setIsDrawerOpen(false)}>&times;</button>
            </div>
            <div className="inv-drawer-body">
              <form id="transfer-form" onSubmit={handleSubmit}>

                <h4 style={{ marginBottom: '12px', color: 'var(--text-dark)' }}>Routing Information</h4>
                <div className="inv-grid-2">
                  <div className="inv-form-group">
                    <label>Source Branch (From) *</label>
                    <Select
                      options={branches.map(b => ({ value: b.id, label: b.name }))}
                      value={formData.from_branch_id ? { value: formData.from_branch_id, label: branches.find(b => b.id === formData.from_branch_id)?.name } : null}
                      onChange={(selected) => {
                        setFormData({ ...formData, from_branch_id: selected ? selected.value : '', items: [{ item_id: '', batch_id: '', quantity: '' }] });
                      }}
                      required
                      styles={selectStyles}
                      isDisabled={localStorage.getItem('role_level') !== '1' && !!localStorage.getItem('branch_id')}
                    />
                  </div>

                  <div className="inv-form-group">
                    <label>Destination Branch (To) *</label>
                    <Select
                      options={branches.filter(b => b.id !== formData.from_branch_id).map(b => ({ value: b.id, label: b.name }))}
                      value={formData.to_branch_id ? { value: formData.to_branch_id, label: branches.find(b => b.id === formData.to_branch_id)?.name } : null}
                      onChange={(selected) => setFormData({ ...formData, to_branch_id: selected ? selected.value : '' })}
                      required
                      styles={selectStyles}
                    />
                  </div>
                </div>

                <h4 style={{ marginTop: '24px', marginBottom: '12px', color: 'var(--text-dark)' }}>Transfer Items</h4>
                <table className="inv-table" style={{ marginBottom: '10px' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '35%' }}>Item</th>
                      <th style={{ width: '40%' }}>FIFO Batch (Available Qty)</th>
                      <th style={{ width: '15%' }}>Qty to Transfer</th>
                      <th style={{ width: '10%' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.items.map((lineItem, index) => {
                      const availableBatches = batches.filter(b => b.item_id === lineItem.item_id && b.branch_id === formData.from_branch_id && b.status === 'Active');
                      return (
                        <tr key={index}>
                          <td>
                            <Select
                              options={items.map(i => ({ value: i.id, label: i.item_name }))}
                              value={lineItem.item_id ? { value: lineItem.item_id, label: items.find(i => i.id === lineItem.item_id)?.item_name } : null}
                              onChange={(selected) => updateLineItem(index, 'item_id', selected ? selected.value : '')}
                              required
                              styles={selectStyles}
                              isDisabled={!formData.from_branch_id}
                            />
                          </td>
                          <td>
                            <Select
                              options={availableBatches.map(b => ({ value: b.id, label: `${b.batch_number} (Qty: ${b.quantity_available})` }))}
                              value={lineItem.batch_id ? { value: lineItem.batch_id, label: availableBatches.find(b => b.id === lineItem.batch_id)?.batch_number + ' (Qty: ' + availableBatches.find(b => b.id === lineItem.batch_id)?.quantity_available + ')' } : null}
                              onChange={(selected) => updateLineItem(index, 'batch_id', selected ? selected.value : '')}
                              required
                              styles={selectStyles}
                              isDisabled={!lineItem.item_id}
                              placeholder="Select Batch..."
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              className="inv-input"
                              min="1"
                              required
                              value={lineItem.quantity}
                              onChange={(e) => updateLineItem(index, 'quantity', parseInt(e.target.value) || '')}
                            />
                          </td>
                          <td>
                            <button type="button" onClick={() => removeLineItem(index)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '18px' }}>
                              🗑️
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <button type="button" onClick={addLineItem} style={{ background: '#e0e7ff', color: '#4338ca', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                  + Add Another Item
                </button>

                <div className="inv-form-group" style={{ marginTop: '24px' }}>
                  <label>Notes / Justification</label>
                  <textarea className="inv-textarea" rows="2" value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="Reason for transfer..." />
                </div>

              </form>
            </div>
            <div className="inv-drawer-footer">
              <button type="button" className="action-btn" onClick={() => setIsDrawerOpen(false)} style={{ padding: '10px 20px', color: 'var(--text-mid)' }}>Cancel</button>
              <button type="submit" form="transfer-form" className="btn-primary">
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InventoryTransfers;
