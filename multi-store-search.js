(function exposeMultiStoreSearch(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.priceMonitorMultiStoreSearch = api;
}(typeof window !== 'undefined' ? window : null, () => {
  const STORE_ORDER = Object.freeze(['eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka']);
  const STORE_LABELS = Object.freeze({
    eva: 'EVA', varus: 'VARUS', makeup: 'MAKEUP', aurora: 'Аврора', notino: 'Notino', rozetka: 'Rozetka',
  });

  function normalizeStoreSelection(selected, allowed = STORE_ORDER, { required = [], maximum = STORE_ORDER.length } = {}) {
    const allowedSet = new Set((Array.isArray(allowed) ? allowed : STORE_ORDER).filter((store) => STORE_ORDER.includes(store)));
    const selectedSet = new Set((Array.isArray(selected) ? selected : []).filter((store) => allowedSet.has(store)));
    for (const store of required) {
      if (allowedSet.has(store)) selectedSet.add(store);
    }
    return STORE_ORDER.filter((store) => selectedSet.has(store)).slice(0, Math.max(1, Number(maximum) || STORE_ORDER.length));
  }

  function searchOptions(store, mode = 'fast', { barcodeReference = false } = {}) {
    const detailed = mode === 'detailed';
    const exactMakeup = barcodeReference && store === 'makeup';
    return {
      includeVariants: exactMakeup || (detailed && ['eva', 'makeup', 'notino', 'aurora'].includes(store)),
      includeSellers: detailed && store === 'rozetka',
      includeBarcodes: exactMakeup || (detailed && store === 'makeup'),
    };
  }

  function replaceStoreProducts(current, store, incoming, storeLabel = STORE_LABELS[store] || store) {
    const retained = (Array.isArray(current) ? current : []).filter((product) => product?.store !== store);
    const mapped = (Array.isArray(incoming) ? incoming : [])
      .filter((product) => product?.name)
      .map((product) => ({ ...product, store, storeLabel }));
    return [...retained, ...mapped];
  }

  function mergeStoreProducts(current, store, incoming, storeLabel = STORE_LABELS[store] || store) {
    const retained = (Array.isArray(current) ? current : []).filter((product) => product?.store !== store);
    const storeProducts = new Map();
    for (const product of [
      ...(Array.isArray(current) ? current.filter((item) => item?.store === store) : []),
      ...(Array.isArray(incoming) ? incoming : []),
    ]) {
      if (!product?.name) continue;
      const key = [product.url, product.seller, product.variant, product.brand, product.name]
        .map((value) => String(value || '').normalize('NFKC').toLocaleLowerCase('uk-UA').trim())
        .join('|');
      storeProducts.set(key, { ...product, store, storeLabel });
    }
    return [...retained, ...storeProducts.values()];
  }

  function failedStoreIds(reports) {
    return STORE_ORDER.filter((store) => (Array.isArray(reports) ? reports : [])
      .some((report) => report?.store === store && ['error', 'partial'].includes(report.status)));
  }

  function totalParseCalls(stores, queries) {
    return Math.max(0, (Array.isArray(stores) ? stores.length : 0) * (Array.isArray(queries) ? queries.length : 0));
  }

  return {
    STORE_LABELS,
    STORE_ORDER,
    failedStoreIds,
    mergeStoreProducts,
    normalizeStoreSelection,
    replaceStoreProducts,
    searchOptions,
    totalParseCalls,
  };
}));
