const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
const ENCRYPTED_PREFIX = Buffer.from('PMDEMO1\0', 'utf8');

const DEFAULT_LIMITS = Object.freeze({
  days: 14,
  searches: 20,
  brandsPerSearch: 3,
  resultsPerSearch: 1000,
});

class DemoAccessStore {
  constructor({
    edition = 'full',
    filePath = '',
    safeStorage = null,
    now = () => Date.now(),
    limits = {},
  } = {}) {
    this.edition = edition === 'demo' ? 'demo' : 'full';
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.now = now;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.sessions = new Map();
    this.state = null;
    this.stateError = false;
  }

  getStatus() {
    if (this.edition !== 'demo') return fullStatus();
    this.ensureState();
    if (this.stateError || !this.state) return this.lockedStatus('state_error');

    const now = Math.max(this.nowMs(), Date.parse(this.state.lastSeenAt));
    const previousSeen = Date.parse(this.state.lastSeenAt);
    if (now > previousSeen) {
      this.state.lastSeenAt = new Date(now).toISOString();
      this.writeState();
    }

    const expiresAtMs = Date.parse(this.state.firstStartedAt) + this.limits.days * DAY_MS;
    const daysRemaining = Math.max(0, Math.ceil((expiresAtMs - now) / DAY_MS));
    const searchesRemaining = Math.max(0, this.limits.searches - this.state.usedSearches);
    const blockedReason = daysRemaining <= 0
      ? 'time_expired'
      : searchesRemaining <= 0 ? 'search_limit' : '';

    return {
      edition: 'demo',
      isDemo: true,
      allowed: !blockedReason,
      blockedReason,
      firstStartedAt: this.state.firstStartedAt,
      expiresAt: new Date(expiresAtMs).toISOString(),
      daysRemaining,
      searchesUsed: this.state.usedSearches,
      searchesRemaining,
      maxSearches: this.limits.searches,
      maxBrands: this.limits.brandsPerSearch,
      maxResults: this.limits.resultsPerSearch,
    };
  }

  beginSearch({ brandCount } = {}) {
    const status = this.getStatus();
    if (!status.isDemo) return { allowed: true, token: '', status };

    const normalizedBrandCount = Math.max(0, Math.trunc(Number(brandCount) || 0));
    if (!status.allowed) return { allowed: false, token: '', reason: status.blockedReason, status };
    if (!normalizedBrandCount || normalizedBrandCount > this.limits.brandsPerSearch) {
      return { allowed: false, token: '', reason: 'brand_limit', status };
    }

    const token = randomUUID();
    this.sessions.set(token, {
      brandCount: normalizedBrandCount,
      parseCalls: 0,
      deliveredRows: 0,
    });
    return { allowed: true, token, status };
  }

  authorizeParse(token) {
    if (this.edition !== 'demo') return { allowed: true };
    const session = this.sessions.get(String(token || ''));
    if (!session) return { allowed: false, reason: 'invalid_session' };
    if (session.parseCalls >= session.brandCount) return { allowed: false, reason: 'brand_limit' };
    session.parseCalls += 1;
    return { allowed: true };
  }

  limitParseResult(token, result) {
    if (this.edition !== 'demo') return result;
    const session = this.sessions.get(String(token || ''));
    if (!session) throw new Error('Демонстраційний пошук не підтверджено. Почніть пошук ще раз.');
    const products = Array.isArray(result?.products) ? result.products : [];
    const remaining = Math.max(0, this.limits.resultsPerSearch - session.deliveredRows);
    const limitedProducts = products.slice(0, remaining);
    session.deliveredRows += limitedProducts.length;
    return {
      ...result,
      products: limitedProducts,
      demoLimitReached: products.length > limitedProducts.length || session.deliveredRows >= this.limits.resultsPerSearch,
    };
  }

  finishSearch(token) {
    if (this.edition !== 'demo') return { counted: false, status: fullStatus() };
    const session = this.sessions.get(String(token || ''));
    if (!session) return { counted: false, status: this.getStatus() };
    this.sessions.delete(String(token || ''));

    const counted = session.deliveredRows > 0;
    if (counted) {
      this.ensureState();
      if (!this.stateError && this.state) {
        this.state.usedSearches = Math.min(this.limits.searches, this.state.usedSearches + 1);
        this.state.lastSeenAt = new Date(Math.max(this.nowMs(), Date.parse(this.state.lastSeenAt))).toISOString();
        this.writeState();
      }
    }
    return { counted, deliveredRows: session.deliveredRows, status: this.getStatus() };
  }

  ensureState() {
    if (this.edition !== 'demo' || this.state || this.stateError) return;
    if (!this.filePath) {
      this.stateError = true;
      return;
    }
    try {
      if (fs.existsSync(this.filePath)) {
        const loaded = this.decodeState(fs.readFileSync(this.filePath));
        if (!isValidState(loaded)) throw new Error('Invalid demo state');
        this.state = loaded;
        return;
      }
      const now = new Date(this.nowMs()).toISOString();
      this.state = {
        schemaVersion: 1,
        installationId: randomUUID(),
        firstStartedAt: now,
        lastSeenAt: now,
        usedSearches: 0,
      };
      this.writeState();
    } catch (_error) {
      this.state = null;
      this.stateError = true;
    }
  }

  writeState() {
    if (!this.state || !this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const text = JSON.stringify(this.state);
    let contents = Buffer.from(text, 'utf8');
    if (this.canEncrypt()) {
      contents = Buffer.concat([ENCRYPTED_PREFIX, this.safeStorage.encryptString(text)]);
    }
    fs.writeFileSync(this.filePath, contents);
  }

  decodeState(contents) {
    if (contents.subarray(0, ENCRYPTED_PREFIX.length).equals(ENCRYPTED_PREFIX)) {
      if (!this.canEncrypt()) throw new Error('Demo state encryption is unavailable');
      return JSON.parse(this.safeStorage.decryptString(contents.subarray(ENCRYPTED_PREFIX.length)));
    }
    return JSON.parse(contents.toString('utf8'));
  }

  canEncrypt() {
    return Boolean(
      this.safeStorage
      && typeof this.safeStorage.isEncryptionAvailable === 'function'
      && this.safeStorage.isEncryptionAvailable()
      && typeof this.safeStorage.encryptString === 'function'
      && typeof this.safeStorage.decryptString === 'function'
    );
  }

  nowMs() {
    const value = Number(this.now());
    return Number.isFinite(value) ? value : Date.now();
  }

  lockedStatus(reason) {
    return {
      edition: 'demo',
      isDemo: true,
      allowed: false,
      blockedReason: reason,
      firstStartedAt: '',
      expiresAt: '',
      daysRemaining: 0,
      searchesUsed: this.limits.searches,
      searchesRemaining: 0,
      maxSearches: this.limits.searches,
      maxBrands: this.limits.brandsPerSearch,
      maxResults: this.limits.resultsPerSearch,
    };
  }
}

function isValidState(value) {
  return Boolean(
    value
    && value.schemaVersion === 1
    && typeof value.installationId === 'string'
    && Number.isFinite(Date.parse(value.firstStartedAt))
    && Number.isFinite(Date.parse(value.lastSeenAt))
    && Number.isInteger(value.usedSearches)
    && value.usedSearches >= 0
  );
}

function fullStatus() {
  return {
    edition: 'full',
    isDemo: false,
    allowed: true,
    blockedReason: '',
    daysRemaining: null,
    searchesUsed: 0,
    searchesRemaining: null,
    maxSearches: null,
    maxBrands: null,
    maxResults: null,
  };
}

module.exports = { DEFAULT_LIMITS, DemoAccessStore };
