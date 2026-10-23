const net = require('net');
const axios = require('./apiClient');
const db = require('../db/sqlite');
const resultQueue = require('./resultQueue');
const { validateHl7 } = require('./frameValidator');
const hostQuery = require('./hostQuery');
const { resolveWorklistEntry } = require('./worklistResolver');

function postAnalyzerEvent(machine, event, ip_address) {
  axios.post(`/api/lab/analyzer-event`, {
    machine_id:   machine.unique_id || machine.uniqueId || machine.id || '',
    machine_name: machine.analyzer_name || machine.name || '',
    model:        machine.model || '',
    lab_id:       machine.lab_id || null,
    port:         machine.port || '',
    event,
    ip_address:   ip_address || null,
  }).catch(err => console.warn(`⚠️  Could not log analyzer event (${event}):`, err.message));
}

// port -> true  (set IMMEDIATELY when we decide to open)
const pendingPorts = new Set();
const activeServers = new Map();
const activeClients = new Map();
let mainWindow = null;

// USB and listening-TCP machines are genuinely keyed by port alone — only one
// process can bind a given serial/listening port, so two configs sharing a
// port really are a conflict. A dial-out analyzer (the BC-5130) has no such
// constraint: its "port" is fixed by the hardware and legitimately identical
// across every unit of that model, since this Agent dials OUT to a distinct
// IP rather than binding anything locally. Keying activeServers/activeClients/
// pendingPorts on port alone made a second such analyzer collide with the
// first in every one of these maps — wrongly rejected as a "port conflict" in
// the UI, and even past that, silently never started at all (the dedup check
// in initializeAllServers would see the port already "active" from the first
// one and skip the second). get-active-ports and Setup.jsx's ONLINE badge
// check both build this same key to match.
function machineKey(machine) {
  const ip = machine.analyzer_ip || machine.analyzerIp;
  return ip ? `${ip}:${machine.port}` : machine.port;
}

const sessionAccumulator = new Map();
const manualContexts = new Map();

function setManualContext(testInfo) {
    if (testInfo && testInfo.machineId) {
        console.log(`📌 TCP Manual context set for machine ${testInfo.machineId} -> Sample ${testInfo.sampleId}`);
        manualContexts.set(testInfo.machineId, testInfo);
    }
}

// HL7 control characters
const VT = Buffer.from([0x0b]);
const FS = Buffer.from([0x1c]);
const CR = Buffer.from([0x0d]);

const parameter_map = {
    '2006': 'WBC',
    '2007': 'NEU%',
    '2008': 'LYM%',
    '2009': 'MON%',
    '2010': 'EOS%',
    '2011': 'BAS%',
    '2012': 'NEU#',
    '2013': 'LYM#',
    '2014': 'MON#',
    '2015': 'EOS#',
    '2016': 'BAS#',
    '2017': 'RBC',
    '2018': 'HGB',
    '2019': 'MCV',
    '2020': 'HCT',
    '2021': 'MCH',
    '2022': 'MCHC',
    '2023': 'RDW-SD',
    '2024': 'RDW-CV',
    '2025': 'PLT',
    '2026': 'MPV',
    '2027': 'PCT',
    '2028': 'PDW',
    '2029': 'P-LCR',
    '2030': 'P-LCC',
    '2031': 'CRP',
    // Lipid Profile — names must match cdac_parameter_map.parameter_name
    // exactly (see cdacMapper.js's findParameterMapping), or the CDAC API31
    // push silently skips the value instead of sending it.
    '3001': 'Cholesterol',
    '3002': 'Triglycerides',
    '3003': 'HDL',
    '3004': 'LDL',
    '3005': 'VLDL'
};

const adx_parameter_map = {
    '1': 'ALBUMIN',
    '2': 'ALPSR',
    '3': 'SGPT',
    '4': 'AMYLASE',
    '5': 'SGOT',
    '6': 'BIL D',
    '7': 'BIL T',
    '8': 'CLORIDE',
    '9': 'CHOL',
    '10': 'GLU',
    '11': 'TGL',
    '12': 'TP',
    '13': 'URIC-ACID',
    '14': 'UREA',
    '15': 'POTTA',
    '16': 'NA',
    '17': 'CA',
    '18': 'CRP',
    '19': 'RF',
    '20': 'ASO',
    '21': 'URIC-ACID',
    '22': 'CREAT',
    '23': 'LIPASE',
    '24': 'CREAT',
    '25': 'GGT',
    '26': 'DHDL',
    '27': 'HbA1C',
    '28': 'PHOSPHO'
};

