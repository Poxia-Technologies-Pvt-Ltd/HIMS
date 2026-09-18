import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

// A script face for the verifier's name, so the footer reads as a signed
// report rather than a form field. SIL Open Font License.
const SIGNATURE_FONT = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts', 'GreatVibes-Regular.ttf'
);
const hasSignatureFont = fs.existsSync(SIGNATURE_FONT);
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function base64ToBuffer(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  return Buffer.from(base64, 'base64');
}

function mimeType(dataUrl) {
  return dataUrl.match(/data:([^;]+);/)?.[1] || 'image/png';
}

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = {
  red:          '#C0272D',
  redDark:      '#9B1E23',
  redLight:     '#FDECEA',
  white:        '#FFFFFF',
  black:        '#000000',
  colHeader:    '#1A1A1A',
  rowText:      '#1A1A1A',
  subHeader:    '#1A1A1A',
  normalVal:    '#166534',
  highVal:      '#FF0000',
  lowVal:       '#0000FF',
  normalFlagBg: '#166534',
  highFlagBg:   '#FF0000',
  lowFlagBg:    '#0000FF',
  flagText:     '#FFFFFF',
  altRow:       '#F9F9F9',
  subHeaderBg:  '#F0F0F0',
  borderLight:  '#DDDDDD',
  headerLine:   '#CCCCCC',
  gray:         '#555555',
  lightGray:    '#999999',
  footerGray:   '#444444',
  patientBg:    '#FAFAFA',
  labelColor:   '#888888',
};

// ─── Layout ───────────────────────────────────────────────────────────────────
const PAGE_W    = 595.28;
const PAGE_H    = 841.89;
const MARGIN    = 30;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Fixed footer height — always reserved at the bottom of every page
const FOOTER_H  = 70;   // px reserved for footer block
// Fixed header height for page 1 (hospital header + patient info)
// For page 2+, only hospital header is repeated
const HOSPITAL_HEADER_H = 60; // approximate, computed dynamically per page

// Content area boundaries
// Page 1: below patient info (computed dynamically)
// Page 2+: below hospital mini-header
// Bottom boundary: always PAGE_H - MARGIN - FOOTER_H
const PAGE_BOTTOM_MARGIN = MARGIN + FOOTER_H + 10; // distance from bottom

