import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

// Patient invoice / receipt (GET /api/billing/:id/pdf): always exactly one A4
// page under the hospital's own letterhead (name, logo and contact details
// from Settings). Long orders shrink the item rows to fit, and beyond that the
// remaining lines are summarised in one row, so the invoice never runs onto a
// second sheet.

// The hospital logo is stored in Settings as a data: URI.
const logoBuffer = (dataUri) => {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(dataUri || ''));
  return m ? Buffer.from(m[2], 'base64') : null;
};

const C = {
  ink: '#0f172a', text: '#1e293b', muted: '#64748b', faint: '#94a3b8',
  line: '#e2e8f0', panel: '#f8fafc', brand: '#1e3a8a', brandSoft: '#eef2ff',
  gold: '#b45309', ok: '#15803d', okSoft: '#dcfce7', warn: '#b45309', warnSoft: '#fef3c7',
  free: '#0f766e', freeSoft: '#ccfbf1', white: '#ffffff',
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 34;                 // page margin
const W = PAGE_W - M * 2;     // content width
const SUMMARY_H = 136;        // totals + payments block
const FOOTER_H = 70;          // notes + signature

const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rs = (n) => `Rs. ${money(n)}`;
const fmtDate = (d, withTime = true) => (d ? new Date(d).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
}) : '');

// Indian-system amount in words: 125050.5 → "One Lakh Twenty Five Thousand Fifty Rupees and Fifty Paise Only".
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const twoDigits = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const threeDigits = (n) => [Math.floor(n / 100) ? `${ONES[Math.floor(n / 100)]} Hundred` : '', n % 100 ? twoDigits(n % 100) : ''].filter(Boolean).join(' ');
export function amountInWords(amount) {
  const total = Math.round(Number(amount || 0) * 100);
  let rupees = Math.floor(total / 100); const paise = total % 100;
  if (!rupees && !paise) return 'Zero Rupees Only';
  const parts = [];
  for (const [div, name] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]) {
    const q = Math.floor(rupees / div);
    if (q) { parts.push(`${q >= 100 ? threeDigits(q) : twoDigits(q)} ${name}`); rupees %= div; }
  }
  if (rupees) parts.push(threeDigits(rupees));
  const words = parts.join(' ');
  return `${words ? `${words} Rupees` : ''}${paise ? `${words ? ' and ' : ''}${twoDigits(paise)} Paise` : ''} Only`;
}

// One line of text that never wraps or spills (pdfkit would otherwise add pages).
function line(doc, str, x, y, w, { font = 'Helvetica', size = 9, color = C.text, align = 'left' } = {}) {
  doc.font(font).fontSize(size).fillColor(color)
    .text(String(str ?? ''), x, y, { width: w, height: size + 3, align, lineBreak: false, ellipsis: true });
}
const label = (doc, str, x, y, w) => line(doc, String(str).toUpperCase(), x, y, w, { font: 'Helvetica-Bold', size: 6.5, color: C.muted });

function status(inv) {
  if (inv.billing_type === 'Free_Scheme') return { text: `FREE · ${inv.scheme_name || 'SCHEME'}`, fg: C.free, bg: C.freeSoft };
  const balance = Number(inv.net_amount) - Number(inv.paid_amount || 0);
  if (balance <= 0.005) return { text: 'PAID', fg: C.ok, bg: C.okSoft };
  if (Number(inv.paid_amount) > 0) return { text: 'PART PAID', fg: C.warn, bg: C.warnSoft };
  return { text: 'PAYMENT DUE', fg: C.warn, bg: C.warnSoft };
}

