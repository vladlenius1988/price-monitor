const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const SCHEMA_VERSION = 1;
const MAX_EVENTS = 5_000;
const MAX_BRANDS_PER_SEARCH = 100;
const STORE_IDS = new Set(['eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka']);
const SEARCH_OUTCOMES = new Set(['success', 'partial', 'cancelled', 'error']);
const MODES = new Set(['single', 'multi_store', 'barcode']);

class PilotStatisticsStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.fs = options.fs || fs;
    this.now = options.now || (() => Date.now());
    this.createId = options.createId || (() => randomUUID());
    this.writeQueue = Promise.resolve();
  }

  async recordSearch(value = {}) {
    return this.append({ ...value, type: 'search' });
  }

  async recordExport(value = {}) {
    return this.append({ ...value, type: 'excel_export' });
  }

  async append(value = {}) {
    const event = normalizePilotEvent({ ...value, id: value.id || this.createId() }, this.now);
    if (!event) return null;
    this.writeQueue = this.writeQueue.then(async () => {
      const document = await this.readDocument();
      const events = [...document.events, event]
        .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
        .slice(-MAX_EVENTS);
      await this.writeDocument({ schemaVersion: SCHEMA_VERSION, events });
    });
    await this.writeQueue;
    return event;
  }

  async summary(period = {}) {
    await this.writeQueue;
    const document = await this.readDocument();
    return buildPilotSummary(document.events, { ...period, now: this.now() });
  }

  async readDocument() {
    if (!this.filePath) return { schemaVersion: SCHEMA_VERSION, events: [] };
    try {
      const parsed = JSON.parse(await this.fs.promises.readFile(this.filePath, 'utf8'));
      const source = Array.isArray(parsed) ? parsed : parsed?.events;
      const events = Array.isArray(source)
        ? source.map((event) => normalizePilotEvent(event, this.now)).filter(Boolean).slice(-MAX_EVENTS)
        : [];
      return { schemaVersion: SCHEMA_VERSION, events };
    } catch (_error) {
      return { schemaVersion: SCHEMA_VERSION, events: [] };
    }
  }

  async writeDocument(document) {
    if (!this.filePath) return;
    await this.fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await this.fs.promises.writeFile(this.filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  }
}

function normalizePilotEvent(value = {}, now = () => Date.now()) {
  const type = value.type === 'excel_export' ? 'excel_export' : value.type === 'search' ? 'search' : '';
  if (!type) return null;
  const id = clean(value.id, 100);
  if (!id) return null;
  const fallbackAt = new Date(Number(now()) || Date.now()).toISOString();
  const at = safeDate(value.at || value.completedAt || value.exportedAt, fallbackAt);
  const stores = normalizeStores(value.stores || [value.store]);
  if (!stores.length) return null;
  const brands = normalizeBrands(value.brands || value.queries || []);
  const mode = MODES.has(String(value.mode || '')) ? String(value.mode) : stores.length > 1 ? 'multi_store' : 'single';
  const event = {
    id,
    type,
    at,
    mode,
    stores,
    brands,
    productCount: clampInteger(value.productCount, 10_000_000),
  };
  if (type === 'search') {
    event.outcome = SEARCH_OUTCOMES.has(String(value.outcome || '')) ? String(value.outcome) : 'error';
    event.durationMs = clampInteger(value.durationMs, 7 * 24 * 60 * 60 * 1000);
    event.errorCode = cleanCode(value.errorCode, 64);
  } else {
    event.rowCount = clampInteger(value.rowCount ?? value.productCount, 10_000_000);
  }
  return event;
}

function normalizeStores(values) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const store = clean(value, 30).toLowerCase();
    if (!STORE_IDS.has(store) || seen.has(store)) continue;
    seen.add(store);
    result.push(store);
  }
  return result;
}

function normalizeBrands(values) {
  const source = Array.isArray(values) ? values : [];
  const result = [];
  const seen = new Set();
  for (const value of source.slice(0, MAX_BRANDS_PER_SEARCH)) {
    const item = typeof value === 'string' ? { query: value, brand: value } : value || {};
    const query = clean(item.query || item.brand, 160);
    const brand = clean(item.brand || item.query, 160);
    const key = normalizeKey(query || brand);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      query,
      brand,
      outcome: SEARCH_OUTCOMES.has(String(item.outcome || '')) ? String(item.outcome) : '',
      productCount: clampInteger(item.productCount ?? item.count, 10_000_000),
    });
  }
  return result;
}