// Column widths: Observation | Result | Unit | Ref
const COL = {
  obs:    CONTENT_W * 0.40,
  result: CONTENT_W * 0.15,
  unit:   CONTENT_W * 0.12,
  ref:    CONTENT_W * 0.33,
};
const COL_X = {
  obs:    MARGIN,
  result: MARGIN + COL.obs,
  unit:   MARGIN + COL.obs + COL.result,
  ref:    MARGIN + COL.obs + COL.result + COL.unit,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function resolveFlag(flag, value, range) {
  let f = (flag || 'normal').toLowerCase();

  // If flag is normal or missing, try to calculate it from range
  if ((f === 'normal' || f === 'n' || !f) && range && value !== undefined && value !== null) {
    try {
      const val = parseFloat(value);
      if (!isNaN(val)) {
        // Handle "Min - Max" format
        const rangeMatch = range.match(/([0-9.]+)\s*-\s*([0-9.]+)/);
        if (rangeMatch) {
          const min = parseFloat(rangeMatch[1]);
          const max = parseFloat(rangeMatch[2]);
          if (val < min) f = 'low';
          else if (val > max) f = 'high';
        } 
        // Handle "< Max" format
        else if (range.startsWith('<')) {
          const max = parseFloat(range.replace('<', '').trim());
          if (!isNaN(max) && val >= max) f = 'high';
        }
        // Handle "> Min" format
        else if (range.startsWith('>')) {
          const min = parseFloat(range.replace('>', '').trim());
          if (!isNaN(min) && val <= min) f = 'low';
        }
      }
    } catch (e) {
      console.error('Error parsing range for flag calculation:', e);
    }
  }

  if (['high', 'h', 'critical', 'c'].includes(f)) {
    return { label: 'HIGH',   valColor: C.highVal,   bgColor: C.highFlagBg,   textColor: C.flagText };
  } else if (['low', 'l'].includes(f)) {
    return { label: 'LOW',    valColor: C.lowVal,    bgColor: C.lowFlagBg,    textColor: C.flagText };
  } else {
    return { label: 'NORMAL', valColor: C.normalVal, bgColor: C.normalFlagBg, textColor: C.flagText };
  }
}

// patients.reg_no encodes which system the patient came from, e.g.
// "CARE-20260089875" or "CDAC-100002600015362". The prefix exists so a
// re-pull can find the same patient again; it means nothing to the person
// holding the report, and neither hospital calls the number by our name for
// it — CDAC issues a CR number, CARE a UHID. Show the bare value under the
// right label, and fall back to a neutral one for patients registered by hand.
// Scoped to Ramgarh on purpose. Every other district still reads "CRN No"
// with the stored value, because that is what their staff and their paperwork
// already say — changing a label everywhere to suit one district's rollout
// would make reports disagree between facilities.
const RELABELLED_DISTRICT = 'ramgarh';
const isRelabelledDistrict = (district) =>
  String(district || '').trim().toLowerCase() === RELABELLED_DISTRICT;

function patientIdField(regNo, district) {
  const value = String(regNo || '');
  if (!isRelabelledDistrict(district)) {
    // Unchanged behaviour: CDAC's prefix stripped, everything else as stored.
    return { label: 'CRN No', value: value.replace(/^CDAC-/i, '') };
  }
  if (/^CARE-/i.test(value)) return { label: 'UHID', value: value.replace(/^CARE-/i, '') };
  if (/^CDAC-/i.test(value)) return { label: 'CRN No', value: value.replace(/^CDAC-/i, '') };
  return { label: 'Reg No', value };
}

function measureTextHeight(doc, text, maxW, fontSize = 8, font = 'Helvetica') {
  doc.font(font).fontSize(fontSize);
  return doc.heightOfString(text, { width: maxW, lineGap: 2 });
}

function rect(doc, x, y, w, h, color) {
  doc.rect(x, y, w, h).fill(color);
}

function rectStroke(doc, x, y, w, h, color, lw = 0.5) {
  doc.rect(x, y, w, h).lineWidth(lw).stroke(color);
}

// ─── Hospital Header ──────────────────────────────────────────────────────────
// Returns the Y position after the header separator line
function drawHospitalHeader(doc, report) {
  const y = MARGIN;
  const settings = report.hospital_settings || {};
  // Branch (the actual facility this sample was collected at, from /hospitals)
  // takes priority over the global hospital_settings row, which is shared
  // across every branch and was showing the same name/address for all of them.
  const hospitalName = report.branch_name || settings.hospital_name || 'MERIL HIMS HOSPITAL';
  const address = report.branch_address || settings.address || '123 Healthcare Avenue, Medical District';
  const contact = `${report.branch_contact || settings.phone || '+91-1234567890'}  |  ${settings.email || 'lab@merilhims.com'}`;

  // ── Logo (left side) ─────────────────────────────────────────────────────
  const LOGO_H  = 55; // actual rendered height for logo image
  const LOGO_W  = 55; // actual rendered width (square logo)
  let logoDrawn = false;

  if (settings.logo_url && settings.logo_url.startsWith('data:image')) {
    try {
      const mime = mimeType(settings.logo_url);
      if (mime.includes('png') || mime.includes('jpeg') || mime.includes('jpg')) {
        const logoBuffer = base64ToBuffer(settings.logo_url);
        doc.image(logoBuffer, MARGIN, y, { height: LOGO_H });
        logoDrawn = true;
      }
    } catch (_) { /* skip */ }
  }

  if (!logoDrawn) {
    const defaultLogoPath = path.join(__dirname, '../config/logo.png');
    if (fs.existsSync(defaultLogoPath)) {
      try {
        doc.image(defaultLogoPath, MARGIN, y, { height: LOGO_H });
        logoDrawn = true;
      } catch (err) {
        console.error('Failed to draw default logo:', err.message);
      }
    }
  }

  if (!logoDrawn) {
    // Fallback: just a placeholder text, no tagline
    doc.font('Helvetica-Bold').fontSize(16).fillColor(C.red);
    doc.text('HOD', MARGIN, y + 8, { width: LOGO_W, align: 'left' });
  }

  // ── Right side: hospital name + address + contact ────────────────────────
  // Use as much width as possible — from just past logo area to right margin
  const LOGO_AREA_W = LOGO_W + 10; // logo + gap before text can start
  const RIGHT_W     = PAGE_W - MARGIN - LOGO_AREA_W - MARGIN; // full remaining width
  const rightX      = PAGE_W - MARGIN - RIGHT_W;

  // Pre-measure all right-side text heights BEFORE drawing anything
  doc.font('Helvetica-Bold').fontSize(11);
  const nameH = doc.heightOfString(hospitalName.toUpperCase(), { width: RIGHT_W, lineGap: 1 });

  doc.font('Helvetica').fontSize(7.5);
  const addrH    = doc.heightOfString(address, { width: RIGHT_W });
  const contactH = doc.heightOfString(contact,  { width: RIGHT_W });

  // Total right-block height: name + 4 gap + address + 3 gap + contact + 8 bottom padding
  const rightTotalH = nameH + 4 + addrH + 3 + contactH + 8;

  // Line sits below whichever is taller: logo (+ padding) or full right block
  const lineY = y + Math.max(LOGO_H + 8, rightTotalH);

  // Pin right block to top — name starts at y, contact ends before lineY
  const rightStartY = y;

  // Draw hospital name
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.red);
  doc.text(hospitalName.toUpperCase(), rightX, rightStartY, { width: RIGHT_W, align: 'right', lineGap: 1 });

  // Draw address below name
  const addrY = rightStartY + nameH + 4;
  doc.font('Helvetica').fontSize(7.5).fillColor(C.gray);
  doc.text(address, rightX, addrY, { width: RIGHT_W, align: 'right' });

  // Draw contact below address
  const contactY = addrY + addrH + 3;
  doc.text(contact, rightX, contactY, { width: RIGHT_W, align: 'right' });

  // Draw separator AFTER all text — guaranteed below everything
  doc.moveTo(MARGIN, lineY).lineTo(PAGE_W - MARGIN, lineY).lineWidth(1.5).stroke(C.red);
  return lineY + 8;
}

