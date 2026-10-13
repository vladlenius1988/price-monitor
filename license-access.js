const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { randomUUID } = crypto;
const { getDeviceCode, getDeviceId } = require('./device-identity');

const STATE_PREFIX = Buffer.from('PMLIC1\0', 'utf8');
const DAY_MS = 24 * 60 * 60 * 1000;
const ONLINE_INTERVAL_MS = DAY_MS;
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

class LicensedAccessStore {
  constructor({
    edition = 'full',
    licensePath = '',
    bundledLicensePath = '',
    statePath = '',
    publicKeyPath = '',
    safeStorage = null,
    serverUrl = '',
    appVersion = '',
    now = () => Date.now(),
    fetchFn = globalThis.fetch,
    deviceIdProvider = getDeviceId,
  } = {}) {
    this.edition = edition === 'licensed' ? 'licensed' : 'full';
    this.licensePath = licensePath;
    this.bundledLicensePath = bundledLicensePath;
    this.statePath = statePath;
    this.publicKeyPath = publicKeyPath;
    this.safeStorage = safeStorage;
    this.serverUrl = normalizeServerUrl(serverUrl);
    this.appVersion = String(appVersion || '');
    this.now = now;
    this.fetchFn = fetchFn;
    this.deviceIdProvider = deviceIdProvider;
    this.licenseDocument = null;
    this.licenseError = '';
    this.state = null;
    this.stateError = false;
  }

  getStatus() {
    if (this.edition !== 'licensed') return fullStatus();
    this.ensureState();
    this.ensureLicense();

    if (this.stateError || !this.state) return this.lockedStatus('state_error');
    if (!this.licenseDocument) return this.lockedStatus(this.licenseError || 'license_missing');

    const payload = this.licenseDocument.payload;
    let currentDeviceId = '';
    try {
      currentDeviceId = this.deviceIdProvider();
    } catch (_error) {
      return this.lockedStatus('device_id_unavailable');
    }
    const now = this.nowMs();
    const previousSeen = Date.parse(this.state.lastSeenAt);
    const clockRolledBack = Number.isFinite(previousSeen) && now + CLOCK_TOLERANCE_MS < previousSeen;
    const effectiveNow = Math.max(now, Number.isFinite(previousSeen) ? previousSeen : now);

    if (effectiveNow > previousSeen) {
      this.state.lastSeenAt = new Date(effectiveNow).toISOString();
      this.writeState();
    }

    const notBeforeMs = Date.parse(payload.notBefore);
    const expiresAtMs = Date.parse(payload.expiresAt);
    let blockedReason = '';
    if (payload.deviceId !== currentDeviceId) blockedReason = 'device_mismatch';
    else if (clockRolledBack || effectiveNow + CLOCK_TOLERANCE_MS < notBeforeMs) blockedReason = 'clock_rollback';
    else if (payload.status === 'pending') blockedReason = 'pending_approval';
    else if (payload.status === 'suspended') blockedReason = 'suspended';
    else if (payload.status === 'revoked') blockedReason = 'revoked';
    else if (effectiveNow >= expiresAtMs) blockedReason = 'time_expired';

    return {
      edition: 'licensed',
      isDemo: false,
      isLicensed: true,
      allowed: !blockedReason,
      blockedReason,
      licenseId: payload.licenseId,
      customerName: payload.customerName,
      notBefore: payload.notBefore,
      expiresAt: payload.expiresAt,
      paidUntil: payload.paidUntil || payload.expiresAt,
      leaseExpiresAt: payload.expiresAt,
      daysRemaining: Math.max(0, Math.ceil((expiresAtMs - effectiveNow) / DAY_MS)),
      maxDevices: payload.maxDevices,
      deviceCode: getDeviceCode(currentDeviceId),
      stores: [...payload.stores],
      features: normalizeFeatures(payload.features),
      updateChannel: payload.updateChannel || 'licensed',
      onlineConfigured: Boolean(this.serverUrl),
      lastOnlineAttemptAt: this.state.lastOnlineAttemptAt || '',
      lastOnlineSuccessAt: this.state.lastOnlineSuccessAt || '',
      installationId: this.state.installationId,
      searchesUsed: 0,
      searchesRemaining: null,
      maxSearches: null,
      maxBrands: null,
      maxResults: null,
    };
  }

  beginSearch({ store = '' } = {}) {
    const status = this.getStatus();
    const storeBlocked = status.allowed && !isStoreAllowed(status, store);
    return {
      allowed: status.allowed && !storeBlocked,
      token: '',
      reason: storeBlocked ? 'store_not_allowed' : status.blockedReason,
      status,
    };
  }

