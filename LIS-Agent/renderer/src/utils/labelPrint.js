import JsBarcode from 'jsbarcode';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function openPrint(title, html, size) {
  const w = window.open('', '_blank', 'width=700,height=600');
  if (!w) return false;
  w.document.write(`<html><head><title>${esc(title)}</title><style>@page{size:${size};margin:0}*{box-sizing:border-box}html,body{margin:0;background:#fff;font-family:Arial,sans-serif}</style></head><body>${html}</body></html>`);
  w.document.close();
  w.onload = () => { setTimeout(() => { w.print(); w.close(); }, 400); };
  return true;
}

const barcode = (text, height = 60) => {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, String(text), { format: 'CODE128', width: 2, height, displayValue: false, margin: 0 });
  return canvas.toDataURL('image/png');
};

// The same 50x20mm sample label as the web Billing "Print Barcode".
export function printSampleLabels(labels) {
  const html = labels.map(({ sample_id, patient_name, tests }) => {
    const shortId = String(sample_id).slice(-4);
    return `<div style="width:50mm;height:20mm;padding:1.3mm 2mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.3mm;text-align:center;overflow:hidden;page-break-after:always">
      <div style="font-size:2.6mm;line-height:1.05;font-weight:700">${esc(sample_id)}</div>
      <img style="display:block;height:6mm;max-width:90%;margin-top:.3mm" src="${barcode(shortId)}"/>
      <div style="font-family:'Courier New',monospace;font-size:2.1mm;line-height:1;font-weight:700">${esc(shortId)}</div>
      <div style="font-size:2.6mm;line-height:1.05;font-weight:700;text-transform:capitalize;margin-top:.4mm">${esc(String(patient_name || '').trim().split(/\s+/)[0])}</div>
      <div style="font-size:2.4mm;line-height:1.1;font-weight:700;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc((tests || []).join(', '))}</div>
    </div>`;
  }).join('');
  return openPrint('Sample Labels', html, '50mm 20mm');
}

// Slip handed to a patient registered offline: it carries the provisional ID,
// which is not a CRN — the official one is issued when the registration syncs.
export function printProvisionalSlip({ provisionalId, name, telephone, registeredAt }) {
  const when = new Date(registeredAt || Date.now()).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const html = `<div style="width:90mm;padding:6mm;text-align:center">
    <div style="font-size:4mm;font-weight:700">Karnataka LIMS</div>
    <div style="font-size:3mm;color:#444;margin-bottom:3mm">Registration slip — PROVISIONAL</div>
    <div style="font-size:5mm;font-weight:800">${esc(name)}</div>
    ${telephone ? `<div style="font-size:3.2mm;color:#333">${esc(telephone)}</div>` : ''}
    <img style="display:block;margin:4mm auto 1mm;height:14mm;max-width:100%" src="${barcode(provisionalId, 80)}"/>
    <div style="font-family:'Courier New',monospace;font-size:4.2mm;font-weight:700">${esc(provisionalId)}</div>
    <div style="font-size:2.8mm;color:#333;margin-top:3mm;line-height:1.35">Registered offline on ${esc(when)}.<br/>This is a temporary ID, not a CRN. Your official CRN is issued when this registration reaches the server — the desk will give it to you.</div>
  </div>`;
  return openPrint('Registration slip', html, '90mm auto');
}
