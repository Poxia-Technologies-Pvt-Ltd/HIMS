const { EventEmitter } = require('events');
const { Pkcs11Provider } = require('./providers/pkcs11Provider');
const { SoftwareProvider } = require('./providers/softwareProvider');
const { discover } = require('./pkcs11Libraries');
const { SignError } = require('./providers/errors');

// Everything about the tokens plugged into this PC: which are present, their
// certificates, and the short-lived "unlocked" session that lets a doctor sign
// several reports without retyping the PIN. The PIN itself is never kept —
// only the open, logged-in token session, and only for the idle time set in
// Settings (0 = never kept). Removing the token ends it at once.
class TokenManager extends EventEmitter {
  constructor({ getConfig, audit }) {
    super();
    this.getConfig = getConfig;
    this.audit = audit;
    this.providers = [];
    this.tokens = [];
    this.libraryStatus = [];
    this.sessions = new Map(); // tokenId -> { session, last, timer }
    this.signature = '';
  }

  init() {
    this.reload();
    this.poll = setInterval(() => this.refresh(), 2000);
  }

  reload() {
    this.closeAll();
    for (const p of this.providers) { try { p.close(); } catch { /* ignore */ } }
    const cfg = this.getConfig();
    const libs = discover(cfg.pkcs11Libraries);
    const p11 = new Pkcs11Provider(libs);
    p11.init();
    this.libraryStatus = p11.status;
    this.providers = [p11];
    if (cfg.devP12Path) this.providers.push(new SoftwareProvider(cfg.devP12Path));
    this.refresh(true);
  }

  refresh(force = false) {
    const next = this.providers.flatMap((p) => { try { return p.listTokens(); } catch { return []; } });
    const sig = JSON.stringify(next.map((t) => [t.id, t.serial, t.pinLocked, t.pinFinalTry]));
    if (!force && sig === this.signature) return;
    const gone = this.tokens.filter((t) => !next.some((n) => n.id === t.id));
    gone.forEach((t) => { this.closeSession(t.id); this.audit.log('TOKEN_REMOVED', { token: t.label }); });
    next.filter((n) => !this.tokens.some((t) => t.id === n.id)).forEach((t) => this.audit.log('TOKEN_DETECTED', { token: t.label, manufacturer: t.manufacturer }));
    this.signature = sig;
    this.tokens = next;
    this.emit('tokens', next);
  }

  _provider(tokenId) {
    const t = this.tokens.find((x) => x.id === tokenId);
    const p = t && this.providers.find((x) => x.name === t.provider);
    if (!p) throw new SignError('TOKEN_REMOVED', 'The DSC token was removed. Put it back in and try again.');
    return p;
  }

  certificates(tokenId) {
    const certs = this._provider(tokenId).listCertificates(tokenId);
    // The certificates of the token's own CA chain are not for signing; list them last.
    return certs.sort((a, b) => Number(b.usable) - Number(a.usable));
  }

  /** The unlocked session for this token, if it is still within its idle time. */
  cached(tokenId) {
    const s = this.sessions.get(tokenId);
    if (!s) return null;
    const idle = this.getConfig().sessionIdleSeconds * 1000;
    if (!idle || Date.now() - s.last > idle) { this.closeSession(tokenId); return null; }
    return s.session;
  }

  /** Logs in with the PIN. A wrong PIN throws SignError('PIN_INCORRECT'). */
  login(tokenId, pin) {
    const token = this.tokens.find((t) => t.id === tokenId);
    if (token?.pinLocked) throw new SignError('PIN_LOCKED', 'The token is locked after too many wrong PINs. Contact your DSC provider to unlock it.');
    this.closeSession(tokenId);
    const session = this._provider(tokenId).login(tokenId, pin);
    this.sessions.set(tokenId, { session, last: Date.now(), timer: null });
    return session;
  }

  /** Called after a signing: keep the token unlocked for the idle time, or lock it now. */
  release(tokenId) {
    const s = this.sessions.get(tokenId);
    if (!s) return;
    const idle = this.getConfig().sessionIdleSeconds * 1000;
    if (!idle) { this.closeSession(tokenId); return; }
    s.last = Date.now();
    clearTimeout(s.timer);
    s.timer = setTimeout(() => this.closeSession(tokenId), idle + 500);
  }

  closeSession(tokenId) {
    const s = this.sessions.get(tokenId);
    if (!s) return;
    clearTimeout(s.timer);
    this.sessions.delete(tokenId);
    try { s.session.logout(); } catch { /* token already gone */ }
  }

  closeAll() { [...this.sessions.keys()].forEach((id) => this.closeSession(id)); }

  stop() {
    clearInterval(this.poll);
    this.closeAll();
    this.providers.forEach((p) => { try { p.close(); } catch { /* ignore */ } });
  }
}

module.exports = { TokenManager };
