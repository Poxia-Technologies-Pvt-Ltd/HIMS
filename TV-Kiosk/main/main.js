// Lobby display for Karnataka LIMS.
//
// A kiosk shell around the LIMS' own /lab-tv page rather than a second copy of
// that screen. The queue display already exists in the web app, is already in
// production and is already maintained alongside everything else — shipping a
// separate bundled renderer here would mean two versions of the same board
// drifting apart, and the older one is the one nobody notices is wrong.
//
// So this process does three things and nothing else:
//   * remembers which hospital this TV belongs to (asked once, on first run);
//   * shows /lab-tv?branch_id=… fullscreen with the machine locked down;
//   * keeps it on screen — through crashes, network loss and stray keypresses.
//
// It never signs in. /lab-tv is a public, unauthenticated page precisely so a
// waiting-room TV holds no credentials and has no session that can expire. If
// the page is ever navigated away from, this brings it straight back.

const { app, BrowserWindow, session, Menu, ipcMain, net } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Override for testing against a local stack, e.g. KIOSK_API_BASE=http://localhost:5714
const API_BASE = process.env.KIOSK_API_BASE || 'https://ka-lims.poxiatechnologies.com';
const CONFIG_PATH = path.join(app.getPath('userData'), 'kiosk-config.json');

// How long to wait before retrying after a failed load. The TV is unattended,
// often on a rural link, and must recover on its own.
const RETRY_MS = 15_000;

// ─── Config ──────────────────────────────────────────────────────────────────
function readConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return cfg && cfg.branchId ? cfg : null;
  } catch {
    return null;
  }
}

function writeConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

const tvUrl = (cfg) =>
  `${API_BASE}/lab-tv?branch_id=${encodeURIComponent(cfg.branchId)}`;

// ─── Single instance ─────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) app.quit();

let win;
let retryTimer = null;
let escCount = 0;
let escReset = null;

app.whenReady().then(() => {
  // The report collection screen scans a QR code from the webcam. Electron
  // denies getUserMedia by default, and a lobby machine has nobody to click
  // an allow prompt — so camera access is granted for our own origin only,
  // and everything else stays denied.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    const url = wc.getURL() || '';
    const ours = url.startsWith(API_BASE) || url.startsWith('file://');
    callback(ours && (permission === 'media' || permission === 'clipboard-read'));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) =>
    (origin === API_BASE || origin === 'file://') && permission === 'media');

  registerIPC();
  createWindow();

  // The TV should come back by itself after a power cut — nobody is going to
  // walk over and start it.
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
  }
});

function createWindow() {
  win = new BrowserWindow({
    fullscreen: true,
    frame: false,
    backgroundColor: '#0f172a',
    icon: path.join(__dirname, '../build/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(null);
  load();

  win.webContents.on('did-finish-load', hardenPage);

  // ── Recover from anything ────────────────────────────────────────────────
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 is an aborted navigation
    console.error(`load failed (${code} ${desc}) — retrying in ${RETRY_MS / 1000}s`);
    showMessage('Reconnecting to LIMS…', desc);
    scheduleRetry();
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('renderer gone:', details.reason);
    scheduleRetry(3000);
  });
  win.on('unresponsive', () => scheduleRetry(5000));

  // ── Never leave the board ────────────────────────────────────────────────
  // /lab-tv is public, so there is no session to lose — but a stray link or a
  // redirect must not strand the TV on some other page with nobody there to
  // notice. Anything that isn't the board sends it back to the board.
  win.webContents.on('did-navigate', (_e, url) => {
    const cfg = readConfig();
    if (!cfg || url.startsWith('file://')) return;
    if (!url.includes('/lab-tv')) {
      console.warn(`navigated away to ${url} — returning to the board`);
      win.loadURL(tvUrl(cfg));
    }
  });
  // External links open nowhere: this machine has no browser chrome and no
  // keyboard for a visitor to escape with.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.webContents.on('context-menu', (e) => e.preventDefault());
  win.on('leave-full-screen', () => { if (app.isPackaged) win.setFullScreen(true); });
  win.webContents.on('before-input-event', onKey);
}

function load() {
  clearTimeout(retryTimer);
  const cfg = readConfig();
  if (!cfg) {
    // First run: ask which hospital this TV belongs to. Asked once, then never
    // again — the answer lives in userData and survives updates.
    win.loadFile(path.join(__dirname, 'setup.html'));
    return;
  }
  win.loadURL(tvUrl(cfg));
}

function scheduleRetry(delay = RETRY_MS) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { if (win && !win.isDestroyed()) load(); }, delay);
}