// ─── Header: hospital logo, name, contact, QR ───────────────────────────────
async function drawHeader(doc, inv) {
  const top = M - 6;
  doc.rect(0, 0, PAGE_W, 5).fill(C.brand);
  doc.rect(0, 5, PAGE_W, 1.6).fill('#f59e0b');

  const f = inv.facility || {};
  const logo = logoBuffer(f.logo_url);
  const LOGO_W = logo ? 64 : 0;
  if (logo) {
    try { doc.image(logo, M, top + 6, { fit: [LOGO_W, 56] }); } catch { /* unreadable logo: name alone */ }
  }

  const tx = M + LOGO_W + (logo ? 12 : 0); const tw = W - LOGO_W - (logo ? 12 : 0) - 80;
  line(doc, f.name || 'Hospital', tx, top + 14, tw, { font: 'Helvetica-Bold', size: 16, color: C.ink });
  if (f.address) doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(f.address, tx, top + 36, { width: tw, height: 28, ellipsis: true, lineGap: 0.5 });
  const contact = [f.phone ? `Phone: ${f.phone}` : null, f.email, f.website].filter(Boolean).join('   ·   ');
  if (contact) line(doc, contact, tx, top + 68, tw, { size: 7.5, color: C.muted });

  try {
    const qr = await QRCode.toDataURL(`${inv.bill_number}-REG-${inv.patient_reg_no}`, { margin: 0, width: 160, errorCorrectionLevel: 'M' });
    doc.image(qr, PAGE_W - M - 62, top + 4, { width: 62, height: 62 });
    line(doc, 'Scan to verify', PAGE_W - M - 70, top + 69, 78, { size: 6, color: C.faint, align: 'center' });
  } catch { /* the QR is a convenience; the invoice number is printed below */ }

  const y = top + 86;
  doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(0.8).stroke(C.line);
  return y;
}

// ─── Title strip with the payment status ───────────────────────────────────
function drawTitle(doc, inv, y) {
  const h = 30;
  doc.roundedRect(M, y + 10, W, h, 5).fill(C.brandSoft);
  line(doc, 'INVOICE  &  PAYMENT RECEIPT', M + 12, y + 20, 260, { font: 'Helvetica-Bold', size: 11.5, color: C.brand });
  const s = status(inv);
  doc.font('Helvetica-Bold').fontSize(8.5);
  const pw = doc.widthOfString(s.text) + 20;
  doc.roundedRect(PAGE_W - M - pw - 10, y + 17, pw, 16, 8).fill(s.bg);
  line(doc, s.text, PAGE_W - M - pw - 10, y + 21.5, pw, { font: 'Helvetica-Bold', size: 8.5, color: s.fg, align: 'center' });
  return y + 10 + h;
}

// ─── Patient and invoice details, side by side ─────────────────────────────
function drawDetails(doc, inv, y) {
  const top = y + 10; const h = 72; const gap = 10; const half = (W - gap) / 2;
  const box = (x, title, rows) => {
    doc.roundedRect(x, top, half, h, 5).fillAndStroke(C.panel, C.line);
    // A row given as [[k, v]] spans the whole box (long values such as the invoice number).
    let slot = 0;
    rows.forEach((r) => {
      const wide = Array.isArray(r[0]); const [k, v] = wide ? r[0] : r;
      if (wide && slot % 2) slot += 1;
      const cx = x + 10 + (slot % 2) * (half / 2); const cy = top + 8 + Math.floor(slot / 2) * 21;
      const w = wide ? half - 20 : half / 2 - 14;
      label(doc, k, cx, cy, w);
      line(doc, v || '—', cx, cy + 8, w, { font: 'Helvetica-Bold', size: 8.8, color: C.ink });
      slot += wide ? 2 : 1;
    });
  };
  const free = inv.billing_type === 'Free_Scheme';
  box(M, 'Patient', [
    ['Patient name', inv.patient_name || 'Walk-in patient'], ['CRN / UHID', inv.patient_reg_no],
    ['Age / Sex', [inv.age ? `${inv.age} yrs` : null, inv.gender].filter(Boolean).join(' / ')], ['Mobile', inv.patient_phone],
    ['Referred by', [inv.referring_clinician, inv.referring_facility].filter(Boolean).join(', ')], ['Scheme', free ? inv.scheme_name : 'None'],
  ]);
  box(M + half + gap, 'Invoice', [
    [['Invoice no.', inv.bill_number]],
    ['Date & time', fmtDate(inv.date)], ['Priority', inv.priority || 'Routine'],
    ['Payment mode', free ? 'Not applicable' : inv.payment_method], ['Billed by', inv.billed_by],
  ]);
  return top + h;
}

// ─── Items table (fits the space it is given) ──────────────────────────────
const COLS = [
  { key: 'sno', title: '#', w: 0.05, align: 'center' },
  { key: 'name', title: 'Service / Test', w: 0.32, align: 'left' },
  { key: 'type', title: 'Type', w: 0.11, align: 'left' },
  { key: 'sample', title: 'Sample ID', w: 0.22, align: 'left' },
  { key: 'qty', title: 'Qty', w: 0.05, align: 'center' },
  { key: 'rate', title: 'Rate (Rs.)', w: 0.11, align: 'right' },
  { key: 'amount', title: 'Amount (Rs.)', w: 0.14, align: 'right' },
];
const TYPE_LABEL = { Laboratory: 'Lab test', Registration: 'Registration' };
const lineTotal = (it) => Number(it.total_price ?? (it.amount || 0) * (it.quantity || 1));

