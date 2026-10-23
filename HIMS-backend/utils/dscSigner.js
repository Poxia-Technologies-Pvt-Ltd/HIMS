import fs from 'fs';
import crypto from 'crypto';
import forge from 'node-forge';
import { PDFDocument, PDFName, PDFHexString, PDFString, PDFArray } from 'pdf-lib';

// Digital Signature Certificate (DSC) signing of authorised report PDFs
// (tender #36). Every authorised report is signed with the hospital's / the
// Government's signing certificate as a standard embedded PDF signature
// (PKCS#7 detached, adbe.pkcs7.detached), so Adobe Reader and any PDF viewer
// show who signed it and whether it was changed afterwards — independent of
// this system. It sits on top of the login-based e-authentication (signature
// image, hash seal, QR) and never replaces it.
//
// Configuration (server environment):
//   REPORT_DSC_P12_PATH      path to the PKCS#12 (.p12 / .pfx) holding the certificate and key
//   REPORT_DSC_P12_BASE64    …or the same file, base64-encoded (for hosts without a file mount)
//   REPORT_DSC_P12_PASSWORD  its password
// Nothing is signed (and nothing breaks) while these are not set.

const SIG_BYTES = 12288;                 // room reserved for the signature (cert chain included)
const RANGE_PLACEHOLDER = '9999999999';
const OID = { messageDigest: '1.2.840.113549.1.9.4', contentType: '1.2.840.113549.1.9.3', signingTime: '1.2.840.113549.1.9.5' };

let cached = null;       // { sourceKey, signer }
let lastError = null;

export class DscError extends Error {
  constructor(message, code = 'DSC_ERROR') { super(message); this.code = code; }
}

const source = () => {
  const file = process.env.REPORT_DSC_P12_PATH;
  const b64 = process.env.REPORT_DSC_P12_BASE64;
  if (file) return { kind: 'file', file, key: `file:${file}:${(() => { try { return fs.statSync(file).mtimeMs; } catch { return 'missing'; } })()}` };
  if (b64) return { kind: 'b64', b64, key: `b64:${crypto.createHash('sha256').update(b64).digest('hex')}` };
  return null;
};

export const dscConfigured = () => !!source();

const nameOf = (attrs) => attrs.map((a) => `${a.shortName || a.name}=${a.value}`).join(', ');

/**
 * Opens a PKCS#12 (.p12 / .pfx) with its password and returns the signer
 * (private key, certificate, chain and readable details). Nothing is kept.
 */
export function openPkcs12(raw, password) {
  let p12;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(raw).toString('binary'))), false, password || '');
  } catch (e) {
    const wrong = /password|MAC/i.test(e.message);
    throw new DscError(
      wrong ? 'The DSC password is incorrect.' : `Could not read this certificate file (re-export it with "openssl pkcs12 -export -legacy" if it uses newer encryption): ${e.message}`,
      wrong ? 'DSC_PASSWORD_WRONG' : 'DSC_UNREADABLE');
  }

  const bagsOf = (type) => p12.getBags({ bagType: type })[type] || [];
  const keyBag = [...bagsOf(forge.pki.oids.pkcs8ShroudedKeyBag), ...bagsOf(forge.pki.oids.keyBag)].find((b) => b.key);
  if (!keyBag) throw new DscError('The certificate file holds no private key.', 'DSC_NO_KEY');
  const key = keyBag.key;
  const certs = bagsOf(forge.pki.oids.certBag).map((b) => b.cert).filter(Boolean);
  const leaf = certs.find((c) => c.publicKey?.n && key.n && c.publicKey.n.compareTo(key.n) === 0);
  if (!leaf) throw new DscError('The certificate file has no certificate matching its private key.', 'DSC_NO_CERT');

  return {
    key, certificate: leaf, chain: certs.filter((c) => c !== leaf),
    info: {
      subject: nameOf(leaf.subject.attributes),
      common_name: leaf.subject.getField('CN')?.value || nameOf(leaf.subject.attributes),
      issuer: nameOf(leaf.issuer.attributes),
      serial: leaf.serialNumber,
      valid_from: leaf.validity.notBefore,
      valid_to: leaf.validity.notAfter,
    },
  };
}

// The server-wide certificate from the environment (cached until the file changes).
function loadSigner() {
  const src = source();
  if (!src) throw new DscError('No signing certificate is configured.', 'DSC_NOT_CONFIGURED');
  if (cached && cached.sourceKey === src.key) return cached.signer;
  let raw;
  try { raw = src.kind === 'file' ? fs.readFileSync(src.file) : Buffer.from(src.b64, 'base64'); }
  catch (e) { throw new DscError(`Could not read the certificate file: ${e.message}`, 'DSC_UNREADABLE'); }
  const signer = openPkcs12(raw, process.env.REPORT_DSC_P12_PASSWORD || '');
  cached = { sourceKey: src.key, signer };
  return signer;
}