// ─── Compact hospital header for continuation pages ───────────────────────────
// Returns the Y after the separator line
function drawContinuationHeader(doc, report) {
  const y = MARGIN;
  const settings = report.hospital_settings || {};
  const hospitalName = report.branch_name || settings.hospital_name || 'MERIL HIMS HOSPITAL';

  const LOGO_H = 32;
  const LOGO_W = 36;

  // ── Logo ──────────────────────────────────────────────────────────────────
  let logoDrawn = false;
  if (settings.logo_url && settings.logo_url.startsWith('data:image')) {
    try {
      const mime = mimeType(settings.logo_url);
      if (mime.includes('png') || mime.includes('jpeg') || mime.includes('jpg')) {
        const logoBuffer = base64ToBuffer(settings.logo_url);
        doc.image(logoBuffer, MARGIN, y, { height: LOGO_H });
        logoDrawn = true;
      }
    } catch (_) {}
  }
  if (!logoDrawn) {
    const defaultLogoPath = path.join(__dirname, '../config/logo.png');
    if (fs.existsSync(defaultLogoPath)) {
      try { doc.image(defaultLogoPath, MARGIN, y, { height: LOGO_H }); logoDrawn = true; } catch (_) {}
    }
  }
  if (!logoDrawn) {
    doc.font('Helvetica-Bold').fontSize(12).fillColor(C.red);
    doc.text('HOD', MARGIN, y + 6, { width: LOGO_W });
  }

  // ── Hospital name (right-aligned, sized to fit in one line if possible) ───
  const RIGHT_W = 240;
  const rightX  = PAGE_W - MARGIN - RIGHT_W;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.red);
  doc.text(hospitalName.toUpperCase(), rightX, y + 4, { width: RIGHT_W, align: 'right', lineGap: 1 });

  // ── Patient strip sits below logo — always below LOGO_H ──────────────────
  const patientY = y + LOGO_H + 2;
  doc.font('Helvetica').fontSize(7.5).fillColor(C.gray);
  doc.text(
    `Patient: ${report.patient_name || ''}   |   Sample ID: ${report.sample_id || ''}   |   ${report.age || ''}/${report.gender || ''}`,
    MARGIN, patientY, { width: CONTENT_W }
  );

  const lineY = patientY + 12;
  doc.moveTo(MARGIN, lineY).lineTo(PAGE_W - MARGIN, lineY).lineWidth(1.5).stroke(C.red);
  return lineY + 6;
}

