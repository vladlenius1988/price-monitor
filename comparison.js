(function exposeComparisonUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.priceMonitorComparison = api;
}(typeof window !== 'undefined' ? window : null, () => {
  const SNAPSHOT_VERSION = 1;
  const MAX_SNAPSHOT_PRODUCTS = 5_000;

  function createSnapshotKey(store, query, options = {}) {
    const storeId = clean(store, 30).toLowerCase();
    const queries = String(query || '')
      .split(/[,;\r\n]+/)
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, 'uk'));
    const uniqueQueries = [...new Set(queries)];
    const modes = [
      options.includeVariants ? 'variants' : '',
      options.includeSellers ? 'sellers' : '',
      options.includeBarcodes ? 'barcodes' : '',
    ].filter(Boolean).join('+') || 'fast';
    return `${storeId}|${uniqueQueries.join(',')}|${modes}`.slice(0, 4_000);
  }

  function createComparisonSnapshot(input = {}) {
    const capturedAt = validDate(input.capturedAt || new Date().toISOString());
    return normalizeComparisonSnapshot({
      version: SNAPSHOT_VERSION,
      key: input.key,
      store: input.store,
      query: input.query,
      options: input.options,
      capturedAt,
      products: compactSnapshotProducts(input.products),
    });
  }

  function compactSnapshotProducts(products) {
    const result = [];
    const seen = new Set();
    for (const product of Array.isArray(products) ? products : []) {
      const key = createProductIdentity(product);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push({
        key,
        name: clean(product?.name, 500),
        brand: clean(product?.brand, 200),
        barcode: clean(product?.barcode, 30),
        variant: clean(product?.variant, 300),
        seller: clean(product?.seller, 300),
        price: currentProductPrice(product),
        url: clean(product?.url, 2_000),
      });
      if (result.length >= MAX_SNAPSHOT_PRODUCTS) break;
    }
    return result;
  }

  function normalizeComparisonSnapshot(value) {
    if (!value || Number(value.version) !== SNAPSHOT_VERSION) return null;
    const key = clean(value.key, 4_000);
    const store = clean(value.store, 30).toLowerCase();
    const query = clean(value.query, 2_000);
    if (!key || !store || !query || !Array.isArray(value.products)) return null;
    return {
      version: SNAPSHOT_VERSION,
      key,
      store,
      query,
      options: {
        includeVariants: Boolean(value.options?.includeVariants),
        includeSellers: Boolean(value.options?.includeSellers),
        includeBarcodes: Boolean(value.options?.includeBarcodes),
      },
      capturedAt: validDate(value.capturedAt),
      products: compactSnapshotProducts(value.products.map((product) => ({
        ...product,
        priceWithDiscount: product?.price,
      }))),
    };
  }

  function compareWithSnapshot(products, snapshot) {
    const current = Array.isArray(products) ? products : [];
    const previous = normalizeComparisonSnapshot(snapshot);
    if (!previous) {
      return {
        baseline: true,
        previousCapturedAt: '',
        products: current.map((product) => ({ ...product })),
        missing: [],
        summary: { new: 0, cheaper: 0, expensive: 0, unchanged: 0, missing: 0 },
      };
    }

    const previousByKey = new Map(previous.products.map((product) => [product.key, product]));
    const currentKeys = new Set();
    const summary = { new: 0, cheaper: 0, expensive: 0, unchanged: 0, missing: 0 };
    const comparedProducts = current.map((product) => {
      const key = createProductIdentity(product);
      currentKeys.add(key);
      const oldProduct = previousByKey.get(key);
      if (!oldProduct) {
        summary.new += 1;
        return {
          ...product,
          comparisonStatus: 'new',
          comparisonLabel: 'Новий товар',
          previousPrice: '',
          priceDifference: '',
        };
      }

      const currentPrice = currentProductPrice(product);
      const previousPrice = numberOrNull(oldProduct.price);
      const difference = currentPrice === null || previousPrice === null
        ? null
        : roundMoney(currentPrice - previousPrice);
      const status = difference === null || Math.abs(difference) < 0.005
        ? 'unchanged'
        : difference < 0 ? 'cheaper' : 'expensive';
      summary[status] += 1;
      return {
        ...product,
        comparisonStatus: status,
        comparisonLabel: comparisonStatusLabel(status),
        previousPrice: previousPrice ?? '',
        priceDifference: difference ?? '',
      };
    });

    const missing = previous.products
      .filter((product) => !currentKeys.has(product.key))
      .map((product) => ({
        ...product,
        comparisonStatus: 'missing',
        comparisonLabel: 'Зник із видачі',
        previousPrice: product.price ?? '',
      }));
    summary.missing = missing.length;
    return {
      baseline: false,
      previousCapturedAt: previous.capturedAt,
      products: comparedProducts,
      missing,
      summary,
    };
  }

  function createProductIdentity(product) {
    const seller = normalizeText(product?.seller);
    const barcode = String(product?.barcode || '').replace(/\D/g, '');
    if (barcode) return `barcode:${barcode}|variant:${normalizeText(product?.variant)}|seller:${seller}`;
    const url = normalizeComparisonUrl(product?.url);
    const variant = normalizeText(product?.variant);
    if (url) return `url:${url}|variant:${variant}|seller:${seller}`;
    return `text:${normalizeText(product?.brand)}|${normalizeText(product?.name)}|${variant}|${seller}`;
  }

  function normalizeComparisonUrl(value) {
    const input = clean(value, 2_000);
    if (!input) return '';
    try {
      const url = new URL(input);
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) {
        if (/^(utm_|gclid|fbclid)/i.test(key)) url.searchParams.delete(key);
      }
      url.pathname = url.pathname.replace(/\/+$/, '') || '/';
      return url.toString();
    } catch (_error) {
      return input.replace(/#.*$/, '').replace(/\/+$/, '');
    }
  }

  function currentProductPrice(product) {
    for (const value of [product?.priceWithDiscount, product?.priceWithoutDiscount, product?.price]) {
      const number = numberOrNull(value);
      if (number !== null) return number;
    }
    return null;
  }

  function comparisonStatusLabel(status) {
    return {
      new: 'Новий товар',
      cheaper: 'Подешевшав',
      expensive: 'Подорожчав',
      unchanged: 'Без змін',
      missing: 'Зник із видачі',
    }[status] || '';
  }

  function numberOrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function normalizeText(value) {
    return clean(value, 2_000).normalize('NFKC').toLocaleLowerCase('uk');
  }

  function clean(value, limit) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function validDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
  }

  return {
    compareWithSnapshot,
    comparisonStatusLabel,
    compactSnapshotProducts,
    createComparisonSnapshot,
    createProductIdentity,
    createSnapshotKey,
    currentProductPrice,
    normalizeComparisonSnapshot,
  };
}));
