const ALL_STORES = ['eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka'];
const DAY_MS = 24 * 60 * 60 * 1000;

class LicenseServiceError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

class LicenseService {
  constructor({ store, hashActivationCode, signLicense, now = () => Date.now() } = {}) {
    if (!store) throw new Error('store_required');
    if (typeof hashActivationCode !== 'function') throw new Error('activation_hasher_required');
    if (typeof signLicense !== 'function') throw new Error('license_signer_required');
    this.store = store;
    this.hashActivationCode = hashActivationCode;
    this.signLicense = signLicense;
    this.now = now;
  }

  async activate(request = {}, context = {}) {
    const activationCode = normalizeActivationCode(request.activationCode);
    const deviceId = normalizeDeviceId(request.deviceId);
    const installationId = normalizeInstallationId(request.installationId);
    if (!activationCode) throw new LicenseServiceError('activation_code_invalid');
    if (!deviceId) throw new LicenseServiceError('device_id_invalid');
    if (!installationId) throw new LicenseServiceError('installation_id_invalid');

    const activationHash = await this.hashActivationCode(activationCode);
    const license = await this.store.findLicenseByActivationHash(activationHash);
    if (!license) {
      await this.safeEvent('activation_rejected', null, deviceId, context, { reason: 'activation_code_invalid' });
      throw new LicenseServiceError('activation_code_invalid', 404);
    }

    this.assertPaid(license);
    let device = await this.store.findDevice(license.id, deviceId);
    if (device?.status === 'blocked') throw new LicenseServiceError('device_blocked', 403);

    if (!device) {
      const devices = await this.store.listDevices(license.id);
      const occupied = devices.filter((item) => item.status !== 'removed').length;
      if (occupied >= license.maxDevices) {
        await this.safeEvent('activation_rejected', license.id, deviceId, context, { reason: 'device_limit' });
        throw new LicenseServiceError('device_limit', 409);
      }
      device = await this.store.upsertDevice({
        licenseId: license.id,
        deviceId,
        installationId,
        label: normalizeLabel(request.deviceLabel),
        status: 'active',
        appVersion: normalizeVersion(request.appVersion),
        firstSeenAt: this.isoNow(),
        lastSeenAt: this.isoNow(),
      });
    } else {
      device = await this.store.upsertDevice({
        ...device,
        installationId,
        label: normalizeLabel(request.deviceLabel) || device.label,
        status: 'active',
        appVersion: normalizeVersion(request.appVersion),
        lastSeenAt: this.isoNow(),
      });
    }

    const document = await this.issueDocument(license, deviceId);
    await this.safeEvent(license.status === 'pending' ? 'activation_pending' : 'activated', license.id, deviceId, context, { installationId });
    return { license: document, policy: publicPolicy(license) };
  }

  async check(request = {}, context = {}) {
    const licenseId = String(request.licenseId || '').trim();
    const deviceId = normalizeDeviceId(request.deviceId);
    const installationId = normalizeInstallationId(request.installationId);
    if (!licenseId) throw new LicenseServiceError('license_id_invalid');
    if (!deviceId) throw new LicenseServiceError('device_id_invalid');
    if (!installationId) throw new LicenseServiceError('installation_id_invalid');

    const license = await this.store.findLicenseById(licenseId);
    if (!license) throw new LicenseServiceError('license_not_found', 404);
    const device = await this.store.findDevice(license.id, deviceId);
    if (!device || device.status === 'removed') throw new LicenseServiceError('device_not_activated', 403);
    if (device.status === 'blocked') throw new LicenseServiceError('device_blocked', 403);

    if (license.status !== 'active') {
      const document = await this.issueDocument(license, deviceId);
      await this.safeEvent('license_blocked', license.id, deviceId, context, { status: license.status });
      return { license: document, policy: publicPolicy(license) };
    }

    this.assertPaid(license);
    await this.store.upsertDevice({
      ...device,
      installationId,
      appVersion: normalizeVersion(request.appVersion),
      lastSeenAt: this.isoNow(),
    });
    const document = await this.issueDocument(license, deviceId);
    await this.safeEvent('checked', license.id, deviceId, context, { installationId });
    return { license: document, policy: publicPolicy(license) };
  }

  async issueDocument(license, deviceId) {
    const nowMs = this.nowMs();
    const paidUntilMs = Date.parse(license.paidUntil);
    const leaseDays = normalizePositiveInteger(license.leaseDays, 14, 1, 90);
    const leaseEndMs = Math.min(paidUntilMs, nowMs + leaseDays * DAY_MS);
    const documentStatus = ['active', 'pending', 'suspended', 'revoked'].includes(license.status)
      ? license.status
      : 'revoked';
    const blocked = documentStatus !== 'active';
    const expiresAtMs = blocked ? Math.max(nowMs + 60 * 60 * 1000, leaseEndMs) : leaseEndMs;
    const payload = {
      schemaVersion: 1,
      licenseId: license.id,
      customerName: license.customerName,
      edition: 'licensed',
      status: documentStatus,
      issuedAt: new Date(nowMs).toISOString(),
      notBefore: new Date(nowMs - 5 * 60 * 1000).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      paidUntil: new Date(paidUntilMs).toISOString(),
      maxDevices: license.maxDevices,
      deviceId,
      stores: [...license.stores],
      features: { ...license.features },
      updateChannel: license.updateChannel,
      serverManaged: true,
    };
    return this.signLicense(payload);
  }

