const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  PriceScraper, STORES, normalizeText, normalizeBarcode, looksLikeBarcodeInput, rankBrands,
  expandAuroraProducts, expandMakeupVariantData, findMakeupBarcodeVariant,
  deduplicateProducts, isRetryableLoadError,
} = require('./scraper');
const {
  activeBrandSegment,
  cleanParserError,
  mergeProducts,
  replaceActiveBrandSegment,
  runBrandBatch,
  splitBrandQueries,
} = require('./batch');
const {
  createSavedListsBackup,
  duplicateSavedList,
  listsForStore,
  mergeSavedLists,
  parsePriceMonitorBackup,
  parseSavedLists,
  parseSavedListsBackup,
  renameSavedList,
  removeSavedList,
  upsertSavedList,
} = require('./saved-lists');
const {
  addSearchHistory,
  clearSearchHistoryStore,
  historyForStore,
  mergeSearchHistory,
  parseSearchHistory,
} = require('./search-history');
const {
  filterAndSortProducts,
  productDiscount,
  productsToTsv,
  summarizeProducts,
} = require('./result-view');
const {
  compareWithSnapshot,
  createComparisonSnapshot,
  createSnapshotKey,
} = require('./comparison');
const { ComparisonStore, MAX_SNAPSHOTS } = require('./comparison-store');
const { ArchiveStore, buildProductPriceHistory, normalizeArchive, MAX_ARCHIVES, MAX_ARCHIVE_PRODUCTS } = require('./archive-store');
const { canCompareArchives, compareArchivedChecks } = require('./archive-tools');
const { buildPriceHistoryWorkbook } = require('./price-history-export');
const { buildCombinedArchiveWorkbook, buildFilteredArchiveWorkbook } = require('./multi-store-export');
const { buildCrossStoreChangeReport, buildChangeReportWorkbook } = require('./change-report');
const writeExcelFileModule = require('write-excel-file/node');
const writeExcelFile = writeExcelFileModule.default || writeExcelFileModule;

