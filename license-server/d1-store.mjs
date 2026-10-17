export class D1LicenseStore {
  constructor(database) {
    if (!database) throw new Error('d1_database_required');
    this.db = database;
  }

  async findLicenseByActivationHash(hash) {
    return licenseFromRow(await this.db.prepare('SELECT * FROM licenses WHERE activation_hash = ?1').bind(hash).first());
  }

  async findLicenseById(id) {
    return licenseFromRow(await this.db.prepare('SELECT * FROM licenses WHERE id = ?1').bind(id).first());
  }

  async createLicense(record) {
    await this.db.prepare(`
      INSERT INTO licenses (
        id, customer_name, activation_hash, activation_hint, status, paid_until,
        max_devices, lease_days, stores_json, features_json, update_channel, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
    `).bind(
      record.id,
      record.customerName,
      record.activationHash,
      record.activationHint,
      record.status,
      record.paidUntil,
      record.maxDevices,
      record.leaseDays,
      JSON.stringify(record.stores),
      JSON.stringify(record.features),
      record.updateChannel,
      record.createdAt,
      record.updatedAt,
    ).run();
    return this.findLicenseById(record.id);
  }

  async updateLicense(id, patch) {
    const current = await this.findLicenseById(id);
    if (!current) return null;
    const record = { ...current, ...patch };
    await this.db.prepare(`
      UPDATE licenses SET
        customer_name = ?2, activation_hash = ?3, activation_hint = ?4,
        status = ?5, paid_until = ?6, max_devices = ?7,
        lease_days = ?8, stores_json = ?9, features_json = ?10,
        update_channel = ?11, updated_at = ?12
      WHERE id = ?1
    `).bind(
      id,
      record.customerName,
      record.activationHash,
      record.activationHint,
      record.status,
      record.paidUntil,
      record.maxDevices,
      record.leaseDays,
      JSON.stringify(record.stores),
      JSON.stringify(record.features),
      record.updateChannel,
      record.updatedAt,
    ).run();
    return this.findLicenseById(id);
  }

  async listLicenses() {
    const result = await this.db.prepare('SELECT * FROM licenses ORDER BY created_at DESC').all();
    return (result.results || []).map(licenseFromRow);
  }

  async findDevice(licenseId, deviceId) {
    return deviceFromRow(await this.db.prepare(
      'SELECT * FROM devices WHERE license_id = ?1 AND device_id = ?2',
    ).bind(licenseId, deviceId).first());
  }

  async listDevices(licenseId) {
    const result = await this.db.prepare(
      'SELECT * FROM devices WHERE license_id = ?1 ORDER BY first_seen_at',
    ).bind(licenseId).all();
    return (result.results || []).map(deviceFromRow);
  }

  async upsertDevice(record) {
    await this.db.prepare(`
      INSERT INTO devices (
        license_id, device_id, installation_id, label, status, app_version,
        first_seen_at, last_seen_at, removed_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT(license_id, device_id) DO UPDATE SET
        installation_id = excluded.installation_id,
        label = excluded.label,
        status = excluded.status,
        app_version = excluded.app_version,
        last_seen_at = excluded.last_seen_at,
        removed_at = excluded.removed_at
    `).bind(
      record.licenseId,
      record.deviceId,
      record.installationId,
      record.label || '',
      record.status || 'active',
      record.appVersion || '',
      record.firstSeenAt,
      record.lastSeenAt,
      record.removedAt || '',
    ).run();
    return this.findDevice(record.licenseId, record.deviceId);
  }

  async removeDevice(licenseId, deviceId) {
    const current = await this.findDevice(licenseId, deviceId);
    if (!current) return false;
    await this.db.prepare(`
      UPDATE devices SET status = 'removed', removed_at = ?3
      WHERE license_id = ?1 AND device_id = ?2
    `).bind(licenseId, deviceId, new Date().toISOString()).run();
    return true;
  }

  async appendEvent(event) {
    await this.db.prepare(`
      INSERT INTO events (id, type, license_id, device_id, occurred_at, ip, details_json)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `).bind(
      crypto.randomUUID(),
      event.type,
      event.licenseId || '',
      event.deviceId || '',
      event.occurredAt,
      event.ip || '',
      JSON.stringify(event.details || {}),
    ).run();
  }

  async overview() {
    const licenses = await this.listLicenses();
    const devicesResult = await this.db.prepare('SELECT * FROM devices ORDER BY last_seen_at DESC').all();
    const eventsResult = await this.db.prepare('SELECT * FROM events ORDER BY occurred_at DESC LIMIT 100').all();
    const devices = (devicesResult.results || []).map(deviceFromRow);
    return {
      licenses: licenses.map(({ activationHash: _activationHash, ...license }) => ({
        ...license,
        devices: devices.filter((device) => device.licenseId === license.id),
      })),
      events: (eventsResult.results || []).map(eventFromRow),
    };
  }
}

function licenseFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerName: row.customer_name,
    activationHash: row.activation_hash,
    activationHint: row.activation_hint,
    status: row.status,
    paidUntil: row.paid_until,
    maxDevices: Number(row.max_devices),
    leaseDays: Number(row.lease_days),
    stores: parseJson(row.stores_json, []),
    features: parseJson(row.features_json, {}),
    updateChannel: row.update_channel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deviceFromRow(row) {
  if (!row) return null;
  return {
    licenseId: row.license_id,
    deviceId: row.device_id,
    installationId: row.installation_id,
    label: row.label,
    status: row.status,
    appVersion: row.app_version,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    removedAt: row.removed_at,
  };
}

function eventFromRow(row) {
  return {
    id: row.id,
    type: row.type,
    licenseId: row.license_id,
    deviceId: row.device_id,
    occurredAt: row.occurred_at,
    ip: row.ip,
    details: parseJson(row.details_json, {}),
  };
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}
