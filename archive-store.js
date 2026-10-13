const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { createProductIdentity, currentProductPrice } = require('./comparison');

const MAX_ARCHIVES = 60;
const MAX_ARCHIVE_PRODUCTS = 5_000;
const MAX_TOTAL_PRODUCTS = 100_000;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const MAX_STORE_BYTES = 24 * 1024 * 1024;
const STORE_IDS = new Set(['eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka']);

function normalizeArchive(value) {
  if (value?.version !== undefined && value.version !== 1) return null;
  if (value?.complete === false) return null;
  const id = clean(value?.id, 100);
  const store = clean(value?.store, 30).toLowerCase();
  const query = clean(value?.query, 2_000);
  const date = new Date(value?.capturedAt);
  if (!id || !STORE_IDS.has(store) || !query || !value?.capturedAt || !Number.isFinite(date.getTime())
    || !Array.isArray(value?.products)) return null;
  const products = [];
  let bytes = 0;
  for (const source of value.products) {
    if (!source || typeof source !== 'object') continue;
    const product = {
      name: clean(source.name, 500),
      brand: clean(source.brand, 200),
      barcode: clean(source.barcode, 30),
      variant: clean(source.variant, 300),
      seller: clean(source.seller, 300),
      url: clean(source.url, 2_000),
      priceWithDiscount: price(source.priceWithDiscount),
      priceWithoutDiscount: price(source.priceWithoutDiscount),
      promoPrice: price(source.promoPrice),
      promoCode: clean(source.promoCode, 100),
      promotionCondition: clean(source.promotionCondition, 600),
      onSale: Boolean(source.onSale),
    };
    const productBytes = Buffer.byteLength(JSON.stringify(product), 'utf8');
    if (products.length >= MAX_ARCHIVE_PRODUCTS || bytes + productBytes > MAX_CAPTURE_BYTES) break;
    bytes += productBytes;
    products.push(product);
  }
  if (!products.length) return null;
  const rawCount = Number(value.sourceCount);
  const sourceCount = Math.max(products.length, Number.isFinite(rawCount) && rawCount > 0
    ? Math.trunc(rawCount) : value.products.length);
  return {
    version: 1,
    id,
    store,
    query,
    brand: clean(value.brand || query, 2_000),
    capturedAt: date.toISOString(),
    options: {
      includeVariants: Boolean(value.options?.includeVariants),
      includeSellers: Boolean(value.options?.includeSellers),
      includeBarcodes: Boolean(value.options?.includeBarcodes),
    },
    sourceCount,
    truncated: Boolean(value.truncated) || products.length < sourceCount,
    products,
  };
}

function limitArchives(values) {
  const seen = new Set();
  const sorted = (Array.isArray(values) ? values : [])
    .map(normalizeArchive).filter(Boolean)
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  const result = [];
  let count = 0;
  let bytes = 0;
  for (const record of sorted) {
    if (seen.has(record.id)) continue;
    const size = Buffer.byteLength(JSON.stringify(record), 'utf8');
    if (result.length >= MAX_ARCHIVES || count + record.products.length > MAX_TOTAL_PRODUCTS
      || bytes + size > MAX_STORE_BYTES) break;
    seen.add(record.id);
    result.push(record);
    count += record.products.length;
    bytes += size;
  }
  return result;
}

function productMatches(left, right) {
  if (left?.barcode && right?.barcode) return createProductIdentity(left) === createProductIdentity(right);
  return createProductIdentity({ ...left, barcode: '' }) === createProductIdentity({ ...right, barcode: '' });
}

function buildProductPriceHistory(records, store, product) {
  const points = [];
  for (const record of limitArchives(records).reverse()) {
    if (record.store !== store) continue;
    const match = record.products.find((item) => productMatches(item, product));
    if (!match) continue;
    const currentPrice = currentProductPrice(match);
    if (currentPrice === null) continue;
    points.push({
      archiveId: record.id,
      capturedAt: record.capturedAt,
      price: currentPrice,
      regularPrice: match.priceWithoutDiscount,
      promoPrice: match.promoPrice,
      promoCode: match.promoCode,
      promotionCondition: match.promotionCondition,
      query: record.query,
    });
  }
  return points;
}

class ArchiveStore {
  constructor(filePath) { this.filePath = filePath; }

  all() {
    for (const filePath of [this.filePath, `${this.filePath}.bak`]) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!Array.isArray(parsed?.archives)) continue;
        return limitArchives(parsed.archives);
      } catch (_error) { /* Спробувати резервну копію. */ }
    }
    return [];
  }

  list() {
    return this.all().map(({ products, ...record }) => ({ ...record, productCount: products.length }));
  }

  get(id) { return this.all().find((record) => record.id === String(id || '')) || null; }

  save(value) {
    const record = normalizeArchive({ ...value, id: value?.id || randomUUID() });
    if (!record || !record.products.length) throw new Error('Не вдалося зберегти результат в архів.');
    this.write(limitArchives([record, ...this.all().filter((item) => item.id !== record.id)]));
    return { ...record, products: undefined, productCount: record.products.length };
  }

  merge(values) {
    const current = this.all();
    const ids = new Set(current.map((record) => record.id));
    const imported = limitArchives(values);
    const added = imported.filter((record) => !ids.has(record.id));
    const result = limitArchives([...current, ...added]);
    if (added.length) this.write(result);
    return { added: added.length, total: result.length };
  }

  removeMany(ids) {
    const selected = new Set(Array.isArray(ids) ? ids.map((id) => String(id || '')) : []);
    const current = this.all();
    const removed = current.filter((record) => selected.has(record.id));
    if (!removed.length) return { removed: [], total: current.length };
    const remaining = current.filter((record) => !selected.has(record.id));
    this.write(remaining);
    return { removed, total: remaining.length };
  }

  productHistory(store, product) { return buildProductPriceHistory(this.all(), store, product); }

  write(archives) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryFile = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify({ version: 1, archives }), 'utf8');
    if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, `${this.filePath}.bak`);
    fs.copyFileSync(temporaryFile, this.filePath);
    try { fs.unlinkSync(temporaryFile); } catch (_error) {}
  }
}

function clean(value, limit) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function price(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

module.exports = { ArchiveStore, buildProductPriceHistory, limitArchives, normalizeArchive, MAX_ARCHIVES, MAX_ARCHIVE_PRODUCTS };
