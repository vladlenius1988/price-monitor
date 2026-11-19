const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PilotStatisticsStore, buildPilotSummary, normalizePilotEvent } = require('./pilot-statistics');
const { buildPilotStatisticsWorkbook } = require('./pilot-statistics-export');

test('pilot event keeps local brand data but drops product and price payloads', () => {
  const event = normalizePilotEvent({
    id: 'event-1', type: 'search', at: '2026-11-16T10:00:00.000Z', store: 'eva', outcome: 'success',
    durationMs: 65_000, productCount: 42,
    brands: [{ query: 'Nivea', brand: 'NIVEA', count: 42, products: [{ name: 'secret' }], price: 99 }],
    products: [{ name: 'secret' }], price: 99,
  }, () => Date.parse('2026-11-16T10:00:00.000Z'));
  assert.equal(event.brands[0].brand, 'NIVEA');
  assert.equal(event.brands[0].productCount, 42);
  assert.equal('products' in event, false);
  assert.equal('price' in event, false);
  assert.equal('products' in event.brands[0], false);
});

test('pilot summary aggregates searches, brands, stores and exports', () => {
  const events = [
    { id: 's1', type: 'search', at: '2026-11-15T10:00:00.000Z', store: 'eva', outcome: 'success', durationMs: 60_000, productCount: 100, brands: [{ brand: 'Nivea', count: 100, outcome: 'success' }] },
    { id: 's2', type: 'search', at: '2026-11-15T11:00:00.000Z', store: 'makeup', outcome: 'partial', durationMs: 120_000, productCount: 40, brands: [{ brand: 'Nivea', count: 25, outcome: 'success' }, { brand: 'Dove', count: 15, outcome: 'success' }] },
    { id: 's3', type: 'search', at: '2026-11-15T12:00:00.000Z', store: 'notino', outcome: 'error', durationMs: 30_000, productCount: 0, brands: [{ brand: 'Estée Lauder', count: 0, outcome: 'error' }] },
    { id: 'e1', type: 'excel_export', at: '2026-11-15T12:05:00.000Z', store: 'makeup', rowCount: 40, brands: ['Nivea', 'Dove'] },
  ];
  const summary = buildPilotSummary(events, { days: 30, now: Date.parse('2026-11-16T10:00:00.000Z') });
  assert.equal(summary.totals.searches, 3);
  assert.equal(summary.totals.successfulSearches, 2);
  assert.equal(summary.totals.successRate, 66.67);
  assert.equal(summary.totals.productCount, 140);
  assert.equal(summary.totals.excelExports, 1);
  assert.equal(summary.totals.uniqueBrands, 3);
  assert.equal(summary.byBrand.find((row) => row.brand === 'Nivea').productCount, 125);
  assert.equal(summary.byStore.find((row) => row.store === 'makeup').excelExports, 1);
});

test('pilot store survives restart and workbook contains four readable sheets', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-pilot-'));
  const filePath = path.join(directory, 'pilot-statistics.json');
  const now = () => Date.parse('2026-11-16T10:00:00.000Z');
  const store = new PilotStatisticsStore(filePath, { now, createId: () => 'stable-id' });
  await store.recordSearch({ store: 'rozetka', outcome: 'success', durationMs: 90_000, productCount: 55, brands: ['Xiaomi'] });
  await store.recordExport({ store: 'rozetka', rowCount: 55, brands: ['Xiaomi'] });
  const restarted = new PilotStatisticsStore(filePath, { now, createId: () => 'other-id' });
  const summary = await restarted.summary({ days: 0 });
  assert.equal(summary.totals.searches, 1);
  assert.equal(summary.totals.excelExports, 1);
  assert.match(fs.readFileSync(filePath, 'utf8'), /Xiaomi/);
  const sheets = buildPilotStatisticsWorkbook(summary);
  assert.deepEqual(sheets.map((sheet) => sheet.sheet), ['Підсумок пілоту', 'За магазинами', 'За торговими марками', 'Останні пошуки']);
  assert.ok(sheets.every((sheet) => Array.isArray(sheet.data) && sheet.data.length >= 2));
});
