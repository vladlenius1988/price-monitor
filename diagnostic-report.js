const fs = require('fs');

const MAX_EVENTS = 50;
const EVENT_AREAS = new Set(['app', 'license', 'server', 'search', 'storage', 'update']);
const EVENT_OUTCOMES = new Set(['error', 'warning', 'info']);
const STORE_IDS = new Set(['eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka']);
const DIAGNOSTIC_CODES = new Set([
  'access_error',
  'catalog_unavailable',
  'diagnostic_export_failed',
  'network_error',
  'no_results',
  'renderer_error',
  'search_error',
  'server_check_failed',
  'server_unavailable',
  'storage_error',
  'timeout',
  'unhandled_rejection',
  'unknown_error',
  'update_check_failed',
  'update_download_failed',
]);

function safeCode(value, fallback = '') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
}

function safeDate(value, fallback = new Date().toISOString()) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function normalizeDiagnosticEvent(value = {}, now = () => Date.now()) {
  const area = EVENT_AREAS.has(String(value.area || '')) ? String(value.area) : 'app';
  const outcome = EVENT_OUTCOMES.has(String(value.outcome || '')) ? String(value.outcome) : 'error';
  const store = STORE_IDS.has(String(value.store || '')) ? String(value.store) : '';
  return {
    at: safeDate(value.at, new Date(Number(now()) || Date.now()).toISOString()),
    area,
    outcome,
    code: DIAGNOSTIC_CODES.has(safeCode(value.code)) ? safeCode(value.code) : 'unknown_error',
    store,
  };
}

class DiagnosticEventStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.fs = options.fs || fs;
    this.now = options.now || (() => Date.now());
  }

  async list() {
    if (!this.filePath) return [];
    try {
      const parsed = JSON.parse(await this.fs.promises.readFile(this.filePath, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(-MAX_EVENTS).map((event) => normalizeDiagnosticEvent(event, this.now));
    } catch (_error) {
      return [];
    }
  }

  async add(value) {
    if (!this.filePath) return null;
    const event = normalizeDiagnosticEvent(value, this.now);
    const events = [...await this.list(), event].slice(-MAX_EVENTS);
    await this.fs.promises.writeFile(this.filePath, `${JSON.stringify(events, null, 2)}\n`, 'utf8');
    return event;
  }
}

function sanitizeAccessStatus(value = {}) {
  const stores = Array.isArray(value.stores)
    ? value.stores.map(String).filter((store) => STORE_IDS.has(store))
    : [];
  return {
    edition: ['full', 'demo', 'licensed'].includes(String(value.edition || '')) ? String(value.edition) : '',
    allowed: Boolean(value.allowed),
    blockedReason: safeCode(value.blockedReason),
    licenseId: String(value.licenseId || '').slice(0, 80),
    customerName: String(value.customerName || '').slice(0, 120),
    deviceCode: String(value.deviceCode || '').replace(/[^A-Z0-9-]/gi, '').slice(0, 32),
    expiresAt: value.expiresAt ? safeDate(value.expiresAt, '') : '',
    paidUntil: value.paidUntil ? safeDate(value.paidUntil, '') : '',
    onlineConfigured: Boolean(value.onlineConfigured),
    lastOnlineAttemptAt: value.lastOnlineAttemptAt ? safeDate(value.lastOnlineAttemptAt, '') : '',
    lastOnlineSuccessAt: value.lastOnlineSuccessAt ? safeDate(value.lastOnlineSuccessAt, '') : '',
    stores,
  };
}

function sanitizeServerStatus(value = {}) {
  return {
    checked: Boolean(value.checked),
    available: Boolean(value.available),
    reason: safeCode(value.reason),
  };
}

function buildDiagnosticReport(options = {}) {
  const generatedAt = safeDate(options.generatedAt, new Date().toISOString());
  const access = sanitizeAccessStatus(options.access);
  const server = sanitizeServerStatus(options.server);
  const events = Array.isArray(options.events)
    ? options.events.slice(-MAX_EVENTS).map((event) => normalizeDiagnosticEvent(event))
    : [];
  const appInfo = {
    name: String(options.appInfo?.name || 'Price Monitor').slice(0, 120),
    version: String(options.appInfo?.version || '').slice(0, 32),
    edition: String(options.appInfo?.edition || '').slice(0, 32),
  };
  const system = {
    platform: safeCode(options.system?.platform),
    release: String(options.system?.release || '').replace(/[^0-9A-Za-z._-]/g, '').slice(0, 80),
    arch: safeCode(options.system?.arch),
    locale: String(options.system?.locale || '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 24),
  };
  const supportedStores = Array.isArray(options.supportedStores)
    ? options.supportedStores.map(String).filter((store) => STORE_IDS.has(store))
    : [];
  const licenseLabel = access.allowed ? 'активна' : `заблокована (${access.blockedReason || 'невідома причина'})`;
  const serverLabel = server.available ? 'доступний' : server.checked ? 'недоступний' : 'не налаштований';

  return {
    schemaVersion: 1,
    title: 'Діагностика Price Monitor',
    generatedAt,
    summaryUa: [
      `Версія програми: ${appInfo.version || 'невідома'} (${appInfo.edition || 'невідома редакція'})`,
      `Система: ${system.platform || 'невідома'} ${system.release || ''} ${system.arch || ''}`.trim(),
      `Ліцензія: ${licenseLabel}`,
      `Сервер ліцензій: ${serverLabel}`,
      `Доступні магазини: ${access.stores.length ? access.stores.join(', ') : 'не визначено'}`,
      `Зафіксовано безпечних подій: ${events.length}`,
    ],
    privacy: {
      containsSearchQueries: false,
      containsBrands: false,
      containsProducts: false,
      containsPrices: false,
      containsBarcodes: false,
      noteUa: 'Файл не містить пошукових запитів, назв товарів, цін або штрихкодів.',
    },
    app: appInfo,
    system,
    access,
    server,
    supportedStores,
    recentEvents: events,
  };
}

module.exports = {
  DiagnosticEventStore,
  buildDiagnosticReport,
  normalizeDiagnosticEvent,
  sanitizeAccessStatus,
  sanitizeServerStatus,
};
