(function exposeArchiveTools(root, factory) {
  const comparison = typeof module === 'object' && module.exports
    ? require('./comparison') : root?.priceMonitorComparison;
  const api = factory(comparison);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.priceMonitorArchiveTools = api;
}(typeof window !== 'undefined' ? window : null, (comparison) => {
  function canCompareArchives(previous, current) {
    return Boolean(previous && current && previous.id !== current.id
      && !previous.truncated && !current.truncated
      && previous.complete !== false && current.complete !== false
      && previous.store === current.store
      && Number.isFinite(Date.parse(previous.capturedAt))
      && Date.parse(current.capturedAt) > Date.parse(previous.capturedAt)
      && comparison.createSnapshotKey(previous.store, previous.query, previous.options)
        === comparison.createSnapshotKey(current.store, current.query, current.options));
  }

  function compareArchivedChecks(previous, current) {
    if (!canCompareArchives(previous, current)
      || !Array.isArray(previous.products) || !Array.isArray(current.products)) {
      throw new Error('Оберіть дві повні нескорочені перевірки одного магазину, однакового запиту та режимів. Друга перевірка має бути пізнішою.');
    }
    const key = comparison.createSnapshotKey(previous.store, previous.query, previous.options);
    const snapshot = comparison.createComparisonSnapshot({ ...previous, key });
    return {
      ...comparison.compareWithSnapshot(current.products, snapshot),
      source: 'archive',
      comparedCapturedAt: current.capturedAt,
      previousArchiveId: previous.id,
      currentArchiveId: current.id,
    };
  }

  return { canCompareArchives, compareArchivedChecks };
}));
