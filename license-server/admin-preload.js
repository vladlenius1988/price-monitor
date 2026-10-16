const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('priceMonitorOwner', {
  selectInstaller: () => ipcRenderer.invoke('server:select-installer'),
  environment: () => ipcRenderer.invoke('owner:environment'),
  apiRequest: (request) => ipcRenderer.invoke('owner:api-request', request),
});