  authorizeParse(_token = '', store = '') {
    const status = this.getStatus();
    const storeBlocked = status.allowed && !isStoreAllowed(status, store);
    return {
      allowed: status.allowed && !storeBlocked,
      reason: storeBlocked ? 'store_not_allowed' : status.blockedReason,
      status,
    };
  }

  limitParseResult(_token, result) {
    return result;
  }

  finishSearch() {
    return { counted: false, status: this.getStatus() };
  }

  shouldCheckOnline() {
    if (this.edition !== 'licensed' || !this.serverUrl) return false;
    this.ensureState();
    if (this.stateError || !this.state) return false;
    const lastAttempt = Date.parse(this.state.lastOnlineAttemptAt || '');
    return !Number.isFinite(lastAttempt) || this.nowMs() - lastAttempt >= ONLINE_INTERVAL_MS;
  }

  getActivationRequest() {
    if (this.edition !== 'licensed') throw new Error('license_invalid');
    this.ensureState();
    if (this.stateError || !this.state) throw new Error('state_error');
    const deviceId = this.deviceIdProvider();
    return {
      schemaVersion: 1,
      edition: 'licensed',
      deviceId,
      deviceCode: getDeviceCode(deviceId),
      installationId: this.state.installationId,
      appVersion: this.appVersion,
      generatedAt: new Date(this.nowMs()).toISOString(),
    };
  }

