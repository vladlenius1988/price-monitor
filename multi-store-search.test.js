const test = require('node:test');
const assert = require('node:assert/strict');
const writeExcelFileModule = require('write-excel-file/node');
const writeExcelFile = writeExcelFileModule.default || writeExcelFileModule;
const {
  failedStoreIds, mergeStoreProducts, normalizeStoreSelection, replaceStoreProducts, searchOptions, totalParseCalls,
} = require('./multi-store-search');
const { buildMultiStoreLiveWorkbook } = require('./multi-store-live-export');

test('normalizes selected stores, required sources and demo call counts', () => {
  assert.deepEqual(
    normalizeStoreSelection(['rozetka', 'eva', 'unknown'], ['eva', 'makeup', 'rozetka'], { required: ['makeup'] }),
    ['eva', 'makeup', 'rozetka'],
  );
  assert.equal(totalParseCalls(['eva', 'makeup'], ['Nivea', 'Dove']), 4);
});

test('keeps fast mode cheap and detailed mode store-specific', () => {
  assert.deepEqual(searchOptions('rozetka', 'fast'), {
    includeVariants: false, includeSellers: false, includeBarcodes: false,
  });
  assert.equal(searchOptions('rozetka', 'detailed').includeSellers, true);
  assert.equal(searchOptions('eva', 'detailed').includeVariants, true);
  assert.equal(searchOptions('makeup', 'fast', { barcodeReference: true }).includeBarcodes, true);
});

test('replaces only retried store rows and finds partial failures', () => {
  const current = [
    { store: 'eva', name: 'Old EVA' },
    { store: 'makeup', name: 'MAKEUP stays' },
  ];
  const next = replaceStoreProducts(current, 'eva', [{ name: 'New EVA' }], 'EVA');
  assert.deepEqual(next.map((item) => item.name), ['MAKEUP stays', 'New EVA']);
  const merged = mergeStoreProducts(current, 'eva', [{ store: 'eva', name: 'Second EVA' }], 'EVA');
  assert.deepEqual(merged.map((item) => item.name), ['MAKEUP stays', 'Old EVA', 'Second EVA']);
  assert.deepEqual(failedStoreIds([{ store: 'eva', status: 'partial' }, { store: 'makeup', status: 'success' }]), ['eva']);
});

test('builds a real two-sheet multi-store workbook', async () => {
  const sheets = buildMultiStoreLiveWorkbook({
    query: 'Nivea', mode: 'fast', capturedAt: '2026-11-04T10:00:00.000Z',
    products: [
      { store: 'eva', storeLabel: 'EVA', name: 'Nivea крем', brand: 'Nivea', priceWithoutDiscount: 100, url: 'https://eva.ua/test' },
      { store: 'makeup', storeLabel: 'MAKEUP', name: 'Nivea Cream', brand: 'Nivea', priceWithDiscount: 90, priceWithoutDiscount: 110, barcode: '4005900898727' },
    ],
    reports: [{ store: 'eva', storeLabel: 'EVA', status: 'success', statusLabel: 'Готово', productCount: 1 }],
  });
  assert.deepEqual(sheets.map((sheet) => sheet.sheet), ['Моніторинг цін', 'Джерела і стан']);
  const buffer = await writeExcelFile(sheets).toBuffer();
  assert.equal(buffer.subarray(0, 2).toString('utf8'), 'PK');
  assert.ok(buffer.length > 1_000);
});
