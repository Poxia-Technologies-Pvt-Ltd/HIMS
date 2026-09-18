/**
 * Builds outbound HL7 v2.3 ORU^R01 messages for Care HIMS (CARE). Kept
 * separate from hl7Parser.js — parsing an inbound ORM and serializing an
 * outbound ORU are different concerns, and the parser's docstring/shape is
 * inbound-specific.
 */

const HL7_SEGMENT_TERMINATOR = '\r'; // real HL7 segment terminator, not \n — no MLLP framing since this is JSON-wrapped, not raw MLLP.

/** Escapes HL7 special characters using the standard \Xn\ escape sequences. Order matters: backslash first. */
export function hl7Escape(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/\\/g, '\\E\\')
    .replace(/\|/g, '\\F\\')
    .replace(/\^/g, '\\S\\')
    .replace(/~/g, '\\R\\')
    .replace(/&/g, '\\T\\');
}

export function hl7Timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

/**
 * Maps an inbound order's coding system (a URL, URN, or short token) to the
 * HL7 abbreviation for OBR-4. Defaults to LN (LOINC) when unset/unrecognized
 * — the common case, and the same default this always used before per-order
 * systems were tracked.
 */
export function hl7CodingSystemAbbrev(codingSystem) {
  const s = (codingSystem || '').toLowerCase();
  if (s.includes('snomed')) return 'SCT';
  if (s.includes('loinc')) return 'LN';
  if (s === 'sct' || s === 'ln') return codingSystem.toUpperCase();
  return 'LN';
}

export function mapGenderToHL7(gender) {
  const g = (gender || '').toLowerCase();
  if (g === 'male') return 'M';
  if (g === 'female') return 'F';
  if (g === 'other') return 'O';
  return 'U';
}

/**
 * Reimplements pdfGenerator.js's resolveFlag range logic standalone (rather
 * than importing it) since that function returns PDF display colors, not an
 * HL7 abnormal-flag code — the range-parsing rules must stay in sync by hand
 * if either changes.
 */
export function mapResultFlagToHL7(flag, value, referenceRange) {
  let f = (flag || 'normal').toLowerCase();

  if ((f === 'normal' || f === 'n' || !f) && referenceRange && value !== undefined && value !== null) {
    const val = parseFloat(value);
    if (!isNaN(val)) {
      const rangeMatch = String(referenceRange).match(/([0-9.]+)\s*-\s*([0-9.]+)/);
      if (rangeMatch) {
        const min = parseFloat(rangeMatch[1]);
        const max = parseFloat(rangeMatch[2]);
        if (val < min) f = 'low';
        else if (val > max) f = 'high';
      } else if (referenceRange.startsWith('<')) {
        const max = parseFloat(referenceRange.replace('<', '').trim());
        if (!isNaN(max) && val >= max) f = 'high';
      } else if (referenceRange.startsWith('>')) {
        const min = parseFloat(referenceRange.replace('>', '').trim());
        if (!isNaN(min) && val <= min) f = 'low';
      }
    }
  }

  if (['high', 'h', 'critical', 'c'].includes(f)) return 'H';
  if (['low', 'l'].includes(f)) return 'L';
  if (['abnormal', 'a'].includes(f)) return 'A';
  return 'N';
}

/**
 * Builds a complete ORU^R01 message string, ready to send as `raw_message` in
 * the CARE receive_result payload.
 *
 * @param {object} params
 * @param {string} [params.messageControlId] - defaults to `RES${hl7Timestamp()}`
 * @param {string} [params.sendingApplication] - defaults to 'EXTERNAL_HL7', matching
 *   the `type: external_hl7` our lab-analyzer device is registered under in CARE
 * @param {string} [params.sendingFacility]
 * @param {string} [params.receivingApplication]
 * @param {string} [params.receivingFacility]
 * @param {object} params.patient - { externalId, lastName, firstName, dob, gender }
 * @param {object} params.order - { placerOrderNumber, fillerOrderNumber, loincCode, loincName }
 * @param {Array}  params.results - [{ paramLoincCode, paramName, value, uom, referenceRange, resultFlag }]
 * @returns {{ rawMessage: string, messageControlId: string }}
 */
