import crypto from 'crypto';
import fs from 'fs';
import forge from 'node-forge';
import { addSignaturePlaceholder, SIG_RESERVED_BYTES, DscError } from './dscSigner.js';

// Signing with a key that never leaves the doctor's USB token (Poxia DSC Agent).
// The server and the agent split the work:
//   1. prepareRemoteSignature — the server renders the report PDF, reserves the
//      signature space, hashes everything that will be covered and builds the
//      CMS "signed attributes" — the exact bytes the token has to sign.
//   2. (agent) the token signs those bytes after the doctor types the PIN locally.
//   3. assembleRemoteSignature — the server checks the token's signature against
//      the certificate and embeds it, producing a standard PAdES-style PDF
//      signature (adbe.pkcs7.detached, with the signing-certificate attribute).
// The agent never receives the document, and the server never receives the PIN.

const { asn1 } = forge;
const T = asn1.Type;
const C = asn1.Class;
const OID = {
  data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4', signingTime: '1.2.840.113549.1.9.5',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  sha256: '2.16.840.1.101.3.4.2.1', rsaEncryption: '1.2.840.113549.1.1.1',
};
const oid = (s) => asn1.create(C.UNIVERSAL, T.OID, false, asn1.oidToDer(s).getBytes());
const seq = (children) => asn1.create(C.UNIVERSAL, T.SEQUENCE, true, children);
const set = (children) => asn1.create(C.UNIVERSAL, T.SET, true, children);
const octets = (bytes) => asn1.create(C.UNIVERSAL, T.OCTETSTRING, false, bytes);
const nul = () => asn1.create(C.UNIVERSAL, T.NULL, false, '');
const integer = (n) => asn1.create(C.UNIVERSAL, T.INTEGER, false, asn1.integerToDer(n).getBytes());
const derOf = (node) => asn1.toDer(node).getBytes();
const attribute = (type, value) => seq([oid(type), set([value])]);
const sha256bin = (bin) => crypto.createHash('sha256').update(Buffer.from(bin, 'binary')).digest('binary');

const toBin = (buf) => Buffer.from(buf).toString('binary');
const certAsn1 = (der) => asn1.fromDer(forge.util.createBuffer(toBin(der)));

/** Reads a DER certificate. Throws DscError if it is not a usable RSA certificate. */
export function parseCertificate(der) {
  try {
    const cert = forge.pki.certificateFromAsn1(certAsn1(der));
    if (!cert.publicKey?.n) throw new Error('not RSA');
    return cert;
  } catch {
    throw new DscError('That is not a usable RSA signing certificate.', 'DSC_BAD_CERT');
  }
}

export const fingerprintOf = (der) => crypto.createHash('sha256').update(Buffer.from(der)).digest('hex');

