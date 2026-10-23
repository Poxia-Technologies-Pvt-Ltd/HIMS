import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ClipboardCheck, X, ShieldCheck, BadgeCheck } from 'lucide-react';
import { API_BASE } from '../apiBase';

const Verification = () => {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTest, setSelectedTest] = useState(null);

  useEffect(() => {
    fetchPending();
  }, []);

  const fetchPending = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/lab/pending-verifications`);
      if (res.data.success) {
        setTests(res.data.tests || []);
      }
    } catch (err) {
      console.error("Error fetching pending verifications:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (status) => {
    if (!selectedTest) return;
    try {
      const doctorId = JSON.parse(localStorage.getItem('user'))?.id || 1;
      const res = await axios.post(`${API_BASE}/api/lab/verify-test`, {
        test_result_id: selectedTest.id,
        sample_id: selectedTest.sample_id,
        verified_by: doctorId,
        status: status,
        notes: "Verified via LIS Agent"
      });
      if (res.data.success) {
        alert(`Test ${status} successfully!`);
        setSelectedTest(null);
        fetchPending();
      }
    } catch (err) {
      console.error("Error updating status:", err);
      alert("Failed to update status");
    }
  };

  if (loading) {
    return <div className="page loading-row"><div className="spinner" /> Loading verifications...</div>;
  }

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title-group">
          <h1 className="page-title">Test Verification</h1>
          <p className="page-subtitle">Verify and approve laboratory results before final reporting</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedTest ? '1.3fr 1fr' : '1fr', gap: 24, alignItems: 'start' }}>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Patient / Sample</th>
                <th>Test</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {tests.length === 0 ? (
                <tr><td colSpan={4}>
                  <div className="empty-state">
                    <div className="empty-state-icon"><ClipboardCheck size={26} /></div>
                    <div style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Nothing pending verification</div>
                  </div>
                </td></tr>
              ) : tests.map(test => (
                <tr key={test.id}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{test.sample_id}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{test.patient_name}</div>
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    {test.test_name}
                    {test.entry_mode && <div title={test.manual_reason || ''} style={{ marginTop: 3 }}><span className="badge badge-warning">{test.entry_mode === 'edited' ? 'Changed by hand' : 'Typed by hand'}</span><div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{test.manual_reason}</div></div>}
                  </td>
                  <td><span className="badge badge-warning">{test.status}</span></td>
                  <td>
                    <button onClick={() => setSelectedTest(test)} className="btn btn-primary btn-sm">Review</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        {selectedTest && (
          <div className="card" style={{ padding: 24, position: 'sticky', top: 24 }}>
            <div className="flex-between" style={{ marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>Reviewing: {selectedTest.sample_id}</h3>
              <button onClick={() => setSelectedTest(null)} className="btn btn-ghost btn-icon"><X size={18} /></button>
            </div>

            <div style={{ marginBottom: 24 }}>
              {selectedTest.results?.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{r.parameter_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Ref: {r.reference_range}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-success)' }}>{r.result_value} <small style={{ fontSize: 10, fontWeight: 400 }}>{r.unit}</small></div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => handleAction('Verified')} className="btn" style={{ flex: 1, padding: 12, background: 'var(--brand-purple)', color: '#fff' }}>
                <ShieldCheck size={15} /> Verify Test
              </button>
              <button onClick={() => handleAction('Approved')} className="btn" style={{ flex: 1, padding: 12, background: 'var(--color-success)', color: '#fff' }}>
                <BadgeCheck size={15} /> Final Approve
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Verification;