function drawItems(doc, inv, y, bottom) {
  const items = inv.items || [];
  const top = y + 12; const headH = 20;
  let x = M;
  const cols = COLS.map((c) => { const col = { ...c, x, w: c.w * W }; x += col.w; return col; });

  doc.rect(M, top, W, headH).fill(C.brand);
  cols.forEach((c) => line(doc, c.title, c.x + 5, top + 6.5, c.w - 10, { font: 'Helvetica-Bold', size: 7.5, color: C.white, align: c.align }));

  // Rows shrink with the number of lines; past the minimum height the tail is summarised in one row.
  const avail = bottom - (top + headH);
  const rowH = Math.max(11, Math.min(19, avail / Math.max(items.length, 1)));
  const fit = Math.floor(avail / rowH);
  const shown = items.length > fit ? items.slice(0, fit - 1) : items;
  const rest = items.slice(shown.length);
  const size = rowH >= 16 ? 8.5 : rowH >= 13 ? 7.6 : 6.8;

  let ry = top + headH;
  const row = (cells, i, bold = false) => {
    if (i % 2 === 1) doc.rect(M, ry, W, rowH).fill(C.panel);
    cols.forEach((c) => line(doc, cells[c.key], c.x + 5, ry + (rowH - size) / 2, c.w - 10, {
      font: bold || c.key === 'amount' ? 'Helvetica-Bold' : 'Helvetica', size, color: c.key === 'sample' ? C.muted : C.text, align: c.align,
    }));
    ry += rowH;
    doc.moveTo(M, ry).lineTo(PAGE_W - M, ry).lineWidth(0.4).stroke(C.line);
  };
  shown.forEach((it, i) => row({
    sno: i + 1, name: it.name || 'Service', type: TYPE_LABEL[it.service_type] || it.service_type || '',
    sample: it.sample_id || '', qty: it.quantity || 1, rate: money(it.amount), amount: money(lineTotal(it)),
  }, i));
  if (rest.length) {
    row({
      sno: '', name: `+ ${rest.length} more item${rest.length > 1 ? 's' : ''} (see the bill record)`, type: '', sample: '',
      qty: rest.reduce((s, it) => s + Number(it.quantity || 1), 0), rate: '', amount: money(rest.reduce((s, it) => s + lineTotal(it), 0)),
    }, shown.length, true);
  }
  doc.rect(M, top, W, ry - top).lineWidth(0.6).stroke(C.line);
  return ry;
}

