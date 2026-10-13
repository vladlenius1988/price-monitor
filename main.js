const { app, BrowserWindow, clipboard, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID, createHash } = require('crypto');
const packageInfo = require('./package.json');
const writeExcelFileModule = require('write-excel-file/node');
const writeExcelFile = writeExcelFileModule.default || writeExcelFileModule;
const { PriceScraper, STORES } = require('./scraper');
const { ComparisonStore } = require('./comparison-store');
const { productDiscount } = require('./result-view');
const { ArchiveStore } = require('./archive-store');
const { compareArchivedChecks } = require('./archive-tools');
const { buildPriceHistoryWorkbook } = require('./price-history-export');
const { buildCombinedArchiveWorkbook, buildFilteredArchiveWorkbook } = require('./multi-store-export');
const { buildCrossStoreChangeReport, buildChangeReportWorkbook } = require('./change-report');
const { DemoAccessStore } = require('./demo-access');
const { LicensedAccessStore } = require('./license-access');

const requestedEdition = String(process.env.PRICE_MONITOR_EDITION || packageInfo.priceMonitorEdition || 'full');
const APP_EDITION = ['demo', 'licensed'].includes(requestedEdition) ? requestedEdition : 'full';
const EDITION_SETTINGS = {
  full: {
    name: 'Price Monitor',
    title: 'Моніторинг цін',
    appId: 'com.vladlen.retailpricemonitor',
    userDataName: '',
  },
  demo: {
    name: 'Price Monitor Demo',
    title: 'Price Monitor Demo',
    appId: 'com.vladlen.retailpricemonitor.demo',
    userDataName: 'Price Monitor Demo',
  },
  licensed: {
    name: 'Price Monitor Licensed',
    title: 'Price Monitor Licensed',
    appId: 'com.vladlen.retailpricemonitor.licensed',
    userDataName: 'Price Monitor Licensed',
  },
};
const editionDefaults = EDITION_SETTINGS[APP_EDITION];
const editionSettings = {
  ...editionDefaults,
  name: String(packageInfo.priceMonitorAppName || editionDefaults.name),
  title: String(packageInfo.priceMonitorWindowTitle || editionDefaults.title),
  appId: String(packageInfo.priceMonitorAppId || editionDefaults.appId),
  userDataName: String(packageInfo.priceMonitorUserDataName || editionDefaults.userDataName),
};

if (APP_EDITION !== 'full' && typeof app.setPath === 'function' && typeof app.getPath === 'function') {
  const testDataArgument = process.argv.includes('--test-hidden')
    ? process.argv.find((value) => value.startsWith('--test-user-data='))
    : '';
  const testDataPath = testDataArgument ? path.resolve(testDataArgument.slice('--test-user-data='.length)) : '';
  app.setName?.(editionSettings.name);
  app.setPath('userData', testDataPath || path.join(app.getPath('appData'), editionSettings.userDataName));
}

let mainWindow = null;
let scraper = null;
let comparisonStore = null;
let archiveStore = null;
let deletedArchiveBatch = null;
let accessStore = new DemoAccessStore({ edition: 'full' });
let licenseCheckTimer = null;
let latestUpdateDocument = null;
let lastAutomaticUpdateCheckAt = 0;

