/**
 * Care HIMS (CARE / OHC Network) protocol endpoints — the surface CARE itself
 * calls, or that CARE's admin fetches to verify us. Distinct from
 * careAdminController.js, which is our own staff-facing mapping/logs UI.
 * All patient/bill SQL lives in services/careMapper.js now.
 */
import { resolveActiveCareBranch } from '../services/careService.js';
import { mapCareOrderToLocalBill } from '../services/careMapper.js';
import { parseORM } from '../utils/hl7Parser.js';
import { buildOrmAck } from '../utils/hl7Builder.js';
import { getGatewayPublicJwk } from '../services/careAuthService.js';
import db from '../config/db.js';

// POST /send-order — CARE pushes an HL7 ORM^O01 order to us. Per eGov's
// 2026-07-15 clarification, the response must be `{"ack": "<full HL7 ACK>"}`
// with HTTP 200 on success, or `{"error": "..."}` with a non-2xx status on
// failure — not the {success, message, ...} shape this used to return.
export const receiveOrder = async (req, res) => {
  const startedAt = Date.now();
  const { raw_message, device_ip, port, orm_mode } = req.body;

  if (!raw_message || typeof raw_message !== 'string') {
    return res.status(400).json({ error: 'raw_message is required and must be a string' });
  }

  const orm = parseORM(raw_message);

  if (!orm.messageControlId) {
    return res.status(400).json({ error: 'Could not parse MSH message control ID from raw_message' });
  }

  let branchConfig;
  try {
    branchConfig = await resolveActiveCareBranch();
  } catch (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: 'Server error' });
  }

  let result;
  let success = false;
  try {
    result = await mapCareOrderToLocalBill(orm, branchConfig.branch_id, {
      deviceIp: device_ip, devicePort: port, ormMode: orm_mode,
    });
    success = true;

    const invalidCount = result.invalidItems?.length || 0;
    if (!result.billId && invalidCount > 0) {
      // Nothing usable was received — every line was malformed.
      return res.status(400).json({ error: `No orders received — ${invalidCount} line(s) were missing required fields` });
    }

    // billId present (new order) or all lines were already-received replays
    // (idempotent re-delivery) — both are a success from CARE's perspective.
    return res.status(200).json({ ack: buildOrmAck(raw_message, 'AA') });
  } catch (err) {
    console.error('CARE receiveOrder error:', err);
    return res.status(err.status || 502).json({ error: err.message || 'Failed to process order' });
  } finally {
    try {
      await db.query(
        `INSERT INTO care_integration_logs
          (operation, direction, bill_item_id, filler_order_number, branch_id, request_payload, response_payload, success, duration_ms)
         VALUES ('RECEIVE_ORDER', 'INBOUND', ?, ?, ?, ?, ?, ?, ?)`,
        [
          result?.items?.[0]?.billItemId || null,
          orm.orders?.[0]?.fillerOrderNumber || null,
          branchConfig?.branch_id || null,
          JSON.stringify({ raw_message, device_ip, port, orm_mode }),
          result ? JSON.stringify(result) : null,
          success ? 1 : 0,
          Date.now() - startedAt,
        ]
      );
    } catch (logErr) {
      console.error('Failed to write care_integration_logs row for receiveOrder:', logErr.message);
    }
  }
};

// GET /openid-configuration — publish our gateway's public JWKS so CARE can
// verify Gateway_Bearer JWTs we sign for outbound calls.
export const getOpenIdConfiguration = (req, res) => {
  try {
    res.json({ keys: [getGatewayPublicJwk()] });
  } catch (err) {
    console.error('CARE getOpenIdConfiguration error:', err);
    res.status(503).json({ success: false, message: 'Gateway signing key not configured' });
  }
};

// GET /health/status — shape confirmed by CARE's own External HL7 Integration
// Guide: `{ "server": true, "database": true, "connections": {} }`, booleans
// not strings. CARE's device-monitoring UI shows separate Server/Database
// indicators, consistent with this.
export const getHealthStatus = async (req, res) => {
  let databaseOk = true;
  try {
    const connection = await db.getConnection();
    connection.release();
  } catch (err) {
    databaseOk = false;
  }

  res.json({ server: true, database: databaseOk, connections: {} });
};
