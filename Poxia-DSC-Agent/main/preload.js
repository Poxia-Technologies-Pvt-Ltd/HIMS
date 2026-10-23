const { contextBridge, ipcRenderer } = require('electron');

// The window can only do these few things; it never touches the token itself.
contextBridge.exposeInMainWorld('dsc', {
  getState: () => ipcRenderer.invoke('state:get'),
  refreshTokens: () => ipcRenderer.invoke('tokens:refresh'),
  listCertificates: (tokenId) => ipcRenderer.invoke('certs:list', tokenId),
  submit: (payload) => ipcRenderer.invoke('job:submit', payload),
  cancel: () => ipcRenderer.invoke('job:cancel'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  recentAudit: () => ipcRenderer.invoke('audit:recent'),
  onState: (callback) => {
    const listener = (_e, state) => callback(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
});
