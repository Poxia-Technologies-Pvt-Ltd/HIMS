import crypto from 'crypto';
import db from '../config/db.js';
import { verifyTest, buildLabReportData } from './labController.js';
import { generateLabReportPDFStream } from '../utils/pdfGenerator.js';
import { canonicalReportContent, contentHash, sealFor } from '../utils/reportSignature.js';
import { prepareRemoteSignature, assembleRemoteSignature, parseCertificate, checkSigningCertificate, fingerprintOf } from '../utils/dscRemote.js';
import { verifyPdfSignature, DscError } from '../utils/dscSigner.js';

// Poxia DSC Agent — signing a report with the doctor's own USB token.
//
//   doctor (browser)  POST /dsc-agent/jobs            → the server checks the approval would be
//                                                        accepted, renders the final report PDF
//                                                        and issues a one-time job token
//   browser → agent   (on the doctor's PC) "sign this job"
//   agent → server    GET  /jobs/:id/session           what is being signed (shown to the doctor)
//                     POST /jobs/:id/prepare           the token's certificate → the exact bytes to sign
//                     POST /jobs/:id/complete          the token's signature → the PDF is assembled,
//                                                        verified, and the report is approved + released
//   browser           GET  /dsc-agent/jobs/:id         waits for the result
//
// The PIN stays on the doctor's PC; the agent never receives the document; the
// server never receives the PIN. The job token works for one job, once, for a
// few minutes.

const JOB_MINUTES = 10;
const OPEN = ['Created', 'Prepared'];
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const b64 = (buf) => Buffer.from(buf).toString('base64');
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || null;

const streamToBuffer = (stream) => new Promise((resolve, reject) => {
  const chunks = [];
  stream.on('data', (c) => chunks.push(c));
  stream.on('end', () => resolve(Buffer.concat(chunks)));
  stream.on('error', reject);
});

// Runs the normal approval (labController.verifyTest) on the server's own behalf.
const runApproval = ({ body, user, ip, internal }) => new Promise((resolve) => {
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(b) { resolve({ status: this.statusCode, body: b }); return this; },
  };
  verifyTest({ body, user, ip, internal, headers: {}, query: {} }, res)
    .catch((e) => resolve({ status: 500, body: { success: false, message: e.message } }));
});

const maskName = (name) => String(name || '').split(/\s+/).filter(Boolean).map((w, i) => (i === 0 ? w : `${w[0]}.`)).join(' ');

async function expireOldJobs() {
  await db.query(
    `UPDATE report_signatures s JOIN dsc_signing_jobs j ON j.signature_id = s.id
        SET s.status = 'Cancelled'
      WHERE j.status IN ('Created', 'Prepared') AND j.expires_at < NOW() AND s.status = 'Pending'`);
  await db.query(
    `UPDATE dsc_signing_jobs SET status = 'Expired', message = 'Not signed in time', pdf_unsigned = NULL, prepared_pdf = NULL
      WHERE status IN ('Created', 'Prepared') AND expires_at < NOW()`);
}

async function finishJob(jobId, status, message) {
  await db.query(
    `UPDATE dsc_signing_jobs SET status = ?, message = ?, completed_at = NOW(3), pdf_unsigned = NULL, prepared_pdf = NULL, attrs_der = NULL WHERE id = ?`,
    [status, String(message || '').slice(0, 500), jobId]);
  if (status !== 'Completed') {
    await db.query("UPDATE report_signatures s JOIN dsc_signing_jobs j ON j.signature_id = s.id SET s.status = 'Cancelled' WHERE j.id = ? AND s.status = 'Pending'", [jobId]);
  }
}

// ── the doctor's browser ─────────────────────────────────────────────────────

