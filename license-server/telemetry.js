const STORE_IDS = Object.freeze(['eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka']);
const OUTCOMES = Object.freeze(['success', 'error', 'cancelled']);
const SENSITIVE_FIELDS = Object.freeze([
  'query', 'queries', 'brand', 'brands', 'product', 'products', 'price', 'prices',
  'barcode', 'barcodes', 'ean', 'gtin',
]);

function normalizeSearchTelemetry(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'telemetry_invalid' };
  }
  if (SENSITIVE_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(input, field))) {
    return { ok: false, reason: 'telemetry_sensitive_field' };
  }

  const eventId = String(input.eventId || '').trim().toLowerCase();
  const licenseId = String(input.licenseId || '').trim();
  const deviceId = String(input.deviceId || '').trim().toLowerCase();
  const store = String(input.store || '').trim().toLowerCase();
  const outcome = String(input.outcome || '').trim().toLowerCase();
  const durationMs = Math.round(Number(input.durationMs));
  const productCount = Math.round(Number(input.productCount));
  const appVersion = String(input.appVersion || '').trim().slice(0, 40);
  const errorCode = safeErrorCode(input.errorCode);

  if (!/^[a-f0-9-]{32,40}$/.test(eventId)) return { ok: false, reason: 'telemetry_event_invalid' };
  if (!/^[a-z0-9_-]{8,100}$/i.test(licenseId)) return { ok: false, reason: 'license_id_invalid' };
  if (!/^[a-f0-9]{64}$/.test(deviceId)) return { ok: false, reason: 'device_id_invalid' };
  if (!STORE_IDS.includes(store)) return { ok: false, reason: 'telemetry_store_invalid' };
  if (!OUTCOMES.includes(outcome)) return { ok: false, reason: 'telemetry_outcome_invalid' };
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 24 * 60 * 60 * 1000) {
    return { ok: false, reason: 'telemetry_duration_invalid' };
  }
  if (!Number.isFinite(productCount) || productCount < 0 || productCount > 1_000_000) {
    return { ok: false, reason: 'telemetry_count_invalid' };
  }

  return {
    ok: true,
    value: {
      eventId,
      licenseId,
      deviceId,
      store,
      outcome,
      durationMs,
      productCount,
      appVersion,
      errorCode: outcome === 'error' ? errorCode || 'unknown_error' : errorCode,
    },
  };
}

function safeErrorCode(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  return normalized.replace(/^_+|_+$/g, '').slice(0, 80);
}

function telemetrySummary(row = {}) {
  const total = Number(row.total) || 0;
  const success = Number(row.success) || 0;
  return {
    total,
    success,
    error: Number(row.error ?? row.error_count) || 0,
    cancelled: Number(row.cancelled) || 0,
    successRate: total ? Math.round((success / total) * 1000) / 10 : 0,
    averageDurationMs: Math.round(Number(row.average_duration_ms) || 0),
    productCount: Number(row.product_count) || 0,
  };
}

module.exports = {
  STORE_IDS,
  OUTCOMES,
  normalizeSearchTelemetry,
  safeErrorCode,
  telemetrySummary,
};
