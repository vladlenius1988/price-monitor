import telemetryPackage from './telemetry.js';

const { telemetrySummary } = telemetryPackage;

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

  async recordSearchMetric(record) {
    const result = await this.db.prepare(`
      INSERT OR IGNORE INTO search_metrics (
        id, license_id, device_id, store, outcome, duration_ms,
        product_count, app_version, error_code, occurred_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    `).bind(
      record.eventId,
      record.licenseId,
      record.deviceId,
      record.store,
      record.outcome,
      record.durationMs,
      record.productCount,
      record.appVersion || '',
      record.errorCode || '',
      record.occurredAt,
    ).run();
    return { inserted: (Number(result?.meta?.changes) || 0) > 0 };
  }

  async recordSupportDiagnostic(record) {
    const duplicate = await this.findSupportDiagnostic(record.reportId);
    if (duplicate) return { inserted: false, repeated: false, item: duplicate };
    const existing = supportDiagnosticFromRow(await this.db.prepare(`
      SELECT diagnostics.*, licenses.customer_name, devices.label AS device_label
      FROM support_diagnostics AS diagnostics
      JOIN licenses ON licenses.id = diagnostics.license_id
      LEFT JOIN devices ON devices.license_id = diagnostics.license_id AND devices.device_id = diagnostics.device_id
      WHERE diagnostics.license_id = ?1 AND diagnostics.device_id = ?2
        AND diagnostics.fingerprint = ?3 AND diagnostics.status = 'open'
      ORDER BY diagnostics.last_seen_at DESC LIMIT 1
    `).bind(record.licenseId, record.deviceId, record.fingerprint).first());
    if (existing) {
      const severity = severityRank(record.severity) > severityRank(existing.severity) ? record.severity : existing.severity;
      await this.db.prepare(`
        UPDATE support_diagnostics SET
          severity = ?2, app_version = ?3, app_edition = ?4, generated_at = ?5,
          system_json = ?6, access_json = ?7, server_json = ?8, stores_json = ?9,
          events_json = ?10, last_seen_at = ?11, repeat_count = repeat_count + 1
        WHERE id = ?1
      `).bind(
        existing.id, severity, record.appVersion, record.appEdition, record.generatedAt,
        JSON.stringify(record.system), JSON.stringify(record.access), JSON.stringify(record.server),
        JSON.stringify(record.stores), JSON.stringify(record.events), record.receivedAt,
      ).run();
      return { inserted: false, repeated: true, item: await this.findSupportDiagnostic(existing.id) };
    }
    await this.db.prepare(`
      INSERT INTO support_diagnostics (
        id, license_id, device_id, fingerprint, status, severity, app_version, app_edition,
        generated_at, system_json, access_json, server_json, stores_json, events_json,
        first_seen_at, last_seen_at, repeat_count, resolved_at
      ) VALUES (?1, ?2, ?3, ?4, 'open', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, 1, '')
    `).bind(
      record.reportId, record.licenseId, record.deviceId, record.fingerprint, record.severity,
      record.appVersion, record.appEdition, record.generatedAt, JSON.stringify(record.system),
      JSON.stringify(record.access), JSON.stringify(record.server), JSON.stringify(record.stores),
      JSON.stringify(record.events), record.receivedAt,
    ).run();
    return { inserted: true, repeated: false, item: await this.findSupportDiagnostic(record.reportId) };
  }

  async findSupportDiagnostic(id) {
    return supportDiagnosticFromRow(await this.db.prepare(`
      SELECT diagnostics.*, licenses.customer_name, devices.label AS device_label
      FROM support_diagnostics AS diagnostics
      JOIN licenses ON licenses.id = diagnostics.license_id
      LEFT JOIN devices ON devices.license_id = diagnostics.license_id AND devices.device_id = diagnostics.device_id
      WHERE diagnostics.id = ?1
    `).bind(id).first());
  }

  async listSupportDiagnostics() {
    const result = await this.db.prepare(`
      SELECT diagnostics.*, licenses.customer_name, devices.label AS device_label
      FROM support_diagnostics AS diagnostics
      JOIN licenses ON licenses.id = diagnostics.license_id
      LEFT JOIN devices ON devices.license_id = diagnostics.license_id AND devices.device_id = diagnostics.device_id
      ORDER BY CASE diagnostics.status WHEN 'open' THEN 0 ELSE 1 END, diagnostics.last_seen_at DESC
      LIMIT 200
    `).all();
    return (result.results || []).map(supportDiagnosticFromRow);
  }

  async updateSupportDiagnostic(id, status) {
    if (!['open', 'resolved'].includes(status)) return null;
    const resolvedAt = status === 'resolved' ? new Date().toISOString() : '';
    await this.db.prepare(`
      UPDATE support_diagnostics SET status = ?2, resolved_at = ?3 WHERE id = ?1
    `).bind(id, status, resolvedAt).run();
    return this.findSupportDiagnostic(id);
  }

  async searchTelemetryOverview(nowMs = Date.now()) {
    const thresholds = {
      day: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(),
      week: new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString(),
      month: new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const [day, week, month, byStoreResult, byLicenseResult, errorResult] = await Promise.all([
      this.searchMetricSummary(thresholds.day),
      this.searchMetricSummary(thresholds.week),
      this.searchMetricSummary(thresholds.month),
      this.db.prepare(`
        SELECT store, COUNT(*) AS total,
          SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS success,
          SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS error_count,
          SUM(CASE WHEN outcome = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
          AVG(duration_ms) AS average_duration_ms,
          SUM(product_count) AS product_count,
          MAX(occurred_at) AS last_search_at
        FROM search_metrics WHERE occurred_at >= ?1
        GROUP BY store ORDER BY total DESC, store
      `).bind(thresholds.month).all(),
      this.db.prepare(`
        SELECT metrics.license_id, licenses.customer_name, COUNT(*) AS total,
          SUM(CASE WHEN metrics.outcome = 'success' THEN 1 ELSE 0 END) AS success,
          SUM(CASE WHEN metrics.outcome = 'error' THEN 1 ELSE 0 END) AS error_count,
          SUM(CASE WHEN metrics.outcome = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
          AVG(metrics.duration_ms) AS average_duration_ms,
          SUM(metrics.product_count) AS product_count,
          MAX(metrics.occurred_at) AS last_search_at
        FROM search_metrics AS metrics
        JOIN licenses ON licenses.id = metrics.license_id
        WHERE metrics.occurred_at >= ?1
        GROUP BY metrics.license_id, licenses.customer_name
        ORDER BY total DESC, licenses.customer_name
      `).bind(thresholds.month).all(),
      this.db.prepare(`
        SELECT metrics.id, metrics.license_id, licenses.customer_name, metrics.device_id,
          metrics.store, metrics.error_code, metrics.app_version, metrics.duration_ms,
          metrics.product_count, metrics.occurred_at
        FROM search_metrics AS metrics
        JOIN licenses ON licenses.id = metrics.license_id
        WHERE metrics.outcome = 'error' AND metrics.occurred_at >= ?1
        ORDER BY metrics.occurred_at DESC LIMIT 25
      `).bind(thresholds.month).all(),
    ]);
    return {
      periods: { day, week, month },
      byStore: (byStoreResult.results || []).map(telemetryGroupFromRow),
      byLicense: (byLicenseResult.results || []).map(telemetryGroupFromRow),
      recentErrors: (errorResult.results || []).map(searchErrorFromRow),
      privacy: 'no_queries_no_products',
    };
  }

  async searchMetricSummary(since) {
    const row = await this.db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS error_count,
        SUM(CASE WHEN outcome = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
        AVG(duration_ms) AS average_duration_ms,
        SUM(product_count) AS product_count
      FROM search_metrics WHERE occurred_at >= ?1
    `).bind(since).first();
    return telemetrySummary(row);
  }

  async health() {
    const row = await this.db.prepare('SELECT 1 AS ready').first();
    return { ok: Number(row?.ready) === 1 };
  }

  async consumeRateLimit({ key, limit, windowSeconds, nowMs = Date.now() }) {
    const safeLimit = Math.max(1, Math.min(100000, Number(limit) || 1));
    const safeWindow = Math.max(1, Math.min(86400, Number(windowSeconds) || 60));
    const windowMs = safeWindow * 1000;
    const windowStartMs = Math.floor(Number(nowMs) / windowMs) * windowMs;
    const windowStartedAt = new Date(windowStartMs).toISOString();
    const expiresAt = new Date(windowStartMs + windowMs).toISOString();
    await this.db.prepare(`
      INSERT INTO request_limits (rate_key, request_count, window_started_at, expires_at)
      VALUES (?1, 1, ?2, ?3)
      ON CONFLICT(rate_key) DO UPDATE SET
        request_count = CASE
          WHEN request_limits.expires_at <= excluded.window_started_at THEN 1
          ELSE request_limits.request_count + 1
        END,
        window_started_at = CASE
          WHEN request_limits.expires_at <= excluded.window_started_at THEN excluded.window_started_at
          ELSE request_limits.window_started_at
        END,
        expires_at = CASE
          WHEN request_limits.expires_at <= excluded.window_started_at THEN excluded.expires_at
          ELSE request_limits.expires_at
        END
    `).bind(String(key), windowStartedAt, expiresAt).run();
    const row = await this.db.prepare(
      'SELECT request_count, expires_at FROM request_limits WHERE rate_key = ?1',
    ).bind(String(key)).first();
    const count = Number(row?.request_count) || 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(row?.expires_at || expiresAt) - Number(nowMs)) / 1000));
    return {
      allowed: count <= safeLimit,
      limit: safeLimit,
      remaining: Math.max(0, safeLimit - count),
      retryAfterSeconds,
    };
  }

  async cleanupOperationalData(now = new Date().toISOString()) {
    const metricsBefore = new Date(Date.parse(now) - 180 * 24 * 60 * 60 * 1000).toISOString();
    const [limits, metrics, diagnostics] = await Promise.all([
      this.db.prepare('DELETE FROM request_limits WHERE expires_at < ?1').bind(now).run(),
      this.db.prepare('DELETE FROM search_metrics WHERE occurred_at < ?1').bind(metricsBefore).run(),
      this.db.prepare("DELETE FROM support_diagnostics WHERE status = 'resolved' AND resolved_at < ?1").bind(metricsBefore).run(),
    ]);
    return {
      removedRateLimits: Number(limits?.meta?.changes) || 0,
      removedSearchMetrics: Number(metrics?.meta?.changes) || 0,
      removedSupportDiagnostics: Number(diagnostics?.meta?.changes) || 0,
    };
  }

  async overview() {
    const licenses = await this.listLicenses();
    const [devicesResult, eventsResult, eventCountRow, telemetry, support] = await Promise.all([
      this.db.prepare('SELECT * FROM devices ORDER BY last_seen_at DESC').all(),
      this.db.prepare('SELECT * FROM events ORDER BY occurred_at DESC LIMIT 100').all(),
      this.db.prepare('SELECT COUNT(*) AS total FROM events').first(),
      this.searchTelemetryOverview(),
      this.listSupportDiagnostics(),
    ]);
    const devices = (devicesResult.results || []).map(deviceFromRow);
    return {
      licenses: licenses.map(({ activationHash: _activationHash, ...license }) => ({
        ...license,
        devices: devices.filter((device) => device.licenseId === license.id),
      })),
      events: (eventsResult.results || []).map(eventFromRow),
      eventCount: Number(eventCountRow?.total) || 0,
      telemetry,
      support,
    };
  }
}

function supportDiagnosticFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    licenseId: row.license_id,
    customerName: row.customer_name || '',
    deviceId: row.device_id,
    deviceCode: deviceCode(row.device_id),
    deviceLabel: row.device_label || '',
    fingerprint: row.fingerprint,
    status: row.status,
    severity: row.severity,
    appVersion: row.app_version,
    appEdition: row.app_edition,
    generatedAt: row.generated_at,
    system: parseJson(row.system_json, {}),
    access: parseJson(row.access_json, {}),
    server: parseJson(row.server_json, {}),
    stores: parseJson(row.stores_json, []),
    events: parseJson(row.events_json, []),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    repeatCount: Math.max(1, Number(row.repeat_count) || 1),
    resolvedAt: row.resolved_at || '',
  };
}

function severityRank(value) {
  return { info: 1, warning: 2, error: 3 }[value] || 0;
}

function deviceCode(value) {
  return String(value || '').slice(0, 16).toUpperCase().match(/.{1,4}/g)?.join('-') || '';
}

function telemetryGroupFromRow(row) {
  return {
    ...(row.store ? { store: row.store } : {}),
    ...(row.license_id ? { licenseId: row.license_id } : {}),
    ...(row.customer_name ? { customerName: row.customer_name } : {}),
    ...telemetrySummary(row),
    lastSearchAt: row.last_search_at || '',
  };
}

function searchErrorFromRow(row) {
  return {
    id: row.id,
    licenseId: row.license_id,
    customerName: row.customer_name,
    deviceId: row.device_id,
    store: row.store,
    errorCode: row.error_code,
    appVersion: row.app_version,
    durationMs: Number(row.duration_ms) || 0,
    productCount: Number(row.product_count) || 0,
    occurredAt: row.occurred_at,
  };
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
