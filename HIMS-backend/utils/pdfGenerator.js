import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
import { Readable } from 'stream';
import { PDFDocument } from 'pdf-lib';
import db from '../config/db.js';
import { signPdfIfConfigured, dscConfigured } from './dscSigner.js';
import { storedSignedPdf } from './doctorDsc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rendered as real HTML/CSS via a headless Chromium (see Dockerfile for the
// system-Chromium setup) instead of hand-positioning a PDF drawing API —
// per request, the Karnataka report has to match a supplied HTML reference
// design exactly, which a drawing API can only ever approximate. Scoped to
// this Karnataka deployment only.

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function resolveFlag(flag, value, range) {
  let f = (flag || 'normal').toLowerCase();

  // If flag is normal or missing, try to calculate it from range
  if ((f === 'normal' || f === 'n' || !f) && range && value !== undefined && value !== null) {
    try {
      const val = parseFloat(value);
      if (!isNaN(val)) {
        const rangeMatch = range.match(/([0-9.]+)\s*-\s*([0-9.]+)/);
        if (rangeMatch) {
          const min = parseFloat(rangeMatch[1]);
          const max = parseFloat(rangeMatch[2]);
          if (val < min) f = 'low';
          else if (val > max) f = 'high';
        } else if (range.startsWith('<')) {
          const max = parseFloat(range.replace('<', '').trim());
          if (!isNaN(max) && val >= max) f = 'high';
        } else if (range.startsWith('>')) {
          const min = parseFloat(range.replace('>', '').trim());
          if (!isNaN(min) && val <= min) f = 'low';
        }
      }
    } catch (e) {
      console.error('Error parsing range for flag calculation:', e);
    }
  }

  if (['high', 'h', 'critical', 'c'].includes(f)) return 'HIGH';
  if (['low', 'l'].includes(f)) return 'LOW';
  return 'NORMAL';
}

// patients.reg_no encodes which system the patient came from, e.g.
// "CARE-20260089875" or "CDAC-100002600015362" — meaningless to the person
// holding the report. Scoped to Ramgarh on purpose; not relevant for
// Karnataka (no CDAC/CARE integration here) but kept for parity with the
// shared data model.
const RELABELLED_DISTRICT = 'ramgarh';
const isRelabelledDistrict = (district) =>
  String(district || '').trim().toLowerCase() === RELABELLED_DISTRICT;

function mrnValue(regNo, district) {
  const value = String(regNo || '');
  if (!isRelabelledDistrict(district)) return value.replace(/^CDAC-/i, '');
  if (/^CARE-/i.test(value)) return value.replace(/^CARE-/i, '');
  if (/^CDAC-/i.test(value)) return value.replace(/^CDAC-/i, '');
  return value;
}

