const { contextBridge, ipcRenderer } = require('electron');

// The setup screen is the only page that needs anything from the main process.
// The board itself (/lab-tv) is an ordinary public web page and gets nothing —
// it holds no credentials and needs no privileged bridge.
contextBridge.exposeInMainWorld('kiosk', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  fetchBranches: () => ipcRenderer.invoke('fetch-branches'),
  // The board uses this to print without a dialog; in a plain browser it is
  // absent and the page falls back to window.print().
  printPdf: (base64) => ipcRenderer.invoke('print-pdf', base64),
  listPrinters: () => ipcRenderer.invoke('list-printers'),
});