// ─── Patient Info Block ───────────────────────────────────────────────────────
async function drawPatientInfo(doc, report, startY) {
  const QR_SIZE     = 64;
  const QR_LABEL_H  = 16;
  const BLOCK_PAD   = 10;
  const ROW_GAP     = 7;
  const VALUE_OFFSET = 8; // value baseline sits this far below the row's label

  const fields = [
    { label: 'Patient Name',    value: report.patient_name },
    { label: isRelabelledDistrict(report.branch_district) ? 'Sample ID' : 'Lab No', value: report.sample_id },
    { label: 'Registration On', value: report.registration_date },
    // patients.reg_no carries the source system as a prefix so it can double
    // as the dedupe lookup key on re-pull — "CDAC-<crNo>" (cdacMapper.js) or
    // "CARE-<uhid>" (careBridgeController.js). That prefix is our internal
    // storage format, not something the patient or the hospital recognises,
    // so the report shows the bare identifier under the name the issuing
    // system actually uses for it: CDAC calls it a CR number, CARE a UHID.
    patientIdField(report.patient_reg_no, report.branch_district),
    // ABHA is the identifier the national health record is keyed on, so it
    // belongs on the report a patient carries between facilities. Shown only
    // when one is linked — an "ABHA: N/A" line states an absence nobody asked
    // about and takes a slot from a field that has a value.
    ...(report.abha_id ? [{ label: 'ABHA Number', value: report.abha_id }] : []),
    // Age/Sex and Referred By are dropped for Ramgarh: CARE's order list
    // exposes neither, so both rendered as "N/A / N/A" and "Self" on every
    // report — placeholders that take up space and, worse, look like recorded
    // clinical fact. Other districts capture them at registration, so they
    // keep both.
    ...(isRelabelledDistrict(report.branch_district) ? [] : [
      { label: 'Age / Sex',     value: `${report.age} / ${report.gender}` },
      { label: 'Referred By',   value: report.referred_by },
    ]),
    { label: 'Centre',          value: report.centre },
  ];
  // Split evenly rather than at a fixed index — Ramgarh has six fields, other
  // districts eight, and a hardcoded 4 would leave a lopsided second row.
  const half = Math.ceil(fields.length / 2);
  const rows = [fields.slice(0, half), fields.slice(half)];

  // Column width has to be known before we can measure how tall a wrapped
  // value (e.g. a long Lab No / sample_id) will be.
  const qrX     = PAGE_W - MARGIN - QR_SIZE - BLOCK_PAD;
  const divX    = qrX - BLOCK_PAD - 4;
  const fieldsW = divX - MARGIN - 10;
  const colW    = fieldsW / 4;

  // Measure each row's real height from its longest wrapped value, so a long
  // Lab No/sample_id can never overlap the row below it (previously a fixed
  // ROW_H assumed every value fit on one line, which sample IDs often don't).
  doc.font('Helvetica-Bold').fontSize(8);
  const rowHeights = rows.map((row) =>
    VALUE_OFFSET + Math.max(
      ...row.map(({ value }) => doc.heightOfString(value || '—', { width: colW - 4 })),
      10
    )
  );
  const totalFieldsH = rowHeights.reduce((a, b) => a + b, 0) + ROW_GAP * (rows.length - 1);

  const fieldsNeeded = BLOCK_PAD + totalFieldsH + BLOCK_PAD;
  const qrNeeded     = BLOCK_PAD + QR_SIZE + QR_LABEL_H + BLOCK_PAD;
  const blockH       = Math.max(fieldsNeeded, qrNeeded);

  rect(doc, MARGIN, startY, CONTENT_W, blockH, C.patientBg);
  rectStroke(doc, MARGIN, startY, CONTENT_W, blockH, C.borderLight, 0.5);
  rect(doc, MARGIN, startY, 3, blockH, C.red);

  const qrAreaH = QR_SIZE + QR_LABEL_H;
  const qrY     = startY + (blockH - qrAreaH) / 2;
  const labelY  = qrY + QR_SIZE + 4;

  if (report.report_url) {
    try {
      const qrDataUrl = await QRCode.toDataURL(report.report_url, {
        width: QR_SIZE * 2, margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' },
      });
      rectStroke(doc, qrX - 2, qrY - 2, QR_SIZE + 4, QR_SIZE + 4, C.borderLight, 0.5);
      doc.image(qrDataUrl, qrX, qrY, { width: QR_SIZE, height: QR_SIZE });
      doc.font('Helvetica').fontSize(5.5).fillColor(C.lightGray);
      doc.text('Scan to Download Report', qrX, labelY, { width: QR_SIZE, align: 'center', lineBreak: false });
    } catch (_) {}
  }

  doc.moveTo(divX, startY + 6).lineTo(divX, startY + blockH - 6).lineWidth(0.4).stroke(C.borderLight);

  let rowY = startY + (blockH - totalFieldsH) / 2;
  rows.forEach((row, ri) => {
    row.forEach(({ label, value }, ci) => {
      const fx = MARGIN + 8 + ci * colW;
      doc.font('Helvetica').fontSize(6.5).fillColor(C.labelColor);
      doc.text(label.toUpperCase(), fx, rowY, { width: colW - 4, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.colHeader);
      doc.text(value || '—', fx, rowY + VALUE_OFFSET, { width: colW - 4 });
    });
    rowY += rowHeights[ri] + ROW_GAP;
  });

  const afterY = startY + blockH;
  doc.moveTo(MARGIN, afterY).lineTo(PAGE_W - MARGIN, afterY).lineWidth(0.5).stroke(C.borderLight);
  return afterY + 8;
}

// ─── Section Banner ───────────────────────────────────────────────────────────
function drawSectionBanner(doc, test, startY) {
  const BANNER_H = 20;
  const META_H   = 18;

  rect(doc, MARGIN, startY, CONTENT_W, BANNER_H, C.red);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.white);
  doc.text((test.test_name || '').toUpperCase(), MARGIN + 6, startY + 5, { width: CONTENT_W * 0.55 });
  doc.font('Helvetica').fontSize(8.5).fillColor(C.white);
  doc.text(test.sample_type || '', MARGIN + 6, startY + 5.5, { width: CONTENT_W - 12, align: 'right' });

  const metaY = startY + BANNER_H;
  rect(doc, MARGIN, metaY, CONTENT_W, META_H, C.redDark);

  const metaColW = CONTENT_W / 4;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.white);
  doc.text('Accession No:', MARGIN + 6, metaY + 2);
  doc.font('Helvetica').fontSize(7.5).fillColor(C.white);
  doc.text(test.accession_no || 'N/A', MARGIN + 6, metaY + 10);

  const metaItems = [
    { label: 'Collected On:', value: test.collected_on },
    { label: 'Received On:',  value: test.received_on  },
    { label: 'Approved On:',  value: test.approved_on  },
  ];
  metaItems.forEach((item, i) => {
    const mx = MARGIN + metaColW * (i + 1);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.white);
    doc.text(`${item.label}  `, mx, metaY + 5, { continued: true });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.white);
    doc.text(item.value || 'N/A', { continued: false });
  });

  return metaY + META_H;
}

