const { SerialPort } = require('serialport');
const axios = require('./apiClient');
const db = require('../db/sqlite');
const resultQueue = require('./resultQueue');
const { resolveWorklistEntry } = require('./worklistResolver');

function postAnalyzerEvent(machine, event) {
  axios.post(`/api/lab/analyzer-event`, {
    machine_id:   machine.unique_id || machine.id || '',
    machine_name: machine.analyzer_name || machine.name || '',
    model:        machine.model || '',
    lab_id:       machine.lab_id || null,
    port:         machine.port || '',
    event,
  }).catch(err => console.warn(`⚠️  Could not log analyzer event (${event}):`, err.message));
}

// path -> SerialPort instance
const activePorts = new Map();

// path -> true  (set IMMEDIATELY when we decide to open, before port.open fires)
// This is the real guard against double-init races
const pendingPorts = new Set();
const silenceTimers = new Map();
let reconnectTimer = null;
let mainWindow = null;

// patientId -> { testId, sampleId, results, ... }  [binary machines]
// code       -> { testId, sampleId, results, ... }  [CelQuant Edge / HL7]
const sessionAccumulator = new Map();

// machineId -> testInfo (set via Run Test in Worklist UI)
const manualContexts = new Map();

function setManualContext(testInfo) {
  if (testInfo && testInfo.machineId) {
    const id = testInfo.machineId.toString();
    console.log(`📌 Manual context set for machine ${id} -> Sample ${testInfo.sampleId}`);
    manualContexts.set(id, testInfo);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HL7 PARSER  (ported from Merilyzer CelQuant Edge Python implementation)
// Key:  OBR field[3] "code" is used as the session identifier, NOT patient ID
// ─────────────────────────────────────────────────────────────────────────────

const CBC_PARAMS = [
  'WBC', 'Lymph#', 'Mid#', 'Gran#',
  'Lymph%', 'Mid%', 'Gran%',
  'RBC', 'HGB', 'HCT', 'MCV',
  'MCH', 'MCHC', 'RDW-CV', 'RDW-SD',
  'PLT', 'MPV', 'PDW', 'PCT',
  'P-LCC', 'P-LCR',
];

const ELECTROLYTE_PARAMS = ['Na', 'K', 'iCa', 'Cl', 'pH', 'Li'];
const LAURA_SMART_PARAMS = ['BLD', 'LEU', 'BIL', 'UBG', 'KET', 'GLU', 'PRO', 'pH', 'NIT', 'SG'];

// LOINC code → parameter name
const CODE_MAP = {
  '6690-2': 'WBC',
  '731-0': 'Lymph#',
  '10027': 'Mid#',
  '10028': 'Gran#',
  '736-9': 'Lymph%',
  '10029': 'Mid%',
  '10030': 'Gran%',
  '789-8': 'RBC',
  '718-7': 'HGB',
  '4544-3': 'HCT',
  '787-2': 'MCV',   // may also be HCT — resolved below by label
  '785-6': 'MCH',
  '786-4': 'MCHC',
  '788-0': 'RDW-CV',
  '70-5': 'RDW-SD',
  '21000-5': 'RDW-SD',
  '777-3': 'PLT',
  '32623-1': 'MPV',
  '32207-3': 'PDW',
  '10002': 'PCT',
  '10013': 'P-LCC',
  '10014': 'P-LCR',
};

// Text label → parameter name  (lowercased, spaces stripped)
const LABEL_MAP = {
  'wbc': 'WBC',
  'lymph#': 'Lymph#',
  'lym#': 'Lymph#',
  'mid#': 'Mid#',
  'gran#': 'Gran#',
  'lymph%': 'Lymph%',
  'lym%': 'Lymph%',
  'mid%': 'Mid%',
  'gran%': 'Gran%',
  'rbc': 'RBC',
  'hgb': 'HGB',
  'hb': 'HGB',
  'hct': 'HCT',
  'mcv': 'MCV',
  'mch': 'MCH',
  'mchc': 'MCHC',
  'rdw-cv': 'RDW-CV',
  'rdw-sd': 'RDW-SD',
  'plt': 'PLT',
  'mpv': 'MPV',
  'pdw': 'PDW',
  'pct': 'PCT',
  'p-lcc': 'P-LCC',
  'p-lcr': 'P-LCR',
};

/**
 * Parse a raw HL7 string from the CelQuant Edge analyzer.
 *
 * Returns an object with:
 *   - case_id, code, bed_no, name, sex, age, age_unit
 *   - mode, test_mode, timestamp
 *   - one key per CBC_PARAMS entry: { value, unit, range, flag } | null
 *
 * SESSION KEY → result.code  (OBR segment, field 3)
 */
function parseHL7(raw) {
  const result = {
    case_id: '',
    code: '',
    bed_no: '',
    name: '',
    sex: '',
    age: '',
    age_unit: '',
    mode: '',
    test_mode: '',
    timestamp: null,
  };

  for (const p of CBC_PARAMS) result[p] = null;

  // Normalise line endings
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // ── MSH ──────────────────────────────────────────────────────────────
    if (line.startsWith('MSH|')) {
      const f = line.split('|');
      if (f.length > 6) {
        try {
          const ts = f[6].slice(0, 14);   // YYYYMMDDHHmmss
          result.timestamp = new Date(
            `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T` +
            `${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}`
          );
        } catch (_) { /* ignore bad timestamp */ }
      }
      continue;
    }

    // ── PID ──────────────────────────────────────────────────────────────
    if (line.startsWith('PID|')) {
      const f = line.split('|');

      // Name  (field 5, caret-delimited)
      if (f.length > 5) {
        result.name = f[5].split('^').filter(Boolean).join(' ').trim();
      }

      // Sex  (field 8)
      if (f.length > 8) {
        const sexMap = { M: 'Male', F: 'Female', U: 'Unknown' };
        result.sex = sexMap[f[8].trim().toUpperCase()] ?? f[8].trim();
      }

      // Age — calculated from DOB  (field 7, YYYYMMDD)
      if (f.length > 7 && f[7].trim().length >= 8) {
        try {
          const dob = f[7].trim().slice(0, 8);
          const birth = new Date(`${dob.slice(0, 4)}-${dob.slice(4, 6)}-${dob.slice(6, 8)}`);
          const now = new Date();
          let age = now.getFullYear() - birth.getFullYear();
          const notHadBirthday =
            now.getMonth() < birth.getMonth() ||
            (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
          if (notHadBirthday) age -= 1;
          result.age = String(age);
          result.age_unit = 'yr';
        } catch (_) { /* ignore */ }
      }
      continue;
    }

    // ── OBR ──────────────────────────────────────────────────────────────
    if (line.startsWith('OBR|')) {
      const f = line.split('|');

      // Case ID  (field 2, before first caret)
      if (f.length > 2) result.case_id = f[2].split('^')[0].trim();

      // Code — SESSION KEY for CelQuant Edge  (field 3, before first caret)
      if (f.length > 3) result.code = f[3].split('^')[0].trim();

      // Bed No  (field 18, before first caret)
      if (f.length > 18) result.bed_no = f[18].split('^')[0].trim();

      continue;
    }

    // ── OBX ──────────────────────────────────────────────────────────────
    if (!line.startsWith('OBX|')) continue;

    const f = line.split('|');
    if (f.length < 6) continue;

    const obxType = f[2].trim();
    if (obxType === 'ED') continue;   // skip histogram binary blobs

    const idField = f[3].trim();
    const value = f[5].trim();
    const unit = f.length > 6 ? f[6].trim() : '';
    const refRange = f.length > 7 ? f[7].trim() : '';
    const flag = f.length > 8 ? f[8].trim() : '';

    const idParts = idField.split('^');
    const code = idParts[0].trim();
    const label = idParts.length > 1 ? idParts[1].trim().toLowerCase() : '';

    // ── Mode  (08001) ──────────────────────────────────────────────────
    if (code.includes('08001')) {
      const modeMap = { O: 'Whole Blood', C: 'Capillary', P: 'Pre-diluted' };
      result.mode = modeMap[value] ?? value;
      continue;
    }

    // ── Test Mode  (08003) ────────────────────────────────────────────
    if (code.includes('08003')) {
      const tmMap = { W: 'CBC+Diff', C: 'CBC', D: 'Diff' };
      result.test_mode = tmMap[value] ?? value;
      continue;
    }

    // ── Age from OBX ─────────────────────────────────────────────────
    if (label.includes('age')) {
      result.age = value;
      result.age_unit = unit;
      continue;
    }

    // Skip non-numeric values
    if (!value || isNaN(parseFloat(value))) continue;

    // ── Resolve parameter name ────────────────────────────────────────
    let paramName = null;

    // 1. Match by LOINC code (exact or prefix)
    for (const [mc, pn] of Object.entries(CODE_MAP)) {
      if (code === mc || code.startsWith(mc)) {
        paramName = pn;
        break;
      }
    }

    // 2. Fall back to text label
    if (!paramName) {
      paramName = LABEL_MAP[label.replace(/\s+/g, '')] ?? null;
    }

    if (!paramName) continue;

    // ── HCT / MCV ambiguity fix for LOINC 787-2 ──────────────────────
    if (code.includes('787-2')) {
      paramName = label.includes('hct') ? 'HCT' : 'MCV';
    }

    result[paramName] = { value, unit, range: refRange, flag };
  }

  console.log("DEBUG parseLauraSmartReport returning:", result); return result;
}


// ─────────────────────────────────────────────────────────────────────────────
// TEXT REPORT PARSER  (HDC-Lyte Plus electrolyte analyzer)
// Key:  "Patient ID" field is used as the session identifier
// ─────────────────────────────────────────────────────────────────────────────


/**
 * Parse a raw text report from the HDC-Lyte Plus analyzer.
 *
 * Returns an object with:
 *   - date_time: extracted date string
 *   - one key per ELECTROLYTE_PARAMS entry: { value, unit } | null
 */
function parseLauraSmartReport(raw) {
  const result = {
    patient_name: '',
    patient_id: '',
    date_time: '',
  };

  for (const p of LAURA_SMART_PARAMS) result[p] = null;

  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('Seq.No:')) {
      if (!result.patient_id) {
        result.patient_id = line.substring(7).trim();
      }
      continue;
    }

    if (line.startsWith('ID:')) {
      const idVal = line.substring(3).trim();
      if (idVal) {
        result.patient_id = idVal;
      }
      continue;
    }

    if (/^\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}/.test(line)) {
      result.date_time = line;
      continue;
    }

    // Strip leading asterisks which the machine uses to flag abnormal values
    const cleanLine = line.replace(/^\*/, '').trim();

    for (const param of LAURA_SMART_PARAMS) {
      if (cleanLine.startsWith(param)) {
        const val = cleanLine.substring(param.length).trim();
        result[param] = {
          value: val,
          unit: '' 
        };
        break;
      }
    }
  }

  return result;
}