export function buildORU({
  messageControlId,
  sendingApplication = 'EXTERNAL_HL7',
  sendingFacility = 'LAB',
  receivingApplication = 'CARE',
  receivingFacility = 'CARE_FACILITY',
  patient,
  order,
  results,
}) {
  const timestamp = hl7Timestamp();
  const msgControlId = messageControlId || `RES${timestamp}`;

  const segments = [];

  segments.push(
    ['MSH', '^~\\&', sendingApplication, sendingFacility, receivingApplication, receivingFacility,
      timestamp, '', 'ORU^R01', msgControlId, 'P', '2.3'].join('|')
  );

  segments.push(
    ['PID', '1', '', `${hl7Escape(patient.externalId)}^^^^MR`, '',
      `${hl7Escape(patient.lastName)}^${hl7Escape(patient.firstName)}`, '',
      patient.dob || '', mapGenderToHL7(patient.gender)].join('|')
  );

  // OBR-4 echoes back the order's own code exactly as CARE originally sent it —
  // CARE's Activity Definitions can be SNOMED CT or LOINC ("that is expected
  // behaviour" per eGov, 2026-08-01), so this must use the order's actual
  // coding system, not assume LOINC. OBX-3 below stays LOINC regardless —
  // that's this LIS's own parameter mapping (care_loinc_parameter_map), a
  // separate concern from what coding system the order itself used.
  const orderCodingSystem = hl7CodingSystemAbbrev(order.codingSystem);
  segments.push(
    ['OBR', '1', order.placerOrderNumber, order.fillerOrderNumber,
      `${order.loincCode}^${hl7Escape(order.loincName)}^${orderCodingSystem}`, '', '', timestamp].join('|')
  );

  results.forEach((r, idx) => {
    const isNumeric = r.value !== undefined && r.value !== null && r.value !== '' && !isNaN(parseFloat(r.value));
    segments.push(
      ['OBX', String(idx + 1), isNumeric ? 'NM' : 'ST',
        `${r.paramLoincCode}^${hl7Escape(r.paramName)}^LN`, '',
        hl7Escape(r.value), r.uom || '', r.referenceRange || '',
        mapResultFlagToHL7(r.resultFlag, r.value, r.referenceRange), '', '', 'F'].join('|')
    );
  });

  return { rawMessage: segments.join(HL7_SEGMENT_TERMINATOR), messageControlId: msgControlId };
}

/**
 * Builds the HL7 ACK (MSH+MSA) CARE expects back from POST /send-order,
 * wrapped as `{"ack": "<message>"}` per eGov's 2026-07-15 clarification —
 * a bare "MSA|AA|<id>" is not accepted, and the ack must be full JSON, not
 * a raw HL7 HTTP response. Uses \n segment separators, matching their
 * literal example, unlike the \r used elsewhere in this file for MLLP-style
 * HL7 (the ack isn't MLLP-framed, and their example is explicit about \n).
 */
export function buildOrmAck(rawOrmMessage, ackCode = 'AA') {
  const segments = rawOrmMessage.split(/\r|\n/).map((s) => s.trim()).filter(Boolean);
  const msh = (segments.find((s) => s.startsWith('MSH|')) || '').split('|');

  // The inbound order's receiving app/facility (MSH-5/6) becomes our sending
  // app/facility in the ack; its sending app/facility (MSH-3/4) becomes ours
  // to receive.
  const sendingApp = msh[4] || 'EXTERNAL_HL7';
  const sendingFacility = msh[5] || 'LAB';
  const receivingApp = msh[2] || 'CARE';
  const receivingFacility = msh[3] || 'CARE_FACILITY';
  const controlId = msh[9] || '';

  const timestamp = hl7Timestamp();
  const ackControlId = `ACK${timestamp}`;

  const ackMsh = `MSH|^~\\&|${sendingApp}|${sendingFacility}|${receivingApp}|${receivingFacility}|${timestamp}||ACK|${ackControlId}|P|2.3`;
  const msa = `MSA|${ackCode}|${controlId}`;

  return `${ackMsh}\n${msa}\n`;
}
