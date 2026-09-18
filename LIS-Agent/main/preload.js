const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Proxies a backend call through the main process, which reaches the API as
  // a plain Node client — no Origin header, so none of the browser CORS rules
  // that block a file:// renderer apply. See the 'api-request' handler.
  apiRequest: (options) => ipcRenderer.invoke('api-request', options),
  getDeviceKeyStatus: () => ipcRenderer.invoke('get-device-key-status'),
  activateDeviceKey: (key) => ipcRenderer.invoke('activate-device-key', key),
  deactivateDeviceKey: () => ipcRenderer.invoke('deactivate-device-key'),
  onActivationRequired: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('activation-required', listener);
    return () => ipcRenderer.removeListener('activation-required', listener);
  },
  // Today's Test Results / Unmapped Test / network status — see main.js and
  // resultQueue.js/networkMonitor.js.
  getTodayResults: () => ipcRenderer.invoke('get-today-results'),
  getUnmappedResults: () => ipcRenderer.invoke('get-unmapped-results'),
  retryResult: (id) => ipcRenderer.invoke('retry-result', id),
  retryAllResults: () => ipcRenderer.invoke('retry-all-results'),
  mapUnmappedResult: (id, sampleId) => ipcRenderer.invoke('map-unmapped-result', { id, sampleId }),
  getNetworkStatus: () => ipcRenderer.invoke('get-network-status'),
  onNetworkStatus: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('network-status', listener);
    return () => ipcRenderer.removeListener('network-status', listener);
  },
  onLocalResultsUpdated: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('local-results-updated', listener);
    return () => ipcRenderer.removeListener('local-results-updated', listener);
  },
  listPorts: () => ipcRenderer.invoke('list-ports'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getConfig: () => ipcRenderer.invoke('get-config'),
  deleteConfig: (id) => ipcRenderer.invoke('delete-config', id),
  saveSetting: (key, value) => ipcRenderer.invoke('save-setting', key, value),
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),
  startListening: (testInfo) => ipcRenderer.invoke('start-listening', testInfo),
  stopListening: () => ipcRenderer.invoke('stop-listening'),
  getActivePorts: () => ipcRenderer.invoke('get-active-ports'),
  getLocalIp: () => ipcRenderer.invoke('get-local-ip'),
  getMasterSheet: () => ipcRenderer.invoke('get-master-sheet'),
  onTestCompleted: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('test-completed', listener);
    return () => ipcRenderer.removeListener('test-completed', listener);
  },
  onDeviceStatus: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('device-status', listener);
    return () => ipcRenderer.removeListener('device-status', listener);
  },
  onPanelComplete: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('panel-complete', listener);
    return () => ipcRenderer.removeListener('panel-complete', listener);
  }
});