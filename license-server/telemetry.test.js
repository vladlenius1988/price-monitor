const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeSearchTelemetry, telemetrySummary } = require('./telemetry');

const valid = {
  eventId: '11111111-2222-4333-8444-555555555555',
  licenseId: 'license_test_2026',
  deviceId: 'a'.repeat(64),
  store: 'makeup',
  outcome: 'success',
  durationMs: 12345,
  productCount: 38,
  appVersion: '4.25.0',
  errorCode: '',
};

test('accepts only bounded privacy-safe search telemetry', () => {
  const result = normalizeSearchTelemetry(valid);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, valid);
});

test('rejects search terms, brands and product data at the server boundary', () => {
  for (const field of ['query', 'brand', 'products', 'prices', 'barcodes']) {
    const result = normalizeSearchTelemetry({ ...valid, [field]: field === 'products' ? [] : 'secret' });
    assert.deepEqual(result, { ok: false, reason: 'telemetry_sensitive_field' });
  }
});

test('rejects unknown stores, outcomes and implausible measurements', () => {
  assert.equal(normalizeSearchTelemetry({ ...valid, store: 'other' }).reason, 'telemetry_store_invalid');
  assert.equal(normalizeSearchTelemetry({ ...valid, outcome: 'partial' }).reason, 'telemetry_outcome_invalid');
  assert.equal(normalizeSearchTelemetry({ ...valid, durationMs: -1 }).reason, 'telemetry_duration_invalid');
  assert.equal(normalizeSearchTelemetry({ ...valid, productCount: 1000001 }).reason, 'telemetry_count_invalid');
});

test('calculates stable aggregate values for the owner dashboard', () => {
  assert.deepEqual(telemetrySummary({
    total: 8,
    success: 6,
    error_count: 1,
    cancelled: 1,
    average_duration_ms: 1250.6,
    product_count: 410,
  }), {
    total: 8,
    success: 6,
    error: 1,
    cancelled: 1,
    successRate: 75,
    averageDurationMs: 1251,
    productCount: 410,
  });
});