function parseAltaHL7(message, machine) {
    const lines = message.split('\r');
    const patient = {};
    const results = {};

    const model = (machine?.model || '').toUpperCase();
    const isADX = model.includes('ADX') || model.includes('AUTOCHEM');

    for (const line of lines) {
        const fields = line.split('|');
        if (fields.length === 0) continue;

        const segment = fields[0].replace(/\n/g, '').trim();

        if (segment === 'MSH') {
            patient['serial_number'] = fields.length > 3 ? fields[3] : '';
        } else if (segment === 'PID') {
            patient['patient_id'] = fields.length > 3 ? fields[3] : '';
            patient['name'] = fields.length > 5 ? fields[5] : '';
            patient['gender'] = fields.length > 8 ? fields[8] : '';
        } else if (segment === 'OBR') {
            patient['sample_id'] = fields.length > 3 ? fields[3] : '';
        } else if (segment === 'OBX') {
            const obxType  = fields.length > 2 ? fields[2].trim() : '';
            if (obxType === 'ED') continue;  // skip base64 image blobs

            const test_info = fields.length > 3 ? fields[3] : '';
            const value = fields.length > 5 ? fields[5] : '';
            const unit = fields.length > 6 ? fields[6] : '';
            const ref_range = fields.length > 7 ? fields[7] : '';
            const code_parts = test_info.split('^');

            if (code_parts.length > 0) {
                const code = code_parts[0];
                let paramName = code;
                if (isADX) {
                    paramName = adx_parameter_map[code] || (fields.length > 4 ? fields[4].trim() : '') || code;
                } else {
                    paramName = parameter_map[code] || code;
                }
                if (paramName && value) {
                    results[paramName] = { value, unit, ref_range };
                }
            }
        }
    }

    return { patient, results };
}

async function syncSession(session, machine, sessionKey) {
    console.log(`💾 Queuing ${session.results.length} result(s) for "${sessionKey}" (local-first — see resultQueue.js)...`);

    // Written to the local SQLite queue before anything touches the network
    // — a completed run is captured here regardless of what the backend
    // POST does next. A missing sample_id (worklistResolver.js's unmapped
    // placeholder) files this under kind:'unmapped' for the Unmapped Test
    // screen instead of being lost.
    const hasSample = !!session.sampleId;
    await resultQueue.enqueue({
        kind: hasSample ? 'mapped' : 'unmapped',
        sample_id: hasSample ? session.sampleId : null,
        bill_item_id: session.testId || null,
        test_name: session.testName,
        machine_no: machine.unique_id || machine.uniqueId || machine.id,
        machine_name: machine.analyzer_name || machine.name || '',
        results: session.results.map(r => ({
            parameter_name: r.parameter_name,
            result_value: r.result_value,
            unit: r.unit || '',
            reference_range: r.ref_range || '',
            flag: r.flag || ''
        })),
    });

    sessionAccumulator.delete(sessionKey);

    const machineId = machine.unique_id || machine.uniqueId || machine.id;
    if (manualContexts.has(machineId)) {
        manualContexts.delete(machineId);
        console.log(`📌 TCP Manual context cleared for machine ${machineId}`);
    }

    mainWindow?.webContents?.send('panel-complete', {
        sampleId: session.sampleId,
        testName: session.testName
    });

    console.log(`✅ Session "${sessionKey}" saved locally — awaiting ${hasSample ? 'sync' : 'sample mapping'}.`);
}

async function processAltaHL7(message, machine) {
    const parsed = parseAltaHL7(message, machine);
    return ingestParsedHL7(parsed, machine);
}

