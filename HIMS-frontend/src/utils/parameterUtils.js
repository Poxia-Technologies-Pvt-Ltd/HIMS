// Test Parameter Utilities

// Initial parameter template with new fields
export const createEmptyParameter = () => ({
  parameter_code: '',
  parameter_name: '',
  parameter_unit: '',
  result_type: 'numeric', // 'numeric' | 'text' | 'select'
  display_order: 0,
  
  // Range values (for numeric)
  min_value: '',
  max_value: '',
  
  // Demographic ranges
  use_demographic_ranges: false,
  men_min_value: '',
  men_max_value: '',
  women_min_value: '',
  women_max_value: '',
  kids_min_value: '',
  kids_max_value: '',
  
  // Calculated field
  is_calculated: false,
  formula: '',
  
  // Select options
  options: ''
});

// Helper: Generate reference range string from min/max
export const generateReferenceRange = (min, max, unit) => {
  if (!min && !max) return '';
  const unitStr = unit ? ` ${unit}` : '';
  if (min && max) return `${min} - ${max}${unitStr}`;
  if (min) return `≥ ${min}${unitStr}`;
  return `≤ ${max}${unitStr}`;
};

// Helper: Validate parameter
export const validateParameter = (param) => {
  const errors = [];
  
  if (!param.parameter_code?.trim()) {
    errors.push('Parameter code is required');
  }
  if (!param.parameter_name?.trim()) {
    errors.push('Parameter name is required');
  }
  
  if (param.result_type === 'numeric') {
    if (!param.min_value && !param.max_value) {
      errors.push('Min or Max value is required for numeric parameters');
    }
  }
  
  if (param.result_type === 'select') {
    if (!param.options?.trim()) {
      errors.push('Options are required for select parameters');
    }
  }
  
  if (param.is_calculated && !param.formula?.trim()) {
    errors.push('Formula is required for calculated parameters');
  }
  
  return errors;
};

// Helper: Auto-generate parameter code from name
export const generateParameterCode = (name) => {
  if (!name) return '';
  return name
    .split(/[\s_-]+/)
    .map(word => word[0]?.toUpperCase())
    .join('')
    .slice(0, 5);
};

// Helper: Get flag for result value
export const getResultFlag = (value, min, max) => {
  const numValue = parseFloat(value);
  if (isNaN(numValue)) return null;
  
  // Check normal range
  const hasMin = min !== '' && min !== null;
  const hasMax = max !== '' && max !== null;
  
  if (hasMin && numValue < parseFloat(min)) {
    return { flag: 'LOW', severity: 'warning', label: 'Low' };
  }
  if (hasMax && numValue > parseFloat(max)) {
    return { flag: 'HIGH', severity: 'warning', label: 'High' };
  }
  
  return { flag: 'NORMAL', severity: 'normal', label: 'Normal' };
};

// Helper: Format options string to array
export const parseOptions = (optionsString) => {
  if (!optionsString) return [];
  return optionsString
    .split(',')
    .map(opt => opt.trim())
    .filter(opt => opt.length > 0);
};

// Helper: Reorder parameters array
export const reorderParameters = (parameters, oldIndex, newIndex) => {
  const result = Array.from(parameters);
  const [removed] = result.splice(oldIndex, 1);
  result.splice(newIndex, 0, removed);
  return result.map((p, i) => ({ ...p, display_order: i }));
};
