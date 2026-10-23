import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Search, RefreshCw, FlaskConical, ScanLine, Stethoscope, Clock } from 'lucide-react';
import { PageHead, Badge, Empty } from '../../components/hmis/ui';
import { get, money } from '../../utils/hmisApi';
import Billing from './Billing';

// Billing desk: everyone with something waiting to be billed (consultation
// fees, the doctor's tests and X-rays), and a search for anyone else. Picking
// a patient opens the bill with their pending charges already on it.
const KIND_ICON = { Laboratory: FlaskConical, Imaging: ScanLine, Consultation: Stethoscope };
const since = (iso) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return min < 60 ? `${min} min` : min < 1440 ? `${Math.floor(min / 60)} h ${min % 60} m` : `${Math.floor(min / 1440)} d`;
};

export default function BillingDesk() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [patient, setPatient] = useState(null);
  const searchRef = useRef(null);

  const load = useCallback(async () => {
    const r = await get('/api/billing/charges/queue');
    if (r.ok) setQueue(r.data.queue || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setFound([]); return undefined; }
    const t = setTimeout(async () => {
      const r = await get(`/api/patients/search?q=${encodeURIComponent(term)}`);
      if (r.ok) setFound(r.data.patients || []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !patient && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [patient]);

  if (patient) {
    return (
      <div>
        <div className="hm-page" style={{ paddingBottom: 0 }}>
          <div className="hm-toolbar">
            <button type="button" className="hm-btn" onClick={() => { setPatient(null); load(); }}><ArrowLeft size={15} /> Back to billing queue</button>
            <strong>{patient.name}</strong>
            <span className="hm-muted">{patient.reg_no}{patient.phone ? ` · ${patient.phone}` : ''}</span>
          </div>
        </div>
        <Billing key={patient.id} regNo={patient.reg_no} patientId={patient.id} />
      </div>
    );
  }

  const pick = (p) => setPatient({
    id: p.patient_id || p.id, reg_no: p.reg_no,
    name: p.patient_name || [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' '),
    phone: p.telephone,
  });
  const waiting = queue.reduce((s, x) => s + Number(x.total || 0), 0);

  return (
    <div className="hm-page">
      <PageHead title="Billing Desk" subtitle="Patients with consultation fees, tests or X-rays waiting to be billed. Tests and scans are paid before they are done.">
        <button type="button" className="hm-btn" onClick={load}><RefreshCw size={14} /> Refresh</button>
      </PageHead>

      <div className="hm-card">
        <div className="hm-card-body">
          <div className="sp-search" style={{ maxWidth: 560 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, color: 'var(--text-soft)' }} />
            <input ref={searchRef} className="hm-input" style={{ paddingLeft: 36, height: 42, fontSize: 15 }} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Find any patient — name, phone or registration no.  ( / )" aria-label="Find patient" />
          </div>
          {found.length > 0 && (
            <div className="hm-table-wrap" style={{ marginTop: 10 }}>
              <table className="hm-table">
                <tbody>
                  {found.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => pick(p)}>
                      <td><b>{[p.first_name, p.last_name].filter(Boolean).join(' ')}</b><span className="sub">{p.reg_no}</span></td>
                      <td>{p.telephone || '—'}</td>
                      <td className="num"><button type="button" className="hm-btn sm primary">Open bill</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {q.trim().length >= 2 && found.length === 0 && <p className="hm-muted" style={{ margin: '10px 0 0' }}>No patient found.</p>}
        </div>
      </div>

      <div className="hm-card">
        <div className="hm-card-head">
          <h3>Waiting to be billed</h3>
          <span className="hm-muted">{queue.length} patient{queue.length === 1 ? '' : 's'} · {money(waiting)}</span>
        </div>
        {loading ? <Empty>Loading…</Empty> : queue.length === 0 ? <Empty>Nothing waiting. New bookings and doctor's orders appear here automatically.</Empty> : (
          <div className="hm-table-wrap">
            <table className="hm-table">
              <thead><tr><th>Patient</th><th>Waiting for</th><th>Since</th><th className="num">Amount</th><th /></tr></thead>
              <tbody>
                {queue.map((x) => (
                  <tr key={x.patient_id} className="clickable" onClick={() => pick(x)}>
                    <td><b>{x.patient_name}</b><span className="sub">{x.reg_no}{x.telephone ? ` · ${x.telephone}` : ''}</span></td>
                    <td>
                      <div className="hm-chips">
                        {String(x.kinds || '').split(',').filter(Boolean).map((k) => {
                          const Icon = KIND_ICON[k] || Clock;
                          return <Badge key={k} tone={k === 'Consultation' ? 'blue' : k === 'Imaging' ? 'violet' : 'teal'}><Icon size={11} /> {k === 'Imaging' ? 'X-ray / scan' : k === 'Laboratory' ? 'Lab test' : k}</Badge>;
                        })}
                        {Number(x.diagnostics) > 0 && <Badge tone="amber">pay before test</Badge>}
                      </div>
                    </td>
                    <td className="hm-muted">{since(x.oldest)}</td>
                    <td className="num"><b>{money(x.total)}</b><span className="sub">{x.items} item{Number(x.items) === 1 ? '' : 's'}</span></td>
                    <td className="num"><button type="button" className="hm-btn sm primary">Bill</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
