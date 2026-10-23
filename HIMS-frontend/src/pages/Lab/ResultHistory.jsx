import { useState, useEffect } from 'react';
import '../../assets/CSS/ResultFlagSettings.css';
import '../../assets/CSS/ResultHistory.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const authHdr = () => ({ Authorization: `Bearer ${localStorage.getItem('hims_token')}` });
const fmt = (t) => new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

const tone = (a) => /cancel/i.test(a) ? 'bad' : /edited after|re-verification|reissue/i.test(a) ? 'warn' : /authorized|validated/i.test(a) ? 'ok' : /rerun/i.test(a) ? 'warn' : 'plain';

// Complete history of one result: every save, edit, validation, authorization,
// amendment, cancellation and reissue — who, when, why, and before / after values.
export default function ResultHistory({ resultId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/lab/results/${resultId}/history`, { headers: authHdr() })
      .then((r) => r.json()).then((d) => (d.success ? setData(d) : setError(d.message || 'Could not load the history.')))
      .catch(() => setError('Could not load the history.'));
  }, [resultId]);

  return (
    <div className="rfs-overlay" onClick={onClose}>
      <div className="rfs-modal rh-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Verification History</h2>
          {data && <p>{data.result.patient_name} · {data.result.test_name} · Sample {data.result.sample_id} · Version {data.result.report_version} · <b>{data.result.status}</b></p>}
        </header>

        {!data && !error && <div className="rfs-empty">Loading…</div>}
        {error && <div className="rfs-msg bad">{error}</div>}

        {data && (
          <>
            <ol className="rh-timeline">
              {data.events.map((e) => (
                <li key={e.id} className={`rh-${tone(e.action)}`}>
                  <div className="rh-top">
                    <b>{e.action}</b>
                    {e.version ? <span className="rh-ver">v{e.version}</span> : null}
                    <span className="rh-time">{fmt(e.created_at)}</span>
                  </div>
                  <div className="rh-who">{e.actor_name || 'System'}{e.actor_role ? ` · ${e.actor_role}` : ''}{e.from_status && e.to_status && e.from_status !== e.to_status ? ` · ${e.from_status} → ${e.to_status}` : ''}</div>
                  {e.reason && <div className="rh-reason">Reason: {e.reason}</div>}
                  {e.note && <div className="rh-note">{e.note}</div>}
                  {e.details?.changes?.length > 0 && (
                    <table className="rh-diff"><thead><tr><th>Parameter</th><th>Before</th><th>After</th></tr></thead>
                      <tbody>{e.details.changes.map((c, i) => <tr key={i}><td>{c.parameter}</td><td>{c.from} {c.unit}</td><td><b>{c.to}</b> {c.unit}</td></tr>)}</tbody></table>
                  )}
                  {e.details?.added?.length > 0 && <div className="rh-note">Received: {e.details.added.join(', ')}</div>}
                </li>
              ))}
              {data.events.length === 0 && <li className="rh-plain"><div className="rh-note">No history recorded for this result.</div></li>}
            </ol>

            <section className="rh-block">
              <h4>Reagent lots on the analyzer{data.result.machine_no ? ` (${data.result.machine_no})` : ''}</h4>
              {data.result.reagent_lots?.length
                ? data.result.reagent_lots.map((r, i) => <div key={i} className="rh-sig"><b>{r.reagent}</b> · lot {r.lot} · exp {r.expiry}{r.state !== 'OK' ? <span className={`rh-pill ${r.state === 'Expired' ? 'bad' : ''}`}>{r.state}</span> : null}</div>)
                : <div className="rh-note">No reagent record exists for this analyzer at the time the result was produced.</div>}
            </section>

            {data.signatures.length > 0 && (
              <section className="rh-block">
                <h4>Electronic signatures</h4>
                {data.signatures.map((s) => (
                  <div key={s.id} className="rh-sig"><b>{s.signer_name}</b>, {s.designation || s.signer_role} · Reg. {s.registration_no} · {fmt(s.signed_at)}
                    <span className={`rh-pill ${s.status === 'Valid' ? 'ok' : 'bad'}`}>{s.status}{s.revoked_at ? ` ${fmt(s.revoked_at)}` : ''}</span></div>
                ))}
              </section>
            )}

            {data.versions.length > 0 && (
              <section className="rh-block">
                <h4>Earlier versions</h4>
                {data.versions.map((v) => (
                  <details key={v.id} className="rh-version">
                    <summary>Version {v.version} — replaced {fmt(v.superseded_at)} by {v.superseded_by_name || 'system'}: {v.superseded_reason}</summary>
                    <table className="rh-diff"><thead><tr><th>Parameter</th><th>Value</th><th>Unit</th><th>Range</th></tr></thead>
                      <tbody>{(v.results || []).filter((r) => !r.is_subheader).map((r, i) => <tr key={i}><td>{r.parameter_name}</td><td>{r.result_value}</td><td>{r.unit}</td><td>{r.reference_range}</td></tr>)}</tbody></table>
                  </details>
                ))}
              </section>
            )}
          </>
        )}
        <footer><button className="rfs-btn ghost" onClick={onClose}>Close</button></footer>
      </div>
    </div>
  );
}
