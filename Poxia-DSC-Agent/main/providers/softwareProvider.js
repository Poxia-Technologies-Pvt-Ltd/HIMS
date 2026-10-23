const crypto = require('crypto');
const fs = require('fs');
const forge = require('node-forge');
const { describeCertificate } = require('./certInfo');
const { SignError } = require('./errors');

// DEVELOPER TEST ONLY. Behaves like a token whose "PIN" is the password of a
// .p12 file, so the whole signing flow can be rehearsed without hardware. It is
// off unless a .p12 path is set in Settings; real doctors use a USB token.
class SoftwareProvider {
  constructor(p12Path) {
    this.name = 'software';
    this.p12Path = p12Path;
  }

  init() { /* nothing to load */ }

  listTokens() {
    if (!this.p12Path || !fs.existsSync(this.p12Path)) return [];
    return [{ id: 'soft:test', provider: this.name, library: this.p12Path, label: 'Software test token', manufacturer: 'Poxia (developer test)', model: '.p12 file', serial: 'TEST', pinLocked: false, pinFinalTry: false, pinCountLow: false }];
  }

  _open(pin) {
    try {
      const raw = fs.readFileSync(this.p12Path);
      const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(raw.toString('binary'))), false, String(pin));
      const bag = (t) => p12.getBags({ bagType: t })[t] || [];
      const key = [...bag(forge.pki.oids.pkcs8ShroudedKeyBag), ...bag(forge.pki.oids.keyBag)].find((b) => b.key)?.key;
      const cert = bag(forge.pki.oids.certBag).map((b) => b.cert).find((c) => c && key && c.publicKey.n.compareTo(key.n) === 0);
      if (!key || !cert) throw new SignError('TOKEN_ERROR', 'The test file has no key and certificate.');
      return { key, cert };
    } catch (e) {
      if (e instanceof SignError) throw e;
      throw new SignError('PIN_INCORRECT', 'The PIN is incorrect.');
    }
  }

  listCertificates() {
    // An encrypted .p12 cannot be read before its password is typed, so the entry is a
    // placeholder until then; the agent takes the real certificate from the login.
    try {
      const { cert } = this._open('');
      const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
      return [{ id: crypto.createHash('sha256').update(der).digest('hex'), keyId: 'test', label: 'Test certificate', der, ...describeCertificate(der) }];
    } catch {
      return [{ id: 'soft:pending', keyId: 'test', label: 'Test certificate', der: null, needsPin: true, commonName: '(shown after the password is entered)', subject: '', issuer: '', serial: '', notBefore: '', notAfter: '', usable: true, reason: null }];
    }
  }

  login(_tokenId, pin) {
    const { key, cert } = this._open(pin);
    return {
      certificate: cert,
      sign(_cert, data) {
        const md = forge.md.sha256.create();
        md.update(Buffer.from(data).toString('binary'));
        return Buffer.from(key.sign(md), 'binary');
      },
      logout() { /* nothing held */ },
    };
  }

  close() { /* nothing held */ }
}

module.exports = { SoftwareProvider };