// ─── Column Headers ───────────────────────────────────────────────────────────
function drawColumnHeaders(doc, startY) {
  const ROW_H = 18;
  rect(doc, MARGIN, startY, CONTENT_W, ROW_H, '#EEEEEE');
  doc.moveTo(MARGIN, startY + ROW_H).lineTo(PAGE_W - MARGIN, startY + ROW_H).lineWidth(0.8).stroke(C.red);

  const headers = [
    { label: 'Observation',              x: COL_X.obs,    w: COL.obs,    align: 'left'   },
    { label: 'Result',                   x: COL_X.result, w: COL.result, align: 'center' },
    { label: 'Unit',                     x: COL_X.unit,   w: COL.unit,   align: 'center' },
    { label: 'Biological Ref. Interval', x: COL_X.ref,    w: COL.ref,    align: 'left'   },
  ];

  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.colHeader);
  headers.forEach(h => {
    doc.text(h.label, h.x + (h.align === 'left' ? 5 : 0), startY + 5, { width: h.w, align: h.align });
  });

  return startY + ROW_H;
}

// ─── Row Measurement ──────────────────────────────────────────────────────────
function measureRowHeight(doc, param) {
  if (param.is_subheader) return 16;
  const obsH = measureTextHeight(doc, param.parameter_name || '', COL.obs - 10);
  const refH = measureTextHeight(doc, param.reference_range || '', COL.ref - 10);
  return Math.max(obsH, refH, 18) + 6;
}

