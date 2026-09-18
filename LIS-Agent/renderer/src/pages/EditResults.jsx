import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Search, Pencil, X, Save, FileX } from 'lucide-react';
import { API_BASE } from '../apiBase';

const EditResults = () => {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedTest, setSelectedTest] = useState(null);
  const [editedResults, setEditedResults] = useState([]);

  useEffect(() => {
    fetchTests();
  }, []);

  const fetchTests = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE}/api/lab/pending-verifications?status=all`);
      if (res.data.success) {
        setTests(res.data.tests.filter(t => t.status === 'Test Done' || t.status === 'Verified' || t.status === 'Completed'));
      }
    } catch (err) {
      console.error("Error fetching tests:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = (test) => {
    setSelectedTest(test);
    // clone the results array so we can edit it safely
    setEditedResults(JSON.parse(JSON.stringify(test.results)));
  };

  const handleResultChange = (index, value) => {
    const newResults = [...editedResults];
    newResults[index].result_value = value;
    setEditedResults(newResults);
  };

  const handleSaveEdits = async () => {
    if (!selectedTest) return;
    try {
      // Fetch the bill_item_id using sample_id if needed, but our save API might need bill_item_id or just sample_id.
      // The save API works with just sample_id if it can look up bill_item_id.
      const payload = {
        bill_item_id: selectedTest.bill_item_id,
        sample_id: selectedTest.sample_id,
        machine_no: selectedTest.machine_no,
        test_name: selectedTest.test_name,
        results: editedResults
      };

      const res = await axios.post(`${API_BASE}/api/lab/save-test-results`, payload);
      if (res.data.success) {
        alert("Results updated successfully!");
        setSelectedTest(null);
        fetchTests();
      }
    } catch (err) {
      console.error("Error saving edited results:", err);
      alert("Failed to save edits.");
    }
  };

  const filteredTests = tests.filter(t =>
    t.sample_id.toLowerCase().includes(search.toLowerCase()) ||
    t.patient_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Edit Results</h1>
          <p className="page-subtitle">Modify recorded test results before final approval</p>
        </div>
        <div className="worklist-search-box">
          <Search size={14} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search sample ID or patient..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 230 }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedTest ? '1.2fr 1fr' : '1fr', gap: 24, alignItems: 'start' }}>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Sample ID</th>
                <th>Patient</th>
                <th>Test</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5"><div className="loading-row"><div className="spinner" /> Loading...</div></td></tr>
              ) : filteredTests.length === 0 ? (
                <tr><td colSpan="5">
                  <div className="empty-state">
                    <div className="empty-state-icon"><FileX size={26} /></div>
                    <div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>No editable results found</div>
                  </div>
                </td></tr>
              ) : filteredTests.map(test => (
                <tr key={test.id} style={{ background: selectedTest?.id === test.id ? 'var(--brand-blue-light)' : 'transparent' }}>
                  <td style={{ fontWeight: 800 }}>{test.sample_id}</td>
                  <td><div style={{ fontWeight: 700 }}>{test.patient_name}</div></td>
                  <td style={{ fontWeight: 600 }}>{test.test_name}</td>
                  <td><span className="badge badge-info">{test.status}</span></td>
                  <td>
                    <button onClick={() => handleEditClick(test)} className="btn btn-primary btn-sm">
                      <Pencil size={13} /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        {selectedTest && (
          <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', maxHeight: 700 }}>
            <div className="flex-between" style={{ marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800 }}>Editing Results</h2>
                <div style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>{selectedTest.patient_name} ({selectedTest.sample_id}) - {selectedTest.test_name}</div>
              </div>
              <button onClick={() => setSelectedTest(null)} className="btn btn-ghost btn-icon"><X size={18} /></button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', paddingRight: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {editedResults.map((res, i) => (
                <div key={i} className="flex-between" style={{ padding: 14, background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                    {res.parameter_name || res.test_name}
                    {res.flag && res.flag !== 'N' && <span style={{ marginLeft: 8, color: res.flag === 'H' ? '#ef4444' : '#3b82f6' }}>({res.flag})</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="text"
                      value={res.result_value}
                      onChange={(e) => handleResultChange(i, e.target.value)}
                      className="control"
                      style={{ fontWeight: 800, fontSize: 15, width: 100, textAlign: 'right', height: 38 }}
                    />
                    <span style={{ color: 'var(--text-muted)', width: 50, fontSize: 13.5 }}>{res.unit}</span>
                  </div>
                </div>
              ))}
              {editedResults.length === 0 && (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No parameters recorded for this test.</div>
              )}
            </div>

            <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 12 }}>
              <button onClick={handleSaveEdits} className="btn btn-primary" style={{ flex: 1, padding: 15, background: 'var(--color-success)' }}>
                <Save size={16} /> Save Changes
              </button>
              <button onClick={() => setSelectedTest(null)} className="btn btn-secondary" style={{ padding: '15px 22px' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default EditResults;