/** What the admin screen shows: is signing on, whose certificate, how long it lasts. */
export function dscStatus() {
  if (!dscConfigured()) return { configured: false, last_error: lastError };
  try {
    const { info } = loadSigner();
    const daysLeft = Math.floor((info.valid_to.getTime() - Date.now()) / 86400000);
    return {
      configured: true, ok: daysLeft >= 0 && info.valid_from.getTime() <= Date.now(), ...info,
      valid_from: info.valid_from.toISOString(), valid_to: info.valid_to.toISOString(), days_left: daysLeft,
      expiring_soon: daysLeft >= 0 && daysLeft <= 30, expired: daysLeft < 0, last_error: lastError,
    };
  } catch (e) {
    return { configured: true, ok: false, error: e.message, last_error: lastError };
  }
}

export const SIG_RESERVED_BYTES = SIG_BYTES;

/**
 * Adds an empty, invisible PDF signature field to the document and reserves
 * the space for the signature. Returns the file (ByteRange already filled in)
 * and where the signature goes: the bytes outside [hexStart, hexEnd) are what
 * gets signed.
 */
export async function addSignaturePlaceholder(pdfBuffer, { reason = '', location = '', name = '', at = new Date() } = {}) {
  const pdf = await PDFDocument.load(pdfBuffer, { updateMetadata: false });
  const ctx = pdf.context;

  const sig = ctx.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached' });
  sig.set(PDFName.of('ByteRange'), ctx.obj([0, Number(RANGE_PLACEHOLDER), Number(RANGE_PLACEHOLDER), Number(RANGE_PLACEHOLDER)]));
  sig.set(PDFName.of('Contents'), PDFHexString.of('0'.repeat(SIG_BYTES * 2)));
  sig.set(PDFName.of('M'), PDFString.fromDate(at));
  if (name) sig.set(PDFName.of('Name'), PDFHexString.fromText(name));
  if (reason) sig.set(PDFName.of('Reason'), PDFHexString.fromText(reason));
  if (location) sig.set(PDFName.of('Location'), PDFHexString.fromText(location));
  const sigRef = ctx.register(sig);

  const page = pdf.getPage(0);
  const widgetRef = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [0, 0, 0, 0], F: 132, V: sigRef, P: page.ref,
    T: PDFHexString.fromText('DigitalSignature1'),
  }));
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (annots) annots.push(widgetRef); else page.node.set(PDFName.of('Annots'), ctx.obj([widgetRef]));
  pdf.catalog.set(PDFName.of('AcroForm'), ctx.obj({ SigFlags: 3, Fields: [widgetRef] }));

  const saved = Buffer.from(await pdf.save({ useObjectStreams: false }));

  // Find the reserved signature space and the ByteRange placeholder.
  const text = saved.toString('latin1');
  const contents = /\/Contents\s*<(0{64,})>/.exec(text);
  const range = /\/ByteRange\s*\[\s*0\s+9999999999\s+9999999999\s+9999999999\s*\]/.exec(text);
  if (!contents || !range) throw new DscError('Could not place the signature in the PDF.');
  const hexStart = contents.index + contents[0].indexOf('<');           // the "<"
  const hexEnd = hexStart + 1 + contents[1].length + 1;                // just after the ">"
  const rangeArrayStart = range.index + range[0].indexOf('[');
  const rangeArrayLen = range[0].length - range[0].indexOf('[');
  const newRange = `[0 ${hexStart} ${hexEnd} ${saved.length - hexEnd}]`.padEnd(rangeArrayLen, ' ');
  if (newRange.length !== rangeArrayLen) throw new DscError('Unexpected PDF layout.');
  saved.write(newRange, rangeArrayStart, 'latin1');
  return { saved, hexStart, hexEnd };
}

/**
 * Adds an embedded, invisible PDF signature (incremental placeholder + CMS)
 * covering the whole file. Throws DscError if it cannot sign.
 */
export async function signPdf(pdfBuffer, meta = {}, withSigner = null) {
  const signer = withSigner || loadSigner();
  const now = new Date();
  if (now < signer.info.valid_from || now > signer.info.valid_to) throw new DscError('The signing certificate is not within its validity period.');

  const { saved, hexStart, hexEnd } = await addSignaturePlaceholder(pdfBuffer, { ...meta, at: now });
  const covered = Buffer.concat([saved.subarray(0, hexStart), saved.subarray(hexEnd)]);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(covered.toString('binary'));
  p7.addCertificate(signer.certificate);
  signer.chain.forEach((c) => p7.addCertificate(c));
  p7.addSigner({
    key: signer.key, certificate: signer.certificate, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: now },
    ],
  });
  p7.sign({ detached: true });
  const cms = forge.util.bytesToHex(forge.asn1.toDer(p7.toAsn1()).getBytes());
  if (cms.length > SIG_BYTES * 2) throw new DscError('The certificate chain is too large to embed.');
  saved.write(cms.padEnd(SIG_BYTES * 2, '0'), hexStart + 1, 'latin1');
  return saved;
}