// ─── Draw a single data row ───────────────────────────────────────────────────
function drawDataRow(doc, param, rowY, rowIndex) {
  const rowH = measureRowHeight(doc, param);

  if (param.is_subheader) {
    rect(doc, MARGIN, rowY, CONTENT_W, rowH, C.subHeaderBg);
    doc.moveTo(MARGIN, rowY + rowH).lineTo(PAGE_W - MARGIN, rowY + rowH).lineWidth(0.4).stroke(C.borderLight);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.subHeader);
    doc.text(param.parameter_name, MARGIN + 5, rowY + 4, { width: CONTENT_W - 10 });
    return rowY + rowH;
  }

  if (rowIndex % 2 === 0) {
    rect(doc, MARGIN, rowY, CONTENT_W, rowH, C.altRow);
  }

  const { valColor, label } = resolveFlag(param.result_flag, param.result_value, param.reference_range);
  const textY = rowY + 5;

  doc.font('Helvetica').fontSize(8).fillColor(C.rowText);
  doc.text(param.parameter_name || '', COL_X.obs + 5, textY, { width: COL.obs - 10, lineGap: 1.5 });

  // Only out-of-range results are bold — normal results stay regular weight so
  // the abnormal ones stand out at a glance. Color still tracks the flag.
  const isAbnormal = label === 'HIGH' || label === 'LOW';
  doc.font(isAbnormal ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(valColor);
  doc.text(String(param.result_value || ''), COL_X.result, textY, { width: COL.result, align: 'center' });

  doc.font('Helvetica').fontSize(8).fillColor(C.gray);
  doc.text(param.unit || '', COL_X.unit, textY, { width: COL.unit, align: 'center' });

  doc.font('Helvetica').fontSize(8).fillColor(C.gray);
  doc.text(param.reference_range || '', COL_X.ref + 5, textY, { width: COL.ref - 10, lineGap: 1.5 });

  doc.moveTo(MARGIN, rowY + rowH).lineTo(PAGE_W - MARGIN, rowY + rowH).lineWidth(0.3).stroke(C.borderLight);

  return rowY + rowH;
}

// ─── Remarks (inline after data) ─────────────────────────────────────────────
function drawRemarks(doc, remarks, y) {
  if (!remarks) return y;
  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(C.lightGray);
  doc.text(`Remarks: ${remarks}`, MARGIN + 5, y + 4, { width: CONTENT_W - 10 });
  return y + 4 + doc.heightOfString(`Remarks: ${remarks}`, { width: CONTENT_W - 10 }) + 4;
}

// ─── Disclaimer (inline after data) ──────────────────────────────────────────
function drawDisclaimer(doc, y) {
  doc.font('Helvetica-Oblique').fontSize(7).fillColor(C.lightGray);
  const text = 'In case of any unexpected or alarming results, please contact us immediately for re-confirmation, clarifications, and rectifications, if needed.';
  doc.text(text, MARGIN + 5, y + 3, { width: CONTENT_W - 10 });
  return y + 3 + doc.heightOfString(text, { width: CONTENT_W - 10 }) + 6;
}

