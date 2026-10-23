// Checks what an analyzer sent before any of it is committed (tender #30).
// Every interface has its own protection, and a message that fails it is never
// turned into a result — it is kept, with the reason, for a person to look at:
//   ASTM            per-frame checksum (serialManager.js, checked before parsing)
//   HL7 / MLLP      framing + message structure (validateHl7 below; HL7 has no checksum)
//   Text print-out  printable-text and size sanity (validateTextReport)
//   Binary frames   length, optional start/end bytes and checksum when the protocol
//                   declares them, and a finite result value (validateBinaryFrame)
//   Every result    parameter name / value / unit sanity, whatever the interface
//                   (validateResultRows — applied where all results are committed)
const HL7_VALUE_TYPES = new Set(['NM', 'ST', 'TX', 'FT', 'SN', 'CE', 'CWE', 'CF', 'DT', 'TM', 'TS', 'DTM', 'ED', 'RP', 'NA', 'ID', 'IS']);
const MAX_HL7 = 200_000;
// eslint-disable-next-line no-control-regex
const BAD_CONTROL = /[\x00-\x08\x0e-\x1a\x1d-\x1f]/;

const result = (problems) => ({ ok: problems.length === 0, problems });

/** An HL7 v2 message (without its MLLP envelope). */
function validateHl7(msg) {
  const problems = [];
  const text = String(msg || '');
  if (!text.trim()) return result(['the message is empty']);
  if (text.length > MAX_HL7) problems.push(`the message is unusually large (${text.length} characters)`);
  if (BAD_CONTROL.test(text)) problems.push('the message contains control characters that are not part of HL7');

  const segs = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r').split('\r').map((s) => s.trim()).filter(Boolean);
  if (!segs.length || !segs[0].startsWith('MSH|')) return result([...problems, 'it does not start with an MSH header']);

  const msh = segs[0].split('|');
  if (!/^\^~\\&/.test(msh[1] || '')) problems.push('the MSH encoding characters are missing or wrong');
  const type = msh[8] || '';
  if (!type) problems.push('MSH-9 (message type) is empty');
  if (!(msh[9] || '').trim()) problems.push('MSH-10 (message control id) is empty');
  if (msh.length < 12) problems.push('the MSH header is incomplete');

  for (const s of segs) {
    if (!/^[A-Z][A-Z0-9]{2}\|/.test(s) && !/^[A-Z][A-Z0-9]{2}$/.test(s)) { problems.push(`a segment has no valid identifier ("${s.slice(0, 12)}")`); break; }
  }

  if (/^ORU/.test(type)) {
    const obx = segs.filter((s) => s.startsWith('OBX|'));
    if (!obx.length) problems.push('a result message (ORU) with no OBX result segments');
    obx.forEach((line, i) => {
      const f = line.split('|');
      const label = `OBX ${i + 1}`;
      if (f.length < 6) { problems.push(`${label} is incomplete`); return; }
      if (f[2] && !HL7_VALUE_TYPES.has(f[2].trim())) problems.push(`${label} has an unknown value type "${f[2]}"`);
      if (!(f[3] || '').trim()) problems.push(`${label} has no observation identifier`);
      if (f[2]?.trim() === 'NM' && f[5] !== undefined && f[5].trim() !== '' && !Number.isFinite(Number(f[5]))) problems.push(`${label} is numeric (NM) but the value "${f[5]}" is not a number`);
    });
  }
  return result(problems.slice(0, 6));
}

/** A text print-out captured from a serial port. Noise on the line shows up as unprintable bytes. */
function validateTextReport(raw) {
  const text = String(raw || '');
  const problems = [];
  if (text.trim().length < 8) return result(['the report is too short to be a result']);
  if (text.length > 100_000) problems.push('the report is unusually large');
  const printable = text.replace(/[\r\n\t]/g, '').split('').filter((c) => c >= ' ' && c <= '~').length;
  const total = text.replace(/[\r\n\t]/g, '').length || 1;
  if (printable / total < 0.85) problems.push('too much of the report is unreadable (line noise or the wrong settings?)');
  return result(problems);
}

const CHECKSUMS = {
  sum8: (b) => b.reduce((a, x) => (a + x) & 0xff, 0),
  xor8: (b) => b.reduce((a, x) => a ^ x, 0),
};

/**
 * A fixed binary frame. `protocol.frame_structure` may declare start_byte / end_byte and a
 * checksum ({ type: 'sum8' | 'xor8', offset, from, to }); whatever is declared is enforced.
 */
function validateBinaryFrame(frame, protocol) {
  const problems = [];
  const fs = protocol?.frame_structure || {};
  if (frame.length < 22) problems.push(`the frame is too short (${frame.length} bytes)`);
  if (fs.start_byte !== undefined && frame[0] !== Number(fs.start_byte)) problems.push('the frame does not start with the expected byte');
  if (fs.end_byte !== undefined && frame[frame.length - 1] !== Number(fs.end_byte)) problems.push('the frame does not end with the expected byte');
  const cs = fs.checksum;
  if (cs && CHECKSUMS[cs.type] && frame.length > (cs.offset ?? frame.length - 1)) {
    const offset = cs.offset ?? frame.length - 1;
    const expected = CHECKSUMS[cs.type](frame.subarray(cs.from ?? 0, cs.to ?? offset));
    if (frame[offset] !== expected) problems.push(`the frame checksum is wrong (got ${frame[offset]}, expected ${expected})`);
  }
  if (frame.length >= 13) {
    const v = frame.readFloatBE(9);
    if (!Number.isFinite(v)) problems.push('the result value in the frame is not a valid number');
  }
  return result(problems);
}

/**
 * The results about to be committed, whatever interface they came from. Returns the usable rows
 * and the reasons any were dropped. `ok` is false when nothing usable is left.
 */
function validateResultRows(rows) {
  const problems = [];
  const clean = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const name = String(r?.parameter_name ?? r?.test_name ?? '').trim();
    const value = r?.result_value ?? r?.value;
    const v = value === undefined || value === null ? '' : String(value).trim();
    if (!name || name.length > 200) { problems.push('a result has no valid parameter name'); continue; }
    if (v === '') { problems.push(`"${name}" has no value`); continue; }
    if (v.length > 200 || BAD_CONTROL.test(v)) { problems.push(`"${name}" has an unreadable value`); continue; }
    if (/^(nan|infinity|-infinity|undefined|null)$/i.test(v)) { problems.push(`"${name}" has an invalid value (${v})`); continue; }
    if (String(r?.unit ?? '').length > 50) { problems.push(`"${name}" has an invalid unit`); continue; }
    clean.push(r);
  }
  return { ok: clean.length > 0, rows: clean, problems: problems.slice(0, 6) };
}

module.exports = { validateHl7, validateTextReport, validateBinaryFrame, validateResultRows };