  assertPayable(license) {
    if (license.status !== 'active') throw new LicenseServiceError('license_blocked', 403);
    this.assertPaid(license);
  }

  assertPaid(license) {
    if (!Number.isFinite(Date.parse(license.paidUntil)) || Date.parse(license.paidUntil) <= this.nowMs()) {
      throw new LicenseServiceError('payment_required', 402);
    }
  }

  async safeEvent(type, licenseId, deviceId, context, details) {
    try {
      await this.store.appendEvent({
        type,
        licenseId: licenseId || '',
        deviceId: deviceId || '',
        occurredAt: this.isoNow(),
        ip: String(context?.ip || '').slice(0, 100),
        details: details || {},
      });
    } catch (_error) {
      // Журнал не повинен блокувати активацію або перевірку ліцензії.
    }
  }

  nowMs() {
    const value = Number(this.now());
    return Number.isFinite(value) ? value : Date.now();
  }

  isoNow() {
    return new Date(this.nowMs()).toISOString();
  }
}

function normalizeLicenseInput(input = {}, nowMs = Date.now()) {
  const customerName = String(input.customerName || '').trim();
  if (!customerName) throw new LicenseServiceError('customer_name_required');
  const paidUntil = new Date(input.paidUntil || 0);
  if (!Number.isFinite(paidUntil.getTime()) || paidUntil.getTime() <= nowMs) {
    throw new LicenseServiceError('paid_until_invalid');
  }
  const stores = normalizeStores(input.stores);
  return {
    customerName,
    paidUntil: paidUntil.toISOString(),
    status: normalizeLicenseStatus(input.status),
    maxDevices: normalizePositiveInteger(input.maxDevices, 1, 1, 10000),
    leaseDays: normalizePositiveInteger(input.leaseDays, 14, 1, 90),
    stores,
    features: normalizeFeatures(input.features),
    updateChannel: normalizeChannel(input.updateChannel),
  };
}

function normalizeLicensePatch(input = {}, current = {}, nowMs = Date.now()) {
  const merged = {
    customerName: input.customerName ?? current.customerName,
    paidUntil: input.paidUntil ?? current.paidUntil,
    status: input.status ?? current.status,
    maxDevices: input.maxDevices ?? current.maxDevices,
    leaseDays: input.leaseDays ?? current.leaseDays,
    stores: input.stores ?? current.stores,
    features: input.features ?? current.features,
    updateChannel: input.updateChannel ?? current.updateChannel,
  };
  const normalized = normalizeLicenseInput(merged, current.paidUntil === merged.paidUntil ? 0 : nowMs);
  if (input.paidUntil === undefined) normalized.paidUntil = current.paidUntil;
  return normalized;
}

function publicPolicy(license) {
  return {
    paidUntil: license.paidUntil,
    maxDevices: license.maxDevices,
    leaseDays: license.leaseDays,
    stores: [...license.stores],
    features: { ...license.features },
    updateChannel: license.updateChannel,
  };
}

function normalizeActivationCode(value) {
  const normalized = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized.length >= 16 && normalized.length <= 80 ? normalized : '';
}

function normalizeDeviceId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function normalizeInstallationId(value) {
  const normalized = String(value || '').trim();
  return normalized.length >= 8 && normalized.length <= 200 ? normalized : '';
}

function normalizeLabel(value) {
  return String(value || '').trim().slice(0, 120);
}

function normalizeVersion(value) {
  return String(value || '').trim().slice(0, 40);
}

function normalizeStores(value) {
  const requested = Array.isArray(value) ? value : ALL_STORES;
  const stores = [...new Set(requested.map((item) => String(item || '').trim().toLowerCase()))]
    .filter((item) => ALL_STORES.includes(item));
  if (!stores.length) throw new LicenseServiceError('stores_required');
  return stores;
}

function normalizeFeatures(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { all: true };
  const entries = Object.entries(value).slice(0, 100).map(([key, item]) => [
    String(key).trim().slice(0, 80),
    ['boolean', 'number', 'string'].includes(typeof item) ? item : false,
  ]).filter(([key]) => key);
  return Object.fromEntries(entries);
}

function normalizeLicenseStatus(value) {
  const status = String(value || 'active').toLowerCase();
  return ['pending', 'active', 'suspended', 'revoked'].includes(status) ? status : 'active';
}

function normalizeChannel(value) {
  const channel = String(value || 'licensed').trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(channel) ? channel : 'licensed';
}

function normalizePositiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

module.exports = {
  ALL_STORES,
  DAY_MS,
  LicenseService,
  LicenseServiceError,
  normalizeActivationCode,
  normalizeLicenseInput,
  normalizeLicensePatch,
};
