// billing.jsx — Reception billing desk
import { useState, useEffect, useRef, useMemo } from 'react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import {
  HeartHandshake, Search, Plus, Trash2, X, Banknote, CreditCard, Smartphone,
  ShieldCheck, Wallet, Globe, Printer, Barcode, QrCode, Pencil, Check, Package,
  User, Stethoscope, FlaskConical, Eraser, AlertTriangle, Receipt, ClipboardList,
  ScanLine, Syringe, HandCoins, Clock, Lock, Undo2, RefreshCw,
} from 'lucide-react';
import OnlinePayment from '../../components/OnlinePayment';
import BillRequestModal from '../../components/hmis/BillRequestModal';
import { get, post } from '../../utils/hmisApi';
import '../../assets/CSS/Billing.css';

// Payment methods, as stored on the bill (bills.payment_method). "Online" opens
// Razorpay for the balance once the bill is created. Alt+1…6 selects them.
const PAYMENT_METHODS = [
  { value: 'Cash', label: 'Cash', hint: 'Collected at counter', Icon: Banknote },
  { value: 'Card', label: 'Card', hint: 'Credit / debit', Icon: CreditCard },
  { value: 'UPI', label: 'UPI', hint: 'Scanned at counter', Icon: Smartphone },
  { value: 'Insurance', label: 'Insurance', hint: 'Billed to insurer', Icon: ShieldCheck },
  { value: 'Other', label: 'Other', hint: 'Cheque, credit…', Icon: Wallet },
  { value: 'Online', label: 'Online', hint: 'Razorpay link / QR', Icon: Globe },
];
const PRIORITIES = ['Routine', 'Urgent', 'STAT'];
const DISCOUNT_PRESETS = [0, 5, 10, 15, 20];

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lineTotal = (i) => (parseFloat(i.amount) || 0) * (parseFloat(i.quantity) || 1);
const DIAGNOSTIC = ['Laboratory', 'Imaging'];
const CHARGE_TYPE = { Consultation: 'Appointment', Laboratory: 'Laboratory', Imaging: 'Imaging', Procedure: 'Procedure' };
const TYPE_TAG = {
  Laboratory: { cls: 'lab', text: 'Lab', Icon: FlaskConical },
  Appointment: { cls: 'appt', text: 'Consult', Icon: Stethoscope },
  Imaging: { cls: 'img', text: 'X-ray / scan', Icon: ScanLine },
  Procedure: { cls: 'proc', text: 'Procedure', Icon: Syringe },
  Registration: { cls: 'other', text: 'Registration', Icon: Receipt },
};
const tagFor = (t) => TYPE_TAG[t] || { cls: 'other', text: 'Other', Icon: Receipt };
// A charge waiting at the desk (consultation fee, doctor's order) as a bill line.
const chargeLine = (c) => ({
  id: `c${c.id}`, name: c.description, amount: Number(c.unit_price), quantity: c.quantity || 1,
  service_type: CHARGE_TYPE[c.source_type] || 'Other', charge_id: c.id, ordered_by: c.ordered_by_name,
});

