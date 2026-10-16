const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { startLocalLicenseServer } = require('./local-server');
const { createOwnerApiClient } = require('./owner-api');

const APP_NAME = 'Price Monitor Server';
const DEFAULT_PORT = 8787;
const DEFAULT_PUBLIC_PORT = 8788;
const TEST_HIDDEN = process.argv.includes('--test-hidden');

function argumentValue(prefix) {
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

let mainWindow = null;
let serverInstance = null;
let shuttingDown = false;
let notificationTimer = null;
let ownerApiClient = null;

app.setName(APP_NAME);
app.setPath('userData', TEST_HIDDEN && argumentValue('--test-user-data=')
  ? path.resolve(argumentValue('--test-user-data='))
  : path.join(app.getPath('appData'), APP_NAME));

function ensureAdminToken(filePath) {
  try {
    const existing = fs.readFileSync(filePath, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch (_error) {
    // Перший запуск: токен ще не створено.
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(filePath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  return token;
}

function privateKeyPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'license-private.pem')
    : path.join(__dirname, '..', '.license-private', 'license-private.pem');
}

async function startServerAndWindow() {
  const dataDirectory = app.getPath('userData');
  const adminToken = ensureAdminToken(path.join(dataDirectory, 'admin-token.txt'));
  serverInstance = await startLocalLicenseServer({
    adminPort: Number(argumentValue('--test-admin-port=')) || DEFAULT_PORT,
    publicHost: '0.0.0.0',
    publicPort: Number(argumentValue('--test-public-port=')) || DEFAULT_PUBLIC_PORT,
    adminToken,
    dataPath: path.join(dataDirectory, 'license-data.json'),
    privateKeyPath: privateKeyPath(),
  });
  ownerApiClient = createOwnerApiClient({ apiBaseUrl: serverInstance.adminBaseUrl, adminToken });

  mainWindow = new BrowserWindow({
    show: !TEST_HIDDEN,
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 650,
    title: 'Price Monitor — сервер ліцензій',
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
  await mainWindow.loadURL(serverInstance.adminUrl);
  serverInstance.telegram.sweep().catch(() => {});
  notificationTimer = setInterval(() => serverInstance?.telegram?.sweep().catch(() => {}), 60 * 60 * 1000);
  notificationTimer.unref?.();
}

ipcMain.handle('server:select-installer', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Оберіть інсталятор клієнта Price Monitor',
    properties: ['openFile'],
    filters: [{ name: 'Інсталятор Windows', extensions: ['exe'] }],
  });
  return result.canceled || !result.filePaths[0] ? { canceled: true, filePath: '' } : { canceled: false, filePath: result.filePaths[0] };
});

ipcMain.handle('owner:environment', () => ({ mode: 'local', secureProxy: true, apiBaseUrl: serverInstance?.adminBaseUrl || '' }));
ipcMain.handle('owner:api-request', async (_event, request) => {
  if (!ownerApiClient) return { ok: false, status: 0, body: { error: 'server_unavailable' } };
  try {
    return await ownerApiClient.request(request);
  } catch (_error) {
    return { ok: false, status: 400, body: { error: 'request_invalid' } };
  }
});

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
    app.setAppUserModelId('com.vladlen.pricemonitor.server');
    try {
      await startServerAndWindow();
    } catch (error) {
      const details = error?.code === 'EADDRINUSE'
        ? 'Порт 8787 або 8788 уже зайнятий. Закрийте інший сервер Price Monitor і запустіть програму знову.'
        : `Не вдалося запустити сервер ліцензій.\n\n${error?.message || error}`;
      await dialog.showMessageBox({
        type: 'error',
        title: 'Price Monitor Server',
        message: 'Сервер не запущено',
        detail: details,
      });
      app.quit();
    }
  });
}

app.on('before-quit', (event) => {
  if (notificationTimer) clearInterval(notificationTimer);
  if (shuttingDown || !serverInstance) return;
  event.preventDefault();
  shuttingDown = true;
  serverInstance.close().catch(() => {}).finally(() => app.quit());
});

app.on('window-all-closed', () => app.quit());

