//lab-billings.jsx
import { useState, useEffect, useRef } from 'react';
import '../../assets/CSS/Billings.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');

function Billings({ regNo, bookingData, onFinish }) {
  const [patients, setPatients] = useState([]);
  const [services, setServices] = useState({ laboratory: [], appointments: [] });
  const [bills, setBills] = useState([]);
  const [labs, setLabs] = useState([]); // All labs with workload
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [selectedServices, setSelectedServices] = useState([]);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [patientType, setPatientType] = useState('Out Patient'); // 'Out Patient' | 'In Patient'
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentBill, setCurrentBill] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [activeTab, setActiveTab] = useState('create'); // 'create' | 'history'
  const printRef = useRef(null);

  // Fetch patients and services on mount
  useEffect(() => {
    fetchPatients();
    fetchServices();
    fetchLabsWithWorkload();
    fetchBills();
  }, []);

  // Pre-populate services when bookingData changes
  useEffect(() => {
    if (bookingData) {
      const servicesToAdd = [];

      // Add appointment if present
      if (bookingData.appointment) {
        const apptService = services.appointments.find(
          a => a.doctor_name === bookingData.appointment.doctor
        ) || {
          id: 'appt-' + Date.now(),
          service_name: `Consultation - ${bookingData.appointment.doctor}`,
          doctor_name: bookingData.appointment.doctor,
          department: bookingData.appointment.department,
          price: 300 // default consultation fee
        };
        servicesToAdd.push({
          ...apptService,
          category: 'Appointment',
          quantity: 1
        });
      }

      // Add lab tests if present
      if (bookingData.labTests && bookingData.labTests.length > 0) {
        bookingData.labTests.forEach(test => {
          servicesToAdd.push({
            id: test.id,
            service_name: test.name,
            price: test.price,
            category: 'Laboratory',
            quantity: 1
          });
        });
      }

      if (servicesToAdd.length > 0) {
        setSelectedServices(servicesToAdd);
      }
    }
  }, [bookingData, services]);

  const fetchPatients = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/billing/patients/list`, { headers: { Authorization: `Bearer ${tok()}` } });
      const data = await res.json();
      if (data.success) {
        setPatients(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching patients:', error);
    }
  };

  const fetchServices = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/billing/services/available`, { headers: { Authorization: `Bearer ${tok()}` } });
      const data = await res.json();
      if (data.success) {
        setServices(data.data || { laboratory: [], appointments: [] });
      }
    } catch (error) {
      console.error('Error fetching services:', error);
    }
  };

  const fetchLabsWithWorkload = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/lab/labs`);
      const data = await res.json();
      if (data.success) {
        // Sort by workload score (ascending - least loaded first)
        const sortedLabs = (data.labs || []).sort((a, b) => {
          const scoreA = parseFloat(a.workload_score) || 0;
          const scoreB = parseFloat(b.workload_score) || 0;
          return scoreA - scoreB;
        });
        setLabs(sortedLabs);
      }
    } catch (error) {
      console.error('Error fetching labs:', error);
    }
  };

  const fetchBills = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/billing/all`, { headers: { Authorization: `Bearer ${tok()}` } });
      const data = await res.json();
      if (data.success) {
        setBills(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching bills:', error);
    }
  };

  const addService = (service, type) => {
    const existing = selectedServices.find(
      s => s.service_id === service.id && s.service_type === type
    );
    if (existing) {
      setSelectedServices(prev =>
        prev.map(s =>
          s.service_id === service.id && s.service_type === type
            ? { ...s, quantity: s.quantity + 1, total_price: (s.quantity + 1) * s.unit_price }
            : s
        )
      );
      return;
    }

    // For lab tests, auto-assign the fastest lab (least workload)
    let assignedLabId = null;
    let assignedLabName = null;
    if (type === 'Laboratory' && labs.length > 0) {
      // labs are already sorted by workload (ascending) - first is fastest
      const fastestLab = labs[0];
      assignedLabId = fastestLab.id;
      assignedLabName = fastestLab.name;
    }

    const newItem = {
      service_id: service.id,
      service_type: type,
      service_name: service.name,
      service_code: service.code,
      unit_price: parseFloat(service.price) || 0,
      quantity: 1,
      total_price: parseFloat(service.price) || 0,
      lab_id: assignedLabId,
      lab_name: assignedLabName
    };
    setSelectedServices(prev => [...prev, newItem]);
  };

  const updateServiceLab = (index, labId) => {
    const selectedLab = labs.find(l => l.id === parseInt(labId));
    setSelectedServices(prev =>
      prev.map((s, i) =>
        i === index
          ? { ...s, lab_id: selectedLab?.id || null, lab_name: selectedLab?.name || null }
          : s
      )
    );
  };

  const removeService = (index) => {
    setSelectedServices(prev => prev.filter((_, i) => i !== index));
  };

  const updateQuantity = (index, quantity) => {
    const qty = parseInt(quantity) || 1;
    setSelectedServices(prev =>
      prev.map((s, i) =>
        i === index
          ? { ...s, quantity: qty, total_price: qty * s.unit_price }
          : s
      )
    );
  };

  const calculateTotals = () => {
    const total = selectedServices.reduce((sum, s) => sum + s.total_price, 0);
    const net = total - (parseFloat(discountAmount) || 0);
    return { total, net };
  };

  const createBill = async () => {
    if (!selectedPatient) {
      alert('Please select a patient');
      return;
    }
    if (selectedServices.length === 0) {
      alert('Please select at least one service');
      return;
    }

    const isInPatient = patientType === 'In Patient';
    const { net } = calculateTotals();

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({
          patient_id: selectedPatient.id,
          patient_name: selectedPatient.name || selectedPatient.patient_name,
          patient_phone: selectedPatient.phone,
          items: selectedServices,
          discount_amount: parseFloat(discountAmount) || 0,
          payment_method: isInPatient ? 'Pending' : 'Cash',
          payment_status: isInPatient ? 'Pending' : 'Paid',
          notes
        })
      });

      const data = await res.json();
      if (data.success) {
        // For Out Patient: auto-process full cash payment
        if (!isInPatient) {
          try {
            await fetch(`${API_BASE}/api/billing/${data.data.bill_id}/payment`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
              body: JSON.stringify({ paid_amount: net, payment_method: 'Cash' })
            });
          } catch { /* non-critical */ }
        }
        setCurrentBill(data.data);
        fetchBills();
        alert(isInPatient ? 'In-Patient bill created — payment pending.' : 'Bill created and payment completed!');
        if (onFinish) onFinish();
      } else {
        alert(data.message || 'Failed to create bill');
      }
    } catch (error) {
      console.error('Error creating bill:', error);
      alert('Error creating bill');
    } finally {
      setLoading(false);
    }
  };

  const processPayment = async () => {
    if (!currentBill || !paymentAmount) return;

    try {
      const res = await fetch(`${API_BASE}/api/billing/${currentBill.bill_id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({
          paid_amount: parseFloat(paymentAmount),
          payment_method: paymentMethod
        })
      });

      const data = await res.json();
      if (data.success) {
        alert(`Payment processed! Status: ${data.data.payment_status}`);
        setShowPaymentModal(false);
        setCurrentBill(prev => ({ ...prev, payment_status: data.data.payment_status }));
        fetchBills();
      } else {
        alert(data.message || 'Payment failed');
      }
    } catch (error) {
      console.error('Error processing payment:', error);
      alert('Error processing payment');
    }
  };

  const printBill = () => {
    if (printRef.current) {
      const printWindow = window.open('', '_blank');
      printWindow.document.write(`
        <html>
          <head>
            <title>Bill ${currentBill?.bill_number || ''}</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; }
              .bill-header { text-align: center; margin-bottom: 20px; }
              .bill-details { margin-bottom: 20px; }
              table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              th { background-color: #f2f2f2; }
              .totals { text-align: right; margin-top: 20px; }
              .qr-section { text-align: center; margin-top: 30px; }
              @media print { .no-print { display: none; } }
            </style>
          </head>
          <body>
            ${printRef.current.innerHTML}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  const resetForm = () => {
    setSelectedPatient(null);
    setSelectedServices([]);
    setDiscountAmount(0);
    setPaymentMethod('Cash');
    setNotes('');
    setCurrentBill(null);
    setPaymentAmount(0);
  };

  const viewBill = async (billId) => {
    try {
      const res = await fetch(`${API_BASE}/api/billing/${billId}`, { headers: { Authorization: `Bearer ${tok()}` } });
      const data = await res.json();
      if (data.success) {
        setCurrentBill(data.data);
        setActiveTab('create');
      }
    } catch (error) {
      console.error('Error fetching bill details:', error);
    }
  };

  const totals = calculateTotals();

  return (
    <div className="billings-container">
      <h1>Billing Management</h1>

      <div className="billing-tabs">
        <button
          className={activeTab === 'create' ? 'active' : ''}
          onClick={() => setActiveTab('create')}
        >
          Create Bill
        </button>
        <button
          className={activeTab === 'history' ? 'active' : ''}
          onClick={() => setActiveTab('history')}
        >
          Bill History
        </button>
      </div>

      {activeTab === 'create' && (
        <div className="billing-content">
          {/* Patient Type Toggle */}
          <div className="section patient-section">
            <h2>0. Patient Type</h2>
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              {['Out Patient', 'In Patient'].map(type => (
                <button
                  key={type}
                  onClick={() => setPatientType(type)}
                  style={{
                    padding: '10px 24px',
                    borderRadius: 10,
                    border: '2px solid',
                    borderColor: patientType === type ? (type === 'In Patient' ? '#dc2626' : '#16a34a') : '#e2e8f0',
                    background: patientType === type ? (type === 'In Patient' ? '#fee2e2' : '#dcfce7') : '#fff',
                    color: patientType === type ? (type === 'In Patient' ? '#dc2626' : '#16a34a') : '#64748b',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {type === 'In Patient' ? '🏥 In Patient' : '🚶 Out Patient'}
                </button>
              ))}
            </div>
            {patientType === 'In Patient' && (
              <p style={{ marginTop: 10, fontSize: 13, color: '#dc2626', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                ⚠️ In-Patient bill will be created with <strong>Pending</strong> payment status. Payment to be collected later.
              </p>
            )}
            {patientType === 'Out Patient' && (
              <p style={{ marginTop: 10, fontSize: 13, color: '#16a34a', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                ✅ Bill will be auto-completed with <strong>Cash</strong> payment.
              </p>
            )}
          </div>

          {/* Patient Selection */}
          <div className="section patient-section">
            <h2>1. Select Patient</h2>
            <div className="patient-search">
              <select
                value={selectedPatient?.id || ''}
                onChange={(e) => {
                  const patient = patients.find(p => p.id === parseInt(e.target.value));
                  setSelectedPatient(patient || null);
                }}
              >
                <option value="">-- Select Patient --</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.reg_no} - {p.name} {p.phone ? `(${p.phone})` : ''}
                  </option>
                ))}
              </select>
              {selectedPatient && (
                <div className="patient-info">
                  <p><strong>CRN No:</strong> {selectedPatient.reg_no}</p>
                  <p><strong>Name:</strong> {selectedPatient.name}</p>
                  {selectedPatient.phone && <p><strong>Phone:</strong> {selectedPatient.phone}</p>}
                  {selectedPatient.email && <p><strong>Email:</strong> {selectedPatient.email}</p>}
                </div>
              )}
            </div>
          </div>

          {/* Service Selection */}
          <div className="section services-section">
            <h2>2. Select Services</h2>
            <div className="services-grid">
              {/* Laboratory Tests */}
              <div className="service-category">
                <h3>Laboratory Tests</h3>
                <div className="service-list">
                  {services.laboratory.map(test => (
                    <div key={test.id} className="service-item" onClick={() => addService(test, 'Laboratory')}>
                      <span className="service-name">{test.name}</span>
                      <span className="service-code">{test.code}</span>
                      <span className="service-price">₹{test.price}</span>
                      <button className="add-btn">+ Add</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Appointments */}
              <div className="service-category">
                <h3>Appointments</h3>
                <div className="service-list">
                  {services.appointments.map(apt => (
                    <div key={apt.id} className="service-item" onClick={() => addService(apt, 'Appointment')}>
                      <span className="service-name">{apt.name}</span>
                      <span className="service-code">{apt.code}</span>
                      <span className="service-price">₹{apt.price}</span>
                      <button className="add-btn">+ Add</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Selected Services */}
          {selectedServices.length > 0 && (
            <div className="section selected-services">
              <h2>3. Selected Services</h2>
              <table className="services-table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Type</th>
                    <th>Code</th>
                    <th>Lab</th>
                    <th>Unit Price</th>
                    <th>Qty</th>
                    <th>Total</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedServices.map((service, idx) => (
                    <tr key={idx}>
                      <td>{service.service_name}</td>
                      <td>{service.service_type}</td>
                      <td>{service.service_code}</td>
                      <td>
                        {service.service_type === 'Laboratory' && labs.length > 0 ? (
                          <select
                            value={service.lab_id || ''}
                            onChange={(e) => updateServiceLab(idx, e.target.value)}
                            className="lab-select"
                          >
                            <option value={labs[0]?.id}>⚡ Fastest: {labs[0]?.name} ({labs[0]?.workload_score} load)</option>
                            {labs.map(lab => (
                              <option key={lab.id} value={lab.id}>
                                {lab.name} {lab.block ? `(${lab.block})` : ''} - {lab.pending_tasks || 0} tasks, {lab.machines_count || 1} machines (load: {lab.workload_score})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span>-</span>
                        )}
                      </td>
                      <td>₹{service.unit_price}</td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          value={service.quantity}
                          onChange={(e) => updateQuantity(idx, e.target.value)}
                          className="qty-input"
                        />
                      </td>
                      <td>₹{service.total_price}</td>
                      <td>
                        <button className="remove-btn" onClick={() => removeService(idx)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Discount & Totals */}
              <div className="billing-summary">
                <div className="discount-row">
                  <label>Discount Amount (₹):</label>
                  <input
                    type="number"
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(e.target.value)}
                    min="0"
                    max={totals.total}
                  />
                </div>
                <div className="payment-method-row">
                  <label>Payment Method:</label>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option value="Cash">Cash</option>
                    <option value="Card">Card</option>
                    <option value="UPI">UPI</option>
                    <option value="Insurance">Insurance</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="notes-row">
                  <label>Notes:</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any additional notes..."
                  />
                </div>
                <div className="totals-row">
                  <p><strong>Total Amount:</strong> ₹{totals.total}</p>
                  <p><strong>Discount:</strong> ₹{discountAmount || 0}</p>
                  <p className="net-amount"><strong>Net Amount:</strong> ₹{totals.net}</p>
                </div>

                {/* Lab Assignment Summary */}
                {selectedServices.some(s => s.service_type === 'Laboratory') && (
                  <div className="lab-summary">
                    <h4>Lab Assignments</h4>
                    {selectedServices
                      .filter(s => s.service_type === 'Laboratory' && s.lab_name)
                      .map((service, idx) => (
                        <div key={idx} className="lab-assignment">
                          <span className="test-name">{service.service_name}</span>
                          <span className="arrow">→</span>
                          <span className="lab-name">{service.lab_name}</span>
                          {service.lab_id === labs[0]?.id && (
                            <span style={{ color: '#22c55e', fontSize: '11px' }}>(Fastest)</span>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="action-buttons">
                <button className="btn-primary" onClick={createBill} disabled={loading}>
                  {loading ? 'Creating...' : 'Create Bill'}
                </button>
                <button className="btn-secondary" onClick={resetForm}>
                  Reset
                </button>
              </div>
            </div>
          )}

          {/* Bill Receipt with QR & Barcode */}
          {currentBill && (
            <div className="section bill-receipt">
              <h2>4. Bill Receipt</h2>
              <div className="receipt-actions">
                <button className="btn-primary" onClick={() => setShowPaymentModal(true)}>
                  Process Payment
                </button>
                <button className="btn-secondary" onClick={printBill}>
                  Print Bill
                </button>
              </div>

              <div ref={printRef} className="receipt-content">
                <div className="receipt-header">
                  <h3>HIMS - Bill Receipt</h3>
                  <p>Bill Number: {currentBill.bill_number}</p>
                  <p>Date: {new Date().toLocaleString()}</p>
                </div>

                {selectedPatient && (
                  <div className="receipt-patient">
                    <h4>Patient Information</h4>
                    <p>Name: {selectedPatient.name || selectedPatient.patient_name}</p>
                    {selectedPatient.phone && <p>Phone: {selectedPatient.phone}</p>}
                  </div>
                )}

                <table className="receipt-table">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Qty</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedServices.map((s, i) => (
                      <tr key={i}>
                        <td>{s.service_name} ({s.service_type})</td>
                        <td>{s.quantity}</td>
                        <td>₹{s.total_price}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="receipt-totals">
                  <p>Total: ₹{calculateTotals().total}</p>
                  <p>Discount: ₹{discountAmount || 0}</p>
                  <p className="net"><strong>Net Amount: ₹{calculateTotals().net}</strong></p>
                  <p>Payment Status: {currentBill.payment_status || 'Pending'}</p>
                </div>

                {/* Lab Barcode and QR Code */}
                {currentBill.lab_barcode && (
                  <div className="lab-codes-section">
                    <h4>Laboratory Reference</h4>
                    <div className="barcode-display">
                      <p><strong>Barcode:</strong> {currentBill.lab_barcode}</p>
                      <svg id="barcode"></svg>
                    </div>
                    {currentBill.lab_qr_code && (
                      <div className="qr-display">
                        <p><strong>QR Code:</strong></p>
                        <img src={currentBill.lab_qr_code} alt="Lab QR Code" />
                      </div>
                    )}
                  </div>
                )}

                <div className="receipt-footer">
                  <p>Thank you for choosing our services!</p>
                  <p className="no-print">This is a computer-generated receipt.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bill History Tab */}
      {activeTab === 'history' && (
        <div className="billing-content">
          <div className="section bill-history">
            <h2>Bill History</h2>
            <table className="history-table">
              <thead>
                <tr>
                  <th>Bill Number</th>
                  <th>Patient</th>
                  <th>Total</th>
                  <th>Net Amount</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bills.map(bill => (
                  <tr key={bill.id}>
                    <td>{bill.bill_number}</td>
                    <td>{bill.patient_name}</td>
                    <td>₹{bill.total_amount}</td>
                    <td>₹{bill.net_amount}</td>
                    <td>
                      <span className={`status-badge ${bill.payment_status?.toLowerCase()}`}>
                        {bill.payment_status}
                      </span>
                    </td>
                    <td>{new Date(bill.bill_date).toLocaleDateString()}</td>
                    <td>
                      <button className="view-btn" onClick={() => viewBill(bill.id)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && currentBill && (
        <div className="modal-overlay">
          <div className="payment-modal">
            <h3>Process Payment</h3>
            <p>Bill Number: {currentBill.bill_number}</p>
            <p>Net Amount: ₹{totals.net}</p>
            <div className="payment-form">
              <label>Payment Amount (₹):</label>
              <input
                type="number"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                min="1"
                max={totals.net}
              />
              <label>Payment Method:</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="Cash">Cash</option>
                <option value="Card">Card</option>
                <option value="UPI">UPI</option>
                <option value="Insurance">Insurance</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn-primary" onClick={processPayment}>
                Confirm Payment
              </button>
              <button className="btn-secondary" onClick={() => setShowPaymentModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Billings;
