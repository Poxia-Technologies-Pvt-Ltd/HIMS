const forge = require('node-forge');

// Reads a DER certificate into what the doctor needs to choose between several,
// and says whether it can sign documents.
function describeCertificate(der) {
  const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(der).toString('binary'))));
  const attrs = (a) => a.attributes.map((x) => `${x.shortName || x.name}=${x.value}`).join(', ');
  const now = new Date();
  let usable = true;
  let reason = null;
  if (now < cert.validity.notBefore) { usable = false; reason = `not valid until ${cert.validity.notBefore.toLocaleDateString('en-IN')}`; }
  else if (now > cert.validity.notAfter) { usable = false; reason = `expired on ${cert.validity.notAfter.toLocaleDateString('en-IN')}`; }
  else if (!cert.publicKey?.n) { usable = false; reason = 'not an RSA certificate'; }
  else if (cert.getExtension('basicConstraints')?.cA) { usable = false; reason = 'a CA certificate'; }
  else {
    const ku = cert.getExtension('keyUsage');
    if (ku && !(ku.digitalSignature || ku.nonRepudiation || ku.contentCommitment)) { usable = false; reason = 'not for signing documents'; }
  }
  return {
    commonName: cert.subject.getField('CN')?.value || attrs(cert.subject),
    subject: attrs(cert.subject), issuerDn: attrs(cert.issuer), issuer: cert.issuer.getField('CN')?.value || attrs(cert.issuer),
    serial: cert.serialNumber.toUpperCase(),
    notBefore: cert.validity.notBefore.toISOString(), notAfter: cert.validity.notAfter.toISOString(),
    usable, reason,
  };
}

module.exports = { describeCertificate };