  async activateOnline(activationCode) {
    const before = this.getStatus();
    if (this.edition !== 'licensed' || !this.serverUrl) {
      return { checked: false, updated: false, reason: 'not_configured', status: before };
    }
    if (typeof this.fetchFn !== 'function') {
      return { checked: false, updated: false, reason: 'fetch_unavailable', status: before };
    }
    this.ensureState();
    if (this.stateError || !this.state) {
      return { checked: false, updated: false, reason: 'state_error', status: before };
    }
    const normalizedCode = String(activationCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (normalizedCode.length < 16 || normalizedCode.length > 80) {
      return { checked: false, updated: false, reason: 'activation_code_invalid', status: before };
    }

    const attemptAt = new Date(this.nowMs()).toISOString();
    this.state.lastOnlineAttemptAt = attemptAt;
    this.writeState();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const deviceId = this.deviceIdProvider();
      const response = await this.fetchFn(`${this.serverUrl}/v1/licenses/activate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          activationCode: normalizedCode,
          installationId: this.state.installationId,
          deviceId,
          deviceLabel: '',
          appVersion: this.appVersion,
          edition: 'licensed',
        }),
        signal: controller.signal,
      });
      const body = await safeJson(response);
      if (!response?.ok) {
        return { checked: true, updated: false, reason: normalizeServerError(body?.error), status: this.getStatus() };
      }
      const installed = this.installLicenseDocument(body?.license || body, { requireUsable: false });
      if (!installed.updated) return { checked: true, ...installed };
      this.state.lastOnlineSuccessAt = new Date(this.nowMs()).toISOString();
      this.writeState();
      const status = this.getStatus();
      return { checked: true, updated: true, reason: status.blockedReason || '', status };
    } catch (_error) {
      return { checked: true, updated: false, reason: 'server_unavailable', status: this.getStatus() };
    } finally {
      clearTimeout(timeout);
    }
  }

  async refreshOnline() {
    const before = this.getStatus();
    if (this.edition !== 'licensed' || !this.serverUrl) {
      return { checked: false, updated: false, reason: 'not_configured', status: before };
    }
    if (typeof this.fetchFn !== 'function') {
      return { checked: false, updated: false, reason: 'fetch_unavailable', status: before };
    }

    this.ensureState();
    this.ensureLicense();
    if (this.stateError || !this.state || !this.licenseDocument) {
      return { checked: false, updated: false, reason: before.blockedReason || 'license_invalid', status: before };
    }

    const attemptAt = new Date(this.nowMs()).toISOString();
    this.state.lastOnlineAttemptAt = attemptAt;
    this.writeState();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetchFn(`${this.serverUrl}/v1/licenses/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          licenseId: this.licenseDocument.payload.licenseId,
          installationId: this.state.installationId,
          deviceId: this.deviceIdProvider(),
          appVersion: this.appVersion,
          edition: 'licensed',
        }),
        signal: controller.signal,
      });
      const body = await safeJson(response);
      if (!response?.ok) {
        return { checked: true, updated: false, reason: normalizeServerError(body?.error), status: this.getStatus() };
      }
      const candidate = body?.license || body;
      const validation = validateSignedLicense(candidate, this.readPublicKey());
      if (!validation.valid) throw new Error(validation.reason);
      if (validation.document.payload.licenseId !== this.licenseDocument.payload.licenseId) {
        throw new Error('license_id_mismatch');
      }
      if (validation.document.payload.deviceId !== this.deviceIdProvider()) {
        throw new Error('device_mismatch');
      }

      this.writeLicense(validation.document);
      this.licenseDocument = validation.document;
      this.licenseError = '';
      this.state.lastOnlineSuccessAt = new Date(this.nowMs()).toISOString();
      this.writeState();
      return { checked: true, updated: true, reason: '', status: this.getStatus() };
    } catch (_error) {
      return { checked: true, updated: false, reason: 'server_unavailable', status: this.getStatus() };
    } finally {
      clearTimeout(timeout);
    }
  }

  async checkForUpdate() {
    const status = this.getStatus();
    if (!status.allowed || !this.serverUrl || !this.licenseDocument) {
      return { checked: false, update: null, reason: status.blockedReason || 'not_configured' };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetchFn(`${this.serverUrl}/v1/updates/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          licenseId: status.licenseId,
          deviceId: this.deviceIdProvider(),
          currentVersion: this.appVersion,
          channel: status.updateChannel || 'licensed',
        }),
        signal: controller.signal,
      });
      const body = await safeJson(response);
      if (!response?.ok) return { checked: true, update: null, reason: normalizeServerError(body?.error) };
      if (!body?.update) return { checked: true, update: null, reason: '' };
      const validation = validateSignedUpdate(body.update, this.readPublicKey());
      if (!validation.valid) return { checked: true, update: null, reason: validation.reason };
      if (validation.document.payload.channel !== (status.updateChannel || 'licensed')) {
        return { checked: true, update: null, reason: 'update_channel_invalid' };
      }
      return { checked: true, update: validation.document, reason: '' };
    } catch (_error) {
      return { checked: true, update: null, reason: 'server_unavailable' };
    } finally {
      clearTimeout(timeout);
    }
  }

  resolveServerPath(relativePath) {
    if (!this.serverUrl || !/^\/v1\/updates\/download\/rel_[a-f0-9]+$/i.test(String(relativePath || ''))) return '';
    return `${this.serverUrl}${relativePath}`;
  }

  ensureLicense() {
    if (this.edition !== 'licensed' || this.licenseDocument || this.licenseError) return;
    try {
      if (!this.licensePath) throw new Error('license_missing');
      if (fs.existsSync(this.licensePath)) {
        try {
          const candidate = JSON.parse(fs.readFileSync(this.licensePath, 'utf8'));
          const validation = validateSignedLicense(candidate, this.readPublicKey());
          if (validation.valid) {
            this.licenseDocument = validation.document;
            return;
          }
        } catch (_error) {
          // Пошкоджену або стару локальну ліцензію замінює підписана ліцензія зі збірки.
        }
      }
      this.installBundledLicense();
      if (!this.licenseDocument) throw new Error('license_missing');
    } catch (error) {
      this.licenseDocument = null;
      this.licenseError = normalizeLicenseError(error?.message);
    }
  }

  installBundledLicense() {
    if (!this.bundledLicensePath || !fs.existsSync(this.bundledLicensePath)) return;
    const candidate = JSON.parse(fs.readFileSync(this.bundledLicensePath, 'utf8'));
    const validation = validateSignedLicense(candidate, this.readPublicKey());
    if (!validation.valid) throw new Error(validation.reason);
    this.writeLicense(validation.document);
    this.licenseDocument = validation.document;
  }

  installLicenseDocument(candidate, { requireUsable = true } = {}) {
    try {
      const validation = validateSignedLicense(candidate, this.readPublicKey());
      if (!validation.valid) throw new Error(validation.reason);
      const deviceId = this.deviceIdProvider();
      const payload = validation.document.payload;
      if (payload.deviceId !== deviceId) throw new Error('device_mismatch');
      if (requireUsable && payload.status === 'revoked') throw new Error('revoked');
      if (requireUsable && Date.parse(payload.expiresAt) <= this.nowMs()) throw new Error('time_expired');
      this.writeLicense(validation.document);
      this.licenseDocument = validation.document;
      this.licenseError = '';
      return { updated: true, reason: '', status: this.getStatus() };
    } catch (error) {
      return { updated: false, reason: normalizeInstallError(error?.message), status: this.getStatus() };
    }
  }

  writeLicense(document) {
    if (!this.licensePath) throw new Error('license_missing');
    fs.mkdirSync(path.dirname(this.licensePath), { recursive: true });
    const temporaryPath = `${this.licensePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    fs.copyFileSync(temporaryPath, this.licensePath);
    fs.rmSync(temporaryPath, { force: true });
  }

  readPublicKey() {
    if (!this.publicKeyPath || !fs.existsSync(this.publicKeyPath)) throw new Error('public_key_missing');
    return fs.readFileSync(this.publicKeyPath, 'utf8');
  }

  ensureState() {
    if (this.edition !== 'licensed' || this.state || this.stateError) return;
    if (!this.statePath) {
      this.stateError = true;
      return;
    }
    try {
      if (fs.existsSync(this.statePath)) {
        const loaded = this.decodeState(fs.readFileSync(this.statePath));
        if (!isValidState(loaded)) throw new Error('invalid_state');
        this.state = loaded;
        return;
      }
      const now = new Date(this.nowMs()).toISOString();
      this.state = {
        schemaVersion: 1,
        installationId: randomUUID(),
        firstStartedAt: now,
        lastSeenAt: now,
        lastOnlineAttemptAt: '',
        lastOnlineSuccessAt: '',
      };
      this.writeState();
    } catch (_error) {
      this.state = null;
      this.stateError = true;
    }
  }

  writeState() {
    if (!this.state || !this.statePath) return;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const text = JSON.stringify(this.state);
    let contents = Buffer.from(text, 'utf8');
    if (this.canEncrypt()) contents = Buffer.concat([STATE_PREFIX, this.safeStorage.encryptString(text)]);
    fs.writeFileSync(this.statePath, contents);
  }

  decodeState(contents) {
    if (contents.subarray(0, STATE_PREFIX.length).equals(STATE_PREFIX)) {
      if (!this.canEncrypt()) throw new Error('state_encryption_unavailable');
      return JSON.parse(this.safeStorage.decryptString(contents.subarray(STATE_PREFIX.length)));
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
      edition: 'licensed',
      isDemo: false,
      isLicensed: true,
      allowed: false,
      blockedReason: reason,
      licenseId: this.licenseDocument?.payload?.licenseId || '',
      customerName: this.licenseDocument?.payload?.customerName || '',
      notBefore: this.licenseDocument?.payload?.notBefore || '',
      expiresAt: this.licenseDocument?.payload?.expiresAt || '',
      paidUntil: this.licenseDocument?.payload?.paidUntil || this.licenseDocument?.payload?.expiresAt || '',
      leaseExpiresAt: this.licenseDocument?.payload?.expiresAt || '',
      daysRemaining: 0,
      maxDevices: this.licenseDocument?.payload?.maxDevices || 0,
      stores: [...(this.licenseDocument?.payload?.stores || [])],
      features: normalizeFeatures(this.licenseDocument?.payload?.features),
      updateChannel: this.licenseDocument?.payload?.updateChannel || 'licensed',
      onlineConfigured: Boolean(this.serverUrl),
      lastOnlineAttemptAt: this.state?.lastOnlineAttemptAt || '',
      lastOnlineSuccessAt: this.state?.lastOnlineSuccessAt || '',
      installationId: this.state?.installationId || '',
      deviceCode: safeDeviceCode(this.deviceIdProvider),
      searchesUsed: 0,
      searchesRemaining: null,
      maxSearches: null,
      maxBrands: null,
      maxResults: null,
    };
  }
}

function validateSignedLicense(candidate, publicKey) {
  try {
    if (!candidate || typeof candidate !== 'object') throw new Error('license_invalid');
    const payload = candidate.payload;
    const signature = String(candidate.signature || '');
    if (!isValidPayload(payload) || !signature) throw new Error('license_invalid');
    const verified = crypto.verify(
      null,
      Buffer.from(stableStringify(payload), 'utf8'),
      publicKey,
      Buffer.from(signature, 'base64'),
    );
    if (!verified) throw new Error('signature_invalid');
    return { valid: true, reason: '', document: { payload, signature } };
  } catch (error) {
    return { valid: false, reason: normalizeLicenseError(error?.message), document: null };
  }
}

function validateSignedUpdate(candidate, publicKey) {
  try {
    if (!candidate || typeof candidate !== 'object') throw new Error('update_invalid');
    const payload = candidate.payload;
    const signature = String(candidate.signature || '');
    if (!isValidUpdatePayload(payload) || !signature) throw new Error('update_invalid');
    const verified = crypto.verify(null, Buffer.from(stableStringify(payload), 'utf8'), publicKey, Buffer.from(signature, 'base64'));
    if (!verified) throw new Error('signature_invalid');
    return { valid: true, reason: '', document: { payload, signature } };
  } catch (error) {
    const reason = error?.message === 'signature_invalid' ? 'signature_invalid' : 'update_invalid';
    return { valid: false, reason, document: null };
  }
}

function isValidPayload(payload) {
  const stores = Array.isArray(payload?.stores) ? payload.stores : [];
  const notBefore = Date.parse(payload?.notBefore);
  const expiresAt = Date.parse(payload?.expiresAt);
  return Boolean(
    payload
    && payload.schemaVersion === 1
    && payload.edition === 'licensed'
    && typeof payload.licenseId === 'string'
    && payload.licenseId.length >= 8
    && typeof payload.customerName === 'string'
    && payload.customerName.trim()
    && Number.isFinite(notBefore)
    && Number.isFinite(expiresAt)
    && expiresAt > notBefore
    && Number.isInteger(payload.maxDevices)
    && payload.maxDevices >= 1
    && typeof payload.deviceId === 'string'
    && /^[a-f0-9]{64}$/i.test(payload.deviceId)
    && stores.length > 0
    && stores.every((store) => typeof store === 'string' && store.length > 0)
    && ['', 'pending', 'active', 'suspended', 'revoked'].includes(String(payload.status || ''))
  );
}

function isValidUpdatePayload(payload) {
  return Boolean(
    payload
    && payload.schemaVersion === 1
    && payload.kind === 'price-monitor-update'
    && /^rel_[a-f0-9]+$/i.test(String(payload.releaseId || ''))
    && /^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(String(payload.version || ''))
    && /^[a-z0-9_-]{1,40}$/.test(String(payload.channel || ''))
    && /^[a-f0-9]{64}$/i.test(String(payload.sha256 || ''))
    && Number.isInteger(payload.size)
    && payload.size > 0
    && /^\/v1\/updates\/download\/rel_[a-f0-9]+$/i.test(String(payload.downloadPath || ''))
    && Number.isFinite(Date.parse(payload.publishedAt))
  );
}

function isValidState(value) {
  return Boolean(
    value
    && value.schemaVersion === 1
    && typeof value.installationId === 'string'
    && value.installationId.length >= 8
    && Number.isFinite(Date.parse(value.firstStartedAt))
    && Number.isFinite(Date.parse(value.lastSeenAt))
    && typeof value.lastOnlineAttemptAt === 'string'
    && typeof value.lastOnlineSuccessAt === 'string'
  );
}

function normalizeServerUrl(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  if (/^https:\/\//i.test(normalized)) return normalized;
  if (/^http:\/\/(127\.0\.0\.1|localhost|(?:\d{1,3}\.){3}\d{1,3})(:\d+)?$/i.test(normalized)) return normalized;
  return '';
}

function normalizeLicenseError(value) {
  const known = new Set([
    'license_missing',
    'license_invalid',
    'signature_invalid',
    'public_key_missing',
  ]);
  return known.has(String(value || '')) ? String(value) : 'license_invalid';
}

function normalizeInstallError(value) {
  const known = new Set([
    'license_missing',
    'license_invalid',
    'signature_invalid',
    'public_key_missing',
    'device_mismatch',
    'device_id_unavailable',
    'time_expired',
    'revoked',
    'pending_approval',
    'suspended',
    'state_error',
  ]);
  return known.has(String(value || '')) ? String(value) : 'license_invalid';
}

function normalizeServerError(value) {
  const known = new Set([
    'activation_code_invalid',
    'device_limit',
    'device_blocked',
    'device_not_activated',
    'license_blocked',
    'license_not_found',
    'payment_required',
    'server_unavailable',
    'rate_limited',
    'update_channel_invalid',
  ]);
  return known.has(String(value || '')) ? String(value) : 'server_unavailable';
}

function normalizeFeatures(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

async function safeJson(response) {
  try {
    return await response?.json();
  } catch (_error) {
    return {};
  }
}

function safeDeviceCode(provider) {
  try {
    return getDeviceCode(provider());
  } catch (_error) {
    return '';
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fullStatus() {
  return {
    edition: 'full',
    isDemo: false,
    isLicensed: false,
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

function isStoreAllowed(status, store) {
  const requested = String(store || '').trim().toLowerCase();
  if (!requested) return true;
  return Array.isArray(status?.stores) && status.stores.includes(requested);
}

module.exports = {
  CLOCK_TOLERANCE_MS,
  LicensedAccessStore,
  stableStringify,
  validateSignedLicense,
  validateSignedUpdate,
};
