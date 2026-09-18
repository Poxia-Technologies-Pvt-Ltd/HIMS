import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = {
  red:          '#1e40af', // Using a professional blue theme for billing
  redDark:      '#1e3a8a',
  redLight:     '#eff6ff',
  white:        '#FFFFFF',
  black:        '#000000',
  colHeader:    '#1A1A1A',
  rowText:      '#1A1A1A',
  altRow:       '#f8fafc',
  borderLight:  '#e2e8f0',
  headerLine:   '#cbd5e1',
  gray:         '#475569',
  lightGray:    '#64748b',
  footerGray:   '#475569',
  patientBg:    '#f8fafc',
  labelColor:   '#64748b',
};

// ─── Layout ───────────────────────────────────────────────────────────────────
const PAGE_W    = 595.28;
const PAGE_H    = 841.89;
const MARGIN    = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Column widths: # | Description | Qty | Unit Price | Total
const COL = {
  sno:    CONTENT_W * 0.08,
  desc:   CONTENT_W * 0.45,
  qty:    CONTENT_W * 0.12,
  price:  CONTENT_W * 0.15,
  total:  CONTENT_W * 0.20,
};

const COL_X = {
  sno:    MARGIN,
  desc:   MARGIN + COL.sno,
  qty:    MARGIN + COL.sno + COL.desc,
  price:  MARGIN + COL.sno + COL.desc + COL.qty,
  total:  MARGIN + COL.sno + COL.desc + COL.qty + COL.price,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rect(doc, x, y, w, h, color) {
  doc.rect(x, y, w, h).fill(color);
}

function rectStroke(doc, x, y, w, h, color, lw = 0.5) {
  doc.rect(x, y, w, h).lineWidth(lw).stroke(color);
}

// ─── Header ───────────────────────────────────────────────────────────────────
function drawHeader(doc, invoice) {
  const y = MARGIN;

  // Hospital Name & Details
  doc.font('Helvetica-Bold').fontSize(24).fillColor(C.red);
  doc.text('MERIL HIMS', MARGIN, y);
  
  doc.font('Helvetica').fontSize(9).fillColor(C.gray);
  doc.text('Enterprise Hospital Management System', MARGIN, y + 30);
  doc.text('123 Healthcare Avenue, Medical District', MARGIN, y + 42);
  doc.text('Phone: +91-1234567890 | billing@merilhims.com', MARGIN, y + 54);

  // Right Side: INVOICE title
  doc.font('Helvetica-Bold').fontSize(26).fillColor(C.gray);
  doc.text('RECEIPT', PAGE_W - MARGIN - 200, y, { width: 200, align: 'right' });
  
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.black);
  doc.text(`Invoice #: ${invoice.bill_number}`, PAGE_W - MARGIN - 200, y + 32, { width: 200, align: 'right' });
  
  doc.font('Helvetica').fontSize(10).fillColor(C.gray);
  doc.text(`Date: ${invoice.date || new Date().toLocaleDateString()}`, PAGE_W - MARGIN - 200, y + 46, { width: 200, align: 'right' });

  const lineY = y + 75;
  doc.moveTo(MARGIN, lineY).lineTo(PAGE_W - MARGIN, lineY).lineWidth(1.5).stroke(C.red);
  return lineY + 20;
}

// ─── Patient Info ─────────────────────────────────────────────────────────────
async function drawPatientInfo(doc, invoice, startY) {
  const BLOCK_H = 80;
  
  // Background box
  rect(doc, MARGIN, startY, CONTENT_W, BLOCK_H, C.patientBg);
  rectStroke(doc, MARGIN, startY, CONTENT_W, BLOCK_H, C.borderLight, 0.5);
  rect(doc, MARGIN, startY, 4, BLOCK_H, C.red); // Left accent

  // Patient Details
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.black);
  doc.text('Bill To:', MARGIN + 15, startY + 12);
  
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.red);
  doc.text(invoice.patient_name || 'Walk-in Patient', MARGIN + 15, startY + 26);
  
  doc.font('Helvetica').fontSize(9).fillColor(C.gray);
  doc.text(`CRN No: ${invoice.patient_reg_no || 'N/A'}`, MARGIN + 15, startY + 42);
  if (invoice.age && invoice.gender) {
    doc.text(`Age/Sex: ${invoice.age} / ${invoice.gender}`, MARGIN + 15, startY + 54);
  }

  // Doctor Details
  const midX = MARGIN + CONTENT_W * 0.4;
  if (invoice.doctor_name) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.black);
    doc.text('Consulting Doctor:', midX, startY + 12);
    doc.font('Helvetica').fontSize(10).fillColor(C.gray);
    doc.text(invoice.doctor_name, midX, startY + 26);
  }

  // QR Code Generation
  const qrSize = 60;
  const qrX = PAGE_W - MARGIN - qrSize - 10;
  const qrY = startY + 10;
  
  try {
    const qrDataUrl = await QRCode.toDataURL(`${invoice.bill_number}-REG-${invoice.patient_reg_no}`, {
      width: qrSize * 2,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' }
    });
    doc.image(qrDataUrl, qrX, qrY, { width: qrSize, height: qrSize });
  } catch (e) {
    // Silent fail if QR generation fails
  }

  return startY + BLOCK_H + 20;
}

