import { useState, useEffect } from 'react';
import Alert from '../../components/Alert';
import { useAlert } from '../../hooks/useAlert';
import { fetchWithBranchContext } from '../../utils/branchContext';
import '../../assets/CSS/InventoryVendors.css'; // Use glassmorphic CSS

const API_URL = import.meta.env.VITE_API_URL || '';

function InventoryDashboard() {
  const { alert, showAlert, hideAlert } = useAlert();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = async () => {
    try {
      const result = await fetchWithBranchContext('/api/inventory/dashboard');
      if (result.success) {
        setData(result.data);
      }
    } catch {
      showAlert('error', 'Failed to load smart analytics');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading Smart Analytics...</div>;
  if (!data) return <div style={{ padding: '40px', textAlign: 'center' }}>Failed to load dashboard.</div>;

  return (
    <div className="inv-vendor-page">
      {alert && <Alert type={alert.type} message={alert.message} onClose={hideAlert} />}

      <div className="inv-header">
        <div>
          <h1 className="inv-title">Smart Consumption Analytics</h1>
          <p className="inv-subtitle">Management-level insights directly from the stock ledger</p>
        </div>
      </div>

      {/* Automated Insights Banner */}
      {data.insights && data.insights.length > 0 && (
        <div className="inv-card" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)', color: 'white', border: 'none' }}>
          <h3 style={{ margin: '0 0 15px 0', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <circle cx="12" cy="12" r="4" />
            </svg>
            Automated Ledger Insights
          </h3>
          <ul style={{ paddingLeft: '20px', margin: 0, fontSize: '15px', lineHeight: '1.6' }}>
            {data.insights.map((insight, idx) => (
              <li key={idx} style={{ marginBottom: '8px' }}>{insight}</li>
            ))}
          </ul>
        </div>
      )}

      {/* KPI Stats */}
      <div className="inv-grid-2" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: '24px' }}>
        <div className="inv-card" style={{ textAlign: 'center', padding: '24px 15px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-soft)', textTransform: 'uppercase', letterSpacing: '1px' }}>Total Available Stock</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-dark)', marginTop: '8px' }}>{data.total_value.toLocaleString()} <span style={{ fontSize: '16px' }}>Units</span></div>
        </div>

        <div className="inv-card" style={{ textAlign: 'center', padding: '24px 15px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-soft)', textTransform: 'uppercase', letterSpacing: '1px' }}>Weekly Trend</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: data.trend.percentage > 0 ? '#dc2626' : '#059669', marginTop: '8px' }}>
            {data.trend.percentage > 0 ? '↑' : data.trend.percentage < 0 ? '↓' : ''} {Math.abs(data.trend.percentage).toFixed(1)}%
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-soft)' }}>vs last week</div>
        </div>

        <div className="inv-card" style={{ textAlign: 'center', padding: '24px 15px', borderLeft: data.low_stock_count > 0 ? '4px solid #f59e0b' : 'none' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-soft)', textTransform: 'uppercase', letterSpacing: '1px' }}>Low Stock Items</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#f59e0b', marginTop: '8px' }}>{data.low_stock_count}</div>
        </div>

        <div className="inv-card" style={{ textAlign: 'center', padding: '24px 15px', borderLeft: data.expired_count > 0 ? '4px solid #dc2626' : 'none' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-soft)', textTransform: 'uppercase', letterSpacing: '1px' }}>Expired Batches</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#dc2626', marginTop: '8px' }}>{data.expired_count}</div>
        </div>
      </div>

      <div className="inv-grid-2" style={{ marginTop: '24px' }}>

        {/* Test-wise Consumption */}
        <div className="inv-card" style={{ padding: '0' }}>
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border-light)' }}>
            <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-dark)' }}>Test-wise Consumption (Last 30 Days)</h3>
          </div>
          <table className="inv-table">
            <thead>
              <tr>
                <th>Lab Test</th>
                <th>Consumed Reagent/Item</th>
                <th>Total Deducted</th>
              </tr>
            </thead>
            <tbody>
              {data.test_consumption.length === 0 ? (
                <tr><td colSpan="3" style={{ textAlign: 'center' }}>No test consumption data found.</td></tr>
              ) : (
                data.test_consumption.map((tc, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 600 }}>{tc.test_name}</td>
                    <td>{tc.item_name}</td>
                    <td style={{ color: '#dc2626', fontWeight: 600 }}>-{tc.test_consumed} {tc.unit}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Top Consumed Items overall */}
        <div className="inv-card" style={{ padding: '0' }}>
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border-light)' }}>
            <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-dark)' }}>Most Used Items (Last 30 Days)</h3>
          </div>
          <table className="inv-table">
            <thead>
              <tr>
                <th>Item Details</th>
                <th>Total OUT</th>
              </tr>
            </thead>
            <tbody>
              {data.top_consumed_items.length === 0 ? (
                <tr><td colSpan="2" style={{ textAlign: 'center' }}>No consumption data found.</td></tr>
              ) : (
                data.top_consumed_items.map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{item.item_name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-soft)' }}>{item.item_code} • {item.category}</div>
                    </td>
                    <td>
                      <span style={{ padding: '4px 8px', background: '#fef2f2', color: '#dc2626', borderRadius: '4px', fontWeight: 600, fontSize: '13px' }}>
                        {item.total_consumed} {item.unit}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </div>

      {/* Auto Reorder Predictions */}
      <div className="inv-grid-1" style={{ marginTop: '24px' }}>
        <div className="inv-card" style={{ padding: '0', borderLeft: '4px solid #8b5cf6' }}>
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-dark)' }}>🔮 AI Reorder Predictions</h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-soft)' }}>
                Based on Average Daily Usage (ADU) formula: Reorder Point = (ADU × Lead Time) + Buffer
              </p>
            </div>
          </div>
          <table className="inv-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>ADU (Units/Day)</th>
                <th>Current Stock</th>
                <th>Dynamic Reorder Point</th>
                <th>Stock-out Prediction</th>
              </tr>
            </thead>
            <tbody>
              {!data.reorder_predictions || data.reorder_predictions.length === 0 ? (
                <tr><td colSpan="5" style={{ textAlign: 'center' }}>All stock levels are perfectly optimized.</td></tr>
              ) : (
                data.reorder_predictions.map((pred, idx) => (
                  <tr key={idx} style={{ background: pred.days_until_stockout <= 7 ? '#fef2f2' : 'transparent' }}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{pred.item_name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-soft)' }}>Buffer: {pred.safety_stock_buffer} | Lead: {pred.lead_time_days} days</div>
                    </td>
                    <td>{pred.adu}</td>
                    <td style={{ fontWeight: 600 }}>{pred.current_stock} {pred.unit}</td>
                    <td style={{ color: '#8b5cf6', fontWeight: 600 }}>{pred.reorder_point} {pred.unit}</td>
                    <td>
                      {pred.days_until_stockout <= 7 ? (
                        <span style={{ padding: '4px 8px', background: '#dc2626', color: 'white', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                          Empty in {pred.days_until_stockout} days!
                        </span>
                      ) : (
                        <span style={{ padding: '4px 8px', background: '#fef3c7', color: '#d97706', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                          Empty in {pred.days_until_stockout} days
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Test Cost & Profitability Analysis */}
      <div className="inv-grid-1" style={{ marginTop: '24px' }}>
        <div className="inv-card" style={{ padding: '0', borderLeft: '4px solid #10b981' }}>
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-dark)' }}>💰 Test Cost & Profitability Analysis</h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-soft)' }}>
                Based on item mappings: Profit = Test Revenue - Sum(Item Cost × Quantity Used)
              </p>
            </div>
          </div>
          <table className="inv-table">
            <thead>
              <tr>
                <th>Lab Test</th>
                <th>Calculated Cost (Internal)</th>
                <th>Test Price (Revenue)</th>
                <th>Profit per Test</th>
                <th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {!data.test_profitability || data.test_profitability.length === 0 ? (
                <tr><td colSpan="5" style={{ textAlign: 'center' }}>No mapped tests available for profitability calculation.</td></tr>
              ) : (
                data.test_profitability.map((test, idx) => (
                  <tr key={idx} style={{ background: test.profit < 0 ? '#fef2f2' : 'transparent' }}>
                    <td style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{test.test_name}</td>
                    <td style={{ color: '#dc2626', fontWeight: 600 }}>Rs. {test.total_cost.toLocaleString()}</td>
                    <td style={{ color: '#059669', fontWeight: 600 }}>Rs. {test.revenue.toLocaleString()}</td>
                    <td>
                      {test.profit >= 0 ? (
                        <span style={{ color: '#059669', fontWeight: 700 }}>+Rs. {test.profit.toLocaleString()}</span>
                      ) : (
                        <span style={{ color: '#dc2626', fontWeight: 700 }}>-Rs. {Math.abs(test.profit).toLocaleString()}</span>
                      )}
                    </td>
                    <td>
                      <span style={{ padding: '4px 8px', background: test.margin >= 50 ? '#dcfce7' : test.margin >= 20 ? '#fef3c7' : '#fee2e2', color: test.margin >= 50 ? '#166534' : test.margin >= 20 ? '#92400e' : '#991b1b', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                        {test.margin}%
                      </span>
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

export default InventoryDashboard;
