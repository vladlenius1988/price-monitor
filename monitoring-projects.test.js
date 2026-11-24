const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findDueProject,
  markMonitoringProjectFinished,
  markMonitoringProjectStarted,
  mergeMonitoringProjects,
  nextRunAt,
  parseMonitoringProjects,
  removeMonitoringProject,
  upsertMonitoringProject,
} = require('./monitoring-projects');

function project(overrides = {}) {
  return {
    id: 'morning',
    name: 'Ранковий моніторинг',
    query: 'Nivea, Dove',
    stores: ['makeup', 'eva', 'eva'],
    mode: 'detailed',
    schedule: { kind: 'daily', time: '09:15' },
    ...overrides,
  };
}

test('monitoring projects normalize a complete multi-store scenario', () => {
  const [result] = parseMonitoringProjects([project()]);
  assert.equal(result.name, 'Ранковий моніторинг');
  assert.equal(result.query, 'Nivea, Dove');
  assert.deepEqual(result.stores, ['eva', 'makeup']);
  assert.equal(result.mode, 'detailed');
  assert.deepEqual(result.schedule, { kind: 'daily', time: '09:15' });
  assert.deepEqual(parseMonitoringProjects([project({ stores: ['eva'] })]), []);
});

test('upsert updates a project by name and preserves its identity', () => {
  const first = upsertMonitoringProject([], project(), () => 'created');
  const second = upsertMonitoringProject(first.projects, project({ id: '', query: 'Dove', mode: 'fast' }), () => 'other');
  assert.equal(second.projects.length, 1);
  assert.equal(second.item.id, 'morning');
  assert.equal(second.item.query, 'Dove');
  assert.equal(second.item.mode, 'fast');
  assert.deepEqual(removeMonitoringProject(second.projects, 'morning'), []);
});

test('daily project becomes due once per local day after its time', () => {
  const now = new Date(2026, 10, 20, 10, 0, 0);
  const source = parseMonitoringProjects([project()]);
  assert.equal(findDueProject(source, now)?.id, 'morning');
  const started = markMonitoringProjectStarted(source, 'morning', new Date(2026, 10, 20, 9, 16, 0));
  assert.equal(findDueProject(started, now), null);
  const next = new Date(nextRunAt(started[0], now));
  assert.equal(next.getDate(), 21);
  assert.equal(next.getHours(), 9);
  assert.equal(next.getMinutes(), 15);
});

test('run result is stored for a clear project summary', () => {
  const started = markMonitoringProjectStarted([project()], 'morning', new Date(2026, 10, 20, 9, 15, 0));
  const finished = markMonitoringProjectFinished(started, 'morning', {
    completedAt: new Date(2026, 10, 20, 9, 20, 0), outcome: 'partial', productCount: 124,
    trigger: 'scheduled', reportFileName: 'price_monitor_multi_nivea_2026-11-20.xlsx',
  });
  assert.equal(finished[0].lastOutcome, 'partial');
  assert.equal(finished[0].lastProductCount, 124);
  assert.match(finished[0].lastCompletedAt, /^2026-11-20T/);
  assert.equal(finished[0].runHistory.length, 1);
  assert.equal(finished[0].runHistory[0].trigger, 'scheduled');
  assert.equal(finished[0].runHistory[0].reportFileName, 'price_monitor_multi_nivea_2026-11-20.xlsx');
});

test('batch queue is retained as a separate run trigger', () => {
  const finished = markMonitoringProjectFinished([project()], 'morning', {
    completedAt: new Date(2026, 10, 20, 9, 20, 0), outcome: 'success', productCount: 42,
    trigger: 'queue', reportFileName: 'morning.xlsx',
  });
  assert.equal(finished[0].runHistory[0].trigger, 'queue');
});

test('run history stays bounded and rejects unsafe report file names', () => {
  let projects = [project()];
  for (let index = 0; index < 35; index += 1) {
    projects = markMonitoringProjectStarted(projects, 'morning', new Date(2026, 10, 20, 10, index, 0));
    projects = markMonitoringProjectFinished(projects, 'morning', {
      completedAt: new Date(2026, 10, 20, 10, index, 30), outcome: 'success', productCount: index,
      trigger: index % 2 ? 'manual' : 'scheduled', reportFileName: index === 34 ? '..\\secret.xlsx' : `report-${index}.xlsx`,
    });
  }
  assert.equal(projects[0].runHistory.length, 30);
  assert.equal(projects[0].runHistory[0].productCount, 34);
  assert.equal(projects[0].runHistory[0].reportFileName, '');
});

test('backup merge updates same-name project and adds a new one', () => {
  const current = [project({ query: 'Old' })];
  const imported = [
    project({ id: 'foreign', query: 'New' }),
    project({ id: 'evening', name: 'Вечірній', query: 'Lamel' }),
  ];
  const result = mergeMonitoringProjects(current, imported, () => 'new-id');
  assert.equal(result.updated, 1);
  assert.equal(result.added, 1);
  assert.equal(result.projects.length, 2);
  assert.equal(result.projects.find((item) => item.id === 'morning').query, 'New');
});