// ─── Table Headers ────────────────────────────────────────────────────────────
function drawTableHeaders(doc, startY) {
  const ROW_H = 24;
  rect(doc, MARGIN, startY, CONTENT_W, ROW_H, C.red);
  
  const headers = [
    { label: '#',           x: COL_X.sno,   w: COL.sno,   align: 'center' },
    { label: 'Description', x: COL_X.desc,  w: COL.desc,  align: 'left'   },
    { label: 'Qty',         x: COL_X.qty,   w: COL.qty,   align: 'center' },
    { label: 'Price (Rs)',  x: COL_X.price, w: COL.price, align: 'right'  },
    { label: 'Total (Rs)',  x: COL_X.total, w: COL.total, align: 'right'  },
  ];

  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.white);
  headers.forEach(h => {
    // adjust padding based on alignment
    const padLeft = h.align === 'left' ? 10 : 0;
    const padRight = h.align === 'right' ? 10 : 0;
    
    doc.text(h.label, h.x + padLeft, startY + 7, { 
      width: h.w - padLeft - padRight, 
      align: h.align 
    });
  });

  return startY + ROW_H;
}

// ─── Draw Table Row ───────────────────────────────────────────────────────────
function drawTableRow(doc, item, index, rowY) {
  const ROW_H = 20;
  
  if (index % 2 === 0) {
    rect(doc, MARGIN, rowY, CONTENT_W, ROW_H, C.altRow);
  }

  doc.font('Helvetica').fontSize(9).fillColor(C.rowText);
  
  doc.text(String(index + 1), COL_X.sno, rowY + 6, { width: COL.sno, align: 'center' });
  doc.text(item.name || 'Service', COL_X.desc + 10, rowY + 6, { width: COL.desc - 10, align: 'left' });
  doc.text(String(item.quantity || 1), COL_X.qty, rowY + 6, { width: COL.qty, align: 'center' });
  doc.text(Number(item.amount || 0).toFixed(2), COL_X.price, rowY + 6, { width: COL.price - 10, align: 'right' });
  doc.text(Number((item.amount || 0) * (item.quantity || 1)).toFixed(2), COL_X.total, rowY + 6, { width: COL.total - 10, align: 'right' });

  doc.moveTo(MARGIN, rowY + ROW_H).lineTo(PAGE_W - MARGIN, rowY + ROW_H).lineWidth(0.5).stroke(C.borderLight);

  return rowY + ROW_H;
}

// ─── Summary Section ──────────────────────────────────────────────────────────
function drawSummary(doc, invoice, startY) {
  let curY = startY + 20;
  
  const labelX = COL_X.price;
  const valX = COL_X.total;
  const labelW = COL.price;
  const valW = COL.total - 10;
  
  // Calculate totals
  const subtotal = invoice.items.reduce((s, i) => s + (Number(i.amount) * (i.quantity || 1)), 0);
  const discountAmt = invoice.discount_amount || 0;
  const totalDue = subtotal - discountAmt;

  // Subtotal
  doc.font('Helvetica').fontSize(10).fillColor(C.gray);
  doc.text('Subtotal:', labelX, curY, { width: labelW, align: 'right' });
  doc.font('Helvetica').text(subtotal.toFixed(2), valX, curY, { width: valW, align: 'right' });
  curY += 16;

  // Discount
  if (discountAmt > 0) {
    doc.text(`Discount:`, labelX, curY, { width: labelW, align: 'right' });
    doc.text(`-${discountAmt.toFixed(2)}`, valX, curY, { width: valW, align: 'right' });
    curY += 16;
  }

  // Divider
  doc.moveTo(labelX + 20, curY).lineTo(PAGE_W - MARGIN, curY).lineWidth(1).stroke(C.borderLight);
  curY += 8;

  // Grand Total Box
  rect(doc, labelX + 10, curY, labelW + COL.total - 10, 26, C.redLight);
  
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.redDark);
  doc.text('Total Due:', labelX, curY + 7, { width: labelW, align: 'right' });
  doc.text(`Rs. ${totalDue.toFixed(2)}`, valX, curY + 7, { width: valW, align: 'right' });

  // Payment Method
  curY += 40;
  if (invoice.payment_method) {
    doc.font('Helvetica').fontSize(9).fillColor(C.gray);
    doc.text(`Payment Method: `, MARGIN, curY, { continued: true });
    doc.font('Helvetica-Bold').text(invoice.payment_method);
  }
  
  return curY + 20;
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function drawFooter(doc) {
  const fY = PAGE_H - 60;
  
  doc.moveTo(MARGIN, fY).lineTo(PAGE_W - MARGIN, fY).lineWidth(1).stroke(C.red);
  
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(C.lightGray);
  doc.text('Thank you for choosing Meril HIMS. Wishing you a speedy recovery.', MARGIN, fY + 15, { align: 'center', width: CONTENT_W });
  doc.text('This is a computer generated invoice and does not require a signature.', MARGIN, fY + 30, { align: 'center', width: CONTENT_W });
}

// ─── Main Generator ───────────────────────────────────────────────────────────
export async function generateInvoicePDFStream(invoiceData) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN + 60, left: MARGIN, right: MARGIN },
    bufferPages: true,
  });

  let curY = drawHeader(doc, invoiceData);
  curY = await drawPatientInfo(doc, invoiceData, curY);
  curY = drawTableHeaders(doc, curY);

  const items = invoiceData.items || [];
  
  items.forEach((item, index) => {
    if (curY > PAGE_H - 200) {
      doc.addPage();
      curY = MARGIN;
      curY = drawTableHeaders(doc, curY);
    }
    curY = drawTableRow(doc, item, index, curY);
  });

  // Ensure enough space for summary
  if (curY > PAGE_H - 250) {
    doc.addPage();
    curY = MARGIN;
  }

  drawSummary(doc, invoiceData, curY);
  drawFooter(doc);

  doc.end();
  return doc;
}
