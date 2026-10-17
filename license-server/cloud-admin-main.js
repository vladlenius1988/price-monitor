const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const packageInfo = require('../package.json');
const { createOwnerApiClient } = require('./owner-api');

const APP_NAME = 'Price Monitor Cloud Admin';
const API_BASE_URL = process.env.PRICE_MONITOR_ADMIN_API_URL
  || packageInfo.priceMonitorAdminApiUrl
  || 'https://price-monitor-license-staging.vladlenius.workers.dev';

let mainWindow = null;
let ownerApiClient = null;

const appDataRoot = app.getPath('appData');
app.setName(APP_NAME);
app.setPath('userData', path.join(appDataRoot, APP_NAME));

function ensureAdminToken() {
  const ownPath = path.join(app.getPath('userData'), 'admin-token.txt');
  const legacyPath = path.join(appDataRoot, 'Price Monitor Server', 'admin-token.txt');
  for (const candidate of [ownPath, legacyPath]) {
    try {
      const token = fs.readFileSync(candidate, 'utf8').trim();
      if (token.length >= 32) {
        if (candidate !== ownPath) writeToken(ownPath, token);
        return token;
      }
    } catch (_error) {
      // Перший запуск або локальний сервер ще не встановлювався.
    }
  }
  const token = crypto.randomBytes(32).toString('hex');
  writeToken(ownPath, token);
  return token;
}

function writeToken(filePath, token) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 650,
    title: 'Price Monitor — хмарне керування',
    backgroundColor: '#f3f5f8',
    webPreferences: {
      preload: path.join(__dirname, 'admin-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  return mainWindow.loadFile(path.join(__dirname, 'admin.html'));
}

ipcMain.handle('owner:environment', () => ({ mode: 'cloud', secureProxy: true, apiBaseUrl: API_BASE_URL }));
ipcMain.handle('owner:copy-text', (_event, value) => {
  const text = String(value || '').slice(0, 10000);
  clipboard.writeText(text);
  return { copied: clipboard.readText() === text };
});
ipcMain.handle('owner:api-request', async (_event, request) => {
  if (!ownerApiClient) return { ok: false, status: 0, body: { error: 'server_unavailable' } };
  try {
    return await ownerApiClient.request(request);
  } catch (_error) {
    return { ok: false, status: 400, body: { error: 'request_invalid' } };
  }
});
ipcMain.handle('server:select-installer', async () => ({ canceled: true, filePath: '' }));

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.vladlen.pricemonitor.cloudadmin');
    try {
      ownerApiClient = createOwnerApiClient({ apiBaseUrl: API_BASE_URL, adminToken: ensureAdminToken() });
      await createWindow();
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        title: APP_NAME,
        message: 'Панель керування не запущено',
        detail: error?.message || String(error),
      });
      app.quit();
    }
  });
}

app.on('window-all-closed', () => app.quit());
