import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertTriangle, CornerDownRight } from 'lucide-react';

// Results an analyzer sent that couldn't be tied to a real order — no
// Patient ID at all, a Patient ID the worklist doesn't recognise, or the
// backend was unreachable when the lookup was attempted (see
// main/worklistResolver.js). Rather than dropping the run, it lands here so
// a technician can type in the correct sample ID and push it for real.
export default function UnmappedTests() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState({}); // id -> typed sample id
  const [mappingId, setMappingId] = useState(null);
  const [errors, setErrors] = useState({}); // id -> error message

  const fetchRows = useCallback(async () => {
    try {
      const data = await window.electronAPI.getUnmappedResults();
      setRows(data || []);
    } catch (err) {
      console.error('Failed to load unmapped results:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRows();
    const offUpdated = window.electronAPI.onLocalResultsUpdated?.(fetchRows);
    const interval = setInterval(fetchRows, 20000);
    return () => { offUpdated?.(); clearInterval(interval); };
  }, [fetchRows]);

  const mapRow = async (id) => {
    const sampleId = (drafts[id] || '').trim();
    if (!sampleId) {
      setErrors((e) => ({ ...e, [id]: 'Enter the sample ID first.' }));
      return;
    }
    setMappingId(id);
    setErrors((e) => ({ ...e, [id]: null }));
    try {
      const result = await window.electronAPI.mapUnmappedResult(id, sampleId);
      if (!result?.ok) {
        setErrors((e) => ({ ...e, [id]: result?.message || 'Could not push this result — it stays mapped locally, retry from Today\'s Test Results.' }));
      }
      fetchRows();
    } finally {
      setMappingId(null);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 1500 }}>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Unmapped Test Results</h1>
          <p className="page-subtitle">
            Results an analyzer sent that couldn't be matched to an order — enter the correct sample ID to push them.
          </p>
        </div>
        <div className="page-actions">
          <button onClick={fetchRows} className="btn btn-secondary"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Captured</th>
                <th>Machine</th>
                <th>Parameters</th>
                <th>Map to Sample ID</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan="5"><div className="loading-row"><div className="spinner" /> Loading...</div></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan="5">
                  <div className="empty-state">
                    <div className="empty-state-icon"><AlertTriangle size={26} /></div>
                    <div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Nothing waiting on a sample ID</div>
                  </div>
                </td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {new Date(r.created_at.includes('Z') ? r.created_at : r.created_at + 'Z').toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.machine_name || r.machine_no || '—'}</td>
                    <td>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                        {(r.results || []).slice(0, 4).map((p) => p.parameter_name).join(', ')}
                        {(r.results || []).length > 4 ? ` +${r.results.length - 4} more` : ''}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.test_name || 'Unmapped Test'}</div>
                    </td>
                    <td>
                      <input
                        type="text"
                        placeholder="e.g. LAB-GHJ-20260902-1001"
                        value={drafts[r.id] || ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') mapRow(r.id); }}
                        style={{ width: 220 }}
                      />
                      {errors[r.id] && <div style={{ fontSize: 11, color: 'var(--color-danger, #b91c1c)', marginTop: 4 }}>{errors[r.id]}</div>}
                    </td>
                    <td>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '6px 12px', fontSize: 12 }}
                        onClick={() => mapRow(r.id)}
                        disabled={mappingId === r.id}
                      >
                        <CornerDownRight size={13} /> {mappingId === r.id ? 'Mapping…' : 'Map & Push'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
