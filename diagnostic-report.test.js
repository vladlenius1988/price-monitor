const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  DiagnosticEventStore,
  buildDiagnosticReport,
  normalizeDiagnosticEvent,
} = require('./diagnostic-report');

test('diagnostic events accept only bounded technical codes', () => {
  const event = normalizeDiagnosticEvent({
    area: 'search',
    store: 'makeup',
    outcome: 'error',
    code: 'Catalog unavailable: Lipss Pop Gossip',
    query: 'Lipss',
    products: [{ name: 'secret' }],
  }, () => Date.parse('2026-10-23T10:00:00.000Z'));
  assert.deepEqual(event, {
    at: '2026-10-23T10:00:00.000Z',
    area: 'search',
    outcome: 'error',
    code: 'unknown_error',
    store: 'makeup',
  });
  assert.equal('query' in event, false);
  assert.equal('products' in event, false);
});

test('diagnostic store persists only the newest 50 safe events', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-diagnostics-'));
  const filePath = path.join(directory, 'events.json');
  const store = new DiagnosticEventStore(filePath, { now: () => Date.parse('2026-10-23T10:00:00.000Z') });
  for (let index = 0; index < 55; index += 1) {
    await store.add({
      at: new Date(Date.parse('2026-10-23T10:00:00.000Z') + index * 1000).toISOString(),
      area: 'search',
      store: 'makeup',
      outcome: 'error',
      code: 'search_error',
      query: 'never save me',
    });
  }
  const events = await store.list();
  assert.equal(events.length, 50);
  assert.equal(events[0].at, '2026-10-23T10:00:05.000Z');
  assert.equal(events[49].at, '2026-10-23T10:00:54.000Z');
  assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /never save me/i);
});

test('diagnostic report is readable and excludes commercial search data', () => {
  const report = buildDiagnosticReport({
    generatedAt: '2026-10-23T10:00:00.000Z',
    appInfo: { name: 'Price Monitor Online', version: '4.26.0', edition: 'licensed' },
    system: { platform: 'win32', release: '10.0.19045', arch: 'x64', locale: 'uk-UA' },
    access: {
      allowed: true,
      edition: 'licensed',
      licenseId: 'lic_test',
      customerName: 'Test customer',
      deviceCode: 'AAAA-BBBB-CCCC-DDDD',
      stores: ['eva', 'makeup'],
      onlineConfigured: true,
    },
    server: { checked: true, available: true },
    supportedStores: ['eva', 'makeup'],
    events: [{ area: 'search', store: 'makeup', outcome: 'error', code: 'catalog_unavailable', brand: 'Lipss' }],
  });
  const serialized = JSON.stringify(report);
  assert.equal(report.schemaVersion, 1);
  assert.match(report.summaryUa.join(' '), /4\.26\.0/);
  assert.match(report.summaryUa.join(' '), /Сервер ліцензій: доступний/);
  assert.equal(report.privacy.containsSearchQueries, false);
  assert.doesNotMatch(serialized, /Lipss/);
  assert.doesNotMatch(serialized, /"brand"|"query"|"products"|"prices"|"barcodes"/i);
});
