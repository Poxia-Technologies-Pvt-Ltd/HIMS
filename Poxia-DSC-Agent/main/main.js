const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const config = require('./config');
const audit = require('./audit');
const pkg = require('../package.json');
const { TokenManager } = require('./tokenManager');
const { SigningService } = require('./signingService');
const { createAgentServer } = require('./agentServer');

// Poxia DSC Agent — runs on the doctor's own PC, next to the USB token. The
// LIMS web page asks it (on 127.0.0.1 only) to sign a report; the doctor
// chooses the certificate and types the PIN here; the private key never leaves
// the token and the PIN never leaves this PC.
let win = null;
let tray = null;
let agent = null;
let tokens = null;
let signing = null;
let quitting = false;
let listenError = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

const publicTokens = () => tokens.tokens.map((t) => ({
  id: t.id, label: t.label, manufacturer: t.manufacturer, model: t.model, serial: t.serial,
  pinLocked: t.pinLocked, pinFinalTry: t.pinFinalTry, pinCountLow: t.pinCountLow, unlocked: !!tokens.cached(t.id),
}));

const stateSnapshot = () => ({
  version: pkg.version, port: config.get().port, listening: !listenError, listenError,
  tokens: publicTokens(), libraries: tokens.libraryStatus, job: signing.snapshot(), config: config.get(), platform: process.platform,
});

const push = () => { if (win && !win.isDestroyed()) win.webContents.send('state', stateSnapshot()); };

function createWindow() {
  win = new BrowserWindow({
    width: 820, height: 700, minWidth: 640, minHeight: 520, show: false, title: 'Poxia DSC Agent',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

function showWindow(raise = false) {
  if (!win || win.isDestroyed()) createWindow();
  win.show();
  win.focus();
  if (raise) {
    // A signing request just arrived: bring the window in front of the browser for a moment.
    win.setAlwaysOnTop(true);
    win.moveTop();
    setTimeout(() => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(false); }, 1500);
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Poxia DSC Agent');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Poxia DSC Agent', click: () => showWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => showWindow());
}

async function startServer() {
  listenError = null;
  agent = createAgentServer({ config, tokens, signing, version: pkg.version });
  try {
    await agent.listen();
    audit.log('AGENT_STARTED', { port: config.get().port, version: pkg.version });
  } catch (e) {
    listenError = e.code === 'EADDRINUSE' ? `Port ${config.get().port} is already in use by another program.` : e.message;
    audit.log('AGENT_START_FAILED', { error: listenError });
  }
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  config.init(userData, app.isPackaged);
  audit.init(userData);
  tokens = new TokenManager({ getConfig: config.get, audit });
  tokens.init();
  signing = new SigningService({ config, tokens, audit, version: pkg.version });
  tokens.on('tokens', push);
  signing.on('job', push);
  signing.on('attention', () => showWindow(true));

  await startServer();
  createWindow();
  createTray();
  app.setLoginItemSettings({ openAtLogin: !!config.get().launchAtLogin });

  ipcMain.handle('state:get', () => stateSnapshot());
  ipcMain.handle('tokens:refresh', () => { tokens.refresh(true); return stateSnapshot(); });
  ipcMain.handle('certs:list', (_e, tokenId) => {
    try {
      return { ok: true, certificates: tokens.certificates(String(tokenId)).map((c) => ({
        id: c.id, commonName: c.commonName, issuer: c.issuer, serial: c.serial, notAfter: c.notAfter, usable: c.usable, reason: c.reason, needsPin: !!c.needsPin,
      })) };
    } catch (e) { return { ok: false, code: e.code, message: e.message }; }
  });
  // The PIN arrives here from the window, goes straight to the token and is never stored or logged.
  ipcMain.handle('job:submit', (_e, payload) => signing.submit({ tokenId: String(payload?.tokenId || ''), certId: String(payload?.certId || ''), pin: String(payload?.pin || '') }));
  ipcMain.handle('job:cancel', () => signing.cancel());
  ipcMain.handle('audit:recent', () => audit.recent(150));
  ipcMain.handle('settings:save', async (_e, patch) => {
    try {
      const before = config.get();
      const next = config.save(patch || {});
      if (JSON.stringify(before.pkcs11Libraries) !== JSON.stringify(next.pkcs11Libraries) || before.devP12Path !== next.devP12Path) tokens.reload();
      if (before.port !== next.port) { await agent.close(); await startServer(); }
      app.setLoginItemSettings({ openAtLogin: !!next.launchAtLogin });
      audit.log('SETTINGS_CHANGED', {});
      push();
      return { ok: true, state: stateSnapshot() };
    } catch (e) { return { ok: false, message: e.message }; }
  });
});

app.on('window-all-closed', () => { /* stay in the tray */ });
app.on('before-quit', () => { quitting = true; if (tokens) tokens.stop(); });
