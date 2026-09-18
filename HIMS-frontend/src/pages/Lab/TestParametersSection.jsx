import React, { useState } from 'react';
import '../../assets/CSS/TestParametersSection.css';
import { 
  createEmptyParameter, 
  validateParameter, 
  generateParameterCode 
} from '../../utils/parameterUtils';

const TestParametersSection = ({ 
  parameters, 
  onParametersChange,
  onGenerateAI
}) => {
  const [expandedParam, setExpandedParam] = useState(null);
  const [draggedIndex, setDraggedIndex] = useState(null);

  // Add new parameter
  const handleAddParameter = () => {
    const newParam = createEmptyParameter();
    newParam.display_order = parameters.length;
    onParametersChange([...parameters, newParam]);
    setExpandedParam(parameters.length);
  };

  // Remove parameter
  const handleRemoveParameter = (index) => {
    const updated = parameters.filter((_, i) => i !== index);
    // Reorder remaining
    const reordered = updated.map((p, i) => ({ ...p, display_order: i }));
    onParametersChange(reordered);
    if (expandedParam === index) setExpandedParam(null);
  };

  // Update parameter field
  const handleParamChange = (index, field, value) => {
    const updated = [...parameters];
    updated[index] = { ...updated[index], [field]: value };
    
    // Auto-generate code on first name entry
    if (field === 'parameter_name' && !updated[index].parameter_code) {
      updated[index].parameter_code = generateParameterCode(value);
    }
    
    // Clear irrelevant fields when result_type changes
    if (field === 'result_type') {
      if (value !== 'numeric') {
        updated[index].min_value = '';
        updated[index].max_value = '';
      }
      if (value !== 'select') {
        updated[index].options = '';
      }
    }
    
    // Clear formula if not calculated
    if (field === 'is_calculated' && !value) {
      updated[index].formula = '';
    }
    
    onParametersChange(updated);
  };

  // Reorder parameters
  const moveParameter = (index, direction) => {
    if ((direction === -1 && index === 0) || 
        (direction === 1 && index === parameters.length - 1)) {
      return;
    }
    
    const updated = [...parameters];
    const targetIndex = index + direction;
    [updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]];
    
    // Update display_order
    const reordered = updated.map((p, i) => ({ ...p, display_order: i }));
    onParametersChange(reordered);
    setExpandedParam(targetIndex);
  };

  // Drag and drop handlers
  const handleDragStart = (index) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    
    const updated = [...parameters];
    const draggedParam = updated[draggedIndex];
    updated.splice(draggedIndex, 1);
    updated.splice(index, 0, draggedParam);
    
    const reordered = updated.map((p, i) => ({ ...p, display_order: i }));
    onParametersChange(reordered);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // Toggle expand/collapse
  const toggleExpand = (index) => {
    setExpandedParam(expandedParam === index ? null : index);
  };

  // Check if parameter has errors
  const getParamErrors = (param) => validateParameter(param);

  return (
    <div className="test-parameters-section">
      <div className="parameters-header">
        <div className="header-title">
          <h3>Test Parameters</h3>
          <span className="param-count">{parameters.length} parameter(s)</span>
        </div>
        <div className="header-actions">
          <button 
            type="button" 
            onClick={onGenerateAI}
            className="btn-ai"
            title="Auto-generate parameters using AI"
          >
            <span className="ai-icon">AI</span>
            Generate Parameters
          </button>
          <button 
            type="button" 
            onClick={handleAddParameter}
            className="btn-secondary"
          >
            + Add Parameter
          </button>
        </div>
      </div>

      {parameters.length === 0 && (
        <div className="empty-state">
          <p>No parameters defined. Add manually or use AI generation.</p>
        </div>
      )}

      <div className="parameters-list">
        {parameters.map((param, index) => {
          const errors = getParamErrors(param);
          const isExpanded = expandedParam === index;
          const isDragged = draggedIndex === index;
          
          return (
            <div 
              key={index}
              className={`parameter-card ${isExpanded ? 'expanded' : ''} ${isDragged ? 'dragged' : ''} ${errors.length > 0 ? 'has-errors' : ''}`}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
            >
              {/* Card Header */}
              <div className="card-header" onClick={() => toggleExpand(index)}>
                <div className="drag-handle">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="9" cy="6" r="2" />
                    <circle cx="9" cy="12" r="2" />
                    <circle cx="9" cy="18" r="2" />
                    <circle cx="15" cy="6" r="2" />
                    <circle cx="15" cy="12" r="2" />
                    <circle cx="15" cy="18" r="2" />
                  </svg>
                </div>
                
                <div className="param-summary">
                  <span className="param-code">{param.parameter_code || '---'}</span>
                  <span className="param-name">{param.parameter_name || 'Unnamed Parameter'}</span>
                  <span className="param-type-badge" data-type={param.result_type}>
                    {param.result_type}
                  </span>
                  {param.is_calculated && (
                    <span className="calculated-badge">ƒ</span>
                  )}
                </div>
                
                <div className="param-meta">
                  {errors.length > 0 && (
                    <span className="error-indicator" title={errors.join(', ')}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    </span>
                  )}
                  <span className="order-label">#{param.display_order + 1}</span>
                  <button 
                    type="button"
                    className="reorder-btn"
                    onClick={(e) => { e.stopPropagation(); moveParameter(index, -1); }}
                    disabled={index === 0}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button 
                    type="button"
                    className="reorder-btn"
                    onClick={(e) => { e.stopPropagation(); moveParameter(index, 1); }}
                    disabled={index === parameters.length - 1}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button 
                    type="button"
                    className="remove-btn"
                    onClick={(e) => { e.stopPropagation(); handleRemoveParameter(index); }}
                    title="Remove parameter"
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Expanded Form */}
              {isExpanded && (
                <div className="card-body">
                  {/* Basic Info Section */}
                  <div className="form-section">
                    <h4 className="section-title">Basic Information</h4>

                    {/* Machine Output Code — prominent, full-width */}
                    <div className="form-group machine-code-group">
                      <label className="machine-code-label">
                        Machine Output Code
                        <span className="help-text" title="Exact code sent by the analyzer for this parameter (e.g., 6690-2 for WBC, Na for Sodium). Required for auto-import of results.">?</span>
                      </label>
                      <input
                        type="text"
                        value={param.machine_parameter_code || ''}
                        onChange={(e) => handleParamChange(index, 'machine_parameter_code', e.target.value)}
                        placeholder="e.g., 6690-2 (WBC), Na (Sodium), 718-7 (HGB)"
                        className="machine-code-input"
                      />
                    </div>

                    <div className="form-grid-3">
                      <div className="form-group required">
                        <label>
                          Parameter Code
                          <span className="help-text" title="Short unique code (e.g., HB, WBC, RBC)">?</span>
                        </label>
                        <input
                          type="text"
                          value={param.parameter_code}
                          onChange={(e) => handleParamChange(index, 'parameter_code', e.target.value.toUpperCase())}
                          placeholder="e.g., HB"
                          maxLength={10}
                        />
                      </div>

                      <div className="form-group required">
                        <label>Parameter Name</label>
                        <input
                          type="text"
                          value={param.parameter_name}
                          onChange={(e) => handleParamChange(index, 'parameter_name', e.target.value)}
                          placeholder="e.g., Hemoglobin"
                        />
                      </div>

                      <div className="form-group">
                        <label>Unit</label>
                        <input
                          type="text"
                          value={param.parameter_unit}
                          onChange={(e) => handleParamChange(index, 'parameter_unit', e.target.value)}
                          placeholder="e.g., g/dL"
                        />
                      </div>
                    </div>

                    <div className="form-grid-3">
                      <div className="form-group required">
                        <label>
                          Result Type
                          <span className="help-text" title="Numeric: with ranges | Text: free text | Select: predefined options">?</span>
                        </label>
                        <select
                          value={param.result_type}
                          onChange={(e) => handleParamChange(index, 'result_type', e.target.value)}
                        >
                          <option value="numeric">Numeric</option>
                          <option value="text">Text</option>
                          <option value="select">Select</option>
                        </select>
                      </div>
                      
                      <div className="form-group">
                        <label>Display Order</label>
                        <input
                          type="number"
                          value={param.display_order}
                          onChange={(e) => handleParamChange(index, 'display_order', parseInt(e.target.value) || 0)}
                          min={0}
                        />
                      </div>
                      
                      <div className="form-group checkbox-group">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={param.is_calculated}
                            onChange={(e) => handleParamChange(index, 'is_calculated', e.target.checked)}
                          />
                          <span>Calculated Field</span>
                          <span className="help-text" title="Value is computed from other parameters">?</span>
                        </label>
                      </div>
                    </div>

                    {/* Calculated Field Formula */}
                    {param.is_calculated && (
                      <div className="form-group">
                        <label className="required">
                          Formula
                          <span className="help-text" title="Use parameter codes with operators. Example: (WBC * RBC) / 100">?</span>
                        </label>
                        <input
                          type="text"
                          value={param.formula}
                          onChange={(e) => handleParamChange(index, 'formula', e.target.value)}
                          placeholder="e.g., (WBC * RBC) / 100"
                          className="formula-input"
                        />
                        <small className="field-hint">
                          Use parameter codes (e.g., HB, WBC) with +, -, *, /, (, )
                        </small>
                      </div>
                    )}

                    {/* Select Options */}
                    {param.result_type === 'select' && (
                      <div className="form-group required">
                        <label>
                          Options
                          <span className="help-text" title="Comma-separated list of allowed values">?</span>
                        </label>
                        <input
                          type="text"
                          value={param.options}
                          onChange={(e) => handleParamChange(index, 'options', e.target.value)}
                          placeholder="e.g., Positive, Negative, Borderline"
                        />
                        <small className="field-hint">
                          Separate options with commas
                        </small>
                      </div>
                    )}
                  </div>

                  {/* Reference Range Section */}
                  {param.result_type === 'numeric' && (
                    <div className="form-section">
                      <h4 className="section-title">Reference Range</h4>
                      
                      <div className="form-grid-2">
                        <div className="form-group">
                          <label>Min Value</label>
                          <input
                            type="number"
                            step="0.01"
                            value={param.min_value}
                            onChange={(e) => handleParamChange(index, 'min_value', e.target.value)}
                            placeholder="e.g., 13.5"
                          />
                        </div>
                        <div className="form-group">
                          <label>Max Value</label>
                          <input
                            type="number"
                            step="0.01"
                            value={param.max_value}
                            onChange={(e) => handleParamChange(index, 'max_value', e.target.value)}
                            placeholder="e.g., 17.5"
                          />
                        </div>
                      </div>

                      {/* Demographic Ranges Toggle */}
                      <div className="form-group checkbox-group">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={param.use_demographic_ranges}
                            onChange={(e) => handleParamChange(index, 'use_demographic_ranges', e.target.checked)}
                          />
                          <span>Use Demographic-Specific Ranges (Men/Women/Kids)</span>
                        </label>
                      </div>

                      {/* Demographic Ranges */}
                      {param.use_demographic_ranges && (
                        <div className="demographic-ranges-section">
                          <div className="demo-group">
                            <h5>Men</h5>
                            <div className="form-grid-2">
                              <input
                                type="number"
                                step="0.01"
                                placeholder="Min"
                                value={param.men_min_value}
                                onChange={(e) => handleParamChange(index, 'men_min_value', e.target.value)}
                              />
                              <input
                                type="number"
                                step="0.01"
                                placeholder="Max"
                                value={param.men_max_value}
                                onChange={(e) => handleParamChange(index, 'men_max_value', e.target.value)}
                              />
                            </div>
                          </div>

                          <div className="demo-group">
                            <h5>Women</h5>
                            <div className="form-grid-2">
                              <input
                                type="number"
                                step="0.01"
                                placeholder="Min"
                                value={param.women_min_value}
                                onChange={(e) => handleParamChange(index, 'women_min_value', e.target.value)}
                              />
                              <input
                                type="number"
                                step="0.01"
                                placeholder="Max"
                                value={param.women_max_value}
                                onChange={(e) => handleParamChange(index, 'women_max_value', e.target.value)}
                              />
                            </div>
                          </div>

                          <div className="demo-group">
                            <h5>Children</h5>
                            <div className="form-grid-2">
                              <input
                                type="number"
                                step="0.01"
                                placeholder="Min"
                                value={param.kids_min_value}
                                onChange={(e) => handleParamChange(index, 'kids_min_value', e.target.value)}
                              />
                              <input
                                type="number"
                                step="0.01"
                                placeholder="Max"
                                value={param.kids_max_value}
                                onChange={(e) => handleParamChange(index, 'kids_max_value', e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Validation Errors */}
                  {errors.length > 0 && (
                    <div className="validation-errors">
                      {errors.map((error, i) => (
                        <span key={i} className="error-tag">{error}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TestParametersSection;