function buildPilotSummary(events, options = {}) {
  const now = Number(options.now) || Date.now();
  const daysValue = Number(options.days);
  const days = Number.isFinite(daysValue) && daysValue > 0 ? Math.min(3_650, Math.trunc(daysValue)) : 0;
  const fromMs = days ? now - days * 24 * 60 * 60 * 1000 : -Infinity;
  const normalized = (Array.isArray(events) ? events : [])
    .map((event) => normalizePilotEvent(event, () => now))
    .filter(Boolean)
    .filter((event) => Date.parse(event.at) >= fromMs && Date.parse(event.at) <= now + 60_000)
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const searches = normalized.filter((event) => event.type === 'search');
  const exports = normalized.filter((event) => event.type === 'excel_export');
  const successful = searches.filter((event) => ['success', 'partial'].includes(event.outcome));
  const totals = {
    searches: searches.length,
    successfulSearches: successful.length,
    partialSearches: searches.filter((event) => event.outcome === 'partial').length,
    cancelledSearches: searches.filter((event) => event.outcome === 'cancelled').length,
    failedSearches: searches.filter((event) => event.outcome === 'error').length,
    successRate: searches.length ? Math.round(successful.length * 10_000 / searches.length) / 100 : 0,
    productCount: successful.reduce((sum, event) => sum + event.productCount, 0),
    durationMs: searches.reduce((sum, event) => sum + event.durationMs, 0),
    averageDurationMs: searches.length
      ? Math.round(searches.reduce((sum, event) => sum + event.durationMs, 0) / searches.length)
      : 0,
    excelExports: exports.length,
    exportedRows: exports.reduce((sum, event) => sum + event.rowCount, 0),
    uniqueBrands: new Set(searches.flatMap((event) => event.brands.map((brand) => normalizeKey(brand.brand || brand.query))).filter(Boolean)).size,
  };
  const byStore = aggregateStores(searches, exports);
  const byBrand = aggregateBrands(searches);
  const recent = searches.slice(-30).reverse().map((event) => ({
    id: event.id,
    at: event.at,
    mode: event.mode,
    stores: event.stores,
    brands: event.brands.map((item) => item.brand || item.query).filter(Boolean),
    outcome: event.outcome,
    durationMs: event.durationMs,
    productCount: event.productCount,
    errorCode: event.errorCode,
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    period: { days, from: days ? new Date(fromMs).toISOString() : '', to: new Date(now).toISOString() },
    firstActivityAt: normalized[0]?.at || '',
    lastActivityAt: normalized.at(-1)?.at || '',
    totals,
    byStore,
    byBrand,
    recent,
    privacy: {
      localOnlyBrands: true,
      noteUa: 'Назви торгових марок зберігаються лише на цьому комп’ютері та не передаються до Owner.',
    },
  };
}

function aggregateStores(searches, exports) {
  const map = new Map();
  const ensure = (store) => {
    if (!map.has(store)) map.set(store, {
      store, searches: 0, successfulSearches: 0, failedSearches: 0, cancelledSearches: 0,
      productCount: 0, durationMs: 0, excelExports: 0, exportedRows: 0,
    });
    return map.get(store);
  };
  for (const event of searches) {
    for (const store of event.stores) {
      const row = ensure(store);
      row.searches += 1;
      if (['success', 'partial'].includes(event.outcome)) row.successfulSearches += 1;
      if (event.outcome === 'error') row.failedSearches += 1;
      if (event.outcome === 'cancelled') row.cancelledSearches += 1;
      row.productCount += event.stores.length === 1 ? event.productCount : 0;
      row.durationMs += event.durationMs;
    }
  }
  for (const event of exports) {
    for (const store of event.stores) {
      const row = ensure(store);
      row.excelExports += 1;
      row.exportedRows += event.stores.length === 1 ? event.rowCount : 0;
    }
  }
  return [...map.values()].sort((left, right) => right.searches - left.searches || left.store.localeCompare(right.store));
}

function aggregateBrands(searches) {
  const map = new Map();
  for (const event of searches) {
    for (const item of event.brands) {
      const label = item.brand || item.query;
      const key = normalizeKey(label);
      if (!key) continue;
      if (!map.has(key)) map.set(key, {
        brand: label, searches: 0, successfulSearches: 0, productCount: 0, lastSearchAt: '', stores: new Set(),
      });
      const row = map.get(key);
      row.searches += 1;
      const itemOutcome = item.outcome || event.outcome;
      if (['success', 'partial'].includes(itemOutcome)) row.successfulSearches += 1;
      row.productCount += item.productCount;
      row.lastSearchAt = event.at;
      event.stores.forEach((store) => row.stores.add(store));
    }
  }
  return [...map.values()]
    .map((row) => ({ ...row, stores: [...row.stores] }))
    .sort((left, right) => right.searches - left.searches || right.productCount - left.productCount || left.brand.localeCompare(right.brand, 'uk'));
}

function clean(value, limit) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function cleanCode(value, limit) {
  return clean(value, limit).toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeKey(value) {
  return clean(value, 160).normalize('NFKC').toLocaleLowerCase('uk-UA');
}

function clampInteger(value, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(maximum, Math.trunc(number))) : 0;
}

function safeDate(value, fallback) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

module.exports = {
  PilotStatisticsStore,
  buildPilotSummary,
  normalizePilotEvent,
};
