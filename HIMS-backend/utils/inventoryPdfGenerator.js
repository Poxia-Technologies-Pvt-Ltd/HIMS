import PDFDocument from 'pdfkit';

function base64ToBuffer(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  return Buffer.from(base64, 'base64');
}

function mimeType(dataUrl) {
  return dataUrl.match(/data:([^;]+);/)?.[1] || 'image/png';
}

/**
 * Professional Purchase Order PDF Generator
 */
export function generatePOPdf(po, settings) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const hospitalName = settings?.hospital_name || 'HIMS';
    const primaryColor = '#1e40af';
    const gray = '#475569';
    const lightGray = '#e2e8f0';

    // ── Header ──────────────────────────────────────────────────────
    let headerY = 50;

    // Logo (left)
    if (settings?.logo_url && settings.logo_url.startsWith('data:image')) {
      try {
        const logoBuffer = base64ToBuffer(settings.logo_url);
        const mime = mimeType(settings.logo_url);
        const ext = mime.includes('png') ? 'png' : 'jpeg';
        doc.image(logoBuffer, 50, headerY, { height: 55, fit: [120, 55] });
      } catch (_) { /* logo failed, skip */ }
    }

    // Hospital name (left, under logo)
    doc.font('Helvetica-Bold').fontSize(14).fillColor(primaryColor)
      .text(hospitalName, 50, headerY + 60, { width: 250 });
    if (settings?.address) {
      doc.font('Helvetica').fontSize(9).fillColor(gray)
        .text(settings.address, 50, doc.y + 2, { width: 250 });
    }
    if (settings?.phone || settings?.email) {
      doc.fontSize(9).fillColor(gray)
        .text(`${settings?.phone ? 'Tel: ' + settings.phone : ''} ${settings?.email ? '| ' + settings.email : ''}`, 50, doc.y + 2, { width: 250 });
    }

    // PO Box (right)
    doc.roundedRect(360, headerY, 185, 85, 6).fill(primaryColor);
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#ffffff')
      .text('PURCHASE ORDER', 360, headerY + 12, { width: 185, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#bfdbfe')
      .text(po.po_number, 360, headerY + 42, { width: 185, align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#e0f2fe')
      .text(`Date: ${new Date(po.created_at || Date.now()).toLocaleDateString('en-IN')}`, 360, headerY + 60, { width: 185, align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor('#e0f2fe')
      .text(`Delivery: ${po.expected_delivery_date ? new Date(po.expected_delivery_date).toLocaleDateString('en-IN') : 'ASAP'}`, 360, headerY + 72, { width: 185, align: 'center' });


    // ── Divider ──────────────────────────────────────────────────────
    const divY = headerY + 155;
    doc.moveTo(50, divY).lineTo(545, divY).strokeColor(lightGray).lineWidth(1).stroke();

    // ── Vendor / Ship To ─────────────────────────────────────────────
    const infoY = divY + 14;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(gray)
      .text('VENDOR', 50, infoY);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a')
      .text(po.vendor_name || '-', 50, infoY + 14, { width: 240 });

    doc.font('Helvetica-Bold').fontSize(9).fillColor(gray)
      .text('SHIP TO', 310, infoY);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a')
      .text(hospitalName, 310, infoY + 14, { width: 235 });
    if (settings?.address) {
      doc.font('Helvetica').fontSize(9).fillColor(gray)
        .text(settings.address, 310, doc.y + 2, { width: 235 });
    }
    doc.font('Helvetica').fontSize(9).fillColor(gray)
      .text(`Authorized by: ${po.created_by_name || 'Admin'}`, 310, doc.y + 4, { width: 235 });

    // ── Items Table Header ────────────────────────────────────────────
    const tableY = infoY + 90;
    doc.rect(50, tableY, 495, 24).fill(primaryColor);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
    const cols = [50, 110, 310, 380, 460];
    const headers = ['Code', 'Item Description', 'Qty', 'Unit Price', 'Subtotal'];
    headers.forEach((h, i) => {
      doc.text(h, cols[i] + 4, tableY + 8, { width: 80 });
    });

    // ── Item Rows ─────────────────────────────────────────────────────
    let rowY = tableY + 24;
    (po.items || []).forEach((item, idx) => {
      const bg = idx % 2 === 0 ? '#f8fafc' : '#ffffff';
      doc.rect(50, rowY, 495, 30).fill(bg);
      
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e293b');
      doc.text(item.item_name || '', cols[1] + 4, rowY + 6, { width: 195 });
      doc.font('Helvetica').fontSize(8).fillColor(gray);
      doc.text(`Code: ${item.item_code || ''}`, cols[1] + 4, rowY + 17, { width: 195 });

      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e293b');
      doc.text(`${item.quantity} ${item.unit || ''}`, cols[2] + 4, rowY + 10, { width: 65 });
      doc.text(`₹${parseFloat(item.unit_price || 0).toFixed(2)}`, cols[3] + 4, rowY + 10, { width: 75, align: 'right' });
      doc.text(`₹${parseFloat(item.subtotal || 0).toFixed(2)}`, cols[4] + 4, rowY + 10, { width: 75, align: 'right' });
      
      rowY += 30;
    });

    // ── Total ─────────────────────────────────────────────────────────
    rowY += 10;
    doc.rect(380, rowY, 165, 30).fill(primaryColor);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#bfdbfe')
      .text('TOTAL ORDER AMOUNT', 390, rowY + 5, { width: 145 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#ffffff')
      .text(`₹${parseFloat(po.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 390, rowY + 14, { width: 145, align: 'right' });

    // ── Remarks ───────────────────────────────────────────────────────
    if (po.remarks) {
      rowY += 50;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(gray).text('ORDER NOTES', 50, rowY);
      doc.font('Helvetica').fontSize(9).fillColor('#475569')
        .text(po.remarks, 50, rowY + 12, { width: 300, lineGap: 2 });
    }


    // ── Footer ────────────────────────────────────────────────────────
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
      .text('This is a system-generated document. No manual signature required.', 50, 770, { align: 'center', width: 495 });

    doc.end();
  });
}
