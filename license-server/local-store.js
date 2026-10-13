const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class LocalLicenseStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.data = null;
  }

  ensureLoaded() {
    if (this.data) return;
    if (!fs.existsSync(this.filePath)) {
      this.data = emptyData();
      this.persist();
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (!parsed || parsed.schemaVersion !== 1) throw new Error('local_store_invalid');
    this.data = {
      schemaVersion: 1,
      licenses: Array.isArray(parsed.licenses) ? parsed.licenses : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      releases: Array.isArray(parsed.releases) ? parsed.releases : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
    };
  }

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    fs.copyFileSync(temporaryPath, this.filePath);
    fs.rmSync(temporaryPath, { force: true });
  }

  async findLicenseByActivationHash(hash) {
    this.ensureLoaded();
    return clone(this.data.licenses.find((item) => item.activationHash === hash) || null);
  }

  async findLicenseById(id) {
    this.ensureLoaded();
    return clone(this.data.licenses.find((item) => item.id === id) || null);
  }

  async createLicense(record) {
    this.ensureLoaded();
    if (this.data.licenses.some((item) => item.id === record.id)) throw new Error('license_exists');
    this.data.licenses.push(clone(record));
    this.persist();
    return clone(record);
  }

  async updateLicense(id, patch) {
    this.ensureLoaded();
    const index = this.data.licenses.findIndex((item) => item.id === id);
    if (index < 0) return null;
    this.data.licenses[index] = { ...this.data.licenses[index], ...clone(patch) };
    this.persist();
    return clone(this.data.licenses[index]);
  }

  async listLicenses() {
    this.ensureLoaded();
    return clone(this.data.licenses);
  }

  async findDevice(licenseId, deviceId) {
    this.ensureLoaded();
    return clone(this.data.devices.find((item) => item.licenseId === licenseId && item.deviceId === deviceId) || null);
  }

  async listDevices(licenseId) {
    this.ensureLoaded();
    return clone(this.data.devices.filter((item) => item.licenseId === licenseId));
  }

  async upsertDevice(record) {
    this.ensureLoaded();
    const index = this.data.devices.findIndex((item) => item.licenseId === record.licenseId && item.deviceId === record.deviceId);
    if (index < 0) this.data.devices.push(clone(record));
    else this.data.devices[index] = clone(record);
    this.persist();
    return clone(record);
  }

  async removeDevice(licenseId, deviceId) {
    this.ensureLoaded();
    const device = this.data.devices.find((item) => item.licenseId === licenseId && item.deviceId === deviceId);
    if (!device) return false;
    device.status = 'removed';
    device.removedAt = new Date().toISOString();
    this.persist();
    return true;
  }

  async appendEvent(event) {
    this.ensureLoaded();
    this.data.events.push({ id: crypto.randomUUID(), ...clone(event) });
    if (this.data.events.length > 5000) this.data.events = this.data.events.slice(-5000);
    this.persist();
  }

  async createRelease(record) {
    this.ensureLoaded();
    this.data.releases = this.data.releases.filter((item) => item.releaseId !== record.releaseId);
    this.data.releases.push(clone(record));
    this.persist();
    return clone(record);
  }

  async listReleases(channel = '') {
    this.ensureLoaded();
    const items = channel
      ? this.data.releases.filter((item) => item.channel === channel)
      : this.data.releases;
    return clone(items.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))));
  }

  async findRelease(id) {
    this.ensureLoaded();
    return clone(this.data.releases.find((item) => item.releaseId === id) || null);
  }

  async getSettings() {
    this.ensureLoaded();
    return clone(this.data.settings || {});
  }

  async updateSettings(patch) {
    this.ensureLoaded();
    this.data.settings = { ...(this.data.settings || {}), ...clone(patch) };
    this.persist();
    return clone(this.data.settings);
  }

  async hasEventDetail(type, key) {
    this.ensureLoaded();
    return this.data.events.some((event) => event.type === type && event.details?.key === key);
  }

  async overview() {
    this.ensureLoaded();
    return clone({
      licenses: this.data.licenses.map((license) => ({
        ...license,
        activationHash: undefined,
        devices: this.data.devices.filter((device) => device.licenseId === license.id),
      })),
      releases: this.data.releases.map(({ filePath: _filePath, ...release }) => release),
      events: this.data.events.slice(-100).reverse(),
      eventCount: this.data.events.length,
      settings: publicSettings(this.data.settings),
    });
  }
}

function emptyData() {
  return { schemaVersion: 1, licenses: [], devices: [], releases: [], events: [], settings: {} };
}

function publicSettings(settings = {}) {
  return {
    telegramEnabled: Boolean(settings.telegramEnabled),
    telegramConfigured: Boolean(settings.telegramBotToken && settings.telegramChatId),
    telegramChatId: settings.telegramChatId ? maskValue(settings.telegramChatId) : '',
  };
}

function maskValue(value) {
  const text = String(value || '');
  return text.length <= 4 ? '*'.repeat(text.length) : `${'*'.repeat(Math.min(8, text.length - 4))}${text.slice(-4)}`;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

module.exports = { LocalLicenseStore };
