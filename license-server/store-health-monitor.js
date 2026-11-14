const fs = require('fs');
const path = require('path');

const STORE_ORDER = Object.freeze(['eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka']);
const STORE_LABELS = Object.freeze({
  eva: 'EVA', varus: 'VARUS', makeup: 'MAKEUP', aurora: 'Аврора', notino: 'Notino', rozetka: 'Rozetka',
});
const DEFAULT_STORE_PROBES = Object.freeze({
  eva: Object.freeze(['Nivea', "L'Oréal Paris", 'Maybelline New York']),
  varus: Object.freeze(['Coca-Cola', 'Nivea', 'Ariel']),
  makeup: Object.freeze(['Nivea', 'Maybelline New York', 'Lipss']),
  aurora: Object.freeze(['Colgate', 'Nivea', 'Lamel']),
  notino: Object.freeze(['Revolution', 'Nivea', 'Maybelline New York']),
  rozetka: Object.freeze(['Xiaomi', 'Philips', 'Samsung']),
});
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

class StoreHealthMonitor {
  constructor({ stateFile, checkStore, now = () => Date.now(), intervalMs = DEFAULT_INTERVAL_MS, onUpdate = () => {} }) {
    if (!stateFile || typeof checkStore !== 'function') throw new Error('store_health_configuration_invalid');
    this.stateFile = stateFile;
    this.checkStore = checkStore;
    this.now = now;
    this.intervalMs = intervalMs;
    this.onUpdate = onUpdate;
    this.running = false;
    this.state = this.readState();
  }

  readState() {
    for (const candidate of [this.stateFile, `${this.stateFile}.bak`]) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        return normalizeState(parsed);
      } catch (_error) {
        // Пробуємо резервну копію або чистий стан.
      }
    }
    return normalizeState({});
  }

  snapshot() {
    const lastFinishedAt = Date.parse(this.state.lastFinishedAt || '') || 0;
    return {
      ...this.state,
      running: this.running,
      due: this.state.enabled && (!lastFinishedAt || this.now() - lastFinishedAt >= this.intervalMs),
      nextRunAt: this.state.enabled && lastFinishedAt
        ? new Date(lastFinishedAt + this.intervalMs).toISOString()
        : '',
    };
  }

  setEnabled(enabled) {
    this.state.enabled = Boolean(enabled);
    this.writeState();
    this.emit();
    return this.snapshot();
  }

  async runIfDue() {
    if (!this.snapshot().due || this.running) return this.snapshot();
    return this.run();
  }

  async run() {
    if (this.running) return this.snapshot();
    this.running = true;
    this.state.lastStartedAt = new Date(this.now()).toISOString();
    this.emit();

    const results = [];
    for (const store of STORE_ORDER) {
      const probes = DEFAULT_STORE_PROBES[store];
      const startedAt = this.now();
      const attempts = [];
      let successful = null;

      for (let index = 0; index < probes.length; index += 1) {
        const query = probes[index];
        this.emit({ currentStore: store, currentQuery: query, attempt: index + 1 });
        try {
          const result = await this.checkStore({ store, query, attempt: index + 1 });
          const productCount = Math.max(0, Number(result?.productCount || result?.products?.length || 0));
          attempts.push({ query, ok: productCount > 0, productCount, errorCode: productCount > 0 ? '' : 'no_products' });
          if (productCount > 0) {
            successful = { query, attempt: index + 1, productCount };
            break;
          }
        } catch (error) {
          attempts.push({ query, ok: false, productCount: 0, errorCode: safeErrorCode(error) });
        }
      }

      results.push({
        store,
        storeLabel: STORE_LABELS[store],
        status: successful ? 'ok' : 'error',
        checkedAt: new Date(this.now()).toISOString(),
        durationMs: Math.max(0, this.now() - startedAt),
        successfulQuery: successful?.query || '',
        successfulAttempt: successful?.attempt || 0,
        productCount: successful?.productCount || 0,
        attempts,
      });
      this.state.results = [...results];
      this.writeState();
      this.emit();
    }

    this.running = false;
    this.state.lastFinishedAt = new Date(this.now()).toISOString();
    this.state.results = results;
    this.writeState();
    this.emit();
    return this.snapshot();
  }

  emit(extra = {}) {
    this.onUpdate({ ...this.snapshot(), ...extra });
  }

  writeState() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const temporary = `${this.stateFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), 'utf8');
    if (fs.existsSync(this.stateFile)) fs.copyFileSync(this.stateFile, `${this.stateFile}.bak`);
    fs.rmSync(this.stateFile, { force: true });
    fs.renameSync(temporary, this.stateFile);
  }
}

function normalizeState(value = {}) {
  return {
    version: 1,
    enabled: value.enabled !== false,
    lastStartedAt: safeIso(value.lastStartedAt),
    lastFinishedAt: safeIso(value.lastFinishedAt),
    results: Array.isArray(value.results)
      ? value.results.filter((item) => STORE_ORDER.includes(item?.store)).slice(0, STORE_ORDER.length)
      : [],
  };
}

function safeIso(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function safeErrorCode(error) {
  const code = String(error?.code || '').trim().toLocaleLowerCase();
  if (/^[a-z0-9_]{2,48}$/.test(code)) return code;
  const message = String(error?.message || error || '').toLocaleLowerCase();
  if (/cancel/.test(message)) return 'cancelled';
  if (/timeout|timed out|час очікування/.test(message)) return 'timeout';
  if (/notino.*доступ|checking your browser|just a moment|один момент/.test(message)) return 'access_check';
  if (/товар.*не знайден|no_products/.test(message)) return 'no_products';
  if (/catalog|каталог|довідник/.test(message)) return 'catalog_unavailable';
  if (/net::|network|мереж/.test(message)) return 'network_error';
  return 'unknown_error';
}

module.exports = {
  StoreHealthMonitor,
  STORE_ORDER,
  STORE_LABELS,
  DEFAULT_STORE_PROBES,
  DEFAULT_INTERVAL_MS,
  safeErrorCode,
};
