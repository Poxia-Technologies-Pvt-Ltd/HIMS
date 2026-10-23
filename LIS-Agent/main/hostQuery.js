// Two-way analyzer interface (tender #25): when an analyzer asks the LIS "what is to be run on this
// sample?", answer it with the order — patient and tests — instead of only acknowledging.
//
//   HL7  ORM^O01 query   → ORR^O02 with PID / ORC / OBR
//   HL7  QRY^Q02         → DSR^Q03 with the patient and the test codes
//   ASTM Q record        → H / P / O / L records, sent back with the ENQ-ACK handshake
//                          (L|1|I "no information" when there is no such order)
//
// The order comes from the server (and from this machine's saved copy of today's orders when the
// network is down), through the same lookup the result path uses, so the analyzer always sees what
// the LIMS would match its result to.
const axios = require('./apiClient');
const db = require('../db/sqlite');

const ENQ = 0x05; const ACK = 0x06; const NAK = 0x15; const STX = 0x02; const ETX = 0x03; const EOT = 0x04;
const VT = Buffer.from([0x0b]); const FS = Buffer.from([0x1c]); const CR = Buffer.from([0x0d]);

const ts = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const clean = (v) => String(v ?? '').replace(/[|^~\\&\r\n]/g, ' ').trim();
const hl7Date = (d) => (d ? String(new Date(d).toISOString().slice(0, 10)).replace(/-/g, '') : '');
const SEX = { male: 'M', m: 'M', female: 'F', f: 'F', other: 'O', o: 'O' };
const sexOf = (g) => SEX[String(g || '').trim().toLowerCase()] || 'U';

/** Looks up what is ordered on a specimen: { found, sampleId, patient, tests[] }. */
async function lookupOrder(sampleId, { fetch = axios } = {}) {
  const id = String(sampleId || '').trim();
  if (!id) return { found: false, sampleId: id, tests: [] };
  try {
    const r = await fetch.get(`/api/lab/worklist-by-id/${encodeURIComponent(id)}`, { params: { all: 1 }, timeout: 5000 });
    if (r.data?.success) {
      const t = r.data.test || {}; const p = r.data.patient || {};
      const tests = (r.data.tests && r.data.tests.length ? r.data.tests : [t]).map((x) => ({ bill_item_id: x.bill_item_id, test_name: x.test_name, code: x.test_code || x.loinc_code || x.test_name }));
      const name = t.patient_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
      return { found: true, sampleId: t.sample_id || id, patient: { id: p.reg_no || '', name, sex: sexOf(p.gender), dob: p.dob || null, priority: p.priority }, tests };
    }
    return { found: false, sampleId: id, tests: [] }; // the server answered: no such order
  } catch {
    const c = await db.getCachedWorklistEntry(id).catch(() => null);
    if (c) return { found: true, sampleId: id, offline: true, patient: { id: '', name: c.patient_name || '', sex: 'U', dob: null }, tests: [{ bill_item_id: c.bill_item_id, test_name: c.test_name, code: c.test_name }] };
    return { found: false, sampleId: id, tests: [] };
  }
}

// ── HL7 ──────────────────────────────────────────────────────────────────────────────────────
const segs = (m) => String(m).replace(/\r\n/g, '\r').replace(/\n/g, '\r').split('\r').map((s) => s.trim()).filter(Boolean);

/**
 * Recognises a query. ORM^O01 without any OBX/OBR result content, or QRY^Q02 / QRY^Q01.
 * Returns { kind, controlId, sampleId, sendingApp, sendingFac, qrd, qrf, version } or null.
 */
