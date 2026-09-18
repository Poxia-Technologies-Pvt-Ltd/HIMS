import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import '../../assets/CSS/LabTrack.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const tok = () => localStorage.getItem('hims_token');

function LabTrack() {
  const [searchParams] = useSearchParams();
  const { referenceId: paramRefId } = useParams();

  const [referenceNumber, setReferenceNumber] = useState(paramRefId || searchParams.get('ref') || '');
  const [trackingData, setTrackingData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const navigate = useNavigate();

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!referenceNumber.trim()) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE}/api/lab/track/${encodeURIComponent(referenceNumber)}`, { headers: { Authorization: `Bearer ${tok()}` } });
      const data = await res.json();

      if (data.success) {
        setTrackingData(data.data);
        // Update URL quietly so it can be shared easily
        navigate(`/track/${referenceNumber}`, { replace: true });
      } else {
        setTrackingData(null);
        setError(data.message || 'Reference number not found.');
      }
    } catch (err) {
      setTrackingData(null);
      setError('Network error while fetching tracking status.');
    } finally {
      setLoading(false);
    }
  };

  // If a reference is in the URL, automatically search for it on load
  useEffect(() => {
    if (paramRefId || searchParams.get('ref')) {
      handleSearch();
    }
  }, [paramRefId, searchParams]);

  return (
    <div className="track-container">
      <div className="track-header">
        <div className="track-logo">🏥 HIMS Live Tracking</div>
      </div>

      <div className="track-content">
        <div className="track-search-card">
          <h2>Track Your Lab Test</h2>
          <p>Enter the unique Reference Number provided in your WhatsApp message.</p>

          <form onSubmit={handleSearch} className="track-search-form">
            <input
              type="text"
              placeholder="e.g. LAB-MAIN-CBC-A1B2"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              required
            />
            <button type="submit" disabled={loading}>
              {loading ? 'Searching...' : 'Track Status'}
            </button>
          </form>

          {error && <div className="track-error">{error}</div>}
        </div>

        {trackingData && (
          <div className="track-result-card">
            <div className="track-result-header">
              <div className="track-info-group">
                <span className="track-label">Patient Name</span>
                <span className="track-value">{trackingData.patient_name}</span>
              </div>
              <div className="track-info-group">
                <span className="track-label">Reference Number</span>
                <span className="track-value-mono">{trackingData.reference_number}</span>
              </div>
              <div className="track-info-group">
                <span className="track-label">Test</span>
                <span className="track-value">{trackingData.test_name}</span>
              </div>
            </div>

            <div className="track-timeline">
              {trackingData.timeline.map((step, idx) => (
                <div key={idx} className={`track-step ${step.completed ? 'completed' : 'pending'}`}>
                  <div className="track-step-icon">
                    {step.completed ? '✓' : ''}
                  </div>
                  <div className="track-step-content">
                    <h4 className="track-step-title">{step.status}</h4>
                    <p className="track-step-desc">{step.description}</p>
                    {step.timestamp && (
                      <span className="track-step-time">
                        {new Date(step.timestamp).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {trackingData.current_status === 'Completed' || trackingData.timeline[trackingData.timeline.length - 1].completed ? (
              <div className="track-success-banner">
                Your report is verified and ready. Please visit the reception or check your registered email for the final PDF.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default LabTrack;
