import { useState } from 'react';

export default function PostVisitSummary({ appt, soap, prescriptions, labOrders, icd10Codes, followUpDate, onClose }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const patientName = [appt?.first_name, appt?.last_name].filter(Boolean).join(' ') || 'Patient';
  const doctorName = localStorage.getItem('first_name') && localStorage.getItem('last_name')
    ? `Dr. ${localStorage.getItem('first_name')} ${localStorage.getItem('last_name')}`
    : localStorage.getItem('doctor_name') || 'Your Doctor';
  const hospital = localStorage.getItem('hospital_name') || 'Hospital';
  const todayStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const followUpStr = followUpDate
    ? new Date(followUpDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const diagnosis = icd10Codes?.length
    ? icd10Codes.map(c => `${c.code} – ${c.description}`).join('\n')
    : soap?.diagnosis || '';

  const buildWhatsAppText = () => {
    let msg = `🏥 *${hospital}*\n*Post-Visit Summary*\n────────────────────\n`;
    msg += `👤 *Patient:* ${patientName}\n`;
    msg += `📅 *Visit Date:* ${todayStr}\n`;
    msg += `👨‍⚕️ *Doctor:* ${doctorName}\n\n`;

    if (soap?.chiefComplaints) {
      msg += `📝 *Chief Complaints:*\n${soap.chiefComplaints}\n\n`;
    }

    if (diagnosis) {
      msg += `🔬 *Diagnosis:*\n${diagnosis}\n\n`;
    }

    if (prescriptions?.length) {
      msg += `💊 *Medicines Prescribed:*\n`;
      prescriptions.forEach((rx, i) => {
        const timing = [
          rx.morning ? 'M' : '', rx.afternoon ? 'A' : '',
          rx.evening ? 'E' : '', rx.night ? 'N' : ''
        ].filter(Boolean).join('-');
        msg += `${i + 1}. ${rx.medicineName || rx.medicine_name}`;
        if (rx.dosage) msg += ` – ${rx.dosage}`;
        if (timing) msg += ` (${timing})`;
        if (rx.duration) msg += ` for ${rx.duration}`;
        msg += '\n';
        if (rx.instructions) msg += `   ℹ️ ${rx.instructions}\n`;
      });
      msg += '\n';
    }

    if (labOrders?.length) {
      msg += `🧪 *Tests Ordered:*\n`;
      labOrders.forEach(t => { msg += `• ${t.test_name}\n`; });
      msg += '\n';
    }

    if (soap?.patientInstructions) {
      msg += `📋 *Doctor's Advice:*\n${soap.patientInstructions}\n\n`;
    }

    if (followUpStr) {
      msg += `📆 *Follow-up Date:* ${followUpStr}\n\n`;
    }

    msg += `────────────────────\n_Please bring this summary to your next visit._\n_${hospital}_`;
    return msg;
  };

  const handleWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(buildWhatsAppText())}`, '_blank');
  };

  const handleSMS = async () => {
    setSending(true);
    try {
      const token = localStorage.getItem('hims_token');
      await fetch('/api/consultations/send-summary-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          patientId: appt?.patient_id,
          regNo: appt?.reg_no,
          message: buildWhatsAppText().replace(/\*/g, '').replace(/🏥|👤|📅|👨‍⚕️|📝|🔬|💊|🧪|📋|📆|────────────────────/g, '').trim(),
        }),
      });
      setSent(true);
    } catch {
      // SMS not available; graceful fallback
    }
    setSending(false);
  };

  const handlePrint = () => {
    const style = `
      body{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:30px;color:#1a1a1a;font-size:12pt}
      .header{background:#4f46e5;color:#fff;padding:20px 24px;border-radius:12px;margin-bottom:20px}
      .header h1{margin:0 0 4px;font-size:1.2rem}
      .header p{margin:0;opacity:.85;font-size:0.8rem}
      .meta{display:flex;gap:24px;margin-bottom:20px;font-size:0.85rem;color:#475569}
      .section{margin-bottom:18px;border-left:4px solid #6366f1;padding-left:14px}
      .section h2{font-size:0.9rem;font-weight:700;color:#4f46e5;margin:0 0 8px;text-transform:uppercase;letter-spacing:.5px}
      .pill{display:inline-block;background:#eef2ff;color:#4f46e5;border-radius:99px;padding:2px 10px;font-size:0.78rem;margin:2px}
      .rx-table{width:100%;border-collapse:collapse;font-size:0.82rem;margin-top:6px}
      .rx-table th{background:#f1f5f9;padding:6px 10px;text-align:left;font-weight:600;font-size:0.75rem}
      .rx-table td{padding:6px 10px;border-bottom:1px solid #f1f5f9}
      .followup{background:#ecfdf5;border:2px solid #22c55e;border-radius:10px;padding:12px 16px;margin-top:18px;font-size:0.9rem}
      .footer{margin-top:24px;font-size:0.75rem;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
      @media print{body{margin:0;padding:20px}}
    `;

    const rxRows = (prescriptions || []).map(rx => {
      const timing = [
        rx.morning ? '☀️M' : '', rx.afternoon ? '🌤A' : '',
        rx.evening ? '🌆E' : '', rx.night ? '🌙N' : ''
      ].filter(Boolean).join(' ');
      return `<tr>
        <td>${rx.medicineName || rx.medicine_name || ''}</td>
        <td>${rx.dosage || ''}</td>
        <td>${timing}</td>
        <td>${rx.duration || ''}</td>
        <td>${rx.instructions || ''}</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Post-Visit Summary</title><style>${style}</style></head>
    <body>
      <div class="header">
        <h1>🏥 ${hospital}</h1>
        <p>Post-Visit Patient Summary</p>
      </div>
      <div class="meta">
        <span><strong>Patient:</strong> ${patientName}</span>
        <span><strong>Reg No:</strong> ${appt?.reg_no || '—'}</span>
        <span><strong>Visit Date:</strong> ${todayStr}</span>
        <span><strong>Doctor:</strong> ${doctorName}</span>
      </div>
      ${soap?.chiefComplaints ? `<div class="section"><h2>Complaints</h2><p>${soap.chiefComplaints.replace(/\n/g, '<br/>')}</p></div>` : ''}
      ${diagnosis ? `<div class="section"><h2>Diagnosis</h2>${diagnosis.split('\n').map(d => `<span class="pill">${d}</span>`).join('')}</div>` : ''}
      ${(prescriptions || []).length ? `
        <div class="section"><h2>Medicines</h2>
          <table class="rx-table"><thead><tr><th>Medicine</th><th>Dose</th><th>Timing</th><th>Duration</th><th>Instructions</th></tr></thead>
          <tbody>${rxRows}</tbody></table>
        </div>` : ''}
      ${(labOrders || []).length ? `
        <div class="section"><h2>Tests Ordered</h2>
          ${labOrders.map(t => `<span class="pill">🧪 ${t.test_name}</span>`).join('')}
        </div>` : ''}
      ${soap?.patientInstructions ? `<div class="section"><h2>Doctor's Advice</h2><p>${soap.patientInstructions.replace(/\n/g, '<br/>')}</p></div>` : ''}
      ${followUpStr ? `<div class="followup">📆 <strong>Follow-up appointment:</strong> ${followUpStr} — Please visit ${hospital} on this date.</div>` : ''}
      <div class="footer">${hospital} • ${todayStr} • Reg No: ${appt?.reg_no || '—'} | This is a computer-generated summary for patient reference only.</div>
    </body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="pvs-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="pvs-modal">
          <div className="pvs-header">
            <div>
              <span>📋 Post-Visit Summary</span>
              <span className="pvs-sub">Patient-friendly summary of today's consultation</span>
            </div>
            <button onClick={onClose}>✕</button>
          </div>

          <div className="pvs-body">
            {/* Patient info */}
            <div className="pvs-card pvs-card--blue">
              <div className="pvs-avatar">{patientName.charAt(0)}</div>
              <div>
                <div className="pvs-name">{patientName}</div>
                <div className="pvs-meta">{appt?.reg_no} &nbsp;|&nbsp; {todayStr} &nbsp;|&nbsp; {doctorName}</div>
              </div>
            </div>

            {/* Diagnosis */}
            {(icd10Codes?.length > 0 || soap?.diagnosis) && (
              <div className="pvs-section">
                <div className="pvs-section-title">🔬 Diagnosis</div>
                {icd10Codes?.length > 0
                  ? icd10Codes.map((c, i) => (
                    <span key={i} className="pvs-chip pvs-chip--blue">{c.code} – {c.description}</span>
                  ))
                  : <p className="pvs-text">{soap.diagnosis}</p>
                }
              </div>
            )}

            {/* Medicines */}
            {prescriptions?.length > 0 && (
              <div className="pvs-section">
                <div className="pvs-section-title">💊 Medicines Prescribed</div>
                {prescriptions.map((rx, i) => {
                  const timing = [
                    rx.morning ? 'Morning' : '', rx.afternoon ? 'Afternoon' : '',
                    rx.evening ? 'Evening' : '', rx.night ? 'Night' : ''
                  ].filter(Boolean).join(', ');
                  return (
                    <div key={i} className="pvs-rx-row">
                      <div className="pvs-rx-name">{rx.medicineName || rx.medicine_name}</div>
                      <div className="pvs-rx-meta">
                        {rx.dosage && <span>{rx.dosage}</span>}
                        {timing && <span>• {timing}</span>}
                        {rx.duration && <span>• {rx.duration}</span>}
                      </div>
                      {rx.instructions && <div className="pvs-rx-instr">ℹ️ {rx.instructions}</div>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Lab tests */}
            {labOrders?.length > 0 && (
              <div className="pvs-section">
                <div className="pvs-section-title">🧪 Tests to be done</div>
                <div className="pvs-chips">
                  {labOrders.map((t, i) => (
                    <span key={i} className="pvs-chip pvs-chip--teal">{t.test_name}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Doctor advice */}
            {soap?.patientInstructions && (
              <div className="pvs-section">
                <div className="pvs-section-title">📋 Doctor's Advice</div>
                <p className="pvs-text">{soap.patientInstructions}</p>
              </div>
            )}

            {/* Follow-up */}
            {followUpStr && (
              <div className="pvs-followup">
                📆 <strong>Please return on {followUpStr}</strong> for your follow-up appointment at {hospital}.
              </div>
            )}
          </div>

          <div className="pvs-footer">
            <button className="pvs-btn pvs-btn--wa" onClick={handleWhatsApp}>📱 Share via WhatsApp</button>
            {sent
              ? <button className="pvs-btn pvs-btn--sms pvs-btn--done">✓ SMS Sent</button>
              : <button className="pvs-btn pvs-btn--sms" onClick={handleSMS} disabled={sending}>{sending ? 'Sending…' : '💬 Send SMS'}</button>
            }
            <button className="pvs-btn pvs-btn--print" onClick={handlePrint}>🖨 Print Summary</button>
          </div>
        </div>
      </div>
    </>
  );
}

const CSS = `
  .pvs-overlay {
    position: fixed; inset: 0; background: rgba(15,23,42,.6); z-index: 1100;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(2px);
  }
  .pvs-modal {
    background: #fff; border-radius: 16px; width: 100%; max-width: 580px;
    box-shadow: 0 24px 80px rgba(0,0,0,.3); display: flex; flex-direction: column;
    max-height: 90vh; overflow: hidden; font-family: 'Inter', system-ui, sans-serif;
  }
  .pvs-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; background: linear-gradient(135deg,#0f766e,#0d9488);
    color: #fff;
  }
  .pvs-header > div { display: flex; flex-direction: column; gap: 2px; }
  .pvs-header span:first-child { font-weight: 600; font-size: 0.95rem; }
  .pvs-sub { font-size: 0.75rem; opacity: .75; }
  .pvs-header button {
    background: rgba(255,255,255,.2); border: none; border-radius: 50%;
    width: 28px; height: 28px; color: #fff; cursor: pointer; font-size: 0.85rem; align-self: flex-start;
  }
  .pvs-body { padding: 16px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; flex: 1; }
  .pvs-card {
    display: flex; align-items: center; gap: 14px;
    padding: 14px; border-radius: 12px; border: 1.5px solid #e0f2fe;
    background: linear-gradient(135deg,#f0f9ff,#e0f2fe);
  }
  .pvs-avatar {
    width: 44px; height: 44px; border-radius: 50%; background: #0369a1;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 1.1rem; color: #fff; flex-shrink: 0;
  }
  .pvs-name { font-weight: 700; font-size: 1rem; color: #0c4a6e; }
  .pvs-meta { font-size: 0.78rem; color: #0369a1; margin-top: 2px; }
  .pvs-section { display: flex; flex-direction: column; gap: 6px; }
  .pvs-section-title { font-size: 0.78rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .5px; }
  .pvs-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .pvs-chip { padding: 3px 10px; border-radius: 99px; font-size: 0.78rem; font-weight: 500; }
  .pvs-chip--blue { background: #eef2ff; color: #4f46e5; }
  .pvs-chip--teal { background: #f0fdfa; color: #0f766e; }
  .pvs-text { font-size: 0.85rem; color: #334155; line-height: 1.6; margin: 0; white-space: pre-line; }
  .pvs-rx-row {
    background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 8px;
    padding: 8px 12px; display: flex; flex-direction: column; gap: 2px;
  }
  .pvs-rx-name { font-weight: 600; font-size: 0.88rem; color: #1e293b; }
  .pvs-rx-meta { font-size: 0.78rem; color: #64748b; display: flex; gap: 6px; flex-wrap: wrap; }
  .pvs-rx-instr { font-size: 0.75rem; color: #7c3aed; }
  .pvs-followup {
    background: #f0fdf4; border: 2px solid #22c55e; border-radius: 10px;
    padding: 12px 16px; font-size: 0.88rem; color: #15803d;
  }
  .pvs-footer {
    display: flex; gap: 8px; padding: 14px 20px; border-top: 1.5px solid #e2e8f0;
    background: #f8fafc; justify-content: flex-end;
  }
  .pvs-btn {
    padding: 9px 16px; border-radius: 9px; font-size: 0.82rem; font-weight: 600;
    cursor: pointer; transition: all .15s; border: none;
  }
  .pvs-btn--wa { background: #dcfce7; color: #15803d; border: 1.5px solid #16a34a; }
  .pvs-btn--wa:hover { background: #bbf7d0; }
  .pvs-btn--sms { background: #eff6ff; color: #1d4ed8; border: 1.5px solid #3b82f6; }
  .pvs-btn--sms:hover { background: #dbeafe; }
  .pvs-btn--sms:disabled { opacity: .6; cursor: not-allowed; }
  .pvs-btn--done { background: #f0fdf4; color: #15803d; border: 1.5px solid #22c55e; }
  .pvs-btn--print { background: #6366f1; color: #fff; }
  .pvs-btn--print:hover { opacity: .88; }
`;
