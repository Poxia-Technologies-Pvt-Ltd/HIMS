const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require("electron");
const path = require("path");
const os = require("os");
const { SerialPort } = require('serialport');
const axios = require('./apiClient');
const deviceKeyStore = require('./deviceKeyStore');
const resultQueue = require('./resultQueue');
const networkMonitor = require('./networkMonitor');
const offlineSync = require('./offlineSync');
const db = require(path.join(__dirname, "../db/sqlite.js"));
const serialManager = require("./serialManager");
const tcpManager = require("./tcpManager");
const { initAutoUpdate } = require("./updater");

let win;
let tray = null;



function createWindow() {
  console.log("Creating window...");

  win = new BrowserWindow({
    width: 1000,
    height: 700,
    // Square build/icon.png (see build/ — generated from the Meril
    // wordmark), not the banner-shaped renderer asset: a non-square image
    // here is what was rendering as the generic Electron icon in the
    // taskbar/window, since Windows can't square a wide banner sensibly.
    icon: path.join(__dirname, "../build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  console.log("Loading React app...");

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  } else {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools(); // 🔥 important for debugging
  }

  // Hide to tray instead of closing
  win.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "../build/icon.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Karnataka LIMS',
      click: () => {
        if (win) {
          win.show();
          win.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: '🔴 Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Karnataka LIMS — Listening for analyzers...');
  tray.setContextMenu(contextMenu);

  // Double-click tray icon to restore window
  tray.on('double-click', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });
}

async function syncMachines() {
  try {
    const labId = await db.getSetting('labId');
    if (!labId) {
      console.log("No labId found in settings. Skipping machine sync.");
      return;
    }

    console.log(`🔄 Syncing machines from backend for Lab ID: ${labId}...`);
    const response = await axios.get(`/api/lab/machines/${labId}`);

    if (response.data.success && response.data.machines) {
      const machines = response.data.machines;
      console.log(`✅ Found ${machines.length} machines on backend.`);

      for (const m of machines) {
        // Map backend machine to local analyzer_config format
        const config = {
          uniqueId: m.machine_id,
          name: m.name,
          model: m.model,
          port: m.port_ip || 'COM1',
          baud: m.baud_rate || 9600,
          labId: m.lab_id,
          labName: m.lab_name || 'Lab',
          manufacturer: m.manufacturer,
          portType: m.interface_type || 'USB',
          serialNumber: m.serial_number || '',
          synced: true, // came straight from the backend, so it's confirmed present there
        };

        // Get existing local config to preserve the COM port if it was set manually
        const existing = await db.getConfig();
        const localMatch = existing.find(lc => lc.unique_id === config.uniqueId);
        if (localMatch) {
          config.port = localMatch.port;
          config.baud = localMatch.baud;
        }

        await db.saveConfig(config);
      }
      console.log("🚀 Local machine database synchronized.");
    }
  } catch (err) {
    // err.message alone is usually empty for an axios HTTP failure, which made
    // this print a bare "Machine sync failed:" with no cause — useless when
    // diagnosing a site remotely. The status and response body are what
    // actually identify the problem (401 vs 404 vs backend 500).
    const status = err.response?.status;
    const body = err.response?.data;
    console.error(
      "❌ Machine sync failed:",
      err.message || err.code || "unknown error",
      status ? `| HTTP ${status}` : "",
      body ? `| body: ${JSON.stringify(body).slice(0, 300)}` : ""
    );
  }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.whenReady().then(() => {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Already Running',
      message: 'The LIS Agent is already running. This instance will be closed.',
      buttons: ['OK']
    });
    app.quit();
  });
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    console.log("Electron ready");

  // IPC Handlers for SQLite (Analyzer Config)
  ipcMain.handle('get-config', async () => {
    try {
      return await db.getConfig();
    } catch (e) {
      console.error("IPC get-config error:", e);
      return null;
    }
  });

  ipcMain.handle('save-config', async (event, config) => {
    try {
      const saved = await db.saveConfig(config);

      // Open a listener for the analyzer that was just saved. Without this,
      // listeners only ever started at boot (see the initializeAll* calls in
      // whenReady below), so a newly-added machine stayed silently dead until
      // someone restarted the app — in the field that looks like broken
      // hardware, not missing software state. Both initializers skip ports
      // they already hold, so re-running them is safe and only picks up what
      // is genuinely new.
      try {
        await serialManager.initializeAllPorts(win);
        await tcpManager.initializeAllServers(win);
      } catch (listenErr) {
        // A listener that fails to bind must not fail the save — the config is
        // already persisted, and the boot path will retry it.
        console.error("Listener startup after save-config failed:", listenErr.message);
      }

      return saved;
    } catch (e) {
      console.error("IPC save-config error:", e);
      return null;
    }
  });

  ipcMain.handle('delete-config', async (event, id) => {
    try {
      return await db.deleteConfig(id);
    } catch (e) {
      console.error("IPC delete-config error:", e);
      return false;
    }
  });

  ipcMain.handle('save-setting', async (event, key, value) => {
    try {
      return await db.saveSetting(key, value);
    } catch (e) {
      console.error("IPC save-setting error:", e);
      return false;
    }
  });

  ipcMain.handle('get-setting', async (event, key) => {
    try {
      return await db.getSetting(key);
    } catch (e) {
      console.error("IPC get-setting error:", e);
      return null;
    }
  });

  ipcMain.handle('list-ports', async () => {
    try {
      console.log("Listing serial ports...");
      const ports = await SerialPort.list();
      return ports;
    } catch (err) {
      console.error('Error listing ports:', err);
      return [];
    }
  });

  ipcMain.handle('start-listening', async (event, testInfo) => {
    // If the user clicked "Run Test" from the Lab Worklist UI, 
    // it sends testInfo which we use to lock the machine to that sample ID.
    if (testInfo && testInfo.machineId) {
      serialManager.setManualContext(testInfo);
      if (tcpManager.setManualContext) tcpManager.setManualContext(testInfo);
    }
    await tcpManager.initializeAllServers(win);
    return await serialManager.initializeAllPorts(win);
  });

  ipcMain.handle('stop-listening', async () => {
    await tcpManager.stopListening();
    return await serialManager.stopListening();
  });

  ipcMain.handle('get-active-ports', async () => {
    const serialPorts = Array.from(serialManager.activePorts.keys());
    const tcpPorts = Array.from(tcpManager.activeClients.keys());
    return [...serialPorts, ...tcpPorts];
  });

  // Master Sheet: read-only reference of "code -> parameter name" per machine,
  // so lab staff know which numbers to program into a physical analyzer.
  ipcMain.handle('get-master-sheet', async () => {
    const objectMapToRows = (map) =>
      Object.entries(map || {}).map(([code, name]) => ({ code, name }));

    const sheet = {};

    // Meril hematology machines — do not change these mappings.
    const merilMaps = {
      'ALTA Hematology': tcpManager.parameter_map,
      'CelQuant Edge': serialManager.CODE_MAP,
    };
    for (const [label, map] of Object.entries(merilMaps)) {
      try {
        sheet[label] = objectMapToRows(map);
      } catch (err) {
        console.warn(`⚠️  Could not read master sheet map for ${label}:`, err.message);
        sheet[label] = [];
      }
    }

    // Universal numbering standard for non-Meril, numeric-code biochemistry
    // machines — any new machine of this kind should be configured to send
    // these exact numbers, rather than getting its own one-off mapping.
    try {
      sheet['Universal Standard (Biochemistry Machines, e.g. ADX-AUTOCHEM-200)'] =
        objectMapToRows(tcpManager.adx_parameter_map);
    } catch (err) {
      console.warn('⚠️  Could not read universal biochemistry master sheet map:', err.message);
      sheet['Universal Standard (Biochemistry Machines, e.g. ADX-AUTOCHEM-200)'] = [];
    }

    // Machines whose numeric codes live in the backend's protocol JSON files,
    // rather than hardcoded here — fetch and normalize those too.
    const backendModels = [
      { label: 'Cliniquant Micro', model: 'cliniquant micro' },
      { label: 'CelQuant 5plus', model: 'celquant 5plus' },
    ];

    for (const { label, model } of backendModels) {
      try {
        const res = await axios.get(`/api/lab/machine-protocol/${encodeURIComponent(model)}`, { timeout: 5000 });
        const protocol = res.data?.protocol;
        const tests = protocol?.tests || protocol?.frame_structure?.['2']?.tests || [];
        sheet[label] = tests.map((t) => ({ code: String(t.id), name: t.name }));
      } catch (err) {
        console.warn(`⚠️  Could not fetch master sheet protocol for ${label}:`, err.message);
        sheet[label] = [];
      }
    }

    return sheet;
  });

  // ── API bridge ─────────────────────────────────────────────────────────────
  // Every backend call from the renderer is proxied through here instead of
  // going out from the page directly.
  //
  // Why: a packaged Electron app loads from file://, so its fetch/XHR carry
  // `Origin: null`, and the backend rejects that — both in cors() and again in
  // the Referer/Origin guard, where `new URL("null")` fails to parse. Allowing
  // `null` server-side would mean trusting an origin that sandboxed iframes on
  // any website also send, on a system holding patient data.
  //
  // Requests issued from this process are plain Node HTTP: no Origin header at
  // all, so CORS never applies. apiClient attaches the session as a Bearer
  // token (read from the HttpOnly cookie via Electron's privileged session
  // API), and authenticateToken skips CSRF for Bearer-authenticated calls
  // because they aren't forgeable cross-site — so no token juggling is needed
  // on this path either.
  ipcMain.handle('api-request', async (event, { method = 'GET', url, data, headers = {}, params } = {}) => {
    try {
      const res = await axios.request({
        method, url, data, params,
        headers,
        // Resolve for any status so the renderer sees real 4xx bodies (login
        // failures carry a fresh captcha in the body) instead of a thrown
        // "Request failed with status code 400" with nothing attached.
        validateStatus: () => true,
      });

      // Login is the one call whose *response* matters beyond its body: the
      // session arrives as a Set-Cookie that this process must persist into
      // the Electron session, or apiClient has nothing to read on the next
      // request and every subsequent call is unauthenticated.
      const setCookie = res.headers?.['set-cookie'];
      if (setCookie?.length) {
        const { session } = require('electron');
        const { API_BASE } = require('./apiBase');
        for (const raw of setCookie) {
          const [pair] = raw.split(';');
          const idx = pair.indexOf('=');
          if (idx === -1) continue;
          const name = pair.slice(0, idx).trim();
          const value = pair.slice(idx + 1).trim();
          try {
            await session.defaultSession.cookies.set({
              url: API_BASE, name, value,
              httpOnly: /httponly/i.test(raw),
              secure: /secure/i.test(raw),
            });
          } catch (err) {
            console.error(`Could not persist cookie "${name}":`, err.message);
          }
        }

        // A session just arrived, which means this is a login. Analyzer
        // listeners were started at boot — before anyone had logged in — so
        // their protocol fetch (/api/lab/machine-protocol, an authenticated
        // route) failed 401 and those ports were left closed. Nothing retried
        // them afterwards, so on a freshly-booted workstation the analyzers
        // stayed silently dead until someone happened to edit a machine.
        // Re-running now is the moment that first becomes possible; both
        // initializers skip ports they already hold, so this is a no-op when
        // the listeners are already up.
        if (setCookie.some((c) => /^hims_token=/.test(c))) {
          try {
            console.log('🔑 Session established — syncing machines and retrying listeners...');
            // syncMachines hits an authenticated route too, so it failed at
            // boot for the same reason; without this the workstation also has
            // no machine list until the next restart.
            await syncMachines();
            await serialManager.initializeAllPorts(win);
            await tcpManager.initializeAllServers(win);
          } catch (reinitErr) {
            console.error('Listener retry after login failed:', reinitErr.message);
          }
        }
      }

      return { ok: res.status >= 200 && res.status < 300, status: res.status, data: res.data, headers: res.headers };
    } catch (err) {
      // Transport-level failure (DNS, TLS, timeout) — there is no HTTP status.
      console.error('api-request failed:', method, url, err.message);
      return {
        ok: false, status: 0,
        data: { message: err.message || 'Network request failed' },
        headers: {},
      };
    }
  });

  // Device-key activation — replaces the old email/password login entirely.
  // No form, no session: the technician pastes the key an Admin generated
  // for this machine once, and it's stored (encrypted, see deviceKeyStore)
  // for good until an Admin revokes it.
  ipcMain.handle('get-device-key-status', () => ({ activated: axios.hasDeviceKey() }));

  ipcMain.handle('activate-device-key', async (event, key) => {
    const trimmed = String(key || '').trim();
    if (!trimmed) return { ok: false, message: 'Enter the device key given to you by your admin.' };

    try {
      const res = await axios.post('/api/dev-keys/verify', { key: trimmed }, { validateStatus: () => true });
      if (!res.data?.success) {
        return { ok: false, message: res.data?.message || 'Invalid or revoked device key.' };
      }

      deviceKeyStore.setDeviceKey(trimmed);

      // Mirrors what a successful login used to trigger: analyzer listeners
      // were started at boot before any credential existed, so their
      // authenticated protocol fetch 401'd and those ports stayed closed.
      // This is the first moment a retry can succeed.
      try {
        console.log('🔑 Device key activated — syncing machines and retrying listeners...');
        await syncMachines();
        await serialManager.initializeAllPorts(win);
        await tcpManager.initializeAllServers(win);
      } catch (reinitErr) {
        console.error('Listener retry after activation failed:', reinitErr.message);
      }

      return { ok: true, label: res.data.label, branch_id: res.data.branch_id, role: res.data.role };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error while activating.' };
    }
  });

  // Lets a technician re-activate on a different key (machine reassigned,
  // or the current key was revoked) without reinstalling the app.
  ipcMain.handle('deactivate-device-key', () => {
    deviceKeyStore.clearDeviceKey();
    return { ok: true };
  });

  // ── Today's Test Results / Unmapped Test / network status ──────────────
  // All three read/write the same local_results SQLite table (db/sqlite.js)
  // that serialManager.js/tcpManager.js now write to via resultQueue.js
  // before anything touches the network — see those files' syncSession.
  ipcMain.handle('get-today-results', () => db.listTodayResults());
  ipcMain.handle('get-unmapped-results', () => db.listUnmappedResults());
  ipcMain.handle('retry-result', (event, id) => resultQueue.pushOne(id));
  ipcMain.handle('retry-all-results', () => resultQueue.retryAll());
  ipcMain.handle('get-network-status', () => ({ online: networkMonitor.isOnline() }));

  // Offline registration and sample collection (tender #59) — see offlineSync.js.
  ipcMain.handle('offline-get-state', () => offlineSync.getState());
  ipcMain.handle('offline-sync-now', () => offlineSync.syncAll({ force: true }));
  ipcMain.handle('offline-field-config', () => offlineSync.getFieldConfig());
  ipcMain.handle('offline-register-patient', (event, form) => offlineSync.registerPatient(form));
  ipcMain.handle('offline-list-registrations', () => offlineSync.listRegistrations());
  ipcMain.handle('offline-resolve-registration', (event, { id, ...rest }) => offlineSync.resolveRegistration(id, rest));
  ipcMain.handle('offline-list-orders', (event, opts) => offlineSync.listOrders(opts));
  ipcMain.handle('offline-get-order', (event, billId) => offlineSync.getOrder(billId));
  ipcMain.handle('offline-collect-order', (event, billId) => offlineSync.collectOrder(billId));
  ipcMain.handle('offline-refresh-orders', () => offlineSync.refreshSnapshot());
  ipcMain.handle('offline-list-collections', () => offlineSync.listCollections());
  ipcMain.handle('offline-resolve-collection', (event, { id, ...rest }) => offlineSync.resolveCollection(id, rest));
  ipcMain.handle('map-unmapped-result', async (event, { id, sampleId }) => {
    if (!sampleId || !String(sampleId).trim()) {
      return { ok: false, message: 'Enter the sample ID to map this result to.' };
    }
    await db.mapLocalResult(id, String(sampleId).trim());
    return resultQueue.pushOne(id);
  });

  ipcMain.handle('get-local-ip', async () => {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip over internal (i.e. 127.0.0.1) and non-IPv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  });

  // A 401 anywhere means the stored device key is missing or was revoked.
  // Show the activation screen — never stop listening. The analyzers keep
  // their ports open and keep parsing; only the window changes, because a
  // technician who reopens the app should see somewhere to re-activate
  // rather than a raw "401" from a protocol fetch.
  axios.setUnauthorizedHandler(() => {
    if (win && !win.isDestroyed()) win.webContents.send('activation-required');
  });

  // Boot order matters here. syncMachines and the protocol fetch are
  // authenticated calls, and firing them before checking for a device key is
  // what produced a screenful of 401s every time the app was reopened.
  (async () => {
    const activated = axios.hasDeviceKey();

    if (!activated) {
      console.log('ℹ️  No device key activated — showing activation screen. Analyzer listeners still start.');
      if (win && !win.isDestroyed()) win.webContents.send('activation-required');
    } else {
      await syncMachines();
    }

    // Either way the machines come up: a lab whose session has lapsed must
    // not also stop collecting results. Anything they produce is pushed once
    // somebody signs in.
    serialManager.initializeAllPorts(win);
    tcpManager.initializeAllServers(win);
  })();

  // The agent is meant to listen 24x7 (see window-all-closed below, which
  // keeps it alive in the tray). That only holds until the machine reboots —
  // after a power cut someone had to relaunch it by hand on every workstation
  // or analyzers silently stopped reporting. Register it as a login item so
  // it comes back on its own. Only set in packaged builds: doing this in dev
  // would register the developer's electron binary to launch at login.
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({
        openAtLogin: true,
        // Come back straight to the tray rather than popping a window in the
        // user's face on every login.
        openAsHidden: true,
        args: ['--hidden'],
      });
    } catch (e) {
      console.error('Could not register app to launch at login:', e.message);
    }
  }

  createWindow();
  createTray();

  // Remote update. Passed a getter rather than `win` itself because the
  // window is recreated on tray restore, and the updater may fire hours later
  // — a captured reference would be stale or destroyed by then.
  initAutoUpdate(() => win);

  // Same getter pattern — see the comment on initAutoUpdate above. The
  // network monitor polls the backend's health route every 15s (see
  // networkMonitor.js) and automatically sweeps the local retry queue the
  // moment connectivity returns, so nobody has to remember to click Retry
  // after a blip.
  resultQueue.setWindow(() => win);
  offlineSync.setWindow(() => win);
  networkMonitor.start(() => win, () => {
    resultQueue.retryAll();
    // Back online: replay what was registered / collected while it was down.
    offlineSync.syncAll({ force: true });
  });
  offlineSync.start(() => win);
});

  // Prevent app from quitting when all windows are closed — keep alive in tray
  app.on("window-all-closed", () => {
    // Do NOT quit — stay alive in system tray for 24x7 listening
    console.log("Window hidden. Listeners still running in background.");
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
  });
}