// POST /api/lab/dsc-agent/jobs { test_result_id, sample_id, notes, password }
export const createJob = async (req, res) => {
  try {
    const actor = req.user;
    if (!actor?.id || actor.isDeviceKey) return res.status(403).json({ success: false, message: 'Sign in as a staff member to authorise reports.' });
    const { test_result_id: resultId, sample_id: sampleId, notes, password } = req.body || {};
    if (!resultId || !sampleId) return res.status(400).json({ success: false, message: 'test_result_id and sample_id are required' });

    const [[u]] = await db.query("SELECT branch_id, CONCAT_WS(' ', first_name, last_name) AS name FROM users WHERE id = ?", [actor.id]);
    const [[setting]] = await db.query('SELECT use_agent FROM branch_signing_settings WHERE branch_id = ?', [u?.branch_id]);
    if (!setting?.use_agent) return res.status(409).json({ success: false, message: 'Authorising with a USB token is not turned on for your hospital.' });

    // Would the approval be accepted right now (role, workflow step, login password, profile…)?
    const dry = await runApproval({ body: { test_result_id: resultId, sample_id: sampleId, status: 'Approved', notes, password }, user: actor, ip: req.ip, internal: { agent: true, dryRun: true } });
    if (dry.status !== 200 || !dry.body?.success) return res.status(dry.status).json(dry.body);

    await expireOldJobs();
    // One open attempt per report: an earlier unfinished one is replaced.
    await db.query("UPDATE report_signatures s JOIN dsc_signing_jobs j ON j.signature_id = s.id SET s.status = 'Cancelled' WHERE j.result_id = ? AND j.status IN ('Created', 'Prepared') AND s.status = 'Pending'", [resultId]);
    await db.query("UPDATE dsc_signing_jobs SET status = 'Cancelled', message = 'Replaced by a newer attempt', pdf_unsigned = NULL, prepared_pdf = NULL WHERE result_id = ? AND status IN ('Created', 'Prepared')", [resultId]);

    const [[row]] = await db.query('SELECT id, branch_id FROM lab_test_result WHERE id = ? AND sample_id = ?', [resultId, sampleId]);
    const [[signer]] = await db.query("SELECT CONCAT(first_name, ' ', last_name) AS name, registration_no, designation, signature_image FROM users WHERE id = ?", [actor.id]);
    const approvedAt = new Date();
    approvedAt.setMilliseconds(0);

    // The signature exists from the start as 'Pending' so the report (and its QR) can be
    // rendered exactly as it will be issued; it only takes effect when the token has signed.
    const hash = contentHash(await canonicalReportContent(db, row.id));
    const [ins] = await db.query(
      `INSERT INTO report_signatures (result_id, sample_id, branch_id, signer_id, signer_name, signer_role, registration_no, designation, signature_image,
                                      content_hash, seal, signed_at, ip_address, status, method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'Waiting for the doctor\\'s USB token')`,
      [row.id, sampleId, row.branch_id, actor.id, signer.name, actor.role || null, signer.registration_no, signer.designation || null, signer.signature_image,
       hash, sealFor({ hash, signerId: actor.id, signedAt: approvedAt }), approvedAt, req.ip || null]);
    const signatureId = ins.insertId;

    let pdf;
    let data;
    try {
      data = await buildLabReportData(sampleId, db, { resultId: row.id, signatureId, approvedAt, approverName: signer.name });
      if (!data || data.authentication?.state !== 'Authentic') throw new Error('the report could not be prepared');
      data.noServerSign = true;
      pdf = await streamToBuffer(await generateLabReportPDFStream(data));
    } catch (e) {
      await db.query("UPDATE report_signatures SET status = 'Cancelled' WHERE id = ?", [signatureId]);
      console.error('DSC job: could not render the report:', e);
      return res.status(500).json({ success: false, message: `The report could not be prepared for signing (${e.message}).` });
    }

    const summary = {
      sample_id: sampleId, test: data.tests?.[0]?.test_name || '', patient: maskName(data.patient_name),
      patient_reg_no: data.patient_reg_no ? `…${String(data.patient_reg_no).slice(-4)}` : '', hospital: data.branch_name || '',
      doctor: signer.name, requested_at: approvedAt.toISOString(),
    };
    const token = crypto.randomBytes(32).toString('base64url');
    const jobId = crypto.randomUUID();
    await db.query(
      `INSERT INTO dsc_signing_jobs (id, result_id, sample_id, branch_id, doctor_id, signature_id, token_hash, notes, approved_at, summary, pdf_unsigned, pdf_sha256, ip_address, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
      [jobId, row.id, sampleId, row.branch_id, actor.id, signatureId, sha(token), notes ? String(notes).slice(0, 1000) : null, approvedAt,
       JSON.stringify(summary), pdf, sha(pdf), req.ip || null, JOB_MINUTES]);

    res.status(201).json({ success: true, job: { id: jobId, token, expires_in: JOB_MINUTES * 60, summary } });
  } catch (error) {
    console.error('Error creating DSC signing job:', error);
    res.status(500).json({ success: false, message: 'Server error starting the signing' });
  }
};

// GET /api/lab/dsc-agent/jobs/:id — the browser waits on this.
export const getJob = async (req, res) => {
  try {
    await expireOldJobs();
    const [[job]] = await db.query('SELECT id, doctor_id, status, message, summary FROM dsc_signing_jobs WHERE id = ?', [req.params.id]);
    if (!job || job.doctor_id !== req.user?.id) return res.status(404).json({ success: false, message: 'Signing request not found.' });
    res.json({ success: true, status: job.status, message: job.message || null });
  } catch (error) {
    console.error('Error reading DSC job:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/lab/dsc-agent/jobs/:id/cancel
export const cancelJob = async (req, res) => {
  try {
    const [[job]] = await db.query('SELECT id, doctor_id, status FROM dsc_signing_jobs WHERE id = ?', [req.params.id]);
    if (!job || job.doctor_id !== req.user?.id) return res.status(404).json({ success: false, message: 'Signing request not found.' });
    if (OPEN.includes(job.status)) await finishJob(job.id, 'Cancelled', 'Cancelled by the doctor');
    res.json({ success: true });
  } catch (error) {
    console.error('Error cancelling DSC job:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── the agent (authenticated by the one-time job token) ──────────────────────

export const jobTokenAuth = async (req, res, next) => {
  try {
    const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '');
    const [[job]] = await db.query('SELECT * FROM dsc_signing_jobs WHERE id = ?', [req.params.id]);
    const given = Buffer.from(sha(m?.[1] || ''));
    const real = Buffer.from(job?.token_hash || '0'.repeat(64));
    if (!m || !job || given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
      return res.status(401).json({ success: false, message: 'This signing request is not valid.' });
    }
    if (OPEN.includes(job.status) && new Date(job.expires_at) < new Date()) {
      await expireOldJobs();
      return res.status(410).json({ success: false, code: 'JOB_EXPIRED', message: 'This signing request has expired. Start it again from the report.' });
    }
    if (!OPEN.includes(job.status) && !(req.path.endsWith('/complete') && job.status === 'Prepared')) {
      return res.status(409).json({ success: false, code: 'JOB_FINISHED', message: `This signing request is already ${job.status.toLowerCase()}.` });
    }
    req.job = job;
    next();
  } catch (error) {
    console.error('DSC job auth error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const jobSummary = (job) => (typeof job.summary === 'string' ? JSON.parse(job.summary) : job.summary) || {};

// GET /api/lab/dsc-agent/jobs/:id/session
export const agentSession = (req, res) => {
  const s = jobSummary(req.job);
  res.json({
    success: true, job_id: req.job.id, summary: s, document_sha256: req.job.pdf_sha256,
    expires_at: req.job.expires_at, server_time: new Date().toISOString(),
  });
};

// POST /api/lab/dsc-agent/jobs/:id/prepare { certificate, chain?, agent? } — base64 DER
export const agentPrepare = async (req, res) => {
  try {
    const job = req.job;
    let certDer;
    let cert;
    let chainDers;
    let chainCerts;
    try {
      certDer = Buffer.from(String(req.body?.certificate || ''), 'base64');
      cert = parseCertificate(certDer);
      chainDers = (Array.isArray(req.body?.chain) ? req.body.chain : []).slice(0, 5).map((c) => Buffer.from(String(c), 'base64'));
      chainCerts = chainDers.map(parseCertificate);
    } catch (e) {
      return res.status(400).json({ success: false, code: e.code || 'DSC_BAD_CERT', message: e.message });
    }
    const check = checkSigningCertificate(cert, chainCerts);
    if (!check.ok) {
      return res.status(409).json({ success: false, code: 'DSC_CERT_REJECTED', message: `This certificate cannot be used to sign: ${check.problems.join('; ')}.` });
    }

    // The certificate registered for this doctor (set the first time they sign).
    const [[enrolled]] = await db.query("SELECT id, fingerprint, common_name, serial FROM user_dsc_certificates WHERE user_id = ? AND kind = 'Token' AND status = 'Active' ORDER BY id DESC LIMIT 1", [job.doctor_id]);
    if (enrolled && enrolled.fingerprint !== fingerprintOf(certDer)) {
      return res.status(409).json({
        success: false, code: 'DSC_CERT_MISMATCH',
        message: `This is not the certificate registered for you (${enrolled.common_name}, serial ${enrolled.serial}). Use that token, or ask your hospital admin to reset your registered certificate.`,
      });
    }

    const s = jobSummary(job);
    const { prepared, hexStart, hexEnd, attrsDer, signingTime } = await prepareRemoteSignature(job.pdf_unsigned, certDer, {
      reason: `Authorised laboratory report — ${s.doctor || 'authorised signatory'}`, location: s.hospital || '',
    });
    await db.query(
      `UPDATE dsc_signing_jobs SET status = 'Prepared', prepared_pdf = ?, attrs_der = ?, hex_start = ?, hex_end = ?, signing_time = ?, cert_der = ?, chain_json = ?, agent_info = ? WHERE id = ?`,
      [prepared, attrsDer, hexStart, hexEnd, signingTime, certDer, JSON.stringify(chainDers.map(b64)), String(req.body?.agent || '').slice(0, 300) || null, job.id]);

    res.json({
      success: true, algorithm: 'RSA-SHA256', attrs_der: b64(attrsDer), attrs_sha256: sha(attrsDer),
      first_use: !enrolled, chain_verified: check.chain_verified,
      certificate: { common_name: cert.subject.getField('CN')?.value || '', serial: cert.serialNumber, valid_to: cert.validity.notAfter.toISOString() },
    });
  } catch (error) {
    console.error('DSC prepare failed:', error);
    res.status(500).json({ success: false, message: `Could not prepare the report for signing (${error.message}).` });
  }
};

// POST /api/lab/dsc-agent/jobs/:id/complete { signature } — base64
export const agentComplete = async (req, res) => {
  const job = req.job;
  try {
    // Only one completion may run.
    const [claim] = await db.query("UPDATE dsc_signing_jobs SET status = 'Completing' WHERE id = ? AND status = 'Prepared'", [job.id]);
    if (!claim.affectedRows) return res.status(409).json({ success: false, message: 'This signing request is not ready to complete.' });

    let signed;
    try {
      signed = assembleRemoteSignature({
        prepared: job.prepared_pdf, hexStart: job.hex_start, hexEnd: job.hex_end, attrsDer: job.attrs_der, certDer: job.cert_der,
        chainDers: JSON.parse(job.chain_json || '[]').map((c) => Buffer.from(c, 'base64')), signature: Buffer.from(String(req.body?.signature || ''), 'base64'),
      });
      const check = verifyPdfSignature(signed);
      if (!check.valid) throw new DscError('The signed report did not verify.', 'DSC_BAD_SIGNATURE');
    } catch (e) {
      await finishJob(job.id, 'Failed', e.message);
      return res.status(400).json({ success: false, code: e.code || 'DSC_BAD_SIGNATURE', message: `The report was not approved: ${e.message}` });
    }

    // The certificate becomes the doctor's registered one the first time.
    const cert = parseCertificate(job.cert_der);
    const fp = fingerprintOf(job.cert_der);
    const [[doctor]] = await db.query('SELECT id, role, role_level, branch_id FROM users WHERE id = ?', [job.doctor_id]);
    let [[enrolled]] = await db.query("SELECT id FROM user_dsc_certificates WHERE user_id = ? AND kind = 'Token' AND status = 'Active' AND fingerprint = ? LIMIT 1", [job.doctor_id, fp]);
    if (!enrolled) {
      const subject = cert.subject.attributes.map((a) => `${a.shortName || a.name}=${a.value}`).join(', ');
      const issuer = cert.issuer.attributes.map((a) => `${a.shortName || a.name}=${a.value}`).join(', ');
      const [ins] = await db.query(
        `INSERT INTO user_dsc_certificates (user_id, kind, branch_id, cert_der, fingerprint, common_name, subject, issuer, serial, valid_from, valid_to, token_info, uploaded_by)
         VALUES (?, 'Token', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [job.doctor_id, job.branch_id, job.cert_der, fp, (cert.subject.getField('CN')?.value || subject).slice(0, 200), subject.slice(0, 500), issuer.slice(0, 500),
         String(cert.serialNumber).slice(0, 100), cert.validity.notBefore, cert.validity.notAfter, (job.agent_info || '').slice(0, 200) || null, job.doctor_id]);
      enrolled = { id: ins.insertId };
    }

    const out = await runApproval({
      body: { test_result_id: job.result_id, sample_id: job.sample_id, status: 'Approved', notes: job.notes },
      user: doctor, ip: job.ip_address,
      internal: { agent: true, passwordVerified: true, approvedAt: job.approved_at, signatureId: job.signature_id, signedPdf: signed, dscId: enrolled.id },
    });
    if (out.status === 200 && out.body?.success) {
      await finishJob(job.id, 'Completed', 'Report digitally signed and approved');
      return res.json({ success: true, message: 'Report digitally signed and approved.' });
    }
    await finishJob(job.id, 'Failed', out.body?.message || 'The approval was refused');
    return res.status(out.status >= 400 ? out.status : 409).json({ success: false, code: out.body?.code, message: out.body?.message || 'The approval was refused.' });
  } catch (error) {
    console.error('DSC complete failed:', error);
    await finishJob(job.id, 'Failed', error.message).catch(() => {});
    res.status(500).json({ success: false, message: 'Server error finishing the signing' });
  }
};

// POST /api/lab/dsc-agent/jobs/:id/fail { reason } — the doctor cancelled, or the token could not sign.
export const agentFail = async (req, res) => {
  try {
    await finishJob(req.job.id, 'Failed', String(req.body?.reason || 'Signing was not completed').slice(0, 300));
    res.json({ success: true });
  } catch (error) {
    console.error('DSC fail report error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
