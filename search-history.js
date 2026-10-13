(function exposeSearchHistoryUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.priceMonitorSearchHistory = api;
}(typeof window !== 'undefined' ? window : null, () => {
  const MAX_PER_STORE = 12;

  function parseSearchHistory(value) {
    let items = value;
    if (typeof value === 'string') {
      try { items = JSON.parse(value); } catch (_error) { return []; }
    }
    if (!Array.isArray(items)) return [];

    const result = [];
    const seen = new Set();
    for (const item of items) {
      const id = clean(item?.id, 100);
      const store = clean(item?.store, 30).toLowerCase();
      const query = cleanQuery(item?.query);
      if (!id || !store || !query || seen.has(id)) continue;
      seen.add(id);
      result.push({
        id,
        store,
        query,
        searchedAt: validDate(item?.searchedAt),
        productCount: clampCount(item?.productCount),
        outcome: ['success', 'stopped', 'error'].includes(item?.outcome) ? item.outcome : 'success',
        options: {
          includeVariants: Boolean(item?.options?.includeVariants),
          includeSellers: Boolean(item?.options?.includeSellers),
          includeBarcodes: Boolean(item?.options?.includeBarcodes),
        },
      });
    }
    return limitPerStore(result);
  }

  function historyForStore(history, store) {
    const storeId = clean(store, 30).toLowerCase();
    return parseSearchHistory(history)
      .filter((item) => item.store === storeId)
      .sort((left, right) => Date.parse(right.searchedAt) - Date.parse(left.searchedAt));
  }

  function addSearchHistory(history, input, createId = defaultId, now = () => new Date().toISOString()) {
    const current = parseSearchHistory(history);
    const store = clean(input?.store, 30).toLowerCase();
    const query = cleanQuery(input?.query);
    if (!store || !query) return { history: current, item: null };

    const key = normalizeKey(query);
    const withoutDuplicate = current.filter((item) => item.store !== store || normalizeKey(item.query) !== key);
    const usedIds = new Set(current.map((item) => item.id));
    let id = clean(createId(), 100) || defaultId();
    while (usedIds.has(id)) id = defaultId();
    const item = {
      id,
      store,
      query,
      searchedAt: validDate(now()),
      productCount: clampCount(input?.productCount),
      outcome: ['success', 'stopped', 'error'].includes(input?.outcome) ? input.outcome : 'success',
      options: {
        includeVariants: Boolean(input?.options?.includeVariants),
        includeSellers: Boolean(input?.options?.includeSellers),
        includeBarcodes: Boolean(input?.options?.includeBarcodes),
      },
    };
    return { history: limitPerStore([item, ...withoutDuplicate]), item };
  }

  function clearSearchHistoryStore(history, store) {
    const storeId = clean(store, 30).toLowerCase();
    return parseSearchHistory(history).filter((item) => item.store !== storeId);
  }

  function mergeSearchHistory(currentHistory, importedHistory) {
    const current = parseSearchHistory(currentHistory);
    const imported = parseSearchHistory(importedHistory);
    const usedIds = new Set(current.map((item) => item.id));
    let added = 0;
    let updated = 0;

    for (const importedItem of imported) {
      const index = current.findIndex((item) => item.store === importedItem.store
        && normalizeKey(item.query) === normalizeKey(importedItem.query));
      if (index >= 0) {
        if (Date.parse(importedItem.searchedAt) > Date.parse(current[index].searchedAt)) {
          current[index] = { ...importedItem, id: current[index].id };
          updated += 1;
        }
        continue;
      }
      let id = importedItem.id;
      while (!id || usedIds.has(id)) id = defaultId();
      usedIds.add(id);
      current.push({ ...importedItem, id });
      added += 1;
    }

    const history = limitPerStore(current.sort((left, right) => Date.parse(right.searchedAt) - Date.parse(left.searchedAt)));
    return { history, added, updated };
  }

  function limitPerStore(items) {
    const counts = new Map();
    return items.filter((item) => {
      const count = counts.get(item.store) || 0;
      if (count >= MAX_PER_STORE) return false;
      counts.set(item.store, count + 1);
      return true;
    });
  }

  function clean(value, limit) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function cleanQuery(value) {
    return String(value ?? '').replace(/[\r\n]+/g, ', ').replace(/\s+/g, ' ').trim().slice(0, 2_000);
  }

  function normalizeKey(value) {
    return cleanQuery(value).normalize('NFKC').toLocaleLowerCase('uk');
  }

  function clampCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(10_000_000, Math.trunc(number))) : 0;
  }

  function validDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
  }

  function defaultId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  return {
    addSearchHistory,
    clearSearchHistoryStore,
    historyForStore,
    mergeSearchHistory,
    parseSearchHistory,
  };
}));
