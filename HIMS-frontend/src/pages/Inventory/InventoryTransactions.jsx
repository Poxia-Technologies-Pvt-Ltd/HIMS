import { useState, useEffect } from 'react';
import {
  Activity,
  Download,
  Plus,
  X
} from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import Select from 'react-select';
import { appendBranchContext } from '../../utils/branchContext';
import '../../assets/CSS/InventoryVendors.css'; // Reusing glassmorphic CSS

const API_URL = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

function InventoryTransactions() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [transactions, setTransactions] = useState([]);
  const [items, setItems] = useState([]);
  const [batches, setBatches] = useState([]);
  const [branches, setBranches] = useState([]);

  const [loading, setLoading] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState(localStorage.getItem('branch_id') || '');

  const initialFormState = {
    branch_id: '',
    item_id: '',
    batch_id: '',
    type: 'OUT',
    quantity: '',
    reference_type: 'Manual',
    remarks: ''
  };

  const [formData, setFormData] = useState(initialFormState);

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.append('type', typeFilter);
      if (branchFilter) params.append('branch_id', branchFilter);

      const url = appendBranchContext(`/api/inventory/stock/transactions?${params}`);
      const response = await fetch(`${API_URL}${url}`);
      const data = await response.json();
      if (data.success) {
        setTransactions(data.data);
      }
    } catch {
      showAlert('error', 'Failed to fetch transactions');
    }
    setLoading(false);
  };

  const fetchDropdownData = async () => {
    try {
      const [itemsRes, batchesRes, branchesRes] = await Promise.all([
        fetch(`${API_URL}/api/v2/inventory/items`),
        fetch(`${API_URL}/api/v2/inventory/batches`),
        fetch(`${API_URL}/api/branches`, { headers: authHdr() })
      ]);
      const itemsData = await itemsRes.json();
      const batchesData = await batchesRes.json();
      const branchesData = await branchesRes.json();

      if (itemsData.success) setItems(itemsData.data);
      if (batchesData.success) setBatches(batchesData.data);
      if (branchesData.success) {
        setBranches((branchesData.branches || []).map(b => ({
          ...b,
          name: b.branch_name
        })));
      }
    } catch {
      showAlert('error', 'Failed to load reference data');
    }
  };

  useEffect(() => {
    fetchTransactions();
    fetchDropdownData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, branchFilter]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/api/v2/inventory/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          quantity: parseInt(formData.quantity) || 0,
          item_id: parseInt(formData.item_id),
          batch_id: parseInt(formData.batch_id),
          branch_id: parseInt(formData.branch_id),
          created_by: 1 // Mock user ID for now
        })
      });

      const data = await response.json();
      if (data.success) {
        showAlert('success', 'Transaction logged successfully');
        setIsDrawerOpen(false);
        setFormData(initialFormState);
        fetchTransactions();
      } else {
        showAlert('error', data.message);
      }
    } catch {
      showAlert('error', 'Failed to save transaction');
    }
  };

  const handleAddNew = () => {
    const assignedBranchId = localStorage.getItem('branch_id');
    setFormData({
      ...initialFormState,
      branch_id: assignedBranchId ? parseInt(assignedBranchId) : ''
    });
    setIsDrawerOpen(true);
  };

  const handleExportCSV = () => {
    if (!transactions.length) {
      showAlert('error', 'No transactions to export');
      return;
    }
    const headers = ['Date', 'Branch', 'Item', 'Code', 'Batch', 'Type', 'Quantity', 'Reference', 'Remarks'];
    const csvRows = [headers.join(',')];

    transactions.forEach(txn => {
      csvRows.push([
        new Date(txn.created_at).toLocaleString(),
        `"${txn.branch_name}"`,
        `"${txn.item_name}"`,
        txn.item_code,
        txn.batch_number,
        txn.type,
        txn.quantity,
        txn.reference_type,
        `"${(txn.remarks || '').replace(/"/g, '""')}"`
      ].join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Stock_Transactions_Ledger_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    showAlert('success', 'Transaction ledger exported to CSV');
  };

  // Filter batches based on selected item AND branch
  const filteredBatches = batches.filter(b =>
    b.item_id == formData.item_id &&
    (formData.branch_id ? b.branch_id == formData.branch_id : true)
  );

  // Common react-select styles
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
          <h1 className="inv-title">Stock Ledger & Transactions</h1>
          <p className="inv-subtitle">The ultimate source of truth for all stock movements</p>
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
            <Plus size={18} /> Log Manual Adjustment
          </button>
        </div>
      </div>

      <div className="inv-card">
        <div className="inv-toolbar" style={{ justifyContent: 'flex-end', gap: '10px' }}>
          <select
            className="inv-select"
            style={{ width: '180px', background: 'var(--bg-white)' }}
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            disabled={localStorage.getItem('role_level') !== '1' && !!localStorage.getItem('branch_id')}
          >
            {localStorage.getItem('role_level') === '1' && <option value="">All Branches</option>}
            {branches
              .filter(branch => localStorage.getItem('role_level') === '1' || branch.id == localStorage.getItem('branch_id'))
              .map(branch => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))
            }
          </select>

          <select
            className="inv-select"
            style={{ width: '200px', background: 'var(--bg-white)' }}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All Transactions</option>
            <option value="IN">Stock IN</option>
            <option value="OUT">Stock OUT</option>
            <option value="ADJUSTMENT">Adjustments</option>
          </select>
        </div>

        <table className="inv-table">
          <thead>
            <tr>
              <th>Date / Time</th>
              <th>Branch</th>
              <th>Item Details</th>
              <th>Batch</th>
              <th>Type</th>
              <th>Quantity</th>
              <th>Audit Trail</th>
              <th>Reference & Remarks</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" style={{ textAlign: 'center' }}>Loading ledger...</td></tr>
            ) : transactions.length === 0 ? (
              <tr><td colSpan="6" style={{ textAlign: 'center' }}>No transactions found.</td></tr>
            ) : (
              transactions.map(txn => (
                <tr key={txn.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-dark)' }}>
                      {new Date(txn.created_at).toLocaleDateString()}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-soft)' }}>
                      {new Date(txn.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </td>
                  <td>
                    <span style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                      {txn.branch_name || 'Main'}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{txn.item_name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-soft)' }}>{txn.item_code}</div>
                  </td>
                  <td><strong>{txn.batch_number}</strong></td>
                  <td>
                    <span style={{
                      padding: '4px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                      background: txn.type === 'IN' ? '#ecfdf5' : txn.type === 'OUT' ? '#fef2f2' : '#fefce8',
                      color: txn.type === 'IN' ? '#059669' : txn.type === 'OUT' ? '#dc2626' : '#ca8a04'
                    }}>
                      {txn.type}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontSize: '16px', fontWeight: 600 }}>
                      {txn.type === 'IN' ? '+' : txn.type === 'OUT' ? '-' : ''}{txn.quantity} <span style={{ fontSize: '12px', fontWeight: 400 }}>{txn.unit}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-dark)' }}>
                      <span style={{ color: 'var(--text-soft)', fontWeight: 'normal' }}>By: </span>
                      {txn.first_name ? `${txn.first_name} ${txn.last_name || ''}` : 'System Auto'}
                    </div>
                  </td>
                  <td>
                    <div style={{ color: 'var(--text-dark)', fontWeight: 600 }}>
                      {txn.reference_type === 'Test' && txn.test_name ? `Test: ${txn.test_name}` : txn.reference_type}
                    </div>
                    {txn.reference_id && <div style={{ fontSize: '12px', color: 'var(--blue-primary)' }}>Ref: {txn.reference_id}</div>}
                    {txn.remarks && <div style={{ fontSize: '12px', color: 'var(--text-soft)', fontStyle: 'italic' }}>{txn.remarks}</div>}
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
              <h2>Log Manual Transaction</h2>
              <button className="inv-drawer-close" onClick={() => setIsDrawerOpen(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={20} />
              </button>
            </div>
            <div className="inv-drawer-body">
              <form id="txn-form" onSubmit={handleSubmit}>

                <h4 style={{ marginBottom: '12px', color: 'var(--text-dark)' }}>Select Inventory</h4>
                <div className="inv-form-group">
                  <label>Branch / Location *</label>
                  <Select
                    options={branches
                      .filter(branch => localStorage.getItem('role_level') === '1' || branch.id == localStorage.getItem('branch_id'))
                      .map(b => ({ value: b.id, label: b.name }))
                    }
                    value={formData.branch_id ? {
                      value: formData.branch_id,
                      label: branches.find(b => b.id == formData.branch_id)?.name
                    } : null}
                    onChange={(selected) => setFormData({ ...formData, branch_id: selected ? selected.value : '', batch_id: '' })}
                    placeholder="Search Branch..."
                    isClearable={localStorage.getItem('role_level') === '1'}
                    required
                    styles={selectStyles}
                    isDisabled={localStorage.getItem('role_level') !== '1' && !!localStorage.getItem('branch_id')}
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
                    onChange={(selected) => setFormData({ ...formData, item_id: selected ? selected.value : '', batch_id: '' })}
                    placeholder="Search Item..."
                    isClearable
                    required
                    styles={selectStyles}
                  />
                </div>

                <div className="inv-form-group">
                  <label>Select Batch *</label>
                  <Select
                    options={filteredBatches.map(b => ({
                      value: b.id,
                      label: `${b.batch_number} (Qty: ${b.quantity_available})`,
                      status: b.status // pass status to custom label
                    }))}
                    value={formData.batch_id ? {
                      value: formData.batch_id,
                      label: batches.find(b => b.id == formData.batch_id)?.batch_number + ' (Qty: ' + batches.find(b => b.id == formData.batch_id)?.quantity_available + ')',
                      status: batches.find(b => b.id == formData.batch_id)?.status
                    } : null}
                    onChange={(selected) => setFormData({ ...formData, batch_id: selected ? selected.value : '' })}
                    placeholder={formData.item_id ? "Search Batch in selected Branch..." : "Select Branch and Item first"}
                    isClearable
                    required
                    isDisabled={!formData.item_id || !formData.branch_id}
                    styles={selectStyles}
                    formatOptionLabel={(option) => (
                      <div style={{ color: option.status === 'Expired' ? '#dc2626' : 'inherit', fontWeight: option.status === 'Expired' ? 'bold' : 'normal' }}>
                        {option.label} {option.status === 'Expired' && '(Expired)'}
                      </div>
                    )}
                  />
                </div>

                <h4 style={{ marginTop: '24px', marginBottom: '12px', color: 'var(--text-dark)' }}>Transaction Details</h4>
                <div className="inv-grid-2">
                  <div className="inv-form-group">
                    <label>Transaction Type *</label>
                    <select className="inv-select" required value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })}>
                      <option value="OUT">Stock OUT (Decrease)</option>
                      <option value="IN">Stock IN (Increase)</option>
                      <option value="ADJUSTMENT">Adjustment</option>
                    </select>
                  </div>
                  <div className="inv-form-group">
                    <label>Quantity *</label>
                    <input className="inv-input" type="number" min="1" required value={formData.quantity} onChange={e => setFormData({ ...formData, quantity: e.target.value })} placeholder="e.g. 5" />
                  </div>
                </div>

                <div className="inv-form-group">
                  <label>Reason / Reference Type *</label>
                  <select className="inv-select" required value={formData.reference_type} onChange={e => setFormData({ ...formData, reference_type: e.target.value })}>
                    <option value="Manual">Manual Adjustment</option>
                    <option value="Wastage">Wastage / Breakage</option>
                    <option value="Expiry">Expiry Write-off</option>
                    <option value="Correction">Physical Count Correction</option>
                  </select>
                </div>

                <div className="inv-form-group">
                  <label>Remarks (Optional)</label>
                  <textarea className="inv-textarea" rows="3" value={formData.remarks} onChange={e => setFormData({ ...formData, remarks: e.target.value })} placeholder="Add notes about this transaction..." />
                </div>

              </form>
            </div>
            <div className="inv-drawer-footer">
              <button type="button" className="action-btn" onClick={() => setIsDrawerOpen(false)} style={{ padding: '10px 20px', color: 'var(--text-mid)' }}>Cancel</button>
              <button type="submit" form="txn-form" className="btn-primary" style={{ background: formData.type === 'OUT' ? '#dc2626' : formData.type === 'IN' ? '#059669' : 'var(--blue-primary)' }}>
                Confirm {formData.type}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InventoryTransactions;
