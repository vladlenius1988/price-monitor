const STORE_IDS = new Set(['eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka']);
const AREAS = new Set(['app', 'license', 'server', 'search', 'storage', 'update']);
const OUTCOMES = new Set(['error', 'warning', 'info']);
const CODES = new Set([
  'access_error', 'catalog_unavailable', 'diagnostic_export_failed', 'diagnostic_sent',
  'network_error', 'no_results', 'renderer_error', 'search_error', 'server_check_failed',
  'server_unavailable', 'storage_error', 'timeout', 'unhandled_rejection', 'unknown_error',
  'update_check_failed', 'update_download_failed',
]);
const SENSITIVE_KEY = /(query|brand|product|price|barcode|ean|gtin)/i;

function normalizeSupportDiagnostic(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('diagnostic_invalid');
  if (containsSensitiveKey(input)) return invalid('diagnostic_sensitive_field');
  const reportId = safeToken(input.reportId, 32, 40);
  const licenseId = safeToken(input.licenseId, 8, 80);
  const deviceId = String(input.deviceId || '').trim().toLowerCase();
  const appVersion = safeVersion(input.appVersion);
  const appEdition = ['licensed', 'demo', 'full'].includes(String(input.appEdition || ''))
    ? String(input.appEdition) : '';
  if (!reportId) return invalid('diagnostic_report_invalid');
  if (!licenseId) return invalid('diagnostic_license_invalid');
  if (!/^[a-f0-9]{64}$/.test(deviceId)) return invalid('diagnostic_device_invalid');
  if (!appVersion || appEdition !== 'licensed') return invalid('diagnostic_app_invalid');

  const system = normalizeSystem(input.system);
  const access = normalizeAccess(input.access);
  const server = normalizeServer(input.server);
  const stores = Array.isArray(input.stores)
    ? [...new Set(input.stores.map(String).filter((store) => STORE_IDS.has(store)))].slice(0, 6)
    : [];
  if (!system || !access || !server) return invalid('diagnostic_payload_invalid');
  if (!Array.isArray(input.events) || input.events.length > 50) return invalid('diagnostic_events_invalid');
  const events = [];
  for (const item of input.events) {
    const event = normalizeEvent(item);
    if (!event) return invalid('diagnostic_event_invalid');
    events.push(event);
  }
  const generatedAt = safeDate(input.generatedAt);
  if (!generatedAt) return invalid('diagnostic_date_invalid');
  const severity = events.some((event) => event.outcome === 'error')
    ? 'error' : events.some((event) => event.outcome === 'warning') ? 'warning' : 'info';
  const fingerprint = diagnosticFingerprint({ events, access, server, stores });
  return {
    ok: true,
    value: {
      reportId, licenseId, deviceId, appVersion, appEdition, generatedAt,
      system, access, server, stores, events, severity, fingerprint,
    },
  };
}

function normalizeSystem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const platform = String(value.platform || '').toLowerCase();
  const arch = String(value.arch || '').toLowerCase();
  const release = String(value.release || '').replace(/[^0-9a-z._-]/gi, '').slice(0, 80);
  const locale = String(value.locale || '').replace(/[^0-9a-z_-]/gi, '').slice(0, 24);
  if (!['win32', 'linux', 'darwin'].includes(platform) || !/^[a-z0-9_-]{2,20}$/.test(arch)) return null;
  return { platform, release, arch, locale };
}

function normalizeAccess(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    allowed: Boolean(value.allowed),
    blockedReason: safeCode(value.blockedReason),
    onlineConfigured: Boolean(value.onlineConfigured),
    expiresAt: value.expiresAt ? safeDate(value.expiresAt) : '',
    lastOnlineSuccessAt: value.lastOnlineSuccessAt ? safeDate(value.lastOnlineSuccessAt) : '',
  };
}

function normalizeServer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { checked: Boolean(value.checked), available: Boolean(value.available), reason: safeCode(value.reason) };
}

function normalizeEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const area = String(value.area || '');
  const outcome = String(value.outcome || '');
  const code = String(value.code || '');
  const store = String(value.store || '');
  const at = safeDate(value.at);
  if (!AREAS.has(area) || !OUTCOMES.has(outcome) || !CODES.has(code) || !at) return null;
  if (store && !STORE_IDS.has(store)) return null;
  return { at, area, outcome, code, store };
}

function diagnosticFingerprint(value) {
  const material = (value.events || [])
    .filter((event) => event.outcome !== 'info')
    .map((event) => `${event.area}:${event.store || '-'}:${event.code}`);
  if (!material.length) {
    material.push(`access:${value.access?.allowed ? 'ok' : value.access?.blockedReason || 'blocked'}`);
    material.push(`server:${value.server?.available ? 'ok' : value.server?.reason || 'unavailable'}`);
  }
  const normalized = [...new Set(material)].sort().join('|').slice(0, 1000);
  return stableHash(normalized || 'diagnostic');
}

// Pure JavaScript hash: it also works in Cloudflare Workers without Node.js compatibility mode.
function stableHash(value) {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  return seeds.map((seed) => {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
      hash ^= hash >>> 13;
    }
    return hash.toString(16).padStart(8, '0');
  }).join('');
}

function containsSensitiveKey(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsSensitiveKey(item, depth + 1));
  return Object.entries(value).some(([key, item]) => SENSITIVE_KEY.test(key) || containsSensitiveKey(item, depth + 1));
}

function safeDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function safeVersion(value) {
  const version = String(value || '').trim();
  return /^[0-9a-z._-]{1,32}$/i.test(version) ? version : '';
}

function safeToken(value, min, max) {
  const token = String(value || '').trim();
  return new RegExp(`^[a-z0-9_-]{${min},${max}}$`, 'i').test(token) ? token : '';
}

function safeCode(value) {
  const code = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(code) ? code : '';
}

function invalid(reason) { return { ok: false, reason }; }

function telegramSupportMessage(item = {}) {
  const codes = [...new Set((item.events || []).filter((event) => event.outcome === 'error').map((event) => event.code))];
  return [
    'Price Monitor: нове звернення підтримки',
    `Клієнт: ${String(item.customerName || item.licenseId || 'невідомий').slice(0, 120)}`,
    `Пристрій: ${String(item.deviceLabel || item.deviceCode || 'невідомий').slice(0, 120)}`,
    `Версія: ${String(item.appVersion || 'невідома').slice(0, 32)}`,
    `Рівень: ${String(item.severity || 'info')}`,
    `Повторів: ${Math.max(1, Number(item.repeatCount) || 1)}`,
    `Коди: ${codes.slice(0, 8).join(', ') || 'немає'}`,
  ].join('\n');
}

module.exports = { normalizeSupportDiagnostic, diagnosticFingerprint, telegramSupportMessage };
