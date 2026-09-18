import { useState, useEffect } from 'react';
import {
  Download,
  Plus,
  TrendingDown,
  Clock,
  CheckCircle,
  ReceiptText,
  NotebookTabs,
  X
} from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import Select from 'react-select';
import '../../assets/CSS/PurchasePayments.css';

const API_URL = import.meta.env.VITE_API_URL || '';

function PurchasePayments() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [stats, setStats] = useState({ total_payable: 0, paid_this_month: 0, overdue_amount: 0 });
  const [invoices, setInvoices] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [selectedVendorForLedger, setSelectedVendorForLedger] = useState(null);

  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('invoices'); // invoices, ledger

  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  const [invoiceForm, setInvoiceForm] = useState({
    invoice_number: '', vendor_id: '', invoice_date: '', due_date: '', total_amount: ''
  });

  const [paymentForm, setPaymentForm] = useState({
    amount: '', payment_method: 'BANK', reference_no: ''
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, invRes, vendorsRes] = await Promise.all([
        fetch(`${API_URL}/api/v2/inventory/ap/stats`),
        fetch(`${API_URL}/api/v2/inventory/ap/invoices`),
        fetch(`${API_URL}/api/v2/inventory/vendors`)
      ]);
      const statsData = await statsRes.json();
      const invData = await invRes.json();
      const vendorsData = await vendorsRes.json();

      if (statsData.success) setStats(statsData.data);
      if (invData.success) setInvoices(invData.data);
      if (vendorsData.success) setVendors(vendorsData.data);
    } catch {
      showAlert('Failed to fetch Accounts Payable data', 'error');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchLedger = async (vendor_id) => {
    try {
      const response = await fetch(`${API_URL}/api/v2/inventory/ap/ledger/${vendor_id}`);
      const data = await response.json();
      if (data.success) {
        setLedger(data.data);
      }
    } catch {
      showAlert('Failed to fetch ledger', 'error');
    }
  };

  const handleCreateInvoice = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/api/v2/inventory/ap/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invoiceForm)
      });
      const data = await response.json();
      if (data.success) {
        showAlert('Invoice recorded successfully', 'success');
        setIsInvoiceModalOpen(false);
        setInvoiceForm({ invoice_number: '', vendor_id: '', invoice_date: '', due_date: '', total_amount: '' });
        fetchData();
        if (selectedVendorForLedger === invoiceForm.vendor_id) fetchLedger(selectedVendorForLedger);
      } else {
        showAlert(data.message, 'error');
      }
    } catch {
      showAlert('Failed to create invoice', 'error');
    }
  };

  const handleMakePayment = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/api/v2/inventory/ap/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...paymentForm,
          invoice_id: selectedInvoice.id,
          vendor_id: selectedInvoice.vendor_id
        })
      });
      const data = await response.json();
      if (data.success) {
        showAlert('Payment recorded successfully', 'success');
        setIsPaymentModalOpen(false);
        setPaymentForm({ amount: '', payment_method: 'BANK', reference_no: '' });
        setSelectedInvoice(null);
        fetchData();
        if (selectedVendorForLedger === selectedInvoice.vendor_id) fetchLedger(selectedVendorForLedger);
      } else {
        showAlert(data.message, 'error');
      }
    } catch {
      showAlert('Failed to record payment', 'error');
    }
  };

  const handleExportCSV = () => {
    let csvContent = "";
    let fileName = "";

    if (activeTab === 'invoices') {
      const headers = ["Invoice No", "Supplier", "Invoice Date", "Due Date", "Total Amount", "Paid", "Balance", "Status"];
      csvContent = headers.join(",") + "\n";

      invoices.forEach(inv => {
        const balance = parseFloat(inv.total_amount) - parseFloat(inv.paid_amount);
        const row = [
          `"${inv.invoice_number}"`,
          `"${inv.vendor_name}"`,
          new Date(inv.invoice_date).toLocaleDateString(),
          new Date(inv.due_date).toLocaleDateString(),
          inv.total_amount,
          inv.paid_amount,
          balance,
          `"${inv.status}"`
        ];
        csvContent += row.join(",") + "\n";
      });
      fileName = "Supplier_Invoices.csv";
    } else {
      if (!selectedVendorForLedger) return showAlert('Please select a supplier first', 'error');
      const vendorName = vendors.find(v => v.id === selectedVendorForLedger)?.vendor_name || "Supplier";
      const headers = ["Date", "Type", "Reference No", "Debit", "Credit", "Balance"];
      csvContent = headers.join(",") + "\n";

      ledger.forEach(entry => {
        const row = [
          new Date(entry.created_at).toLocaleString().replace(/,/g, ''),
          entry.type,
          `"${entry.reference_number}"`,
          entry.debit,
          entry.credit,
          entry.balance
        ];
        csvContent += row.join(",") + "\n";
      });
      fileName = `Ledger_${vendorName.replace(/\s+/g, '_')}.csv`;
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const openPaymentModal = (invoice) => {
    setSelectedInvoice(invoice);
    setPaymentForm({ ...paymentForm, amount: parseFloat(invoice.total_amount) - parseFloat(invoice.paid_amount) });
    setIsPaymentModalOpen(true);
  };

  const getStatusBadge = (status) => {
    if (status === 'PAID') return <span className="status-badge status-paid">PAID</span>;
    if (status === 'PARTIAL') return <span className="status-badge status-partial">PARTIAL</span>;
    return <span className="status-badge status-pending">PENDING</span>;
  };

  const selectStyles = {
    control: (base) => ({
      ...base,
      background: '#f8fafc',
      borderColor: '#cbd5e1',
      borderRadius: '10px',
      padding: '2px',
      fontSize: '14px',
      boxShadow: 'none',
      '&:hover': {
        borderColor: '#0d2554'
      }
    })
  };

  return (
    <div className="ap-page">
      {alert && <Alert type={alert.type} message={alert.message} onClose={hideAlert} />}

      <div className="ap-header">
        <div className="ap-title-area">
          <h1>Accounts Payable</h1>
          <p>Manage supplier invoices, payments, and running ledgers</p>
        </div>
        <div className="ap-actions" style={{ display: 'flex', gap: '12px' }}>
          <button className="ap-submit-btn" style={{ width: 'auto', padding: '12px 24px', background: '#10b981', display: 'flex', alignItems: 'center', gap: '8px' }} onClick={handleExportCSV}>
            <Download size={16} /> Export CSV
          </button>
          <button className="ap-submit-btn" style={{ width: 'auto', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '8px' }} onClick={() => setIsInvoiceModalOpen(true)}>
            <Plus size={18} /> Record Supplier Bill
          </button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="ap-stats-grid">
        <div className="ap-stat-card">
          <div className="ap-stat-icon" style={{ background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <TrendingDown size={20} />
          </div>
          <div className="ap-stat-info">
            <h3>Overdue Amount</h3>
            <p className="stat-value" style={{ color: '#dc2626' }}>₹{parseFloat(stats.overdue_amount).toLocaleString()}</p>
          </div>
        </div>
        <div className="ap-stat-card">
          <div className="ap-stat-icon" style={{ background: '#fef3c7', color: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Clock size={20} />
          </div>
          <div className="ap-stat-info">
            <h3>Total Outstanding</h3>
            <p className="stat-value">₹{parseFloat(stats.total_payable).toLocaleString()}</p>
          </div>
        </div>
        <div className="ap-stat-card">
          <div className="ap-stat-icon" style={{ background: '#dcfce7', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CheckCircle size={20} />
          </div>
          <div className="ap-stat-info">
            <h3>Paid This Month</h3>
            <p className="stat-value" style={{ color: '#10b981' }}>₹{parseFloat(stats.paid_this_month).toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="ap-tabs-nav">
        <button className={`ap-tab-btn ${activeTab === 'invoices' ? 'active' : ''}`} onClick={() => setActiveTab('invoices')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ReceiptText size={16} /> Supplier Invoices
        </button>
        <button className={`ap-tab-btn ${activeTab === 'ledger' ? 'active' : ''}`} onClick={() => setActiveTab('ledger')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <NotebookTabs size={16} /> Supplier Ledger
        </button>
      </div>

      <div className="ap-card">
        {activeTab === 'invoices' && (
          <div className="ap-table-wrapper">
            <table className="ap-table">
              <thead>
                <tr>
                  <th>Invoice No.</th>
                  <th>Supplier</th>
                  <th>Date</th>
                  <th>Due Date</th>
                  <th>Total Amount</th>
                  <th>Paid</th>
                  <th>Balance</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="9" style={{ textAlign: 'center', padding: '40px' }}>Loading invoice records...</td></tr>
                ) : invoices.length === 0 ? (
                  <tr><td colSpan="9" style={{ textAlign: 'center', padding: '40px' }}>No invoices found.</td></tr>
                ) : (
                  invoices.map(inv => {
                    const isOverdue = new Date(inv.due_date) < new Date() && inv.status !== 'PAID';
                    const balance = parseFloat(inv.total_amount) - parseFloat(inv.paid_amount);
                    return (
                      <tr key={inv.id} className={isOverdue ? 'overdue' : ''}>
                        <td style={{ fontWeight: 600 }}>{inv.invoice_number}</td>
                        <td style={{ color: '#0d2554', fontWeight: 500 }}>{inv.vendor_name}</td>
                        <td>{new Date(inv.invoice_date).toLocaleDateString()}</td>
                        <td>
                          <span style={{ color: isOverdue ? '#dc2626' : 'inherit', fontWeight: isOverdue ? 700 : 'normal' }}>
                            {new Date(inv.due_date).toLocaleDateString()}
                          </span>
                          {isOverdue && <span className="overdue-text">OVERDUE</span>}
                        </td>
                        <td style={{ fontWeight: 600 }}>₹{parseFloat(inv.total_amount).toLocaleString()}</td>
                        <td style={{ color: '#059669', fontWeight: 500 }}>₹{parseFloat(inv.paid_amount).toLocaleString()}</td>
                        <td style={{ fontWeight: 700, color: balance > 0 ? '#dc2626' : '#059669' }}>₹{balance.toLocaleString()}</td>
                        <td>{getStatusBadge(inv.status)}</td>
                        <td>
                          {inv.status !== 'PAID' && (
                            <button className="ap-pay-btn" onClick={() => openPaymentModal(inv)}>
                              Record Payment
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'ledger' && (
          <div style={{ padding: '24px' }}>
            <div className="ap-field" style={{ maxWidth: '400px' }}>
              <label>Select Supplier to View Ledger</label>
              <Select
                options={vendors.map(v => ({ value: v.id, label: v.vendor_name }))}
                value={selectedVendorForLedger ? { value: selectedVendorForLedger, label: vendors.find(v => v.id === selectedVendorForLedger)?.vendor_name } : null}
                onChange={(selected) => {
                  setSelectedVendorForLedger(selected ? selected.value : null);
                  if (selected) fetchLedger(selected.value);
                }}
                isClearable
                styles={selectStyles}
                placeholder="Search supplier..."
              />
            </div>

            {selectedVendorForLedger && (
              <div className="ap-table-wrapper" style={{ marginTop: '20px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <table className="ap-table">
                  <thead>
                    <tr>
                      <th>Date & Time</th>
                      <th>Type</th>
                      <th>Reference No.</th>
                      <th>Debit (Bills)</th>
                      <th>Credit (Payments)</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.length === 0 ? (
                      <tr><td colSpan="6" style={{ textAlign: 'center', padding: '30px' }}>No transactions found for this supplier.</td></tr>
                    ) : (
                      ledger.map(entry => (
                        <tr key={entry.id}>
                          <td style={{ color: '#64748b' }}>{new Date(entry.created_at).toLocaleString()}</td>
                          <td>
                            <span className={`status-badge ${entry.type === 'INVOICE' ? 'status-pending' : 'status-paid'}`}>
                              {entry.type}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600 }}>{entry.reference_number}</td>
                          <td style={{ color: '#dc2626', fontWeight: 500 }}>{parseFloat(entry.debit) > 0 ? `₹${parseFloat(entry.debit).toLocaleString()}` : '-'}</td>
                          <td style={{ color: '#059669', fontWeight: 500 }}>{parseFloat(entry.credit) > 0 ? `₹${parseFloat(entry.credit).toLocaleString()}` : '-'}</td>
                          <td style={{ fontWeight: 800, fontSize: '15px' }}>₹{parseFloat(entry.balance).toLocaleString()}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Invoice Modal */}
      {isInvoiceModalOpen && (
        <div className="ap-modal-overlay" onClick={() => setIsInvoiceModalOpen(false)}>
          <div className="ap-modal" onClick={e => e.stopPropagation()}>
            <div className="ap-modal-header">
              <h2>Record Supplier Invoice</h2>
              <button className="ap-modal-close" onClick={() => setIsInvoiceModalOpen(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateInvoice} className="ap-modal-body">
              <div className="ap-field">
                <label>Supplier / Vendor *</label>
                <Select
                  options={vendors.map(v => ({ value: v.id, label: v.vendor_name }))}
                  onChange={(selected) => setInvoiceForm({ ...invoiceForm, vendor_id: selected ? selected.value : '' })}
                  required
                  styles={selectStyles}
                  placeholder="Select a registered supplier"
                />
              </div>
              <div className="ap-form-grid">
                <div className="ap-field">
                  <label>Invoice Number *</label>
                  <input className="ap-input" required value={invoiceForm.invoice_number} onChange={e => setInvoiceForm({ ...invoiceForm, invoice_number: e.target.value })} placeholder="e.g. INV-10293" />
                </div>
                <div className="ap-field">
                  <label>Total Amount (₹) *</label>
                  <input type="number" step="0.01" className="ap-input" required value={invoiceForm.total_amount} onChange={e => setInvoiceForm({ ...invoiceForm, total_amount: e.target.value })} placeholder="0.00" />
                </div>
                <div className="ap-field">
                  <label>Invoice Date *</label>
                  <input type="date" className="ap-input" required value={invoiceForm.invoice_date} onChange={e => setInvoiceForm({ ...invoiceForm, invoice_date: e.target.value })} />
                </div>
                <div className="ap-field">
                  <label>Due Date *</label>
                  <input type="date" className="ap-input" required value={invoiceForm.due_date} onChange={e => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })} />
                </div>
              </div>
              <button type="submit" className="ap-submit-btn">Save Supplier Invoice</button>
            </form>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {isPaymentModalOpen && selectedInvoice && (
        <div className="ap-modal-overlay" onClick={() => setIsPaymentModalOpen(false)}>
          <div className="ap-modal" onClick={e => e.stopPropagation()}>
            <div className="ap-modal-header">
              <h2>Record Payment</h2>
              <button className="ap-modal-close" onClick={() => setIsPaymentModalOpen(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleMakePayment} className="ap-modal-body">
              <div className="ap-payment-summary">
                <div className="summary-row">
                  <span>Invoice Reference:</span>
                  <span>{selectedInvoice.invoice_number}</span>
                </div>
                <div className="summary-row">
                  <span>Vendor:</span>
                  <span>{selectedInvoice.vendor_name}</span>
                </div>
                <div className="summary-row">
                  <span>Outstanding Balance:</span>
                  <span style={{ color: '#dc2626' }}>₹{(parseFloat(selectedInvoice.total_amount) - parseFloat(selectedInvoice.paid_amount)).toLocaleString()}</span>
                </div>
              </div>

              <div className="ap-field">
                <label>Payment Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  max={parseFloat(selectedInvoice.total_amount) - parseFloat(selectedInvoice.paid_amount)}
                  className="ap-input"
                  required
                  value={paymentForm.amount}
                  onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  placeholder="Enter amount to pay"
                />
              </div>

              <div className="ap-form-grid">
                <div className="ap-field">
                  <label>Payment Method *</label>
                  <select className="ap-select" required value={paymentForm.payment_method} onChange={e => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}>
                    <option value="BANK">Bank Transfer</option>
                    <option value="UPI">UPI</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="CASH">Cash</option>
                  </select>
                </div>
                <div className="ap-field">
                  <label>Reference No. / UTR</label>
                  <input className="ap-input" value={paymentForm.reference_no} onChange={e => setPaymentForm({ ...paymentForm, reference_no: e.target.value })} placeholder="Transaction ID" />
                </div>
              </div>
              <button type="submit" className="ap-submit-btn" style={{ background: '#10b981' }}>Confirm & Record Payment</button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default PurchasePayments;