function workbookXmlEntries(buffer) {
  let offset = 0;
  const result = new Map();
  while (offset < buffer.length - 46) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) { offset += 1; continue; }
    const method = buffer.readUInt16LE(offset + 10);
    const length = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name.endsWith('.xml')) {
      const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
      const data = buffer.subarray(start, start + length);
      result.set(name, (method === 8 ? require('node:zlib').inflateRawSync(data) : data).toString('utf8'));
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

test('normalizes punctuation and letter case in brand names', () => {
  assert.equal(normalizeText('L’Oréal Paris'), normalizeText("l'oreal paris"));
});

test('keeps only valid EAN/GTIN values and preserves leading zeroes', () => {
  assert.equal(normalizeBarcode('3600531609764'), '3600531609764');
  assert.equal(normalizeBarcode('0 12345-678905'), '012345678905');
  assert.equal(normalizeBarcode('3600531609765'), '');
  assert.equal(normalizeBarcode('838794'), '');
  assert.equal(looksLikeBarcodeInput('3600 5316-09764'), true);
});

test('finds a MAKEUP product by barcode and verifies the exact code', async () => {
  const scraper = new PriceScraper({
    BrowserWindow: function BrowserWindow() {},
    cacheFile: path.join(os.tmpdir(), 'unused-price-monitor-barcode-cache.json'),
  });
  let receivedOptions;
  scraper.parseResolvedBrand = async (_store, _match, _progress, options) => {
    receivedOptions = options;
    return [
      { name: 'Lifter Gloss', brand: 'Maybelline New York', barcode: '3600531609764', url: 'https://example.com/right' },
      { name: 'Інший товар', brand: 'Maybelline New York', barcode: '4006381333931', url: 'https://example.com/wrong' },
    ];
  };

  const result = await scraper.parseBrand('makeup', '3600531609764');
  assert.equal(receivedOptions.includeBarcodes, true);
  assert.equal(receivedOptions.barcodeQuery, '3600531609764');
  assert.equal(result.matchedBy, 'barcode');
  assert.equal(result.brand, 'Maybelline New York');
  assert.deepEqual(result.products.map((product) => product.name), ['Lifter Gloss']);
});

test('rejects an invalid barcode and unsupported barcode stores before opening a catalog', async () => {
  const scraper = new PriceScraper({
    BrowserWindow: function BrowserWindow() {},
    cacheFile: path.join(os.tmpdir(), 'unused-price-monitor-invalid-barcode-cache.json'),
  });
  await assert.rejects(() => scraper.parseBrand('makeup', '3600531609765'), /контрольну цифру/);
  await assert.rejects(() => scraper.parseBrand('eva', '3600531609764'), /тільки для MAKEUP/);
});

test('creates, updates, filters and removes saved brand lists', () => {
  let lists = parseSavedLists('{broken json');
  assert.deepEqual(lists, []);
  let result = upsertSavedList(lists, {
    store: 'makeup', name: 'Щотижневий', query: 'Maybelline, Nivea',
    options: { includeVariants: true, includeBarcodes: true },
  }, () => 'list-1');
  lists = result.lists;
  assert.equal(result.item.id, 'list-1');
  assert.equal(result.item.options.includeVariants, true);
  assert.equal(result.item.options.includeBarcodes, true);
  assert.equal(result.item.options.includeSellers, false);

  result = upsertSavedList(lists, {
    store: 'makeup', name: 'щОТижневий', query: 'Maybelline, Nivea, Dior',
  }, () => 'must-not-be-used');
  lists = result.lists;
  assert.equal(lists.length, 1);
  assert.equal(lists[0].id, 'list-1');
  assert.equal(lists[0].query, 'Maybelline, Nivea, Dior');
  assert.equal(lists[0].options.includeBarcodes, true);

  lists = upsertSavedList(lists, {
    store: 'eva', name: 'Щотижневий', query: 'Nivea',
  }, () => 'list-2').lists;
  assert.deepEqual(listsForStore(lists, 'makeup').map((item) => item.id), ['list-1']);
  assert.deepEqual(removeSavedList(lists, 'list-1').map((item) => item.id), ['list-2']);
});

test('renames and duplicates a saved list without overwriting another one', () => {
  const source = [
    { id: 'list-1', store: 'makeup', name: 'Основний', query: 'Nivea', options: { includeBarcodes: true }, updatedAt: '' },
    { id: 'list-2', store: 'makeup', name: 'Другий', query: 'Dior', updatedAt: '' },
  ];
  const renamed = renameSavedList(source, 'list-1', 'Щотижневий');
  assert.equal(renamed.item.name, 'Щотижневий');
  assert.equal(renameSavedList(renamed.lists, 'list-1', 'дРУГИЙ').conflict, true);
  const duplicated = duplicateSavedList(renamed.lists, 'list-1', 'Щотижневий — копія', () => 'list-3');
  assert.equal(duplicated.item.id, 'list-3');
  assert.equal(duplicated.item.query, 'Nivea');
  assert.equal(duplicated.item.options.includeBarcodes, true);
  assert.equal(duplicated.lists.length, 3);
  assert.equal(duplicateSavedList(duplicated.lists, 'list-1', 'другий').conflict, true);
});

test('exports full data, reads legacy backups and safely merges saved lists', () => {
  const current = [{
    id: 'current-1', store: 'makeup', name: 'Щотижневий', query: 'Nivea', updatedAt: '2026-09-07T10:00:00.000Z',
  }];
  const backup = createSavedListsBackup([
    { id: 'import-1', store: 'makeup', name: 'щОТИЖНЕВИЙ', query: 'Nivea, Dior', updatedAt: '2026-09-08T10:00:00.000Z' },
    { id: 'current-1', store: 'eva', name: 'Догляд', query: 'Dove', updatedAt: '2026-09-08T10:01:00.000Z' },
  ], '2026-09-08T11:00:00.000Z', [{
    id: 'history-1', store: 'makeup', query: 'Nivea', searchedAt: '2026-09-08T10:30:00.000Z', productCount: 5,
  }], [{
    version: 1,
    key: 'makeup|nivea|fast',
    store: 'makeup',
    query: 'Nivea',
    options: {},
    capturedAt: '2026-09-08T10:30:00.000Z',
    products: [],
  }]);
  assert.equal(backup.kind, 'price-monitor-backup');
  assert.equal(backup.formatVersion, 4);
  const fullImport = parsePriceMonitorBackup(JSON.stringify(backup));
  assert.equal(fullImport.searchHistory.length, 1);
  assert.equal(fullImport.comparisonSnapshots.length, 1);
  assert.deepEqual(fullImport.archives, []);
  const imported = parseSavedListsBackup(JSON.stringify(backup));
  const merged = mergeSavedLists(current, imported, () => 'generated-2');
  assert.equal(merged.added, 1);
  assert.equal(merged.updated, 1);
  assert.equal(merged.skipped, 0);
  assert.equal(merged.lists.find((item) => item.store === 'makeup').query, 'Nivea, Dior');
  assert.equal(merged.lists.find((item) => item.store === 'eva').id, 'generated-2');
  assert.throws(() => parseSavedListsBackup('{broken'), /коректною резервною копією/);
  const legacy = parsePriceMonitorBackup(JSON.stringify({
    kind: 'saved-brand-lists', formatVersion: 1, lists: current,
  }));
  assert.equal(legacy.formatVersion, 1);
  assert.deepEqual(legacy.searchHistory, []);
  assert.deepEqual(legacy.comparisonSnapshots, []);
  const versionTwo = parsePriceMonitorBackup(JSON.stringify({
    kind: 'price-monitor-backup', formatVersion: 2, lists: current, searchHistory: [],
  }));
  assert.equal(versionTwo.formatVersion, 2);
  assert.deepEqual(versionTwo.comparisonSnapshots, []);
  assert.deepEqual(versionTwo.archives, []);
  const versionThree = parsePriceMonitorBackup({
    kind: 'price-monitor-backup', formatVersion: 3, lists: current, searchHistory: [], comparisonSnapshots: [],
  });
  assert.deepEqual(versionThree.archives, []);
  assert.throws(() => parseSavedListsBackup(JSON.stringify({ hello: 'world' })), /не функцією резервного копіювання/);
  assert.throws(() => parsePriceMonitorBackup(JSON.stringify({
    kind: 'price-monitor-backup', formatVersion: 2, lists: [], searchHistory: 'broken',
  })), /пошкоджену історію/);
  assert.throws(() => parsePriceMonitorBackup(JSON.stringify({
    kind: 'price-monitor-backup', formatVersion: 3, lists: [], searchHistory: [], comparisonSnapshots: 'broken',
  })), /пошкоджені знімки/);
});

test('normalizes archive data and labels product-count truncation honestly', () => {
  const record = normalizeArchive({
    id: 'a1', store: 'makeup', query: 'Nivea', capturedAt: '2026-09-17T12:00:00Z',
    products: Array.from({ length: MAX_ARCHIVE_PRODUCTS + 1 }, (_, index) => ({
      name: `Product ${index}`, priceWithDiscount: 10, priceWithoutDiscount: 20,
    })),
  });
  assert.equal(record.products.length, MAX_ARCHIVE_PRODUCTS);
  assert.equal(record.sourceCount, MAX_ARCHIVE_PRODUCTS + 1);
  assert.equal(record.truncated, true);
  assert.equal(record.products[0].priceWithoutDiscount, 20);
  assert.equal(normalizeArchive({ ...record, store: 'unknown' }), null);
  assert.equal(normalizeArchive({ ...record, capturedAt: '' }), null);
});

test('builds chronological price history without mixing stores, variants or sellers', () => {
  const product = { name: 'Gloss', barcode: '3600531609764', variant: '002 Ice', seller: 'Shop A', url: 'https://example.com/gloss' };
  const record = (id, day, row, store = 'makeup') => ({
    id, store, query: 'Maybelline', capturedAt: `2026-09-${day}T12:00:00Z`, products: [row],
  });
  const points = buildProductPriceHistory([
    record('later', '17', { ...product, priceWithDiscount: 80, priceWithoutDiscount: 100 }),
    record('earlier', '15', { ...product, barcode: '', priceWithDiscount: null, priceWithoutDiscount: 90 }),
    record('wrong-store', '16', { ...product, priceWithoutDiscount: 12 }, 'eva'),
    record('wrong-variant', '16', { ...product, variant: '003', priceWithoutDiscount: 15 }),
    record('wrong-seller', '16', { ...product, seller: 'Shop B', priceWithoutDiscount: 17 }),
    record('wrong-code', '16', { ...product, barcode: '012345678905', priceWithoutDiscount: 20 }),
  ], 'makeup', product);
  assert.deepEqual(points.map((point) => point.price), [90, 80]);
  assert.deepEqual(points.map((point) => point.archiveId), ['earlier', 'later']);
});

test('allows only chronological, complete archive comparisons with matching store, query and modes', () => {
  const previous = { id: 'a', store: 'makeup', query: 'Nivea, Dove', options: { includeVariants: true }, capturedAt: '2026-09-15T12:00:00Z' };
  const current = { ...previous, id: 'b', query: 'dove; NIVEA', capturedAt: '2026-09-16T12:00:00Z' };
  assert.equal(canCompareArchives(previous, current), true);
  for (const invalid of [
    { id: 'a' }, { store: 'eva' }, { query: 'Nivea' }, { options: {} },
    { capturedAt: previous.capturedAt }, { capturedAt: '2026-09-14T12:00:00Z' },
    { capturedAt: 'invalid' }, { truncated: true }, { complete: false },
  ]) assert.equal(canCompareArchives(previous, { ...current, ...invalid }), false);
  assert.equal(canCompareArchives({ ...previous, truncated: true }, current), false);
  assert.equal(canCompareArchives(null, current), false);
  assert.throws(() => compareArchivedChecks(previous, current), /дві повні/);
});

test('compares chosen archive dates without changing their rows or treating missing products as zero', () => {
  const product = (id, value, seller = 'UA', variant = '002') => ({ name: id, brand: 'Maybelline', url: `https://makeup.com.ua/product/${id}/`, seller, variant, priceWithoutDiscount: value });
  const previous = {
    id: 'a', store: 'makeup', query: 'Maybelline', options: { includeVariants: true }, capturedAt: '2026-09-15T12:00:00Z',
    products: [product('cheap', 100), product('expensive', 100), product('same', 100), product('gone', 200), product('cheap', 300, 'EU')],
  };
  const current = {
    ...previous, id: 'b', capturedAt: '2026-09-16T12:00:00Z',
    products: [product('cheap', 80), product('expensive', 110), product('same', 100), product('new', 50), product('cheap', 310, 'EU')],
  };
  const untouched = JSON.stringify([previous, current]);
  const result = compareArchivedChecks(previous, current);
  assert.deepEqual(result.summary, { new: 1, cheaper: 1, expensive: 2, unchanged: 1, missing: 1 });
  assert.equal(result.products[0].previousPrice, 100);
  assert.equal(result.products[0].priceDifference, -20);
  assert.equal(result.products[4].previousPrice, 300);
  assert.equal(result.missing[0].previousPrice, 200);
  assert.equal(result.products.some((item) => item.name === 'gone'), false);
  assert.equal(result.source, 'archive');
  assert.equal(result.previousCapturedAt, new Date(previous.capturedAt).toISOString());
  assert.equal(result.comparedCapturedAt, current.capturedAt);
  assert.equal(JSON.stringify([previous, current]), untouched);
});

test('builds a chronological price-history workbook with separate promo prices and text barcode', async () => {
  const sheets = buildPriceHistoryWorkbook({
    storeLabel: 'Notino', product: { name: '=SUM(A1)', brand: 'Brand', barcode: '012345678905', variant: '002', seller: 'UA' },
    points: [
      { archiveId: 'b', capturedAt: '2026-09-16T12:00:00Z', price: 100, regularPrice: 140, promoPrice: 80, promotionCondition: 'За промокодом', query: 'Brand' },
      { archiveId: 'a', capturedAt: '2026-09-15T12:00:00Z', price: 120, regularPrice: 150, query: 'Brand' },
    ],
  });
  assert.equal(sheets[0].data[1][0], '2026-09-15T12:00:00Z');
  assert.equal(sheets[0].data[1][3], null);
  assert.equal(sheets[0].data[2][3].value, -20);
  assert.equal(sheets[0].data[2][4].value, 80);
  assert.equal(sheets[1].data.find((row) => row[0] === 'Штрихкод')[1], '012345678905');
  const entries = workbookXmlEntries(await writeExcelFile(sheets).toBuffer());
  const xml = [...entries.values()].join('\n');
  assert.match(xml, /Історія ціни/);
  assert.match(xml, /Локальний архів — не поточні ціни та залишки/);
  assert.match(xml, /012345678905/);
  assert.match(xml, /<v>-20<\/v>/);
  assert.match(xml, /<v>80<\/v>/);
  assert.doesNotMatch(xml, /<f[ >]/);
  assert.throws(() => buildPriceHistoryWorkbook({ points: [] }), /Немає збережених цін/);
});

test('builds a multi-store archive workbook with dated rows, numeric prices and explicit source limits', async () => {
  const base = {
    id: 'eva-check', store: 'eva', query: 'Nivea', capturedAt: '2026-09-15T12:00:00Z',
    sourceCount: 3, truncated: true, options: { includeVariants: true },
    products: [{ name: '=SUM(A1)', brand: 'Nivea', barcode: '012345678905', variant: 'Rose',
      priceWithDiscount: 80, priceWithoutDiscount: 100, url: 'https://eva.ua/product/1/' }],
  };
  const makeup = {
    id: 'makeup-check', store: 'makeup', query: 'Maybelline', capturedAt: '2026-09-16T15:00:00Z',
    sourceCount: 1, truncated: false, options: { includeBarcodes: true },
    products: [{ name: 'Gloss', brand: 'Maybelline', barcode: '3600531609764',
      priceWithDiscount: null, priceWithoutDiscount: 239, promoPrice: 200,
      promotionCondition: 'З промокодом', url: 'https://makeup.com.ua/product/2/' }],
  };
  const unchanged = JSON.stringify([base, makeup]);
  const sheets = buildCombinedArchiveWorkbook([base, makeup], STORES);
  assert.equal(sheets[0].data.length, 3);
  assert.equal(sheets[0].data[1][0], 'EVA');
  assert.equal(sheets[0].data[1][1], base.capturedAt);
  assert.equal(sheets[0].data[1][5], '012345678905');
  assert.equal(sheets[0].data[1][8].value, 80);
  assert.equal(sheets[0].data[1][11].value, 20);
  assert.equal(sheets[0].data[1][12].value, 20);
  assert.equal(sheets[0].data[2][8].value, 239);
  assert.equal(sheets[0].data[2][9], null);
  assert.equal(sheets[0].data[2][13].value, 200);
  assert.equal(sheets[0].data[2][14], 'З промокодом');
  assert.equal(sheets[1].data[5][5], 3);
  assert.match(sheets[1].data[5][6], /частина рядків/);
  const xml = [...workbookXmlEntries(await writeExcelFile(sheets).toBuffer()).values()].join('\n');
  assert.match(xml, /Локальний архів — не поточні ціни та залишки/);
  assert.match(xml, /2026-09-15T12:00:00Z/);
  assert.match(xml, /2026-09-16T15:00:00Z/);
  assert.match(xml, /012345678905/);
  assert.match(xml, /<v>239<\/v>/);
  assert.match(xml, /<v>20<\/v>/);
  assert.doesNotMatch(xml, /<f[ >]/);
  assert.equal(JSON.stringify([base, makeup]), unchanged);
  assert.throws(() => buildCombinedArchiveWorkbook([base], STORES), /від двох до шести/);
  assert.throws(() => buildCombinedArchiveWorkbook([base, { ...base, id: 'other' }], STORES), /одну дійсну/);
  assert.throws(() => buildCombinedArchiveWorkbook([base, { ...makeup, products: [] }], STORES), /одну дійсну/);
});

test('builds one workbook from every archive visible after filters, including repeated stores', async () => {
  const records = [
    {
      id: 'eva-new', store: 'eva', query: 'Nivea', capturedAt: '2026-09-20T12:00:00Z',
      sourceCount: 1, options: {}, products: [{ name: 'Крем', brand: 'Nivea', barcode: '012345678905',
        priceWithDiscount: 80, priceWithoutDiscount: 100, url: 'https://eva.ua/1/' }],
    },
    {
      id: 'eva-old', store: 'eva', query: 'Nivea', capturedAt: '2026-09-19T12:00:00Z',
      sourceCount: 1, options: {}, products: [{ name: 'Крем', brand: 'Nivea', barcode: '012345678905',
        priceWithoutDiscount: 110, url: 'https://eva.ua/1/' }],
    },
    {
      id: 'makeup', store: 'makeup', query: 'Maybelline', capturedAt: '2026-09-18T12:00:00Z',
      sourceCount: 1, options: { includeBarcodes: true }, products: [{ name: 'Помада', brand: 'Maybelline',
        barcode: '3600531609764', priceWithoutDiscount: 239, url: 'https://makeup.com.ua/1/' }],
    },
  ];
  const before = JSON.stringify(records);
  const sheets = buildFilteredArchiveWorkbook(records, STORES);
  assert.equal(sheets[0].sheet, 'Архівні товари');
  assert.equal(sheets[1].sheet, 'Вибрані перевірки');
  assert.equal(sheets[0].data.length, 4);
  assert.equal(sheets[0].data[1][5], '012345678905');
  assert.equal(sheets[0].data[1][8].value, 80);
  assert.equal(sheets[0].data[1][11].value, 20);
  assert.equal(sheets[1].data.length, 9);
  const xml = [...workbookXmlEntries(await writeExcelFile(sheets).toBuffer()).values()].join('\n');
  assert.match(xml, /всі перевірки, які були видимі після фільтрів/);
  assert.match(xml, /2026-09-19T12:00:00Z/);
  assert.match(xml, /3600531609764/);
  assert.doesNotMatch(xml, /<f[ >]/);
  assert.equal(JSON.stringify(records), before);
  assert.throws(() => buildFilteredArchiveWorkbook([], STORES), /немає перевірок/);
  assert.throws(() => buildFilteredArchiveWorkbook([records[0], records[0]], STORES), /повторену/);
});

test('selects the latest compatible archive pair per store and keeps missing offers separate', () => {
  const p = (id, price, seller = '') => ({ name: id, brand: 'Brand', seller,
    url: `https://example.com/${id}`, priceWithoutDiscount: price });
  const record = (id, store, date, products, extra = {}) => ({
    id, store, query: 'Brand', capturedAt: date, options: {}, products, ...extra,
  });
  const archives = [
    record('eva-old', 'eva', '2026-09-10T12:00:00Z', [p('old', 100), p('gone', 200)]),
    record('eva-later', 'eva', '2026-09-11T12:00:00Z', [p('old', 80), p('new', 50)]),
    record('eva-mismatch', 'eva', '2026-09-12T12:00:00Z', [p('old', 75)], { options: { includeVariants: true } }),
    record('eva-truncated', 'eva', '2026-09-13T12:00:00Z', [p('old', 70)], { truncated: true }),
    record('makeup-old', 'makeup', '2026-09-15T12:00:00Z', [p('gloss', 100, 'UA'), p('gloss', 110, 'EU')]),
    record('makeup-new', 'makeup', '2026-09-16T12:00:00Z', [p('gloss', 120, 'UA'), p('gloss', 110, 'EU')]),
    record('notino-alone', 'notino', '2026-09-15T12:00:00Z', [p('perfume', 200)]),
  ];
  const before = JSON.stringify(archives);
  const report = buildCrossStoreChangeReport(archives, STORES);
  const eva = report.storeReports.find((item) => item.store === 'eva');
  const makeup = report.storeReports.find((item) => item.store === 'makeup');
  assert.equal(eva.previousId, 'eva-old');
  assert.equal(eva.currentId, 'eva-later');
  assert.deepEqual(eva.summary, { new: 1, cheaper: 1, expensive: 0, unchanged: 0, missing: 1 });
  assert.deepEqual(makeup.summary, { new: 0, cheaper: 0, expensive: 1, unchanged: 1, missing: 0 });
  assert.equal(report.storeReports.find((item) => item.store === 'notino').comparable, false);
  assert.equal(report.storeReports.find((item) => item.store === 'varus').comparable, false);
  assert.deepEqual(report.rows.map((item) => item.status).sort(), ['cheaper', 'expensive', 'missing', 'new']);
  assert.equal(report.rows.find((item) => item.status === 'missing').currentPrice, null);
  assert.equal(report.rows.find((item) => item.store === 'makeup').seller, 'UA');
  assert.equal(report.rows.find((item) => item.store === 'makeup').difference, 20);
  assert.equal(JSON.stringify(archives), before);
});

test('builds a strict UTC date-period report from the earliest and latest compatible checks inside its bounds', () => {
  const product = (price) => ({ name: 'Gloss', brand: 'Brand', url: 'https://example.com/gloss', priceWithoutDiscount: price });
  const record = (id, date, price, options = {}) => ({
    id, store: 'eva', query: 'Brand', capturedAt: date, options, products: [product(price)],
  });
  const archives = [
    record('outside-before', '2026-09-09T23:59:59Z', 200),
    record('period-start', '2026-09-10T00:00:00Z', 150),
    record('period-middle', '2026-09-15T12:00:00Z', 120),
    record('period-end', '2026-09-20T23:59:59Z', 100),
    record('newer-incompatible', '2026-09-20T23:59:59Z', 90, { includeVariants: true }),
    record('outside-after', '2026-09-21T00:00:00Z', 80),
  ];
  const report = buildCrossStoreChangeReport(archives, STORES, { from: '2026-09-10', to: '2026-09-20' });
  const eva = report.storeReports.find((item) => item.store === 'eva');
  assert.deepEqual(report.period, { active: true, from: '2026-09-10', to: '2026-09-20' });
  assert.equal(eva.previousId, 'period-start');
  assert.equal(eva.currentId, 'period-end');
  assert.equal(eva.checkCount, 4);
  assert.equal(eva.totalCheckCount, 6);
  assert.equal(report.rows[0].difference, -50);
  assert.throws(() => buildCrossStoreChangeReport(archives, STORES, { from: '2026-09-10' }), /обидві дати/);
  assert.throws(() => buildCrossStoreChangeReport(archives, STORES, { from: '2026-09-20', to: '2026-09-10' }), /не може бути пізнішою/);
  assert.throws(() => buildCrossStoreChangeReport(archives, STORES, { from: '2026-02-30', to: '2026-03-01' }), /неіснуючу дату/);
});

test('exports all cross-store changes, missing items and archive dates in three Excel sheets', async () => {
  const report = buildCrossStoreChangeReport([
    { id: 'before', store: 'eva', query: 'Brand', capturedAt: '2026-09-10T12:00:00Z', options: {},
      products: [
        { name: 'Gloss', brand: 'Brand', barcode: '012345678905', url: 'https://eva.ua/1', priceWithoutDiscount: 100 },
        { name: 'Gone', brand: 'Brand', url: 'https://eva.ua/2', priceWithoutDiscount: 200 },
      ] },
    { id: 'after', store: 'eva', query: 'Brand', capturedAt: '2026-09-11T12:00:00Z', options: {},
      products: [{ name: 'Gloss', brand: 'Brand', barcode: '012345678905', url: 'https://eva.ua/1', priceWithoutDiscount: 80 }] },
  ], STORES);
  const sheets = buildChangeReportWorkbook(report);
  assert.equal(sheets.length, 3);
  assert.equal(sheets[0].data.length, 2);
  assert.equal(sheets[1].data.length, 2);
  assert.equal(sheets[0].data[1][6], '012345678905');
  assert.equal(sheets[0].data[1][10].value, 100);
  assert.equal(sheets[0].data[1][11].value, 80);
  assert.equal(sheets[0].data[1][12].value, -20);
  assert.equal(sheets[1].data[1][11], null);
  const xml = [...workbookXmlEntries(await writeExcelFile(sheets).toBuffer()).values()].join('\n');
  assert.match(xml, /Зникли з видачі/);
  assert.match(xml, /Локальний архів — не поточні ціни та залишки/);
  assert.match(xml, /2026-09-10T12:00:00Z/);
  assert.match(xml, /2026-09-11T12:00:00Z/);
  assert.match(xml, /012345678905/);
  assert.match(xml, /<v>-20<\/v>/);
  assert.doesNotMatch(xml, /<f[ >]/);
  assert.throws(() => buildChangeReportWorkbook({ storeReports: [], rows: [] }), /Немає сумісних/);
});

test('persists bounded archives, restores a backup and merges without deleting current records', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-archive-'));
  try {
    const store = new ArchiveStore(path.join(directory, 'archive.json'));
    const record = (id, time) => ({
      id, store: 'eva', query: 'Nivea', capturedAt: new Date(time).toISOString(),
      products: [{ name: id, url: `https://example.com/${id}`, priceWithoutDiscount: 100 }],
    });
    for (let index = 0; index < MAX_ARCHIVES + 2; index += 1) {
      store.save(record(`archive-${index}`, Date.UTC(2026, 8, 1) + index * 60_000));
    }
    assert.equal(store.list().length, MAX_ARCHIVES);
    assert.equal(store.get('archive-0'), null);
    assert.equal(store.list()[0].productCount, 1);
    assert.equal(Object.hasOwn(store.list()[0], 'products'), false);
    const merged = store.merge([record('imported', Date.UTC(2026, 8, 17)), store.get('archive-61')]);
    assert.equal(merged.added, 1);
    assert.equal(store.get('archive-61').products[0].name, 'archive-61');
    const backup = createSavedListsBackup([], '2026-09-17T12:00:00Z', [], [], store.all());
    assert.equal(parsePriceMonitorBackup(JSON.stringify(backup)).archives.length, MAX_ARCHIVES);
    fs.writeFileSync(store.filePath, '{broken');
    assert.equal(store.all().length, MAX_ARCHIVES);
    assert.throws(() => parsePriceMonitorBackup({ ...backup, archives: 'broken' }), /пошкоджений архів/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('removes exact archive records without touching the rest and can merge them back', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-archive-delete-'));
  try {
    const store = new ArchiveStore(path.join(directory, 'archive.json'));
    const record = (id, date) => ({ id, store: 'eva', query: 'Brand', capturedAt: date, options: {},
      products: [{ name: id, brand: 'Brand', priceWithoutDiscount: 100, url: `https://example.com/${id}` }] });
    store.save(record('keep', '2026-09-20T12:00:00Z'));
    store.save(record('delete-a', '2026-09-21T12:00:00Z'));
    store.save(record('delete-b', '2026-09-22T12:00:00Z'));
    const result = store.removeMany(['delete-a', 'delete-b']);
    assert.equal(result.removed.length, 2);
    assert.equal(result.total, 1);
    assert.deepEqual(store.all().map((item) => item.id), ['keep']);
    assert.ok(fs.existsSync(`${store.filePath}.bak`));
    assert.deepEqual(store.removeMany(['missing']), { removed: [], total: 1 });
    assert.deepEqual(store.merge(result.removed), { added: 2, total: 3 });
    assert.deepEqual(store.all().map((item) => item.id), ['delete-b', 'delete-a', 'keep']);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('keeps recent searches per store and refreshes a repeated query', () => {
  let sequence = 0;
  const createId = () => `history-${++sequence}`;
  const now = () => `2026-09-08T10:${String(sequence).padStart(2, '0')}:00.000Z`;
  let history = parseSearchHistory('{broken');
  for (let index = 0; index < 14; index += 1) {
    history = addSearchHistory(history, {
      store: 'makeup', query: `Марка ${index}`, productCount: index,
      options: { includeBarcodes: index % 2 === 0 },
    }, createId, now).history;
  }
  history = addSearchHistory(history, {
    store: 'eva', query: 'Nivea', productCount: 8, outcome: 'success',
  }, createId, now).history;
  history = addSearchHistory(history, {
    store: 'makeup', query: 'марка 13', productCount: 99, outcome: 'stopped',
    options: { includeVariants: true },
  }, createId, now).history;
  const makeup = historyForStore(history, 'makeup');
  assert.equal(makeup.length, 12);
  assert.equal(makeup[0].query, 'марка 13');
  assert.equal(makeup[0].productCount, 99);
  assert.equal(makeup[0].outcome, 'stopped');
  assert.equal(makeup[0].options.includeVariants, true);
  assert.equal(historyForStore(history, 'eva').length, 1);
  assert.equal(historyForStore(clearSearchHistoryStore(history, 'makeup'), 'makeup').length, 0);
  assert.equal(historyForStore(clearSearchHistoryStore(history, 'makeup'), 'eva').length, 1);
});

test('merges imported history by query and keeps the newest result', () => {
  const current = [{
    id: 'h1', store: 'makeup', query: 'Nivea', searchedAt: '2026-09-08T10:00:00.000Z', productCount: 4,
  }];
  const imported = [
    { id: 'h2', store: 'makeup', query: 'nIVEA', searchedAt: '2026-09-09T10:00:00.000Z', productCount: 9 },
    { id: 'h1', store: 'eva', query: 'Dove', searchedAt: '2026-09-09T11:00:00.000Z', productCount: 3 },
  ];
  const merged = mergeSearchHistory(current, imported);
  assert.equal(merged.added, 1);
  assert.equal(merged.updated, 1);
  assert.equal(historyForStore(merged.history, 'makeup')[0].productCount, 9);
  assert.equal(historyForStore(merged.history, 'eva')[0].query, 'Dove');
  assert.notEqual(historyForStore(merged.history, 'eva')[0].id, 'h1');
});

test('filters result fields and sorts prices without changing source products', () => {
  const products = [
    { name: 'Помада', brand: 'Maybelline', variant: 'Ice', barcode: '3600531609764', priceWithDiscount: 281 },
    { name: 'Крем', brand: 'Nivea', seller: 'Rozetka', priceWithDiscount: 120 },
    { name: 'Туш', brand: 'Maybelline', promotionCondition: 'Промокод BEAUTY', priceWithDiscount: 350 },
    { name: 'Без ціни', brand: 'Test', priceWithDiscount: '' },
  ];
  assert.deepEqual(filterAndSortProducts(products, 'ice', 'original').map((item) => item.name), ['Помада']);
  assert.deepEqual(filterAndSortProducts(products, 'rozetka', 'original').map((item) => item.name), ['Крем']);
  assert.deepEqual(filterAndSortProducts(products, 'beauty', 'original').map((item) => item.name), ['Туш']);
  assert.deepEqual(filterAndSortProducts(products, '', 'price-asc').map((item) => item.name), ['Крем', 'Помада', 'Туш', 'Без ціни']);
  assert.deepEqual(filterAndSortProducts(products, '', 'price-desc').map((item) => item.name), ['Туш', 'Помада', 'Крем', 'Без ціни']);
  const changedProducts = products.map((item, index) => ({
    ...item, comparisonStatus: index === 0 ? 'cheaper' : 'unchanged',
  }));
  assert.deepEqual(filterAndSortProducts(changedProducts, '', 'original', 'cheaper').map((item) => item.name), ['Помада']);
  assert.deepEqual(products.map((item) => item.name), ['Помада', 'Крем', 'Туш', 'Без ціни']);
});

test('calculates discounts, filters price ranges and copies a safe Excel-ready table', () => {
  const products = [
    { name: 'Помада', brand: 'Maybelline', priceWithDiscount: 80, priceWithoutDiscount: 100, url: 'https://example.com/a' },
    { name: 'Крем', brand: 'Nivea', priceWithDiscount: null, priceWithoutDiscount: 60, url: 'https://example.com/b' },
    { name: '=Небезпечна назва', brand: 'Test', priceWithDiscount: 90, priceWithoutDiscount: 120, url: 'https://example.com/c' },
    { name: 'Без ціни', brand: 'Test', priceWithDiscount: '', priceWithoutDiscount: '' },
  ];
  assert.deepEqual(productDiscount(products[0]), { amount: 20, percent: 20 });
  assert.equal(productDiscount(products[1]), null);
  assert.deepEqual(
    filterAndSortProducts(products, '', 'original', 'all', 'discounted').map((item) => item.name),
    ['Помада', '=Небезпечна назва'],
  );
  assert.deepEqual(
    filterAndSortProducts(products, '', 'original', 'all', 'all', '70', '95').map((item) => item.name),
    ['Помада', '=Небезпечна назва'],
  );
  assert.deepEqual(
    filterAndSortProducts(products, '', 'discount-desc').map((item) => item.name),
    ['=Небезпечна назва', 'Помада', 'Крем', 'Без ціни'],
  );
  assert.deepEqual(summarizeProducts(products), {
    total: 4,
    discountedCount: 2,
    cheapestPrice: 60,
    largestDiscountPercent: 25,
  });
  const copied = productsToTsv(products.slice(0, 1), 'MAKEUP');
  assert.match(copied, /Економія\tЗнижка, %/);
  assert.match(copied, /Помада\tMaybelline/);
  assert.match(productsToTsv(products.slice(2, 3), 'MAKEUP'), /'=Небезпечна назва/);
});

test('compares the same search with its previous snapshot', () => {
  const key = createSnapshotKey('makeup', 'Nivea, Maybelline', { includeBarcodes: true });
  assert.equal(key, createSnapshotKey('MAKEUP', 'maybelline; NIVEA', { includeBarcodes: true }));
  const previous = createComparisonSnapshot({
    key,
    store: 'makeup',
    query: 'Nivea, Maybelline',
    options: { includeBarcodes: true },
    capturedAt: '2026-09-09T10:00:00.000Z',
    products: [
      { name: 'A', brand: 'Nivea', url: 'https://example.com/a', priceWithDiscount: 100 },
      { name: 'B', brand: 'Nivea', url: 'https://example.com/b', priceWithDiscount: 200 },
      { name: 'C', brand: 'Nivea', url: 'https://example.com/c', priceWithDiscount: 300 },
      { name: 'D', brand: 'Nivea', url: 'https://example.com/d', priceWithDiscount: 400 },
    ],
  });
  const result = compareWithSnapshot([
    { name: 'A', brand: 'Nivea', url: 'https://example.com/a', priceWithDiscount: 90 },
    { name: 'B', brand: 'Nivea', url: 'https://example.com/b', priceWithDiscount: 250 },
    { name: 'C', brand: 'Nivea', url: 'https://example.com/c', priceWithDiscount: 300 },
    { name: 'E', brand: 'Nivea', url: 'https://example.com/e', priceWithDiscount: 50 },
  ], previous);
  assert.equal(result.baseline, false);
  assert.deepEqual(result.summary, { new: 1, cheaper: 1, expensive: 1, unchanged: 1, missing: 1 });
  assert.equal(result.products.find((item) => item.name === 'A').priceDifference, -10);
  assert.equal(result.products.find((item) => item.name === 'B').previousPrice, 200);
  assert.equal(result.products.find((item) => item.name === 'E').comparisonLabel, 'Новий товар');
  assert.deepEqual(result.missing.map((item) => item.name), ['D']);
  assert.equal(compareWithSnapshot([{ name: 'A', url: 'https://example.com/a', priceWithDiscount: 90 }], null).baseline, true);
});

test('persists a bounded set of comparison snapshots with a backup file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-comparisons-'));
  try {
    const filePath = path.join(directory, 'comparisons.json');
    const store = new ComparisonStore(filePath);
    for (let index = 0; index < MAX_SNAPSHOTS + 2; index += 1) {
      store.save(createComparisonSnapshot({
        key: `eva|brand-${index}|fast`,
        store: 'eva',
        query: `Brand ${index}`,
        capturedAt: `2026-09-09T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
        products: [{ name: `Product ${index}`, url: `https://example.com/${index}`, priceWithDiscount: index + 1 }],
      }));
    }
    assert.equal(store.read().length, MAX_SNAPSHOTS);
    assert.equal(store.all().length, MAX_SNAPSHOTS);
    assert.equal(store.get(`eva|brand-${MAX_SNAPSHOTS + 1}|fast`).products[0].name, `Product ${MAX_SNAPSHOTS + 1}`);
    const mergeResult = store.merge([createComparisonSnapshot({
      key: `eva|brand-${MAX_SNAPSHOTS + 1}|fast`,
      store: 'eva',
      query: `Brand ${MAX_SNAPSHOTS + 1}`,
      capturedAt: '2026-09-10T10:00:00.000Z',
      products: [{ name: 'Updated product', url: 'https://example.com/updated', priceWithDiscount: 99 }],
    }), createComparisonSnapshot({
      key: 'makeup|new-brand|fast',
      store: 'makeup',
      query: 'New Brand',
      capturedAt: '2026-09-10T11:00:00.000Z',
      products: [{ name: 'New product', url: 'https://example.com/new', priceWithDiscount: 50 }],
    })]);
    assert.equal(mergeResult.added, 1);
    assert.equal(mergeResult.updated, 1);
    assert.equal(mergeResult.total, MAX_SNAPSHOTS);
    assert.equal(store.get(`eva|brand-${MAX_SNAPSHOTS + 1}|fast`).products[0].name, 'Updated product');
    assert.equal(store.get('makeup|new-brand|fast').products[0].name, 'New product');
    assert.equal(fs.existsSync(`${filePath}.bak`), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ranks a brand with a small typo first', () => {
  const brands = [
    { name: 'Nivea', url: 'https://example.com/nivea' },
    { name: "L'Oreal Paris", url: 'https://example.com/loreal' },
    { name: 'Maybelline New York', url: 'https://example.com/maybelline' },
  ];
  const result = rankBrands(brands, 'Loreel Paris');
  assert.equal(result[0].item.name, "L'Oreal Paris");
  assert.ok(result[0].score > 0.7);
});

test('removes duplicated products by URL', () => {
  const products = [
    { name: 'Товар 1', brand: 'Марка', url: 'https://example.com/1' },
    { name: 'Товар 1', brand: 'Марка', url: 'https://example.com/1' },
    { name: 'Товар 2', brand: 'Марка', url: 'https://example.com/2' },
  ];
  assert.equal(deduplicateProducts(products).length, 2);
});

test('keeps separate seller offers that share the same product URL', () => {
  const products = [
    { name: 'Товар', brand: 'Марка', seller: 'Rozetka', url: 'https://example.com/1' },
    { name: 'Товар', brand: 'Марка', seller: 'Інший продавець', url: 'https://example.com/1' },
    { name: 'Товар', brand: 'Марка', seller: 'Rozetka', url: 'https://example.com/1' },
  ];
  assert.equal(deduplicateProducts(products).length, 2);
});

test('splits comma, semicolon and newline separated brands and removes duplicates', () => {
  assert.deepEqual(
    splitBrandQueries('Nivea, Dove; l\'oreal paris\nNIVEA'),
    ['Nivea', 'Dove', "l'oreal paris"],
  );
});

test('autocomplete reads and replaces only the active brand segment', () => {
  assert.equal(activeBrandSegment('Nivea, lore'), 'lore');
  assert.equal(replaceActiveBrandSegment('Nivea, lore', "L'Oreal Paris"), "Nivea, L'Oreal Paris");
});

test('merges batch products without duplicating the same product URL', () => {
  const current = [{ name: 'Товар 1', brand: 'A', url: 'https://example.com/1' }];
  const incoming = [
    { name: 'Товар 1', brand: 'A', url: 'https://example.com/1' },
    { name: 'Товар 2', brand: 'B', url: 'https://example.com/2' },
  ];
  assert.equal(mergeProducts(current, incoming).length, 2);
});

test('batch search continues after one brand fails', async () => {
  const result = await runBrandBatch('Nivea, Missing, Dove', async (query) => {
    if (query === 'Missing') throw new Error('Brand not found');
    return {
      brand: query,
      products: [{ name: `${query} product`, brand: query, url: `https://example.com/${query}` }],
    };
  });
  assert.deepEqual(result.successes.map((item) => item.brand), ['Nivea', 'Dove']);
  assert.deepEqual(result.failures, [{ query: 'Missing', message: 'Brand not found' }]);
  assert.equal(result.products.length, 2);
});

test('batch search keeps products returned by a cancelled brand', async () => {
  const result = await runBrandBatch('Xiaomi', async () => ({
    brand: 'Xiaomi',
    cancelled: true,
    products: [{ name: 'Зібраний товар', brand: 'Xiaomi', url: 'https://example.com/1' }],
  }));
  assert.equal(result.stopped, true);
  assert.equal(result.products.length, 1);
  assert.equal(result.failures.length, 0);
});

test('removes the Electron IPC prefix from user-facing errors', () => {
  assert.equal(
    cleanParserError(new Error("Error invoking remote method 'products:parse': Error: Каталог не завантажився.")),
    'Каталог не завантажився.',
  );
});

test('retries transient catalog failures but not valid empty results', () => {
  assert.equal(isRetryableLoadError(new Error('Каталог не завантажився (Трохи зачекайте…).')), true);
  assert.equal(isRetryableLoadError(new Error('На сторінці марки «Test» товари не знайдено.')), false);
});

test('configures Aurora as a session-independent catalog search', () => {
  assert.equal(STORES.aurora.label, 'Аврора');
  assert.equal(STORES.aurora.host, 'avrora.ua');
  assert.match(STORES.aurora.fallbackSearchUrl, /dispatch=products\.search/);
  assert.match(STORES.aurora.fallbackSearchUrl, /status=A/);
  assert.doesNotMatch(STORES.aurora.fallbackSearchUrl, /security_hash/);
});

test('configures Notino with a brand directory and Ukrainian catalog', () => {
  assert.equal(STORES.notino.label, 'Notino');
  assert.equal(STORES.notino.host, 'notino.ua');
  assert.match(STORES.notino.brandIndexUrl, /notino\.ua\/kosmetychni-brendy/);
});

test('configures Rozetka through Ukrainian search without a browser dependency', () => {
  assert.equal(STORES.rozetka.label, 'Rozetka');
  assert.equal(STORES.rozetka.host, 'rozetka.com.ua');
  assert.equal(STORES.rozetka.brandIndexUrl, null);
  assert.match(STORES.rozetka.fallbackSearchUrl, /rozetka\.com\.ua\/ua\/search\/\?text=/);
});

test('creates a valid Excel workbook buffer', async () => {
  const buffer = await writeExcelFile([
    [{ value: 'Название товара', fontWeight: 'bold', backgroundColor: '#2F6F4E', textColor: '#FFFFFF' }],
    ['Тестовый товар'],
  ], {
    sheet: 'Мониторинг цен',
    columns: [{ width: 40 }],
    stickyRowsCount: 1,
  }).toBuffer();
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
});

test('creates a multi-sheet comparison workbook buffer', async () => {
  const buffer = await writeExcelFile([
    {
      data: [[{ value: 'Поточні товари', fontWeight: 'bold' }], ['Товар']],
      sheet: 'Моніторинг цін',
      columns: [{ width: 40 }],
    },
    {
      data: [[{ value: 'Зникли з видачі', fontWeight: 'bold' }], ['Старий товар']],
      sheet: 'Зникли з видачі',
      columns: [{ width: 40 }],
    },
  ]).toBuffer();
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  assert.ok(buffer.length > 1_000);
});

test('keeps elements with the hidden attribute out of the layout', () => {
  const styles = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});

test('does not disable store tabs while a search is running', () => {
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  assert.doesNotMatch(renderer, /storeButtons\.forEach\([^)]*disabled\s*=\s*busy/);
});

test('does not redeclare the preload bridge global', () => {
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  assert.doesNotMatch(renderer, /\b(?:const|let|class)\s+priceParser\b/);
});

test('uses ordinary store buttons instead of ARIA tab widgets', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /role="tab(?:list)?"/);
  assert.match(html, /data-store="varus"[^>]+aria-pressed="false"/);
  assert.match(html, /data-store="aurora"[^>]+aria-pressed="false"/);
  assert.match(html, /data-store="notino"[^>]+aria-pressed="false"/);
  assert.match(html, /data-store="rozetka"[^>]+aria-pressed="false"/);
});

test('filters Aurora cards by a visible purchase action', () => {
  const scraper = fs.readFileSync(path.join(__dirname, 'scraper.js'), 'utf8');
  assert.match(scraper, /form\[name\^="product_form_"\]/);
  assert.match(scraper, /dispatch=products\.popup_get_item_in_shops/);
  assert.match(scraper, /data-gtm-brand/);
  assert.match(scraper, /sec_list_price_/);
  assert.match(scraper, /sec_discounted_price_/);
});

test('expands exact Aurora variants and labels unknown assortment honestly', () => {
  const products = expandAuroraProducts([
    {
      name: 'Помада Lovit в асортименті', brand: 'Lovit', currentPrice: 49,
      url: 'https://avrora.ua/lipstick/', needsVariantDetail: true,
      variantOptions: [
        { variant: '01', url: 'https://avrora.ua/lipstick/?variant_color_id=1' },
        { variant: '02', url: 'https://avrora.ua/lipstick/?variant_color_id=2' },
      ],
    },
    {
      name: 'Блиск Lovit в асортименті', brand: 'Lovit', currentPrice: 39,
      url: 'https://avrora.ua/gloss/', needsVariantDetail: true, variantOptions: [],
    },
  ]);
  assert.deepEqual(products.map((product) => product.variant), [
    '01', '02', 'Асортимент — точний варіант сайт не вказує',
  ]);
  assert.match(products[1].url, /variant_color_id=2/);
});

test('expands only available MAKEUP variants with their own prices and region', () => {
  const products = expandMakeupVariantData({
    name: 'Помада', brand: 'Maybelline New York', url: 'https://makeup.com.ua/ua/product/1/',
    currentPrice: 300, needsVariantDetail: true,
  }, {
    name: 'Помада SuperStay', brand: 'Maybelline New York', hasVariants: true,
    variants: [
      { id: '10', title: '10 - Dreamer', inStock: true, current: 368, old: 539 },
      { id: '10_3', title: '10 - Dreamer', region: 'eu', inStock: true, current: 352, old: 376 },
      { id: '15', title: '15 - Lover', inStock: false, current: 382, old: 539 },
    ],
  });
  assert.deepEqual(products.map((product) => product.variant), ['10 - Dreamer', '10 - Dreamer · ЄС']);
  assert.deepEqual(products.map((product) => product.priceWithDiscount), [368, 352]);
  assert.deepEqual(products.map((product) => product.priceWithoutDiscount), [539, 376]);
  assert.match(products[1].url, /#\/option\/10_3\/$/);
});

test('assigns a MAKEUP barcode only to the exact default variant', () => {
  const products = expandMakeupVariantData({
    name: 'Блиск', brand: 'Maybelline New York', url: 'https://makeup.com.ua/ua/product/838794/',
    currentPrice: 300, needsVariantDetail: true,
  }, {
    name: 'Maybelline New York Lifter Gloss', brand: 'Maybelline New York', hasVariants: true,
    barcode: '3600531609764', defaultVariantId: '1861565', inStock: true,
    variants: [
      { id: '1861565', title: '002 - Ice', inStock: true, current: 246, old: 439 },
      { id: '1861566', title: '003 - Moon', inStock: true, current: 246, old: 439 },
    ],
  }, { includeVariants: true, includeBarcodes: true });

  assert.equal(products[0].barcode, '3600531609764');
  assert.equal(products[1].barcode, '');
});

test('labels the exact MAKEUP variant when collecting only its barcode', () => {
  const products = expandMakeupVariantData({
    name: 'Блиск', brand: 'Maybelline New York', url: 'https://makeup.com.ua/ua/product/838794/',
  }, {
    name: 'Maybelline New York Lifter Gloss', brand: 'Maybelline New York', hasVariants: true,
    barcode: '3600531609764', defaultVariantTitle: '002 - Ice', defaultVariantInStock: true,
    defaultVariantPrice: { current: 246, old: 439 },
  }, { includeVariants: false, includeBarcodes: true });

  assert.equal(products.length, 1);
  assert.equal(products[0].variant, '002 - Ice');
  assert.equal(products[0].barcode, '3600531609764');
  assert.equal(products[0].priceWithDiscount, 246);
  assert.equal(products[0].priceWithoutDiscount, 439);
});

test('resolves a non-default MAKEUP barcode to its exact in-stock variant', async () => {
  const requestedUrls = [];
  const request = async (url) => {
    requestedUrls.push(url);
    const variant = new URL(url).searchParams.get('variant');
    return {
      ok: true,
      json: async () => ({
        meta: { gtin13: variant === '1861565' ? '3600531609764' : '3600531609689' },
      }),
    };
  };
  const previousLocation = global.location;
  global.location = { origin: 'https://makeup.com.ua' };
  try {
    const variantId = await findMakeupBarcodeVariant('838794', [
      { id: '1861561', title: '001 - Pearl', inStock: true },
      { id: '1861565', title: '002 - Ice', inStock: true },
    ], '3600531609764', request);
    assert.equal(variantId, '1861565');
    assert.equal(requestedUrls.length, 2);
  } finally {
    global.location = previousLocation;
  }

  const products = expandMakeupVariantData({
    name: 'Блиск', brand: 'Maybelline New York', url: 'https://makeup.com.ua/ua/product/838794/',
  }, {
    name: 'Maybelline New York Lifter Gloss', brand: 'Maybelline New York', hasVariants: true,
    barcode: '3600531609764', barcodeVariantId: '1861565',
    variants: [
      { id: '1861561', title: '001 - Pearl', inStock: true, current: 281, old: 439 },
      { id: '1861565', title: '002 - Ice', inStock: true, current: 281, old: 439 },
    ],
  }, { includeVariants: false, includeBarcodes: true, barcodeQuery: '3600531609764' });

  assert.equal(products.length, 1);
  assert.equal(products[0].variant, '002 - Ice');
  assert.equal(products[0].barcode, '3600531609764');
  assert.match(products[0].url, /#\/option\/1861565\/$/);
});

test('autosave accumulates partial products and keeps a readable backup', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-recovery-'));
  try {
    const recoveryFile = path.join(directory, 'search-recovery.json');
    const scraper = new PriceScraper({
      BrowserWindow: function BrowserWindow() {},
      cacheFile: path.join(directory, 'brands-cache.json'),
      recoveryFile,
    });
    scraper.beginRecovery('rozetka', 'Xiaomi', {
      recoveryQuery: 'Nivea, Xiaomi',
      previousProducts: [{ name: 'Nivea', brand: 'Nivea', url: 'https://example.com/nivea' }],
      includeSellers: true,
      includeBarcodes: true,
    });
    scraper.rememberPartial([
      { name: 'Телефон', brand: 'Xiaomi', seller: 'Rozetka', url: 'https://example.com/xiaomi' },
    ], 'Xiaomi');
    scraper.markRecovery('cancelled');

    const saved = scraper.getRecovery();
    assert.equal(saved.status, 'cancelled');
    assert.equal(saved.query, 'Nivea, Xiaomi');
    assert.equal(saved.products.length, 2);
    assert.equal(saved.options.includeSellers, true);
    assert.equal(saved.options.includeBarcodes, true);
    scraper.clearRecovery();
    assert.equal(scraper.getRecovery(), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cancel destroys active detail windows immediately', () => {
  const scraper = new PriceScraper({
    BrowserWindow: function BrowserWindow() {},
    cacheFile: path.join(os.tmpdir(), 'unused-price-monitor-cache.json'),
  });
  let destroyed = 0;
  const windowStub = () => ({
    isDestroyed: () => false,
    destroy: () => { destroyed += 1; },
  });
  scraper.jobRunning = true;
  scraper.activeWindow = windowStub();
  scraper.workerWindows.add(windowStub());
  scraper.cancel();
  assert.equal(scraper.cancelled, true);
  assert.equal(destroyed, 2);
  assert.equal(scraper.activeWindow, null);
  assert.equal(scraper.workerWindows.size, 0);
});

test('loads batch helpers before the renderer in the packaged interface', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.ok(html.indexOf('<script src="batch.js"></script>') < html.indexOf('<script src="renderer.js"></script>'));

  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.equal(packageJson.version, '4.21.0');
  assert.ok(packageJson.build.files.includes('batch.js'));
  assert.ok(packageJson.build.files.includes('saved-lists.js'));
  assert.ok(packageJson.build.files.includes('search-history.js'));
  assert.ok(packageJson.build.files.includes('result-view.js'));
  assert.ok(packageJson.build.files.includes('comparison.js'));
  assert.ok(packageJson.build.files.includes('comparison-store.js'));
  assert.deepEqual(packageJson.build.win.target, ['nsis']);
});

test('loads saved lists before the renderer and exposes their Ukrainian controls', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  assert.ok(html.indexOf('<script src="saved-lists.js"></script>') < html.indexOf('<script src="renderer.js"></script>'));
  assert.match(html, /Збережені списки марок/);
  assert.match(html, /id="save-current-list"/);
  assert.match(html, /id="export-saved-lists"/);
  assert.match(html, /id="import-saved-lists"/);
  assert.match(html, /id="duplicate-saved-list"/);
  assert.match(html, /id="rename-saved-list"/);
  assert.match(renderer, /price-monitor:saved-brand-lists:v1/);
  assert.match(renderer, /createSavedListsBackup/);
  assert.match(renderer, /parsePriceMonitorBackup/);
  assert.match(renderer, /Список «\$\{result\.item\.name\}» збережено/);
  assert.match(renderer, /const options = \{\s*includeVariants:/);
  assert.match(renderer, /item\.options\.includeBarcodes/);
});

test('loads per-store search history before the renderer and restores search modes', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  assert.ok(html.indexOf('<script src="search-history.js"></script>') < html.indexOf('<script src="renderer.js"></script>'));
  assert.match(html, /Останні пошуки/);
  assert.match(html, /id="clear-search-history"/);
  assert.match(renderer, /price-monitor:search-history:v1/);
  assert.match(renderer, /recordSearchHistory/);
  assert.match(renderer, /item\.options\.includeVariants/);
  assert.match(renderer, /item\.options\.includeSellers/);
  assert.match(renderer, /item\.options\.includeBarcodes/);
});

test('exposes safe JSON backup dialogs through the preload bridge', () => {
  const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.match(preload, /saved-lists:export/);
  assert.match(preload, /saved-lists:import/);
  assert.match(main, /price-monitor-backup-\$\{date\}\.json/);
  assert.match(main, /stats\.size > 50_000_000/);
  assert.match(preload, /comparison:list/);
  assert.match(preload, /comparison:merge/);
  assert.match(main, /comparison:list/);
  assert.match(main, /comparison:merge/);
});

test('loads result filtering, sorting and visible-only export controls', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.ok(html.indexOf('<script src="result-view.js"></script>') < html.indexOf('<script src="renderer.js"></script>'));
  assert.match(html, /id="result-filter"/);
  assert.match(html, /id="result-sort"/);
  assert.match(html, /id="export-visible-only"/);
  assert.match(html, /id="result-sale-filter"/);
  assert.match(html, /id="result-min-price"/);
  assert.match(html, /id="result-max-price"/);
  assert.match(html, /id="result-summary"/);
  assert.match(html, /id="copy-results"/);
  assert.match(html, />Економія</);
  assert.match(html, />Знижка, %</);
  assert.match(renderer, /resultViewUtils\.filterAndSortProducts/);
  assert.match(renderer, /resultViewUtils\.summarizeProducts/);
  assert.match(renderer, /resultViewUtils\.productsToTsv/);
  assert.match(renderer, /exportVisibleOnlyCheckbox\.checked \? getVisibleProducts\(\) : state\.products/);
  assert.match(preload, /clipboard:write/);
  assert.match(main, /clipboard\.writeText/);
  assert.match(main, /header\('Економія'\)/);
  assert.match(main, /header\('Знижка, %'\)/);
});

test('exposes offline archive, price graph and dated Excel metadata in the protected app', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.match(html, /id="archive-dialog"/);
  assert.match(html, /id="price-history-dialog"/);
  assert.match(html, /id="capture-notice"/);
  assert.match(renderer, /if \(completeResult && typeof parserApi\.saveArchive/);
  assert.match(renderer, /source: 'archive'/);
  assert.match(renderer, /drawPriceHistoryChart/);
  assert.match(renderer, /getProductPriceHistory/);
  assert.match(preload, /archive:product-history/);
  assert.match(preload, /archive:merge/);
  assert.match(main, /sheet: 'Параметри перевірки'/);
  assert.match(main, /Архів — не поточні ціни/);
});

test('exposes archive comparison, repeat with exact modes and independent history export', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.ok(html.indexOf('<script src="archive-tools.js"></script>') < html.indexOf('<script src="renderer.js"></script>'));
  for (const id of ['archive-compare-base', 'archive-compare-current', 'archive-compare', 'export-price-history']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(renderer, /async function repeatArchivedSearch/);
  assert.match(renderer, /if \(applySearchHistoryItem\(record\)\)/);
  assert.match(renderer, /await startParsing\(\)/);
  assert.match(renderer, /displayArchivedResult\(result.record, result.comparison\)/);
  assert.match(renderer, /база наступного нового пошуку не змінена/);
  assert.match(preload, /archive:compare/);
  assert.match(preload, /archive:history-export/);
  assert.ok(packageJson.build.files.includes('archive-tools.js'));
  assert.ok(packageJson.build.files.includes('price-history-export.js'));
});

test('exposes combined multi-store archive export through the protected interface', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  for (const id of ['combined-export-panel', 'combined-export-stores', 'combined-export-button', 'combined-export-hint']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(renderer, /renderCombinedExportControls/);
  assert.match(renderer, /parserApi\.exportCombinedArchives\(ids\)/);
  assert.match(preload, /archive:combined-export/);
  assert.match(main, /buildCombinedArchiveWorkbook\(records, STORES\)/);
  assert.ok(packageJson.build.files.includes('multi-store-export.js'));
});

test('exposes filtered archive export through the protected interface', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  for (const id of ['archive-filter-export-button', 'archive-filter-export-hint', 'archive-filter-export-status']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(renderer, /filteredArchiveSummaries = records/);
  assert.match(renderer, /parserApi\.exportFilteredArchives\(ids\)/);
  assert.match(preload, /archive:filtered-export/);
  assert.match(main, /buildFilteredArchiveWorkbook\(records, STORES\)/);
});

test('exposes confirmed archive deletion and one-step undo through the protected interface', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  for (const id of ['archive-filter-delete-button', 'archive-delete-status', 'archive-delete-undo']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(renderer, /window\.confirm\(`Видалити/);
  assert.match(renderer, /parserApi\.deleteArchives/);
  assert.match(renderer, /parserApi\.restoreDeletedArchives/);
  assert.match(preload, /archive:delete/);
  assert.match(preload, /archive:restore-deleted/);
  assert.match(main, /deletedArchiveBatch/);
});

test('exposes dated archive filters and cross-store change report in the packaged interface', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  for (const id of ['archive-query-filter', 'archive-date-from', 'archive-date-to', 'archive-clear-filters',
    'show-change-report', 'change-report-dialog', 'change-report-stores', 'change-report-rows',
    'change-report-store-filter', 'change-report-status-filter', 'change-report-text-filter', 'export-change-report',
    'change-report-date-from', 'change-report-date-to', 'change-report-apply-period', 'change-report-all-time']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(renderer, /async function openChangeReport/);
  assert.match(renderer, /function renderChangeReportRows/);
  assert.match(renderer, /async function exportChangeReport/);
  assert.match(preload, /changes:overview/);
  assert.match(preload, /changes:export/);
  assert.match(main, /buildCrossStoreChangeReport\(archiveStore\.all\(\), STORES, period\)/);
  assert.ok(packageJson.build.files.includes('change-report.js'));
});

test('cross-store report IPC derives data from the archive, exports it and never changes saved checks', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-change-report-'));
  try {
    const output = path.join(directory, 'changes.xlsx');
    const archivePath = path.join(directory, 'archive.json');
    const handlers = new Map();
    let canceled = false;
    const electron = {
      app: { requestSingleInstanceLock: () => false, quit() {}, on() {} },
      ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
      dialog: { showSaveDialog: async () => ({ canceled, filePath: canceled ? undefined : output }) },
    };
    const context = require('node:vm').createContext({
      require: (name) => name === 'electron' ? electron
        : name === 'write-excel-file/node' ? (sheets) => writeExcelFile(JSON.parse(JSON.stringify(sheets))) : require(name),
      process, console, Buffer, __dirname,
    });
    require('node:vm').runInContext(`${fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')}\narchiveStore = new ArchiveStore(${JSON.stringify(archivePath)}); registerIpcHandlers();`, context);
    const record = (id, price, date) => ({ id, store: 'makeup', query: 'Brand', capturedAt: date, options: {},
      products: [{ name: 'Gloss', brand: 'Brand', barcode: '012345678905',
        url: 'https://makeup.com.ua/1', priceWithoutDiscount: price }] });
    await handlers.get('archive:save')({}, record('old', 100, '2026-09-10T12:00:00Z'));
    await handlers.get('archive:save')({}, record('new', 80, '2026-09-11T12:00:00Z'));
    const before = fs.readFileSync(archivePath, 'utf8');
    const report = handlers.get('changes:overview')({});
    assert.equal(report.storeReports.find((item) => item.store === 'makeup').summary.cheaper, 1);
    assert.equal(report.rows[0].difference, -20);
    assert.equal(await handlers.get('changes:export')({}, { rows: [{ difference: 999999 }] }), output);
    const xml = [...workbookXmlEntries(fs.readFileSync(output)).values()].join('\n');
    assert.match(xml, /<v>-20<\/v>/);
    assert.doesNotMatch(xml, /999999/);
    assert.equal(fs.readFileSync(archivePath, 'utf8'), before);
    canceled = true;
    assert.equal(await handlers.get('changes:export')({}), null);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('combined export IPC reads selected records from the archive and rejects invalid or duplicate stores', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-combined-export-'));
  try {
    const output = path.join(directory, 'combined.xlsx');
    const archivePath = path.join(directory, 'archive.json');
    const handlers = new Map();
    let canceled = false;
    const electron = {
      app: { requestSingleInstanceLock: () => false, quit() {}, on() {} },
      ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
      dialog: { showSaveDialog: async () => ({ canceled, filePath: canceled ? undefined : output }) },
    };
    const context = require('node:vm').createContext({
      require: (name) => name === 'electron' ? electron
        : name === 'write-excel-file/node' ? (sheets) => writeExcelFile(JSON.parse(JSON.stringify(sheets))) : require(name),
      process, console, Buffer, __dirname,
    });
    require('node:vm').runInContext(`${fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')}\narchiveStore = new ArchiveStore(${JSON.stringify(archivePath)}); registerIpcHandlers();`, context);
    const record = (id, store, date) => ({ id, store, query: 'Nivea', capturedAt: date, options: {},
      products: [{ name: 'Товар', brand: 'Nivea', barcode: '012345678905',
        priceWithDiscount: 80, priceWithoutDiscount: 100, url: `https://example.com/${id}` }] });
    await handlers.get('archive:save')({}, record('eva', 'eva', '2026-09-15T12:00:00Z'));
    await handlers.get('archive:save')({}, record('makeup', 'makeup', '2026-09-16T12:00:00Z'));
    await handlers.get('archive:save')({}, record('eva-old', 'eva', '2026-09-14T12:00:00Z'));
    const before = fs.readFileSync(archivePath, 'utf8');
    assert.equal(await handlers.get('archive:combined-export')({}, { ids: ['eva', 'makeup'], records: [{ name: 'fake', price: 999999 }] }), output);
    const xml = [...workbookXmlEntries(fs.readFileSync(output)).values()].join('\n');
    assert.match(xml, /Локальний архів — не поточні ціни та залишки/);
    assert.match(xml, /012345678905/);
    assert.doesNotMatch(xml, /999999/);
    assert.equal(fs.readFileSync(archivePath, 'utf8'), before);
    await assert.rejects(() => handlers.get('archive:combined-export')({}, { ids: ['eva'] }), /від двох до шести/);
    await assert.rejects(() => handlers.get('archive:combined-export')({}, { ids: ['eva', 'eva'] }), /різних/);
    await assert.rejects(() => handlers.get('archive:combined-export')({}, { ids: ['eva', 'eva-old'] }), /одну дійсну/);
    await assert.rejects(() => handlers.get('archive:combined-export')({}, { ids: ['eva', 'missing'] }), /відсутня/);
    canceled = true;
    assert.equal(await handlers.get('archive:combined-export')({}, { ids: ['eva', 'makeup'] }), null);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('filtered archive export IPC reads exact saved checks and allows several dates of one store', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-filtered-archive-'));
  try {
    const output = path.join(directory, 'filtered.xlsx');
    const archivePath = path.join(directory, 'archive.json');
    const handlers = new Map();
    let canceled = false;
    const electron = {
      app: { requestSingleInstanceLock: () => false, quit() {}, on() {} },
      ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
      dialog: { showSaveDialog: async () => ({ canceled, filePath: canceled ? undefined : output }) },
    };
    const context = require('node:vm').createContext({
      require: (name) => name === 'electron' ? electron
        : name === 'write-excel-file/node' ? (sheets) => writeExcelFile(JSON.parse(JSON.stringify(sheets))) : require(name),
      process, console, Buffer, __dirname,
    });
    require('node:vm').runInContext(`${fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')}\narchiveStore = new ArchiveStore(${JSON.stringify(archivePath)}); registerIpcHandlers();`, context);
    const record = (id, date, price) => ({ id, store: 'eva', query: 'Nivea', capturedAt: date, options: {},
      products: [{ name: 'Крем', brand: 'Nivea', barcode: '012345678905',
        priceWithoutDiscount: price, url: `https://eva.ua/${id}/` }] });
    await handlers.get('archive:save')({}, record('older', '2026-09-18T12:00:00Z', 100));
    await handlers.get('archive:save')({}, record('newer', '2026-09-20T12:00:00Z', 80));
    const before = fs.readFileSync(archivePath, 'utf8');
    assert.equal(await handlers.get('archive:filtered-export')({}, {
      ids: ['newer', 'older'], products: [{ name: 'Підміна', priceWithoutDiscount: 999999 }],
    }), output);
    const xml = [...workbookXmlEntries(fs.readFileSync(output)).values()].join('\n');
    assert.match(xml, /2026-09-18T12:00:00\.000Z/);
    assert.match(xml, /2026-09-20T12:00:00\.000Z/);
    assert.match(xml, /012345678905/);
    assert.doesNotMatch(xml, /999999|Підміна/);
    assert.equal(fs.readFileSync(archivePath, 'utf8'), before);
    await assert.rejects(() => handlers.get('archive:filtered-export')({}, { ids: [] }), /немає дійсних/);
    await assert.rejects(() => handlers.get('archive:filtered-export')({}, { ids: ['newer', 'newer'] }), /немає дійсних/);
    await assert.rejects(() => handlers.get('archive:filtered-export')({}, { ids: ['missing'] }), /уже відсутня/);
    canceled = true;
    assert.equal(await handlers.get('archive:filtered-export')({}, { ids: ['newer'] }), null);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('archive deletion IPC validates exact saved ids and restores only the latest batch', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-delete-ipc-'));
  try {
    const archivePath = path.join(directory, 'archive.json');
    const handlers = new Map();
    const electron = {
      app: { requestSingleInstanceLock: () => false, quit() {}, on() {} },
      ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
      dialog: {},
    };
    const context = require('node:vm').createContext({ require: (name) => name === 'electron' ? electron : require(name),
      process, console, Buffer, __dirname });
    require('node:vm').runInContext(`${fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')}\narchiveStore = new ArchiveStore(${JSON.stringify(archivePath)}); registerIpcHandlers();`, context);
    const record = (id, date) => ({ id, store: 'eva', query: 'Brand', capturedAt: date, options: {},
      products: [{ name: id, brand: 'Brand', priceWithoutDiscount: 100, url: `https://example.com/${id}` }] });
    await handlers.get('archive:save')({}, record('keep', '2026-09-20T12:00:00Z'));
    await handlers.get('archive:save')({}, record('remove-a', '2026-09-21T12:00:00Z'));
    await handlers.get('archive:save')({}, record('remove-b', '2026-09-22T12:00:00Z'));
    assert.throws(() => handlers.get('archive:delete')({}, { ids: [] }), /визначити/);
    assert.throws(() => handlers.get('archive:delete')({}, { ids: ['remove-a', 'remove-a'] }), /визначити/);
    assert.throws(() => handlers.get('archive:delete')({}, { ids: ['missing'] }), /уже відсутня/);
    const deleted = await handlers.get('archive:delete')({}, { ids: ['remove-a', 'remove-b'], records: [{ id: 'keep' }] });
    assert.equal(deleted.removed, 2);
    assert.equal(deleted.total, 1);
    assert.equal(typeof deleted.token, 'string');
    assert.deepEqual(Array.from(handlers.get('archive:list')({}), (item) => item.id), ['keep']);
    assert.throws(() => handlers.get('archive:restore-deleted')({}, { token: 'wrong' }), /не можна скасувати/);
    const restored = await handlers.get('archive:restore-deleted')({}, { token: deleted.token });
    assert.equal(restored.restored, 2);
    assert.equal(restored.total, 3);
    assert.deepEqual(Array.from(handlers.get('archive:list')({}), (item) => item.id), ['remove-b', 'remove-a', 'keep']);
    assert.throws(() => handlers.get('archive:restore-deleted')({}, { token: deleted.token }), /не можна скасувати/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('exports history through IPC from saved records rather than caller-supplied prices', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-history-export-'));
  try {
    const output = path.join(directory, 'history.xlsx');
    const archivePath = path.join(directory, 'archive.json');
    const handlers = new Map();
    let cancel = false;
    const electron = {
      app: { requestSingleInstanceLock: () => false, quit() {}, on() {} },
      ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
      dialog: { showSaveDialog: async () => ({ canceled: cancel, filePath: cancel ? undefined : output }) },
    };
    const context = require('node:vm').createContext({
      require: (name) => name === 'electron' ? electron
        : name === 'write-excel-file/node' ? (sheets) => writeExcelFile(JSON.parse(JSON.stringify(sheets))) : require(name),
      process, console, Buffer, __dirname,
    });
    require('node:vm').runInContext(`${fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')}\narchiveStore = new ArchiveStore(${JSON.stringify(archivePath)}); registerIpcHandlers();`, context);
    const product = { name: 'Gloss', barcode: '012345678905', brand: 'Brand', variant: '002', seller: 'UA', url: 'https://makeup.com.ua/product/123/', priceWithoutDiscount: 120 };
    const record = { id: 'a', store: 'makeup', query: 'Brand', options: {}, capturedAt: '2026-09-15T12:00:00Z', products: [product] };
    await handlers.get('archive:save')({}, record);
    await handlers.get('archive:save')({}, { ...record, id: 'b', capturedAt: '2026-09-16T12:00:00Z', products: [{ ...product, priceWithoutDiscount: 100 }] });
    const before = fs.readFileSync(archivePath, 'utf8');
    const compared = await handlers.get('archive:compare')({}, { previousId: 'a', currentId: 'b' });
    assert.equal(compared.comparison.products[0].priceDifference, -20);
    assert.equal(fs.readFileSync(archivePath, 'utf8'), before);
    assert.throws(() => handlers.get('archive:compare')({}, { previousId: 'b', currentId: 'a' }), /дві повні/);
    const filePath = await handlers.get('archive:history-export')({}, { store: 'makeup', product, points: [{ price: 999999 }] });
    assert.equal(filePath, output);
    const xml = [...workbookXmlEntries(fs.readFileSync(output)).values()].join('\n');
    assert.match(xml, /<v>120<\/v>/);
    assert.match(xml, /<v>100<\/v>/);
    assert.match(xml, /<v>-20<\/v>/);
    assert.doesNotMatch(xml, /999999/);
    assert.match(xml, /012345678905/);
    cancel = true;
    assert.equal(await handlers.get('archive:history-export')({}, { store: 'makeup', product }), null);
    await assert.rejects(() => handlers.get('archive:history-export')({}, { store: 'missing', product }), /Невідомий магазин/);
    await assert.rejects(() => handlers.get('archive:history-export')({}, { store: 'makeup', product: { ...product, variant: 'other' } }), /Немає збережених цін/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('exports a real archive workbook with dated provenance and numeric discount fields', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-export-'));
  try {
    const output = path.join(directory, 'archive.xlsx');
    const handlers = new Map();
    const electron = {
      app: { requestSingleInstanceLock: () => false, quit() {}, on() {} },
      ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
      dialog: { showSaveDialog: async () => ({ canceled: false, filePath: output }) },
    };
    const context = require('node:vm').createContext({
      require: (name) => name === 'electron' ? electron
        : name === 'write-excel-file/node' ? (sheets) => writeExcelFile(JSON.parse(JSON.stringify(sheets)))
          : require(name),
      process, console, Buffer, __dirname,
    });
    require('node:vm').runInContext(`${fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')}\nregisterIpcHandlers();`, context);
    await handlers.get('products:export')({}, {
      store: 'makeup', brand: 'Maybelline',
      products: [{ name: 'Gloss', brand: 'Maybelline', priceWithDiscount: 234, priceWithoutDiscount: 246 }],
      capture: { source: 'archive', query: 'Maybelline', capturedAt: '2026-09-17T12:00:00Z', complete: true, sourceCount: 1 },
      filters: { visibleOnly: true },
    });
    const buffer = fs.readFileSync(output);
    let offset = 0;
    const xml = [];
    while (offset < buffer.length - 46) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) { offset += 1; continue; }
      const method = buffer.readUInt16LE(offset + 10);
      const length = buffer.readUInt32LE(offset + 20);
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localOffset = buffer.readUInt32LE(offset + 42);
      const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
      if (name.endsWith('.xml')) {
        const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
        const data = buffer.subarray(start, start + length);
        xml.push((method === 8 ? require('node:zlib').inflateRawSync(data) : data).toString('utf8'));
      }
      offset += 46 + nameLength + extraLength + commentLength;
    }
    const content = xml.join('\n');
    assert.match(content, /Параметри перевірки/);
    assert.match(content, /Архів — не поточні ціни/);
    assert.match(content, /2026-09-17T12:00:00Z/);
    assert.match(content, /Економія/);
    assert.match(content, /Знижка, %/);
    assert.match(content, /<v>12<\/v>/);
    assert.match(content, /<v>4\.88<\/v>/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('loads automatic comparisons, change filters and comparison Excel columns', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.ok(html.indexOf('<script src="comparison.js"></script>') < html.indexOf('<script src="renderer.js"></script>'));
  assert.match(html, /id="result-change-filter"/);
  assert.match(html, /id="comparison-summary"/);
  assert.match(html, /class="comparison-column"[^>]+hidden>Зміна/);
  assert.match(renderer, /compareWithSnapshot/);
  assert.match(renderer, /saveComparisonSnapshot/);
  assert.match(renderer, /resultChangeFilter\.value/);
  assert.match(preload, /comparison:get/);
  assert.match(preload, /comparison:save/);
  assert.match(preload, /comparison:list/);
  assert.match(preload, /comparison:merge/);
  assert.match(main, /header\('Попередня ціна'\)/);
  assert.match(main, /header\('Зміна ціни'\)/);
  assert.match(main, /sheet: 'Зникли з видачі'/);
  assert.match(main, /writeExcelFile\(sheets\)/);
});

test('shows a store capability guide and supports one-click repeated monitoring', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  const guide = fs.readFileSync(path.join(__dirname, 'Функціонал Price Monitor.html'), 'utf8');
  assert.match(html, /id="show-capabilities"/);
  assert.match(html, /id="capabilities-dialog"/);
  assert.match(html, /EVA[\s\S]+MAKEUP[\s\S]+Rozetka/);
  assert.match(html, /сайт віддає лише внутрішні коди/);
  assert.match(html, /id="run-saved-list"/);
  assert.match(renderer, /function runSavedList\(\)/);
  assert.match(renderer, /function repeatSearchHistoryItem\(item\)/);
  assert.match(renderer, /repeatButton\.textContent = 'Повторити'/);
  assert.match(guide, /Загальні можливості/);
  assert.match(guide, /Можливості за магазинами/);
  assert.match(guide, /Надійний справжній EAN\/GTIN для EVA/);
});

test('embeds a searchable offline user guide in the application', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  assert.match(html, /id="show-guide"/);
  assert.match(html, /id="guide-dialog"/);
  assert.match(html, /id="guide-search"[^>]+type="search"/);
  assert.match(html, /id="guide-clear-search"/);
  assert.match(html, /id="guide-nav"/);
  assert.match(html, /id="guide-sections"/);
  assert.match(html, /id="guide-empty"/);
  assert.equal((html.match(/data-guide-section/g) || []).length, 12);
  assert.equal((html.match(/data-guide-target=/g) || []).length, 12);
  assert.match(renderer, /function openGuide\(\)/);
  assert.match(renderer, /function filterGuideSections\(\)/);
  assert.match(renderer, /tokens\.every/);
  assert.match(renderer, /function navigateGuide\(event\)/);
});

test('recognizes barcode searches in the MAKEUP interface automatically', () => {
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  assert.match(renderer, /Торгові марки або штрихкод/);
  assert.match(renderer, /barcodesCheckbox\.checked \|\| barcodeSearch/);
  assert.match(renderer, /Шукаю товар за штрихкодом/);
});

test('collects MAKEUP barcodes optionally and exports them as a separate text column', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  const scraper = fs.readFileSync(path.join(__dirname, 'scraper.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.match(html, /id="include-barcodes"[^>]+type="checkbox"/);
  assert.match(html, /class="barcode-column"[^>]+hidden>Штрихкод/);
  assert.match(renderer, /requestedStore === 'makeup' && \(barcodesCheckbox\.checked \|\| barcodeSearch\)/);
  assert.match(scraper, /product\.meta\?\.gtin13/);
  assert.match(scraper, /defaultVariantId/);
  assert.match(main, /header\('Штрихкод'\)/);
  assert.match(main, /String\(product\.barcode \|\| ''\)/);
});

test('exports Notino promo prices with their conditions', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const scraper = fs.readFileSync(path.join(__dirname, 'scraper.js'), 'utf8');
  assert.match(main, /Ціна за промокодом/);
  assert.match(main, /Промокод \/ умова/);
  assert.match(scraper, /discountWithCondition/);
  assert.match(scraper, /footer-action-button/);
});

test('keeps detailed EVA, MAKEUP, Notino and Aurora variants optional and exports them separately', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  const scraper = fs.readFileSync(path.join(__dirname, 'scraper.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.match(html, /id="include-variants"[^>]+type="checkbox"/);
  assert.doesNotMatch(html, /id="variants-option"[^>]+hidden/);
  assert.match(html, /Варіант \/ відтінок \/ об’єм/);
  assert.match(renderer, /\['eva', 'makeup', 'notino', 'aurora'\]\.includes\(requestedStore\) && variantsCheckbox\.checked/);
  assert.match(renderer, /\['eva', 'makeup', 'notino', 'aurora'\]\.includes\(store\)/);
  assert.match(scraper, /product-card-configurable/);
  assert.match(scraper, /payload\?\.pinia\?\.product\?\.product/);
  assert.match(scraper, /configuration_info/);
  assert.match(scraper, /url\.searchParams\.set\('variant'/);
  assert.match(scraper, /child\?\.is_in_stock !== false/);
  assert.match(scraper, /value\.__typename === 'CatalogVariant'/);
  assert.match(scraper, /state === 'CanBeBought'/);
  assert.match(scraper, /product-variation-color/);
  assert.match(scraper, /variant_color_id/);
  assert.match(scraper, /Асортимент — точний варіант сайт не вказує/);
  assert.match(scraper, /__staticQueryClientHydrationData/);
  assert.match(scraper, /Перевіряю \$\{detailLabel\} MAKEUP/);
  assert.match(main, /\['eva', 'makeup', 'notino', 'aurora'\]\.includes\(store\)/);
  assert.match(main, /header\('Варіант \/ відтінок \/ об’єм'\)/);
});

test('keeps precise Rozetka seller checks optional and exports the seller column', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  const scraper = fs.readFileSync(path.join(__dirname, 'scraper.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.match(html, /id="include-sellers"[^>]+type="checkbox"[^>]+checked/);
  assert.match(html, /class="seller-column"[^>]+hidden>Продавець/);
  assert.match(renderer, /requestedStore === 'rozetka' && sellersCheckbox\.checked/);
  assert.match(renderer, /row\.append\(textCell\(product\.seller\)\)/);
  assert.match(scraper, /Уточнюю виробника/);
  assert.match(scraper, /rz-seller-title/);
  assert.match(scraper, /ROZETKA_DETAIL_CONCURRENCY = 2/);
  assert.match(scraper, /rz-product-offers a\[href\*="\/p"\]/);
  assert.match(scraper, /sellerOfferUrls/);
  assert.match(scraper, /hasAdditionalSellers/);
  assert.match(scraper, /\/є в наявності\/i/);
  assert.match(main, /store === 'rozetka' && Boolean\(payload\.options\?\.includeSellers\)/);
  assert.match(main, /header\('Продавець'\)/);
});
