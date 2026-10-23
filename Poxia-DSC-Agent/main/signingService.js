const crypto = require('crypto');
const { EventEmitter } = require('events');
const forge = require('node-forge');
const { SignError } = require('./providers/errors');
const { describeCertificate } = require('./providers/certInfo');

// Runs one report's signing, start to finish:
//   fetch what is being signed → doctor picks the certificate and types the PIN
//   → the token's certificate goes to the server → the server returns the exact
//   bytes to sign → the token signs them → the signature goes back.
// The document itself never comes here, and the PIN never leaves this PC.
const b64 = (buf) => Buffer.from(buf).toString('base64');
const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Problems the doctor can fix right there (another PIN, another certificate): the request stays open.
const RETRYABLE = new Set(['PIN_INCORRECT', 'PIN_REQUIRED', 'CERT_UNUSABLE', 'DSC_CERT_REJECTED', 'DSC_CERT_MISMATCH', 'DSC_BAD_CERT', 'TOKEN_REMOVED', 'NO_KEY', 'NOT_LOGGED_IN', 'MECHANISM', 'TOKEN_ERROR', 'TOKEN_UNRECOGNISED']);

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

class SigningService extends EventEmitter {
  constructor({ config, tokens, audit, version, fetchImpl }) {
    super();
    this.config = config;
    this.tokens = tokens;
    this.audit = audit;
    this.version = version;
    this.fetch = fetchImpl || fetch;
    this.job = null;
  }

  isBusy() { return !!this.job && ['loading', 'waiting', 'signing'].includes(this.job.status); }

  snapshot() {
    const j = this.job;
    return j ? { id: j.id, status: j.status, summary: j.summary, error: j.error, message: j.message, expiresAt: j.expiresAt } : null;
  }

  _emit() { this.emit('job', this.snapshot()); }

