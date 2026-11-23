(function monitoringProjectsModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.priceMonitorMonitoringProjects = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createMonitoringProjectsApi() {
  const MAX_PROJECTS = 200;
  const MAX_RUN_HISTORY = 30;
  const STORE_ORDER = ['eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka'];
  const STORE_SET = new Set(STORE_ORDER);

  function parseMonitoringProjects(value) {
    let source = value;
    if (typeof value === 'string') {
      try {
        source = JSON.parse(value);
      } catch (_error) {
        return [];
      }
    }
    if (!Array.isArray(source)) return [];
    return source.slice(0, MAX_PROJECTS).map(normalizeProject).filter(Boolean);
  }

  function upsertMonitoringProject(projects, input, createId = defaultId) {
    const current = parseMonitoringProjects(projects);
    const normalized = normalizeProject({ ...input, id: input?.id || createId() });
    if (!normalized) return { projects: current, item: null, full: false };

    const index = current.findIndex((item) => item.id === normalized.id
      || normalizeKey(item.name) === normalizeKey(normalized.name));
    if (index >= 0) {
      const existing = current[index];
      const item = { ...normalized, id: existing.id, updatedAt: new Date().toISOString() };
      current[index] = item;
      return { projects: current, item, full: false };
    }
    if (current.length >= MAX_PROJECTS) return { projects: current, item: null, full: true };
    const item = { ...normalized, updatedAt: new Date().toISOString() };
    return { projects: [...current, item], item, full: false };
  }

  function removeMonitoringProject(projects, id) {
    const target = clean(id, 100);
    return parseMonitoringProjects(projects).filter((item) => item.id !== target);
  }

  function mergeMonitoringProjects(currentProjects, importedProjects, createId = defaultId) {
    let projects = parseMonitoringProjects(currentProjects);
    const imported = parseMonitoringProjects(importedProjects);
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const project of imported) {
      const existing = projects.find((item) => normalizeKey(item.name) === normalizeKey(project.name));
      if (existing) {
        const result = upsertMonitoringProject(projects, { ...project, id: existing.id }, createId);
        projects = result.projects;
        updated += 1;
      } else if (projects.length >= MAX_PROJECTS) {
        skipped += 1;
      } else {
        const result = upsertMonitoringProject(projects, { ...project, id: createId() }, createId);
        projects = result.projects;
        if (result.item) added += 1;
        else skipped += 1;
      }
    }
    return { projects, added, updated, skipped };
  }

  function findDueProject(projects, now = new Date()) {
    const current = validDate(now) || new Date();
    return parseMonitoringProjects(projects).find((project) => {
      if (project.schedule.kind !== 'daily') return false;
      if (sameLocalDay(project.lastStartedAt, current)) return false;
      const scheduled = scheduledDate(project.schedule.time, current);
      return scheduled.getTime() <= current.getTime();
    }) || null;
  }

  function nextRunAt(project, now = new Date()) {
    const normalized = normalizeProject(project);
    if (!normalized || normalized.schedule.kind !== 'daily') return '';
    const current = validDate(now) || new Date();
    const next = scheduledDate(normalized.schedule.time, current);
    if (sameLocalDay(normalized.lastStartedAt, current) || next.getTime() < current.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next.toISOString();
  }

  function markMonitoringProjectStarted(projects, id, at = new Date()) {
    return patchProject(projects, id, {
      lastStartedAt: toIso(at),
      lastOutcome: 'running',
      updatedAt: new Date().toISOString(),
    });
  }

  function markMonitoringProjectFinished(projects, id, result = {}) {
    const target = clean(id, 100);
    const completedAt = toIso(result.completedAt || new Date());
    const outcome = normalizeOutcome(result.outcome) || 'error';
    const productCount = Math.max(0, Math.floor(Number(result.productCount) || 0));
    return parseMonitoringProjects(projects).map((project) => {
      if (project.id !== target) return project;
      const run = {
        startedAt: validIso(result.startedAt) || project.lastStartedAt || completedAt,
        completedAt,
        trigger: result.trigger === 'scheduled' ? 'scheduled' : 'manual',
        outcome,
        productCount,
        reportFileName: cleanFileName(result.reportFileName),
      };
      return {
        ...project,
        lastCompletedAt: completedAt,
        lastOutcome: outcome,
        lastProductCount: productCount,
        runHistory: normalizeRunHistory([run, ...project.runHistory]),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function normalizeProject(value) {
    const id = clean(value?.id, 100);
    const name = clean(value?.name, 80);
    const query = clean(value?.query, 500);
    const stores = [...new Set(Array.isArray(value?.stores) ? value.stores : [])]
      .map((store) => clean(store, 20).toLocaleLowerCase('uk-UA'))
      .filter((store) => STORE_SET.has(store))
      .sort((a, b) => STORE_ORDER.indexOf(a) - STORE_ORDER.indexOf(b));
    if (!id || !name || !query || stores.length < 2) return null;
    return {
      id,
      name,
      query,
      stores,
      mode: value?.mode === 'detailed' ? 'detailed' : 'fast',
      schedule: normalizeSchedule(value?.schedule),
      lastStartedAt: validIso(value?.lastStartedAt),
      lastCompletedAt: validIso(value?.lastCompletedAt),
      lastOutcome: normalizeOutcome(value?.lastOutcome),
      lastProductCount: Math.max(0, Math.floor(Number(value?.lastProductCount) || 0)),
      runHistory: normalizeRunHistory(value?.runHistory),
      updatedAt: validIso(value?.updatedAt) || new Date().toISOString(),
    };
  }

  function normalizeSchedule(value) {
    return {
      kind: value?.kind === 'daily' ? 'daily' : 'manual',
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value?.time || '')) ? String(value.time) : '09:00',
    };
  }

  function patchProject(projects, id, patch) {
    const target = clean(id, 100);
    return parseMonitoringProjects(projects).map((project) => (
      project.id === target ? { ...project, ...patch } : project
    ));
  }

  function scheduledDate(time, sourceDate) {
    const [hours, minutes] = normalizeSchedule({ kind: 'daily', time }).time.split(':').map(Number);
    const result = new Date(sourceDate);
    result.setHours(hours, minutes, 0, 0);
    return result;
  }

  function sameLocalDay(value, sourceDate) {
    const candidate = validDate(value);
    if (!candidate) return false;
    return candidate.getFullYear() === sourceDate.getFullYear()
      && candidate.getMonth() === sourceDate.getMonth()
      && candidate.getDate() === sourceDate.getDate();
  }

  function normalizeOutcome(value) {
    const outcome = clean(value, 20);
    return ['running', 'success', 'partial', 'cancelled', 'error'].includes(outcome) ? outcome : '';
  }

  function normalizeRunHistory(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_RUN_HISTORY).map((run) => {
      const completedAt = validIso(run?.completedAt);
      const outcome = normalizeOutcome(run?.outcome);
      if (!completedAt || !outcome || outcome === 'running') return null;
      return {
        startedAt: validIso(run?.startedAt) || completedAt,
        completedAt,
        trigger: run?.trigger === 'scheduled' ? 'scheduled' : 'manual',
        outcome,
        productCount: Math.max(0, Math.floor(Number(run?.productCount) || 0)),
        reportFileName: cleanFileName(run?.reportFileName),
      };
    }).filter(Boolean);
  }

  function cleanFileName(value) {
    const name = clean(value, 180);
    return /[\\/:*?"<>|]/.test(name) ? '' : name;
  }

  function validDate(value) {
    const result = value instanceof Date ? new Date(value) : new Date(String(value || ''));
    return Number.isNaN(result.getTime()) ? null : result;
  }

  function validIso(value) {
    const date = validDate(value);
    return date ? date.toISOString() : '';
  }

  function toIso(value) {
    return (validDate(value) || new Date()).toISOString();
  }

  function normalizeKey(value) {
    return clean(value, 80).normalize('NFKC').toLocaleLowerCase('uk-UA');
  }

  function clean(value, limit) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function defaultId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  return {
    STORE_ORDER,
    findDueProject,
    markMonitoringProjectFinished,
    markMonitoringProjectStarted,
    mergeMonitoringProjects,
    nextRunAt,
    parseMonitoringProjects,
    removeMonitoringProject,
    upsertMonitoringProject,
  };
}));