function parseHl7Query(message) {
  const lines = segs(message);
  const msh = (lines.find((s) => s.startsWith('MSH|')) || '').split('|');
  const type = msh[8] || '';
  const base = { controlId: msh[9] || '', sendingApp: msh[2] || '', sendingFac: msh[3] || '', version: msh[11] || '2.3.1' };
  if (/^QRY\^Q0[12]/.test(type)) {
    const qrd = lines.find((s) => s.startsWith('QRD|'));
    const f = qrd ? qrd.split('|') : [];
    const sampleId = clean((f[8] || '').split('^')[0]) || clean((f[9] || '').split('^')[0]);
    return { ...base, kind: 'QRY', sampleId, qrd: qrd || null, qrf: lines.find((s) => s.startsWith('QRF|')) || null };
  }
  if (/^ORM\^O01/.test(type) && !lines.some((s) => s.startsWith('OBX|'))) {
    const orc = lines.find((s) => s.startsWith('ORC|'));
    const obr = lines.find((s) => s.startsWith('OBR|'));
    const sampleId = clean((orc ? orc.split('|')[3] : '') || (obr ? obr.split('|')[3] : '') || (orc ? orc.split('|')[2] : ''));
    return { ...base, kind: 'ORM', sampleId };
  }
  return null;
}

function buildHl7Response(q, order) {
  const head = (type) => `MSH|^~\\&|LIMS||${q.sendingApp}|${q.sendingFac}|${ts()}||${type}|${q.controlId}|P|${q.version || '2.3.1'}||||||UNICODE`;
  const ack = (code) => `MSA|${code}|${q.controlId}`;
  if (q.kind === 'QRY') {
    const out = [head('DSR^Q03'), ack(order.found ? 'AA' : 'AA'), `ERR|${order.found ? '0' : '^^^'}`];
    if (q.qrd) out.push(q.qrd);
    if (q.qrf) out.push(q.qrf);
    if (order.found) {
      let n = 1;
      const dsp = (v) => out.push(`DSP|${n++}||${v}|||`);
      dsp(clean(order.patient?.id)); dsp(clean(order.sampleId)); dsp(clean(order.patient?.name)); dsp(hl7Date(order.patient?.dob)); dsp(order.patient?.sex || 'U');
      for (const t of order.tests) dsp(`${clean(t.code)}^${clean(t.test_name)}`);
    }
    out.push('DSC||');
    return `${out.join('\r')}\r`;
  }
  // ORM^O01 query → ORR^O02
  const out = [head('ORR^O02'), ack('AA')];
  if (order.found) {
    out.push(`PID|1||${clean(order.patient?.id)}||${clean(order.patient?.name).split(' ').reverse().join('^')}||${hl7Date(order.patient?.dob)}|${order.patient?.sex || 'U'}`);
    order.tests.forEach((t, i) => {
      out.push(`ORC|OK|${clean(order.sampleId)}|${clean(order.sampleId)}`);
      out.push(`OBR|${i + 1}|${clean(order.sampleId)}|${clean(order.sampleId)}|${clean(t.code)}^${clean(t.test_name)}|||${ts()}`);
    });
  }
  return `${out.join('\r')}\r`;
}

/** Answers an HL7 query; returns the message text to send back (without MLLP framing), or null. */
async function answerHl7Query(message, { lookup = lookupOrder } = {}) {
  const q = parseHl7Query(message);
  if (!q) return null;
  const order = await lookup(q.sampleId);
  return buildHl7Response(q, order);
}
const mllp = (text) => Buffer.concat([VT, Buffer.from(text, 'utf8'), FS, CR]);

// ── ASTM ─────────────────────────────────────────────────────────────────────────────────────
/** The specimen asked about in a Q record, or null when the transmission is not a query. */
function astmQuerySampleId(records) {
  for (const r of records || []) {
    const f = String(r).split('|');
    if ((f[0] || '').trim().toUpperCase() !== 'Q') continue;
    const range = (f[2] || '').split('^');
    const id = (range.length > 1 ? range[1] : range[0]).trim().replace(/^\^+/, '');
    if (id && id.toUpperCase() !== 'ALL') return id;
  }
  return null;
}
const hasResults = (records) => (records || []).some((r) => /^R\|/i.test(String(r).trim()));

