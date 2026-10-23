import JsBarcode from 'jsbarcode';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Same 50x20mm label as Billing's "Print Barcode": CODE128 of the short ID
// (what analyzers/worklists key on), full sample ID and short ID as text,
// patient first name, tests. Returns false if the print window was blocked.
//   labels: [{ sample_id, patient_name, tests: [names] }]
export function printSampleLabels(labels) {
  const body = labels.map((l) => {
    const shortId = l.sample_id.slice(-4);
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, shortId, { format: 'CODE128', width: 2, height: 60, displayValue: false, margin: 0 });
    const first = String(l.patient_name || '').trim().split(/\s+/)[0];
    return `
      <div class="label">
        <div class="lab-id">${esc(l.sample_id)}</div>
        <img class="barcode-img" src="${canvas.toDataURL('image/png')}" alt="barcode"/>
        <div class="barcode-number">${esc(shortId)}</div>
        <div class="patient">${esc(first)}</div>
        <div class="test">${esc((l.tests || []).join(', '))}</div>
      </div>`;
  }).join('');

  const w = window.open('', '_blank', 'width=700,height=500');
  if (!w) return false;
  w.document.write(`<html><head><title>Sample Labels</title><style>
    @page { size: 50mm 20mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: white; }
    body { font-family: Arial, Helvetica, sans-serif; }
    .label { width: 50mm; height: 20mm; padding: 1.3mm 2mm; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 0.3mm; text-align: center; background: #fff; overflow: hidden; }
    .label:not(:last-child) { page-break-after: always; }
    .lab-id { font-size: 2.6mm; line-height: 1.05; font-weight: 700; max-width: 100%; }
    .barcode-img { display: block; height: 6mm; max-width: 90%; margin-top: 0.3mm; }
    .barcode-number { font-family: "Courier New", monospace; font-size: 2.1mm; line-height: 1; font-weight: 700; }
    .patient { font-size: 2.6mm; line-height: 1.05; font-weight: 700; text-transform: capitalize; margin-top: 0.4mm; max-width: 100%; }
    .test { font-size: 2.4mm; line-height: 1.1; font-weight: 700; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  </style></head><body>${body}</body></html>`);
  w.document.close();
  w.onload = () => { setTimeout(() => { w.print(); w.close(); }, 400); };
  return true;
}
