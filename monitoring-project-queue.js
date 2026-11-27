(function monitoringProjectQueueModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.priceMonitorMonitoringProjectQueue = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createMonitoringProjectQueueApi() {
  const ITEM_STATUSES = new Set(['pending', 'running', 'success', 'partial', 'cancelled', 'error']);

  function createMonitoringProjectQueue(projects, selectedIds, createdAt = new Date()) {
    const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String));
    const seen = new Set();
    const items = [];
    for (const project of Array.isArray(projects) ? projects : []) {
      const projectId = String(project?.id || '').trim();
      if (!projectId || seen.has(projectId) || !selected.has(projectId)) continue;
      seen.add(projectId);
      items.push({
        projectId,
        name: clean(project?.name, 80) || 'Проєкт без назви',
        status: 'pending',
        productCount: 0,
        reportFileName: '',
        startedAt: '',
        completedAt: '',
      });
    }
    return {
      status: 'ready',
      stopRequested: false,
      createdAt: toIso(createdAt),
      startedAt: '',
      completedAt: '',
      summaryFileName: '',
      items,
    };
  }

  function startMonitoringProjectQueue(queue, startedAt = new Date()) {
    return updateQueue(queue, {
      status: 'running',
      stopRequested: false,
      startedAt: toIso(startedAt),
      completedAt: '',
    });
  }

  function markQueueItemRunning(queue, projectId, startedAt = new Date()) {
    return updateItem(queue, projectId, (item) => ({
      ...item,
      status: 'running',
      startedAt: toIso(startedAt),
      completedAt: '',
    }));
  }

  function finishQueueItem(queue, projectId, result = {}, completedAt = new Date()) {
    const status = ITEM_STATUSES.has(result.outcome) && result.outcome !== 'pending' && result.outcome !== 'running'
      ? result.outcome : 'error';
    return updateItem(queue, projectId, (item) => ({
      ...item,
      status,
      productCount: Math.max(0, Number(result.productCount) || 0),
      reportFileName: safeReportFileName(result.reportFileName),
      completedAt: toIso(completedAt),
    }));
  }

  function requestMonitoringProjectQueueStop(queue) {
    return updateQueue(queue, { status: 'stopping', stopRequested: true });
  }

  function recoverMonitoringProjectQueue(queue) {
    const normalized = normalizeQueue(queue);
    if (!['running', 'stopping'].includes(normalized.status)) return normalized;
    return {
      ...normalized,
      status: 'interrupted',
      stopRequested: false,
      completedAt: '',
      items: normalized.items.map((item) => item.status === 'running' ? {
        ...item,
        status: 'pending',
        startedAt: '',
        completedAt: '',
      } : item),
    };
  }

  function attachQueueSummaryReport(queue, fileName) {
    return { ...normalizeQueue(queue), summaryFileName: safeReportFileName(fileName) };
  }

  function finishMonitoringProjectQueue(queue, completedAt = new Date()) {
    const normalized = normalizeQueue(queue);
    return {
      ...normalized,
      status: normalized.stopRequested ? 'stopped' : 'completed',
      completedAt: toIso(completedAt),
      items: normalized.items.map((item) => item.status === 'running'
        ? { ...item, status: 'cancelled', completedAt: toIso(completedAt) }
        : item),
    };
  }

  function queueSummary(queue) {
    const normalized = normalizeQueue(queue);
    const result = {
      total: normalized.items.length,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      productCount: 0,
      reportCount: 0,
    };
    for (const item of normalized.items) {
      if (item.status === 'pending') result.pending += 1;
      else if (item.status === 'running') result.running += 1;
      else if (item.status === 'error') result.failed += 1;
      else if (item.status === 'cancelled') result.cancelled += 1;
      else result.completed += 1;
      result.productCount += item.productCount;
      if (item.reportFileName) result.reportCount += 1;
    }
    return result;
  }

  function failedQueueProjectIds(queue) {
    return normalizeQueue(queue).items
      .filter((item) => item.status === 'error')
      .map((item) => item.projectId);
  }

  function pendingQueueProjectIds(queue) {
    return normalizeQueue(queue).items
      .filter((item) => item.status === 'pending')
      .map((item) => item.projectId);
  }

  function filterMonitoringProjectsForQueue(projects, filters = {}) {
    const search = normalizeFilterText(filters.search);
    const store = clean(filters.store, 20).toLocaleLowerCase('uk-UA');
    const outcome = clean(filters.outcome, 20).toLocaleLowerCase('uk-UA');
    return (Array.isArray(projects) ? projects : []).filter((project) => {
      const stores = Array.isArray(project?.stores) ? project.stores.map((value) => clean(value, 20).toLocaleLowerCase('uk-UA')) : [];
      const projectOutcome = clean(project?.lastOutcome, 20).toLocaleLowerCase('uk-UA');
      if (store && store !== 'all' && !stores.includes(store)) return false;
      if (outcome && outcome !== 'all') {
        if (outcome === 'never' ? projectOutcome : projectOutcome !== outcome) return false;
      }
      if (!search) return true;
      return normalizeFilterText(`${project?.name || ''} ${project?.query || ''}`).includes(search);
    });
  }

  function normalizeQueue(queue) {
    const source = queue && typeof queue === 'object' ? queue : {};
    return {
      status: ['ready', 'running', 'stopping', 'stopped', 'completed', 'interrupted'].includes(source.status) ? source.status : 'ready',
      stopRequested: Boolean(source.stopRequested),
      createdAt: validIso(source.createdAt),
      startedAt: validIso(source.startedAt),
      completedAt: validIso(source.completedAt),
      summaryFileName: safeReportFileName(source.summaryFileName),
      items: (Array.isArray(source.items) ? source.items : []).map(normalizeItem).filter(Boolean),
    };
  }

  function normalizeItem(item) {
    const projectId = String(item?.projectId || '').trim();
    if (!projectId) return null;
    return {
      projectId,
      name: clean(item?.name, 80) || 'Проєкт без назви',
      status: ITEM_STATUSES.has(item?.status) ? item.status : 'pending',
      productCount: Math.max(0, Number(item?.productCount) || 0),
      reportFileName: safeReportFileName(item?.reportFileName),
      startedAt: validIso(item?.startedAt),
      completedAt: validIso(item?.completedAt),
    };
  }

  function updateQueue(queue, patch) {
    return { ...normalizeQueue(queue), ...patch };
  }

  function updateItem(queue, projectId, updater) {
    const normalized = normalizeQueue(queue);
    const id = String(projectId || '');
    return {
      ...normalized,
      items: normalized.items.map((item) => item.projectId === id ? updater(item) : item),
    };
  }

  function safeReportFileName(value) {
    const name = clean(value, 240);
    if (!name || name.includes('..') || /[\\/:*?"<>|]/.test(name)) return '';
    return name;
  }

  function clean(value, limit) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function normalizeFilterText(value) {
    return clean(value, 600)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('uk-UA');
  }

  function toIso(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function validIso(value) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  return {
    attachQueueSummaryReport,
    createMonitoringProjectQueue,
    failedQueueProjectIds,
    filterMonitoringProjectsForQueue,
    finishMonitoringProjectQueue,
    finishQueueItem,
    markQueueItemRunning,
    normalizeQueue,
    pendingQueueProjectIds,
    queueSummary,
    recoverMonitoringProjectQueue,
    requestMonitoringProjectQueueStop,
    startMonitoringProjectQueue,
  };
}));