function buildAstmRecords(order, { sender = 'LIMS' } = {}) {
  const t = ts();
  const records = [`H|\\^&|||${sender}|||||||P|1394-97|${t}`];
  if (!order.found) { records.push('L|1|I'); return records; }
  const name = clean(order.patient?.name).split(' ');
  const last = name.length > 1 ? name[name.length - 1] : name[0] || '';
  const first = name.length > 1 ? name.slice(0, -1).join(' ') : '';
  records.push(`P|1||${clean(order.patient?.id)}|${clean(order.sampleId)}|${last}^${first}||${hl7Date(order.patient?.dob)}|${order.patient?.sex || 'U'}`);
  const ids = order.tests.map((x) => `^^^${clean(x.code)}`).join('\\');
  const priority = /stat/i.test(order.patient?.priority || '') ? 'S' : /urgent/i.test(order.patient?.priority || '') ? 'A' : 'R';
  records.push(`O|1|${clean(order.sampleId)}||${ids}|${priority}|${t}|||||N||||||||||||||O`);
  records.push('L|1|N');
  return records;
}

const checksum = (bytes) => (bytes.reduce((a, b) => a + b, 0) & 0xff).toString(16).toUpperCase().padStart(2, '0');
function astmFrames(records) {
  return records.map((rec, i) => {
    const body = Buffer.concat([Buffer.from(String((i + 1) % 8)), Buffer.from(rec, 'latin1'), Buffer.from([0x0d, ETX])]);
    return Buffer.concat([Buffer.from([STX]), body, Buffer.from(checksum([...body]), 'ascii'), Buffer.from([0x0d, 0x0a])]);
  });
}

// Waits for one handshake byte (ACK/NAK) from the analyzer.
function nextHandshake(port, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { port.removeListener('data', onData); resolve(null); }, ms);
    const onData = (chunk) => {
      for (const b of chunk) {
        if (b === ACK || b === NAK) { clearTimeout(timer); port.removeListener('data', onData); resolve(b); return; }
      }
    };
    port.on('data', onData);
  });
}
const write = (port, buf) => new Promise((resolve, reject) => port.write(buf, (e) => (e ? reject(e) : resolve())));

/** Sends records to the analyzer: ENQ, each frame (one retry on NAK), EOT. Returns true when delivered. */
async function sendAstm(port, records, { timeout = 8000 } = {}) {
  const wait = nextHandshake(port, timeout);
  await write(port, Buffer.from([ENQ]));
  if ((await wait) !== ACK) return false;
  for (const frame of astmFrames(records)) {
    let delivered = false;
    for (let attempt = 0; attempt < 3 && !delivered; attempt++) {
      const w = nextHandshake(port, timeout);
      // eslint-disable-next-line no-await-in-loop
      await write(port, frame);
      // eslint-disable-next-line no-await-in-loop
      delivered = (await w) === ACK;
    }
    if (!delivered) { await write(port, Buffer.from([EOT])).catch(() => {}); return false; }
  }
  await write(port, Buffer.from([EOT]));
  return true;
}

/** If this ASTM transmission is a host query, answers it and returns true (the caller then skips result processing). */
async function answerAstmQuery(port, records, { lookup = lookupOrder, send = sendAstm } = {}) {
  const sampleId = astmQuerySampleId(records);
  if (!sampleId) return false;
  const order = await lookup(sampleId);
  const ok = await send(port, buildAstmRecords(order));
  console.log(`🔁 ASTM host query for "${sampleId}": ${order.found ? `${order.tests.length} test(s) sent` : 'no order'}${ok ? '' : ' — analyzer did not accept the reply'}`);
  return !hasResults(records);
}

module.exports = {
  lookupOrder, parseHl7Query, buildHl7Response, answerHl7Query, mllp,
  astmQuerySampleId, buildAstmRecords, astmFrames, sendAstm, answerAstmQuery,
};
