// First check on a new token / PC: does the agent find the driver, the token and its
// certificates? Needs no PIN and signs nothing.
//   npm run diagnose
// (The token module is built for Electron, so this relaunches itself inside Electron's Node.)
const { spawnSync } = require('child_process');
const path = require('path');

if (!process.versions.electron) {
  const electron = require('electron');
  const r = spawnSync(electron, [__filename, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  process.exit(r.status ?? 1);
}

const { discover, candidates } = require('../main/pkcs11Libraries');
const { Pkcs11Provider } = require('../main/providers/pkcs11Provider');

const extra = process.argv.slice(2);   // optional: full paths to driver files to try as well
const found = discover(extra);
console.log(`Platform: ${process.platform} ${process.arch}`);
console.log(`\nDriver files looked for: ${candidates(extra).length}; found on this PC: ${found.length}`);
found.forEach((p) => console.log(`  ${p}`));
if (!found.length) {
  console.log('\nNo token driver file found. Find the PKCS#11 file your token\'s driver installed (ask the vendor)\nand run:  npm run diagnose -- "C:\\full\\path\\to\\driver.dll"');
  process.exit(2);
}

const p = new Pkcs11Provider(found);
p.init();
console.log('\nLoading drivers:');
p.status.forEach((s) => console.log(`  ${s.loaded ? 'OK  ' : 'FAIL'} ${s.path}${s.error ? ` — ${s.error}` : ''}`));

const tokens = p.listTokens();
console.log(`\nTokens detected: ${tokens.length}`);
if (!tokens.length) console.log('  None. Is the token plugged in? A 32-bit driver cannot be loaded by this 64-bit app.');
for (const t of tokens) {
  console.log(`\n  ${t.label || '(no label)'} — ${t.manufacturer} ${t.model} (serial ${t.serial})${t.pinLocked ? '  *** PIN LOCKED ***' : ''}`);
  try {
    const certs = p.listCertificates(t.id);
    console.log(`  Certificates: ${certs.length}`);
    certs.forEach((c) => console.log(`    - ${c.commonName}\n      issued by ${c.issuer}, valid ${c.notBefore.slice(0, 10)} to ${c.notAfter.slice(0, 10)}, serial ${c.serial}\n      ${c.usable ? 'CAN sign documents' : `cannot be used: ${c.reason}`}`));
  } catch (e) { console.log(`  Could not read certificates: ${e.message}`); }
}
p.close();
console.log(`\n${tokens.length ? 'Detection works. Next: try a signing from the agent window.' : 'No token detected — fix the points above first.'}`);
