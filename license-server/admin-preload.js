const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('priceMonitorOwner', {
  selectInstaller: () => ipcRenderer.invoke('server:select-installer'),
});