function logoDataUri(settings) {
  if (settings?.logo_url && settings.logo_url.startsWith('data:image')) {
    return settings.logo_url;
  }
  const defaultLogoPath = path.join(__dirname, '../config/logo.png');
  if (fs.existsSync(defaultLogoPath)) {
    const buf = fs.readFileSync(defaultLogoPath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  }
  return '';
}

// ─── One <table> block per test panel ──────────────────────────────────────────
// Parameters excluded from the PDF report specifically (not from the
// underlying data — still visible on the worklist/verification screens,
// just not printed). Mostly the extended CBC differential/research
// sub-parameters analyzers like the CelltacEs/Mindray report alongside the
// standard panel, which aren't wanted on the patient-facing document.
const OMITTED_PARAMETERS = new Set([
  'BAS#', 'BAS%', 'NEU#', 'EOS#', 'LYM#', 'MON#',
  'ALY#', 'ALY%', 'LIC#', 'LIC%',
  'BLAST#', 'BLAST%',
  'PLTCLUMP#', 'PLTCLUMP%',
  'LIP#', 'LIP%',
  'NLR', 'PLR',
  'NEU-X', 'NEU-Y', 'NEU-Z',
  'LYM-X', 'LYM-Y', 'LYM-Z',
  'MON-X', 'MON-Y', 'MON-Z',
  'RDW-SD', 'MPV', 'PDW', 'PCT',
  'NRBC#', 'NRBC%', 'PLCC', 'PLCR',
]);
// Analyzers prefix an asterisk on some of these (e.g. "*ALY#") — strip it
// before matching so the omit list doesn't need every prefixed variant too.
const isOmittedParameter = (name) =>
  OMITTED_PARAMETERS.has(String(name || '').trim().replace(/^\*/, '').toUpperCase());

// Parameter code -> display name (parameter_code_names table), editable by
// Admin-level users at /parameter-codes so anything analyzers send that
// isn't covered can be filled in without a code change. Cached in memory
// (per backend process) rather than queried per row/report — an edit shows
// up on the next report generated after the cache expires, not instantly,
// which is an acceptable tradeoff for not hitting the DB on every PDF.
let parameterNameCache = null;
let parameterNameCacheAt = 0;
const PARAMETER_NAME_CACHE_TTL_MS = 60_000;

async function getParameterNameMap() {
  const now = Date.now();
  if (parameterNameCache && (now - parameterNameCacheAt) < PARAMETER_NAME_CACHE_TTL_MS) {
    return parameterNameCache;
  }
  try {
    const [rows] = await db.query('SELECT code, name FROM parameter_code_names');
    parameterNameCache = new Map(rows.map((r) => [r.code.trim().toUpperCase(), r.name]));
    parameterNameCacheAt = now;
  } catch (err) {
    console.error('Failed to load parameter_code_names, falling back to raw codes:', err.message);
    // Keep serving whatever was cached before rather than an empty map —
    // a transient DB hiccup shouldn't blank out every already-known name.
    if (!parameterNameCache) parameterNameCache = new Map();
  }
  return parameterNameCache;
}

function displayParameterName(rawName, nameMap) {
  const code = String(rawName || '').trim().replace(/^\*/, '');
  const name = nameMap.get(code.toUpperCase());
  // "White Blood Cell Count (WBC)" when a mapping exists; an unmapped code
  // has no name to pair it with, so it prints on its own rather than as
  // "WBC (WBC)".
  return name ? `${name} (${code})` : code;
}

// Fixed clinical print order for the standard CBC panel, per lab request —
// analyzers emit parameters in whatever order they were measured/output,
// which rarely matches the order a report is expected to read in. Some
// slots list more than one code because different analyzers/imports label
// the same measurement differently (e.g. WBC vs TC, HCT vs PCV, RDW vs
// RDW-CV — RDW-SD is a separate, already-omitted parameter, not an alias).
const CBC_PARAM_ORDER = [
  ['HGB'], ['WBC', 'TC'], ['NEU%'], ['LYM%'], ['MON%'], ['EOS%'], ['BAS%'],
  ['PLT'], ['HCT', 'PCV'], ['MCV'], ['MCH'], ['MCHC'], ['RDW', 'RDW-CV'], ['RBC'],
];
function cbcRank(rawName) {
  const code = String(rawName || '').trim().replace(/^\*/, '').toUpperCase();
  const idx = CBC_PARAM_ORDER.findIndex((aliases) => aliases.includes(code));
  return idx === -1 ? null : idx;
}

function buildTestTable(test, nameMap) {
  const params = (test.parameters || []).filter((p) => p.is_subheader || !isOmittedParameter(p.parameter_name));
  // Any parameter matching the CBC order above moves into that fixed
  // position; a section subheader always stays first (in its own original
  // relative order); everything else (histogram lines, non-CBC panels,
  // anything not in the list) keeps its original relative order, placed
  // after the ranked CBC parameters — so this is a no-op for every panel
  // that isn't CBC, since none of its codes will ever match.
  const rank = (p, idx) => {
    if (p.is_subheader) return -2_000_000 + idx;
    const r = cbcRank(p.parameter_name);
    return r !== null ? r : 1_000_000 + idx;
  };
  const sorted = params
    .map((p, idx) => ({ p, key: rank(p, idx) }))
    .sort((a, b) => a.key - b.key)
    .map(({ p }) => p);

  const rows = sorted.map((p) => {
    if (p.is_subheader) {
      return `<tr class="section-label"><td colspan="4">${escapeHtml(p.parameter_name)}</td></tr>`;
    }
    const rawFlag = String(p.result_flag || p.flag || '').toLowerCase();
    const critical = rawFlag.startsWith('critical') || rawFlag === 'hh' || rawFlag === 'll';
    const flag = rawFlag === 'invalid' || rawFlag === 'i' ? 'INVALID'
      : critical ? (rawFlag.includes('low') || rawFlag === 'll' ? 'LOW' : 'HIGH')
      : resolveFlag(rawFlag === 'h' ? 'high' : rawFlag === 'l' ? 'low' : rawFlag, p.result_value, p.reference_range);
    const flagClass = flag === 'LOW' ? 'flag-low' : flag === 'HIGH' ? 'flag-high' : '';
    const flagSuffix = flag === 'INVALID' ? ' (invalid)' : critical ? (flag === 'LOW' ? ' LL' : ' HH') : flag === 'LOW' ? ' L' : flag === 'HIGH' ? ' H' : '';
    return `<tr>
      <td>${escapeHtml(displayParameterName(p.parameter_name, nameMap))}</td>
      <td class="${flagClass}">${escapeHtml(p.result_value)}${flagSuffix}</td>
      <td>${escapeHtml(p.unit)}</td>
      <td>${escapeHtml(p.reference_range)}</td>
    </tr>`;
  }).join('\n');

  const caption = (test.department || test.test_name || 'LABORATORY').toUpperCase();

  return `
  <table>
    <caption>${escapeHtml(caption)}</caption>
    <thead>
      <tr>
        <th>Test</th>
        <th>Result</th>
        <th>Unit</th>
        <th>Biological Reference Interval</th>
      </tr>
    </thead>
    <tbody>
      <tr class="section-label"><td colspan="4">${escapeHtml((test.test_name || '').toUpperCase())}</td></tr>
      ${rows}
    </tbody>
  </table>`;
}

// ─── Full report HTML ──────────────────────────────────────────────────────────
function buildReportHtml(report, qrDataUri, nameMap) {
  const settings = report.hospital_settings || {};
  const hospitalName = (report.branch_name || settings.hospital_name || 'MERIL HIMS HOSPITAL').toUpperCase();
  // Phone/email deliberately left out of the header — only the hospital
  // name and address show there now. The phone still appears once, in the
  // footer's helpline line.
  const address = report.branch_address || settings.address || '';

  const tests = report.tests || [];
  const firstTest = tests[0] || {};
  const specimens = [...new Set(tests.map((t) => t.sample_type).filter(Boolean))].join(', ');

  const mrn = mrnValue(report.patient_reg_no, report.branch_district);
  const genderAge = [report.gender, report.age].filter(Boolean).join(', ');

  const testsHtml = tests.map((t) => buildTestTable(t, nameMap)).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(hospitalName)} - Lab Report</title>
<style>
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #222;
    margin: 0;
    padding: 0;
    line-height: 1.35;
  }
  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 15px;
    border-bottom: 2px solid #333;
    padding-bottom: 8px;
    margin-bottom: 10px;
  }
  .header-left { display: flex; align-items: center; gap: 15px; }
  .header h1 { margin: 0; font-size: 22px; }
  .header p { margin: 2px 0 0 0; font-size: 13px; color: #555; }
  .qr-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
  }
  .dept-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 10px;
  }
  .dept-row h2 { font-size: 15px; letter-spacing: 0.5px; margin: 0; }
  .dept-row span { font-size: 13px; font-style: italic; }
  .info-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px 14px;
    background: #f2f2f2;
    padding: 10px 14px;
    border-radius: 4px;
    margin-bottom: 8px;
  }
  .info-field { min-width: 0; }
  .info-field .lbl {
    display: block;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #777;
    text-transform: uppercase;
  }
  .info-field .val { font-size: 13px; font-weight: 600; color: #222; word-break: break-word; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  /* page-break-inside: avoid on the table itself (not just its rows) made
     Chromium treat the whole table as one unbreakable block — a table that
     didn't fully fit in whatever space was left on the current page moved
     in its entirety to the next one, leaving the current page mostly blank
     instead of filling it and breaking cleanly between rows. Row-level
     avoidance (tr/td/th) is what actually matters — it just stops a single
     row's cells from being split mid-row across the page boundary. */
  tr, td, th { page-break-inside: avoid; }
  caption { font-weight: bold; letter-spacing: 1px; margin-bottom: 8px; font-size: 15px; text-align: left; }
  th, td { text-align: left; padding: 6px 10px; font-size: 13px; }
  thead th { border-bottom: 2px solid #333; font-size: 13px; }
  tbody tr { border-bottom: 1px solid #ddd; }
  .section-label td { font-weight: bold; padding-top: 10px; border-bottom: none; }
  .flag-low, .flag-high { color: #b30000; font-weight: bold; }
  .end-report { text-align: center; font-weight: bold; margin: 16px 0; page-break-inside: avoid; }
  .tail { page-break-inside: avoid; }
  .signature {
    display: flex;
    justify-content: space-between;
    max-width: 400px;
    margin-top: 20px;
    font-size: 13px;
  }
  .corrected { margin: 10px 0; padding: 8px 12px; border: 1.5px solid #b45309; background: #fffbeb; color: #78350f; font-size: 12px; page-break-inside: avoid; }
  .esign { display: flex; justify-content: space-between; gap: 24px; margin-top: 20px; padding-top: 10px; border-top: 1px solid #999; page-break-inside: avoid; }
  .esign-img { height: 52px; max-width: 200px; object-fit: contain; display: block; margin-bottom: 2px; }
  .esign-name { font-weight: bold; font-size: 13px; }
  .esign-line { font-size: 11.5px; color: #333; line-height: 1.5; }
  .esign-title { font-weight: bold; font-size: 12px; color: #14532d; margin-bottom: 3px; }
  .esign-right { text-align: right; max-width: 300px; }
  .note { margin-top: 14px; font-size: 12px; }
  .note h3 { font-size: 13px; margin-bottom: 4px; }
  .note ul { margin: 0; padding-left: 18px; }
  .footer { text-align: center; font-size: 12px; margin-top: 16px; color: #444; }
</style>
</head>
<body>

  <!-- The logo/hospital-name/address/QR header used to render here, once,
       at the top of page 1 only. It's now built into the Puppeteer
       headerTemplate instead (see generateLabReportPDFStream) so the exact
       same header repeats identically on every page, not just the first.
       The "DEPARTMENT OF LABORATORY MEDICINE / Final Report" row moved into
       that same repeating header for the same reason — it no longer needs
       to live here too. -->

  <div class="info-grid">
    <div class="info-field"><span class="lbl">Patient Name</span><span class="val">${escapeHtml(report.patient_name)}</span></div>
    <div class="info-field"><span class="lbl">MRN</span><span class="val">${escapeHtml(mrn)}</span></div>
    <div class="info-field"><span class="lbl">Gender / Age</span><span class="val">${escapeHtml(genderAge)}</span></div>
    <div class="info-field"><span class="lbl">Barcode</span><span class="val">${escapeHtml(report.sample_id)}</span></div>
    <div class="info-field"><span class="lbl">Collected On</span><span class="val">${escapeHtml(firstTest.collected_on)}</span></div>
    <div class="info-field"><span class="lbl">Received On</span><span class="val">${escapeHtml(firstTest.received_on)}</span></div>
    <div class="info-field"><span class="lbl">Reported On</span><span class="val">${escapeHtml(report.verified_at)}</span></div>
    <div class="info-field"><span class="lbl">Specimen</span><span class="val">${escapeHtml(specimens)}</span></div>
    <div class="info-field"><span class="lbl">Consultant</span><span class="val">${escapeHtml(report.referred_by)}</span></div>
    <div class="info-field"><span class="lbl">Visit Type</span><span class="val">${escapeHtml(report.patient_type || 'N/A')}</span></div>
    <div class="info-field"><span class="lbl">Patient Mobile No</span><span class="val">${escapeHtml(report.patient_mobile || 'N/A')}</span></div>
  </div>

  ${testsHtml}

  <div class="tail">
    ${report.amendment ? `<div class="corrected"><b>CORRECTED REPORT — Version ${escapeHtml(report.amendment.version)}.</b> This report replaces the one issued earlier.${report.amendment.reason ? ` Reason: ${escapeHtml(report.amendment.reason)}` : ''}</div>` : ''}
    <div class="end-report">--End of Report--</div>

    ${report.authentication ? `
    <div class="esign">
      <div class="esign-left">
        ${/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(report.authentication.signature_image || '') ? `<img class="esign-img" src="${report.authentication.signature_image}" alt="Signature"/>` : ''}
        <div class="esign-name">${escapeHtml(report.authentication.signer_name)}</div>
        <div class="esign-line">${escapeHtml(report.authentication.designation || 'Authorized Signatory')}</div>
        <div class="esign-line">Reg. No.: ${escapeHtml(report.authentication.registration_no)}</div>
      </div>
      <div class="esign-right">
        <div class="esign-title">Electronically authenticated${report.authentication.state && report.authentication.state !== 'Authentic' ? ` — ${escapeHtml(report.authentication.state.toUpperCase())}` : ''}</div>
        <div class="esign-line">Signed on ${escapeHtml(report.authentication.signed_at)} using the signer's login credentials.</div>
        <div class="esign-line">Report seal: ${escapeHtml(report.authentication.hash_short)}</div>
        ${report.dsc ? '<div class="esign-line">Digitally signed with a Digital Signature Certificate — open this PDF in Adobe Reader to verify the signature.</div>' : ''}
        <div class="esign-line">Scan the QR code on this report to verify authenticity.</div>
      </div>
    </div>` : `
    <div class="signature">
      <div>LAB PATHOLOGIST</div>
      <div>${escapeHtml(report.verified_by_name || '')}</div>
    </div>`}

    <div class="note">
      <h3>Note</h3>
      <ul>
        <li>Abnormal results are highlighted.</li>
        <li>Results relate to the sample only.</li>
        <li>Kindly correlate clinically.</li>
      </ul>
    </div>

    <div class="footer">
      ${escapeHtml(hospitalName)} Helpline, ${escapeHtml(report.branch_contact || settings.phone || '')}
    </div>
  </div>

</body>
</html>`;
}

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserPromise;
}

// ─── Public entry point — SAME name/signature as the old PDFKit version, and
// still returns something callers can `.on('data', ...)` / `.on('end', ...)`
// on, exactly like a PDFKit document stream. Every existing call site
// (labController.js, patientController.js) keeps working unmodified.
export async function generateLabReportPDFStream(reportData) {
  // A report authorised with a doctor's Digital Signature Certificate is a fixed,
  // signed document: every copy is that same file, never a re-rendering. Either
  // handed in (the approval itself, still uncommitted) or found by sample.
  if (!reportData.dscSigner && !reportData.noServerSign) {
    const kept = reportData.signed_pdf || await storedSignedPdf(reportData.sample_id).catch(() => null);
    if (kept) return Readable.from([Buffer.from(kept)]);
  }

  let qrDataUri = null;
  if (reportData.report_url) {
    try {
      qrDataUri = await QRCode.toDataURL(reportData.report_url, {
        width: 140, margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' },
      });
    } catch (_) { /* report still renders without the QR */ }
  }

  const nameMap = await getParameterNameMap();
  // An authorised, untampered report is also signed with the Digital Signature
  // Certificate when one is configured (see dscSigner.js) — never a report
  // whose login-based authentication is altered or revoked.
  // noServerSign: the PDF is being prepared for the doctor's USB token to sign (Poxia DSC Agent).
  const dscOn = !reportData.noServerSign && (!!reportData.dscSigner || dscConfigured()) && reportData.authentication?.state === 'Authentic';
  const html = buildReportHtml({ ...reportData, dsc: dscOn }, qrDataUri, nameMap);

  // Puppeteer's headerTemplate is a separate, sandboxed render that repeats
  // on every page automatically — the only reliable way to keep the report
  // self-identifying on page 2+ once it runs long. It also shows on page 1
  // (there's no built-in way to skip just the first page) — which is exactly
  // what's wanted here: the logo/hospital-name/address/QR block used to live
  // once in the main document (page 1 only, see buildReportHtml); it now
  // lives ONLY in this template instead, so the identical header renders on
  // every page rather than appearing once and then being lost after a page
  // break. Inline styles + inline data-URI images only — this template can't
  // see the main document's stylesheet or fetch external resources.
  const settings = reportData.hospital_settings || {};
  const hospitalName = (reportData.branch_name || settings.hospital_name || 'MERIL HIMS HOSPITAL').toUpperCase();
  const address = reportData.branch_address || settings.address || '';
  const logoUri = logoDataUri(settings);
  const mrn = mrnValue(reportData.patient_reg_no, reportData.branch_district);
  const genderAge = [reportData.gender, reportData.age].filter(Boolean).join(', ');

  // Full page-1 size, not a shrunk-down summary — same font sizes/logo/QR
  // dimensions as the original once-only header, just repeating now.
  //
  // Puppeteer's headerTemplate strips <script> tags — Chromium only ever
  // auto-fills the specific pageNumber/totalPages/date/title/url classes as
  // static text; nothing else in there can run JS or apply conditional
  // logic. So there is no way to show this strip on page 2+ only and hide
  // it on page 1 — it will render identically on every page, full stop.
  // Kept as a slim one-line identifier (not the same boxed grid as page 1's
  // own info box right below it) specifically so it reads as a running
  // header, not a literal repeat of that box.
  //
  // Page 1 already shows patient-name/MRN/gender-age/barcode inside its own
  // full info box right below this same header, so that third line would be
  // a literal duplicate there. Puppeteer's headerTemplate can't vary by page
  // number itself (script tags in it are stripped — Chromium only
  // auto-fills the pageNumber/totalPages/etc. classes as static text), so a
  // single page.pdf() call can't show it on page 2+ only. Instead this
  // builds two header variants and renders the document twice — once for
  // page 1 (short header), once for the rest (full header) — then stitches
  // page 1 of the first render onto pages 2+ of the second with pdf-lib.
  // margin.top is identical in both calls, so both renders paginate the
  // body content identically; only the header banner drawn differs.
  const headerTop = `
    <div style="width:100%; padding:0 20px; box-sizing:border-box; font-family:Arial,Helvetica,sans-serif; color:#222;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:15px; border-bottom:2px solid #333; padding-bottom:8px;">
        <div style="display:flex; align-items:center; gap:15px; min-width:0;">
          ${logoUri ? `<img src="${logoUri}" style="width:60px; height:auto; flex-shrink:0;">` : ''}
          <div style="min-width:0;">
            <div style="font-size:22px; font-weight:700;">${escapeHtml(hospitalName)}</div>
            <div style="font-size:13px; color:#555; max-width:560px; margin-top:2px;">${escapeHtml(address)}</div>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:center; flex-shrink:0;">
          ${qrDataUri ? `<img src="${qrDataUri}" style="width:70px; height:70px;">
             <div style="font-size:9px; color:#666; text-align:center; margin-top:2px;">Scan to<br>Download Report</div>` : ''}
        </div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:baseline; padding-top:6px;">
        <div style="font-size:15px; font-weight:700; letter-spacing:0.5px;">DEPARTMENT OF LABORATORY MEDICINE</div>
        <div style="font-size:13px; font-style:italic;">Final Report</div>
      </div>`;

  const patientStripHtml = `
      <div style="display:flex; justify-content:space-between; font-size:10px; color:#333; padding-top:5px;">
        <span><b>${escapeHtml(reportData.patient_name || '')}</b> &nbsp; MRN: ${escapeHtml(mrn)} &nbsp; ${escapeHtml(genderAge)}</span>
        <span>Barcode: ${escapeHtml(reportData.sample_id || '')}</span>
      </div>`;

  const headerWithStrip = `${headerTop}${patientStripHtml}\n    </div>`;
  const headerNoStrip = `${headerTop}\n    </div>`;

  const pdfMargin = { top: '190px', bottom: '30px', left: '20px', right: '20px' };
  const footerTemplate = `
    <div style="width:100%; font-size:9px; color:#666; text-align:right; padding-right:20px;">
      Page <span class="pageNumber"></span> of <span class="totalPages"></span>
    </div>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const fullBuffer = await page.pdf({
      format: 'A4', printBackground: true, margin: pdfMargin,
      displayHeaderFooter: true, headerTemplate: headerWithStrip, footerTemplate,
    });

    const totalPages = (await PDFDocument.load(fullBuffer)).getPageCount();

    let finalBuffer = fullBuffer;
    if (totalPages > 1) {
      const page1Buffer = await page.pdf({
        format: 'A4', printBackground: true, margin: pdfMargin,
        displayHeaderFooter: true, headerTemplate: headerNoStrip, footerTemplate,
        pageRanges: '1',
      });
      finalBuffer = await stitchFirstPage(page1Buffer, fullBuffer);
    }

    if (dscOn) {
      finalBuffer = await signPdfIfConfigured(finalBuffer, {
        reason: `Authorised laboratory report — ${reportData.authentication.signer_name || 'authorised signatory'}`,
        location: hospitalName,
      }, reportData.dscSigner || null);
    }

    // Readable.from(buffer) iterates a Buffer byte-by-byte (it's iterable,
    // yielding individual numbers) rather than emitting it as one binary
    // chunk — wrapping in an array makes the whole buffer a single chunk.
    return Readable.from([finalBuffer]);
  } finally {
    await page.close();
  }
}

// Replaces page 1 of `restBuffer` with page 1 of `page1Buffer`, keeping
// pages 2+ from `restBuffer` untouched.
async function stitchFirstPage(page1Buffer, restBuffer) {
  const page1Doc = await PDFDocument.load(page1Buffer);
  const restDoc = await PDFDocument.load(restBuffer);
  const out = await PDFDocument.create();

  const [firstPage] = await out.copyPages(page1Doc, [0]);
  out.addPage(firstPage);

  const restIndices = restDoc.getPageIndices().slice(1);
  const restPages = await out.copyPages(restDoc, restIndices);
  restPages.forEach((p) => out.addPage(p));

  return Buffer.from(await out.save());
}
