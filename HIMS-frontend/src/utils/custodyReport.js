const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (t) => new Date(t).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const gap = (s) => (s == null ? '' : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);

// Opens a printable chain-of-custody report: every step with who, where and
// when, and the time elapsed since the previous step.
export function printCustodyReport(r) {
  const rows = r.steps.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(when(s.created_at))}</td>
      <td><b>${esc(s.event_type === 'Registered' ? 'Tracked' : s.event_type)}</b>${s.sample_id !== r.sample_id ? `<div class="s">${esc(s.sample_id.slice(r.sample_id.length))}</div>` : ''}</td>
      <td>${esc(s.actor_name || (s.auto ? 'System' : '—'))}<div class="s">${esc(s.actor_role || '')}</div></td>
      <td>${esc(s.station || '—')}${s.location ? `<div class="s">Placed: ${esc(s.location)}</div>` : ''}</td>
      <td>${esc(s.note || '')}</td>
      <td>${esc(gap(s.seconds_since_previous))}</td>
    </tr>`).join('');
  const w = window.open('', '_blank', 'width=1000,height=800');
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><title>Chain of custody — ${esc(r.sample_id)}</title><style>
    body{font-family:Arial,sans-serif;margin:28px;color:#0f172a}
    h1{font-size:20px;margin:0 0 4px}.meta{font-size:12.5px;color:#475569;margin-bottom:18px;line-height:1.6}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{text-align:left;background:#f1f5f9;border:1px solid #cbd5e1;padding:7px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
    td{border:1px solid #cbd5e1;padding:7px 8px;vertical-align:top}.s{font-size:10.5px;color:#64748b}
    .foot{margin-top:16px;font-size:11px;color:#64748b}
  </style></head><body>
    <h1>Chain of Custody Report</h1>
    <div class="meta">
      <b>Sample ID:</b> ${esc(r.sample_id)} &nbsp;·&nbsp; <b>Current stage:</b> ${esc(r.stage)}<br/>
      ${r.patient_name ? `<b>Patient:</b> ${esc(r.patient_name)} (${esc(r.reg_no)}) &nbsp;·&nbsp; ` : ''}<b>Facility:</b> ${esc(r.facility?.branch_name || '—')}
    </div>
    <table><thead><tr><th>#</th><th>Date &amp; time</th><th>Step</th><th>Handled by</th><th>Location</th><th>Remarks</th><th>Since previous</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="foot">Generated ${esc(when(r.generated_at))}. This record is append-only; entries cannot be edited or removed.</div>
  </body></html>`);
  w.document.close();
  w.onload = () => setTimeout(() => w.print(), 300);
  return true;
}