// NAME-BASED OBX MACHINES (Agape CXL Pro, DIRUI CS-T240) — same MSH/PID/OBR/
// OBX + MLLP framing as ALTA/ADX (HL7 v2.3.1), but OBX-3 (Observation
// Identifier) carries the test NAME directly (e.g. "GLU^1"), not a numeric
// code — so unlike parseAltaHL7 there is no parameter_map lookup, just
// "split on ^, take [0]". Verified against Agape's vendor "LIS Network
// Interface Instruction" and the standalone agape_cxl_pro.py test listener
// built from it; DIRUI CS-T240 uses the identical method.
function parseNameBasedHL7(message) {
    const lines = message.split('\r');
    const patient = {};
    const results = {};

    for (const line of lines) {
        const fields = line.split('|');
        if (fields.length === 0) continue;

        const segment = fields[0].replace(/\n/g, '').trim();

        if (segment === 'MSH') {
            patient['serial_number'] = fields.length > 3 ? fields[3] : '';
        } else if (segment === 'PID') {
            patient['patient_id'] = fields.length > 3 ? fields[3] : '';
            patient['name'] = fields.length > 5 ? fields[5] : '';
            patient['gender'] = fields.length > 8 ? fields[8] : '';
        } else if (segment === 'OBR') {
            patient['sample_id'] = fields.length > 3 ? fields[3] : '';
        } else if (segment === 'OBX') {
            const obxType = fields.length > 2 ? fields[2].trim() : '';
            if (obxType === 'ED') continue; // skip base64 image blobs

            const test_info = fields.length > 3 ? fields[3] : '';
            const value = fields.length > 5 ? fields[5] : '';
            const unit = fields.length > 6 ? fields[6] : '';
            const ref_range = fields.length > 7 ? fields[7] : '';

            // Test name from e.g. "GLU^1" — the ^1 is the repeat count, not
            // part of the name.
            const paramName = test_info.split('^')[0];

            if (paramName && value) {
                results[paramName] = { value, unit, ref_range };
            }
        }
    }

    return { patient, results };
}

async function processNameBasedHL7(message, machine) {
    const parsed = parseNameBasedHL7(message);
    return ingestParsedHL7(parsed, machine);
}

