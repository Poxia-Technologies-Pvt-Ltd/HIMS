import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import '../assets/CSS/VerifyReport.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

const COPY = {
  Authentic: { title: 'Authentic report', text: 'This report matches what the doctor electronically signed. It has not been changed since.' },
  Altered: { title: 'Report has been altered', text: 'The content of this report no longer matches what the doctor signed. Do not rely on it — contact the laboratory.' },
  Revoked: { title: 'Signature revoked', text: 'The signature on this report has been withdrawn. Contact the laboratory for the current version.' },
};

// Public page opened from the QR code on a printed / shared report.
export default function VerifyReport() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/lab/report-verify/${encodeURIComponent(id)}?k=${encodeURIComponent(params.get('k') || '')}`)
      .then((r) => r.json())
      .then((d) => (d.success ? setData(d) : setError(d.message || 'This verification link is not valid.')))
      .catch(() => setError('Could not reach the verification service.'));
  }, [id, params]);

  const copy = data && COPY[data.state];
  const fmt = (t) => new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="vr-page">
      <div className="vr-card">
        <div className="vr-brand">Laboratory Report Verification</div>
        {!data && !error && <div className="vr-loading">Checking report…</div>}
        {error && <div className="vr-status bad"><h1>Cannot verify</h1><p>{error}</p></div>}
        {data && (
          <>
            <div className={`vr-status ${data.state === 'Authentic' ? 'ok' : 'bad'}`}>
              <div className="vr-mark">{data.state === 'Authentic' ? '✓' : '!'}</div>
              <h1>{copy.title}</h1>
              <p>{copy.text}</p>
            </div>
            <dl className="vr-details">
              <div><dt>Authorized by</dt><dd>{data.signer.name}{data.signer.designation ? `, ${data.signer.designation}` : ''}</dd></div>
              <div><dt>Registration no.</dt><dd>{data.signer.registration_no}</dd></div>
              <div><dt>Signed on</dt><dd>{fmt(data.signed_at)}</dd></div>
              <div><dt>Signature method</dt><dd>{data.signer.method}</dd></div>
              {data.dsc && <div><dt>Digital certificate</dt><dd>{data.dsc.signer}{data.dsc.issuer ? ` — issued by ${String(data.dsc.issuer).replace(/^CN=/, "").split(",")[0]}` : ""}. Open the report PDF in Adobe Reader to check the digital signature.</dd></div>}
              {data.facility && <div><dt>Laboratory</dt><dd>{data.facility}</dd></div>}
              {data.test_name && <div><dt>Test</dt><dd>{data.test_name}</dd></div>}
              {data.patient && <div><dt>Patient</dt><dd>{data.patient.name} {data.patient.reg_no ? `(${data.patient.reg_no})` : ''}</dd></div>}
              <div><dt>Report seal</dt><dd className="vr-mono">{data.content_hash.slice(0, 32).toUpperCase()}…</dd></div>
            </dl>
            {data.state === 'Authentic' && <a className="vr-btn" href={data.report_url} target="_blank" rel="noreferrer">View report</a>}
          </>
        )}
      </div>
    </div>
  );
}
