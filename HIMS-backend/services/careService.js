/**
 * Care HIMS (CARE) outbound API client — mirrors cdacService.js's callCdac
 * shared-caller shape, adapted for CARE's Gateway_Bearer JWT + X-Gateway-Id
 * auth instead of a static API key.
 */
import db from '../config/db.js';
import { signGatewayJwt } from './careAuthService.js';

export function getBranchCareConfig(branchId) {
  return db.query(`SELECT * FROM branch_hmis_config WHERE branch_id = ? LIMIT 1`, [branchId])
    .then(([[row]]) => row || null);
}

/**
 * Resolves "the" active CARE branch. Only one facility+gateway is provisioned
 * in CARE's UAT today — if a second Ramgarh branch ever needs its own CARE
 * integration, confirm with Care HIMS/CARE admin whether it needs its own
 * gateway registration before extending this to pick among several.
 */
export async function resolveActiveCareBranch() {
  const [rows] = await db.query(
    `SELECT * FROM branch_hmis_config WHERE integration_type = 'CARE' AND is_active = 1`
  );
  if (rows.length === 0) {
    const err = new Error('No active CARE-configured branch found in branch_hmis_config');
    err.status = 503;
    throw err;
  }
  if (rows.length > 1) {
    const err = new Error(
      `${rows.length} active CARE-configured branches found — CARE only supports one gateway per service today; confirm branch/gateway disambiguation with Care HIMS before enabling a second`
    );
    err.status = 500;
    throw err;
  }
  return rows[0];
}

async function logCareCall({
  operation, direction, careLabOrderId, billItemId, fillerOrderNumber, branchId,
  requestBody, responseBody, httpStatus, success, errorMessage, durationMs,
}) {
  try {
    await db.query(
      `INSERT INTO care_integration_logs
        (operation, direction, care_lab_order_id, bill_item_id, filler_order_number, branch_id,
         request_payload, response_payload, http_status, success, error_message, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        operation, direction, careLabOrderId || null, billItemId || null, fillerOrderNumber || null, branchId || null,
        requestBody != null ? JSON.stringify(requestBody) : null,
        responseBody != null ? JSON.stringify(responseBody) : null,
        httpStatus || null, success ? 1 : 0, errorMessage || null, durationMs || null,
      ]
    );
  } catch (logErr) {
    console.error('Failed to write care_integration_logs row:', logErr.message);
  }
}

async function callCare(method, path, body, branchConfig, { operation, timeoutMs, ...logMeta } = {}) {
  const baseUrl = process.env.CARE_BACKEND_URL;
  if (!baseUrl) throw new Error('CARE_BACKEND_URL is not configured');

  const gatewayExternalId = branchConfig?.care_gateway_external_id;
  if (!gatewayExternalId) throw new Error(`Branch ${branchConfig?.branch_id} has no care_gateway_external_id configured`);

  const effectiveTimeout = timeoutMs || Number(process.env.CARE_REQUEST_TIMEOUT_MS) || 15000;
  const token = signGatewayJwt();

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Gateway_Bearer ${token}`,
    'X-Gateway-Id': gatewayExternalId,
    'Accept': 'application/json',
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);

  const startedAt = Date.now();
  let httpStatus = null;
  let responseBody = null;
  let success = false;
  let errorMessage = null;

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    httpStatus = res.status;

    const text = await res.text();
    try { responseBody = text ? JSON.parse(text) : null; } catch { responseBody = { raw: text }; }

    if (!res.ok) {
      throw new Error(`CARE ${operation} returned HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    success = true;
    return responseBody;
  } catch (err) {
    errorMessage = err.name === 'AbortError' ? `Timed out after ${effectiveTimeout}ms` : err.message;
    throw err;
  } finally {
    clearTimeout(timer);
    await logCareCall({
      operation, direction: 'OUTBOUND', branchId: branchConfig?.branch_id,
      requestBody: body, responseBody, httpStatus, success, errorMessage,
      durationMs: Date.now() - startedAt, ...logMeta,
    });
  }
}

/** API4 — list devices linked to our gateway. Diagnostic only, not part of the main flow. */
export async function getLabAnalyzerDevices(branchConfig) {
  return callCare('GET', '/api/lab_analyzer_device/communication/', null, branchConfig, { operation: 'LIST_DEVICES' });
}

/** API5 — submit ORU^R01 results. The one outbound push CARE's contract defines. */
export async function pushResultToCare({ rawMessage, senderIp }, branchConfig, logMeta = {}) {
  if (!senderIp) throw new Error('senderIp (care_sender_ip) is required to push a result to CARE');

  return callCare(
    'POST',
    '/api/lab_analyzer_device/communication/receive_result/',
    { raw_message: rawMessage, sender_ip: senderIp },
    branchConfig,
    { operation: 'PUSH_RESULT', ...logMeta }
  );
}
