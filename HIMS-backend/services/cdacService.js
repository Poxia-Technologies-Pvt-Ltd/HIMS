/**
 * CDAC e-Sushrut HMIS integration — raw API client.
 * 7 endpoints, all called BY us (CDAC never pushes to us). See
 * Meril_CDAC_LIS_Integration_API_Docs.md at the repo root for the full contract.
 *
 * Open items (see plan doc): no token refresh endpoint is documented for the
 * Bearer JWT, the correct host per environment is unconfirmed, and whether
 * API-ACCESS-KEY is per-endpoint/per-branch/shared is unconfirmed. getCdacToken()
 * is a single swappable seam for the first; the header resolution below covers
 * the other two without needing a code change once confirmed.
 */
import db from '../config/db.js';

const OPERATION_REQUEST_TYPE = {
  getHmisHospMapDataRowData: '7',
  patDemographicInvestigationDtls: '1',
  patSampleCollectionAndRequisitionDtls: '2',
  patInvestigationStatusUpdateDtls: '3',
  patInvestigationViewDtls: '4',
  patInvestigationReportDtls: '5',
  patInvestigationStatusUpdateDtlsRowData: '31',
};

/** Swappable auth seam — replace once CDAC clarifies token issuance/refresh. */
export async function getCdacToken() {
  return process.env.CDAC_BEARER_TOKEN || null;
}

export async function getBranchCdacConfig(branchId) {
  const [[row]] = await db.query(
    `SELECT * FROM branch_hmis_config WHERE branch_id = ? LIMIT 1`,
    [branchId]
  );
  return row || null;
}

// CDAC confirmed hmis_hosp_mapping_code is a single fixed facility ID across
// every branch (not per-branch), so a newly-created branch can be routed and
// fully configured immediately rather than left with a NULL mapping code
// until someone visits the CDAC Mapping settings page. Three separate
// branch-creation code paths exist (branchController.createCenter,
// authController's self-registration-with-new-branch, developerController's
// hospital creation) — call this from all three instead of duplicating the
// district->integration-type rule and risking another branch falling through
// with no branch_hmis_config row at all (which is exactly what happened —
// two of the three paths never inserted one, silently blocking CDAC
// pull/push for any branch created through them).
const CDAC_DEFAULT_HOSP_MAPPING_CODE = '10000';

export async function seedBranchHmisConfig(branchId, districtId, explicitHospMappingCode = null) {
  const [[district]] = await db.query('SELECT name FROM districts WHERE id = ?', [districtId]);
  const integrationType = district?.name === 'Ramgarh' ? 'CARE' : 'CDAC';
  const hospMappingCode = explicitHospMappingCode
    || (integrationType === 'CDAC' ? CDAC_DEFAULT_HOSP_MAPPING_CODE : null);

  await db.query(
    `INSERT INTO branch_hmis_config (branch_id, integration_type, hmis_hosp_mapping_code, is_active)
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE integration_type = VALUES(integration_type), hmis_hosp_mapping_code = VALUES(hmis_hosp_mapping_code), updated_at = NOW()`,
    [branchId, integrationType, hospMappingCode]
  );
  return { integrationType, hospMappingCode };
}

function resolveApiAccessKey(hmisRequestType, branchConfig) {
  if (branchConfig?.api_access_key_override) return branchConfig.api_access_key_override;

  if (process.env.CDAC_API_ACCESS_KEY_MAP) {
    try {
      const map = JSON.parse(process.env.CDAC_API_ACCESS_KEY_MAP);
      if (map[hmisRequestType]) return map[hmisRequestType];
    } catch (e) {
      console.error('CDAC_API_ACCESS_KEY_MAP is not valid JSON:', e.message);
    }
  }

  return process.env.CDAC_API_ACCESS_KEY || null;
}

/** Redact the ~260KB base64 PDF before persisting a log row. */
function redactForLog(body) {
  if (!body?.investigation_data?.some((item) => item.poct_pdf_rpt_base64)) return body;
  return {
    ...body,
    investigation_data: body.investigation_data.map((item) =>
      item.poct_pdf_rpt_base64
        ? { ...item, poct_pdf_rpt_base64: `<redacted, length=${item.poct_pdf_rpt_base64.length}>` }
        : item
    ),
  };
}