/**
 * With a doctor's signer: signs with it, and fails loudly (the caller authorised
 * the report on the strength of that signature).
 * Without one: signs with the server's certificate when configured; otherwise
 * (or on any problem) returns the PDF unchanged.
 */
export async function signPdfIfConfigured(pdfBuffer, meta, withSigner = null) {
  if (withSigner) return signPdf(pdfBuffer, meta, withSigner);
  if (!dscConfigured()) return pdfBuffer;
  try {
    const out = await signPdf(pdfBuffer, meta);
    lastError = null;
    return out;
  } catch (e) {
    // A report must still reach the patient; the problem is shown on the admin screen.
    lastError = `${new Date().toISOString()} — ${e.message}`;
    console.error('DSC signing failed, sending the report without a digital signature:', e.message);
    return pdfBuffer;
  }
}

// ── Verification (used by the admin "test signing" check) ───────────────────

const children = (node) => (Array.isArray(node?.value) ? node.value : []);
function findNodes(node, test, out = []) {
  if (test(node)) out.push(node);
  children(node).forEach((c) => findNodes(c, test, out));
  return out;
}

/**
 * Checks the embedded signature of a signed PDF: the digest of the signed byte
 * ranges, the RSA signature over the signed attributes, and the certificate.
 */
export function verifyPdfSignature(pdfBuffer) {
  const text = pdfBuffer.toString('latin1');
  const range = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text);
  const contents = /\/Contents\s*<([0-9A-Fa-f]{64,})>/.exec(text);
  if (!range || !contents) return { signed: false };
  const [a, b, c, d] = range.slice(1).map(Number);
  const covered = Buffer.concat([pdfBuffer.subarray(a, a + b), pdfBuffer.subarray(c, c + d)]);
  const coversAll = a === 0 && c + d === pdfBuffer.length;

  const der = Buffer.from(contents[1], 'hex');
  // The reserved space is zero-padded; read exactly the DER structure.
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(der.toString('binary')), { strict: false, parseAllBytes: false });

  const certNodes = findNodes(asn1, (n) => n.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && n.type === 0 && children(n)[0]?.type === forge.asn1.Type.SEQUENCE
    && children(n).every((x) => x.type === forge.asn1.Type.SEQUENCE) && children(children(n)[0])[0]?.type === forge.asn1.Type.SEQUENCE);
  const certificate = (() => {
    for (const holder of certNodes) {
      for (const n of children(holder)) { try { return forge.pki.certificateFromAsn1(n); } catch { /* not a certificate */ } }
    }
    return null;
  })();

  const signerInfo = findNodes(asn1, (n) => n.type === forge.asn1.Type.SEQUENCE && children(n)[0]?.type === forge.asn1.Type.INTEGER
    && children(n).some((x) => x.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && x.type === 0)).pop();
  if (!signerInfo || !certificate) return { signed: true, valid: false, reason: 'Signature structure not recognised.' };
  const parts = children(signerInfo);
  const attrs = parts.find((x) => x.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && x.type === 0);
  const signature = parts[parts.length - 1];

  const attrNode = (oid) => children(attrs).find((at) => forge.asn1.derToOid(children(at)[0].value) === oid);
  const digestInSig = children(children(attrNode(OID.messageDigest))[1])[0].value;
  const digestOfPdf = crypto.createHash('sha256').update(covered).digest('latin1');
  const digestOk = digestInSig === digestOfPdf;

  // The signature is over the attributes re-tagged as a universal SET.
  const asSet = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, children(attrs));
  const md = forge.md.sha256.create();
  md.update(forge.asn1.toDer(asSet).getBytes());
  let signatureOk = false;
  try { signatureOk = certificate.publicKey.verify(md.digest().getBytes(), signature.value); } catch { signatureOk = false; }

  const now = new Date();
  return {
    signed: true, coversAll, digestOk, signatureOk, valid: coversAll && digestOk && signatureOk,
    signer: nameOf(certificate.subject.attributes), issuer: nameOf(certificate.issuer.attributes),
    certificate_valid_now: now >= certificate.validity.notBefore && now <= certificate.validity.notAfter,
  };
}