function debugRenderer(message) {
  const argument = process.argv.find((value) => value.startsWith('--debug-log='));
  if (!argument) return;
  const filePath = argument.slice('--debug-log='.length);
  try {
    fs.appendFileSync(filePath, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch (_error) {
    // Діагностика не повинна впливати на роботу програми.
  }
}

function accessDeniedMessage(reason) {
  if (reason === 'brand_limit') return 'У демо-версії можна перевірити не більше трьох марок за один пошук.';
  if (reason === 'time_expired' && APP_EDITION === 'licensed') {
    return 'Термін ліцензії завершився. Продовжіть ліцензію, щоб запустити новий пошук.';
  }
  if (reason === 'clock_rollback') {
    return 'Не вдалося підтвердити дату на цьому комп’ютері. Перевірте системний час або зверніться до власника ліцензії.';
  }
  if (reason === 'device_mismatch') {
    return 'Цю ліцензію видано для іншого комп’ютера. Зверніться до власника програми для активації.';
  }
  if (reason === 'device_id_unavailable') {
    return 'Не вдалося визначити цей комп’ютер для перевірки ліцензії.';
  }
  if (reason === 'store_not_allowed') {
    return 'Цей магазин не входить до поточної ліцензії.';
  }
  if (reason === 'pending_approval') return 'Цей комп’ютер очікує підтвердження власником ліцензії.';
  if (reason === 'suspended') return 'Ліцензію тимчасово призупинено власником.';
  if (APP_EDITION === 'licensed') {
    return 'Ліцензія відсутня або пошкоджена. Новий пошук недоступний.';
  }
  return 'Демонстраційний доступ завершено. Новий пошук недоступний.';
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    show: !process.argv.includes('--test-hidden'),
    width: 1180,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: '#f6f7fb',
    title: editionSettings.title,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.webContents.on('console-message', (_event, detailsOrLevel, legacyMessage, legacyLine, legacySource) => {
    const details = typeof detailsOrLevel === 'object'
      ? detailsOrLevel
      : { level: detailsOrLevel, message: legacyMessage, lineNumber: legacyLine, sourceId: legacySource };
    debugRenderer(`console level=${details.level} message=${details.message} source=${details.sourceId}:${details.lineNumber}`);
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    debugRenderer(`preload-error path=${preloadPath} error=${error?.stack || error}`);
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    debugRenderer(`did-fail-load code=${code} description=${description} url=${url}`);
  });
  mainWindow.webContents.on('did-finish-load', () => debugRenderer('did-finish-load'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadFile('index.html');
}

function registerIpcHandlers() {
  ipcMain.handle('stores:list', () => STORES);

  ipcMain.handle('access:status', () => accessStore.getStatus());
  ipcMain.handle('access:refresh', async () => {
    if (typeof accessStore.refreshOnline !== 'function') {
      return { checked: false, updated: false, reason: 'not_configured', status: accessStore.getStatus() };
    }
    return accessStore.refreshOnline();
  });
  ipcMain.handle('access:activate', async (_event, payload = {}) => {
    if (typeof accessStore.activateOnline !== 'function') {
      return { checked: false, updated: false, reason: 'not_configured', status: accessStore.getStatus() };
    }
    const result = await accessStore.activateOnline(String(payload.activationCode || ''));
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('access:changed', result.status);
    return result;
  });
  ipcMain.handle('access:export-request', async () => {
    if (typeof accessStore.getActivationRequest !== 'function') {
      return { saved: false, canceled: false, reason: 'not_supported' };
    }
    const request = accessStore.getActivationRequest();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Зберегти запит на ліцензію',
      defaultPath: `Price-Monitor-запит-${request.deviceCode || 'пристрій'}.json`,
      filters: [{ name: 'Запит на ліцензію', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false, canceled: true, reason: '' };
    await fs.promises.writeFile(result.filePath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
    return { saved: true, canceled: false, reason: '', filePath: result.filePath };
  });
  ipcMain.handle('access:import-license', async () => {
    if (typeof accessStore.installLicenseDocument !== 'function') {
      return { updated: false, canceled: false, reason: 'not_supported', status: accessStore.getStatus() };
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Встановити файл ліцензії',
      properties: ['openFile'],
      filters: [{ name: 'Ліцензія Price Monitor', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { updated: false, canceled: true, reason: '', status: accessStore.getStatus() };
    }
    try {
      const document = JSON.parse(await fs.promises.readFile(result.filePaths[0], 'utf8'));
      const installed = accessStore.installLicenseDocument(document, { requireUsable: true });
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('access:changed', installed.status);
      return { ...installed, canceled: false };
    } catch (_error) {
      return { updated: false, canceled: false, reason: 'license_invalid', status: accessStore.getStatus() };
    }
  });
  ipcMain.handle('access:begin-search', (_event, payload = {}) => {
    return accessStore.beginSearch({ brandCount: payload.brandCount, store: payload.store });
  });
  ipcMain.handle('access:finish-search', (_event, payload = {}) => {
    return accessStore.finishSearch(payload.token);
  });

  ipcMain.handle('updates:check', async () => {
    if (typeof accessStore.checkForUpdate !== 'function') return { checked: false, update: null, reason: 'not_configured' };
    const result = await accessStore.checkForUpdate();
    latestUpdateDocument = result.update || null;
    return result;
  });
  ipcMain.handle('updates:download-install', async (_event, payload = {}) => {
    const requestedId = String(payload.releaseId || '');
    const update = latestUpdateDocument;
    if (!update || update.payload.releaseId !== requestedId) return { started: false, reason: 'update_invalid' };
    const downloadUrl = accessStore.resolveServerPath(update.payload.downloadPath);
    if (!downloadUrl) return { started: false, reason: 'update_invalid' };
    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error('update_download_failed');
      const contents = Buffer.from(await response.arrayBuffer());
      if (contents.length !== update.payload.size) throw new Error('update_size_mismatch');
      const hash = createHash('sha256').update(contents).digest('hex');
      if (hash !== update.payload.sha256) throw new Error('update_hash_mismatch');
      const updateDirectory = path.join(app.getPath('userData'), 'updates');
      await fs.promises.mkdir(updateDirectory, { recursive: true });
      const installerPath = path.join(updateDirectory, path.basename(update.payload.fileName));
      await fs.promises.writeFile(installerPath, contents);
      const openError = await shell.openPath(installerPath);
      return openError ? { started: false, reason: 'update_launch_failed' } : { started: true, reason: '' };
    } catch (error) {
      return { started: false, reason: String(error?.message || 'update_download_failed') };
    }
  });

  ipcMain.handle('brands:suggest', async (_event, payload = {}) => {
    const store = String(payload.store || 'eva');
    const query = String(payload.query || '').trim();
    return scraper.suggestBrands(store, query);
  });

  ipcMain.handle('products:parse', async (_event, payload = {}) => {
    const store = String(payload.store || 'eva');
    const query = String(payload.query || '').trim();
    const accessToken = String(payload.options?.accessToken || '');
    const access = accessStore.authorizeParse(accessToken, store);
    if (!access.allowed) {
      throw new Error(accessDeniedMessage(access.reason));
    }
    const options = {
      includeVariants: ['eva', 'makeup', 'notino', 'aurora'].includes(store) && Boolean(payload.options?.includeVariants),
      includeSellers: store === 'rozetka' && Boolean(payload.options?.includeSellers),
      includeBarcodes: store === 'makeup' && Boolean(payload.options?.includeBarcodes),
      previousProducts: Array.isArray(payload.options?.previousProducts)
        ? payload.options.previousProducts
        : [],
      recoveryQuery: String(payload.options?.recoveryQuery || query).trim(),
    };
    const result = await scraper.parseBrand(store, query, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('products:progress', progress);
      }
    }, options);
    return accessStore.limitParseResult(accessToken, result);
  });

  ipcMain.handle('products:cancel', () => {
    scraper.cancel();
    return true;
  });

  ipcMain.handle('clipboard:write', (_event, payload = {}) => {
    clipboard.writeText(String(payload.value || ''));
    return true;
  });

  ipcMain.handle('products:recovery:get', () => scraper.getRecovery());
  ipcMain.handle('products:recovery:clear', () => {
    scraper.clearRecovery();
    return true;
  });

  ipcMain.handle('comparison:get', (_event, payload = {}) => {
    return comparisonStore?.get(String(payload.key || '')) || null;
  });

  ipcMain.handle('comparison:save', (_event, payload = {}) => {
    return comparisonStore?.save(payload) || null;
  });

  ipcMain.handle('comparison:list', () => comparisonStore?.all() || []);

  ipcMain.handle('comparison:merge', (_event, payload = []) => {
    return comparisonStore?.merge(payload) || { added: 0, updated: 0, total: 0 };
  });

  ipcMain.handle('archive:save', (_event, payload = {}) => archiveStore.save(payload));
  ipcMain.handle('archive:list', () => archiveStore.list());
  ipcMain.handle('archive:get', (_event, id) => archiveStore.get(id));
  ipcMain.handle('archive:all', () => archiveStore.all());
  ipcMain.handle('archive:merge', (_event, records = []) => archiveStore.merge(records));
  ipcMain.handle('archive:delete', (_event, payload = {}) => {
    const ids = payload.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 60
      || ids.some((id) => typeof id !== 'string' || !id || id.length > 100)
      || new Set(ids).size !== ids.length) {
      throw new Error('Не вдалося визначити перевірки для видалення.');
    }
    const all = archiveStore.all();
    const byId = new Map(all.map((record) => [record.id, record]));
    if (ids.some((id) => !byId.has(id))) {
      throw new Error('Одна з вибраних перевірок уже відсутня. Відкрийте архів знову.');
    }
    const result = archiveStore.removeMany(ids);
    const token = randomUUID();
    deletedArchiveBatch = { token, records: result.removed };
    return { removed: result.removed.length, total: result.total, token };
  });
  ipcMain.handle('archive:restore-deleted', (_event, payload = {}) => {
    const token = String(payload.token || '');
    if (!deletedArchiveBatch || !token || token !== deletedArchiveBatch.token) {
      throw new Error('Це видалення вже не можна скасувати.');
    }
    const records = deletedArchiveBatch.records;
    deletedArchiveBatch = null;
    const result = archiveStore.merge(records);
    if (result.added !== records.length) {
      throw new Error(`Відновлено ${result.added} із ${records.length} перевірок через обмеження розміру архіву.`);
    }
    return { restored: result.added, total: result.total };
  });
  ipcMain.handle('archive:product-history', (_event, payload = {}) => {
    return archiveStore.productHistory(String(payload.store || ''), payload.product || {});
  });
  ipcMain.handle('archive:compare', (_event, payload = {}) => {
    const previous = archiveStore.get(payload.previousId);
    const current = archiveStore.get(payload.currentId);
    return { record: current, comparison: compareArchivedChecks(previous, current) };
  });
  ipcMain.handle('archive:history-export', async (_event, payload = {}) => {
    const store = STORES[payload.store];
    if (!store) throw new Error('Невідомий магазин.');
    const product = payload.product || {};
    // Ціни читаються з локального архіву, а не з довільного масиву клієнта.
    const points = archiveStore.productHistory(payload.store, product);
    const sheets = buildPriceHistoryWorkbook({ storeLabel: store.label, product, points });
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Зберегти історію ціни товару',
      defaultPath: `${store.filePrefix}_price_history_${safeFilePart(product.name || product.barcode || 'товар')}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const buffer = await writeExcelFile(sheets).toBuffer();
    await fs.promises.writeFile(result.filePath, buffer);
    return result.filePath;
  });

  ipcMain.handle('archive:combined-export', async (_event, payload = {}) => {
    const ids = payload.ids;
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 6
      || ids.some((id) => typeof id !== 'string' || !id || id.length > 100)
      || new Set(ids).size !== ids.length) {
      throw new Error('Оберіть від двох до шести різних перевірок.');
    }
    const all = archiveStore.all();
    const byId = new Map(all.map((record) => [record.id, record]));
    const records = ids.map((id) => byId.get(id));
    if (records.some((record) => !record)) {
      throw new Error('Одна з вибраних перевірок уже відсутня в архіві. Відкрийте архів знову.');
    }
    const sheets = buildCombinedArchiveWorkbook(records, STORES);
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Зберегти зведений Excel кількох магазинів',
      defaultPath: `price_monitor_stores_${date}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const buffer = await writeExcelFile(sheets).toBuffer();
    await fs.promises.writeFile(result.filePath, buffer);
    return result.filePath;
  });

  ipcMain.handle('archive:filtered-export', async (_event, payload = {}) => {
    const ids = payload.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 60
      || ids.some((id) => typeof id !== 'string' || !id || id.length > 100)
      || new Set(ids).size !== ids.length) {
      throw new Error('За поточними фільтрами немає дійсних перевірок для експорту.');
    }
    const byId = new Map(archiveStore.all().map((record) => [record.id, record]));
    const records = ids.map((id) => byId.get(id));
    if (records.some((record) => !record)) {
      throw new Error('Одна з показаних перевірок уже відсутня в архіві. Відкрийте архів знову.');
    }
    const sheets = buildFilteredArchiveWorkbook(records, STORES);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Зберегти показані перевірки архіву',
      defaultPath: `price_monitor_archive_${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const buffer = await writeExcelFile(sheets).toBuffer();
    await fs.promises.writeFile(result.filePath, buffer);
    return result.filePath;
  });

  ipcMain.handle('changes:overview', (_event, period = {}) => buildCrossStoreChangeReport(archiveStore.all(), STORES, period));
  ipcMain.handle('changes:export', async (_event, period = {}) => {
    const report = buildCrossStoreChangeReport(archiveStore.all(), STORES, period);
    const sheets = buildChangeReportWorkbook(report);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Зберегти звіт про зміни цін',
      defaultPath: report.period.active
        ? `price_monitor_changes_${report.period.from}_${report.period.to}.xlsx`
        : `price_monitor_changes_${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const buffer = await writeExcelFile(sheets).toBuffer();
    await fs.promises.writeFile(result.filePath, buffer);
    return result.filePath;
  });

  ipcMain.handle('saved-lists:export', async (_event, payload = {}) => {
    const contents = JSON.stringify(payload, null, 2);
    if (Buffer.byteLength(contents, 'utf8') > 50_000_000) {
      throw new Error('Резервна копія даних завелика.');
    }
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Зберегти резервну копію даних',
      defaultPath: `price-monitor-backup-${date}.json`,
      filters: [{ name: 'Резервна копія даних Price Monitor', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.promises.writeFile(result.filePath, contents, 'utf8');
    return result.filePath;
  });

  ipcMain.handle('saved-lists:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Відкрити резервну копію даних',
      properties: ['openFile'],
      filters: [{ name: 'Резервна копія даних Price Monitor', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const stats = await fs.promises.stat(filePath);
    if (stats.size > 50_000_000) throw new Error('Файл резервної копії даних завеликий.');
    return { filePath, contents: await fs.promises.readFile(filePath, 'utf8') };
  });

  ipcMain.handle('products:export', async (_event, payload = {}) => {
    const products = Array.isArray(payload.products) ? payload.products : [];
    if (!products.length) throw new Error('Немає товарів для експорту.');

    const store = STORES[payload.store] || STORES.eva;
    const brand = String(payload.brand || products[0]?.brand || 'товари');
    const header = (value) => ({
      value,
      fontWeight: 'bold',
      textColor: '#FFFFFF',
      backgroundColor: '#2F6F4E',
      alignVertical: 'center',
    });
    const priceCell = (value) => value === ''
      ? null
      : { value, type: Number, format: '#,##0.00' };
    const differenceCell = (value) => value === ''
      ? null
      : { value, type: Number, format: '+#,##0.00;-#,##0.00;0.00' };
    const percentageCell = (value) => value === ''
      ? null
      : { value, type: Number, format: '0.00' };
    const hasPromo = products.some((product) => product.promoPrice || product.promotionCondition);
    const hasVariants = products.some((product) => product.variant);
    const hasSellers = products.some((product) => product.seller);
    const hasBarcodes = Boolean(payload.options?.includeBarcodes)
      || products.some((product) => product.barcode);
    const hasComparison = products.some((product) => product.comparisonStatus);
    const headings = [
      header('Назва товару'),
      header('Торгова марка'),
    ];
    const widths = [72, 28];
    if (hasBarcodes) {
      headings.push(header('Штрихкод'));
      widths.push(19);
    }
    if (hasVariants) {
      headings.push(header('Варіант / відтінок / об’єм'));
      widths.push(34);
    }
    if (hasSellers) {
      headings.push(header('Продавець'));
      widths.push(28);
    }
    headings.push(
      header('Ціна зі знижкою'),
      header('Ціна без знижки'),
      header('Економія'),
      header('Знижка, %'),
    );
    widths.push(19, 19, 17, 15);
    if (hasComparison) {
      headings.push(header('Попередня ціна'), header('Зміна ціни'), header('Статус зміни'));
      widths.push(19, 17, 20);
    }
    if (hasPromo) {
      headings.push(header('Ціна за промокодом'), header('Промокод / умова'));
      widths.push(22, 54);
    }
    headings.push(header('Магазин'), header('Посилання'));
    widths.push(14, 60);

    const data = [
      headings,
      ...products.map((product) => {
        const discount = productDiscount(product);
        const row = [
          product.name || '',
          product.brand || brand,
        ];
        if (hasBarcodes) row.push(String(product.barcode || ''));
        if (hasVariants) row.push(product.variant || '');
        if (hasSellers) row.push(product.seller || '');
        row.push(
          priceCell(numberOrBlank(product.priceWithDiscount)),
          priceCell(numberOrBlank(product.priceWithoutDiscount)),
          priceCell(numberOrBlank(discount?.amount)),
          percentageCell(numberOrBlank(discount?.percent)),
        );
        if (hasComparison) {
          row.push(
            priceCell(numberOrBlank(product.previousPrice)),
            differenceCell(numberOrBlank(product.priceDifference)),
            product.comparisonLabel || comparisonStatusLabel(product.comparisonStatus),
          );
        }
        if (hasPromo) {
          row.push(
            priceCell(numberOrBlank(product.promoPrice)),
            product.promotionCondition || product.promoCode || '',
          );
        }
        row.push(store.label, product.url || '');
        return row;
      }),
    ];
    const columns = widths.map((width) => ({ width }));
    const sheets = [{
      data,
      sheet: 'Моніторинг цін',
      columns,
      stickyRowsCount: 1,
    }];
    const missing = Array.isArray(payload.comparison?.missing) ? payload.comparison.missing : [];
    if (missing.length) {
      const missingData = [
        [
          header('Назва товару'),
          header('Торгова марка'),
          header('Штрихкод'),
          header('Варіант / відтінок / об’єм'),
          header('Продавець'),
          header('Остання відома ціна'),
          header('Магазин'),
          header('Посилання'),
          header('Попередня перевірка'),
        ],
        ...missing.map((product) => [
          product.name || '',
          product.brand || '',
          String(product.barcode || ''),
          product.variant || '',
          product.seller || '',
          priceCell(numberOrBlank(product.previousPrice ?? product.price)),
          store.label,
          product.url || '',
          payload.comparison?.previousCapturedAt || '',
        ]),
      ];
      sheets.push({
        data: missingData,
        sheet: 'Зникли з видачі',
        columns: [
          { width: 72 }, { width: 28 }, { width: 19 }, { width: 34 }, { width: 28 },
          { width: 22 }, { width: 14 }, { width: 60 }, { width: 24 },
        ],
        stickyRowsCount: 1,
      });
    }
    const metadata = payload.capture || {};
    const filters = payload.filters || {};
    sheets.push({
      sheet: 'Параметри перевірки',
      columns: [{ width: 32 }, { width: 95 }],
      data: [
        [header('Параметр'), header('Значення')],
        ['Магазин', store.label],
        ['Запит', metadata.query || brand],
        ['Час перевірки', metadata.capturedAt || 'Не зафіксовано'],
        ['Джерело', metadata.source === 'archive' ? 'Архів — не поточні ціни' : metadata.source === 'recovery' ? 'Відновлений частковий результат' : 'Поточний пошук'],
        ['База порівняння', payload.comparison?.previousCapturedAt || 'Немає'],
        ['Повнота', metadata.complete ? 'Повний успішний пошук' : 'Частковий або відновлений результат'],
        ['Рядків експортовано', products.length],
        ['Рядків у перевірці', metadata.sourceCount || products.length],
        ['Архів скорочено', metadata.truncated ? 'Так — діє ліміт архіву' : 'Ні'],
        ['Варіанти', metadata.options?.includeVariants ? 'Так' : 'Ні'],
        ['Продавці', metadata.options?.includeSellers ? 'Так' : 'Ні'],
        ['Штрихкоди', metadata.options?.includeBarcodes ? 'Так' : 'Ні'],
        ['Текстовий фільтр', filters.query || 'Немає'],
        ['Фільтр знижок', { discounted: 'Лише зі знижкою', regular: 'Лише без знижки' }[filters.sale] || 'Усі'],
        ['Ціна від', filters.minPrice || 'Немає'],
        ['Ціна до', filters.maxPrice || 'Немає'],
        ['Режим експорту', filters.visibleOnly ? 'Показані рядки' : 'Усі рядки'],
      ],
      stickyRowsCount: 1,
    });
    const buffer = await writeExcelFile(sheets).toBuffer();

    const date = new Date().toISOString().slice(0, 10);
    const safeBrand = safeFilePart(brand) || 'brand';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Зберегти моніторинг цін',
      defaultPath: `${store.filePrefix}_${safeBrand}_${date}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });

    if (result.canceled || !result.filePath) return null;
    await fs.promises.writeFile(result.filePath, buffer);
    return result.filePath;
  });
}

function numberOrBlank(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number) ? number : '';
}

function safeFilePart(value) {
  return String(value)
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70);
}

function comparisonStatusLabel(status) {
  return {
    new: 'Новий товар',
    cheaper: 'Подешевшав',
    expensive: 'Подорожчав',
    unchanged: 'Без змін',
  }[status] || '';
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId?.(editionSettings.appId);
    accessStore = APP_EDITION === 'licensed'
      ? new LicensedAccessStore({
        edition: APP_EDITION,
        licensePath: path.join(app.getPath('userData'), 'license.json'),
        bundledLicensePath: process.env.PRICE_MONITOR_SKIP_BUNDLED_LICENSE === '1' || packageInfo.priceMonitorBundledLicense === false
          ? ''
          : path.join(__dirname, 'paid-license.json'),
        statePath: path.join(app.getPath('userData'), 'license-state.dat'),
        publicKeyPath: path.join(__dirname, 'license-public.pem'),
        safeStorage,
        serverUrl: process.env.PRICE_MONITOR_LICENSE_SERVER_URL || packageInfo.priceMonitorLicenseServerUrl || '',
        appVersion: packageInfo.version,
      })
      : new DemoAccessStore({
        edition: APP_EDITION,
        filePath: path.join(app.getPath('userData'), 'demo-access.dat'),
        safeStorage,
      });
    scraper = new PriceScraper({
      BrowserWindow,
      cacheFile: path.join(app.getPath('userData'), 'brands-cache.json'),
      recoveryFile: path.join(app.getPath('userData'), 'search-recovery.json'),
    });
    comparisonStore = new ComparisonStore(path.join(app.getPath('userData'), 'price-comparisons.json'));
    archiveStore = new ArchiveStore(path.join(app.getPath('userData'), 'monitoring-archive.json'));
    registerIpcHandlers();
    createMainWindow();
    const liveIntervalMs = Number(packageInfo.priceMonitorLiveLicenseIntervalMs) || 0;
    const refreshLicense = async (force = false) => {
      const status = accessStore.getStatus();
      const liveRequired = status?.blockedReason === 'pending_approval' || liveIntervalMs > 0;
      if (!force && !liveRequired && (typeof accessStore.shouldCheckOnline !== 'function' || !accessStore.shouldCheckOnline())) return;
      const result = await accessStore.refreshOnline();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('access:changed', result.status);
      }
      const updateIntervalMs = liveIntervalMs > 0 ? 30 * 1000 : 24 * 60 * 60 * 1000;
      if (result.status?.allowed && typeof accessStore.checkForUpdate === 'function' && Date.now() - lastAutomaticUpdateCheckAt >= updateIntervalMs) {
        lastAutomaticUpdateCheckAt = Date.now();
        const updateResult = await accessStore.checkForUpdate().catch(() => null);
        if (updateResult?.update) {
          latestUpdateDocument = updateResult.update;
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:available', updateResult.update);
        }
      }
    };
    refreshLicense().catch(() => {});
    licenseCheckTimer = setInterval(() => refreshLicense().catch(() => {}), liveIntervalMs > 0 ? Math.max(3000, liveIntervalMs) : 60 * 60 * 1000);
    licenseCheckTimer.unref?.();
    scraper.warmBrands('eva').catch(() => {});
  });
}

app.on('window-all-closed', () => {
  if (licenseCheckTimer) clearInterval(licenseCheckTimer);
  if (scraper) scraper.dispose();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
