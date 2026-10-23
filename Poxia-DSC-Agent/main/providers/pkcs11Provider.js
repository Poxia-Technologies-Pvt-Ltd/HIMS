const crypto = require('crypto');
const { describeCertificate } = require('./certInfo');
const { SignError, fromPkcs11 } = require('./errors');

// Talks to any USB token through its PKCS#11 driver. Nothing here knows or
// cares which make the token is — HyperPKI, ProxKey, ePass, SafeNet, mToken…
// all appear as slots with certificates and a private key.
const SHA256_DIGESTINFO = Buffer.from('3031300d060960864801650304020105000420', 'hex');
const FLAG = { USER_PIN_COUNT_LOW: 0x10000, USER_PIN_FINAL_TRY: 0x20000, USER_PIN_LOCKED: 0x40000 };

const trim = (s) => String(s || '').replace(/\0/g, '').trim();

class Pkcs11Provider {
  constructor(libraries) {
    this.name = 'pkcs11';
    this.libraries = libraries;
    this.modules = [];       // { path, mod }
    this.status = [];        // [{ path, loaded, error }]
    this.pkcs11js = null;
  }

  /** Loads every driver file; one that fails (wrong bitness, missing dependency) is reported, not fatal. */
  init() {
    try { this.pkcs11js = require('pkcs11js'); }
    catch (e) {
      this.status = this.libraries.map((p) => ({ path: p, loaded: false, error: 'The PKCS#11 component is not installed in this build.' }));
      return;
    }
    for (const libPath of this.libraries) {
      try {
        const mod = new this.pkcs11js.PKCS11();
        mod.load(libPath);
        try { mod.C_Initialize(); } catch (e) { if (!/ALREADY_INITIALIZED/.test(String(e.message))) throw e; }
        this.modules.push({ path: libPath, mod });
        this.status.push({ path: libPath, loaded: true });
      } catch (e) {
        this.status.push({ path: libPath, loaded: false, error: trim(e.message).slice(0, 200) });
      }
    }
  }

  listTokens() {
    const out = [];
    this.modules.forEach(({ path: lib, mod }, mi) => {
      let slots = [];
      try { slots = mod.C_GetSlotList(true); } catch { return; }
      for (const slot of slots) {
        try {
          const t = mod.C_GetTokenInfo(slot);
          out.push({
            id: `p11:${mi}:${slot.toString('hex')}`, provider: this.name, library: lib,
            label: trim(t.label), manufacturer: trim(t.manufacturerID), model: trim(t.model), serial: trim(t.serialNumber),
            pinLocked: !!(t.flags & FLAG.USER_PIN_LOCKED), pinFinalTry: !!(t.flags & FLAG.USER_PIN_FINAL_TRY), pinCountLow: !!(t.flags & FLAG.USER_PIN_COUNT_LOW),
          });
        } catch { /* the token was removed while reading it */ }
      }
    });
    return out;
  }

  _locate(tokenId) {
    const m = /^p11:(\d+):([0-9a-f]+)$/.exec(tokenId || '');
    const entry = m && this.modules[Number(m[1])];
    if (!entry) throw new SignError('TOKEN_REMOVED', 'The DSC token was removed. Put it back in and try again.');
    return { mod: entry.mod, slot: Buffer.from(m[2], 'hex') };
  }

  _findAll(mod, session, template) {
    const found = [];
    mod.C_FindObjectsInit(session, template);
    try {
      for (;;) {
        const o = mod.C_FindObjects(session);
        if (!o) break;
        found.push(o);
      }
    } finally { mod.C_FindObjectsFinal(session); }
    return found;
  }

  /** The token's certificates (public objects: readable without the PIN). */
  listCertificates(tokenId) {
    const { mod, slot } = this._locate(tokenId);
    const P = this.pkcs11js;
    let session;
    try {
      session = mod.C_OpenSession(slot, P.CKF_SERIAL_SESSION);
      const certs = [];
      for (const obj of this._findAll(mod, session, [{ type: P.CKA_CLASS, value: P.CKO_CERTIFICATE }])) {
        try {
          const attrs = mod.C_GetAttributeValue(session, obj, [{ type: P.CKA_VALUE }, { type: P.CKA_ID }, { type: P.CKA_LABEL }]);
          const der = attrs[0].value;
          const info = describeCertificate(der);
          certs.push({ id: crypto.createHash('sha256').update(der).digest('hex'), keyId: attrs[1].value.toString('hex'), label: trim(attrs[2].value.toString()), der, ...info });
        } catch { /* not an X.509 certificate we can read */ }
      }
      return certs;
    } catch (e) { throw fromPkcs11(e); } finally {
      if (session) { try { mod.C_CloseSession(session); } catch { /* already gone */ } }
    }
  }

  /** Logs in with the PIN and returns a signing session. A wrong PIN throws PIN_INCORRECT. */
  login(tokenId, pin) {
    const { mod, slot } = this._locate(tokenId);
    const P = this.pkcs11js;
    let session;
    try {
      session = mod.C_OpenSession(slot, P.CKF_SERIAL_SESSION);
      try { mod.C_Login(session, P.CKU_USER, String(pin)); }
      catch (e) { if (!/ALREADY_LOGGED_IN/.test(String(e.message))) throw e; }
    } catch (e) {
      if (session) { try { mod.C_CloseSession(session); } catch { /* ignore */ } }
      throw fromPkcs11(e);
    }
    const self = this;
    return {
      sign(cert, data) {
        try {
          const keys = self._findAll(mod, session, [{ type: P.CKA_CLASS, value: P.CKO_PRIVATE_KEY }, { type: P.CKA_ID, value: Buffer.from(cert.keyId, 'hex') }]);
          if (!keys.length) throw new SignError('NO_KEY', 'The token has no private key for this certificate.');
          // The token hashes and signs (RSA PKCS#1 v1.5 with SHA-256); older tokens that cannot are given the hash instead.
          try {
            mod.C_SignInit(session, { mechanism: P.CKM_SHA256_RSA_PKCS }, keys[0]);
            return Buffer.from(mod.C_Sign(session, data, Buffer.alloc(1024)));
          } catch (e) {
            if (!/CKR_MECHANISM_INVALID/.test(String(e.message))) throw e;
            const digest = crypto.createHash('sha256').update(data).digest();
            mod.C_SignInit(session, { mechanism: P.CKM_RSA_PKCS }, keys[0]);
            return Buffer.from(mod.C_Sign(session, Buffer.concat([SHA256_DIGESTINFO, digest]), Buffer.alloc(1024)));
          }
        } catch (e) { throw fromPkcs11(e); }
      },
      logout() {
        try { mod.C_Logout(session); } catch { /* not logged in */ }
        try { mod.C_CloseSession(session); } catch { /* already closed */ }
      },
    };
  }

  close() {
    for (const { mod } of this.modules) { try { mod.C_Finalize(); } catch { /* ignore */ } }
    this.modules = [];
  }
}

module.exports = { Pkcs11Provider };
