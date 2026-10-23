// Runs the agent's signing flow and local API against a stand-in LIMS server that
// uses the real server-side signing code. No Electron, token or database needed:
//   NODE_PATH=../HIMS-backend/node_modules node test/protocol.test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const forge = require('node-forge');

const BACKEND = path.join(__dirname, '..', '..', 'HIMS-backend');
let failed = 0;
const ok = (cond, label, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`); if (!cond) failed += 1; };

const request = (port, { method = 'GET', url = '/', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* none */ } resolve({ status: res.statusCode, headers: res.headers, json }); });
  });
  req.on('error', reject);
  if (body) req.write(JSON.stringify(body));
  req.end();
});

(async () => {
  const dscRemote = await import(path.join(BACKEND, 'utils', 'dscRemote.js'));
  const dscSigner = await import(path.join(BACKEND, 'utils', 'dscSigner.js'));
  const { PDFDocument } = await import(path.join(BACKEND, 'node_modules', 'pdf-lib', 'cjs', 'index.js'));

  // A throwaway "doctor's token": a .p12 whose password plays the PIN.
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = '0C1D';
  cert.validity.notBefore = new Date(Date.now() - 86400000); cert.validity.notAfter = new Date(Date.now() + 200 * 86400000);
  const subject = [{ name: 'commonName', value: 'Dr Agent Test' }, { name: 'organizationName', value: 'General Hospital Jayanagar' }, { name: 'countryName', value: 'IN' }];
  cert.setSubject(subject); cert.setIssuer(subject);
  cert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, nonRepudiation: true }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poxia-agent-'));
  const p12Path = path.join(dir, 'test.p12');
  fs.writeFileSync(p12Path, Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], '123456', { algorithm: '3des' })).getBytes(), 'binary'));

  // ── the stand-in LIMS server ──
  const doc = await PDFDocument.create(); doc.addPage([595, 842]);
  const report = Buffer.from(await doc.save());
  const JOB = crypto.randomUUID();
  const TOKEN = crypto.randomBytes(16).toString('base64url');
  const state = { status: 'Created', prepared: null, signedPdf: null, failReason: null };
  const server = http.createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { success: false, message: 'bad token' });
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    try {
      if (req.url.endsWith('/session')) return json(200, { success: true, summary: { sample_id: 'S1', test: 'CBC', patient: 'Test P.', hospital: 'General Hospital Jayanagar', doctor: 'Dr Agent Test' }, expires_at: new Date(Date.now() + 600000).toISOString() });
      if (req.url.endsWith('/prepare')) {
        const certDer = Buffer.from(body.certificate, 'base64');
        const check = dscRemote.checkSigningCertificate(dscRemote.parseCertificate(certDer));
        if (!check.ok) return json(409, { success: false, code: 'DSC_CERT_REJECTED', message: check.problems.join('; ') });
        const p = await dscRemote.prepareRemoteSignature(report, certDer, { reason: 'Authorised laboratory report', location: 'General Hospital Jayanagar' });
        state.prepared = { ...p, certDer }; state.status = 'Prepared';
        return json(200, { success: true, attrs_der: p.attrsDer.toString('base64'), attrs_sha256: crypto.createHash('sha256').update(p.attrsDer).digest('hex') });
      }
      if (req.url.endsWith('/complete')) {
        const p = state.prepared;
        state.signedPdf = dscRemote.assembleRemoteSignature({ prepared: p.prepared, hexStart: p.hexStart, hexEnd: p.hexEnd, attrsDer: p.attrsDer, certDer: p.certDer, signature: Buffer.from(body.signature, 'base64') });
        state.status = 'Completed';
        return json(200, { success: true, message: 'Report digitally signed and approved.' });
      }
      if (req.url.endsWith('/fail')) { state.status = 'Failed'; state.failReason = body.reason; return json(200, { success: true }); }
      return json(404, { success: false });
    } catch (e) { return json(500, { success: false, code: e.code, message: e.message }); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const limsPort = server.address().port;
  const LIMS = `http://127.0.0.1:${limsPort}`;

  // ── the agent ──
  const config = require('../main/config');
  config.init(dir, false);
  config.save({ port: 18765, allowedServers: [LIMS], allowedOrigins: ['http://lims.test'], devP12Path: p12Path, sessionIdleSeconds: 60 });
  const events = [];
  const audit = { log: (e, d) => events.push({ e, ...d }) };
  const { TokenManager } = require('../main/tokenManager');
  const { SigningService } = require('../main/signingService');
  const { createAgentServer } = require('../main/agentServer');
  const tokens = new TokenManager({ getConfig: config.get, audit });
  tokens.reload();
  const signing = new SigningService({ config, tokens, audit, version: '0.1.0-test' });

  ok(tokens.tokens.length === 1 && tokens.tokens[0].label === 'Software test token', 'a token is detected');
  const certs = tokens.certificates('soft:test');
  ok(certs.length === 1 && certs[0].needsPin, 'its certificate is listed (shown after the PIN for the test file)');

  // local API
  const agent = createAgentServer({ config, tokens, signing, version: '0.1.0-test' });
  await agent.listen();
  const P = 18765;
  const health = await request(P, { url: '/health' });
  ok(health.status === 200 && health.json.name === 'Poxia DSC Agent', 'GET /health answers');
  ok((await request(P, { url: '/tokens' })).status === 403, 'no Origin → refused');
  ok((await request(P, { url: '/tokens', headers: { Origin: 'http://evil.example' } })).status === 403, 'unknown web page → refused');
  const okTokens = await request(P, { url: '/tokens', headers: { Origin: 'http://lims.test' } });
  ok(okTokens.status === 200 && okTokens.headers['access-control-allow-origin'] === 'http://lims.test' && okTokens.json.tokens.length === 1, 'allowed LIMS page lists tokens, with CORS');
  const pre = await request(P, { method: 'OPTIONS', url: '/sign', headers: { Origin: 'http://lims.test', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Private-Network': 'true' } });
  ok(pre.status === 204 && pre.headers['access-control-allow-private-network'] === 'true', 'private-network preflight allowed');
  ok((await request(P, { url: '/health', headers: { Host: `evil.example:${P}` } })).status === 403, 'a wrong Host header is refused (DNS rebinding)');
  const wrongServer = await request(P, { method: 'POST', url: '/sign', headers: { Origin: 'http://lims.test' }, body: { server: 'https://evil.example', jobId: JOB, token: TOKEN } });
  ok(wrongServer.status === 403, 'a server that is not allowed is refused', wrongServer.json?.code);
  const badBody = await request(P, { method: 'POST', url: '/sign', headers: { Origin: 'http://lims.test' }, body: { server: LIMS, jobId: 'not-a-job', token: TOKEN } });
  ok(badBody.status === 400, 'a malformed job id is refused');

  // start the signing the way the browser would
  const started = await request(P, { method: 'POST', url: '/sign', headers: { Origin: 'http://lims.test' }, body: { server: LIMS, jobId: JOB, token: TOKEN } });
  ok(started.status === 202 && started.json.accepted, 'POST /sign accepted');
  const busy = await request(P, { method: 'POST', url: '/sign', headers: { Origin: 'http://lims.test' }, body: { server: LIMS, jobId: crypto.randomUUID(), token: 'x' } });
  ok(busy.status === 409, 'a second report while one is open is refused');
  await new Promise((r) => setTimeout(r, 400));
  let snap = signing.snapshot();
  ok(snap.status === 'waiting' && snap.summary.test === 'CBC', 'the doctor sees what is being signed');

  // wrong PIN, then the right one
  const wrong = await signing.submit({ tokenId: 'soft:test', certId: 'soft:pending', pin: '000000' });
  ok(!wrong.ok && wrong.code === 'PIN_INCORRECT' && signing.snapshot().status === 'waiting', 'a wrong PIN is refused and the request stays open');
  const noPin = await signing.submit({ tokenId: 'soft:test', certId: 'soft:pending', pin: '' });
  ok(!noPin.ok && noPin.code === 'PIN_REQUIRED', 'no PIN → asked for it');
  const right = await signing.submit({ tokenId: 'soft:test', certId: 'soft:pending', pin: '123456' });
  ok(right.ok && signing.snapshot().status === 'done', 'the right PIN signs and the server accepts');

  const check = dscSigner.verifyPdfSignature(state.signedPdf);
  ok(check.valid && /Dr Agent Test/.test(check.signer), 'the finished PDF carries a valid signature', check.signer);
  ok(state.status === 'Completed', 'the server marked the job completed');
  ok(tokens.cached('soft:test') !== null, 'the token stays unlocked for the idle time (no PIN for the next report)');
  const jobStatus = await request(P, { url: `/jobs/${JOB}`, headers: { Origin: 'http://lims.test' } });
  ok(jobStatus.json.status === 'done', 'GET /jobs/:id reports done');
  ok(!JSON.stringify(events).includes('123456') && !JSON.stringify(events).includes('000000'), 'no PIN appears in the audit log');
  ok(['SIGNING_REQUEST_RECEIVED', 'PIN_REJECTED', 'PIN_ACCEPTED', 'CERTIFICATE_SELECTED', 'SIGNING_STARTED', 'SIGNATURE_CREATED', 'SIGNED_REPORT_ACCEPTED'].every((n) => events.some((x) => x.e === n)), 'the audit log records each step');

  // a cancelled request tells the server
  const JOB2 = crypto.randomUUID();
  state.status = 'Created';
  signing.accept({ server: LIMS, jobId: JOB2, token: TOKEN, origin: 'http://lims.test' });
  await new Promise((r) => setTimeout(r, 300));
  await signing.cancel();
  ok(signing.snapshot().status === 'cancelled' && state.status === 'Failed' && /Cancelled/.test(state.failReason), 'cancelling tells the server and nothing is released');

  tokens.stop();
  await agent.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
