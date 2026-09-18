// Remote update for the LIS Agent.
//
// Lab machines are scattered across the state and nobody is going to visit 570
// facilities to reinstall an .exe. electron-updater polls a static feed
// (latest.yml on jh-lims.poxiatechnologies.com/download/, the same path the
// manual installer is served from), downloads a newer build in the background
// and installs it on quit.
//
// Design decisions worth knowing:
//
//  * Install happens on QUIT, never mid-shift. The agent is listening to
//    analyzers; restarting it underneath a running sample would lose results.
//    `autoInstallOnAppQuit` defers to the next time the operator actually
//    exits, and the update is already downloaded by then so the restart is
//    quick.
//  * The check is silent on failure. A site with no internet, or a DNS
//    hiccup, must not produce an error dialog on a machine nobody is sitting
//    at — it just logs and tries again on the next interval.
//  * Nothing is prompted before downloading. Bandwidth at a CHC is limited
//    but a ~106MB download once per release is far cheaper than sending
//    somebody to site.
const { app, dialog } = require('electron');

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function initAutoUpdate(getWindow) {
  // Only meaningful in a packaged build: in dev there is no update feed to
  // compare against and electron-updater throws on a missing app-update.yml.
  if (!app.isPackaged) {
    console.log('[updater] skipped — not a packaged build');
    return;
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('[updater] electron-updater unavailable:', err.message);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Unsigned builds: without this, electron-updater refuses to apply an
  // update on Windows. Remove once a code-signing certificate is in place —
  // signature verification is what stops a hijacked feed serving a malicious
  // installer, so this is a real (accepted, for now) weakening.
  autoUpdater.allowDowngrade = false;

  const notify = (title, message) => {
    const win = typeof getWindow === 'function' ? getWindow() : null;
    if (win && !win.isDestroyed()) {
      dialog.showMessageBox(win, { type: 'info', title, message, buttons: ['OK'] })
        .catch(() => {});
    }
  };

  autoUpdater.on('checking-for-update', () => console.log('[updater] checking…'));
  autoUpdater.on('update-not-available', (info) =>
    console.log(`[updater] up to date (${info?.version ?? app.getVersion()})`));
  autoUpdater.on('update-available', (info) =>
    console.log(`[updater] ${info.version} available — downloading in background`));
  autoUpdater.on('download-progress', (p) =>
    console.log(`[updater] ${Math.round(p.percent)}% (${Math.round(p.bytesPerSecond / 1024)} KB/s)`));
  autoUpdater.on('error', (err) =>
    // Never surfaced to the user: an unattended bench machine with no network
    // would otherwise sit behind a modal error box.
    console.error('[updater] check failed:', err?.message || err));

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] ${info.version} downloaded — installs when the app is next closed`);
    notify(
      'Update ready',
      `Version ${info.version} has been downloaded and will be installed the next time you close the agent.\n\n` +
      `Analyzer listening continues as normal until then.`
    );
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => { /* logged above */ });

  // Not immediately on boot: at a site where every PC powers on at 9am, that
  // is a stampede of 106MB downloads through one connection.
  setTimeout(check, 2 * 60 * 1000);
  setInterval(check, SIX_HOURS_MS);
}

module.exports = { initAutoUpdate };
