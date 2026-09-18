import React, { useState, useEffect } from 'react';
import SummaryCards from '../components/DisasterDashboard/SummaryCards';
import MapChart from '../components/DisasterDashboard/MapChart';
import DistrictList from '../components/DisasterDashboard/DistrictList';
import Charts from '../components/DisasterDashboard/Charts';
import AlertPanel from '../components/DisasterDashboard/AlertPanel';
import DrillDownModal from '../components/DisasterDashboard/DrillDownModal';
import { ShieldAlert, Download, RefreshCw, Cpu, Activity, LayoutGrid, List } from 'lucide-react';
import '../assets/CSS/DisasterDashboard.css';

const DisasterDashboard = () => {
  const [timeFilter, setTimeFilter] = useState('7D');
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [surveillanceData, setSurveillanceData] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  const API_URL = import.meta.env.VITE_API_URL || '';

  const fetchData = async () => {
    setLoading(true);
    try {
      const [survRes, alertRes] = await Promise.all([
        fetch(`${API_URL}/api/disaster/surveillance?timeFilter=${timeFilter}`),
        fetch(`${API_URL}/api/disaster/alerts`)
      ]);

      const survData = await survRes.json();
      const alertData = await alertRes.json();

      if (survData.success) setSurveillanceData(survData.data);
      if (alertData.success) setAlerts(alertData.data);
    } catch (error) {
      console.error('Error fetching disaster data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [timeFilter]);

  return (
    <div className="disaster-page">

      {/* Header Section */}
      <header className="disaster-header">
        <div className="header-left">
          <div className="header-icon">
            <ShieldAlert size={28} strokeWidth={2} />
          </div>
          <div>
            <h1>Disease Surveillance <span>Dashboard</span></h1>
            <p>State Level Monitoring • Jharkhand Health Department</p>
          </div>
        </div>

        <div className="header-actions">
          <div className="time-filters">
            {['Today', '3 Days', '7 Days'].map((label, idx) => {
              const id = ['1D', '3D', '7D'][idx];
              return (
                <button
                  key={id}
                  onClick={() => setTimeFilter(id)}
                  className={`btn-filter ${timeFilter === id ? 'active' : ''}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button className="btn-export">
            <Download size={16} /> Export Data
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <main className="disaster-main">

        {/* Main Column */}
        <div className="main-content">
          <SummaryCards data={surveillanceData} />

          <div className="map-district-grid">
            <div className="map-card">
              <div className="map-header">
                <h3>Geospatial Risk Heatmap</h3>
                <div className="map-legend">
                  <div className="legend-item"><div className="legend-dot dot-high"></div> HIGH RISK</div>
                  <div className="legend-item"><div className="legend-dot dot-med"></div> MEDIUM</div>
                  <div className="legend-item"><div className="legend-dot dot-low"></div> STABLE</div>
                </div>
              </div>
              <div className="map-container">
                <MapChart data={surveillanceData} onDistrictClick={setSelectedDistrict} />
              </div>
            </div>
            <div>
              <DistrictList data={surveillanceData} />
            </div>
          </div>

          <Charts data={surveillanceData} />
        </div>

        {/* Sidebar Column */}
        <div className="sidebar-content">
          <div className="intel-box">
            <div className="intel-header">
              <Cpu size={16} />
              <h4>Analytical Insights</h4>
            </div>
            <p>
              Disease vectors indicate a <span className="intel-highlight">12% growth</span> in Ranchi district over the last 72 hours. Proactive screening in South-East Jharkhand is advised.
            </p>
          </div>

          <AlertPanel alerts={alerts} />
        </div>
      </main>

      {/* Drill Down Portal */}
      {selectedDistrict && (
        <DrillDownModal
          district={selectedDistrict}
          onClose={() => setSelectedDistrict(null)}
        />
      )}

      <footer className="disaster-footer">
        <p className="footer-copy">© 2026 STATE HEALTH SURVEILLANCE UNIT • VERSION 3.0.1</p>
        <div className="footer-links">
          <a href="#">Documentation</a>
          <a href="#">Protocol Manual</a>
          <a href="#">Support</a>
        </div>
      </footer>
    </div>
  );
};

export default DisasterDashboard;