// Shared by every HL7-speaking analyzer once its own wire format has been
// parsed into the common { patient: {sample_id, name, serial_number}, results:
// {paramName: {value, unit, ref_range, flag}} } shape — worklist lookup,
// manual-context override, unsolicited-worklist auto-create, and the sync to
// the backend all live here exactly once.
async function ingestParsedHL7(parsed, machine) {
    let sessionKey = parsed.patient.sample_id; // Using sample_id as the session key

    let targetMachine = machine;
    if (parsed.patient.serial_number) {
        try {
            const configs = await db.getConfig();
            const matched = configs.find(c => c.serial_number === parsed.patient.serial_number);
            if (matched) {
                targetMachine = matched;
                console.log(`🎯 DYNAMIC MACHINE RESOLUTION: Matched HL7 Serial Number "${parsed.patient.serial_number}" to Machine ID: ${targetMachine.unique_id}`);
            } else {
                console.warn(`⚠️  No registered machine found matching Serial Number: "${parsed.patient.serial_number}"`);
            }
        } catch (err) {
            console.error('Error matching machine by serial number:', err);
        }
    }

    const machineId = targetMachine.unique_id || targetMachine.id;
    const manualInfo = manualContexts.get(machineId);

    if (manualInfo && manualInfo.sampleId) {
        console.log(`📌 MANUAL OVERRIDE: Mapping TCP report to Sample ID: ${manualInfo.sampleId} (Ignoring native ID: ${sessionKey || 'none'})`);
        sessionKey = manualInfo.sampleId;
    }

    if (!sessionKey) {
        console.warn(`⚠️  ${targetMachine?.model || 'HL7'} message has no sample ID (OBR[3]) and no manual context — skipping.`);
        return;
    }

    console.log(`🔍 ${targetMachine?.model || 'HL7'} — Target ID: ${sessionKey}`);

    let session = sessionAccumulator.get(sessionKey);
    if (!session) {
        console.log(`🆕 New ${targetMachine?.model || 'HL7'} session for sample ID "${sessionKey}" — fetching worklist...`);

        // Never returns null — offline, this falls back to the local
        // worklist cache and, failing that, an unmapped placeholder so the
        // result is queued (resultQueue.js) instead of dropped entirely.
        const test = await resolveWorklistEntry(sessionKey, {
            patientName: parsed.patient.name || '',
            testNameFallback: 'Unmapped Analyzer Test',
            manualInfo,
        });

        session = {
            testId: test.bill_item_id,
            sampleId: test.sample_id,
            patientName: test.patient_name || parsed.patient.name,
            testName: test.test_name,
            results: [],
            protocol: 'TCP_HL7'
        };
        sessionAccumulator.set(sessionKey, session);
    }

    let newResultsCount = 0;

    for (const [param, data] of Object.entries(parsed.results)) {
        if (session.results.some(r => r.parameter_name.toLowerCase() === param.toLowerCase())) continue;

        session.results.push({
            parameter_name: param,
            result_value: data.value,
            unit: data.unit || '',
            ref_range: data.ref_range || '',
            flag: data.flag || ''
        });
        newResultsCount++;

        console.log(`📍 ${targetMachine?.model || 'Analyzer'} Recorded: ${param} = ${data.value} (Unit: ${data.unit}, Ref: ${data.ref_range})`);

        mainWindow?.webContents?.send('test-completed', {
            sampleId: session.sampleId,
            test_name: param,
            result_value: data.value,
            unit: data.unit || '',
            flag: ''
        });
    }

    if (newResultsCount > 0) {
        await syncSession(session, targetMachine, sessionKey);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MINDRAY BC-5130 — HL7 v2.3.1 over MLLP (same VT/FS/CR framing as ALTA/ADX
// above), but with its own handshake this LIS-Agent must speak correctly:
//   - A lone 0x02 byte is a keepalive heartbeat, not a message — must be
//     stripped, never handed to the HL7 parser.
//   - ORM^O01 is a worklist request (sample ID in ORC-3, no OBR segment) —
//     must get an ORR^O02/MSA|AA ack back, not a generic ACK.
//   - ORU^R01 carries the actual result set (sample ID in OBR-3, one OBX per
//     parameter) — also acked, since the real analyzer was observed
//     retransmitting the same ORU repeatedly when nothing acked it back.
// Ported from defence-lims (main/tcpManager.js + the reference client at
// test-scripts/minray-BC-5130.py), adapted to sync through ingestParsedHL7 /
// the backend worklist instead of a local sqlite order.
// ─────────────────────────────────────────────────────────────────────────────

function mindrayField(fields, index) {
    return fields.length > index ? fields[index] : '';
}

function mindrayHeader(message) {
    for (const seg of message.split('\r')) {
        if (seg.startsWith('MSH|')) {
            const fields = seg.split('|');
            return { messageType: mindrayField(fields, 8), controlId: mindrayField(fields, 9) };
        }
    }
    return { messageType: '', controlId: '' };
}

function mindrayOrcSampleId(message) {
    for (const seg of message.split('\r')) {
        if (seg.startsWith('ORC|')) {
            return mindrayField(seg.split('|'), 3);
        }
    }
    return '';
}

// ORU^R01 -> { patient: {sample_id, name}, results: {paramName: {value, unit,
// ref_range, flag}} }, the same shape parseAltaHL7 produces, so it can go
// through the shared ingestParsedHL7 path. Only numeric results are kept
// (OBX-2 == 'NM'; the analyzer also sends IS-type Take/Blood/Test Mode flags
// as metadata, not reportable parameters).
function parseMindrayResult(message) {
    const patient = {};
    const results = {};

    for (const seg of message.split('\r')) {
        const fields = seg.split('|');
        const segment = fields[0];

        if (segment === 'PID') {
            patient.name = mindrayField(fields, 5).split('^').filter(Boolean).join(' ');
        } else if (segment === 'OBR') {
            patient.sample_id = mindrayField(fields, 3);
        } else if (segment === 'OBX') {
            if (mindrayField(fields, 2) !== 'NM') continue;

            const idParts = mindrayField(fields, 3).split('^');
            const paramName = idParts.length > 1 ? idParts[1] : idParts[0];
            const value = mindrayField(fields, 5);
            if (!paramName || !value) continue;

            results[paramName] = {
                value,
                unit: mindrayField(fields, 6),
                ref_range: mindrayField(fields, 7),
                flag: mindrayField(fields, 8).split('~')[0], // "H~N" -> "H"
            };
        }
    }

    return { patient, results };
}

function mindrayTimestamp() {
    return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function buildMindrayOrrResponse(controlId) {
    return (
        `MSH|^~\\&|||||${mindrayTimestamp()}||ORR^O02|${controlId}|P|2.3.1||||||UNICODE\r` +
        `MSA|AA|${controlId}\r`
    );
}

function buildMindrayAck(controlId) {
    return (
        `MSH|^~\\&|||||${mindrayTimestamp()}||ACK^R01|${controlId}|P|2.3.1||||||UNICODE\r` +
        `MSA|AA|${controlId}\r`
    );
}

function mindrayMllpWrap(message) {
    return Buffer.concat([VT, Buffer.from(message, 'utf-8'), FS, CR]);
}

async function processMindrayMessage(message, machine) {
    const { messageType, controlId } = mindrayHeader(message);

    if (messageType === 'ORM^O01') {
        const sampleId = mindrayOrcSampleId(message);
        console.log(`🔍 Mindray BC-5130 worklist request for sample "${sampleId}"`);
        // Answer with the order itself; the bare acknowledgement is only the fallback.
        const reply = await hostQuery.answerHl7Query(message).catch(() => null);
        return reply || buildMindrayOrrResponse(controlId);
    }

    if (messageType === 'ORU^R01') {
        const parsed = parseMindrayResult(message);
        if (!parsed.patient.sample_id) {
            console.warn('⚠️  Mindray BC-5130 result has no sample ID (OBR-3) — skipping.');
            return buildMindrayAck(controlId);
        }

        console.log(`🔍 Mindray BC-5130 result for sample "${parsed.patient.sample_id}" (${Object.keys(parsed.results).length} parameters)`);

        try {
            await ingestParsedHL7(parsed, machine);
        } catch (err) {
            console.error('Error saving Mindray BC-5130 results:', err.message);
        }

        return buildMindrayAck(controlId);
    }

    console.log(`ℹ️  Unhandled Mindray BC-5130 message type: "${messageType}"`);
    return buildMindrayAck(controlId);
}

// Unlike ALTA/ADX (which wait for the analyzer to connect in), the BC-5130
// runs its own TCP server on the analyzer itself — this Agent must dial OUT
// to it (matching minray-BC-5130.py's ANALYZER_IP/PORT connect()), and keep
// reconnecting if the link drops, since it's a persistent link this Agent
// depends on rather than a one-off handshake.
async function startMindrayClient(machine, win) {
    mainWindow = win;
    const analyzerIp = machine.analyzer_ip || machine.analyzerIp;
    const portNum = parseInt(machine.port, 10);

    if (!analyzerIp) {
        console.error(`❌ No analyzer IP configured for ${machine.model} — cannot connect.`);
        return;
    }
    if (isNaN(portNum)) {
        console.error(`❌ Invalid analyzer port for ${machine.model}: ${machine.port}`);
        return;
    }

    let stopped = false;
    let buffer = Buffer.alloc(0);
    let currentClient = null; // tracked separately from activeClients, which only holds it once actually connected
    const RECONNECT_DELAY_MS = 5000;

    const connect = () => {
        if (stopped) return;

        console.log(`📡 Connecting to Mindray BC-5130 analyzer at ${analyzerIp}:${portNum}...`);
        mainWindow?.webContents?.send('device-status', { model: machine.model, port: machine.port, status: 'Connecting' });

        const client = net.createConnection({ host: analyzerIp, port: portNum });
        currentClient = client;
        buffer = Buffer.alloc(0);

        client.on('connect', () => {
            // Only counted as "active"/online once the TCP handshake actually
            // succeeds — not merely attempted — so the ONLINE badge (driven by
            // activeClients, via get-active-ports) reflects a real, live link.
            activeClients.set(machineKey(machine), client);
            console.log(`\n🔌 Connected to Mindray BC-5130 analyzer at ${analyzerIp}:${portNum}`);
            postAnalyzerEvent(machine, 'ONLINE', analyzerIp);
            mainWindow?.webContents?.send('device-status', { model: machine.model, port: machine.port, status: 'Connected' });
        });

        client.on('data', async (data) => {
            buffer = Buffer.concat([buffer, data]);

            // Heartbeat bytes (lone 0x02) carry no message — strip any that
            // precede a real frame instead of letting them jam the buffer.
            while (buffer.length > 0 && buffer[0] === 0x02) {
                buffer = buffer.slice(1);
            }

            const fsCrIndex = buffer.indexOf(Buffer.concat([FS, CR]));
            if (fsCrIndex === -1) return;

            let hl7Data = buffer.slice(0, fsCrIndex);
            if (hl7Data[0] === VT[0]) hl7Data = hl7Data.slice(1);
            buffer = buffer.slice(fsCrIndex + 2);

            const message = hl7Data.toString('utf-8');
            console.log(`\n========== RAW HL7 (Mindray BC-5130) ==========\n${message}`);

            const mindrayCheck = validateHl7(message);
            if (!mindrayCheck.ok) {
                await resultQueue.recordRejected({ machine, protocol: 'HL7', problems: mindrayCheck.problems, raw: message });
                return;
            }

            try {
                const reply = await processMindrayMessage(message, machine);
                if (reply) {
                    client.write(mindrayMllpWrap(reply), () => {
                        console.log('✅ Response sent to Mindray BC-5130');
                    });
                }
            } catch (err) {
                console.error('❌ Error processing Mindray BC-5130 message:', err.message);
            }
        });

        client.on('close', () => {
            console.log('🔌 Disconnected from Mindray BC-5130 analyzer');
            activeClients.delete(machineKey(machine));
            postAnalyzerEvent(machine, 'OFFLINE');
            mainWindow?.webContents?.send('device-status', { model: machine.model, port: machine.port, status: 'Disconnected' });
            if (!stopped) {
                setTimeout(connect, RECONNECT_DELAY_MS);
            }
        });

        client.on('error', (err) => {
            console.warn(`⚠️ Mindray BC-5130 connection error (${analyzerIp}:${portNum}): ${err.message}`);
            // 'close' always follows 'error' on a socket — reconnect is scheduled there.
        });
    };

    // Registered under activeServers (alongside real net.Server instances) so
    // initializeAllServers' de-dup check and stopListening() both keep working
    // uniformly, even though this is a client connection, not a listener.
    activeServers.set(machineKey(machine), { close: () => { stopped = true; currentClient?.destroy(); } });
    pendingPorts.delete(machineKey(machine));
    connect();
}

async function startTCPServer(machine, win) {
    mainWindow = win;
    const portNum = parseInt(machine.port, 10);
    if (isNaN(portNum)) {
        console.error(`❌ Invalid TCP port number for ${machine.model}: ${machine.port}`);
        return;
    }

    console.log(`📡 Starting TCP Server for ${machine.model} on port ${portNum}...`);

    const server = net.createServer((conn) => {
        console.log(`\n🔌 Analyzer Connected: ${conn.remoteAddress}:${conn.remotePort}`);
        activeClients.set(machineKey(machine), conn);
        postAnalyzerEvent(machine, 'ONLINE', conn.remoteAddress);

        // Notify UI that machine actually connected
        mainWindow?.webContents?.send('device-status', {
            model: machine.model,
            port: machine.port,
            status: 'Connected',
        });

        let data_buffer = Buffer.alloc(0);

        conn.on('data', async (data) => {
            data_buffer = Buffer.concat([data_buffer, data]);

            // A connection that never sends the FS+CR terminator would otherwise grow
            // this buffer forever — cap it and drop the connection (matches the HL7
            // buffer convention used in serialManager.js).
            if (data_buffer.length > 100_000) {
                console.warn(`⚠️  TCP buffer overflow on port ${machine.port} from ${conn.remoteAddress} — closing connection.`);
                conn.destroy();
                return;
            }

            const fsCrIndex = data_buffer.indexOf(Buffer.concat([FS, CR]));
            if (fsCrIndex !== -1) {
                // We have a complete message
                let hl7_data = data_buffer.slice(0, fsCrIndex);
                if (hl7_data[0] === VT[0]) {
                    hl7_data = hl7_data.slice(1);
                }

                const message = hl7_data.toString('utf-8');
                console.log(`\n========== RAW HL7 (${machine.model || 'Unknown'}) ==========\n`);
                console.log(message);

                const queryReply = await hostQuery.answerHl7Query(message).catch((e) => { console.error('HL7 host query error:', e.message); return null; });
                if (queryReply) {
                    conn.write(hostQuery.mllp(queryReply), () => console.log('✅ Order sent to analyzer (host query)'));
                    data_buffer = data_buffer.slice(fsCrIndex + 2);
                    return;
                }

                const modelUpper = (machine.model || '').toUpperCase();
                const isNameBasedObx = modelUpper.includes('CXL') || modelUpper.includes('CS-T240');
                // Validate the message before any of it is committed; a bad one is kept with the
                // reason and the analyzer is told it was rejected (AR), not accepted (AA).
                const hl7Check = validateHl7(message);
                if (!hl7Check.ok) {
                    await resultQueue.recordRejected({ machine, protocol: 'HL7', problems: hl7Check.problems, raw: message });
                } else if (isNameBasedObx) {
                    await processNameBasedHL7(message, machine);
                } else {
                    await processAltaHL7(message, machine);
                }

                // Send ACK
                const ack_message = Buffer.concat([
                    VT,
                    Buffer.from(`MSH|^~\\&|LIS|||Analyzer||20260506120000||ACK^R01|1|P|2.3.1\rMSA|${hl7Check.ok ? 'AA' : 'AR'}|1\r`),
                    FS,
                    CR
                ]);
                
                conn.write(ack_message, () => {
                    console.log("✅ ACK SENT to analyzer");
                });

                data_buffer = data_buffer.slice(fsCrIndex + 2);
            }
        });

        conn.on('close', () => {
            console.log('🔌 Analyzer Disconnected');
            activeClients.delete(machineKey(machine));
            postAnalyzerEvent(machine, 'OFFLINE');
            // Revert back to listening status
            mainWindow?.webContents?.send('device-status', {
                model: machine.model,
                port: machine.port,
                status: 'Listening',
            });
        });

        conn.on('error', (err) => {
            console.error('⚠️ TCP Connection Error:', err.message);
        });
    });

    server.listen(portNum, '0.0.0.0', () => {
        console.log(`✅ TCP Server listening on 0.0.0.0:${portNum}`);
        activeServers.set(machineKey(machine), server);
        pendingPorts.delete(machineKey(machine));

        // Tell UI we are waiting for connection
        mainWindow?.webContents?.send('device-status', {
            model: machine.model,
            port: machine.port,
            status: 'Listening',
        });
    });

    server.on('error', (err) => {
        pendingPorts.delete(machineKey(machine));
        if (err.code === 'EADDRINUSE') {
            console.warn(`⚠️ Port ${portNum} is busy (EADDRINUSE). Retrying in 4 seconds...`);
            // Schedule a retry — the port will be freed once the old process dies
            setTimeout(() => {
                if (!activeServers.has(machineKey(machine)) && !pendingPorts.has(machineKey(machine))) {
                    console.log(`🔄 Retrying TCP Server on port ${portNum}...`);
                    pendingPorts.add(machineKey(machine));
                    startTCPServer(machine, win).catch(retryErr => {
                        console.error(`❌ TCP Retry failed for port ${portNum}:`, retryErr.message);
                        pendingPorts.delete(machineKey(machine));
                    });
                }
            }, 4000);
        } else {
            console.error(`❌ TCP Server Error on port ${portNum}:`, err.message);
        }
    });
}

async function initializeAllServers(win) {
    mainWindow = win;
    try {
        const configs = await db.getConfig();
        const tcpConfigs = configs.filter(c =>
            c.port_type === 'TCP' ||
            (c.model && (
                c.model.includes('ALTA') ||
                c.model.includes('CelQuant 5plus') ||
                c.model.includes('ADX-AUTOCHEM-200') ||
                c.model.includes('ADX') ||
                c.model.includes('AUTOCHEM') ||
                c.model.toUpperCase().includes('MINDRAY') ||
                c.model.includes('BC-5130') ||
                c.model.toUpperCase().includes('CXL') ||
                c.model.toUpperCase().includes('CS-T240')
            ))
        );

        for (const config of tcpConfigs) {
            if (activeServers.has(machineKey(config)) || pendingPorts.has(machineKey(config))) {
                continue;
            }
            pendingPorts.add(machineKey(config));
            // BC-5130 dials out to the analyzer instead of listening for it —
            // route it to the dedicated Mindray client instead of the generic
            // inbound HL7 server.
            const modelUpper = (config.model || '').toUpperCase();
            const isMindray = modelUpper.includes('MINDRAY') || modelUpper.includes('BC-5130');
            const starter = isMindray ? startMindrayClient : startTCPServer;
            starter(config, win).catch(err => {
                console.error(`❌ Server startup failed for port ${config.port}:`, err.message);
                pendingPorts.delete(machineKey(config));
            });
        }
    } catch (err) {
        console.error('❌ Failed to initialize background TCP servers:', err);
    }
}

async function stopListening() {
    for (const [port, server] of activeServers.entries()) {
        server.close();
        activeServers.delete(port);
        console.log(`⏹️ TCP Server on port ${port} closed.`);
    }
}

module.exports = {
    initializeAllServers,
    stopListening,
    startTCPServer,
    startMindrayClient,
    setManualContext,
    activeServers,
    activeClients,
    parameter_map,
    adx_parameter_map
};