// ─── Fixed Footer (drawn on every page absolutely) ───────────────────────────
// This is drawn FIXED at the bottom — always at the same absolute Y position.
// It does NOT consume curY content space — it's purely absolute.
function drawPageFooter(doc, report, pageNum, totalPages) {
  // Footer zone starts at PAGE_H - MARGIN - FOOTER_H
  const fY = PAGE_H - MARGIN - FOOTER_H;

  // Top separator line of footer
  doc.moveTo(MARGIN, fY).lineTo(PAGE_W - MARGIN, fY).lineWidth(0.5).stroke(C.borderLight);

  const midX = PAGE_W / 2;
  const sigY = fY + 30;

  // Verified & Approved By (centered — the "Tested By" column was removed)
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.red);
  doc.text('Verified & Approved By', midX, fY + 4, { width: midX - MARGIN - 10 });

  // The name above the rule, in a script face — what the labs asked for, so
  // the footer reads as signed rather than as a filled-in field.
  const verifier = report.verified_by_name || 'N/A';
  if (hasSignatureFont) {
    doc.font(SIGNATURE_FONT).fontSize(20).fillColor(C.gray);
    doc.text(verifier, midX, fY + 13, { width: 150, lineBreak: false });
  } else {
    // Never fail a clinical document over a missing font file.
    doc.font('Helvetica-Oblique').fontSize(11).fillColor(C.gray);
    doc.text(verifier, midX, fY + 16, { width: 150, lineBreak: false });
  }

  doc.moveTo(midX, sigY).lineTo(midX + 150, sigY).lineWidth(0.5).stroke(C.borderLight);
  doc.font('Helvetica').fontSize(7).fillColor(C.lightGray);
  doc.text(`Lab Head / Pathologist  ·  ${report.verified_at || ''}`, midX, sigY + 3, { width: 200 });

  // Bottom strip
  const bottomY = sigY + 14;
  doc.moveTo(MARGIN, bottomY).lineTo(PAGE_W - MARGIN, bottomY).lineWidth(0.3).stroke(C.borderLight);

  doc.font('Helvetica-Oblique').fontSize(6.5).fillColor(C.lightGray);
  doc.text(
    // Stated plainly because the footer now LOOKS hand-signed: the script
    // name is the verifier's name set in a script face, not their signature,
    // and a clinical document must not imply otherwise.
    'Computer-generated report, electronically verified. The name above is not a handwritten signature.',
    MARGIN, bottomY + 4,
    { width: CONTENT_W * 0.70, align: 'left' }
  );
  doc.font('Helvetica').fontSize(7).fillColor(C.gray);
  doc.text(
    `Page ${pageNum} of ${totalPages}`,
    MARGIN, bottomY + 4,
    { width: CONTENT_W, align: 'right' }
  );
}

// ─── Scattergram Row (4 images in one row) ───────────────────────────────────
function drawScattergramRow(doc, scattergrams, y) {
  if (!scattergrams || scattergrams.length === 0) return y;

  const count    = Math.min(scattergrams.length, 4);
  const GAP      = 8;
  const IMG_W    = (CONTENT_W - GAP * (count - 1)) / count;
  const IMG_H    = IMG_W * 0.75;   // 4:3 aspect ratio
  const LABEL_H  = 14;

  // Section heading
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.colHeader);
  doc.text('SCATTEROGRAMS', MARGIN, y + 3, { width: CONTENT_W });
  y += 14;

  scattergrams.slice(0, 4).forEach((scatter, i) => {
    const x = MARGIN + i * (IMG_W + GAP);

    try {
      const imgBuffer = Buffer.from(scatter.base64, 'base64');
      doc.image(imgBuffer, x, y, { width: IMG_W, height: IMG_H });
    } catch (_) {
      // Fallback placeholder box if image fails
      rect(doc, x, y, IMG_W, IMG_H, '#EEEEEE');
      doc.font('Helvetica').fontSize(6).fillColor(C.lightGray);
      doc.text('Image N/A', x, y + IMG_H / 2 - 4, { width: IMG_W, align: 'center' });
    }

    // Label centred below each image
    doc.font('Helvetica').fontSize(6.5).fillColor(C.gray);
    doc.text(scatter.label || scatter.code, x, y + IMG_H + 2, {
      width: IMG_W, align: 'center', lineBreak: false,
    });
  });

  return y + IMG_H + LABEL_H + 6;
}

