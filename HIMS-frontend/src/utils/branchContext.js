/**
 * Branch Context Utility for Inventory Multi-Branch Support
 * 
 * This utility helps include branch context in API requests,
 * similar to how the laboratory system handles multi-branch isolation.
 */

/**
 * Get branch context from localStorage (set during login)
 * @returns {Object} { role_level, branch_id, district_id }
 */
export const getBranchContext = () => {
  return {
    role_level: localStorage.getItem('role_level') || 'Branch',
    branch_id: localStorage.getItem('branch_id'),
    district_id: localStorage.getItem('district_id'),
    hospital_code: localStorage.getItem('hospital_code')
  };
};

/**
 * Build query string with branch context for API requests
 * @returns {String} Query string fragment like "?branch_id=1&role_level=Branch"
 */
export const buildBranchQueryString = () => {
  const { role_level, branch_id, district_id } = getBranchContext();
  const params = new URLSearchParams();

  if (branch_id) params.append('branch_id', branch_id);
  if (role_level) params.append('role_level', role_level);
  if (district_id && role_level === 'Sub-Central') params.append('district_id', district_id);

  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
};

/**
 * Append branch context to existing query string or URL
 * @param {String} baseUrl - Base URL or existing query string
 * @returns {String} URL with branch context appended
 */
export const appendBranchContext = (baseUrl) => {
  const { role_level, branch_id, district_id } = getBranchContext();

  const separator = baseUrl.includes('?') ? '&' : '?';
  const params = new URLSearchParams();

  if (branch_id) params.append('branch_id', branch_id);
  if (role_level) params.append('role_level', role_level);
  if (district_id && role_level === 'Sub-Central') params.append('district_id', district_id);

  const queryString = params.toString();
  return queryString ? `${baseUrl}${separator}${queryString}` : baseUrl;
};

/**
 * Fetch wrapper that automatically includes branch context
 * @param {String} url - API endpoint URL
 * @param {Object} options - Fetch options
 * @returns {Promise} Fetch promise
 */
export const fetchWithBranchContext = async (url, options = {}) => {
  const API = import.meta.env.VITE_API_URL || '';
  const token = localStorage.getItem('hims_token');

  const urlWithContext = appendBranchContext(url);
  const fullUrl = url.startsWith('http') ? urlWithContext : `${API}${urlWithContext}`;

  const fetchOptions = {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  };

  const response = await fetch(fullUrl, fetchOptions);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
};

/**
 * Check if current user can access data for a specific branch
 * Central: can access all branches
 * Sub-Central: can access branches in their district
 * Branch: can only access their own branch
 * 
 * @param {Number|String} targetBranchId - Branch to check access for
 * @returns {Boolean} Whether user has access
 */
export const canAccessBranch = (targetBranchId) => {
  const { role_level, branch_id, district_id } = getBranchContext();

  if (role_level === 'Central') return true;
  if (role_level === 'Branch') return branch_id?.toString() === targetBranchId?.toString();
  // Sub-Central would need district check via API
  return false;
};

/**
 * Get display label for current branch context
 * @returns {String} Label like "Ranchi Central (Central)"
 */
export const getBranchLabel = () => {
  const { role_level, hospital_code } = getBranchContext();

  const roleLabels = {
    'Central': 'State Level',
    'Sub-Central': 'District Level',
    'Branch': hospital_code || 'Branch'
  };

  return roleLabels[role_level] || 'Branch';
};
