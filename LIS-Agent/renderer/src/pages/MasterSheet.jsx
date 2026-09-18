import { useState, useEffect, useMemo } from 'react';
import { Search, Printer, BookOpen, Cpu, ArrowLeft, ChevronRight } from 'lucide-react';

function MasterSheet() {
  const [sheet, setSheet] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [machineSearch, setMachineSearch] = useState('');
  const [selectedMachine, setSelectedMachine] = useState('');

  useEffect(() => {
    window.electronAPI.getMasterSheet()
      .then((data) => setSheet(data || {}))
      .catch((err) => {
        console.error('Failed to load master sheet', err);
        setError('Could not load the master sheet.');
      })
      .finally(() => setLoading(false));
  }, []);

  const machines = Object.keys(sheet);

  const filteredMachines = useMemo(() => {
    const q = machineSearch.trim().toLowerCase();
    if (!q) return machines;
    return machines.filter((m) => m.toLowerCase().includes(q));
  }, [machines, machineSearch]);

  const rows = useMemo(() => {
    if (!selectedMachine) return [];
    const q = search.trim().toLowerCase();
    const list = [];
    for (const row of sheet[selectedMachine] || []) {
      if (q && !row.code.toLowerCase().includes(q) && !row.name.toLowerCase().includes(q)) continue;
      list.push(row);
    }
    return list;
  }, [sheet, selectedMachine, search]);

  return (
    <div className="page" style={{ maxWidth: 1300 }}>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Master Sheet</h1>
          <p className="page-subtitle">
            Reference table of the numeric/code values each analyzer sends for each parameter — use this to program new machines correctly.
          </p>
        </div>
        {selectedMachine && (
          <div className="page-actions no-print">
            <div className="worklist-search-box" style={{ width: 260 }}>
              <Search size={14} color="var(--text-muted)" />
              <input
                type="text"
                placeholder="Search code or parameter..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <button onClick={() => window.print()} className="btn btn-primary">
              <Printer size={15} /> Print
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="card"><div className="loading-row"><div className="spinner" /> Loading master sheet...</div></div>
      ) : error ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-danger)' }}>{error}</div>
      ) : !selectedMachine ? (
        <>
          <div className="worklist-search-box no-print" style={{ width: 320, marginBottom: 20 }}>
            <Search size={14} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Search machines..."
              value={machineSearch}
              onChange={(e) => setMachineSearch(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          {filteredMachines.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon"><Cpu size={26} /></div>
                <div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>No matching machines</div>
              </div>
            </div>
          ) : (
            <div className="setup-machine-grid">
              {filteredMachines.map((m) => (
                <button
                  key={m}
                  onClick={() => { setSelectedMachine(m); setSearch(''); }}
                  className="card card-hover dash-shortcut"
                  style={{ textAlign: 'left' }}
                >
                  <div className="dash-shortcut-icon" style={{ background: 'var(--brand-blue-light)', color: 'var(--brand-blue)' }}>
                    <Cpu size={20} />
                  </div>
                  <div className="dash-shortcut-body">
                    <div className="dash-shortcut-title">{m}</div>
                    <div className="dash-shortcut-desc">{(sheet[m] || []).length} parameters</div>
                  </div>
                  <ChevronRight size={18} className="dash-shortcut-arrow" />
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <button
            onClick={() => { setSelectedMachine(''); setSearch(''); }}
            className="btn btn-ghost btn-sm no-print"
            style={{ marginBottom: 14, color: 'var(--brand-blue)' }}
          >
            <ArrowLeft size={14} /> All Machines
          </button>

          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-header">
              <h3>{selectedMachine}</h3>
              <span className="badge badge-info">{rows.length} {rows.length === 1 ? 'parameter' : 'parameters'}</span>
            </div>
            <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code / Number</th>
                  <th>Parameter Name</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan="2">
                    <div className="empty-state">
                      <div className="empty-state-icon"><BookOpen size={26} /></div>
                      <div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>No matching entries</div>
                    </div>
                  </td></tr>
                ) : (
                  rows.map((row, i) => (
                    <tr key={`${row.code}-${i}`}>
                      <td style={{ fontWeight: 800, color: 'var(--brand-blue)', fontFamily: 'monospace' }}>{row.code}</td>
                      <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{row.name}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          html, body, #root, main { height: auto !important; overflow: visible !important; }
        }
      `}</style>
    </div>
  );
}

export default MasterSheet;
