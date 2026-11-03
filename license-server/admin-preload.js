const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('priceMonitorOwner', {
  selectInstaller: () => ipcRenderer.invoke('server:select-installer'),
  environment: () => ipcRenderer.invoke('owner:environment'),
  apiRequest: (request) => ipcRenderer.invoke('owner:api-request', request),
  publishRelease: (request) => ipcRenderer.invoke('owner:publish-release', request),
  onReleaseProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('owner:release-progress', listener);
    return () => ipcRenderer.removeListener('owner:release-progress', listener);
  },
  copyText: (value) => ipcRenderer.invoke('owner:copy-text', String(value || '')),
});