let roots;
const trustedRoots = () => {
  if (roots !== undefined) return roots;
  roots = null;
  const file = process.env.DSC_TRUSTED_ROOTS_PATH;
  if (file) {
    try {
      const pems = fs.readFileSync(file, 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
      roots = forge.pki.createCaStore(pems);
    } catch (e) { console.error('DSC_TRUSTED_ROOTS_PATH could not be read:', e.message); }
  }
  return roots;
};

/**
 * Is this certificate fit to sign a report? Returns { ok, problems, chain_verified }.
 * The chain is checked against DSC_TRUSTED_ROOTS_PATH (a PEM bundle of the
 * Controller of Certifying Authorities' roots) when that is set; otherwise it
 * is not checked and chain_verified is false. Revocation (CRL / OCSP) is not
 * checked here.
 */
export function checkSigningCertificate(cert, chainCerts = [], now = new Date()) {
  const problems = [];
  if (now < cert.validity.notBefore) problems.push(`not valid until ${cert.validity.notBefore.toLocaleDateString('en-IN')}`);
  if (now > cert.validity.notAfter) problems.push(`expired on ${cert.validity.notAfter.toLocaleDateString('en-IN')}`);
  if (cert.publicKey.n.bitLength() < 2048) problems.push('the key is shorter than 2048 bits');
  const bc = cert.getExtension('basicConstraints');
  if (bc?.cA) problems.push('it is a CA certificate, not a person\'s signing certificate');
  const ku = cert.getExtension('keyUsage');
  if (ku && !(ku.digitalSignature || ku.nonRepudiation || ku.contentCommitment)) problems.push('it is not allowed to sign documents');

  let chain_verified = false;
  const store = trustedRoots();
  if (store && problems.length === 0) {
    try { chain_verified = forge.pki.verifyCertificateChain(store, [cert, ...chainCerts]); } catch (e) {
      problems.push(`its certificate chain is not trusted (${e.message || 'unknown issuer'})`);
    }
  }
  return { ok: problems.length === 0, problems, chain_verified };
}

// Issuer and serial exactly as they appear in the certificate (for SignerInfo).
function issuerAndSerial(certNode) {
  const tbs = certNode.value[0];
  const hasVersion = tbs.value[0].tagClass === C.CONTEXT_SPECIFIC;
  const i = hasVersion ? 1 : 0;
  return seq([tbs.value[i + 2], tbs.value[i]]);
}

const sortedByDer = (nodes) => nodes.map((n) => ({ n, d: derOf(n) })).sort((a, b) => Buffer.compare(Buffer.from(a.d, 'binary'), Buffer.from(b.d, 'binary')));

function signedAttributes({ digest, certDer, signingTime }) {
  const certHash = sha256bin(toBin(certDer));
  return sortedByDer([
    attribute(OID.contentType, oid(OID.data)),
    attribute(OID.signingTime, asn1.create(C.UNIVERSAL, T.UTCTIME, false, asn1.dateToUtcTime(signingTime))),
    attribute(OID.messageDigest, octets(digest)),
    // PAdES: binds the signature to this exact certificate.
    attribute(OID.signingCertificateV2, seq([seq([seq([octets(certHash)])])])),
  ]).map((x) => x.n);
}

/**
 * Step 1. Returns the PDF with its signature space reserved, plus the DER bytes
 * the token must sign (a SET of signed attributes; RSA with SHA-256).
 */
export async function prepareRemoteSignature(pdfBuffer, certDer, { reason = '', location = '', name = '' } = {}) {
  const signingTime = new Date();
  signingTime.setMilliseconds(0);
  const { saved, hexStart, hexEnd } = await addSignaturePlaceholder(pdfBuffer, { reason, location, name, at: signingTime });
  const covered = Buffer.concat([saved.subarray(0, hexStart), saved.subarray(hexEnd)]);
  const digest = crypto.createHash('sha256').update(covered).digest('binary');
  const attrsDer = Buffer.from(derOf(set(signedAttributes({ digest, certDer, signingTime }))), 'binary');
  return { prepared: saved, hexStart, hexEnd, attrsDer, signingTime };
}

/**
 * Step 3. Checks the token's signature over the prepared attributes against
 * the certificate and embeds it. Throws DscError if the signature is not valid.
 */
export function assembleRemoteSignature({ prepared, hexStart, hexEnd, attrsDer, certDer, chainDers = [], signature }) {
  const cert = parseCertificate(certDer);
  const sig = Buffer.from(signature);
  const md = forge.md.sha256.create();
  md.update(toBin(attrsDer));
  let valid = false;
  try { valid = cert.publicKey.verify(md.digest().getBytes(), toBin(sig)); } catch { valid = false; }
  if (!valid) throw new DscError('The token\'s signature does not match its certificate.', 'DSC_BAD_SIGNATURE');

  // The signed attributes go in the SignerInfo as [0] IMPLICIT, with the same content that was signed.
  const attrs = asn1.fromDer(forge.util.createBuffer(toBin(attrsDer)));
  const attrsImplicit = asn1.create(C.CONTEXT_SPECIFIC, 0, true, attrs.value);
  const leaf = certAsn1(certDer);
  const signerInfo = seq([
    integer(1),
    issuerAndSerial(leaf),
    seq([oid(OID.sha256), nul()]),
    attrsImplicit,
    seq([oid(OID.rsaEncryption), nul()]),
    octets(toBin(sig)),
  ]);
  const signedData = seq([
    integer(1),
    set([seq([oid(OID.sha256), nul()])]),
    seq([oid(OID.data)]),
    asn1.create(C.CONTEXT_SPECIFIC, 0, true, [leaf, ...chainDers.map(certAsn1)]),
    set([signerInfo]),
  ]);
  const contentInfo = seq([oid(OID.signedData), asn1.create(C.CONTEXT_SPECIFIC, 0, true, [signedData])]);
  const cms = forge.util.bytesToHex(derOf(contentInfo));
  if (cms.length > SIG_RESERVED_BYTES * 2) throw new DscError('The certificate chain is too large to embed.', 'DSC_TOO_LARGE');

  const out = Buffer.from(prepared);
  out.write(cms.padEnd(SIG_RESERVED_BYTES * 2, '0'), hexStart + 1, 'latin1');
  return out;
}
