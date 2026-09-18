import React, { useState, useEffect } from 'react';
import '../../assets/CSS/LabTestManagement.css';
import TestParametersSection from './TestParametersSection';

const tok = () => localStorage.getItem('hims_token');
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

const LabTestManagement = () => {
  const [activeTab, setActiveTab] = useState('tests');

  // Tests (not tied to any specific analyzer)
  const [generalTests, setGeneralTests] = useState([]);
  const [loadingGeneralTests, setLoadingGeneralTests] = useState(false);
  const [expandedGeneralTestId, setExpandedGeneralTestId] = useState(null);

  // Test create / edit modal
  const [showTestModal, setShowTestModal] = useState(false);
  const [testModalTab, setTestModalTab] = useState('basic');
  const [editingTest, setEditingTest] = useState(null);
  const [savingTest, setSavingTest] = useState(false);
  const [testForm, setTestForm] = useState({
    test_code: '', test_name: '', category_id: '', sample_type: '',
    tube_color: '', storage_conditions: '', methodology: '', price: '',
    analyzer_name: '', parameters: []
  });

  // Other tabs state
  const [categories, setCategories] = useState([]);
  const [containers, setContainers] = useState([]);
  const [sampleTypes, setSampleTypes] = useState([]);
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [showAddContainerModal, setShowAddContainerModal] = useState(false);
  const [showAddSampleTypeModal, setShowAddSampleTypeModal] = useState(false);
  const [categoryFormData, setCategoryFormData] = useState({ name: '', description: '' });
  const [containerFormData, setContainerFormData] = useState({
    container_name: '', tube_color: '', volume_ml: '',
    additives: '', storage_temperature: '', special_instructions: ''
  });
  const [sampleTypeFormData, setSampleTypeFormData] = useState({ type_name: '', description: '' });

  useEffect(() => {
    fetchCategories();
    fetchContainers();
    fetchSampleTypes();
    if (activeTab === 'tests') fetchGeneralTests();
  }, [activeTab]);

  // ── Data Fetching ──────────────────────────────────────────

  const fetchGeneralTests = async () => {
    setLoadingGeneralTests(true);
    try {
      const res = await fetch('/api/lab/tests-general', { headers: authHdr() });
      const data = await res.json();
      if (data.success) setGeneralTests(data.tests);
    } catch (err) {
      console.error('Error fetching tests:', err);
    } finally {
      setLoadingGeneralTests(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/lab/categories', { headers: authHdr() });
      const data = await res.json();
      if (data.success) setCategories(data.categories);
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  const fetchContainers = async () => {
    try {
      const res = await fetch('/api/lab/containers', { headers: authHdr() });
      const data = await res.json();
      if (data.success) setContainers(data.containers);
    } catch (err) {
      console.error('Error fetching containers:', err);
    }
  };

  const fetchSampleTypes = async () => {
    try {
      const res = await fetch('/api/lab/sample-types', { headers: authHdr() });
      const data = await res.json();
      if (data.success) setSampleTypes(data.sampleTypes);
    } catch (err) {
      console.error('Error fetching sample types:', err);
    }
  };

  // ── Test Modal ─────────────────────────────────────────────

  const openAddTestModal = () => {
    setEditingTest(null);
    setTestForm({
      test_code: '', test_name: '', category_id: '', sample_type: '',
      tube_color: '', storage_conditions: '', methodology: '', price: '',
      analyzer_name: '',
      parameters: []
    });
    setTestModalTab('basic');
    setShowTestModal(true);
  };

  const openEditTestModal = (test) => {
    setEditingTest(test);
    setTestForm({
      test_code: test.test_code,
      test_name: test.test_name,
      category_id: test.category_id || '',
      sample_type: test.sample_type || '',
      tube_color: test.tube_color || '',
      storage_conditions: test.storage_conditions || '',
      methodology: test.methodology || '',
      price: test.price || '',
      analyzer_name: test.analyzer_name || '',
      parameters: test.parameters || []
    });
    setTestModalTab('basic');
    setShowTestModal(true);
  };

  const handleSaveTest = async () => {
    if (!testForm.test_code || !testForm.test_name || !testForm.category_id || !testForm.sample_type) {
      alert('Test Code, Name, Category, and Sample Type are required.');
      setTestModalTab('basic');
      return;
    }
    setSavingTest(true);
    try {
      const payload = { ...testForm, lab_id: null };
      const url = editingTest ? `/api/lab/tests/${editingTest.id}` : '/api/lab/tests';
      const method = editingTest ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setShowTestModal(false);
        fetchGeneralTests();
      } else {
        alert(data.message || 'Error saving test');
      }
    } catch (err) {
      console.error('Error saving test:', err);
      alert('Error saving test');
    } finally {
      setSavingTest(false);
    }
  };

  const handleDeleteTest = async (testId) => {
    if (!window.confirm('Delete this test template? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/lab/tests/${testId}`, { method: 'DELETE', headers: authHdr() });
      const data = await res.json();
      if (data.success) {
        fetchGeneralTests();
      } else {
        alert(data.message || 'Error deleting test');
      }
    } catch (err) {
      console.error('Error deleting test:', err);
    }
  };

  const handleAIGenerate = async () => {
    if (!testForm.test_name) {
      alert('Enter a test name first.');
      return;
    }
    try {
      const res = await fetch('/api/lab/generate-parameters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          test_name: testForm.test_name,
          analyzer_name: testForm.analyzer_name,
          sample_type: testForm.sample_type
        })
      });
      const data = await res.json();
      if (data.success && data.parameters) {
        setTestForm(prev => ({ ...prev, parameters: data.parameters }));
      } else {
        alert(data.message || 'Could not generate parameters');
      }
    } catch (err) {
      console.error('Error generating parameters:', err);
      alert('Error generating parameters');
    }
  };

  // ── Other-tab submit handlers (unchanged) ─────────────────

  const handleSubmitCategory = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/lab/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify(categoryFormData)
      });
      const data = await res.json();
      if (data.success) {
        setShowAddCategoryModal(false);
        setCategoryFormData({ name: '', description: '' });
        fetchCategories();
      } else alert(data.message || 'Error adding category');
    } catch (err) { console.error(err); alert('Error adding category'); }
  };

  const handleSubmitContainer = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/lab/containers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify(containerFormData)
      });
      const data = await res.json();
      if (data.success) {
        setShowAddContainerModal(false);
        setContainerFormData({ container_name: '', tube_color: '', volume_ml: '', additives: '', storage_temperature: '', special_instructions: '' });
        fetchContainers();
      } else alert(data.message || 'Error adding container');
    } catch (err) { console.error(err); alert('Error adding container'); }
  };

  const handleSubmitSampleType = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/lab/sample-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify(sampleTypeFormData)
      });
      const data = await res.json();
      if (data.success) {
        setShowAddSampleTypeModal(false);
        setSampleTypeFormData({ type_name: '', description: '' });
        fetchSampleTypes();
      } else alert(data.message || 'Error adding sample type');
    } catch (err) { console.error(err); alert('Error adding sample type'); }
  };

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="lab-test-management">

      {/* Header */}
      <div className="header">
        <h1>Laboratory Test Management</h1>
        <div className="tabs">
          <button className={activeTab === 'tests' ? 'active' : ''} onClick={() => setActiveTab('tests')}>
            Tests
          </button>
          <button className={activeTab === 'categories' ? 'active' : ''} onClick={() => setActiveTab('categories')}>
            Categories
          </button>
          <button className={activeTab === 'containers' ? 'active' : ''} onClick={() => setActiveTab('containers')}>
            Sample Containers
          </button>
          <button className={activeTab === 'sample-types' ? 'active' : ''} onClick={() => setActiveTab('sample-types')}>
            Sample Types
          </button>
        </div>
      </div>

      {/* ── TESTS TAB ──────────────────────────────────────── */}
      {activeTab === 'tests' && (
        <div className="tests-standalone-layout">
          <main className="tests-panel">
            <div className="tests-panel-header">
              <div className="tests-panel-title-block">
                <h2 className="tests-panel-model-name">Tests</h2>
                <span className="tests-panel-subtitle">
                  {generalTests.length} test{generalTests.length !== 1 ? 's' : ''} · billed and reported manually
                </span>
              </div>
              <div className="tests-panel-actions">
                <button className="btn-primary" onClick={openAddTestModal}>
                  + Add Test
                </button>
              </div>
            </div>

            {loadingGeneralTests ? (
              <div className="panel-loading">Loading tests…</div>
            ) : generalTests.length === 0 ? (
              <div className="tests-empty-state">
                <div className="empty-icon-lg">🧪</div>
                <h3>No tests yet</h3>
                <p>
                  Create tests like CBC, KFT, or Electrolyte Panel<br />
                  that get billed and reported manually.
                </p>
                <button className="btn-primary" onClick={openAddTestModal}>
                  + Add First Test
                </button>
              </div>
            ) : (
              <div className="model-tests-list">
                {generalTests.map(test => (
                  <div
                    key={test.id}
                    className={`model-test-row ${expandedGeneralTestId === test.id ? 'expanded' : ''}`}
                  >
                    <div
                      className="test-row-header"
                      onClick={() => setExpandedGeneralTestId(expandedGeneralTestId === test.id ? null : test.id)}
                    >
                      <div className="test-row-left">
                        <span className="test-code-badge">{test.test_code}</span>
                        <div className="test-row-info">
                          <span className="test-row-name">{test.test_name}</span>
                          <span className="test-row-meta">
                            {test.category_name} · {test.sample_type}
                          </span>
                        </div>
                      </div>
                      <div className="test-row-right">
                        <span className="param-count-badge">{test.parameter_count} param{test.parameter_count !== 1 ? 's' : ''}</span>
                        {test.price && <span className="price-badge">₹{test.price}</span>}
                        <button
                          className="btn-icon-sm"
                          title="Edit test"
                          onClick={(e) => { e.stopPropagation(); openEditTestModal(test); }}
                        >
                          ✏
                        </button>
                        <button
                          className="btn-icon-sm danger"
                          title="Delete test"
                          onClick={(e) => { e.stopPropagation(); handleDeleteTest(test.id); }}
                        >
                          ✕
                        </button>
                        <span className="expand-chevron">{expandedGeneralTestId === test.id ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {expandedGeneralTestId === test.id && (
                      <div className="test-row-params">
                        {test.parameters && test.parameters.length > 0 ? (
                          <table className="params-table">
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>Code</th>
                                <th>Parameter Name</th>
                                <th>Machine Code</th>
                                <th>Unit</th>
                                <th>Range</th>
                                <th>Type</th>
                              </tr>
                            </thead>
                            <tbody>
                              {test.parameters.map((p, idx) => (
                                <tr key={idx}>
                                  <td className="td-num">{idx + 1}</td>
                                  <td><code>{p.parameter_code || '—'}</code></td>
                                  <td>{p.parameter_name}</td>
                                  <td>
                                    <code className={`machine-code-cell ${p.machine_parameter_code ? 'has-code' : 'no-code'}`}>
                                      {p.machine_parameter_code || '—'}
                                    </code>
                                  </td>
                                  <td>{p.parameter_unit || '—'}</td>
                                  <td>
                                    {p.min_value != null && p.max_value != null
                                      ? `${p.min_value} – ${p.max_value}`
                                      : '—'}
                                  </td>
                                  <td>
                                    <span className={`type-chip type-${p.result_type}`}>{p.result_type}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="no-params-msg">
                            No parameters defined. <button className="link-btn" onClick={() => openEditTestModal(test)}>Edit to add parameters.</button>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      )}

      {/* ── CATEGORIES TAB ─────────────────────────────────── */}
      {activeTab === 'categories' && (
        <div className="categories-section">
          <div className="section-header">
            <h2>Lab Test Categories</h2>
            <button className="btn-primary" onClick={() => setShowAddCategoryModal(true)}>
              Add Category
            </button>
          </div>
          <div className="categories-grid">
            {categories.map(c => (
              <div key={c.id} className="category-card">
                <h3>{c.name}</h3>
                {c.description && <p>{c.description}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CONTAINERS TAB ─────────────────────────────────── */}
      {activeTab === 'containers' && (
        <div className="containers-section">
          <div className="section-header">
            <h2>Sample Containers</h2>
            <button className="btn-primary" onClick={() => setShowAddContainerModal(true)}>
              Add Container
            </button>
          </div>
          <div className="containers-grid">
            {containers.map(c => (
              <div key={c.id} className="container-card">
                <h3>{c.container_name}</h3>
                <div className="container-details">
                  <p><strong>Tube Color:</strong> {c.tube_color || 'N/A'}</p>
                  <p><strong>Volume:</strong> {c.volume_ml || 'N/A'} ml</p>
                  <p><strong>Additives:</strong> {c.additives || 'N/A'}</p>
                  <p><strong>Storage:</strong> {c.storage_temperature || 'N/A'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SAMPLE TYPES TAB ───────────────────────────────── */}
      {activeTab === 'sample-types' && (
        <div className="sample-types-section">
          <div className="section-header">
            <h2>Sample Types</h2>
            <button className="btn-primary" onClick={() => setShowAddSampleTypeModal(true)}>
              Add Sample Type
            </button>
          </div>
          <div className="categories-grid">
            {sampleTypes.map(t => (
              <div key={t.id} className="category-card">
                <h3>{t.type_name}</h3>
                {t.description && <p>{t.description}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          TEST CREATE / EDIT MODAL
      ═══════════════════════════════════════════════════════ */}
      {showTestModal && (
        <div className="modal-overlay">
          <div className="modal modal-xl">
            <div className="modal-header">
              <div>
                <h2>{editingTest ? 'Edit Test' : 'Add Test'}</h2>
              </div>
              <button className="close-btn" onClick={() => setShowTestModal(false)}>&times;</button>
            </div>

            <div className="modal-tabs">
              <button
                className={testModalTab === 'basic' ? 'active' : ''}
                onClick={() => setTestModalTab('basic')}
              >
                Basic Info
              </button>
              <button
                className={testModalTab === 'parameters' ? 'active' : ''}
                onClick={() => setTestModalTab('parameters')}
              >
                Parameters
                {testForm.parameters.length > 0 && (
                  <span className="tab-count">{testForm.parameters.length}</span>
                )}
              </button>
            </div>

            <div className="modal-body">
              {testModalTab === 'basic' && (
                <div className="basic-info-form">
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Test Code *</label>
                      <input
                        type="text"
                        value={testForm.test_code}
                        onChange={e => setTestForm(p => ({ ...p, test_code: e.target.value.toUpperCase() }))}
                        placeholder="e.g., CBC"
                      />
                    </div>
                    <div className="form-group">
                      <label>Test Name *</label>
                      <input
                        type="text"
                        value={testForm.test_name}
                        onChange={e => setTestForm(p => ({ ...p, test_name: e.target.value }))}
                        placeholder="e.g., Complete Blood Count"
                      />
                    </div>
                  </div>
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Category *</label>
                      <select
                        value={testForm.category_id}
                        onChange={e => setTestForm(p => ({ ...p, category_id: e.target.value }))}
                      >
                        <option value="">-- Select Category --</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Sample Type *</label>
                      <input
                        type="text"
                        value={testForm.sample_type}
                        onChange={e => setTestForm(p => ({ ...p, sample_type: e.target.value }))}
                        placeholder="e.g., Whole Blood, Serum"
                      />
                    </div>
                  </div>
                  <div className="form-grid-2">
                    <div className="form-group">
                      <label>Tube Color</label>
                      <input
                        type="text"
                        value={testForm.tube_color}
                        onChange={e => setTestForm(p => ({ ...p, tube_color: e.target.value }))}
                        placeholder="e.g., Purple (EDTA), Red (Serum)"
                      />
                    </div>
                    <div className="form-group">
                      <label>Price (₹)</label>
                      <input
                        type="number"
                        value={testForm.price}
                        onChange={e => setTestForm(p => ({ ...p, price: e.target.value }))}
                        placeholder="e.g., 250"
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Methodology</label>
                    <input
                      type="text"
                      value={testForm.methodology}
                      onChange={e => setTestForm(p => ({ ...p, methodology: e.target.value }))}
                      placeholder="e.g., Impedance / Flow Cytometry"
                    />
                  </div>
                  <div className="form-group">
                    <label>Storage Conditions</label>
                    <textarea
                      value={testForm.storage_conditions}
                      onChange={e => setTestForm(p => ({ ...p, storage_conditions: e.target.value }))}
                      placeholder="e.g., Process within 4 hours; refrigerate at 2–8°C"
                      rows={2}
                    />
                  </div>
                </div>
              )}

              {testModalTab === 'parameters' && (
                <TestParametersSection
                  parameters={testForm.parameters}
                  onParametersChange={params => setTestForm(p => ({ ...p, parameters: params }))}
                  onGenerateAI={handleAIGenerate}
                />
              )}
            </div>

            <div className="modal-footer">
              <div className="modal-footer-nav">
                {testModalTab === 'basic' && (
                  <button className="btn-primary" onClick={() => setTestModalTab('parameters')}>
                    Next: Parameters →
                  </button>
                )}
                {testModalTab === 'parameters' && (
                  <button className="btn-secondary" onClick={() => setTestModalTab('basic')}>
                    ← Back to Basic Info
                  </button>
                )}
              </div>
              <div className="modal-footer-main">
                <button className="btn-secondary" onClick={() => setShowTestModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleSaveTest} disabled={savingTest}>
                  {savingTest ? 'Saving…' : editingTest ? 'Update Test' : 'Create Test'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          CATEGORY MODAL
      ═══════════════════════════════════════════════════════ */}
      {showAddCategoryModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Add Lab Category</h2>
              <button className="close-btn" onClick={() => { setShowAddCategoryModal(false); setCategoryFormData({ name: '', description: '' }); }}>&times;</button>
            </div>
            <form onSubmit={handleSubmitCategory} className="category-form">
              <div className="form-group">
                <label>Category Name *</label>
                <input type="text" value={categoryFormData.name}
                  onChange={e => setCategoryFormData(p => ({ ...p, name: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea value={categoryFormData.description}
                  onChange={e => setCategoryFormData(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => { setShowAddCategoryModal(false); setCategoryFormData({ name: '', description: '' }); }}>Cancel</button>
                <button type="submit" className="btn-primary">Add Category</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          CONTAINER MODAL
      ═══════════════════════════════════════════════════════ */}
      {showAddContainerModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Add Sample Container</h2>
              <button className="close-btn" onClick={() => { setShowAddContainerModal(false); setContainerFormData({ container_name: '', tube_color: '', volume_ml: '', additives: '', storage_temperature: '', special_instructions: '' }); }}>&times;</button>
            </div>
            <form onSubmit={handleSubmitContainer} className="container-form">
              <div className="form-grid">
                <div className="form-group">
                  <label>Container Name *</label>
                  <input type="text" value={containerFormData.container_name}
                    onChange={e => setContainerFormData(p => ({ ...p, container_name: e.target.value }))}
                    placeholder="e.g., EDTA Tube, Serum Tube" required />
                </div>
                <div className="form-group">
                  <label>Tube Color</label>
                  <input type="text" value={containerFormData.tube_color}
                    onChange={e => setContainerFormData(p => ({ ...p, tube_color: e.target.value }))}
                    placeholder="e.g., Lavender, Red" />
                </div>
                <div className="form-group">
                  <label>Volume (ml)</label>
                  <input type="number" step="0.1" value={containerFormData.volume_ml}
                    onChange={e => setContainerFormData(p => ({ ...p, volume_ml: e.target.value }))}
                    placeholder="e.g., 5.0" />
                </div>
                <div className="form-group">
                  <label>Additives</label>
                  <input type="text" value={containerFormData.additives}
                    onChange={e => setContainerFormData(p => ({ ...p, additives: e.target.value }))}
                    placeholder="e.g., EDTA, Heparin, None" />
                </div>
              </div>
              <div className="form-group">
                <label>Storage Temperature</label>
                <input type="text" value={containerFormData.storage_temperature}
                  onChange={e => setContainerFormData(p => ({ ...p, storage_temperature: e.target.value }))}
                  placeholder="e.g., Room Temperature, 2–8°C" />
              </div>
              <div className="form-group">
                <label>Special Instructions</label>
                <textarea value={containerFormData.special_instructions}
                  onChange={e => setContainerFormData(p => ({ ...p, special_instructions: e.target.value }))}
                  placeholder="e.g., Mix gently by inverting 8–10 times" rows={3} />
              </div>
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => { setShowAddContainerModal(false); setContainerFormData({ container_name: '', tube_color: '', volume_ml: '', additives: '', storage_temperature: '', special_instructions: '' }); }}>Cancel</button>
                <button type="submit" className="btn-primary">Add Container</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          SAMPLE TYPE MODAL
      ═══════════════════════════════════════════════════════ */}
      {showAddSampleTypeModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Add Sample Type</h2>
              <button className="close-btn" onClick={() => { setShowAddSampleTypeModal(false); setSampleTypeFormData({ type_name: '', description: '' }); }}>&times;</button>
            </div>
            <form onSubmit={handleSubmitSampleType} className="category-form">
              <div className="form-group">
                <label>Type Name *</label>
                <input type="text" value={sampleTypeFormData.type_name}
                  onChange={e => setSampleTypeFormData(p => ({ ...p, type_name: e.target.value }))}
                  placeholder="e.g., Blood, Urine, Tissue" required />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea value={sampleTypeFormData.description}
                  onChange={e => setSampleTypeFormData(p => ({ ...p, description: e.target.value }))}
                  placeholder="e.g., Whole blood samples for hematology tests" rows={3} />
              </div>
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => { setShowAddSampleTypeModal(false); setSampleTypeFormData({ type_name: '', description: '' }); }}>Cancel</button>
                <button type="submit" className="btn-primary">Add Sample Type</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default LabTestManagement;
