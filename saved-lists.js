(function exposeSavedListUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.priceMonitorSavedLists = api;
}(typeof window !== 'undefined' ? window : null, () => {
  const MAX_LISTS = 100;

  function parseSavedLists(value) {
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
      const name = clean(item?.name, 80);
      const query = clean(item?.query, 2_000);
      if (!id || !store || !name || !query || seen.has(id)) continue;
      seen.add(id);
      result.push({
        id,
        store,
        name,
        query,
        options: normalizeOptions(item?.options),
        updatedAt: clean(item?.updatedAt, 40),
      });
      if (result.length >= MAX_LISTS) break;
    }
    return result;
  }

  function listsForStore(lists, store) {
    const storeId = clean(store, 30).toLowerCase();
    return parseSavedLists(lists)
      .filter((item) => item.store === storeId)
      .sort((left, right) => left.name.localeCompare(right.name, 'uk', { sensitivity: 'base' }));
  }

  function upsertSavedList(lists, input, createId = defaultId) {
    const current = parseSavedLists(lists);
    const store = clean(input?.store, 30).toLowerCase();
    const name = clean(input?.name, 80);
    const query = clean(input?.query, 2_000);
    if (!store || !name || !query) return { lists: current, item: null };

    const nameKey = normalizeKey(name);
    const existing = current.find((item) => item.store === store && normalizeKey(item.name) === nameKey);
    const item = {
      id: existing?.id || clean(createId(), 100) || defaultId(),
      store,
      name,
      query,
      options: normalizeOptions(input?.options ?? existing?.options),
      updatedAt: new Date().toISOString(),
    };
    const next = existing
      ? current.map((entry) => entry.id === existing.id ? item : entry)
      : [...current, item].slice(-MAX_LISTS);
    return { lists: next, item };
  }

  function removeSavedList(lists, id) {
    const targetId = clean(id, 100);
    return parseSavedLists(lists).filter((item) => item.id !== targetId);
  }

  function renameSavedList(lists, id, name) {
    const current = parseSavedLists(lists);
    const targetId = clean(id, 100);
    const nextName = clean(name, 80);
    const index = current.findIndex((item) => item.id === targetId);
    if (index < 0 || !nextName) return { lists: current, item: null, conflict: false };
    const source = current[index];
    const conflict = current.some((item) => item.id !== targetId
      && item.store === source.store
      && normalizeKey(item.name) === normalizeKey(nextName));
    if (conflict) return { lists: current, item: null, conflict: true };
    const item = { ...source, name: nextName, updatedAt: new Date().toISOString() };
    current[index] = item;
    return { lists: current, item, conflict: false };
  }

  function duplicateSavedList(lists, id, name, createId = defaultId) {
    const current = parseSavedLists(lists);
    const source = current.find((item) => item.id === clean(id, 100));
    const nextName = clean(name, 80);
    if (!source || !nextName || current.length >= MAX_LISTS) {
      return { lists: current, item: null, conflict: false, full: current.length >= MAX_LISTS };
    }
    const conflict = current.some((item) => item.store === source.store
      && normalizeKey(item.name) === normalizeKey(nextName));
    if (conflict) return { lists: current, item: null, conflict: true, full: false };
    const usedIds = new Set(current.map((item) => item.id));
    let newId = clean(createId(), 100) || defaultId();
    while (usedIds.has(newId)) newId = defaultId();
    const item = {
      ...source,
      id: newId,
      name: nextName,
      updatedAt: new Date().toISOString(),
    };
    return { lists: [...current, item], item, conflict: false, full: false };
  }

  function createSavedListsBackup(
    lists,
    exportedAt = new Date().toISOString(),
    searchHistory = [],
    comparisonSnapshots = [],
    archives = [],
  ) {
    return {
      app: 'Price Monitor',
      kind: 'price-monitor-backup',
      formatVersion: 4,
      exportedAt: clean(exportedAt, 40),
      lists: parseSavedLists(lists),
      searchHistory: Array.isArray(searchHistory) ? searchHistory : [],
      comparisonSnapshots: Array.isArray(comparisonSnapshots) ? comparisonSnapshots : [],
      archives: Array.isArray(archives) ? archives : [],
    };
  }

  function parsePriceMonitorBackup(value) {
    let backup = value;
    if (typeof value === 'string') {
      try {
        backup = JSON.parse(value);
      } catch (_error) {
        throw new Error('Файл не є коректною резервною копією списків.');
      }
    }

    const legacyArray = Array.isArray(backup);
    const legacyBackup = backup?.kind === 'saved-brand-lists' && backup?.formatVersion === 1;
    const currentBackupV2 = backup?.kind === 'price-monitor-backup' && backup?.formatVersion === 2;
    const currentBackupV3 = backup?.kind === 'price-monitor-backup' && backup?.formatVersion === 3;
    const currentBackupV4 = backup?.kind === 'price-monitor-backup' && backup?.formatVersion === 4;
    const hasComparisons = currentBackupV3 || currentBackupV4;
    const currentBackup = currentBackupV2 || hasComparisons;
    const rawLists = legacyArray ? backup : legacyBackup || currentBackup ? backup.lists : null;
    if (!Array.isArray(rawLists)) {
      throw new Error('Цей файл створено не функцією резервного копіювання Price Monitor.');
    }

    const lists = parseSavedLists(rawLists);
    if (rawLists.length && !lists.length) {
      throw new Error('У резервній копії немає придатних списків.');
    }
    if (currentBackup && !Array.isArray(backup.searchHistory)) {
      throw new Error('Резервна копія містить пошкоджену історію пошуку.');
    }
    const searchHistory = currentBackup && Array.isArray(backup.searchHistory) ? backup.searchHistory : [];
    if (hasComparisons && !Array.isArray(backup.comparisonSnapshots)) {
      throw new Error('Резервна копія містить пошкоджені знімки порівняння.');
    }
    if (currentBackupV4 && !Array.isArray(backup.archives)) {
      throw new Error('Резервна копія містить пошкоджений архів перевірок.');
    }
    return {
      formatVersion: currentBackupV4 ? 4 : currentBackupV3 ? 3 : currentBackupV2 ? 2 : 1,
      lists,
      searchHistory,
      comparisonSnapshots: hasComparisons ? backup.comparisonSnapshots : [],
      archives: currentBackupV4 ? backup.archives : [],
    };
  }

  function parseSavedListsBackup(value) {
    return parsePriceMonitorBackup(value).lists;
  }

  function mergeSavedLists(currentLists, importedLists, createId = defaultId) {
    const result = parseSavedLists(currentLists);
    const imported = parseSavedLists(importedLists);
    const usedIds = new Set(result.map((item) => item.id));
    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const importedItem of imported) {
      const existingIndex = result.findIndex((item) => item.store === importedItem.store
        && normalizeKey(item.name) === normalizeKey(importedItem.name));
      if (existingIndex >= 0) {
        const existing = result[existingIndex];
        result[existingIndex] = { ...importedItem, id: existing.id };
        updated += 1;
        continue;
      }
      if (result.length >= MAX_LISTS) {
        skipped += 1;
        continue;
      }
      let id = importedItem.id;
      while (!id || usedIds.has(id)) id = clean(createId(), 100) || defaultId();
      usedIds.add(id);
      result.push({ ...importedItem, id });
      added += 1;
    }

    return { lists: parseSavedLists(result), added, updated, skipped };
  }

  function clean(value, limit) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function normalizeOptions(value) {
    return {
      includeVariants: Boolean(value?.includeVariants),
      includeSellers: Boolean(value?.includeSellers),
      includeBarcodes: Boolean(value?.includeBarcodes),
    };
  }

  function normalizeKey(value) {
    return clean(value, 80).normalize('NFKC').toLocaleLowerCase('uk');
  }

  function defaultId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  return {
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
  };
}));
