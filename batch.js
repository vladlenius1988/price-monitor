(function exposeBatchUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.priceMonitorBatch = api;
}(typeof window !== 'undefined' ? window : null, () => {
  function splitBrandQueries(value) {
    const result = [];
    const seen = new Set();
    for (const part of String(value || '').split(/[,;\r\n]+/)) {
      const query = part.replace(/\s+/g, ' ').trim();
      if (!query) continue;
      const key = query.normalize('NFKC').toLocaleLowerCase('uk');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(query);
    }
    return result;
  }

  function activeBrandSegment(value) {
    const text = String(value || '');
    const separatorIndex = lastSeparatorIndex(text);
    return text.slice(separatorIndex + 1).trim();
  }

  function replaceActiveBrandSegment(value, suggestion) {
    const text = String(value || '');
    const separatorIndex = lastSeparatorIndex(text);
    if (separatorIndex < 0) return String(suggestion || '').trim();
    return `${text.slice(0, separatorIndex + 1)} ${String(suggestion || '').trim()}`;
  }

  function normalizePastedBrands(value) {
    return String(value || '').replace(/[\r\n]+/g, ', ');
  }

  function mergeProducts(current, incoming) {
    const products = new Map();
    for (const product of [...(current || []), ...(incoming || [])]) {
      if (!product?.name) continue;
      const baseKey = product.url || `${normalizeKey(product.brand)}:${normalizeKey(product.name)}`;
      const key = product.seller ? `${baseKey}:${normalizeKey(product.seller)}` : baseKey;
      products.set(key, product);
    }
    return [...products.values()];
  }

  function cleanParserError(error) {
    let message = String(error?.message || error || 'Не вдалося завантажити каталог').trim();
    message = message
      .replace(/^Error invoking remote method\s+'[^']+':\s*/i, '')
      .replace(/^(?:Error:\s*)+/i, '')
      .trim();
    return message || 'Не вдалося завантажити каталог';
  }

  async function runBrandBatch(queries, worker, callbacks = {}) {
    const items = splitBrandQueries(queries);
    const successes = [];
    const failures = [];
    let products = [];
    let stopped = false;

    for (let index = 0; index < items.length; index += 1) {
      if (callbacks.shouldStop?.()) {
        stopped = true;
        break;
      }

      const query = items[index];
      callbacks.onStart?.({ query, index, total: items.length });
      try {
        const result = await worker(query, index, items.length);
        products = mergeProducts(products, result?.products);
        const success = {
          query,
          brand: result?.brand || query,
          count: Array.isArray(result?.products) ? result.products.length : 0,
        };
        successes.push(success);
        callbacks.onSuccess?.({ ...success, index, total: items.length, products });
        if (result?.cancelled) {
          stopped = true;
          break;
        }
      } catch (error) {
        if (callbacks.shouldStop?.()) {
          stopped = true;
          break;
        }
        const failure = { query, message: cleanParserError(error) };
        failures.push(failure);
        callbacks.onError?.({ ...failure, index, total: items.length, products });
      }
    }

    return { queries: items, successes, failures, products, stopped };
  }

  function lastSeparatorIndex(value) {
    return Math.max(
      value.lastIndexOf(','),
      value.lastIndexOf(';'),
      value.lastIndexOf('\n'),
      value.lastIndexOf('\r'),
    );
  }

  function normalizeKey(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('uk');
  }

  return {
    activeBrandSegment,
    cleanParserError,
    mergeProducts,
    normalizePastedBrands,
    replaceActiveBrandSegment,
    runBrandBatch,
    splitBrandQueries,
  };
}));
