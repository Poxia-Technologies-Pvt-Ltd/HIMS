const fs = require('fs');
const path = require('path');

// A local record of what this agent did, one JSON object per line. It holds
// who/what/when — never a PIN, a signature or the document.
let file = null;
const MAX = 5 * 1024 * 1024;

function init(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  file = path.join(userDataDir, 'audit.log');
}

function log(event, data = {}) {
  if (!file) return;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX) fs.renameSync(file, `${file}.1`);
    fs.appendFileSync(file, `${JSON.stringify({ t: new Date().toISOString(), event, ...data })}\n`);
  } catch (e) {
    console.error('audit write failed:', e.message);
  }
}

function recent(limit = 100) {
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return { t: '', event: l }; } });
  } catch {
    return [];
  }
}

module.exports = { init, log, recent };