// ─────────────────────────────────────────────────────────────
// Type-ahead search over consultations + lab tests (F2 to focus)
// ─────────────────────────────────────────────────────────────
function ServiceSearch({ services, onPick, inputRef, disabled }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  const all = useMemo(() => [
    ...(services.laboratory || []).map(s => ({ ...s, _kind: 'Laboratory', _key: 'lab_' + s.id })),
    ...(services.services || []).map(s => ({ ...s, _kind: s.service_type, _key: 'svc_' + s.tariff_id })),
  ], [services]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t
      ? all.filter(s => (s.name || '').toLowerCase().includes(t) || String(s.code || '').toLowerCase().includes(t))
      : all;
    return list.slice(0, 10);
  }, [q, all]);

  useEffect(() => { setHi(0); }, [q]);

  const pick = (s) => {
    if (!s) return;
    onPick(s);
    setQ('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && open && results[hi]) { e.preventDefault(); pick(results[hi]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="rb-search">
      <Search size={16} className="rb-search-icon" />
      <input
        ref={inputRef}
        className="rb-search-input"
        placeholder="Search lab tests, X-ray / scans, procedures…"
        value={q}
        disabled={disabled}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      <kbd className="rb-kbd">F2</kbd>
      {open && !disabled && (
        <ul className="rb-search-pop" role="listbox">
          {results.length === 0 && <li className="rb-search-empty">No matching service. Press F4 to add a custom item.</li>}
          {results.map((s, idx) => {
            const tag = tagFor(s._kind);
            return (
              <li
                key={s._key}
                role="option"
                aria-selected={idx === hi}
                className={`rb-search-opt${idx === hi ? ' is-hi' : ''}`}
                onMouseEnter={() => setHi(idx)}
                onMouseDown={e => { e.preventDefault(); pick(s); }}
              >
                <span className={`rb-opt-ic ${tag.cls}`}><tag.Icon size={14} /></span>
                <span className="rb-opt-name">{s.name}</span>
                <span className="rb-opt-kind">{tag.text}</span>
                <span className="rb-opt-price">{inr(s.price)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Billing
// ─────────────────────────────────────────────────────────────
// patientId is needed so we can pass it to /billing/create
function Billing({ regNo, patientId, bookingData, onFinish }) {
  const { alert, showAlert, hideAlert } = useAlert();
  const printRef = useRef(null);
  const searchRef = useRef(null);

  const [packages, setPackages] = useState([]);
  const [selectedPackage, setSelectedPackage] = useState('');
  const [labs, setLabs] = useState([]);
  const [availableServices, setAvailableServices] = useState({ laboratory: [], appointments: [] });
  const [items, setItems] = useState([]);

  const [discount, setDiscount] = useState(0);
  const [method, setMethod] = useState('Cash');
  const [onlinePay, setOnlinePay] = useState(null);
  const [amountGiven, setAmountGiven] = useState('');

  // Order-level fields — stored on bills, not per test item.
  const [priority, setPriority] = useState('Routine');
  const [referringFacility, setReferringFacility] = useState('');
  const [referringClinician, setReferringClinician] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');

  // Free diagnostic scheme (e.g. NFDS): charges zeroed, payment auto-settled.
  // The bill row is still created — that's how the order enters the lab worklist.
  const [isFreeScheme, setIsFreeScheme] = useState(false);
  const [schemeName, setSchemeName] = useState('');
  const [schemes, setSchemes] = useState([]);
  const [schemeQuery, setSchemeQuery] = useState('');
  // The scheme search opens only when staff choose to apply a scheme — most
  // orders are standard paid bills.
  const [schemeOpen, setSchemeOpen] = useState(false);
  const [schemeIdx, setSchemeIdx] = useState(0);

  const [invoice, setInvoice] = useState(null);
  const [labSamples, setLabSamples] = useState([]);
  const [queueToken, setQueueToken] = useState(null);
  const [showModify, setShowModify] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [resolvedPatientId, setResolvedPatientId] = useState(patientId || null);
  // This hospital's payment settings and whether this patient owes the
  // registration fee (Settings → Payment Settings; enforced again on the server).
  const [payCtx, setPayCtx] = useState(null);
  const regDue = !!payCtx?.registration?.due;
  const regAmount = regDue ? Number(payCtx.registration.amount) || 0 : 0;
  // Money already owed or waiting for this patient: consultation fees and the
  // doctor's orders not yet billed, older bills with a balance, and pay-later
  // approvals.
  const [charges, setCharges] = useState([]);
  const [dues, setDues] = useState([]);
  const [credits, setCredits] = useState([]);
  const [creditId, setCreditId] = useState(null);
  const [request, setRequest] = useState(null);
  const [collect, setCollect] = useState(null);
  const prepaid = payCtx ? payCtx.prepaid_diagnostics !== false : true;

  // ── data loading ──
  useEffect(() => {
    fetch(`${API_BASE}/api/billing/services/available`, { headers: { Authorization: `Bearer ${tok()}` } })
      .then(r => r.json()).then(d => { if (d.success) setAvailableServices(d.data); })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!resolvedPatientId) return;
    fetch(`${API_BASE}/api/payment-settings/billing?patient_id=${resolvedPatientId}`, { headers: { Authorization: `Bearer ${tok()}` } })
      .then(r => r.json())
      .then(d => {
        if (!d.success) return;
        setPayCtx(d);
        if (d.default_method) setMethod(d.default_method);
      })
      .catch(console.error);
  }, [resolvedPatientId]);

  const loadAccount = async (pid, withCharges = true) => {
    if (!pid) return;
    const [c, d, a] = await Promise.all([
      withCharges ? get(`/api/billing/charges?patient_id=${pid}`) : null,
      get(`/api/billing/dues?patient_id=${pid}`),
      get(`/api/billing/approvals?patient_id=${pid}&kind=Credit&status=all`),
    ]);
    if (c?.ok) setCharges(c.data.charges || []);
    if (d.ok) setDues(d.data.dues || []);
    if (a.ok) setCredits((a.data.approvals || []).filter((x) => ['Pending', 'Approved'].includes(x.status)));
  };
  useEffect(() => {
    loadAccount(resolvedPatientId);
  }, [resolvedPatientId]);

  useEffect(() => {
    if (patientId) { setResolvedPatientId(patientId); return; }
    if (regNo) {
      fetch(`${API_BASE}/api/billing/patients/list`, { headers: { Authorization: `Bearer ${tok()}` } })
        .then(r => r.json())
        .then(d => {
          if (d.success) {
            const match = d.data.find(p => p.reg_no === regNo || String(p.id) === String(regNo));
            if (match) setResolvedPatientId(match.id);
          }
        })
        .catch(console.error);
    }
  }, [patientId, regNo]);

  useEffect(() => {
    const branchId = localStorage.getItem('branch_id');
    fetch(`${API_BASE}/api/infra?type=Lab${branchId ? `&branch_id=${branchId}` : ''}`, { headers: { Authorization: `Bearer ${tok()}` } })
      .then(r => r.json())
      .then(d => {
        if (d.success && d.items) {
          setLabs(d.items.map(item => ({ id: item.id, name: item.name, pending_tasks: 0 })));
        }
      })
      .catch(console.error);
  }, []);

  // Populate items from bookingData
  // The consultation fee and the doctor's orders come from the patient's
  // pending charges (priced by the hospital, not typed here).
  useEffect(() => {
    if (invoice) return;
    const newItems = [];
    let idCounter = 1;
    if (regDue) newItems.push({ id: idCounter++, name: 'Registration Fee', amount: regAmount, service_type: 'Registration', quantity: 1 });
    charges.forEach((c) => newItems.push(chargeLine(c)));

    if (bookingData?.labTests?.length > 0) {
      const lab = labs[0] || null;
      bookingData.labTests.forEach(test => {
        newItems.push({
          id: idCounter++,
          name: test.name,
          amount: parseFloat(test.price || test.selling_price || 0),
          service_type: 'Laboratory',
          quantity: 1,
          service_id: test.id,
          lab_id: lab?.id || null,
          lab_name: lab?.name || null,
        });
      });
    }
    setItems(newItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingData, labs, regDue, regAmount, charges]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/billing-packages?is_active=true`, { headers: { Authorization: `Bearer ${tok()}` } });
        const data = await res.json();
        if (data.success) {
          setPackages(data.packages.map(pkg => ({
            id: pkg.package_id,
            name: pkg.name,
            department: pkg.department,
            items: Array.isArray(pkg.items) ? pkg.items : JSON.parse(pkg.items),
            discountPercent: parseFloat(pkg.discount_percent),
            isFreeScheme: pkg.is_free_scheme === 1,
            schemeName: pkg.scheme_name || '',
          })));
        }
      } catch (e) { console.error(e); }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/free-schemes?is_active=true`, { headers: { Authorization: `Bearer ${tok()}` } });
        const data = await res.json();
        if (data.success) setSchemes(data.schemes || []);
      } catch (e) { console.error(e); }
    })();
  }, []);

  // ── computed ──
  const allowedMethods = payCtx ? PAYMENT_METHODS.filter(m => payCtx.methods.includes(m.value)) : PAYMENT_METHODS;
  const allowDiscount = payCtx ? payCtx.allow_discount : true;
  const maxDiscount = payCtx ? Number(payCtx.max_discount_percent) : 100;
  const allowPart = payCtx ? payCtx.allow_part_payment : true;
  const isLocked = !!invoice && !showModify;
  // An online bill becomes an invoice only once Razorpay confirms payment.
  const awaitingPayment = !!invoice?.awaitingPayment;
  const grossSubtotal = items.reduce((s, i) => s + lineTotal(i), 0);
  const subtotal = isFreeScheme ? 0 : grossSubtotal;
  const discAmt = isFreeScheme ? 0 : subtotal * (discount / 100);
  const total = isFreeScheme ? 0 : subtotal - discAmt;
  const filledItems = items.filter(i => i.name.trim());
  const givenNum = parseFloat(amountGiven);
  const changeDue = method === 'Cash' && !isNaN(givenNum) && givenNum > total ? givenNum - total : 0;
  const shortfall = method === 'Cash' && !isNaN(givenNum) && givenNum < total ? total - givenNum : 0;
  // Tests and scans are paid before they are done (unless on approved pay-later);
  // the consultation part may stay as a due.
  const diagTotal = items.filter(i => DIAGNOSTIC.includes(i.service_type)).reduce((s, i) => s + lineTotal(i), 0);
  const mustPayNow = prepaid && !isFreeScheme && !creditId && diagTotal > 0 ? Math.max(0, Math.round((total - (grossSubtotal - diagTotal)) * 100) / 100) : 0;
  const payingNow = method === 'Online' ? 0 : method !== 'Cash' ? total : isNaN(givenNum) ? total : Math.min(givenNum, total);
  const waitingCharges = charges.filter(c => !items.some(i => i.charge_id === c.id));
  const usableCredits = credits.filter(c => c.status === 'Approved');
  const pendingCredits = credits.filter(c => c.status === 'Pending');
  const duesTotal = dues.reduce((s, d) => s + Number(d.balance || 0), 0);

  const cashPresets = useMemo(() => {
    if (total <= 0) return [];
    const set = new Set([
      Math.ceil(total),
      Math.ceil(total / 100) * 100,
      Math.ceil(total / 500) * 500,
      Math.ceil(total / 2000) * 2000,
    ]);
    return [...set].sort((a, b) => a - b).slice(0, 4);
  }, [total]);

  const filteredSchemes = useMemo(() => {
    const t = schemeQuery.trim().toLowerCase();
    return t ? schemes.filter(s => (s.name || '').toLowerCase().includes(t)) : schemes;
  }, [schemes, schemeQuery]);

  // ── handlers ──
  const applyScheme = (name) => {
    if (isLocked) return;
    setIsFreeScheme(true);
    setSchemeName(name);
    setSchemeOpen(false);
    setSchemeQuery('');
    setSchemeIdx(0);
  };
  const removeScheme = () => {
    if (isLocked) return;
    setIsFreeScheme(false);
    setSchemeName('');
  };
  const onSchemeKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSchemeIdx((i) => Math.min(i + 1, filteredSchemes.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSchemeIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && filteredSchemes[schemeIdx]) { e.preventDefault(); applyScheme(filteredSchemes[schemeIdx].name); }
    else if (e.key === 'Escape') { setSchemeOpen(false); setSchemeQuery(''); }
  };

  const handlePackageSelect = (pkgId) => {
    setSelectedPackage(pkgId);
    if (!pkgId) return;
    const pkg = packages.find(p => String(p.id) === String(pkgId));
    if (pkg) {
      setItems(pkg.items.map((item, i) => ({
        id: i + 1, name: item.name, amount: item.amount, service_type: 'Other', quantity: 1,
      })));
      setDiscount(pkg.discountPercent || 0);
      // A free-scheme package carries its scheme status with it.
      setIsFreeScheme(pkg.isFreeScheme);
      setSchemeName(pkg.isFreeScheme ? pkg.schemeName : '');
      showAlert(`Package "${pkg.name}" loaded${pkg.isFreeScheme ? ` — Free Scheme (${pkg.schemeName})` : ''}`, 'success');
    }
  };

  const addService = (svc) => {
    const type = svc.service_type || svc._kind;
    if (svc.tariff_id) {
      // From the price list: the price is fixed; "other study" asks which one.
      setItems(prev => [...prev.filter(i => i.name.trim()), {
        id: Date.now(), name: svc.any_study ? `${svc.modality} — ` : svc.name, amount: parseFloat(svc.price) || 0,
        service_type: type, quantity: 1, tariff_id: svc.tariff_id, any_study: !!svc.any_study,
      }]);
      return;
    }
    if (svc.id && items.some(i => i.service_id === svc.id && i.service_type === type)) {
      showAlert(`"${svc.name}" is already on this bill.`, 'warning');
      return;
    }
    const lab = type === 'Laboratory' ? labs[0] : null;
    const row = {
      id: Date.now(), name: svc.name, amount: parseFloat(svc.price) || 0, service_type: type,
      quantity: 1, service_id: svc.id, lab_id: lab?.id || null, lab_name: lab?.name || null,
    };
    setItems(prev => {
      const blank = prev.findIndex(i => !i.name.trim());
      if (blank >= 0) { const n = [...prev]; n[blank] = { ...row, id: prev[blank].id }; return n; }
      return [...prev, row];
    });
  };

  const handleAddItem = () =>
    setItems(p => [...p, { id: Date.now(), name: '', amount: 0, service_type: 'Other', quantity: 1 }]);

  const handleClearItems = () => {
    if (filledItems.length > 0 && !window.confirm('Remove all items from this bill?')) return;
    setItems([{ id: 1, name: '', amount: 0, service_type: 'Other', quantity: 1 }]);
    setDiscount(0);
    setSelectedPackage('');
    setIsFreeScheme(false);
    setSchemeName('');
  };

  const handleRemoveItem = (i) => {
    if (items.length === 1) { setItems([{ id: 1, name: '', amount: 0, service_type: 'Other', quantity: 1 }]); return; }
    setItems(p => p.filter((_, idx) => idx !== i));
  };

  const handleItemChange = (i, field, val) =>
    setItems(p => p.map((it, idx) => (idx === i ? { ...it, [field]: val } : it)));

  // ── generate / update invoice ──
  const handleGenerate = async (overwriteParam = false) => {
    if (generating) return;
    const overwriteDuplicates = typeof overwriteParam === 'boolean' ? overwriteParam : false;

    // A ₹0 test (e.g. RBS) is a real item — only reject blank/invalid amounts.
    const validItems = items.filter(i => i.name.trim() && i.amount !== '' && i.amount !== null
      && !isNaN(parseFloat(i.amount)) && parseFloat(i.amount) >= 0);
    if (!validItems.length) {
      showAlert('Add at least one item with a name and a valid amount (0 or more).', 'warning');
      searchRef.current?.focus();
      return;
    }
    if (!resolvedPatientId) {
      showAlert('Could not resolve patient — please check the CRN No.', 'error');
      return;
    }
    if (isFreeScheme && !schemeName.trim()) {
      showAlert('Select the free diagnostic scheme for this order.', 'warning');
      return;
    }
    if (validItems.some(i => i.any_study && !i.name.replace(/^.*?—\s*/, '').trim())) {
      showAlert('Type which X-ray / scan is needed (e.g. "Left wrist AP/Lat").', 'warning');
      return;
    }
    if (!isFreeScheme && !creditId && !allowPart && method === 'Cash' && amountGiven !== '' && parseFloat(amountGiven) < total) {
      showAlert(`Part payment is not allowed at this hospital — collect the full ${inr(total)}.`, 'warning');
      return;
    }
    if (mustPayNow > 0 && method !== 'Online' && payingNow < mustPayNow - 0.005) {
      showAlert(`Lab tests and X-ray / scans must be paid before they are done: collect at least ${inr(mustPayNow)}, or ask for pay-later approval.`, 'warning');
      return;
    }

    setGenerating(true);
    try {
      const mappedItems = validItems.map(item => ({
        service_id: item.service_id || null,
        service_type: item.service_type || 'Other',
        service_name: item.name,
        unit_price: parseFloat(item.amount) || 0,
        quantity: parseFloat(item.quantity) || 1,
        total_price: lineTotal(item),
        lab_id: item.lab_id || null,
        lab_name: item.lab_name || null,
        charge_id: item.charge_id || undefined,
        tariff_id: item.tariff_id || undefined,
        body_part: item.any_study ? item.name.replace(/^.*?—\s*/, '').trim() : undefined,
      }));

      let effectivePaidAmount = 0;
      let effectiveStatus = 'Pending';
      if (method === 'Online') {
        effectivePaidAmount = 0;
        effectiveStatus = 'Pending';
      } else if (method !== 'Cash') {
        effectivePaidAmount = total;
        effectiveStatus = 'Paid';
      } else {
        const given = parseFloat(amountGiven);
        if (isNaN(given)) {
          effectivePaidAmount = total;
          effectiveStatus = 'Paid';
        } else {
          effectivePaidAmount = given >= total ? total : given;
          effectiveStatus = given >= total ? 'Paid' : 'Pending';
        }
      }

      const userId = localStorage.getItem('user_id');
      const common = {
        patient_id: resolvedPatientId,
        items: mappedItems,
        discount_amount: discAmt,
        payment_method: method,
        payment_status: effectiveStatus,
        paid_amount: effectivePaidAmount,
        notes: amountGiven ? `Amount Given: ₹${parseFloat(amountGiven).toFixed(2)}` : '',
        overwrite_duplicates: overwriteDuplicates,
        user_id: userId,
        priority,
        referring_facility: referringFacility || null,
        referring_clinician: referringClinician || null,
        clinical_notes: clinicalNotes || null,
        billing_type: isFreeScheme ? 'Free_Scheme' : 'Standard',
        scheme_name: isFreeScheme ? schemeName.trim() : null,
        credit_approval_id: creditId || undefined,
      };

      let res;
      if (invoice && invoice.billingId && showModify) {
        res = await fetch(`${API_BASE}/api/billing/${invoice.billingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
          body: JSON.stringify(common),
        });
      } else {
        res = await fetch(`${API_BASE}/api/billing/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
          body: JSON.stringify({
            ...common,
            patient_name: regNo,
          }),
        });
      }

      if (res.status === 409) {
        const conflictResult = await res.json();
        if (conflictResult.requires_confirmation) {
          setGenerating(false);
          if (window.confirm(conflictResult.message)) return handleGenerate(true);
          return;
        }
      }

      const result = await res.json();
      if (result.success) {
        const billId = result.data?.bill_id || invoice?.billingId || result.data?.bill_number || result.billingId;
        // An online order has only a provisional ORD- reference until paid.
        const billNumber = result.data?.bill_number || result.data?.order_ref || invoice?.billNumber || billId;
        const wasModify = invoice && showModify;
        const due = result.data?.balance_due ?? (method === 'Online' ? total : 0);
        const online = !!result.data?.awaiting_payment || (method === 'Online' && !isFreeScheme && due > 0);
        setInvoice({
          billingId: billId, billNumber, generatedAt: new Date().toLocaleString('en-IN'), awaitingPayment: online, balance: due,
          // Bills with a payment or the hospital's charges on them change only through approvals.
          editable: !(result.data?.paid_amount > 0) && !validItems.some(i => i.charge_id || i.tariff_id),
          net: total, paid: result.data?.paid_amount ?? 0,
        });
        setCreditId(null);
        loadAccount(resolvedPatientId, false);
        if (result.data?.lab_samples) setLabSamples(result.data.lab_samples);
        if (result.data?.queue_token) setQueueToken(result.data.queue_token);
        setShowModify(false);
        if (online) {
          // No invoice yet — collect the payment first.
          showAlert(`Order ${billNumber} created — collect ${inr(due)} online to confirm it and issue the invoice.`, 'info');
          setOnlinePay({ billId, balance: due });
        } else {
          showAlert(wasModify ? `Invoice ${billNumber} updated.` : `Invoice ${billNumber} generated.`, 'success');
        }
        if (onFinish) onFinish(result.data);
      } else {
        showAlert(result.message || 'Error generating invoice.', 'error');
      }
    } catch (e) {
      console.error(e);
      showAlert('Network error while generating invoice.', 'error');
    } finally {
      setGenerating(false);
    }
  };

  // Withdraw an unpaid online order and go back to the draft, e.g. to take
  // cash instead. Nothing was issued for it, so nothing else changes.
  const handleChangeMethod = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/billing/${invoice.billingId}/cancel-order`, {
        method: 'POST', headers: { Authorization: `Bearer ${tok()}` },
      });
      const d = await res.json();
      if (!d.success) { showAlert(d.message || 'Could not withdraw the order.', 'error'); return; }
      setInvoice(null);
      setLabSamples([]);
      setQueueToken(null);
      setShowModify(false);
      setMethod(allowedMethods.find((m) => m.value !== 'Online')?.value || 'Cash');
      showAlert('Online order withdrawn — choose another payment method and generate the invoice.', 'info');
    } catch {
      showAlert('Network error while withdrawing the order.', 'error');
    }
  };

  // After an online payment the order is confirmed on the server: pick up
  // its invoice number, sample IDs and queue token.
  const loadConfirmedOrder = async (billingId) => {
    try {
      const res = await fetch(`${API_BASE}/api/billing/${billingId}/order-status`, { headers: { Authorization: `Bearer ${tok()}` } });
      const d = await res.json();
      if (!d.success) return null;
      const o = d.data;
      if (o.order_state === 'Confirmed') {
        setLabSamples(o.lab_samples || []);
        setQueueToken(o.queue_token || null);
      }
      setInvoice((inv) => (inv ? {
        ...inv, billNumber: o.bill_number || o.order_ref, awaitingPayment: o.order_state !== 'Confirmed',
        balance: o.balance_due, generatedAt: new Date().toLocaleString('en-IN'),
      } : inv));
      return o;
    } catch {
      return null;
    }
  };

  const openRequest = async (kind) => {
    const r = await get(`/api/billing/${invoice.billingId}`);
    if (!r.ok) { showAlert(r.data.message || 'Could not open the bill.', 'error'); return; }
    setRequest({ kind, bill: r.data.data, defaultAmount: '' });
  };

  const startNextBill = () => {
    setInvoice(null);
    setLabSamples([]);
    setQueueToken(null);
    setAmountGiven('');
    setDiscount(0);
    loadAccount(resolvedPatientId);
  };

  const collectDue = async () => {
    const amt = Number(collect.amount);
    if (!(amt > 0)) { showAlert('Enter the amount received.', 'warning'); return; }
    setCollect((c) => ({ ...c, busy: true }));
    const r = await post(`/api/billing/${collect.bill.id}/payment`, { paid_amount: amt, payment_method: collect.method });
    if (!r.ok) { setCollect((c) => ({ ...c, busy: false })); showAlert(r.data.message || 'Could not record the payment.', 'error'); return; }
    showAlert(`${inr(amt)} received for ${collect.bill.invoice_no || collect.bill.bill_number} · receipt ${r.data.data?.receipt_no || ''}`, 'success');
    setCollect(null);
    loadAccount(resolvedPatientId, false);
  };

  const handleModify = () => {
    setShowModify(true);
    showAlert('Invoice unlocked for editing.', 'info');
  };

  const handlePrintReceipt = () => {
    if (invoice && invoice.billingId) window.open(`${API_BASE}/api/billing/${invoice.billingId}/pdf`, '_blank');
    else window.print();
  };

  // One 50x20mm label per lab sample. Barcode encodes short_id; full sample_id shown as text.
  const handlePrintBarcode = () => {
    if (!labSamples || labSamples.length === 0) {
      showAlert('No lab sample IDs to print — this invoice has no lab items, or sample IDs failed to generate. Try Modify → Save to retry.', 'warning');
      return;
    }
    const labelsHtml = labSamples.map((s) => {
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, s.short_id, { format: 'CODE128', width: 2, height: 60, displayValue: false, margin: 0 });
      return `
        <div class="label">
          <div class="lab-id">${s.sample_id}</div>
          <img class="barcode-img" src="${canvas.toDataURL('image/png')}" alt="barcode"/>
          <div class="barcode-number">${s.short_id}</div>
          <div class="patient">${(s.patient_first_name || '').trim()}</div>
          <div class="test">${s.test_name || ''}</div>
        </div>`;
    }).join('');

    const w = window.open('', '_blank', 'width=700,height=500');
    w.document.write(`
      <html><head><title>Sample Labels — ${invoice?.billingId}</title>
      <style>
        @page { size: 50mm 20mm; margin: 0; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: white; }
        body { font-family: Arial, Helvetica, sans-serif; }
        .label { width: 50mm; height: 20mm; padding: 1.3mm 2mm; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 0.3mm; text-align: center; background: #fff; overflow: hidden; }
        .label:not(:last-child) { page-break-after: always; }
        .lab-id { font-size: 2.6mm; line-height: 1.05; font-weight: 700; max-width: 100%; }
        .barcode-img { display: block; height: 6mm; max-width: 90%; margin-top: 0.3mm; }
        .barcode-number { font-family: "Courier New", monospace; font-size: 2.1mm; line-height: 1; font-weight: 700; }
        .patient { font-size: 2.6mm; line-height: 1.05; font-weight: 700; text-transform: capitalize; margin-top: 0.4mm; max-width: 100%; }
        .test { font-size: 2.4mm; line-height: 1.1; font-weight: 700; max-width: 100%; }
      </style></head>
      <body>${labelsHtml}</body></html>
    `);
    w.document.close();
    // Print from this window — inline scripts in the popup are blocked by CSP.
    w.onload = () => { setTimeout(() => { w.print(); w.close(); }, 400); };
  };

  const [qrUrl, setQrUrl] = useState(null);
  useEffect(() => {
    if (!invoice?.billingId) return;
    QRCode.toDataURL(`${invoice.billingId}-REG-${regNo}`, { margin: 1, width: 200 }).then(setQrUrl).catch(() => {});
  }, [invoice?.billingId, regNo]);

  const handlePrintQR = () => {
    if (!qrUrl) return;
    const w = window.open('', '_blank', 'width=320,height=320');
    w.document.write(`
      <html><head><title>QR — ${invoice?.billingId}</title>
      <style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#fff;font-family:monospace;}
      p{margin-top:12px;font-size:13px;}</style></head>
      <body>
        <img src="${qrUrl}" width="200" height="200"/>
        <p>${invoice?.billingId} · ${regNo}</p>
      </body></html>
    `);
    w.document.close();
    w.onload = () => { w.print(); w.close(); };
  };

  // ── keyboard shortcuts (refs keep the listener current without re-binding) ──
  const live = useRef({});
  live.current = { handleGenerate, isLocked, isFreeScheme, invoice, showModify, allowedMethods };
  useEffect(() => {
    const onKey = (e) => {
      const s = live.current;
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'F4') { e.preventDefault(); if (!s.isLocked) handleAddItem(); return; }
      if (e.key === 'F9' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        if (!s.isLocked) s.handleGenerate(false);
        return;
      }
      if (e.altKey && /^[1-6]$/.test(e.key) && !s.isLocked && !s.isFreeScheme && s.allowedMethods[Number(e.key) - 1]) {
        e.preventDefault();
        setMethod(s.allowedMethods[Number(e.key) - 1].value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusPill = invoice
    ? (showModify ? { cls: 'edit', text: `Editing ${invoice.billNumber}` }
      : awaitingPayment ? { cls: 'edit', text: 'Awaiting payment' }
      : { cls: 'done', text: `Invoice ${invoice.billNumber}` })
    : { cls: 'draft', text: 'Draft' };

  // ─────────────────────────────────────────────────────────────
  return (
    <>
      {alert && <Alert message={alert.message} type={alert.type} onClose={hideAlert} duration={4000} />}

      <main className="rb-page" ref={printRef}>

        {/* ══ Patient context bar ══ */}
        <header className="rb-patient">
          <div className="rb-patient-id">
            <span className="rb-avatar"><User size={18} /></span>
            <div>
              <div className="rb-eyebrow">CRN No.</div>
              <div className="rb-patient-crn">{regNo || '—'}</div>
            </div>
          </div>
          {resolvedPatientId && (
            <div className="rb-meta"><span className="rb-eyebrow">Patient ID</span><span>{resolvedPatientId}</span></div>
          )}
          {bookingData?.appointment?.doctor && (
            <div className="rb-meta">
              <span className="rb-eyebrow">Consultation</span>
              <span>{bookingData.appointment.doctor}{bookingData.appointment.department ? ` · ${bookingData.appointment.department}` : ''}</span>
            </div>
          )}
          {bookingData?.appointment?.apptDate && (
            <div className="rb-meta">
              <span className="rb-eyebrow">Appointment</span>
              <span>{bookingData.appointment.apptDate} {bookingData.appointment.apptTime}</span>
            </div>
          )}
          {labs.length > 0 && items.some(i => i.service_type === 'Laboratory') && (
            <div className="rb-meta"><span className="rb-eyebrow">Lab</span><span>{labs[0].name}</span></div>
          )}
          {payCtx?.registration && (
            <div className="rb-meta" title={payCtx.registration.reason}>
              <span className="rb-eyebrow">Registration fee</span>
              <span>{regDue ? `${inr(regAmount)} · ${payCtx.registration.reason}` : payCtx.registration.reason}</span>
            </div>
          )}
          <span className={`rb-status rb-status-${statusPill.cls}`}>{statusPill.text}</span>
        </header>

        {!resolvedPatientId && (
          <div className="rb-notice rb-notice-warn">
            <AlertTriangle size={16} />
            Resolving patient record for <strong>{regNo}</strong>… If this persists, the patient may not be registered yet.
          </div>
        )}

        {/* ══ Success banner ══ */}
        {invoice && !showModify && awaitingPayment && (
          <section className="rb-notice rb-notice-warn" style={{ alignItems: 'center' }}>
            <Globe size={18} />
            <div style={{ flex: 1 }}>
              <b>Order {invoice.billNumber} — awaiting online payment of {inr(invoice.balance)}</b>
              <div style={{ fontSize: 12.5, marginTop: 2 }}>The invoice number, sample IDs and queue token are issued only after Razorpay confirms the payment. To take cash or card instead, use “Change payment method”.</div>
            </div>
            <button className="rb-btn rb-btn-primary" onClick={() => setOnlinePay({ billId: invoice.billingId, balance: invoice.balance })}>Collect payment</button>
          </section>
        )}

        {invoice && !showModify && !awaitingPayment && (
          <section className="rb-success">
            <span className="rb-success-ic"><Check size={20} strokeWidth={3} /></span>
            <div className="rb-success-text">
              <div className="rb-success-title">Invoice {invoice.billNumber} generated</div>
              <div className="rb-success-sub">
                {invoice.generatedAt} · {isFreeScheme ? `Free scheme — ${schemeName}` : `${method} · ${inr(total)}`}
                {labSamples.length > 0 && ` · ${labSamples.length} sample label${labSamples.length > 1 ? 's' : ''} ready`}
              </div>
            </div>
            {queueToken && (
              <div className="rb-token" title="Sample collection queue number">
                <span className="rb-token-label">Token</span>
                <span className="rb-token-num">{queueToken.token_number}</span>
                <span className="rb-token-sub">
                  {queueToken.ahead > 0 ? `${queueToken.ahead} ahead` : 'Next in line'}
                </span>
              </div>
            )}
            {qrUrl && <img className="rb-success-qr" src={qrUrl} alt="Invoice QR code" width={64} height={64} />}
          </section>
        )}

        <div className="rb-grid">

          {/* ══ LEFT ══ */}
          <div className="rb-col">
            {dues.length > 0 && (
              <section className="rb-card rb-dues">
                <div className="rb-card-head">
                  <h2 className="rb-card-title"><Clock size={16} /> Earlier dues <span className="rb-count warn">{inr(duesTotal)}</span></h2>
                </div>
                <div className="rb-due-list">
                  {dues.map((d) => (
                    <div key={d.id} className="rb-due">
                      <div>
                        <b>{d.invoice_no || d.bill_number}</b>
                        <small>{new Date(d.created_at).toLocaleDateString('en-IN')} · bill {inr(d.net_amount)} · paid {inr(d.paid_amount)}{d.on_credit ? ' · pay-later' : ''}</small>
                      </div>
                      <span className="rb-num rb-due-amt">{inr(d.balance)}</span>
                      <button type="button" className="rb-btn rb-btn-outline" onClick={() => setCollect({ bill: d, amount: String(Number(d.balance)), method: method === 'Online' ? 'Cash' : method })}>
                        <HandCoins size={14} /> Collect
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {!isLocked && waitingCharges.length > 0 && (
              <div className="rb-notice rb-notice-info rb-waiting">
                <Clock size={16} />
                <span>Not on this bill (patient pays later):</span>
                {waitingCharges.map((c) => (
                  <button key={c.id} type="button" className="rb-chip" onClick={() => setItems((p) => [...p.filter((i) => i.name.trim()), chargeLine(c)])}
                    title="Add back to this bill">
                    <Plus size={12} /> {c.description} · {inr(c.amount)}
                  </button>
                ))}
              </div>
            )}

            <section className="rb-card">
              <div className="rb-card-head">
                <h2 className="rb-card-title">
                  <Receipt size={16} /> Bill items
                  <span className="rb-count">{filledItems.length}</span>
                </h2>
                {!isLocked && (
                  <div className="rb-head-actions">
                    {packages.length > 0 && (
                      <label className="rb-pkg">
                        <Package size={14} />
                        <select value={selectedPackage} onChange={e => handlePackageSelect(e.target.value)}>
                          <option value="">Load package…</option>
                          {packages.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name}{p.department ? ` — ${p.department}` : ''}{p.isFreeScheme ? ' (Free scheme)' : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button className="rb-btn rb-btn-ghost" onClick={handleClearItems} title="Clear all items">
                      <Eraser size={14} /> Clear
                    </button>
                  </div>
                )}
              </div>

              {!isLocked && (
                <div className="rb-search-row">
                  <ServiceSearch services={availableServices} onPick={addService} inputRef={searchRef} disabled={isLocked} />
                  <button className="rb-btn rb-btn-outline" onClick={handleAddItem} title="Add a custom line (F4)">
                    <Plus size={15} /> Custom item <kbd className="rb-kbd">F4</kbd>
                  </button>
                </div>
              )}

              <div className="rb-table-wrap">
                <table className="rb-table">
                  <thead>
                    <tr>
                      <th className="c-no">#</th>
                      <th>Description</th>
                      <th className="c-type">Type</th>
                      <th className="c-qty">Qty</th>
                      <th className="c-num">Rate (₹)</th>
                      <th className="c-num">Amount</th>
                      {!isLocked && <th className="c-del" aria-label="Remove" />}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => {
                      const isLab = item.service_type === 'Laboratory';
                      const tag = tagFor(item.service_type);
                      // Set by Payment Settings (and by the server) — not edited here.
                      const isReg = item.service_type === 'Registration';
                      // Hospital charges and price-list items: the price is not typed at the desk.
                      const fixed = isReg || !!item.charge_id || !!item.tariff_id;
                      const nameFixed = isReg || !!item.charge_id || (!!item.tariff_id && !item.any_study);
                      return (
                        <tr key={item.id} className={!item.name.trim() && !isLocked ? 'is-empty' : ''}>
                          <td className="c-no">{i + 1}</td>
                          <td>
                            {isLocked || nameFixed ? (
                              <span className="rb-cell-text">
                                {item.name || '—'}
                                {item.charge_id && <small className="rb-cell-sub"><Lock size={10} /> {item.ordered_by ? `Ordered by ${item.ordered_by}` : 'Hospital charge'}</small>}
                              </span>
                            ) : item.any_study ? (
                              <input
                                className="rb-cell-input"
                                value={item.name}
                                onChange={e => handleItemChange(i, 'name', e.target.value)}
                                placeholder="Which study? e.g. X-Ray — Left wrist AP/Lat"
                                autoFocus
                              />
                            ) : (
                              <input
                                className="rb-cell-input"
                                value={item.name}
                                onChange={e => handleItemChange(i, 'name', e.target.value)}
                                placeholder="Item description…"
                                autoFocus={!item.name && i === items.length - 1 && items.length > 1}
                              />
                            )}
                          </td>
                          <td className="c-type">
                            <span className={`rb-tag ${tag.cls}`}>
                              {isLab ? (item.lab_name || labs[0]?.name || 'Lab') : tag.text}
                            </span>
                          </td>
                          <td className="c-qty">
                            {isLocked || isReg || item.charge_id ? (
                              <span className="rb-num">{item.quantity || 1}</span>
                            ) : (
                              <input
                                className="rb-cell-input rb-num"
                                type="number" min="1" step="1"
                                value={item.quantity ?? 1}
                                onChange={e => handleItemChange(i, 'quantity', e.target.value)}
                              />
                            )}
                          </td>
                          <td className="c-num">
                            {isLocked || fixed ? (
                              <span className="rb-num">{Number(item.amount || 0).toFixed(2)}</span>
                            ) : (
                              <input
                                className="rb-cell-input rb-num"
                                type="number" min="0" step="0.01"
                                value={item.amount}
                                onChange={e => handleItemChange(i, 'amount', e.target.value)}
                              />
                            )}
                          </td>
                          <td className={`c-num rb-num rb-line ${isFreeScheme ? 'is-struck' : ''}`}>{inr(lineTotal(item))}</td>
                          {!isLocked && (
                            <td className="c-del">
                              <button className="rb-icon-btn" onClick={() => handleRemoveItem(i)}
                                title={item.charge_id ? 'Leave for later — it stays as a pending charge' : 'Remove item'} aria-label="Remove item">
                                <Trash2 size={15} />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="rb-table-foot">
                <span>{filledItems.length} item{filledItems.length === 1 ? '' : 's'}</span>
                <span>Subtotal <strong className="rb-num">{inr(grossSubtotal)}</strong></span>
              </div>
            </section>

            {/* Order details */}
            <section className="rb-card">
              <div className="rb-card-head">
                <h2 className="rb-card-title"><ClipboardList size={16} /> Order details</h2>
              </div>
              <div className="rb-card-body rb-form-grid">
                <div className="rb-field rb-span-2">
                  <span className="rb-label">Priority</span>
                  <div className="rb-seg" role="radiogroup" aria-label="Priority">
                    {PRIORITIES.map(p => (
                      <button
                        key={p} type="button" role="radio" aria-checked={priority === p}
                        className={`rb-seg-btn prio-${p.toLowerCase()}${priority === p ? ' is-on' : ''}`}
                        onClick={() => setPriority(p)} disabled={isLocked}
                      >{p}</button>
                    ))}
                  </div>
                </div>
                <label className="rb-field">
                  <span className="rb-label">Referring clinician</span>
                  <input className="rb-input" value={referringClinician} onChange={e => setReferringClinician(e.target.value)}
                    disabled={isLocked} placeholder="e.g. Dr. Sharma" />
                </label>
                <label className="rb-field">
                  <span className="rb-label">Referring facility</span>
                  <input className="rb-input" value={referringFacility} onChange={e => setReferringFacility(e.target.value)}
                    disabled={isLocked} placeholder="e.g. District Hospital" />
                </label>
                <label className="rb-field rb-span-2">
                  <span className="rb-label">Clinical notes</span>
                  <textarea className="rb-input" rows={2} value={clinicalNotes} onChange={e => setClinicalNotes(e.target.value)}
                    disabled={isLocked} placeholder="Relevant history, symptoms, provisional diagnosis…" />
                </label>
              </div>
            </section>
          </div>

          {/* ══ RIGHT — Payment ══ */}
          <aside className="rb-col rb-aside">
            <section className="rb-card">
              <div className="rb-card-head">
                <h2 className="rb-card-title"><Wallet size={16} /> Payment</h2>
              </div>
              <div className="rb-card-body rb-stack">

                {!isFreeScheme && (
                  <>
                    {/* Payment method tiles */}
                    <div className="rb-field">
                      <span className="rb-label">Payment method <span className="rb-label-hint">Alt + 1–{allowedMethods.length}</span></span>
                      <div className="rb-methods" role="radiogroup" aria-label="Payment method">
                        {allowedMethods.map(({ value, label, hint, Icon }, idx) => (
                          <button key={value} type="button" role="radio" aria-checked={method === value}
                            className={`rb-method${method === value ? ' is-on' : ''}`}
                            onClick={() => setMethod(value)} disabled={isLocked} title={`${hint} (Alt+${idx + 1})`}>
                            <Icon size={18} />
                            <span>{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Discount — only where the hospital allows it, up to its limit */}
                    {allowDiscount && (
                    <div className="rb-field">
                      <span className="rb-label">Discount{maxDiscount < 100 && <span className="rb-label-hint">up to {maxDiscount}%</span>}</span>
                      <div className="rb-discount">
                        <div className="rb-chips">
                          {DISCOUNT_PRESETS.filter(d => d <= maxDiscount).map(d => (
                            <button key={d} type="button" className={`rb-chip${Number(discount) === d ? ' is-on' : ''}`}
                              onClick={() => setDiscount(d)} disabled={isLocked}>{d === 0 ? 'None' : `${d}%`}</button>
                          ))}
                        </div>
                        <div className="rb-affix">
                          <input className="rb-input rb-num" type="number" min="0" max={maxDiscount} value={discount}
                            onChange={e => setDiscount(Math.min(maxDiscount, Math.max(0, Number(e.target.value) || 0)))}
                            disabled={isLocked} aria-label="Discount percent" />
                          <span>%</span>
                        </div>
                      </div>
                    </div>
                    )}

                    {/* Cash tendered */}
                    {method === 'Cash' && (
                      <div className="rb-field">
                        <span className="rb-label">Amount received</span>
                        <div className="rb-affix rb-affix-pre">
                          <span>₹</span>
                          <input className="rb-input rb-num rb-input-lg" type="number" min="0" step="1" value={amountGiven}
                            onChange={e => setAmountGiven(e.target.value)} disabled={isLocked}
                            placeholder={total > 0 ? total.toFixed(2) : '0.00'} />
                        </div>
                        {cashPresets.length > 0 && !isLocked && (
                          <div className="rb-chips">
                            {mustPayNow > 0 && mustPayNow < total && (
                              <button type="button" className="rb-chip" onClick={() => setAmountGiven(String(mustPayNow))}
                                title="Collect only the tests now; the consultation fee stays as a due">Tests only {inr(mustPayNow)}</button>
                            )}
                            {cashPresets.map((v, idx) => (
                              <button key={v} type="button" className="rb-chip" onClick={() => setAmountGiven(String(v))}>
                                {idx === 0 ? 'Exact' : `₹${v.toLocaleString('en-IN')}`}
                              </button>
                            ))}
                          </div>
                        )}
                        <span className="rb-hint">Leave blank if the exact amount was received.</span>
                      </div>
                    )}
                    {method === 'Online' && (
                      <div className="rb-notice rb-notice-info">
                        <Globe size={16} />
                        The bill is created first and Razorpay opens to collect the payment (or send the patient a link). The invoice is issued once the payment is received.
                      </div>
                    )}
                  </>
                )}

                {/* Pay later — only with an approver's agreement */}
                {!isFreeScheme && !isLocked && (
                  <div className="rb-field">
                    <span className="rb-label">Pay later</span>
                    {usableCredits.map((c) => (
                      <button key={c.id} type="button" className={`rb-credit${creditId === c.id ? ' is-on' : ''}`}
                        onClick={() => { const on = creditId !== c.id; setCreditId(on ? c.id : null); if (on && method === 'Cash') setAmountGiven('0'); }}>
                        <HandCoins size={16} />
                        <span><b>Approved pay-later · {inr(c.amount)}</b><small>{c.reason} — by {c.decided_by_name}</small></span>
                        {creditId === c.id ? <Check size={16} /> : <span className="rb-link">Use</span>}
                      </button>
                    ))}
                    {pendingCredits.map((c) => (
                      <div key={c.id} className="rb-credit is-wait">
                        <Clock size={16} />
                        <span><b>Waiting for approval · {inr(c.amount)}</b><small>{c.reason}</small></span>
                        <button type="button" className="rb-link" onClick={() => loadAccount(resolvedPatientId, false)} title="Check again"><RefreshCw size={13} /></button>
                      </div>
                    ))}
                    {usableCredits.length === 0 && pendingCredits.length === 0 && (
                      <button type="button" className="rb-scheme-add" disabled={!resolvedPatientId || total <= 0}
                        onClick={() => setRequest({ kind: 'Credit', defaultAmount: Math.round(total), chargeIds: items.filter(i => i.charge_id).map(i => i.charge_id) })}>
                        <HandCoins size={15} />
                        <span>Ask for pay-later</span>
                        <small>needs Admin / Accounts approval</small>
                      </button>
                    )}
                  </div>
                )}

                {/* Free diagnostic scheme — optional, so it sits last and stays out of the way */}
                <div className="rb-field">
                  {isFreeScheme ? (
                    <div className="rb-scheme-applied">
                      <HeartHandshake size={18} />
                      <span className="rb-scheme-applied-text">
                        <b>{schemeName || 'Choose a scheme'}</b>
                        <small>Free scheme — charges waived, payment auto-settled. The order still goes to the lab.</small>
                      </span>
                      {!isLocked && (
                        <span className="rb-scheme-applied-actions">
                          <button type="button" className="rb-link" onClick={() => { setSchemeOpen(true); setSchemeIdx(0); }}>Change</button>
                          <button type="button" className="rb-link danger" onClick={removeScheme}>Remove</button>
                        </span>
                      )}
                    </div>
                  ) : !schemeOpen && (
                    <button type="button" className="rb-scheme-add" disabled={isLocked} onClick={() => { setSchemeOpen(true); setSchemeIdx(0); }}>
                      <HeartHandshake size={15} />
                      <span>Apply a free scheme</span>
                      <small>optional · NFDS &amp; govt. schemes</small>
                    </button>
                  )}

                  {schemeOpen && !isLocked && (
                    <div className="rb-scheme-picker">
                      {schemes.length === 0 ? (
                        <div className="rb-notice rb-notice-warn">
                          <AlertTriangle size={16} />
                          No schemes set up yet. Add one in Settings → Billing Packages.
                        </div>
                      ) : (
                        <>
                          <div className="rb-mini-search">
                            <Search size={14} />
                            <input autoFocus value={schemeQuery} onKeyDown={onSchemeKey}
                              onChange={(e) => { setSchemeQuery(e.target.value); setSchemeIdx(0); }}
                              placeholder={`Search ${schemes.length} scheme${schemes.length === 1 ? '' : 's'}…`} aria-label="Search schemes" />
                            <button type="button" onClick={() => { setSchemeOpen(false); setSchemeQuery(''); }} aria-label="Close"><X size={13} /></button>
                          </div>
                          <div className="rb-scheme-list" role="listbox" aria-label="Schemes">
                            {filteredSchemes.map((sc, i) => (
                              <button key={sc.id} type="button" role="option" aria-selected={schemeName === sc.name}
                                className={`rb-scheme-opt${i === schemeIdx ? ' is-active' : ''}${schemeName === sc.name ? ' is-on' : ''}`}
                                onMouseEnter={() => setSchemeIdx(i)} onClick={() => applyScheme(sc.name)}>
                                <b>{sc.name}</b>
                                {(sc.description || sc.full_name) && <small>{sc.description || sc.full_name}</small>}
                              </button>
                            ))}
                            {filteredSchemes.length === 0 && <div className="rb-hint" style={{ padding: '8px 10px' }}>No scheme matches “{schemeQuery}”.</div>}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Totals */}
              <div className="rb-totals">
                <div className="rb-sum"><span>Subtotal</span><span className="rb-num">{inr(isFreeScheme ? grossSubtotal : subtotal)}</span></div>
                {!isFreeScheme && discount > 0 && (
                  <div className="rb-sum rb-sum-disc"><span>Discount ({discount}%)</span><span className="rb-num">− {inr(discAmt)}</span></div>
                )}
                {isFreeScheme && (
                  <div className="rb-sum rb-sum-disc"><span>Waived{schemeName ? ` · ${schemeName}` : ''}</span><span className="rb-num">− {inr(grossSubtotal)}</span></div>
                )}
                <div className="rb-total">
                  <span>Total payable</span>
                  <span className="rb-num">{inr(total)}</span>
                </div>
                {mustPayNow > 0 && !isLocked && (
                  <div className={`rb-change ${payingNow + 0.005 >= mustPayNow ? 'ok' : 'warn'}`} title="Lab tests and X-ray / scans are paid before they are done">
                    <span>Tests to pay now</span><span className="rb-num">{inr(mustPayNow)}</span>
                  </div>
                )}
                {creditId && !isLocked && (
                  <div className="rb-change ok"><span>On approved pay-later</span><span className="rb-num">{inr(Math.max(0, total - payingNow))}</span></div>
                )}
                {changeDue > 0 && (
                  <div className="rb-change ok"><span>Return to patient</span><span className="rb-num">{inr(changeDue)}</span></div>
                )}
                {shortfall > 0 && (
                  <div className="rb-change warn"><span>Balance pending</span><span className="rb-num">{inr(shortfall)}</span></div>
                )}
              </div>
            </section>
          </aside>
        </div>
      </main>

      {/* ══ Sticky action bar ══ */}
      <footer className="rb-bar">
        {invoice && !showModify && awaitingPayment ? (
          <>
            <button className="rb-btn rb-btn-ghost" onClick={handleChangeMethod}><Pencil size={15} /> Change payment method</button>
            <div className="rb-bar-spacer" />
            <div className="rb-bar-total"><span>Awaiting payment</span><strong className="rb-num">{inr(invoice.balance)}</strong></div>
            <button className="rb-btn rb-btn-primary rb-btn-lg" onClick={() => setOnlinePay({ billId: invoice.billingId, balance: invoice.balance })}>
              <Globe size={16} /> Collect payment
            </button>
          </>
        ) : invoice && !showModify ? (
          <>
            {invoice.editable ? (
              <button className="rb-btn rb-btn-ghost" onClick={handleModify}><Pencil size={15} /> Modify</button>
            ) : (
              <>
                <button className="rb-btn rb-btn-ghost" onClick={() => openRequest('Concession')} title="Needs Admin / Accounts approval"><HandCoins size={15} /> Ask for concession</button>
                <button className="rb-btn rb-btn-ghost" onClick={() => openRequest('Cancel bill')} title="Needs Admin / Accounts approval"><Undo2 size={15} /> Ask to cancel</button>
              </>
            )}
            <div className="rb-bar-spacer" />
            {charges.some(c => !items.some(i => i.charge_id === c.id)) && (
              <button className="rb-btn rb-btn-outline" onClick={startNextBill} title="Bill what is still pending for this patient"><Receipt size={15} /> Bill the rest</button>
            )}
            <button className="rb-btn rb-btn-outline" onClick={handlePrintQR}><QrCode size={15} /> QR code</button>
            <button className="rb-btn rb-btn-outline" onClick={handlePrintBarcode} disabled={labSamples.length === 0}
              title={labSamples.length === 0 ? 'No lab samples on this invoice' : 'Print sample labels'}>
              <Barcode size={15} /> Sample labels{labSamples.length > 0 ? ` (${labSamples.length})` : ''}
            </button>
            <button className="rb-btn rb-btn-primary" onClick={handlePrintReceipt}><Printer size={15} /> Print receipt</button>
          </>
        ) : (
          <>
            <div className="rb-shortcuts" aria-hidden="true">
              <span><kbd className="rb-kbd">F2</kbd> Search</span>
              <span><kbd className="rb-kbd">F4</kbd> Custom item</span>
              <span><kbd className="rb-kbd">F9</kbd> Generate</span>
            </div>
            <div className="rb-bar-spacer" />
            <button className="rb-btn rb-btn-ghost" onClick={handlePrintReceipt}><Printer size={15} /> Print draft</button>
            {showModify && (
              <button className="rb-btn rb-btn-ghost" onClick={() => setShowModify(false)}><X size={15} /> Cancel edit</button>
            )}
            <div className="rb-bar-total">
              <span>{isFreeScheme ? 'Free scheme' : 'Total'}</span>
              <strong className="rb-num">{inr(total)}</strong>
            </div>
            <button
              className="rb-btn rb-btn-primary rb-btn-lg"
              onClick={() => handleGenerate(false)}
              disabled={generating || !resolvedPatientId}
            >
              <Check size={16} strokeWidth={3} />
              {generating ? 'Processing…' : showModify ? 'Save changes' : method === 'Online' && !isFreeScheme ? 'Create bill & collect payment' : 'Generate invoice'}
              <kbd className="rb-kbd rb-kbd-inv">F9</kbd>
            </button>
          </>
        )}
      </footer>

      {request && (
        <BillRequestModal
          kind={request.kind} bill={request.bill} patientId={resolvedPatientId} chargeIds={request.chargeIds} defaultAmount={request.defaultAmount}
          onClose={() => setRequest(null)}
          onDone={() => {
            setRequest(null);
            showAlert('Request sent. An Admin or the Accounts Manager will approve it in Billing → Approvals.', 'success');
            loadAccount(resolvedPatientId, false);
          }}
        />
      )}

      {collect && (
        <div className="gv-overlay" onClick={() => setCollect(null)}>
          <div className="gv-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Collect due</h2>
            <div className="gv-sub">{collect.bill.invoice_no || collect.bill.bill_number} · balance {inr(collect.bill.balance)}</div>
            <div className="rb-stack" style={{ marginTop: 12 }}>
              <div className="rb-methods" role="radiogroup" aria-label="Payment method">
                {allowedMethods.filter(m => m.value !== 'Online').map(({ value, label, Icon }) => (
                  <button key={value} type="button" role="radio" aria-checked={collect.method === value}
                    className={`rb-method${collect.method === value ? ' is-on' : ''}`} onClick={() => setCollect(c => ({ ...c, method: value }))}>
                    <Icon size={18} /><span>{label}</span>
                  </button>
                ))}
              </div>
              <div className="rb-affix rb-affix-pre">
                <span>₹</span>
                <input className="rb-input rb-num rb-input-lg" type="number" min="1" max={collect.bill.balance} value={collect.amount} autoFocus
                  onChange={(e) => setCollect(c => ({ ...c, amount: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') collectDue(); }} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="rb-btn rb-btn-ghost" onClick={() => setCollect(null)}>Close</button>
                <button className="rb-btn rb-btn-primary" onClick={collectDue} disabled={collect.busy}><Check size={15} /> {collect.busy ? 'Saving…' : 'Receive payment'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {onlinePay && (
        <div className="gv-overlay" onClick={() => setOnlinePay(null)}>
          <div className="gv-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Collect payment online</h2>
            <div className="gv-sub">{awaitingPayment ? 'Order' : 'Bill'} {invoice?.billNumber || onlinePay.billId} · {inr(onlinePay.balance)} at this hospital's prices. The invoice is issued as soon as the payment is received.</div>
            <OnlinePayment
              billId={onlinePay.billId}
              balance={onlinePay.balance}
              fixedAmount={awaitingPayment}
              onPaid={async (d) => {
                setOnlinePay(null);
                const o = await loadConfirmedOrder(onlinePay.billId);
                const paid = o ? o.order_state === 'Confirmed' && o.payment_status === 'Paid' : (d.payment_status || 'Paid') === 'Paid';
                showAlert(paid ? `Payment received — invoice ${o?.bill_number || invoice?.billNumber || ''} generated.` : (d.message || 'Part payment received.'), 'success');
              }}
              onCancel={() => setOnlinePay(null)}
            />
          </div>
        </div>
      )}
    </>
  );
}

export default Billing;