  async _api(job, method, path, body) {
    let res;
    try {
      res = await this.fetch(`${job.server}${path}`, {
        method,
        headers: { Authorization: `Bearer ${job.token}`, 'Content-Type': 'application/json', 'X-Poxia-Agent': this.version },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(45000),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Could not reach the LIMS server. Check the network and try again.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new ApiError(res.status, data.code || 'SERVER', data.message || `The server refused the request (${res.status}).`);
    return data;
  }

  /** The browser asked this agent to sign a job. Returns at once; progress is shown in the agent window. */
  accept({ server, jobId, token, origin }) {
    const cfg = this.config.get();
    const serverOrigin = this.config.origin(server);
    if (!serverOrigin || !cfg.allowedServers.includes(serverOrigin)) throw new ApiError(403, 'SERVER_NOT_ALLOWED', 'This LIMS server is not allowed. Add it in the agent settings.');
    if (!/^[0-9a-f-]{36}$/i.test(String(jobId || '')) || !token) throw new ApiError(400, 'BAD_REQUEST', 'The signing request is incomplete.');
    if (this.isBusy()) throw new ApiError(409, 'BUSY', 'Another report is being signed. Finish or cancel it first.');

    const job = { id: jobId, server: serverOrigin, token, status: 'loading', summary: null, error: null, message: null, expiresAt: null, signature: null, origin };
    this.job = job;
    this.audit.log('SIGNING_REQUEST_RECEIVED', { jobId, server: serverOrigin, origin });
    this._emit();
    this._load(job);
    return { accepted: true, jobId };
  }

  async _load(job) {
    try {
      const r = await this._api(job, 'GET', `/api/lab/dsc-agent/jobs/${job.id}/session`);
      job.summary = r.summary;
      job.expiresAt = r.expires_at;
      job.status = 'waiting';
      this._emit();
      this.emit('attention');
    } catch (e) {
      this._fail(job, e, false);
    }
  }

  _fail(job, e, tellServer = true) {
    job.status = 'failed';
    job.error = { code: e.code || 'ERROR', message: e.message };
    this.audit.log('SIGNING_FAILED', { jobId: job.id, code: job.error.code, message: e.message });
    if (tellServer && e.status !== 410 && e.code !== 'JOB_FINISHED') this._api(job, 'POST', `/api/lab/dsc-agent/jobs/${job.id}/fail`, { reason: e.message }).catch(() => {});
    this._emit();
  }

  /** The doctor chose a token and certificate and typed the PIN (not needed while the token is still unlocked). */
  async submit({ tokenId, certId, pin }) {
    const job = this.job;
    if (!job || job.status !== 'waiting') return { ok: false, code: 'NO_JOB', message: 'There is no report waiting to be signed.' };
    job.status = 'signing';
    job.error = null;
    this._emit();
    try {
      // A signature that was made but could not be delivered is simply sent again.
      if (job.signature) {
        await this._complete(job);
        return { ok: true };
      }

      let session = this.tokens.cached(tokenId);
      if (!session) {
        if (!pin) throw new SignError('PIN_REQUIRED', 'Enter the DSC PIN.');
        session = this.tokens.login(tokenId, pin);
        this.audit.log('PIN_ACCEPTED', { jobId: job.id });
      }

      const certs = this.tokens.certificates(tokenId);
      let cert = certs.find((c) => c.id === certId);
      if (cert && !cert.der && session.certificate) {
        // developer test token: the certificate only becomes readable after the password
        const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(session.certificate)).getBytes(), 'binary');
        cert = { ...cert, der, ...describeCertificate(der) };
      }
      if (!cert || !cert.der) throw new SignError('CERT_UNUSABLE', 'Choose a certificate.');
      if (!cert.usable) throw new SignError('CERT_UNUSABLE', `This certificate cannot be used: ${cert.reason}.`);
      this.audit.log('CERTIFICATE_SELECTED', { jobId: job.id, serial: cert.serial, subject: cert.subject });

      // Intermediate certificates on the token that issued this one travel with the signature.
      const chain = certs.filter((c) => c.der && c.id !== cert.id && c.subject === cert.issuerDn).map((c) => b64(c.der));
      const token = this.tokens.tokens.find((t) => t.id === tokenId);
      const prep = await this._api(job, 'POST', `/api/lab/dsc-agent/jobs/${job.id}/prepare`, {
        certificate: b64(cert.der), chain, agent: `Poxia DSC Agent ${this.version} (${token?.manufacturer || ''} ${token?.model || ''})`.trim(),
      });
      const attrs = Buffer.from(prep.attrs_der, 'base64');
      if (sha256hex(attrs) !== prep.attrs_sha256) throw new ApiError(0, 'INTEGRITY', 'The data to sign was damaged on the way. Nothing was signed.');

      this.audit.log('SIGNING_STARTED', { jobId: job.id });
      job.signature = session.sign(cert, attrs);
      this.audit.log('SIGNATURE_CREATED', { jobId: job.id });
      await this._complete(job);
      this.tokens.release(tokenId);
      return { ok: true };
    } catch (e) {
      return this._handle(job, e);
    }
  }

  async _complete(job) {
    const r = await this._api(job, 'POST', `/api/lab/dsc-agent/jobs/${job.id}/complete`, { signature: b64(job.signature) });
    job.status = 'done';
    job.message = r.message || 'Report digitally signed and approved.';
    job.signature = null;
    this.audit.log('SIGNED_REPORT_ACCEPTED', { jobId: job.id });
    this._emit();
  }

  _handle(job, e) {
    const code = e.code || 'ERROR';
    const message = e instanceof SignError || e instanceof ApiError ? e.message : 'Something went wrong while signing. Nothing was released.';
    if (!(e instanceof SignError) && !(e instanceof ApiError)) this.audit.log('SIGNING_ERROR', { jobId: job.id, detail: String(e.message).slice(0, 200) });
    // Fixable at the keyboard, or only the delivery failed (the made signature is kept for a retry).
    if (RETRYABLE.has(code) || (e instanceof ApiError && e.status === 0) || (job.signature && e.status !== 409 && e.status !== 400)) {
      job.status = 'waiting';
      job.error = { code, message };
      if (code === 'PIN_INCORRECT') this.audit.log('PIN_REJECTED', { jobId: job.id });
      this._emit();
      return { ok: false, code, message };
    }
    this._fail(job, Object.assign(new Error(message), { code, status: e.status }));
    return { ok: false, code, message, final: true };
  }

  async cancel() {
    const job = this.job;
    if (!job || !['loading', 'waiting', 'signing'].includes(job.status)) return { ok: true };
    job.status = 'cancelled';
    job.message = 'Cancelled. The report has NOT been released.';
    this.audit.log('SIGNING_CANCELLED', { jobId: job.id });
    this._emit();
    await this._api(job, 'POST', `/api/lab/dsc-agent/jobs/${job.id}/fail`, { reason: 'Cancelled at the agent' }).catch(() => {});
    return { ok: true };
  }
}

module.exports = { SigningService, ApiError };
