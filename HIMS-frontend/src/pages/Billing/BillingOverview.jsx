import { useState, useEffect } from 'react';
import {
  Receipt,
  IndianRupee,
  CheckCircle,
  Clock,
  Search,
  Download,
  Printer,
  MessageSquare,
  CreditCard,
  X,
  RotateCcw,
  FileText
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');

const statusColors = {
  Paid: { bg: '#dcfce7', color: '#166534', dot: '#16a34a' },
  Partial: { bg: '#fef9c3', color: '#854d0e', dot: '#ca8a04' },
  Pending: { bg: '#fee2e2', color: '#991b1b', dot: '#dc2626' },
};

function BillingOverview() {
  const [bills, setBills] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedBill, setSelectedBill] = useState(null);
  const [billDetail, setBillDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [payModal, setPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('Cash');
  const [paying, setPaying] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchBills = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/all`, { headers: { Authorization: `Bearer ${tok()}` } });
      const data = await res.json();
      if (data.success) {
        setBills(data.data || []);
        setFiltered(data.data || []);
      }
    } catch { /* silent */ }
    setLoading(false);
  };

  useEffect(() => { fetchBills(); }, []);

  // Filter whenever search / status changes
  useEffect(() => {
    let list = [...bills];
    if (statusFilter !== 'All') {
      list = list.filter(b => b.payment_status === statusFilter);
    }
    if (startDate) {
      list = list.filter(b => new Date(b.created_at) >= new Date(startDate));
    }
    if (endDate) {
      const end = new Date(endDate); end.setHours(23, 59, 59, 999);
      list = list.filter(b => new Date(b.created_at) <= end);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(b =>
        b.bill_number?.toLowerCase().includes(q) ||
        b.patient_name?.toLowerCase().includes(q) ||
        b.patient_phone?.includes(q)
      );
    }
    setFiltered(list);
  }, [search, statusFilter, bills]);

  const openBill = async (bill) => {
    setSelectedBill(bill);
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/${bill.id}`, { headers: { Authorization: `Bearer ${tok()}` } });
      const data = await res.json();
      if (data.success) setBillDetail(data.data);
    } catch { /* silent */ }
    setDetailLoading(false);
  };

  const closeDetail = () => {
    setSelectedBill(null);
    setBillDetail(null);
    setPayModal(false);
    setPayAmount('');
    setPayMethod('Cash');
  };

  const submitPayment = async () => {
    if (!payAmount || parseFloat(payAmount) <= 0) return;
    setPaying(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/${selectedBill.id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ paid_amount: parseFloat(payAmount), payment_method: payMethod }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Payment recorded — status: ${data.data.payment_status}`);
        setPayModal(false);
        setPayAmount('');
        await fetchBills();
        await openBill({ ...selectedBill, id: selectedBill.id });
      } else {
        showToast(data.message || 'Payment failed', 'error');
      }
    } catch { showToast('Network error', 'error'); }
    setPaying(false);
  };

  // Summaries
  const totalBills = bills.length;
  const totalRevenue = bills.reduce((s, b) => s + parseFloat(b.net_amount || 0), 0);
  const totalPaid = bills.reduce((s, b) => s + parseFloat(b.paid_amount || 0), 0);
  const totalPending = totalRevenue - totalPaid;

  const fmt = (n) => `₹${parseFloat(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  const printReceipt = (detail) => {
    const items = (detail.items || []).map(i =>
      `<tr><td style="padding:8px;border-bottom:1px solid #eee">${i.service_name}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${parseFloat(i.total_price).toLocaleString('en-IN')}</td></tr>`
    ).join('');
    const w = window.open('', '_blank');
    w.document.write(`
      <html><head><title>Receipt - ${detail.bill_number}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;max-width:480px;margin:auto}h2{text-align:center;color:#1d4ed8}table{width:100%;border-collapse:collapse;margin:16px 0}.totals{text-align:right;margin-top:12px}.footer{text-align:center;margin-top:24px;color:#94a3b8;font-size:12px}@media print{button{display:none}}</style>
      </head><body>
      <h2>Meril LIS</h2>
      <p style="text-align:center;color:#64748b;margin-top:-8px">Bill Receipt</p>
      <hr/>
      <p><strong>Bill No:</strong> ${detail.bill_number}</p>
      <p><strong>Patient:</strong> ${detail.patient_name}</p>
      <p><strong>Phone:</strong> ${detail.patient_phone || '—'}</p>
      <p><strong>Date:</strong> ${new Date(detail.created_at || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
      <hr/>
      <table><thead><tr><th style="text-align:left;padding:8px;border-bottom:2px solid #e2e8f0">Service</th><th style="text-align:center;padding:8px;border-bottom:2px solid #e2e8f0">Qty</th><th style="text-align:right;padding:8px;border-bottom:2px solid #e2e8f0">Amount</th></tr></thead><tbody>${items}</tbody></table>
      <div class="totals">
        <p>Gross Total: ₹${parseFloat(detail.total_amount || 0).toLocaleString('en-IN')}</p>
        ${parseFloat(detail.discount_amount) > 0 ? `<p>Discount: -₹${parseFloat(detail.discount_amount).toLocaleString('en-IN')}</p>` : ''}
        <p><strong>Net Amount: ₹${parseFloat(detail.net_amount || 0).toLocaleString('en-IN')}</strong></p>
        <p style="color:#16a34a">Paid: ₹${parseFloat(detail.paid_amount || 0).toLocaleString('en-IN')}</p>
        <p>Payment Status: <strong>${detail.payment_status || 'Pending'}</strong></p>
        <p>Method: ${detail.payment_method || '—'}</p>
      </div>
      <hr/>
      <div class="footer">Thank you for choosing Meril LIS<br/>This is a computer-generated receipt.</div>
      <br/><button onclick="window.print()" style="padding:10px 24px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px">🖨️ Print</button>
      </body></html>
    `);
    w.document.close();
  };

  const sendWhatsApp = async (detail) => {
    const phone = (detail.patient_phone || '').replace(/[^0-9]/g, '');
    if (!phone) { showToast('No phone number on file for this patient', 'error'); return; }

    // Ensure 91 prefix for Indian numbers if only 10 digits
    const targetPhone = phone.length === 10 ? '91' + phone : phone;

    const items = (detail.items || []).map(i => `  • ${i.service_name} x${i.quantity} = ₹${parseFloat(i.total_price).toLocaleString('en-IN')}`).join('\n');
    const isPaid = detail.payment_status === 'Paid';
    const msg = [
      `*🏥 MERIL LIS — BILL RECEIPT*`,
      `------------------------------------------`,
      `*Bill No:* ${detail.bill_number}`,
      `*Patient:* ${detail.patient_name}`,
      `*Date:* ${new Date(detail.created_at || Date.now()).toLocaleDateString('en-IN')}`,
      `------------------------------------------`,
      `*Services:*`,
      items,
      `------------------------------------------`,
      `*Gross Total:* ₹${parseFloat(detail.total_amount || 0).toLocaleString('en-IN')}`,
      parseFloat(detail.discount_amount) > 0 ? `*Discount:* -₹${parseFloat(detail.discount_amount).toLocaleString('en-IN')}` : null,
      `*NET AMOUNT: ₹${parseFloat(detail.net_amount || 0).toLocaleString('en-IN')}*`,
      `------------------------------------------`,
      `*Payment Status:* ${isPaid ? '✅ PAID' : '⏳ PENDING'}`,
      isPaid ? `*Method:* ${detail.payment_method || 'Cash'}` : `_Please clear the balance at the reception._`,
      ``,
      `Thank you for choosing *Meril LIS*! We wish you a speedy recovery. ❤️`,
    ].filter(Boolean).join('\n');

    try {
      showToast('Sending WhatsApp message...', 'info');
      const res = await fetch(`${API_BASE}/api/billing/send-whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({
          phone: targetPhone,
          message: msg
        })
      });

      const data = await res.json();
      if (data.success) {
        showToast('WhatsApp message sent successfully!');
      } else {
        showToast('Failed to send: ' + data.message, 'error');
      }
    } catch (error) {
      console.error('Backend error:', error);
      showToast('Error communicating with backend', 'error');
    }
  };

  const handleExportCSV = () => {
    if (!filtered.length) {
      showToast('No data to export', 'error');
      return;
    }
    const headers = ['Bill Number', 'Date', 'Patient Name', 'Phone', 'Net Amount', 'Paid Amount', 'Status', 'Payment Method'];
    const csvRows = [headers.join(',')];

    filtered.forEach(b => {
      const row = [
        b.bill_number,
        new Date(b.created_at).toLocaleDateString('en-IN'),
        `"${b.patient_name}"`,
        `"${b.patient_phone || ''}"`,
        b.net_amount,
        b.paid_amount,
        b.payment_status,
        b.payment_method || '—'
      ];
      csvRows.push(row.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Billing_Export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Billing data exported successfully');
  };

  const printThermal = (detail) => {
    const w = window.open('', '_blank');
    const items = (detail.items || []).map(i =>
      `<tr><td colspan="2" style="padding:4px 0">${i.service_name}</td></tr>
       <tr><td style="padding:0 0 8px">${i.quantity} x ${parseFloat(i.unit_price || 0).toFixed(2)}</td><td style="text-align:right">₹${parseFloat(i.total_price).toFixed(2)}</td></tr>`
    ).join('');
    w.document.write(`
      <html><head><style>
        body{width:80mm;font-family:'Courier New',Courier,monospace;font-size:12px;padding:5mm;margin:0}
        .center{text-align:center} .right{text-align:right} .bold{font-weight:bold}
        table{width:100%;border-collapse:collapse} .hr{border-top:1px dashed #000;margin:5px 0}
        @media print{button{display:none}}
      </style></head><body>
        <div class="center bold">MERIL LIS</div>
        <div class="center">Diagnostic & Research Centre</div>
        <div class="hr"></div>
        <div>Bill: ${detail.bill_number}</div>
        <div>Date: ${new Date(detail.created_at).toLocaleString()}</div>
        <div>Pat: ${detail.patient_name}</div>
        <div class="hr"></div>
        <table>${items}</table>
        <div class="hr"></div>
        <div class="right">Total: ₹${parseFloat(detail.total_amount).toFixed(2)}</div>
        ${parseFloat(detail.discount_amount) > 0 ? `<div class="right">Disc: -₹${parseFloat(detail.discount_amount).toFixed(2)}</div>` : ''}
        <div class="right bold">NET: ₹${parseFloat(detail.net_amount).toFixed(2)}</div>
        <div class="right">Paid: ₹${parseFloat(detail.paid_amount).toFixed(2)}</div>
        <div class="hr"></div>
        <div class="center">*** THANK YOU ***</div>
        <br/><button onclick="window.print()">PRINT SLIP</button>
      </body></html>
    `);
    w.document.close();
  };

  return (
    <div style={{ padding: '28px 32px', minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter, sans-serif' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 9999,
          background: toast.type === 'error' ? '#fee2e2' : '#dcfce7',
          color: toast.type === 'error' ? '#991b1b' : '#166534',
          border: `1px solid ${toast.type === 'error' ? '#fca5a5' : '#86efac'}`,
          borderRadius: 12, padding: '14px 22px', fontWeight: 600, fontSize: 14,
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Page Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: 0 }}>Billing & Payments</h1>
        <p style={{ color: '#64748b', marginTop: 4, fontSize: 14 }}>View all bills, payment status, and process collections</p>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginBottom: 28 }}>
        {[
          { label: 'Total Bills', value: totalBills, unit: '', bg: '#eff6ff', accent: '#1d4ed8', icon: <Receipt size={24} /> },
          { label: 'Total Revenue', value: fmt(totalRevenue), unit: '', bg: '#f0fdf4', accent: '#16a34a', icon: <IndianRupee size={24} /> },
          { label: 'Amount Paid', value: fmt(totalPaid), unit: '', bg: '#f5f3ff', accent: '#7c3aed', icon: <CheckCircle size={24} /> },
          { label: 'Pending Amount', value: fmt(totalPending), unit: '', bg: '#fff7ed', accent: '#c2410c', icon: <Clock size={24} /> },
        ].map(c => (
          <div key={c.label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '20px 22px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
            <div style={{ color: c.accent, marginBottom: 8 }}>{c.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.accent }}>{c.value}</div>
            <div style={{ fontSize: 13, color: '#64748b', fontWeight: 500, marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Filters Row */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 300, position: 'relative' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 5 }}>Search Bills</label>
          <div style={{ position: 'relative' }}>
            <Search style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} size={16} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Bill No, Patient, Phone..."
              style={{ width: '100%', padding: '10px 14px 10px 40px', border: '1.5px solid #e2e8f0', borderRadius: 12, fontSize: 14, background: '#fff', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 5 }}>Start Date</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 13 }} />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 5 }}>End Date</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 13 }} />
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {['All', 'Pending', 'Partial', 'Paid'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: '9px 16px', borderRadius: 10, border: '1.5px solid',
                borderColor: statusFilter === s ? '#0d2554' : '#e2e8f0',
                background: statusFilter === s ? '#0d2554' : '#fff',
                color: statusFilter === s ? '#fff' : '#475569',
                fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
              }}
            >{s}</button>
          ))}
        </div>

        <button
          onClick={() => { setStartDate(''); setEndDate(''); setSearch(''); setStatusFilter('All'); }}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: '#0d2554', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
        >
          <RotateCcw size={14} />
          Reset
        </button>

        <button
          onClick={handleExportCSV}
          style={{
            padding: '10px 18px',
            background: '#0d2554',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Download size={16} />
          Export CSV
        </button>
      </div>

      {/* Bills Table */}
      <div style={{ background: '#fff', borderRadius: 18, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              {['Bill No.', 'Patient', 'Phone', 'Total', 'Discount', 'Net Amount', 'Paid', 'Method', 'Date', 'Actions'].map(h => (
                <th key={h} style={{ padding: '13px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#64748b', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading bills…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={12} style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No bills found.</td></tr>
            ) : (
              filtered.map((b, i) => {
                const net = parseFloat(b.net_amount || 0);
                const paid = parseFloat(b.paid_amount || 0);
                const balance = net - paid;
                const sc = statusColors[b.payment_status] || statusColors.Pending;
                return (
                  <tr key={b.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafafa', transition: 'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafafa'}
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: '#1d4ed8', fontSize: 13 }}>{b.bill_number}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: '#0f172a', fontSize: 13 }}>{b.patient_name}</td>
                    <td style={{ padding: '12px 16px', color: '#64748b', fontSize: 13 }}>{b.patient_phone || '—'}</td>
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontSize: 13 }}>{fmt(b.total_amount)}</td>
                    <td style={{ padding: '12px 16px', color: '#dc2626', fontSize: 13 }}>{b.discount_amount > 0 ? `-${fmt(b.discount_amount)}` : '—'}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: '#0f172a', fontSize: 13 }}>{fmt(net)}</td>
                    <td style={{ padding: '12px 16px', color: '#16a34a', fontWeight: 600, fontSize: 13 }}>{fmt(paid)}</td>
                    <td style={{ padding: '12px 16px', color: '#64748b', fontSize: 12 }}>{b.payment_method || '—'}</td>
                    <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 12 }}>
                      {b.created_at ? new Date(b.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <button
                        onClick={() => openBill(b)}
                        style={{ padding: '6px 14px', background: '#0d2554', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >View</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Bill Detail Side Panel */}
      {selectedBill && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }} onClick={closeDetail}>
          <div style={{ width: 520, background: '#fff', height: '100%', overflowY: 'auto', boxShadow: '-8px 0 40px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>

            {/* Panel Header */}
            <div style={{ padding: '24px 28px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', position: 'sticky', top: 0, zIndex: 2 }}>
              <div>
                <h2 style={{ fontWeight: 800, fontSize: 18, color: '#0f172a', margin: 0 }}>{selectedBill.bill_number}</h2>
                <p style={{ margin: 0, fontSize: 13, color: '#64748b', marginTop: 2 }}>{selectedBill.patient_name}</p>
              </div>
              <button onClick={closeDetail} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, width: 36, height: 36, cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={20} />
              </button>
            </div>

            {detailLoading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
            ) : billDetail && (
              <div style={{ padding: '24px 28px', flex: 1 }}>

                {/* Payment Status Badge */}
                {(() => {
                  const sc = statusColors[billDetail.payment_status] || statusColors.Pending; return (
                    <div style={{ marginBottom: 24 }}>
                      <span style={{ background: sc.bg, color: sc.color, padding: '6px 14px', borderRadius: 100, fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: sc.dot, display: 'inline-block' }} />
                        {billDetail.payment_status || 'Pending'}
                      </span>
                    </div>
                  );
                })()}

                {/* Financial Summary */}
                <div style={{ background: '#f8fafc', borderRadius: 14, padding: '18px 20px', marginBottom: 24, border: '1px solid #e2e8f0' }}>
                  <h4 style={{ margin: '0 0 14px', fontSize: 13, color: '#64748b', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Payment Summary</h4>
                  {[
                    { label: 'Gross Total', val: fmt(billDetail.total_amount), color: '#0f172a' },
                    { label: 'Discount', val: billDetail.discount_amount > 0 ? `-${fmt(billDetail.discount_amount)}` : '—', color: '#dc2626' },
                    { label: 'Net Amount', val: fmt(billDetail.net_amount), color: '#0f172a', bold: true },
                    { label: 'Amount Paid', val: fmt(billDetail.paid_amount), color: '#16a34a', bold: true },
                    { label: 'Balance Due', val: fmt(parseFloat(billDetail.net_amount || 0) - parseFloat(billDetail.paid_amount || 0)), color: '#dc2626', bold: true },
                  ].map(r => (
                    <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #e2e8f0', fontSize: 14 }}>
                      <span style={{ color: '#64748b' }}>{r.label}</span>
                      <span style={{ color: r.color, fontWeight: r.bold ? 700 : 500 }}>{r.val}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
                    <span style={{ color: '#64748b' }}>Payment Method</span>
                    <span style={{ fontWeight: 600, color: '#475569' }}>{billDetail.payment_method || '—'}</span>
                  </div>
                </div>

                {/* Bill Items */}
                {billDetail.items && billDetail.items.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <h4 style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Services Billed</h4>
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
                      {billDetail.items.map((item, i) => (
                        <div key={i} style={{ padding: '12px 16px', borderBottom: i < billDetail.items.length - 1 ? '1px solid #f1f5f9' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{item.service_name}</div>
                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{item.service_type} • Qty: {item.quantity}</div>
                          </div>
                          <div style={{ fontWeight: 700, color: '#1d4ed8', fontSize: 14 }}>{fmt(item.total_price)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons Row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                  <button
                    onClick={() => printReceipt(billDetail)}
                    style={{ padding: '11px', background: '#0d2554', border: '1.5px solid #0d2554', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    <Printer size={16} />
                    A5 Receipt
                  </button>
                  <button
                    onClick={() => printThermal(billDetail)}
                    style={{ padding: '11px', background: '#0d2554', border: '1.5px solid #0d2554', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    <FileText size={16} />
                    Thermal Slip
                  </button>
                  <button
                    onClick={() => sendWhatsApp(billDetail)}
                    style={{ gridColumn: 'span 2', padding: '11px', background: '#0d2554', border: '1.5px solid #0d2554', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    <MessageSquare size={16} />
                    Send WhatsApp Message
                  </button>
                </div>

                {/* Process Payment Button */}
                {billDetail.payment_status !== 'Paid' && (
                  <button
                    onClick={() => setPayModal(true)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '13px', background: '#0d2554', color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(13,37,84,0.35)' }}
                  >
                    <CreditCard size={18} />
                    Process Payment
                  </button>
                )}
              </div>
            )}

            {/* Payment Modal inside Panel */}
            {payModal && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={() => setPayModal(false)}>
                <div style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 380, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
                  <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 800 }}>Process Payment</h3>
                  <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 24px' }}>{selectedBill?.bill_number} • Balance: {fmt(parseFloat(billDetail?.net_amount || 0) - parseFloat(billDetail?.paid_amount || 0))}</p>

                  <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Amount (₹)</label>
                  <input
                    type="number" min="1" value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 15, marginBottom: 16, boxSizing: 'border-box' }}
                    placeholder="Enter amount"
                  />

                  <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Payment Method</label>
                  <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
                    style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, marginBottom: 24, boxSizing: 'border-box' }}>
                    {['Cash', 'Card', 'UPI', 'Insurance', 'Other'].map(m => <option key={m}>{m}</option>)}
                  </select>

                  <div style={{ display: 'flex', gap: 12 }}>
                    <button onClick={() => setPayModal(false)} style={{ flex: 1, padding: '11px', background: '#f1f5f9', border: 'none', borderRadius: 10, fontWeight: 600, cursor: 'pointer', color: '#475569' }}>Cancel</button>
                    <button onClick={submitPayment} disabled={paying}
                      style={{ flex: 2, padding: '11px', background: '#0d2554', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', opacity: paying ? 0.7 : 1 }}>
                      {paying ? 'Processing…' : 'Confirm Payment'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default BillingOverview;