// ─── Totals, amount in words, payments ─────────────────────────────────────
function drawSummary(doc, inv, y) {
  const top = y + 14;
  const boxW = 200; const boxX = PAGE_W - M - boxW;
  const subtotal = Number(inv.total_amount ?? (inv.items || []).reduce((s, i) => s + lineTotal(i), 0));
  const discount = Number(inv.discount_amount || 0);
  const net = Number(inv.net_amount ?? subtotal - discount);
  const paid = Number(inv.paid_amount || 0);
  const free = inv.billing_type === 'Free_Scheme';

  const rows = [['Subtotal', rs(subtotal)]];
  if (Number(inv.registration_fee) > 0) rows.push(['  includes registration fee', rs(inv.registration_fee)]);
  if (discount > 0 && !free) rows.push(['Discount', `- ${rs(discount)}`]);
  if (free) rows.push(['Covered by scheme', `- ${rs(subtotal)}`]);
  let ty = top;
  rows.forEach(([k, v]) => {
    line(doc, k, boxX, ty, 120, { size: 8.5, color: C.muted });
    line(doc, v, boxX + 90, ty, boxW - 90, { size: 8.5, color: C.text, align: 'right' });
    ty += 14;
  });
  doc.roundedRect(boxX - 8, ty + 1, boxW + 8, 24, 4).fill(C.brand);
  line(doc, free ? 'Payable' : 'Net payable', boxX, ty + 9, 100, { font: 'Helvetica-Bold', size: 9.5, color: C.white });
  line(doc, rs(free ? 0 : net), boxX + 70, ty + 8, boxW - 78, { font: 'Helvetica-Bold', size: 11, color: C.white, align: 'right' });
  ty += 33;
  if (!free) {
    const bal = Math.max(0, net - paid);
    line(doc, 'Paid', boxX, ty, 100, { size: 8.5, color: C.muted });
    line(doc, rs(paid), boxX + 90, ty, boxW - 90, { font: 'Helvetica-Bold', size: 8.5, color: C.ok, align: 'right' });
    line(doc, 'Balance due', boxX, ty + 14, 100, { size: 8.5, color: C.muted });
    line(doc, rs(bal), boxX + 90, ty + 14, boxW - 90, { font: 'Helvetica-Bold', size: 8.5, color: bal > 0 ? C.warn : C.text, align: 'right' });
  }

  // Left column: amount in words and the payment receipts.
  const lw = boxX - M - 24;
  label(doc, 'Amount in words', M, top, lw);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink)
    .text(free ? 'Nil — free diagnostics under the scheme' : amountInWords(net), M, top + 9, { width: lw, height: 22, ellipsis: true });

  let py = top + 38;
  label(doc, free ? 'Payment' : 'Payments received', M, py, lw);
  py += 11;
  const pays = inv.payments || [];
  if (free) {
    line(doc, `No payment due — ${inv.scheme_name || 'free scheme'} order.`, M, py, lw, { size: 8, color: C.text });
    return;
  }
  if (!pays.length) {
    line(doc, 'No payment recorded yet.', M, py, lw, { size: 8, color: C.muted });
    return;
  }
  const pc = [['Receipt', 0.23, 'left'], ['Mode', 0.25, 'left'], ['Reference / time', 0.33, 'left'], ['Amount', 0.19, 'right']]
    .map(([t, f, align]) => ({ t, w: f * lw, align }));
  const cells = (vals, opts) => { let cx = M; vals.forEach((v, i) => { line(doc, v, cx, py, pc[i].w - 4, { align: pc[i].align, ...opts(i) }); cx += pc[i].w; }); };
  cells(pc.map((c) => c.t.toUpperCase()), () => ({ font: 'Helvetica-Bold', size: 6.5, color: C.muted }));
  py += 10;
  pays.slice(0, 4).forEach((p) => {
    const mode = p.channel && p.channel.startsWith('Razorpay') ? `Online · ${p.channel === 'Razorpay Link' ? 'Pay link' : 'Razorpay'}` : p.method;
    cells([p.receipt_no, mode, p.reference || fmtDate(p.created_at), money(p.amount)],
      (i) => ({ size: 7.8, color: C.text, font: i === 3 ? 'Helvetica-Bold' : 'Helvetica' }));
    py += 11;
  });
  if (pays.length > 4) line(doc, `+ ${pays.length - 4} more payment(s)`, M, py, lw, { size: 7.5, color: C.muted });
}

// ─── Footer: notes and generation stamp ────────────────────────────
function drawFooter(doc) {
  const top = PAGE_H - M - FOOTER_H + 6;
  doc.moveTo(M, top).lineTo(PAGE_W - M, top).lineWidth(0.6).stroke(C.line);
  [
    'Please keep this invoice — its number is needed to collect reports and to check test status.',
    'Reports are released after verification by the laboratory.',
    'Free diagnostic services are provided under the National Free Diagnostics Service Initiative (NFDS).',
  ].forEach((n, i) => line(doc, `•  ${n}`, M, top + 9 + i * 11, W, { size: 7.3, color: C.muted }));

  line(doc, `Computer-generated invoice; no signature is required.   ·   Printed ${fmtDate(new Date())}`,
    M, PAGE_H - M + 6, W, { size: 6.8, color: C.faint, align: 'center' });
  doc.rect(0, PAGE_H - 4, PAGE_W, 4).fill(C.brand);
}

// ─── Main ───────────────────────────────────────────────────────────────────
export async function generateInvoicePDFStream(invoiceData) {
  // Zero margins: every element is placed explicitly, so pdfkit never starts a second page.
  const doc = new PDFDocument({
    size: 'A4', margin: 0,
    info: { Title: `Invoice ${invoiceData.bill_number}`, Author: invoiceData.facility?.name || 'Hospital', Subject: 'Patient invoice' },
  });

  let y = await drawHeader(doc, invoiceData);
  y = drawTitle(doc, invoiceData, y);
  y = drawDetails(doc, invoiceData, y);
  y = drawItems(doc, invoiceData, y, PAGE_H - M - FOOTER_H - SUMMARY_H);
  drawSummary(doc, invoiceData, y);
  drawFooter(doc);

  doc.end();
  return doc;
}
