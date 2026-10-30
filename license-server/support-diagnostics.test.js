const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeSupportDiagnostic, telegramSupportMessage } = require('./support-diagnostics');

function validDiagnostic() {
  return {
    reportId: '12345678-1234-4234-9234-123456789abc',
    licenseId: 'lic_1234567890abcdef',
    deviceId: 'a'.repeat(64),
    appVersion: '4.27.0',
    appEdition: 'licensed',
    generatedAt: '2026-10-30T10:00:00.000Z',
    system: { platform: 'win32', release: '10.0.19045', arch: 'x64', locale: 'uk-UA' },
    access: { allowed: true, blockedReason: '', onlineConfigured: true, expiresAt: '2026-11-30T00:00:00.000Z' },
    server: { checked: true, available: true, reason: '' },
    stores: ['eva', 'makeup'],
    events: [{ at: '2026-10-30T09:59:00.000Z', area: 'search', outcome: 'error', code: 'catalog_unavailable', store: 'makeup' }],
  };
}

test('accepts only privacy-safe support diagnostics and creates a stable fingerprint', () => {
  const first = normalizeSupportDiagnostic(validDiagnostic());
  const second = normalizeSupportDiagnostic({ ...validDiagnostic(), reportId: '22345678-1234-4234-9234-123456789abc' });
  assert.equal(first.ok, true);
  assert.equal(first.value.severity, 'error');
  assert.equal(first.value.fingerprint, second.value.fingerprint);
  assert.deepEqual(first.value.events[0], validDiagnostic().events[0]);
});

test('rejects search, brand, product, price and barcode fields at any depth', () => {
  for (const extra of [
    { query: 'secret' }, { brand: 'secret' }, { productName: 'secret' },
    { metadata: { price: 100 } }, { events: [{ ...validDiagnostic().events[0], barcode: '123' }] },
  ]) {
    const candidate = { ...validDiagnostic(), ...extra };
    assert.equal(normalizeSupportDiagnostic(candidate).reason, 'diagnostic_sensitive_field');
  }
});

test('rejects arbitrary error text instead of storing it as a code', () => {
  const candidate = validDiagnostic();
  candidate.events[0].code = 'Lipss catalog broke';
  assert.equal(normalizeSupportDiagnostic(candidate).reason, 'diagnostic_event_invalid');
});

test('Telegram support message contains technical codes but no report body', () => {
  const normalized = normalizeSupportDiagnostic(validDiagnostic()).value;
  const message = telegramSupportMessage({ ...normalized, customerName: 'PROSTOR', deviceLabel: 'OFFICE-01', repeatCount: 3 });
  assert.match(message, /PROSTOR/);
  assert.match(message, /catalog_unavailable/);
  assert.match(message, /Повторів: 3/);
  assert.doesNotMatch(message, /Lipss|query|product/i);
});
