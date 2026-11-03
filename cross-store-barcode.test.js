const test = require('node:test');
const assert = require('node:assert/strict');
const writeExcelFileModule = require('write-excel-file/node');
const writeExcelFile = writeExcelFileModule.default || writeExcelFileModule;
const {
  buildProductSearchQuery, normalizeBarcode, scoreProductMatch, selectCandidateMatches,
} = require('./cross-store-barcode');
const { buildCrossStoreBarcodeWorkbook } = require('./cross-store-barcode-export');

const reference = {
  name: 'Lifter Gloss блиск для губ', brand: 'Maybelline New York', variant: '008 Stone',
  barcode: '3600531609764', priceWithoutDiscount: 246, priceWithDiscount: 234, available: true,
};

test('validates EAN and builds a product search phrase without duplicating the brand', () => {
  assert.equal(normalizeBarcode('3600 5316 09764'), '3600531609764');
  assert.equal(normalizeBarcode('3600531609765'), '');
  assert.equal(buildProductSearchQuery(reference), 'Maybelline New York Lifter Gloss блиск для губ 008 Stone');
  assert.equal(buildProductSearchQuery({ ...reference, name: 'Maybelline New York Lifter Gloss' }), 'Maybelline New York Lifter Gloss 008 Stone');
});

test('ranks same-brand same-variant products above unrelated search results', () => {
  const strong = {
    name: 'Блиск для губ Lifter Gloss', brand: 'Maybelline New York', variant: '8 Stone',
    barcode: '4006381333931',
  };
  const weak = { name: 'Зволожувальний блиск для губ', brand: 'Lamel', variant: '401' };
  assert.ok(scoreProductMatch(reference, strong) > 0.68);
  assert.ok(scoreProductMatch(reference, weak) < 0.4);
  const selected = selectCandidateMatches(reference, [weak, strong], { store: 'eva', storeLabel: 'EVA' });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].store, 'eva');
  assert.equal(selected[0].matchType, 'probable_name');
  assert.equal(selected[0].barcode, '');
  assert.equal(selected[0].referenceBarcode, reference.barcode);
  assert.match(selected[0].matchLabel, /назвою/);
});

test('marks only a matching verified barcode as exact', () => {
  const selected = selectCandidateMatches(reference, [{ ...reference }], { store: 'makeup', storeLabel: 'MAKEUP' });
  assert.equal(selected[0].matchType, 'exact_barcode');
  assert.equal(selected[0].matchScore, 1);
});

test('builds a two-sheet Excel report that explains uncertain matches', async () => {
  const products = selectCandidateMatches(reference, [reference], { store: 'makeup', storeLabel: 'MAKEUP' });
  products.push(...selectCandidateMatches(reference, [{
    name: 'Блиск для губ Lifter Gloss', brand: 'Maybelline New York', variant: '008 Stone',
    priceWithoutDiscount: 250, available: true, url: 'https://example.test/product',
  }], { store: 'eva', storeLabel: 'EVA' }));
  const sheets = buildCrossStoreBarcodeWorkbook({
    barcode: reference.barcode, reference, products,
    reports: [{ store: 'makeup', storeLabel: 'MAKEUP', statusLabel: 'Точний збіг', matchCount: 1, query: reference.barcode }],
    capturedAt: '2026-11-03T10:00:00.000Z',
  });
  assert.deepEqual(sheets.map((sheet) => sheet.sheet), ['Порівняння цін', 'Джерела і точність']);
  const buffer = await writeExcelFile(sheets).toBuffer();
  assert.equal(buffer.subarray(0, 2).toString('utf8'), 'PK');
  assert.ok(buffer.length > 1_000);
});
