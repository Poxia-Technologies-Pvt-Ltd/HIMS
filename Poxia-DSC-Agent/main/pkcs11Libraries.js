const fs = require('fs');
const path = require('path');

// Every DSC token ships a PKCS#11 driver file (a .dll / .dylib / .so) — that is
// the one standard way to use a token's key, whatever its make. This finds the
// drivers of the common tokens that are installed on this PC. A token whose
// driver is elsewhere (or not listed) is added by hand under Settings →
// "PKCS#11 driver files", so no code change is ever needed for a new make.
//
// The file names below are the ones commonly installed with each vendor's
// driver; check the vendor's own install folder if a token is not found.
const WINDOWS = [
  'eps2003csp11.dll', 'eps2003csp11v2.dll', 'ngp11v211.dll',  // ePass / HyperPKI-type tokens (Feitian)
  'WDPKCS.dll', 'wdpkcs.dll',                                  // ProxKey (WatchData)
  'eTPKCS11.dll', 'eToken.dll',                                // SafeNet eToken
  'CryptoIDA_pkcs11.dll', 'mToken.dll',                        // mToken
  'aetpkss1.dll', 'asepkcs.dll',                               // ACS / Athena / ID tokens
  'SignatureP11.dll', 'cmP11.dll', 'cryptoki.dll',             // other common names
];
const MAC = [
  '/usr/local/lib/libeToken.dylib', '/Library/Frameworks/eToken.framework/Versions/Current/libeToken.dylib',
  '/usr/local/lib/opensc-pkcs11.so', '/Library/OpenSC/lib/opensc-pkcs11.so', '/usr/local/lib/libcastle.1.0.0.dylib',
];
const LINUX = [
  '/usr/lib/opensc-pkcs11.so', '/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so', '/usr/lib/libeToken.so', '/usr/lib/libcastle.so.1.0.0',
];

function candidates(extra = []) {
  const list = [];
  if (process.env.POXIA_PKCS11_LIB) list.push(process.env.POXIA_PKCS11_LIB);
  list.push(...extra);
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    for (const dir of [path.join(root, 'System32'), path.join(root, 'SysWOW64')]) for (const f of WINDOWS) list.push(path.join(dir, f));
  } else if (process.platform === 'darwin') {
    list.push(...MAC);
  } else {
    list.push(...LINUX);
  }
  return [...new Set(list)];
}

/** Driver files that exist on this PC (a Node process can load only one bitness, so 32-bit drivers simply fail to load and are reported). */
const discover = (extra = []) => candidates(extra).filter((p) => { try { return fs.existsSync(p); } catch { return false; } });

module.exports = { discover, candidates };
