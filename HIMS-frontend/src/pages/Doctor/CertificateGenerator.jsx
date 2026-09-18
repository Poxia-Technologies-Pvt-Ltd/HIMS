import { useState } from 'react';

const CERT_TYPES = [
  { id: 'sick_leave',  label: 'Sick Leave Certificate',   icon: '🏥' },
  { id: 'fitness',     label: 'Fitness Certificate',       icon: '✅' },
  { id: 'referral',    label: 'Referral Letter',           icon: '📨' },
  { id: 'med_summary', label: 'Medical Summary',           icon: '📋' },
];

export default function CertificateGenerator({ appt, soap, icd10Codes, onClose }) {
  const [certType, setCertType] = useState('sick_leave');
  const [leaveDays, setLeaveDays] = useState('3');
  const [referTo, setReferTo] = useState('');
  const [referDept, setReferDept] = useState('');
  const [referReason, setReferReason] = useState('');
  const [fitnessPurpose, setFitnessPurpose] = useState('return to work');
  const [customNote, setCustomNote] = useState('');

  const hospital = localStorage.getItem('hospital_name') || 'Hospital';
  const doctorName = localStorage.getItem('first_name') && localStorage.getItem('last_name')
    ? `Dr. ${localStorage.getItem('first_name')} ${localStorage.getItem('last_name')}`
    : localStorage.getItem('doctor_name') || 'Doctor';

  const patientName = [appt?.first_name, appt?.last_name].filter(Boolean).join(' ') || '—';
  const patientAge = appt?.dob
    ? Math.floor((Date.now() - new Date(appt.dob)) / (365.25 * 24 * 3600 * 1000)) + ' years'
    : '';
  const todayStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const diagnosis = soap?.diagnosis || icd10Codes?.map(c => c.description).join(', ') || 'as per medical examination';

  const buildHTML = () => {
    const style = `
      body{font-family:'Times New Roman',Times,serif;margin:0;padding:30px;color:#1a1a1a;font-size:13pt}
      .header{text-align:center;border-bottom:3px double #1a1a1a;padding-bottom:14px;margin-bottom:20px}
      .hosp-name{font-size:1.6rem;font-weight:700;text-transform:uppercase;letter-spacing:1px}
      .cert-title{font-size:1.15rem;font-weight:700;text-decoration:underline;text-transform:uppercase;margin:18px 0 14px;text-align:center;letter-spacing:1px}
      .cert-no{text-align:right;font-size:0.85rem;color:#555;margin-bottom:8px}
      .body-text{line-height:2;text-align:justify}
      .field{display:inline-block;border-bottom:1px solid #1a1a1a;min-width:120px;text-align:center;font-weight:700}
      .footer{margin-top:50px;display:flex;justify-content:space-between;align-items:flex-end}
      .sig{border-top:1px solid #1a1a1a;min-width:200px;text-align:center;padding-top:6px;font-size:0.88rem}
      .seal{width:80px;height:80px;border:2px solid #1a1a1a;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.65rem;text-align:center;padding:6px;color:#555;box-sizing:border-box}
      .note{font-size:0.8rem;color:#555;margin-top:14px;border-top:1px solid #ccc;padding-top:8px}
      @media print{body{margin:0;padding:20px}}
    `;

    const certNo = `CERT-${Date.now().toString().slice(-6)}`;
    const header = `<div class="header"><div class="hosp-name">${hospital}</div><div style="font-size:0.85rem;color:#555">Medical Certificate</div></div>`;
    const certNoEl = `<div class="cert-no">Cert No: ${certNo} &nbsp;|&nbsp; Date: ${todayStr}</div>`;

    let body = '';
    let title = '';

    if (certType === 'sick_leave') {
      const fromDate = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      const toDate = new Date(Date.now() + (parseInt(leaveDays) - 1) * 86400000).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      title = 'Medical Certificate (Sick Leave)';
      body = `<p class="body-text">
        This is to certify that <span class="field">${patientName}</span>${patientAge ? ', aged ' + patientAge : ''},
        Reg. No. <span class="field">${appt?.reg_no || '—'}</span>, was examined by me today and found to be
        suffering from <span class="field">${diagnosis}</span>.
      </p>
      <p class="body-text">
        In my opinion, the patient is advised complete rest and is unfit to attend duties from
        <span class="field">${fromDate}</span> to <span class="field">${toDate}</span>
        (i.e., for <span class="field">${leaveDays}</span> day(s)).
      </p>
      <p class="body-text">
        The patient may resume duties on <span class="field">${new Date(Date.now() + parseInt(leaveDays) * 86400000).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</span>, subject to satisfactory recovery.
      </p>
      ${customNote ? `<p class="body-text"><em>Note: ${customNote}</em></p>` : ''}`;
    } else if (certType === 'fitness') {
      title = 'Fitness Certificate';
      body = `<p class="body-text">
        This is to certify that <span class="field">${patientName}</span>${patientAge ? ', aged ' + patientAge : ''},
        Reg. No. <span class="field">${appt?.reg_no || '—'}</span>, was examined by me on ${todayStr}.
      </p>
      <p class="body-text">
        After thorough clinical examination, I certify that the above-named person is
        <strong>medically fit</strong> to <span class="field">${fitnessPurpose}</span>.
      </p>
      <p class="body-text">
        No contraindication for the same was found at the time of examination.
      </p>
      ${customNote ? `<p class="body-text"><em>Note: ${customNote}</em></p>` : ''}`;
    } else if (certType === 'referral') {
      title = 'Referral Letter';
      body = `<p class="body-text">Dear ${referTo ? '<span class="field">' + referTo + '</span>' : 'Colleague'},</p>
      <p class="body-text">
        I am referring <span class="field">${patientName}</span>${patientAge ? ', aged ' + patientAge : ''},
        Reg. No. <span class="field">${appt?.reg_no || '—'}</span>, to your
        <span class="field">${referDept || 'department'}</span> for further evaluation and management.
      </p>
      <p class="body-text">
        <strong>Presenting complaint:</strong> ${soap?.chiefComplaints || '—'}<br/>
        <strong>Diagnosis / Impression:</strong> ${diagnosis}<br/>
        ${soap?.examination ? `<strong>Examination findings:</strong> ${soap.examination.substring(0, 300)}<br/>` : ''}
        <strong>Reason for referral:</strong> ${referReason || 'For specialist opinion and management'}
      </p>
      <p class="body-text">
        Kindly review the patient and guide further management. Your valued opinion is solicited.
      </p>
      ${customNote ? `<p class="body-text"><em>Additional notes: ${customNote}</em></p>` : ''}`;
    } else if (certType === 'med_summary') {
      title = 'Medical Summary';
      body = `<p class="body-text">
        This is to certify that <span class="field">${patientName}</span>${patientAge ? ', aged ' + patientAge : ''},
        Gender: <span class="field">${appt?.gender || '—'}</span>,
        Reg. No. <span class="field">${appt?.reg_no || '—'}</span>,
        was examined at this hospital on <span class="field">${todayStr}</span>.
      </p>
      ${soap?.chiefComplaints ? `<p class="body-text"><strong>Presenting Complaints:</strong><br/>${soap.chiefComplaints}</p>` : ''}
      ${soap?.examination ? `<p class="body-text"><strong>Clinical Examination:</strong><br/>${soap.examination}</p>` : ''}
      <p class="body-text"><strong>Diagnosis:</strong> ${diagnosis}</p>
      ${soap?.history ? `<p class="body-text"><strong>History:</strong><br/>${soap.history.substring(0, 400)}</p>` : ''}
      ${customNote ? `<p class="body-text"><strong>Additional Information:</strong><br/>${customNote}</p>` : ''}
      <p class="body-text">
        This certificate is issued on the request of the patient / guardian for official purposes.
      </p>`;
    }

    const footer = `<div class="footer">
      <div class="seal">HOSPITAL<br/>SEAL</div>
      <div class="sig">${doctorName}<br/>Medical Officer<br/>${hospital}</div>
    </div>
    <div class="note">
      This is a computer-generated certificate. Valid only with the official stamp and signature of the issuing doctor.<br/>
      Reg No: ${appt?.reg_no || '—'} | ${todayStr}
    </div>`;

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${style}</style></head>
    <body>${header}${certNoEl}<div class="cert-title">${title}</div>${body}${footer}</body></html>`;
  };

  const handlePrint = () => {
    const w = window.open('', '_blank');
    w.document.write(buildHTML());
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  const handleWhatsApp = () => {
    let msg = '';
    if (certType === 'sick_leave') {
      msg = `*Sick Leave Certificate*\nPatient: ${patientName}\nDiagnosis: ${diagnosis}\nRest advised: ${leaveDays} day(s) from ${new Date().toLocaleDateString('en-IN')}\nIssued by: ${doctorName}, ${hospital}`;
    } else if (certType === 'fitness') {
      msg = `*Fitness Certificate*\nPatient: ${patientName}\nFit for: ${fitnessPurpose}\nDate: ${todayStr}\nIssued by: ${doctorName}, ${hospital}`;
    } else {
      msg = `*${CERT_TYPES.find(c => c.id === certType)?.label}*\nPatient: ${patientName}\nDate: ${todayStr}\nIssued by: ${doctorName}, ${hospital}`;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="cg-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="cg-modal">
          <div className="cg-header">
            <span>📄 Medical Certificate Generator</span>
            <button onClick={onClose}>✕</button>
          </div>

          <div className="cg-body">
            {/* Type selector */}
            <div className="cg-type-grid">
              {CERT_TYPES.map(t => (
                <button key={t.id}
                  className={`cg-type-btn ${certType === t.id ? 'cg-type-btn--active' : ''}`}
                  onClick={() => setCertType(t.id)}
                >
                  <span className="cg-type-icon">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>

            {/* Patient row (read-only) */}
            <div className="cg-info-row">
              <span><strong>Patient:</strong> {patientName}</span>
              <span><strong>Reg No:</strong> {appt?.reg_no}</span>
              <span><strong>Age/Gender:</strong> {patientAge} / {appt?.gender || '—'}</span>
              <span><strong>Date:</strong> {todayStr}</span>
            </div>

            {/* Diagnosis row */}
            <div className="cg-field">
              <label>Diagnosis</label>
              <input value={diagnosis} readOnly className="cg-input cg-input--readonly" />
            </div>

            {/* Type-specific fields */}
            {certType === 'sick_leave' && (
              <div className="cg-fields">
                <div className="cg-field">
                  <label>Number of Leave Days</label>
                  <div className="cg-day-btns">
                    {['1', '2', '3', '5', '7', '10', '14'].map(d => (
                      <button key={d}
                        className={`cg-day-btn ${leaveDays === d ? 'cg-day-btn--active' : ''}`}
                        onClick={() => setLeaveDays(d)}
                      >{d}</button>
                    ))}
                    <input type="number" min="1" max="90" value={leaveDays}
                      onChange={e => setLeaveDays(e.target.value)}
                      className="cg-input" style={{ width: 70 }}
                    />
                  </div>
                </div>
              </div>
            )}

            {certType === 'fitness' && (
              <div className="cg-field">
                <label>Fit for Purpose</label>
                <div className="cg-purpose-btns">
                  {['return to work', 'school attendance', 'travel', 'sports/exercise', 'employment medical'].map(p => (
                    <button key={p}
                      className={`cg-day-btn ${fitnessPurpose === p ? 'cg-day-btn--active' : ''}`}
                      onClick={() => setFitnessPurpose(p)}
                    >{p}</button>
                  ))}
                </div>
                <input className="cg-input" value={fitnessPurpose}
                  onChange={e => setFitnessPurpose(e.target.value)}
                  placeholder="Or type custom purpose…" style={{ marginTop: 8 }}
                />
              </div>
            )}

            {certType === 'referral' && (
              <div className="cg-fields">
                <div className="cg-field">
                  <label>Refer To (Doctor/Hospital Name)</label>
                  <input className="cg-input" value={referTo} onChange={e => setReferTo(e.target.value)} placeholder="Dr. / Hospital name…" />
                </div>
                <div className="cg-field">
                  <label>Department / Specialty</label>
                  <input className="cg-input" value={referDept} onChange={e => setReferDept(e.target.value)} placeholder="e.g. Cardiology, Orthopaedics…" />
                </div>
                <div className="cg-field">
                  <label>Reason for Referral</label>
                  <textarea className="cg-input" rows={2} value={referReason} onChange={e => setReferReason(e.target.value)} placeholder="Reason / urgency…" />
                </div>
              </div>
            )}

            <div className="cg-field">
              <label>Additional Notes (optional)</label>
              <textarea className="cg-input" rows={2} value={customNote}
                onChange={e => setCustomNote(e.target.value)}
                placeholder="Any additional instructions or notes for this certificate…"
              />
            </div>
          </div>

          <div className="cg-footer">
            <button className="cg-wa-btn" onClick={handleWhatsApp}>📱 Share on WhatsApp</button>
            <button className="cg-print-btn" onClick={handlePrint}>🖨 Print / Download</button>
          </div>
        </div>
      </div>
    </>
  );
}

const CSS = `
  .cg-overlay {
    position: fixed; inset: 0; background: rgba(15,23,42,.6); z-index: 1100;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(2px);
  }
  .cg-modal {
    background: #fff; border-radius: 16px; width: 100%; max-width: 640px;
    box-shadow: 0 24px 80px rgba(0,0,0,.3); display: flex; flex-direction: column;
    max-height: 92vh; overflow: hidden; font-family: 'Inter', system-ui, sans-serif;
  }
  .cg-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; background: linear-gradient(135deg,#312e81,#4f46e5);
    color: #fff; font-weight: 600; font-size: 0.95rem;
  }
  .cg-header button {
    background: rgba(255,255,255,.2); border: none; border-radius: 50%;
    width: 28px; height: 28px; color: #fff; cursor: pointer; font-size: 0.85rem;
  }
  .cg-body { padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; flex: 1; }
  .cg-type-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .cg-type-btn {
    display: flex; align-items: center; gap: 8px; padding: 10px 14px;
    border: 1.5px solid #e2e8f0; border-radius: 10px; background: #f8fafc;
    font-size: 0.82rem; color: #475569; cursor: pointer; transition: all .15s; text-align: left;
  }
  .cg-type-btn:hover { border-color: #4f46e5; color: #4f46e5; }
  .cg-type-btn--active { border-color: #4f46e5; background: #eef2ff; color: #4f46e5; font-weight: 600; }
  .cg-type-icon { font-size: 1.1rem; }
  .cg-info-row {
    display: flex; flex-wrap: wrap; gap: 10px; background: #f8fafc;
    border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 10px 14px;
    font-size: 0.8rem; color: #475569;
  }
  .cg-field { display: flex; flex-direction: column; gap: 5px; }
  .cg-field label { font-size: 0.75rem; font-weight: 600; color: #64748b; }
  .cg-input {
    padding: 8px 12px; border: 1.5px solid #e2e8f0; border-radius: 8px;
    font-size: 0.85rem; font-family: inherit; outline: none; resize: vertical;
    transition: border-color .15s; width: 100%; box-sizing: border-box;
  }
  .cg-input:focus { border-color: #6366f1; }
  .cg-input--readonly { background: #f8fafc; color: #475569; }
  .cg-fields { display: flex; flex-direction: column; gap: 12px; }
  .cg-day-btns, .cg-purpose-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
  .cg-day-btn {
    padding: 5px 12px; border: 1.5px solid #e2e8f0; border-radius: 99px;
    background: #f8fafc; font-size: 0.78rem; color: #475569; cursor: pointer; transition: all .15s;
  }
  .cg-day-btn:hover { border-color: #4f46e5; color: #4f46e5; }
  .cg-day-btn--active { background: #4f46e5; border-color: #4f46e5; color: #fff; }
  .cg-footer {
    display: flex; gap: 10px; padding: 14px 20px; border-top: 1.5px solid #e2e8f0;
    background: #f8fafc; justify-content: flex-end;
  }
  .cg-wa-btn {
    padding: 9px 18px; border: 1.5px solid #16a34a; border-radius: 9px;
    background: #f0fdf4; color: #15803d; font-size: 0.85rem; font-weight: 600; cursor: pointer;
    transition: all .15s;
  }
  .cg-wa-btn:hover { background: #dcfce7; }
  .cg-print-btn {
    padding: 9px 18px; border: none; border-radius: 9px;
    background: #4f46e5; color: #fff; font-size: 0.85rem; font-weight: 600; cursor: pointer;
    transition: opacity .15s;
  }
  .cg-print-btn:hover { opacity: .88; }
`;
