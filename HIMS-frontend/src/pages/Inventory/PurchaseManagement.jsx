import { useState, useEffect, useRef } from 'react';
import {
  FilePlus,
  FileStack,
  Sparkles,
  Plus,
  Download,
  X,
  FileCheck,
  FileX,
  Zap,
  ArrowRight
} from 'lucide-react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import Select from 'react-select';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import '../../assets/CSS/InventoryVendors.css';

const API_URL = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

function PurchaseManagement() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [activeTab, setActiveTab] = useState('requisitions'); // requisitions, orders, suggestions

  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState([]);
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [hospitalSettings, setHospitalSettings] = useState(null);

  // Data
  const [prs, setPRs] = useState([]);
  const [pos, setPOs] = useState([]);
  const [suggestions, setSuggestions] = useState([]);

  // Modals
  const [isPRModalOpen, setIsPRModalOpen] = useState(false);
  const [isPOModalOpen, setIsPOModalOpen] = useState(false);
  const [viewPR, setViewPR] = useState(null);
  const [viewPO, setViewPO] = useState(null);

  // Forms
  const [prForm, setPrForm] = useState({ branch_id: '', items: [{ item_id: '', quantity: '', remarks: '' }] });
  const [poForm, setPoForm] = useState({ vendor_id: '', expected_delivery_date: '', items: [{ item_id: '', quantity: '', unit_price: '' }], pr_id: null });

  const fetchDropdowns = async () => {
    try {
      const [infraRes, itemsRes, vendorsRes, settingsRes] = await Promise.all([
        fetch(`${API_URL}/api/branches`, { headers: authHdr() }),
        fetch(`${API_URL}/api/v2/inventory/items`),
        fetch(`${API_URL}/api/v2/inventory/vendors`),
        fetch(`${API_URL}/api/settings`, { headers: authHdr() })
      ]);
      const iData = await infraRes.json();
      const itData = await itemsRes.json();
      const vData = await vendorsRes.json();
      const sData = await settingsRes.json();
      if (iData.success) {
        setBranches((iData.branches || []).map(b => ({
          ...b,
          name: b.branch_name
        })));
      }
      if (itData.success) setItems(itData.data);
      if (vData.success) setVendors(vData.data);
      if (sData.success) setHospitalSettings(sData.data);
    } catch { }
  };

  const fetchPRs = async () => {
    setLoading(true);
    try {
      const branchId = localStorage.getItem('branch_id');
      const roleLevel = localStorage.getItem('role_level');
      const res = await fetch(`${API_URL}/api/v2/inventory/procurement/requisitions?branch_id=${branchId}&role_level=${roleLevel}`);
      const data = await res.json();
      if (data.success) setPRs(data.data);
    } catch { }
    setLoading(false);
  };

  const fetchPOs = async () => {
    setLoading(true);
    try {
      const branchId = localStorage.getItem('branch_id');
      const roleLevel = localStorage.getItem('role_level');
      const res = await fetch(`${API_URL}/api/v2/inventory/procurement/orders?branch_id=${branchId}&role_level=${roleLevel}`);
      const data = await res.json();
      if (data.success) setPOs(data.data);
    } catch { }
    setLoading(false);
  };

  const fetchSuggestions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v2/inventory/suggestions`);
      const data = await res.json();
      if (data.success) setSuggestions(data.data);
    } catch { }
    setLoading(false);
  };

  useEffect(() => {
    fetchDropdowns();
  }, []);

  useEffect(() => {
    if (activeTab === 'requisitions') fetchPRs();
    if (activeTab === 'orders') fetchPOs();
    if (activeTab === 'suggestions') fetchSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleCreatePR = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/api/v2/inventory/procurement/requisitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prForm)
      });
      const data = await response.json();
      if (data.success) {
        showAlert('success', 'PR created successfully');
        setIsPRModalOpen(false);
        setPrForm({ branch_id: '', items: [{ item_id: '', quantity: '', remarks: '' }] });
        fetchPRs();
      } else showAlert('error', data.message);
    } catch {
      showAlert('error', 'Failed to create PR');
    }
  };

  const handleCreatePO = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/api/v2/inventory/procurement/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(poForm)
      });
      const data = await response.json();
      if (data.success) {
        showAlert('success', 'PO created successfully');
        setIsPOModalOpen(false);
        setPoForm({ vendor_id: '', expected_delivery_date: '', items: [{ item_id: '', quantity: '', unit_price: '' }], pr_id: null });

        // Refresh PO list
        await fetchPOs();

        // If we have a PO ID, generate the branded PDF silently and email/whatsapp it
        if (data.po_id) {
          setTimeout(async () => {
            try {
              // 1. Fetch the full PO object (to ensure we have vendor_name etc)
              const poRes = await fetch(`${API_URL}/api/v2/inventory/procurement/orders`);
              const poData = await poRes.json();
              const newPO = poData.data.find(p => p.id === data.po_id);
              if (!newPO) return;

              // 2. Set the PO to view silently (briefly) to render the DOM
              setViewPO(newPO);
              await new Promise(resolve => setTimeout(resolve, 500)); // wait for render

              const element = document.getElementById('printable-po');
              if (!element) { setViewPO(null); return; }

              // 3. Capture the branded DOM as PDF
              const canvas = await html2canvas(element, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                logging: false
              });
              const imgData = canvas.toDataURL('image/png');
              const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
              const pageWidth = 210, pageHeight = 297;
              const imgHeight = (canvas.height * pageWidth) / canvas.width;
              let heightLeft = imgHeight, yPos = 0;
              pdf.addImage(imgData, 'PNG', 0, yPos, pageWidth, imgHeight);
              heightLeft -= pageHeight;
              while (heightLeft > 0) { yPos -= pageHeight; pdf.addPage(); pdf.addImage(imgData, 'PNG', 0, yPos, pageWidth, imgHeight); heightLeft -= pageHeight; }

              // 4. Send the base64 PDF to the backend for Email & WhatsApp
              const pdfBase64 = pdf.output('datauristring').split(',')[1];
              setViewPO(null); // hide the modal after capture

              await fetch(`${API_URL}/api/v2/inventory/procurement/orders/${newPO.id}/send-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pdf_base64: pdfBase64 })
              });

              showAlert('success', `📧 PO Document sent to Vendor via Email & WhatsApp`);
            } catch (err) {
              console.error('Notification failed:', err);
              setViewPO(null);
            }
          }, 500);
        }
      } else showAlert('error', data.message);
    } catch {
      showAlert('error', 'Failed to create PO');
    }
  };

  const updatePRStatus = async (id, status) => {
    try {
      await fetch(`${API_URL}/api/v2/inventory/procurement/requisitions/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      fetchPRs();
    } catch { }
  };

  const convertPRtoPO = (pr) => {
    setPoForm({
      vendor_id: '',
      expected_delivery_date: '',
      pr_id: pr.id,
      items: pr.items.map(i => ({ item_id: i.item_id, quantity: i.quantity, unit_price: '', pr_item_id: i.id }))
    });
    setIsPOModalOpen(true);
  };

  const generateAI = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v2/inventory/suggestions/generate`, { method: 'POST' });
      await res.json();
      fetchSuggestions();
      showAlert('success', 'AI Suggestions generated');
    } catch { }
    setLoading(false);
  };

  const [pdfLoading, setPdfLoading] = useState(false);
  const poContentRef = useRef(null);

  const downloadPO = async (po) => {
    // Set the PO to view so the DOM renders, then capture
    setViewPO(po);
    setPdfLoading(true);
    // Wait for the modal to fully render
    await new Promise(resolve => setTimeout(resolve, 400));
    try {
      const element = document.getElementById('printable-po');
      if (!element) return;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = 210;  // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let yPos = 0;
      pdf.addImage(imgData, 'PNG', 0, yPos, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        yPos -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, yPos, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`${po.po_number}.pdf`);
    } catch (err) {
      console.error('PDF generation error:', err);
      showAlert('error', 'Failed to generate PDF');
    }
    setPdfLoading(false);
    setViewPO(null);
  };

  const getBadge = (status) => {
    const s = {
      PENDING: { bg: '#fefce8', color: '#ca8a04' }, APPROVED: { bg: '#dbeafe', color: '#2563eb' },
      REJECTED: { bg: '#fee2e2', color: '#dc2626' }, PO_CREATED: { bg: '#dcfce7', color: '#166534' },
      DRAFT: { bg: '#f1f5f9', color: '#475569' }, ISSUED: { bg: '#dbeafe', color: '#2563eb' },
      COMPLETED: { bg: '#dcfce7', color: '#166534' }
    }[status] || { bg: '#f1f5f9', color: '#475569' };
    return <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, background: s.bg, color: s.color }}>{status}</span>;
  };

  return (
    <div className="inv-vendor-page">
      {alert && <Alert type={alert.type} message={alert.message} onClose={hideAlert} />}

      <div className="inv-header">
        <div>
          <h1 className="inv-title">Procurement Management</h1>
          <p className="inv-subtitle">Manage Purchase Requisitions (PR), Purchase Orders (PO), and AI Suggestions</p>
        </div>
      </div>

      <div className="inv-tabs" style={{ display: 'flex', gap: '20px', marginBottom: '20px', borderBottom: '1px solid var(--border-light)' }}>
        <button onClick={() => setActiveTab('requisitions')} style={{ background: 'none', border: 'none', padding: '10px 0', cursor: 'pointer', fontWeight: 600, color: activeTab === 'requisitions' ? 'var(--blue-primary)' : 'var(--text-soft)', borderBottom: activeTab === 'requisitions' ? '2px solid var(--blue-primary)' : '2px solid transparent', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FilePlus size={16} /> Purchase Requisitions (PR)
        </button>
        <button onClick={() => setActiveTab('orders')} style={{ background: 'none', border: 'none', padding: '10px 0', cursor: 'pointer', fontWeight: 600, color: activeTab === 'orders' ? 'var(--blue-primary)' : 'var(--text-soft)', borderBottom: activeTab === 'orders' ? '2px solid var(--blue-primary)' : '2px solid transparent', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileStack size={16} /> Purchase Orders (PO)
        </button>
        <button onClick={() => setActiveTab('suggestions')} style={{ background: 'none', border: 'none', padding: '10px 0', cursor: 'pointer', fontWeight: 600, color: activeTab === 'suggestions' ? '#10b981' : 'var(--text-soft)', borderBottom: activeTab === 'suggestions' ? '2px solid #10b981' : '2px solid transparent', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={16} /> AI Auto-Suggestions
        </button>
      </div>

      <div className="inv-card">

        {/* REQUISITIONS TAB */}
        {activeTab === 'requisitions' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0', padding: '24px 24px 16px', borderBottom: '1.5px solid #f1f5f9' }}>
              <div>
                <h3 style={{ margin: 0, color: '#1e293b', fontSize: '18px', fontWeight: 700 }}>Purchase Requisitions (From Labs)</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>Review and process supply requests from laboratory departments</p>
              </div>
              <button className="btn-primary" style={{ background: '#0d2554', display: 'flex', alignItems: 'center', gap: '8px' }} onClick={() => setIsPRModalOpen(true)}>
                <Plus size={16} /> Create PR
              </button>
            </div>
            <table className="inv-table">
              <thead><tr><th>PR Number</th><th>Branch</th><th>Items</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan="5">Loading...</td></tr> : prs.filter(pr => pr.status !== 'PO_CREATED').map(pr => (
                  <tr key={pr.id}>
                    <td style={{ fontWeight: 600 }}>
                      <span
                        style={{ color: 'var(--blue-primary)', cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => setViewPR(pr)}
                      >
                        {pr.pr_number}
                      </span>
                      <div style={{ fontSize: '12px', color: 'var(--text-soft)' }}>{new Date(pr.created_at).toLocaleDateString()}</div>
                    </td>
                    <td>{pr.branch_name}</td>
                    <td>{pr.items.length} items <span style={{ fontSize: '12px', color: 'var(--text-soft)' }}>({pr.items.map(i => i.item_name).join(', ')})</span></td>
                    <td>{getBadge(pr.status)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {pr.status === 'PENDING' && (
                          <>
                            <button onClick={() => updatePRStatus(pr.id, 'APPROVED')} className="btn-primary" style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <FileCheck size={14} /> Approve
                            </button>
                            <button onClick={() => updatePRStatus(pr.id, 'REJECTED')} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', color: 'red', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <FileX size={14} /> Reject
                            </button>
                          </>
                        )}
                        {pr.status === 'APPROVED' && (
                          <button onClick={() => convertPRtoPO(pr)} className="btn-primary" style={{ padding: '6px 12px', fontSize: '12px', background: '#9333ea', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <ArrowRight size={14} /> Generate PO
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ORDERS TAB */}
        {activeTab === 'orders' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0', padding: '24px 24px 16px', borderBottom: '1.5px solid #f1f5f9' }}>
              <div>
                <h3 style={{ margin: 0, color: '#1e293b', fontSize: '18px', fontWeight: 700 }}>Purchase Orders (To Vendors)</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>Generate and track official orders sent to registered suppliers</p>
              </div>
              <button className="btn-primary" style={{ background: '#0d2554', display: 'flex', alignItems: 'center', gap: '8px' }} onClick={() => { setPoForm({ vendor_id: '', expected_delivery_date: '', items: [{ item_id: '', quantity: '', unit_price: '' }], pr_id: null }); setIsPOModalOpen(true); }}>
                <Plus size={16} /> Create Direct PO
              </button>
            </div>
            <table className="inv-table">
              <thead><tr><th>PO Number</th><th>Vendor</th><th>Expected Delivery</th><th>Total Amount</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan="6">Loading...</td></tr> : pos.map(po => (
                  <tr key={po.id}>
                    <td style={{ fontWeight: 600 }}>
                      <span
                        style={{ color: 'var(--blue-primary)', cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => setViewPO(po)}
                      >
                        {po.po_number}
                      </span>
                      <div style={{ fontSize: '12px', color: 'var(--text-soft)' }}>{new Date(po.created_at).toLocaleDateString()}</div>
                    </td>
                    <td style={{ color: 'var(--blue-primary)' }}>{po.vendor_name}</td>
                    <td>{po.expected_delivery_date ? new Date(po.expected_delivery_date).toLocaleDateString() : '-'}</td>
                    <td style={{ fontWeight: 600 }}>₹{parseFloat(po.total_amount).toLocaleString()}</td>
                    <td>{getBadge(po.status)}</td>
                    <td>
                      <button
                        className="btn-primary"
                        disabled={pdfLoading}
                        style={{ padding: '6px 12px', fontSize: '12px', background: '#475569', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => downloadPO(po)}
                      >
                        <Download size={14} />
                        {pdfLoading ? 'Generating...' : 'PDF'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* SUGGESTIONS TAB */}
        {activeTab === 'suggestions' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0', padding: '24px 24px 16px', borderBottom: '1.5px solid #f1f5f9' }}>
              <div>
                <h3 style={{ margin: 0, color: '#1e293b', fontSize: '18px', fontWeight: 700 }}>AI Purchase Suggestions</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>Smart inventory optimization based on ADU and Lead Times</p>
              </div>
              <button className="btn-primary" onClick={generateAI} disabled={loading} style={{ background: '#10b981', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Zap size={16} /> Run AI Scan
              </button>
            </div>
            <table className="inv-table">
              <thead><tr><th>Item Details</th><th>Preferred Vendor</th><th>Suggested Qty</th><th>Estimated Cost</th><th>Status</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan="5">Loading...</td></tr> : suggestions.map(s => (
                  <tr key={s.id}>
                    <td><div style={{ fontWeight: 600 }}>{s.item_name}</div><div style={{ fontSize: '12px' }}>{s.item_code}</div></td>
                    <td>{s.vendor_name || 'No vendor'}</td>
                    <td style={{ fontWeight: 600, color: '#059669' }}>{s.suggested_qty} {s.unit}</td>
                    <td style={{ fontWeight: 600 }}>₹{parseFloat(s.estimated_cost).toLocaleString()}</td>
                    <td>{getBadge(s.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>

      {/* PR Modal */}
      {isPRModalOpen && (
        <div className="inv-modal-overlay" onClick={() => setIsPRModalOpen(false)}>
          <div className="inv-drawer" style={{ width: '800px' }} onClick={e => e.stopPropagation()}>
            <div className="inv-drawer-header">
              <h2>Create Purchase Requisition</h2>
              <button className="inv-drawer-close" onClick={() => setIsPRModalOpen(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreatePR} className="inv-drawer-body">
              <div className="inv-form-group"><label>Requesting Department/Branch *</label>
                <Select options={branches.map(b => ({ value: b.id, label: b.name }))} onChange={s => setPrForm({ ...prForm, branch_id: s?.value })} required />
              </div>
              <h4 style={{ marginTop: '20px' }}>Items</h4>
              {prForm.items.map((it, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <div style={{ flex: 2 }}><Select placeholder="Item" options={items.map(i => ({ value: i.id, label: i.item_name }))} onChange={s => { const n = [...prForm.items]; n[idx].item_id = s?.value; setPrForm({ ...prForm, items: n }); }} required /></div>
                  <div style={{ flex: 1 }}><input type="number" placeholder="Qty" className="inv-input" required value={it.quantity} onChange={e => { const n = [...prForm.items]; n[idx].quantity = e.target.value; setPrForm({ ...prForm, items: n }); }} /></div>
                  <div style={{ flex: 2 }}><input type="text" placeholder="Remarks (optional)" className="inv-input" value={it.remarks} onChange={e => { const n = [...prForm.items]; n[idx].remarks = e.target.value; setPrForm({ ...prForm, items: n }); }} /></div>
                </div>
              ))}
              <button type="button" onClick={() => setPrForm({ ...prForm, items: [...prForm.items, { item_id: '', quantity: '', remarks: '' }] })} style={{ background: '#e0e7ff', color: '#4338ca', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                <Plus size={14} /> Add Item
              </button>
            </form>
            <div className="inv-drawer-footer"><button className="action-btn" onClick={() => setIsPRModalOpen(false)}>Cancel</button><button onClick={handleCreatePR} className="btn-primary">Submit PR</button></div>
          </div>
        </div>
      )}

      {/* PO Modal */}
      {isPOModalOpen && (
        <div className="inv-modal-overlay" onClick={() => setIsPOModalOpen(false)}>
          <div className="inv-drawer" style={{ width: '800px' }} onClick={e => e.stopPropagation()}>
            <div className="inv-drawer-header">
              <h2>Generate Purchase Order</h2>
              <button className="inv-drawer-close" onClick={() => setIsPOModalOpen(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreatePO} className="inv-drawer-body">
              <div className="inv-grid-2">
                <div className="inv-form-group"><label>Vendor *</label>
                  <Select options={vendors.map(v => ({ value: v.id, label: v.vendor_name }))} onChange={s => setPoForm({ ...poForm, vendor_id: s?.value })} required />
                </div>
                <div className="inv-form-group"><label>Expected Delivery Date *</label>
                  <input type="date" className="inv-input" required value={poForm.expected_delivery_date} onChange={e => setPoForm({ ...poForm, expected_delivery_date: e.target.value })} />
                </div>
              </div>
              <h4 style={{ marginTop: '20px' }}>PO Items</h4>
              {poForm.items.map((it, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <div style={{ flex: 2 }}><Select value={it.item_id ? { value: it.item_id, label: items.find(i => i.id === it.item_id)?.item_name } : null} placeholder="Item" options={items.map(i => ({ value: i.id, label: i.item_name }))} onChange={s => { const n = [...poForm.items]; n[idx].item_id = s?.value; setPoForm({ ...poForm, items: n }); }} required /></div>
                  <div style={{ flex: 1 }}><input type="number" placeholder="Qty" className="inv-input" required value={it.quantity} onChange={e => { const n = [...poForm.items]; n[idx].quantity = e.target.value; setPoForm({ ...poForm, items: n }); }} /></div>
                  <div style={{ flex: 1 }}><input type="number" step="0.01" placeholder="Unit Price (₹)" className="inv-input" required value={it.unit_price} onChange={e => { const n = [...poForm.items]; n[idx].unit_price = e.target.value; setPoForm({ ...poForm, items: n }); }} /></div>
                </div>
              ))}
              <button type="button" onClick={() => setPoForm({ ...poForm, items: [...poForm.items, { item_id: '', quantity: '', unit_price: '' }] })} style={{ background: '#e0e7ff', color: '#4338ca', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                <Plus size={14} /> Add Item
              </button>
            </form>
            <div className="inv-drawer-footer"><button className="action-btn" onClick={() => setIsPOModalOpen(false)}>Cancel</button><button onClick={handleCreatePO} className="btn-primary">Generate PO</button></div>
          </div>
        </div>
      )}

      {/* PR Details View Modal */}
      {viewPR && (
        <div className="inv-modal-overlay" onClick={() => setViewPR(null)}>
          <div className="inv-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="inv-modal-header">
              <h2>Purchase Requisition Details</h2>
              <button className="inv-modal-close" onClick={() => setViewPR(null)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={20} />
              </button>
            </div>
            <div className="inv-modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', background: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
                <div>
                  <span style={{ color: 'var(--text-soft)', fontSize: '12px', display: 'block' }}>PR Number</span>
                  <span style={{ fontWeight: 600 }}>{viewPR.pr_number}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-soft)', fontSize: '12px', display: 'block' }}>Created On</span>
                  <span style={{ fontWeight: 600 }}>{new Date(viewPR.created_at).toLocaleString()}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-soft)', fontSize: '12px', display: 'block' }}>Department / Branch</span>
                  <span style={{ fontWeight: 600 }}>{viewPR.branch_name}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-soft)', fontSize: '12px', display: 'block' }}>Created By</span>
                  <span style={{ fontWeight: 600 }}>{viewPR.requested_by_name || 'Admin'}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-soft)', fontSize: '12px', display: 'block' }}>Status</span>
                  {getBadge(viewPR.status)}
                </div>
              </div>

              <h4>Requested Items</h4>
              <table className="inv-table" style={{ marginTop: '10px' }}>
                <thead>
                  <tr>
                    <th>Item Code</th>
                    <th>Item Name</th>
                    <th>Quantity</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {viewPR.items.map((item, idx) => (
                    <tr key={idx}>
                      <td><span style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', fontSize: '12px', fontFamily: 'monospace' }}>{item.item_code}</span></td>
                      <td style={{ fontWeight: 500 }}>{item.item_name}</td>
                      <td style={{ fontWeight: 600, color: 'var(--blue-primary)' }}>{item.quantity} {item.unit}</td>
                      <td style={{ fontSize: '12px', color: 'var(--text-soft)' }}>{item.remarks || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* PO Details View & Print Modal */}
      {viewPO && (
        <div className="inv-modal-overlay" onClick={() => setViewPO(null)}>
          <div className="inv-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '800px' }}>
            <div className="inv-modal-header">
              <h2>Purchase Order Document</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => downloadPO(viewPO)}
                  disabled={pdfLoading}
                  className="btn-primary"
                  style={{ background: '#2563eb', display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  {pdfLoading ? <Clock size={16} /> : <Download size={16} />}
                  {pdfLoading ? 'Generating PDF...' : 'Download A4 PDF'}
                </button>
                <button className="inv-modal-close" onClick={() => setViewPO(null)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="inv-modal-body" id="printable-po" style={{ padding: '40px', background: 'white' }}>

              {/* Official PO Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #e2e8f0', paddingBottom: '20px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  {hospitalSettings?.logo_url && (
                    <img src={hospitalSettings.logo_url} alt="Logo" style={{ height: '60px', width: 'auto', objectFit: 'contain' }} />
                  )}
                  <div>
                    <h1 style={{ margin: 0, color: '#0f172a', fontSize: '24px' }}>{hospitalSettings?.hospital_name || 'MERIL HIMS'}</h1>
                    <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '13px' }}>
                      {hospitalSettings?.address && <span>{hospitalSettings.address}<br /></span>}
                      {hospitalSettings?.phone && <span>Phone: {hospitalSettings.phone} </span>}
                      {hospitalSettings?.email && <span>| Email: {hospitalSettings.email}</span>}
                    </p>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <h1 style={{ margin: 0, color: 'var(--blue-primary)', fontSize: '28px' }}>PURCHASE ORDER</h1>
                  <h2 style={{ margin: '8px 0 0 0', color: '#334155', fontSize: '16px' }}>{viewPO.po_number}</h2>
                  <p style={{ margin: '4px 0 0 0', fontWeight: 600 }}>Date: {new Date(viewPO.created_at).toLocaleDateString()}</p>
                  <p style={{ margin: '4px 0 0 0' }}>Expected Delivery: {viewPO.expected_delivery_date ? new Date(viewPO.expected_delivery_date).toLocaleDateString() : 'TBD'}</p>
                </div>
              </div>

              {/* Vendor & Bill To Info */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '40px' }}>
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: '0 0 8px 0', color: '#64748b', textTransform: 'uppercase', fontSize: '12px' }}>Vendor</h4>
                  <div style={{ fontWeight: 600, fontSize: '16px' }}>{viewPO.vendor_name}</div>
                </div>
                <div style={{ flex: 1, textAlign: 'right' }}>
                  <h4 style={{ margin: '0 0 8px 0', color: '#64748b', textTransform: 'uppercase', fontSize: '12px' }}>Ship To</h4>
                  <div style={{ fontWeight: 600, fontSize: '16px' }}>{hospitalSettings?.hospital_name || 'Central Stores'}</div>
                  <div style={{ color: '#475569', fontSize: '14px' }}>{hospitalSettings?.address || 'Main Campus'}</div>
                  <div style={{ color: '#475569', fontSize: '14px', marginTop: '4px' }}>Authorized by: {viewPO.created_by_name || 'Admin'}</div>
                </div>
              </div>

              {/* Itemized Table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '30px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Item Description</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>Qty</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>Unit Price</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {viewPO.items.map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '12px' }}>
                        <div style={{ fontWeight: 600 }}>{item.item_name}</div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>Item Code: {item.item_code}</div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: 500 }}>{item.quantity} {item.unit}</td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>₹{parseFloat(item.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>₹{parseFloat(item.subtotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals */}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ width: '300px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #e2e8f0', fontWeight: 600 }}>
                    <span>Subtotal</span>
                    <span>₹{parseFloat(viewPO.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '2px solid #cbd5e1', fontWeight: 700, fontSize: '18px', color: 'var(--blue-primary)' }}>
                    <span>Total Order Amount</span>
                    <span>₹{parseFloat(viewPO.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div style={{ marginTop: '60px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>
                <p>This is a computer-generated document. No signature is required.</p>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default PurchaseManagement;