async function logCdacCall({
  operation, hmisRequestType, branchId, requestBody, responseBody,
  httpStatus, success, errorMessage, durationMs, attempt,
}) {
  const firstItem = requestBody?.investigation_data?.[0];
  try {
    await db.query(
      `INSERT INTO cdac_integration_logs
        (operation, hmis_request_type, bill_item_id, hmis_req_no, hmis_req_dno, hmis_patCrNo,
         branch_id, request_payload, response_payload, http_status, success, error_message, duration_ms, attempt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        operation,
        hmisRequestType || null,
        null,
        firstItem?.hmis_req_no || null,
        firstItem?.hmis_req_dno || null,
        requestBody?.hmis_patCrNo || null,
        branchId || null,
        JSON.stringify(redactForLog(requestBody)),
        responseBody != null ? JSON.stringify(responseBody) : null,
        httpStatus || null,
        success ? 1 : 0,
        errorMessage || null,
        durationMs || null,
        attempt || 1,
      ]
    );
  } catch (logErr) {
    console.error('Failed to write cdac_integration_logs row:', logErr.message);
  }
}

/** Errors from a single call attempt that are worth retrying — connection-level
 *  failures, timeouts, and 5xx responses (CDAC's server having a bad moment).
 *  A 4xx means our request was wrong, and a "200 but data.Status says error"
 *  means CDAC understood and rejected the data — retrying either would just
 *  fail the same way again, so those are NOT retried. */
function isRetryableCdacError(err) {
  if (err?.name === 'AbortError') return true; // timeout
  if (err?.cdacHttpStatus && err.cdacHttpStatus >= 500) return true;
  if (err?.cdacHttpStatus) return false; // any other HTTP status: not retryable
  if (err?.cdacDataRejected) return false; // CDAC rejected the payload itself
  return true; // network/DNS/connection-level failure — worth a retry
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared caller for all 7 endpoints.
 * @param {string} operation - operation name, also the URL path segment
 * @param {object} body - request body, minus hmis_request_type (added here)
 * @param {object} [opts]
 * @param {object} [opts.branchConfig] - row from branch_hmis_config, for key override
 * @param {number} [opts.timeoutMs]
 */
async function callCdac(operation, body, { branchConfig = null, timeoutMs } = {}) {
  const hmisRequestType = OPERATION_REQUEST_TYPE[operation];
  if (!hmisRequestType) throw new Error(`Unknown CDAC operation: ${operation}`);

  if (!process.env.CDAC_BASE_URL) throw new Error('CDAC_BASE_URL is not configured');

  const fullBody = { ...body, hmis_request_type: hmisRequestType };
  const isReportCall = operation === 'patInvestigationReportDtls';
  const effectiveTimeout =
    timeoutMs ||
    Number(isReportCall ? process.env.CDAC_REPORT_REQUEST_TIMEOUT_MS : process.env.CDAC_REQUEST_TIMEOUT_MS) ||
    (isReportCall ? 60000 : 15000);

  const maxRetries = Number(process.env.CDAC_MAX_RETRIES) || 2;
  const retryBaseMs = Number(process.env.CDAC_RETRY_BASE_MS) || 500;

  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await attemptCdacCall(operation, hmisRequestType, fullBody, branchConfig, effectiveTimeout, attempt);
    } catch (err) {
      lastErr = err;
      const isLastAttempt = attempt === maxRetries + 1;
      if (isLastAttempt || !isRetryableCdacError(err)) throw err;
      const backoff = retryBaseMs * 2 ** (attempt - 1);
      console.warn(`CDAC ${operation} attempt ${attempt} failed (${err.message}) — retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  // Unreachable (the loop always either returns or throws), but keeps the
  // function's return type honest for anything statically analyzing it.
  throw lastErr;
}

async function attemptCdacCall(operation, hmisRequestType, fullBody, branchConfig, effectiveTimeout, attempt) {
  const headers = {
    'Content-Type': 'application/json',
    'HMIS-EXT-USER': process.env.CDAC_HMIS_EXT_USER || '',
    'API-ACCESS-KEY': resolveApiAccessKey(hmisRequestType, branchConfig) || '',
  };
  const token = await getCdacToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);

  const startedAt = Date.now();
  let httpStatus = null;
  let responseBody = null;
  let success = false;
  let errorMessage = null;

  try {
    const res = await fetch(cdacUrl(operation), {
      method: 'POST',
      headers,
      body: JSON.stringify(fullBody),
      signal: controller.signal,
    });
    httpStatus = res.status;

    const text = await res.text();
    try { responseBody = text ? JSON.parse(text) : null; } catch { responseBody = { raw: text }; }

    if (!res.ok) {
      const err = new Error(`CDAC ${operation} returned HTTP ${res.status}: ${text.slice(0, 500)}`);
      err.cdacHttpStatus = res.status;
      throw err;
    }

    // CDAC has been observed to return HTTP 200 with a top-level "status": "OK"
    // envelope even when data.Status carries an error message. The exact
    // semantics are still unconfirmed, but a production integration can't
    // silently treat a rejected payload as delivered — fail loud so the
    // caller's existing error handling (logged to last_push_error, surfaced
    // in the CDAC logs UI) actually sees it, rather than only a console.warn.
    const nestedStatus = responseBody?.data?.Status || responseBody?.data?.status;
    if (nestedStatus && /error|invalid|define/i.test(nestedStatus)) {
      const err = new Error(`CDAC ${operation} returned HTTP 200 but data.Status indicates an error: "${nestedStatus}"`);
      err.cdacDataRejected = true;
      throw err;
    }

    success = true;
    return responseBody;
  } catch (err) {
    errorMessage = err.name === 'AbortError' ? `Timed out after ${effectiveTimeout}ms` : err.message;
    throw err;
  } finally {
    clearTimeout(timer);
    await logCdacCall({
      operation,
      hmisRequestType,
      branchId: branchConfig?.branch_id,
      requestBody: fullBody,
      responseBody,
      httpStatus,
      success,
      errorMessage,
      durationMs: Date.now() - startedAt,
      attempt,
    });
  }
}

function cdacUrl(operation) {
  return `${process.env.CDAC_BASE_URL}/hmis/api/inv/IntegrationHmisPoct/${operation}`;
}

// ── API 7 — master data pull ────────────────────────────────────────────────
export async function getHmisHospMapDataRowData(hospMappingCode, branchConfig) {
  return callCdac('getHmisHospMapDataRowData', {
    hmis_hosp_mapping_code: hospMappingCode,
  }, { branchConfig });
}

// ── API 1 — patient + investigation pull ────────────────────────────────────
export async function getPatDemographicInvestigationDtls({ hospMappingCode, patCrNo }, branchConfig) {
  return callCdac('patDemographicInvestigationDtls', {
    hmis_hosp_mapping_code: hospMappingCode,
    hmis_patCrNo: patCrNo,
  }, { branchConfig });
}

// ── API 2 — sample collected push ───────────────────────────────────────────
export async function pushSampleCollectionAndRequisitionDtls(
  { hospMappingCode, patCrNo, episodeCode, episodeVisitNo, investigationData },
  branchConfig
) {
  return callCdac('patSampleCollectionAndRequisitionDtls', {
    hmis_hosp_mapping_code: hospMappingCode,
    hmis_patCrNo: patCrNo,
    hmis_episode_code: episodeCode,
    hmis_episode_visitno: episodeVisitNo,
    investigation_data: investigationData,
  }, { branchConfig });
}

// ── API 3 — overall status push (e.g. AUTHORIZED) ───────────────────────────
export async function pushInvestigationStatusUpdateDtls({ hospMappingCode, patCrNo, investigationData }, branchConfig) {
  return callCdac('patInvestigationStatusUpdateDtls', {
    hmis_hosp_mapping_code: hospMappingCode,
    hmis_patCrNo: patCrNo,
    investigation_data: investigationData,
  }, { branchConfig });
}

// ── API 4 — re-view a requisition ───────────────────────────────────────────
export async function getInvestigationViewDtls({ hospMappingCode, patCrNo, investigationData }, branchConfig) {
  return callCdac('patInvestigationViewDtls', {
    hmis_hosp_mapping_code: hospMappingCode,
    hmis_patCrNo: patCrNo,
    investigation_data: investigationData,
  }, { branchConfig });
}

// ── API 5 — final PDF report push ───────────────────────────────────────────
export async function pushInvestigationReportDtls({ hospMappingCode, patCrNo, investigationData }, branchConfig) {
  return callCdac('patInvestigationReportDtls', {
    hmis_hosp_mapping_code: hospMappingCode,
    hmis_patCrNo: patCrNo,
    investigation_data: investigationData,
  }, { branchConfig });
}

// ── API 31 — parameter-level result values push ─────────────────────────────
export async function pushInvestigationStatusUpdateDtlsRowData(
  { hospMappingCode, patCrNo, investigationData },
  branchConfig
) {
  return callCdac('patInvestigationStatusUpdateDtlsRowData', {
    hmis_hosp_mapping_code: hospMappingCode,
    hmis_patCrNo: patCrNo,
    investigation_data: investigationData,
  }, { branchConfig });
}