/** A readable holding screen instead of Chromium's error page. */
function showMessage(title, detail) {
  const html = `<!doctype html><meta charset="utf-8">
    <body style="margin:0;height:100vh;display:grid;place-items:center;background:#0f172a;
                 color:#e2e8f0;font:16px -apple-system,Segoe UI,Roboto,sans-serif;text-align:center">
      <div>
        <div style="font-size:26px;font-weight:700;margin-bottom:10px">${title}</div>
        <div style="opacity:.7;font-size:14px">${detail || ''}</div>
        <div style="opacity:.5;font-size:12px;margin-top:22px">This screen recovers on its own.</div>
      </div>
    </body>`;
  win?.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

/** Zoom lock, no text selection, no pinch/multi-touch gestures. */
function hardenPage() {
  if (!win || win.isDestroyed()) return;

  // Push the board inside the area the TV actually shows.
  //
  // Injected as a direct rule with !important rather than by redefining the
  // page's CSS variables: an injected :root block and the page's own :root
  // block have identical specificity, so which one wins depends on stylesheet
  // order — and that made the calibration silently do nothing. This cannot
  // lose, whatever order the page's stylesheet arrives in.
  const { inset } = readConfig() || {};
  if (inset && (inset.top || inset.right || inset.bottom || inset.left)) {
    const top = Number(inset.top) || 0;
    const right = Number(inset.right) || 0;
    const bottom = Number(inset.bottom) || 0;
    const left = Number(inset.left) || 0;

    win.webContents.insertCSS(`
      html, body { background: #000 !important; }
      .tv-root {
        position: fixed !important;
        top: ${top}vh !important;
        right: ${right}vw !important;
        bottom: ${bottom}vh !important;
        left: ${left}vw !important;
        width: auto !important;
        height: auto !important;
      }
    `).catch(() => { /* page navigated */ });
  }

  win.webContents.setZoomFactor(1);
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.insertCSS(`
    * { touch-action: manipulation !important; user-select: none !important;
        -webkit-user-select: none !important; -webkit-tap-highlight-color: transparent !important; }
    input, textarea, select, [contenteditable] {
      touch-action: auto !important; user-select: text !important; -webkit-user-select: text !important; }
  `);
  win.webContents.executeJavaScript(`
    for (const ev of ['touchstart', 'touchmove']) {
      document.addEventListener(ev, (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    }
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    }
  `).catch(() => { /* page may have navigated already */ });
}

/**
 * Keyboard lockdown. Escape five times within four seconds quits — the only
 * way out, so a technician can service the machine without a keyboard shortcut
 * a visitor might hit by accident.
 */
function onKey(event, input) {
  if (input.type !== 'keyDown') return;

  if (input.key === 'Escape') {
    escCount++;
    clearTimeout(escReset);
    escReset = setTimeout(() => { escCount = 0; }, 4000);
    if (escCount >= 5) { app.isQuitting = true; app.quit(); return; }
    if (app.isPackaged) event.preventDefault();
    return;
  }

  // Ctrl+T opens settings — hospital and screen calibration — on a running
  // kiosk, so a display can be adjusted without uninstalling. Ctrl+Alt+S does
  // the same, kept because it is harder to hit by accident.
  //
  // Ctrl+T is normally "new tab"; the lockdown below swallows it either way,
  // so claiming it here costs nothing and it is the combination an operator
  // will actually remember.
  //
  // Command on macOS, Control on Windows — the kiosk ships to Windows but is
  // developed and demonstrated on a Mac, and a shortcut that only works on one
  // of them is a shortcut nobody trusts.
  const key = input.key?.toLowerCase();
  const cmd = input.control || input.meta;
  if (cmd && (key === 't' || (key === 's' && input.alt))) {
    event.preventDefault();
    win.loadFile(path.join(__dirname, 'setup.html'));
    return;
  }

  if (!app.isPackaged) return; // dev needs devtools and reload

  const blocked =
    input.key === 'F5' ||
    input.key === 'F12' ||
    (input.key === 'r' && input.control) ||
    (input.key === 'w' && input.control) ||
    (input.key === 'i' && input.control && input.shift) ||
    (input.key === 'F4' && input.alt);
  if (blocked) event.preventDefault();
}

// ─── IPC (setup screen only) ─────────────────────────────────────────────────
function registerIPC() {
  ipcMain.handle('get-config', () => readConfig());

  // The setup screen lets the operator choose which printer reports come out
  // of. Guessing was wrong: a lobby PC may have several queues, and the one
  // Windows calls "default" is often a PDF writer nobody can collect from.
  ipcMain.handle('list-printers', async () => {
    try {
      const list = await win.webContents.getPrintersAsync();
      return list.map((p) => ({
        name: p.name,
        display: p.displayName || p.name,
        isDefault: !!p.isDefault,
        virtual: /pdf|xps|onenote|fax|virtual|preview|save as/i
          .test(`${p.name} ${p.displayName || ''} ${p.description || ''}`),
      }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('save-config', (_e, cfg) => {
    if (!cfg?.branchId) return { success: false, message: 'Choose a hospital first' };
    writeConfig({
      branchId: cfg.branchId,
      branchName: cfg.branchName || '',
      // Percentages cropped off each edge by the TV's overscan, measured by
      // the operator during setup.
      inset: cfg.inset || { top: 0, right: 0, bottom: 0, left: 0 },
      // Empty string means "printing is turned off at this kiosk", which is a
      // legitimate choice for a lobby with no printer — and is not the same as
      // "not configured yet".
      printerName: cfg.printerName ?? '',
      savedAt: new Date().toISOString(),
    });
    load();
    return { success: true };
  });

  // Fetched from the main process: /api/branches is public, and going through
  // Node avoids the page's CORS rules entirely.
  ipcMain.handle('fetch-branches', () => new Promise((resolve) => {
    const request = net.request(`${API_BASE}/api/branches`);
    let body = '';
    const fail = (message) => resolve({ success: false, branches: [], message });

    request.on('response', (res) => {
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data?.success ? data : { success: false, branches: [], message: 'Unexpected response' });
        } catch {
          fail('Could not read the hospital list');
        }
      });
    });
    request.on('error', (err) => fail(err.message));
    setTimeout(() => fail('Timed out reaching the LIMS'), 10_000);
    request.end();
  }));
}

/**
 * Prints a PDF the page fetched, without a dialog.
 *
 * A frameless lobby screen has no window chrome, so a print dialog would leave
 * a patient facing a control they cannot dismiss. The PDF is written to a temp
 * file, loaded into an offscreen window and printed to the default printer,
 * then cleaned up either way.
 */
ipcMain.handle('print-pdf', async (_e, base64) => {
  if (!base64) return { success: false, message: 'Nothing to print' };
  const file = path.join(os.tmpdir(), `ka-lims-report-${Date.now()}.pdf`);
  let printer = null;

  try {
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));

    // plugins:true is what enables Chromium's PDF viewer. Without it the
    // window loads the file but renders nothing, and the job goes to the
    // printer as a blank page — which looks like a paper or driver fault
    // rather than a missing flag.
    printer = new BrowserWindow({
      show: false,
      webPreferences: { plugins: true, sandbox: false },
    });

    await printer.loadURL('file://' + file.replace(/\\/g, '/'));
    // The viewer paints a frame or two after load; printing immediately can
    // catch it empty.
    await new Promise((r) => setTimeout(r, 600));

    // Pick a REAL printer, explicitly.
    //
    // Electron's silent print falls back to "the default" and its callback
    // reports success once the OS spooler accepts the job — which it does even
    // when the queue leads nowhere. That told a patient "Printing — please
    // collect your report" on a machine with no printer attached at all, and
    // sent them to stand at a device that was never going to produce anything.
    //
    // So the job is only ever sent to a named physical device, and if there is
    // no such device the answer is an honest refusal rather than a hopeful one.
    let deviceName;
    try {
      const chosen = (readConfig() || {}).printerName;

      // Explicitly turned off in settings.
      if (chosen === '') {
        return { success: false, message: 'Printing is switched off for this kiosk (Ctrl+T to enable)' };
      }

      const list = await printer.webContents.getPrintersAsync();

      if (!list.length) {
        return { success: false, message: 'No printer is connected to this computer' };
      }

      // The operator's choice wins, but only while it still exists — a queue
      // can be removed months after setup, and silently printing somewhere
      // else would be worse than saying so.
      if (chosen) {
        const match = list.find((p) => p.name === chosen);
        if (!match) {
          return {
            success: false,
            message: `The printer chosen in settings ("${chosen}") is no longer available. Press Ctrl+T to pick another.`,
          };
        }
        deviceName = match.name;
      }

      // File writers accept everything and produce nothing a patient can hold.
      const isVirtual = (p) =>
        /pdf|xps|onenote|fax|virtual|preview|save as/i.test(`${p.name} ${p.displayName || ''} ${p.description || ''}`);
      const physical = list.filter((p) => !isVirtual(p));

      if (!deviceName && !physical.length) {
        return {
          success: false,
          message: 'Only a PDF/file printer is available — connect a real printer to print reports',
        };
      }

      if (!deviceName) deviceName = (physical.find((p) => p.isDefault) || physical[0]).name;
    } catch (err) {
      // Without the device list there is no way to know whether anything would
      // come out, and claiming success on a guess is the failure being fixed.
      return { success: false, message: `Could not read the printer list: ${err.message}` };
    }

    const result = await new Promise((resolve) => {
      printer.webContents.print(
        { silent: true, printBackground: true, ...(deviceName ? { deviceName } : {}) },
        (ok, reason) => resolve(
          ok ? { success: true, message: `Printing on ${deviceName}`, deviceName }
             : { success: false, message: reason || 'The printer refused the job' }
        )
      );
    });

    return result;
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    if (printer && !printer.isDestroyed()) {
      // Destroying the window immediately can cancel a job still spooling.
      setTimeout(() => { try { printer.destroy(); } catch { /* gone */ } }, 8000);
    }
    // The report is a patient's clinical result; it must not be left lying in
    // the temp directory of a machine anyone can walk up to.
    setTimeout(() => { try { fs.unlinkSync(file); } catch { /* already gone */ } }, 20_000);
  }
});

app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
