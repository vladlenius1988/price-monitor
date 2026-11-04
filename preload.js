const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('priceParser', {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  listStores: () => ipcRenderer.invoke('stores:list'),
  getAccessStatus: () => ipcRenderer.invoke('access:status'),
  refreshAccess: () => ipcRenderer.invoke('access:refresh'),
  probeLicenseServer: () => ipcRenderer.invoke('access:probe-server'),
  activateLicense: (activationCode) => ipcRenderer.invoke('access:activate', { activationCode }),
  exportLicenseRequest: () => ipcRenderer.invoke('access:export-request'),
  importLicense: () => ipcRenderer.invoke('access:import-license'),
  beginSearchAccess: (store, brandCount) => ipcRenderer.invoke('access:begin-search', { store, brandCount }),
  finishSearchAccess: (token) => ipcRenderer.invoke('access:finish-search', { token }),
  reportSearchTelemetry: (payload) => ipcRenderer.invoke('telemetry:search', payload),
  recordDiagnosticEvent: (payload) => ipcRenderer.invoke('diagnostics:record', payload),
  exportDiagnostics: () => ipcRenderer.invoke('diagnostics:export'),
  sendDiagnostics: () => ipcRenderer.invoke('diagnostics:send'),
  checkForUpdate: () => ipcRenderer.invoke('updates:check'),
  installUpdate: (releaseId) => ipcRenderer.invoke('updates:download-install', { releaseId }),
  suggestBrands: (store, query) => ipcRenderer.invoke('brands:suggest', { store, query }),
  parseBrand: (store, query, options = {}) => ipcRenderer.invoke('products:parse', { store, query, options }),
  cancel: () => ipcRenderer.invoke('products:cancel'),
  getRecovery: () => ipcRenderer.invoke('products:recovery:get'),
  clearRecovery: () => ipcRenderer.invoke('products:recovery:clear'),
  exportExcel: (payload) => ipcRenderer.invoke('products:export', payload),
  exportCrossStoreBarcode: (payload) => ipcRenderer.invoke('products:export-cross-store-barcode', payload),
  exportMultiStoreLive: (payload) => ipcRenderer.invoke('products:export-multi-store-live', payload),
  exportSavedLists: (payload) => ipcRenderer.invoke('saved-lists:export', payload),
  importSavedLists: () => ipcRenderer.invoke('saved-lists:import'),
  getComparisonSnapshot: (key) => ipcRenderer.invoke('comparison:get', { key }),
  saveComparisonSnapshot: (snapshot) => ipcRenderer.invoke('comparison:save', snapshot),
  listComparisonSnapshots: () => ipcRenderer.invoke('comparison:list'),
  mergeComparisonSnapshots: (snapshots) => ipcRenderer.invoke('comparison:merge', snapshots),
  saveArchive: (record) => ipcRenderer.invoke('archive:save', record),
  listArchives: () => ipcRenderer.invoke('archive:list'),
  getArchive: (id) => ipcRenderer.invoke('archive:get', id),
  getAllArchives: () => ipcRenderer.invoke('archive:all'),
  mergeArchives: (records) => ipcRenderer.invoke('archive:merge', records),
  deleteArchives: (ids) => ipcRenderer.invoke('archive:delete', { ids }),
  restoreDeletedArchives: (token) => ipcRenderer.invoke('archive:restore-deleted', { token }),
  getProductPriceHistory: (store, product) => ipcRenderer.invoke('archive:product-history', { store, product }),
  compareArchives: (previousId, currentId) => ipcRenderer.invoke('archive:compare', { previousId, currentId }),
  exportProductPriceHistory: (store, product) => ipcRenderer.invoke('archive:history-export', { store, product }),
  exportCombinedArchives: (ids) => ipcRenderer.invoke('archive:combined-export', { ids }),
  exportFilteredArchives: (ids) => ipcRenderer.invoke('archive:filtered-export', { ids }),
  getChangeOverview: (period = {}) => ipcRenderer.invoke('changes:overview', period),
  exportChangeOverview: (period = {}) => ipcRenderer.invoke('changes:export', period),
  copyText: (value) => ipcRenderer.invoke('clipboard:write', { value: String(value || '') }),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('products:progress', listener);
    return () => ipcRenderer.removeListener('products:progress', listener);
  },
  onAccessChanged: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('access:changed', listener);
    return () => ipcRenderer.removeListener('access:changed', listener);
  },
  onUpdateAvailable: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('update:available', listener);
    return () => ipcRenderer.removeListener('update:available', listener);
  },
  onUpdateProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('update:download-progress', listener);
    return () => ipcRenderer.removeListener('update:download-progress', listener);
  },
});