// ─── Main PDF generation ──────────────────────────────────────────────────────
export async function generateLabReportPDFStream(reportData) {
  // We use bufferPages:true so we can do a second pass for footers
  const options = {
    size: 'A4',
    // No bottom margin needed — we handle everything manually
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    bufferPages: true,
  };

  if (reportData.patient_reg_no && reportData.patient_reg_no !== 'N/A') {
    // Password lock removed per user request
    // options.userPassword  = reportData.patient_reg_no;
    // options.ownerPassword = reportData.patient_reg_no;
  }

  const doc = new PDFDocument(options);

  // The usable content area bottom for every page.
  // Footer is FOOTER_H tall and sits MARGIN from the absolute bottom.
  // We leave a small gap above the footer too.
  const PAGE_BOTTOM = PAGE_H - MARGIN - FOOTER_H - 8;

  // ── Page 1: Hospital Header + Patient Info ────────────────────────────────
  let curY = drawHospitalHeader(doc, reportData);
  curY     = await drawPatientInfo(doc, reportData, curY);

  // Track which page we're on (1-indexed) for headers on new pages
  let isFirstPage = true;

  // Helper: add a new page with a compact continuation header
  function addNewPage() {
    doc.addPage();
    isFirstPage = false;
    curY = drawContinuationHeader(doc, reportData);
  }

  const tests = reportData.tests || [];

  for (let ti = 0; ti < tests.length; ti++) {
    const test = tests[ti];

    // Section banner needs ~40px (banner 20 + meta 18 + colHeader 18 = 56)
    const bannerNeeds = 56;
    if (curY + bannerNeeds > PAGE_BOTTOM) {
      addNewPage();
    }

    curY = drawSectionBanner(doc, test, curY);
    curY = drawColumnHeaders(doc, curY);

    const params = test.parameters || [];
    let dataRowIndex = 0;

    for (const param of params) {
      const rowH = measureRowHeight(doc, param);

      // If this row doesn't fit, go to a new page
      if (curY + rowH > PAGE_BOTTOM) {
        addNewPage();
        // Re-draw column headers at the top of the new page
        curY = drawColumnHeaders(doc, curY);
        dataRowIndex = 0;
      }

      curY = drawDataRow(doc, param, curY, dataRowIndex);
      if (!param.is_subheader) dataRowIndex++;
    }

    // ── Remarks (inline, right after the last row) ─────────────────────────
    if (test.remarks) {
      const remarksH = 4 + doc.heightOfString(`Remarks: ${test.remarks}`, { width: CONTENT_W - 10, font: 'Helvetica-Oblique', fontSize: 7.5 }) + 8;
      if (curY + remarksH > PAGE_BOTTOM) {
        addNewPage();
      }
      curY = drawRemarks(doc, test.remarks, curY);
    }

    // ── Disclaimer (inline, right after remarks/last row) ─────────────────
    const disclaimerText = 'In case of any unexpected or alarming results, please contact us immediately for re-confirmation, clarifications, and rectifications, if needed.';
    const disclaimerH = 3 + doc.heightOfString(disclaimerText, { width: CONTENT_W - 10, font: 'Helvetica-Oblique', fontSize: 7 }) + 10;
    if (curY + disclaimerH > PAGE_BOTTOM) {
      addNewPage();
    }
    curY = drawDisclaimer(doc, curY);

    // ── Scattergrams (4 images in one row, only for machines that send them) ─
    if (test.scattergrams && test.scattergrams.length > 0) {
      const count   = Math.min(test.scattergrams.length, 4);
      const gap     = 8;
      const imgW    = (CONTENT_W - gap * (count - 1)) / count;
      const imgH    = imgW * 0.75;
      const scatterBlockH = 14 + imgH + 14 + 6;   // heading + image + label + padding

      if (curY + scatterBlockH > PAGE_BOTTOM) {
        addNewPage();
      }
      curY = drawScattergramRow(doc, test.scattergrams, curY);
    }

    // ── Divider between tests ──────────────────────────────────────────────
    if (ti < tests.length - 1) {
      if (curY + 14 <= PAGE_BOTTOM) {
        doc.moveTo(MARGIN, curY).lineTo(PAGE_W - MARGIN, curY).lineWidth(0.5).stroke(C.borderLight);
        curY += 10;
      } else {
        addNewPage();
      }
    }
  }

  // ── Second pass: draw footer on every page ────────────────────────────────
  const totalPages = doc.bufferedPageRange().count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    // Disable the automatic page margins so we can draw in the reserved zone
    doc.page.margins.bottom = 0;
    drawPageFooter(doc, reportData, i + 1, totalPages);
  }

  doc.end();
  return doc;
}