/**
 * Parse a raw text report from the HDC-Lyte Plus analyzer.
 *
 * Returns an object with:
 *   - patient_name, patient_id, date_time
 *   - one key per ELECTROLYTE_PARAMS entry: { value, unit } | null
 *
 * SESSION KEY → result.patient_id
 */
function parseTextReport(raw) {
  const result = {
    patient_name: '',
    patient_id: '',
    date_time: '',
  };

  for (const p of ELECTROLYTE_PARAMS) result[p] = null;

  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Header: Date time
    const dt = line.match(/Date.*time:\s*(.*)/i);
    if (dt) { result.date_time = dt[1].trim(); continue; }

    // (User requested to strictly skip Patient ID, Name, and Sample No from the raw text for HDC-LYTE PRO)

    // Parameter values: PARAM = VALUE
    for (const param of ELECTROLYTE_PARAMS) {
      // Escape special regex chars in param name (e.g. no issue here, but safe)
      const escaped = param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\s*=\\s*([^\\s]+)`, 'i');
      const match = line.match(regex);
      if (match) {
        const testDef = null; // unit/range come from protocol JSON at sync time
        result[param] = {
          value: match[1].trim(),
          unit: param === 'pH' ? '' : 'mmol/L',
        };
        break;
      }
    }
  }

  return result;
}


// ─────────────────────────────────────────────────────────────────────────────
// ASTM E1394 OVER SERIAL — NIHON KOHDEN CelltacEs
// Half-duplex, checksum-framed (STX FrameNo Record CR ETX Checksum CR LF),
// ENQ/ACK handshake, EOT ends the transmission. Unlike AutoQuant's ASTM over
// TCP (tcpManager.js's startASTMServer), this analyzer never queries us for
// patient/order info — it only ever sends P (sample ID) and R (result)
// records, so no H/O/L response-building is needed. Ported from the
// reference client at celltac.py.
// ─────────────────────────────────────────────────────────────────────────────
const ASTM_ENQ = 0x05;
const ASTM_ACK = 0x06;
const ASTM_NAK = 0x15;
const ASTM_STX = 0x02;
const ASTM_ETX = 0x03;
const ASTM_EOT = 0x04;
const ASTM_CR = 0x0d;

function astmChecksum(frameWithStx) {
  // STX is not included in the checksum — sum runs from the frame-number
  // byte through ETX inclusive.
  const data = frameWithStx[0] === ASTM_STX ? frameWithStx.slice(1) : frameWithStx;
  let total = 0;
  for (const b of data) total += b;
  return (total & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

function astmCleanTestName(raw) {
  if (!raw) return '';
  const trimmed = raw.trim().replace(/^\^+|\^+$/g, '');
  const candidates = trimmed
    .split('^')
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('2A') && p.toUpperCase() !== 'JC10');
  if (candidates.length === 0) return '';
  // NE# -> NE, NE% stays NE% — only a trailing "#" (absolute-count marker)
  // is stripped, matching the reference client.
  let name = candidates[candidates.length - 1];
  if (name.endsWith('#')) name = name.slice(0, -1);
  return name.toUpperCase();
}

function astmNormalizeUnit(raw) {
  if (!raw) return '';
  const unit = raw.trim().split('^')[0].trim();
  const lower = unit.toLowerCase();
  if (lower === '10e3/ul' || lower === '10^3/ul') return '10³/µL';
  if (lower === '10e6/ul' || lower === '10^6/ul') return '10⁶/µL';
  if (lower === 'ul') return 'µL';
  return unit;
}

// Parses one ASTM record ('P' or 'R') into the accumulator state for the
// transmission currently in progress. Unknown record types (H/C/L/etc.) are
// ignored — there's nothing in them this analyzer's flow needs.
function astmParseRecord(record, state) {
  const fields = record.split('|');
  const type = (fields[0] || '').trim().toUpperCase();

  if (type === 'P') {
    // P|1|||SampleID|...
    if (fields.length >= 5 && fields[4].trim()) state.sampleId = fields[4].trim();
    return;
  }

  if (type !== 'R' || fields.length < 3) return;

  const testName = astmCleanTestName(fields[2]);
  if (!testName) return;

  let value = fields.length > 3 ? fields[3].trim() : '';
  const unit = fields.length > 4 ? astmNormalizeUnit(fields[4]) : '';
  const reference = fields.length > 5 ? fields[5].trim() : '';
  let flag = fields.length > 6 ? fields[6].trim().replace(/^\^+|\^+$/g, '') : '';

  // OVER can show up in a later field instead of directly in field 6.
  if (!value) {
    for (const f of fields.slice(6)) {
      const upper = f.trim().toUpperCase();
      if (upper === 'OVER' || upper.includes('^OVER')) {
        value = 'OVER';
        flag = 'OVER';
        break;
      }
    }
  }

  // L/H/LL/HH/A/AA/OVER flags can also show up in a later field instead of
  // directly in field 6.
  if (!flag) {
    for (const f of fields.slice(6)) {
      const testFlag = f.trim().replace(/^\^+|\^+$/g, '').toUpperCase();
      if (['L', 'H', 'LL', 'HH', 'A', 'AA', 'OVER'].includes(testFlag)) {
        flag = testFlag;
        if (testFlag === 'OVER' && !value) value = 'OVER';
        break;
      }
    }
  }

  // Preserve insertion order but let a later R record for the same test
  // (unlikely, but seen on retransmits) overwrite rather than duplicate.
  state.results.set(testName, { parameter_name: testName, result_value: value, unit, ref_range: reference, flag });
}

// Called once EOT ends a transmission. Builds a session from whatever P/R
// records were collected and syncs it through the same worklist-lookup /
// manual-context / unsolicited-auto-create path every other protocol here
// uses.
async function processAstmTransmission(records, machine, win) {
  const state = { sampleId: '', results: new Map() };
  for (const rec of records) astmParseRecord(rec, state);

  if (state.results.size === 0) {
    console.log(`ℹ️  ${machine.model} — ASTM transmission had no result records. Skipping.`);
    return;
  }

  let sessionKey = state.sampleId;
  const machineId = (machine.unique_id || machine.id).toString();
  const manualInfo = manualContexts.get(machineId);

  if (manualInfo && manualInfo.sampleId) {
    console.log(`📌 MANUAL OVERRIDE: Mapping ${machine.model} report to Sample ID: ${manualInfo.sampleId} (Ignoring native ID: ${sessionKey || 'none'})`);
    sessionKey = manualInfo.sampleId;
  }

  if (!sessionKey) {
    console.warn(`⚠️  ${machine.model} ASTM transmission has no sample ID (P record) and no manual context — skipping.`);
    return;
  }

  console.log(`🔍 ${machine.model} — Target ID: ${sessionKey}`);

  // Never returns null — offline, this falls back to the local worklist
  // cache and, failing that, an unmapped placeholder so the run is queued
  // (see resultQueue.js) instead of dropped. See worklistResolver.js.
  const test = await resolveWorklistEntry(sessionKey, {
    testNameFallback: `Unmapped ${machine.model} Test`,
    manualInfo,
  });

  const session = {
    testId: test.bill_item_id,
    sampleId: test.sample_id,
    patientName: test.patient_name,
    testName: test.test_name,
    results: [...state.results.values()],
    protocol: 'ASTM',
  };

  for (const r of session.results) {
    console.log(`📍 ${machine.model} Recorded: ${r.parameter_name} = ${r.result_value} (Unit: ${r.unit}, Flag: ${r.flag || '-'})`);
    win?.webContents?.send('test-completed', {
      sampleId: session.sampleId,
      test_name: r.parameter_name,
      result_value: r.result_value,
      unit: r.unit,
    });
  }

  await syncSession(session, machine, sessionKey);
}


// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: call once at startup (and safely on hot-reload)
// ─────────────────────────────────────────────────────────────────────────────
async function initializeAllPorts(win) {
  mainWindow = win;
  try {
    const configs = await db.getConfig();
    const serialConfigs = configs.filter(c => 
      c.port_type !== 'TCP' && 
      !(c.model && (
        c.model.includes('ALTA') || 
        c.model.includes('CelQuant 5plus') || 
        c.model.includes('ADX-AUTOCHEM-200') ||
        c.model.includes('ADX') ||
        c.model.includes('AUTOCHEM')
      ))
    );

    console.log(`🚀 Initializing background listeners for ${serialConfigs.length} machine(s)...`);

    for (const config of serialConfigs) {
      if (activePorts.has(config.port) || pendingPorts.has(config.port)) {
        console.log(`⏭️  Skipping ${config.port} — already active or pending.`);
        continue;
      }
      pendingPorts.add(config.port);
      startBackgroundListener(config, win).catch((err) => {
        console.error(`❌ Listener startup failed for ${config.port}:`, err.message);
        pendingPorts.delete(config.port);
      });
    }

    // Start background watcher for reconnections
    startReconnectWatcher(win);
  } catch (err) {
    console.error('❌ Failed to initialize background ports:', err);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL: open one port + attach data handler
// ─────────────────────────────────────────────────────────────────────────────
async function startBackgroundListener(machine, win) {
  console.log(`📡 Starting listener for ${machine.model} on ${machine.port}...`);

  // ── 1. Fetch protocol (with one retry) ──────────────────────────────────
  let protocol;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await axios.get(
        `/api/lab/machine-protocol/${encodeURIComponent(machine.model)}`,
        { timeout: 5000 }
      );
      if (!res.data.success) throw new Error('Backend returned success=false');
      protocol = res.data.protocol;
      break;
    } catch (err) {
      console.warn(`⚠️  Protocol fetch attempt ${attempt}/2 for ${machine.model}: ${err.message}`);
      if (attempt === 2) {
        pendingPorts.delete(machine.port);
        throw new Error(`Could not fetch protocol for ${machine.model} after 2 attempts`);
      }
      await sleep(2000);
    }
  }

  // ── 2. Resolve SOF / EOF for binary machines ─────────────────────────────
  const protocolType = protocol.protocol_type || protocol.protocol;
  const isHL7 = protocolType === 'HL7';
  const isText = protocolType === 'TEXT';
  const isASTM = protocolType === 'ASTM';
  let SOF, EOF;
  if (!isHL7 && !isText && !isASTM) {
    SOF = safeHex(protocol?.frame_structure?.['1']?.data, 0xaa);
    const keys = Object.keys(protocol.frame_structure).map(Number).sort((a, b) => a - b);
    const lastKey = String(keys[keys.length - 1]);
    EOF = safeHex(protocol?.frame_structure?.[lastKey]?.data, 0xf5);
    console.log(`   SOF=0x${SOF.toString(16).toUpperCase()}  EOF=0x${EOF.toString(16).toUpperCase()}`);
  }

  let fixedBaudRate = parseInt(machine.baud, 10) || 9600;
  const model = machine.model ? machine.model.toLowerCase() : '';
  if (model.includes('cliniquant micro')) fixedBaudRate = 9600;
  else if (model.includes('celquant edge')) fixedBaudRate = 115200;
  else if (model.includes('hdc lyte') || model.includes('hdc-lyte')) fixedBaudRate = 9600;
  else if (model.includes('laura smart')) fixedBaudRate = 19200;
  else if (model.includes('st-200cl')) fixedBaudRate = 9600;
  else if (model.includes('celltac')) fixedBaudRate = 19200;

  // ── 3. Open SerialPort ───────────────────────────────────────────────────
  const port = new SerialPort({
    path: machine.port,
    baudRate: fixedBaudRate,
    autoOpen: false,
  });

  let buffer = Buffer.alloc(0);
  // ASTM has its own byte-stream state: an incremental buffer plus whatever
  // P/R records have been collected so far for the transmission currently in
  // progress (reset on each ENQ, consumed on EOT).
  let astmBuffer = Buffer.alloc(0);
  let astmRecords = [];

  port.open((err) => {
    pendingPorts.delete(machine.port);
    if (err) {
      const isAccessDenied = err.message && (
        err.message.toLowerCase().includes('access denied') ||
        err.message.toLowerCase().includes('access is denied')
      );
      if (isAccessDenied) {
        console.warn(`⚠️ ${machine.port} access denied — previous process may still be releasing it. Reconnect watcher will retry in ~5s automatically.`);
      } else {
        console.error(`❌ Port ${machine.port} open error: ${err.message}`);
      }
      return;
    }
    console.log(`✅ Port ${machine.port} ACTIVE (${machine.model}).`);
    activePorts.set(machine.port, port);
    postAnalyzerEvent(machine, 'ONLINE');

    // Notify UI
    win?.webContents?.send('device-status', {
      model: machine.model,
      port: machine.port,
      status: 'Connected',
    });
  });

  // ── 4. Data handler ──────────────────────────────────────────────────────
  port.on('data', async (chunk) => {
    console.log(`🔌 [RAW SERIAL DATA] Received ${chunk.length} bytes on ${machine.port}. HEX: ${chunk.toString('hex')}`);

    if (isText) {
      if (silenceTimers.has(machine.port)) {
        clearTimeout(silenceTimers.get(machine.port));
      }

      let cleanChunk = chunk.toString('binary')
        // ST-200CL repeatedly sends ESC ! <NUL|space> as a printer
        // font/mode-select command, not result data — strip that specific
        // sequence before the generic ESC-stripping below, or the stray '!'
        // and control byte are left behind in the text.
        .replace(/\x1b![\x00 ]?/g, '')
        .replace(/\x1b\x00/g, '')
        .replace(/\x1b/g, '');
      buffer = Buffer.concat([buffer, Buffer.from(cleanChunk, 'binary')]);

      if (buffer.length > 100_000) {
        console.warn(`⚠️  TEXT buffer overflow on ${machine.port} — clearing.`);
        buffer = Buffer.alloc(0);
      }

      const timer = setTimeout(async () => {
        silenceTimers.delete(machine.port);
        const report = buffer.toString('ascii');
        buffer = Buffer.alloc(0);

        if (report.trim()) {
          console.log(`📨 [SILENCE TIMEOUT] Complete text report framed on ${machine.port} (${report.length} chars). Processing...`);
          await processTextMessage(report, protocol, machine, win).catch((e) =>
            console.error('Text report processing error:', e)
          );
        }
      }, 1000);

      silenceTimers.set(machine.port, timer);

    } else if (isHL7) {
      buffer = Buffer.concat([buffer, chunk]);
      let raw = buffer.toString('utf8');

      let start = raw.indexOf('\x0B');
      let end = raw.indexOf('\x1C\x0D');

      while (start !== -1 && end !== -1 && end > start) {
        const msg = raw.slice(start + 1, end);
        raw = raw.slice(end + 2);

        if (msg.includes('MSH|')) {
          await processHL7Message(msg, machine, win).catch((e) =>
            console.error('HL7 processing error:', e)
          );
        }

        start = raw.indexOf('\x0B');
        end = raw.indexOf('\x1C\x0D');
      }

      buffer = Buffer.from(raw, 'utf8');

      if (buffer.length > 100_000) {
        console.warn(`⚠️  HL7 buffer overflow on ${machine.port} — clearing.`);
        buffer = Buffer.alloc(0);
      }

    } else if (isASTM) {
      astmBuffer = Buffer.concat([astmBuffer, chunk]);

      // Consume whatever complete units (ENQ / one checksummed frame / EOT)
      // are sitting in the buffer, leaving any trailing partial frame for
      // the next chunk — chunk boundaries from the OS don't line up with
      // ASTM frame boundaries, so this can't be a single pass.
      let progressed = true;
      while (progressed && astmBuffer.length > 0) {
        progressed = false;
        const b0 = astmBuffer[0];

        if (b0 === ASTM_ENQ) {
          astmBuffer = astmBuffer.slice(1);
          astmRecords = [];
          port.write(Buffer.from([ASTM_ACK]));
          progressed = true;
          continue;
        }

        if (b0 === ASTM_EOT) {
          astmBuffer = astmBuffer.slice(1);
          const records = astmRecords;
          astmRecords = [];
          if (records.length > 0) {
            await processAstmTransmission(records, machine, win).catch((e) =>
              console.error('ASTM transmission processing error:', e)
            );
          }
          progressed = true;
          continue;
        }

        if (b0 === ASTM_STX) {
          const etxIdx = astmBuffer.indexOf(ASTM_ETX, 1);
          if (etxIdx === -1) break; // frame not fully arrived yet
          const neededLen = etxIdx + 1 + 2 + 2; // ETX byte + 2 checksum chars + CR LF
          if (astmBuffer.length < neededLen) break; // checksum/CRLF not fully arrived yet

          const frame = astmBuffer.slice(0, etxIdx + 1); // STX .. ETX inclusive
          const checksumChars = astmBuffer.slice(etxIdx + 1, etxIdx + 3).toString('ascii').toUpperCase();
          astmBuffer = astmBuffer.slice(neededLen);

          const calculated = astmChecksum(frame);
          if (checksumChars !== calculated) {
            console.warn(`⚠️  ${machine.model} ASTM checksum mismatch on ${machine.port} (got ${checksumChars}, expected ${calculated}) — NAK`);
            port.write(Buffer.from([ASTM_NAK]));
            progressed = true;
            continue;
          }

          port.write(Buffer.from([ASTM_ACK]));

          // frame = STX, frame-number, <record>, CR, ETX — drop the first
          // two and the last byte, then the trailing CR.
          let payload = frame.slice(2, -1);
          if (payload.length > 0 && payload[payload.length - 1] === ASTM_CR) {
            payload = payload.slice(0, -1);
          }
          const record = payload.toString('ascii');
          if (record) astmRecords.push(record);

          progressed = true;
          continue;
        }

        // Stray byte between units (e.g. a leftover LF) — drop and keep scanning.
        astmBuffer = astmBuffer.slice(1);
        progressed = true;
      }

      if (astmBuffer.length > 100_000) {
        console.warn(`⚠️  ASTM buffer overflow on ${machine.port} — clearing.`);
        astmBuffer = Buffer.alloc(0);
      }

    } else {
      buffer = Buffer.concat([buffer, chunk]);
      let startIdx, endIdx;
      while (
        (startIdx = buffer.indexOf(SOF)) !== -1 &&
        (endIdx = buffer.indexOf(EOF, startIdx)) !== -1
      ) {
        const frame = buffer.slice(startIdx, endIdx + 1);
        buffer = buffer.slice(endIdx + 1);
        await processIncomingFrame(frame, protocol, machine, win).catch((e) =>
          console.error('Frame processing error:', e)
        );
      }

      if (buffer.length > 4096) {
        console.warn(`⚠️  Buffer overflow on ${machine.port} — clearing stale data.`);
        buffer = Buffer.alloc(0);
      }
    }
  });

  port.on('close', () => {
    console.log(`🔌 Port ${machine.port} closed.`);
    activePorts.delete(machine.port);
    postAnalyzerEvent(machine, 'OFFLINE');
    if (silenceTimers.has(machine.port)) {
      clearTimeout(silenceTimers.get(machine.port));
      silenceTimers.delete(machine.port);
    }

    // Notify UI
    win?.webContents?.send('device-status', {
      model: machine.model,
      port: machine.port,
      status: 'Disconnected',
    });
  });

  port.on('error', (err) => {
    console.error(`❌ Runtime error on ${machine.port}:`, err.message);
    activePorts.delete(machine.port);
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// PROCESS BINARY FRAME  (Cliniquant Micro — keyed by patientId)
// ─────────────────────────────────────────────────────────────────────────────
async function processIncomingFrame(frame, protocol, machine, win) {
  // Patient ID lives at bytes 3–8
  const framePatientId = frame.slice(3, 9).toString('ascii').trim();
  if (!framePatientId || framePatientId === '000000') return;

  console.log(`🔍 Received binary data for ID: ${framePatientId} from ${machine.unique_id}`);

  // ── Session init ────────────────────────────────────────────────────────
  let session = sessionAccumulator.get(framePatientId);
  if (!session) {
    console.log(`🆕 New session for ${framePatientId} — fetching worklist...`);
    const wlRes = await axios.get(
      `/api/lab/worklist-by-id/${framePatientId}`,
      { timeout: 5000 }
    );

    if (!wlRes.data.success || !wlRes.data.test) {
      console.log(`⚠️  No active test for ID ${framePatientId}. Ignoring.`);
      return;
    }
    const test = wlRes.data.test;

    session = {
      testId: test.bill_item_id,
      sampleId: test.sample_id,
      patientName: test.patient_name,
      testName: test.test_name,
      results: [],
    };
    sessionAccumulator.set(framePatientId, session);
  }

  // ── Parse result bytes ──────────────────────────────────────────────────
  if (frame.length < 22) {
    console.warn(`⚠️  Frame too short (${frame.length} bytes) for ${framePatientId}`);
    return;
  }

  const testCode = frame[1];
  const unitCode = frame[2];
  const resultValue = frame.readFloatBE(9).toFixed(2);  // result at bytes 9-12 per protocol spec

  const tests = protocol?.frame_structure?.['2']?.tests ?? [];
  const units = protocol?.frame_structure?.['3']?.units ?? [];
  const machineTest = tests.find((t) => t.id === testCode);
  const paramName = machineTest ? machineTest.name : `Param-${testCode}`;
  const unit = units.find((u) => u.id === unitCode)?.unit ?? '';

  // De-duplicate
  if (session.results.some((r) => r.parameter_name.toLowerCase() === paramName.toLowerCase())) return;

  session.results.push({ parameter_name: paramName, result_value: resultValue, unit });
  console.log(`📍 Recorded: ${paramName} = ${resultValue} ${unit}`);

  win?.webContents?.send('test-completed', {
    sampleId: session.sampleId,
    test_name: paramName,
    result_value: resultValue,
  });

  await syncSession(session, machine, framePatientId);
}


// ─────────────────────────────────────────────────────────────────────────────
// PROCESS HL7 MESSAGE  (CelQuant Edge — keyed by OBR code)
// ─────────────────────────────────────────────────────────────────────────────
async function processHL7Message(msg, machine, win) {
  console.log(`📨 HL7 message received on ${machine.port} (${msg.length} chars)`);

  // ── 1. Parse HL7 ────────────────────────────────────────────────────────
  const parsed = parseHL7(msg);

  // The session key for CelQuant Edge is the OBR "code" field
  const sessionKey = parsed.code;

  if (!sessionKey) {
    console.warn('⚠️  HL7 message has no OBR code — skipping.');
    return;
  }

  console.log(`🔍 CelQuant Edge — Sample ID (OBR code): ${sessionKey}`);
  console.log(`   Patient: ${parsed.name || '(no name)'}  |  Case ID: ${parsed.case_id || '(none)'}`);

  // ── 2. Worklist lookup by code ───────────────────────────────────────────
  let session = sessionAccumulator.get(sessionKey);
  if (!session) {
    console.log(`🆕 New HL7 session for sample ID "${sessionKey}" — fetching worklist...`);

    // OBR code == Sample ID — reuse the same resolver as binary machines.
    // allowAutoCreate stays false here — CelQuant Edge deliberately never
    // auto-creates unsolicited orders, same as before; the only change is
    // that offline (or a genuine no-match) now queues as unmapped instead
    // of the message being dropped outright.
    const test = await resolveWorklistEntry(sessionKey, {
      patientName: parsed.name || '',
      testNameFallback: 'Unmapped CelQuant Edge Test',
      allowAutoCreate: false,
    });

    session = {
      testId: test.bill_item_id,
      sampleId: test.sample_id,
      patientName: test.patient_name || parsed.name,
      testName: test.test_name,
      results: [],
      protocol: 'HL7',
      // Store parsed patient info from the HL7 message itself for reference
      hl7Meta: {
        name: parsed.name,
        sex: parsed.sex,
        age: parsed.age,
        age_unit: parsed.age_unit,
        case_id: parsed.case_id,
        bed_no: parsed.bed_no,
        mode: parsed.mode,
        test_mode: parsed.test_mode,
        timestamp: parsed.timestamp,
      },
    };
    sessionAccumulator.set(sessionKey, session);
  }

  // ── 3. Extract CBC results from parsed HL7 ──────────────────────────────
  let newResultsCount = 0;

  for (const param of CBC_PARAMS) {
    const obs = parsed[param];
    if (!obs || obs.value === undefined) continue;

    // De-duplicate
    if (session.results.some((r) => r.parameter_name.toLowerCase() === param.toLowerCase())) continue;

    const resultEntry = {
      parameter_name: param,
      result_value: obs.value,
      unit: obs.unit ?? '',
      ref_range: obs.range ?? '',
      flag: obs.flag ?? '',
    };

    session.results.push(resultEntry);
    newResultsCount++;

    console.log(
      `📍 HL7 Recorded: ${param} = ${obs.value} ${obs.unit}` +
      (obs.flag ? `  [${obs.flag}]` : '')
    );

    // Live update to renderer
    win?.webContents?.send('test-completed', {
      sampleId: session.sampleId,
      test_name: param,
      result_value: obs.value,
      unit: obs.unit,
      flag: obs.flag,
    });
  }

  if (newResultsCount === 0) {
    console.log(`ℹ️  No new CBC results in this HL7 message for code "${sessionKey}".`);
    return;
  }

  // ── 4. Sync to backend ──────────────────────────────────────────────────
  await syncSession(session, machine, sessionKey);
}


// ─────────────────────────────────────────────────────────────────────────────
// PROCESS TEXT REPORT  (HDC-Lyte Plus / LAURA Smart — keyed by Patient ID)
// ─────────────────────────────────────────────────────────────────────────────
async function processTextMessage(msg, protocol, machine, win) {
  console.log(`📨 Text report received on ${machine.port} (${msg.length} chars)`);
  console.log(`[RAW REPORT TEXT]:\n${msg}\n[END RAW REPORT]`);

  let parsed;
  let PARAMS_LIST = [];
  
  if (machine.model === 'LAURA Smart') {
    parsed = parseLauraSmartReport(msg);
    PARAMS_LIST = LAURA_SMART_PARAMS;
  } else {
    parsed = parseTextReport(msg);
    PARAMS_LIST = ELECTROLYTE_PARAMS;
  }

  // The default session key for TEXT is the Patient ID field
  let sessionKey = parsed.patient_id;

  // OVERRIDE: Check manual contexts
  const machineId = (machine.unique_id || machine.id).toString();
  const manualInfo = manualContexts.get(machineId);

  // HDC-LYTE PRO and the SENSA CORE ST-200CL are manual-only: neither
  // instrument's own output carries a patient/sample ID field at all (the
  // ST-200CL's report is just Na/K/Cl values plus a timestamp), so there's
  // nothing to key an unsolicited report on — drop anything that arrives
  // without an active Run Test context rather than dumping it into an
  // UNMAPPED-###### worklist entry. Use case-insensitive trim comparison to
  // tolerate whitespace or case differences in stored model names.
  const requiresManualContext = /hdc.lyte.pro|st-200cl/i.test((machine.model || '').trim());
  if (requiresManualContext && (!manualInfo || !manualInfo.sampleId)) {
    console.log(`🚫 Dropping unsolicited ${machine.model} report (Requires Run Test pop-up).`);
    return;
  }

  // Also drop "start of test" / noise-only bursts that carry no actual
  // parameter values yet (e.g. HDC-LYTE PRO's [1] Patient Id: / [1] Patient
  // Name: / [1] Sample No: header lines, or a printer-formatting-only chunk
  // from the ST-200CL).
  if (requiresManualContext) {
    const hasAnyParam = PARAMS_LIST.some(p => parsed[p] !== null);
    if (!hasAnyParam) {
      console.log(`ℹ️  ${machine.model} — Header-only burst (no parameter values). Skipping.`);
      return;
    }
  }

  if (manualInfo && manualInfo.sampleId) {
    console.log(`📌 MANUAL OVERRIDE: Mapping ${machine.model} report to Sample ID: ${manualInfo.sampleId} (Ignoring native ID: ${sessionKey || 'none'})`);
    sessionKey = manualInfo.sampleId;
  }

  if (!sessionKey) {
    console.warn(`⚠️  Text report has no Patient ID, and no manual context exists. Generating unmapped session key...`);
    sessionKey = `UNMAPPED-${Date.now().toString().slice(-6)}`;
  }

  console.log(`🔍 ${machine.model} — Target ID: ${sessionKey}`);
  console.log(`   Parsed Native Patient: ${parsed.patient_name || '(no name)'}  |  Date: ${parsed.date_time || '(none)'}`);

  // ── 2. Worklist lookup by Patient ID ─────────────────────────────────────
  let session = sessionAccumulator.get(sessionKey);
  if (!session) {
    console.log(`🆕 New TEXT session for Patient ID "${sessionKey}" — fetching worklist...`);

    // A synthetic UNMAPPED-###### key (no Patient ID at all — see above)
    // has nothing to look up; skip straight to the placeholder instead of
    // wasting a network round-trip that can never match anything.
    const test = sessionKey.startsWith('UNMAPPED-')
      ? { bill_item_id: null, sample_id: null, patient_name: parsed.patient_name || '', test_name: `Unmapped ${machine.model} Test` }
      : await resolveWorklistEntry(sessionKey, {
          patientName: parsed.patient_name || '',
          testNameFallback: `Unmapped ${machine.model} Test`,
          manualInfo,
        });

    session = {
      testId: test.bill_item_id,
      sampleId: test.sample_id,
      patientName: test.patient_name || parsed.patient_name,
      testName: test.test_name,
      results: [],
      protocol: 'TEXT',
      textMeta: {
        patient_name: parsed.patient_name,
        patient_id: parsed.patient_id,
        date_time: parsed.date_time,
      },
    };
    sessionAccumulator.set(sessionKey, session);
  }

  // ── 3. Extract results from parsed report ───────────────────
  let newResultsCount = 0;
  const protocolTests = protocol?.tests ?? [];

  for (const param of PARAMS_LIST) {
    const obs = parsed[param];
    if (!obs || obs.value === undefined) continue;

    // De-duplicate
    if (session.results.some((r) => r.parameter_name.toLowerCase() === param.toLowerCase())) continue;

    // Look up unit/range from protocol definition
    const testDef = protocolTests.find((t) => t.name === param);

    const resultEntry = {
      parameter_name: param,
      result_value: obs.value,
      unit: testDef?.unit ?? obs.unit ?? '',
      ref_range: testDef?.ref_range ?? '',
    };

    session.results.push(resultEntry);
    newResultsCount++;

    console.log(`📍 TEXT Recorded: ${param} = ${obs.value} ${resultEntry.unit}`);

    // Live update to renderer
    win?.webContents?.send('test-completed', {
      sampleId: session.sampleId,
      test_name: param,
      result_value: obs.value,
      unit: resultEntry.unit,
    });
  }

  if (newResultsCount === 0) {
    console.log(`ℹ️  No new electrolyte results in this report for Patient ID "${sessionKey}".`);
    return;
  }

  // ── 4. Sync to backend ──────────────────────────────────────────────────
  // TEXT protocol sends all params in one burst — mark as complete immediately
  session.protocol = 'TEXT';
  await syncSession(session, machine, sessionKey);
}


// ─────────────────────────────────────────────────────────────────────────────
// SHARED: check completeness + POST results to API
// ─────────────────────────────────────────────────────────────────────────────
async function syncSession(session, machine, sessionKey) {
  // We no longer gate on a fixed defined-parameter checklist — a machine/test
  // config may legitimately only ever produce a subset of a test's template
  // parameters. Just store the test name plus whatever the machine sent.
  console.log(`💾 Queuing ${session.results.length} result(s) for sample ID "${sessionKey}" (local-first — see resultQueue.js)...`);

  // Written to the local SQLite queue before anything touches the network —
  // this is the fix for "the machine should keep working with no internet":
  // the run is durably captured here regardless of what happens next.
  // Whether a matching sample ID exists is what used to gate the whole sync;
  // now it only gates whether this becomes an immediate push (kind:
  // 'mapped') or a row on the Unmapped Test screen waiting for a technician
  // to type the right sample ID in by hand (kind: 'unmapped').
  const hasSample = !!session.sampleId && !String(session.sampleId).startsWith('UNMAPPED-');
  await resultQueue.enqueue({
    kind: hasSample ? 'mapped' : 'unmapped',
    sample_id: hasSample ? session.sampleId : null,
    bill_item_id: session.testId || null,
    test_name: session.testName,
    machine_no: machine.unique_id,
    machine_name: machine.analyzer_name || machine.name || '',
    results: session.results,
  });

  // The in-memory accumulator's only job was to hold results until they were
  // safely persisted — that has now happened unconditionally (push success
  // or failure both leave the row in local_results for the retry queue /
  // Unmapped Test screen to deal with), so the in-memory copy can always be
  // cleared here instead of only on a successful network push.
  sessionAccumulator.delete(sessionKey);

  const machineId = machine.unique_id || machine.id;
  if (manualContexts.has(machineId)) {
    manualContexts.delete(machineId);
    console.log(`📌 Manual context cleared for machine ${machineId}`);
  }

  console.log(`✅ Panel COMPLETE for ${session.patientName}. Results saved locally — awaiting ${hasSample ? 'sync' : 'sample mapping'}.`);
}


// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────
async function stopListening() {
  const closePromises = [];
  for (const [path, port] of activePorts) {
    if (port.isOpen) {
      closePromises.push(
        new Promise((res) =>
          port.close(() => {
            console.log(`🔌 Closed ${path}`);
            res();
          })
        )
      );
    }
  }
  await Promise.all(closePromises);
  activePorts.clear();
  pendingPorts.clear();
}


// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function safeHex(val, fallback) {
  const parsed = parseInt(val, 16);
  return isNaN(parsed) ? fallback : parsed;
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// WATCHER: Auto-reconnect disconnected devices
// ─────────────────────────────────────────────────────────────────────────────
function startReconnectWatcher(win) {
  if (reconnectTimer) return;

  reconnectTimer = setInterval(async () => {
    try {
      const configs = await db.getConfig();
      if (!configs || configs.length === 0) return;

      const availablePortsList = await SerialPort.list();

      for (const config of configs) {
        // If port is NOT in activePorts AND NOT in pendingPorts
        if (!activePorts.has(config.port) && !pendingPorts.has(config.port)) {
          // Check if port actually exists on the system right now
          const exists = availablePortsList.some((p) => p.path === config.port);

          if (exists) {
            console.log(`🔄 Auto-reconnecting to ${config.model} on ${config.port}...`);
            pendingPorts.add(config.port);
            startBackgroundListener(config, win).catch((err) => {
              console.error(`❌ Reconnect failed for ${config.port}:`, err.message);
              pendingPorts.delete(config.port);
            });
          }
        }
      }
    } catch (err) {
      console.error('Watcher Error:', err);
    }
  }, 5000); // Check every 5 seconds
}


module.exports = {
  initializeAllPorts,
  stopListening,
  setManualContext,
  activePorts,
  CODE_MAP
};