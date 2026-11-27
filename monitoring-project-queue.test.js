const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMonitoringProjectQueue,
  attachQueueSummaryReport,
  failedQueueProjectIds,
  filterMonitoringProjectsForQueue,
  finishMonitoringProjectQueue,
  finishQueueItem,
  markQueueItemRunning,
  pendingQueueProjectIds,
  queueSummary,
  recoverMonitoringProjectQueue,
  requestMonitoringProjectQueueStop,
  startMonitoringProjectQueue,
} = require('./monitoring-project-queue');

const projects = [
  { id: 'morning', name: 'Ранковий моніторинг' },
  { id: 'evening', name: 'Вечірній моніторинг' },
  { id: 'weekly', name: 'Щотижневий моніторинг' },
];

test('queue keeps project order and ignores unknown or duplicate selections', () => {
  const queue = createMonitoringProjectQueue(projects, ['weekly', 'morning', 'missing', 'morning'], new Date('2026-11-24T08:00:00Z'));
  assert.deepEqual(queue.items.map((item) => item.projectId), ['morning', 'weekly']);
  assert.equal(queue.status, 'ready');
  assert.equal(queueSummary(queue).total, 2);
});

test('queue records completed reports and leaves only real errors for retry', () => {
  let queue = createMonitoringProjectQueue(projects, projects.map((project) => project.id));
  queue = startMonitoringProjectQueue(queue, new Date('2026-11-24T08:00:00Z'));
  queue = markQueueItemRunning(queue, 'morning', new Date('2026-11-24T08:01:00Z'));
  queue = finishQueueItem(queue, 'morning', { outcome: 'success', productCount: 120, reportFileName: 'morning.xlsx' });
  queue = finishQueueItem(queue, 'evening', { outcome: 'partial', productCount: 50, reportFileName: 'evening.xlsx' });
  queue = finishQueueItem(queue, 'weekly', { outcome: 'error', productCount: 0 });
  const summary = queueSummary(queue);
  assert.equal(summary.completed, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.productCount, 170);
  assert.equal(summary.reportCount, 2);
  assert.deepEqual(failedQueueProjectIds(queue), ['weekly']);
});

test('safe stop preserves finished items and does not turn pending items into errors', () => {
  let queue = createMonitoringProjectQueue(projects, ['morning', 'evening']);
  queue = startMonitoringProjectQueue(queue);
  queue = finishQueueItem(queue, 'morning', { outcome: 'success', productCount: 20, reportFileName: 'morning.xlsx' });
  queue = markQueueItemRunning(queue, 'evening');
  queue = requestMonitoringProjectQueueStop(queue);
  queue = finishMonitoringProjectQueue(queue);
  assert.equal(queue.status, 'stopped');
  assert.equal(queue.items[0].status, 'success');
  assert.equal(queue.items[1].status, 'cancelled');
  assert.equal(queueSummary(queue).productCount, 20);
  assert.deepEqual(failedQueueProjectIds(queue), []);
});

test('unsafe report file names are not retained', () => {
  let queue = createMonitoringProjectQueue(projects, ['morning']);
  queue = finishQueueItem(queue, 'morning', { outcome: 'success', productCount: 1, reportFileName: '..\\secret.xlsx' });
  assert.equal(queue.items[0].reportFileName, '');
});

test('interrupted process keeps completed work and makes only the active item resumable', () => {
  let queue = createMonitoringProjectQueue(projects, ['morning', 'evening', 'weekly']);
  queue = startMonitoringProjectQueue(queue);
  queue = finishQueueItem(queue, 'morning', { outcome: 'success', productCount: 25, reportFileName: 'morning.xlsx' });
  queue = markQueueItemRunning(queue, 'evening');
  const recovered = recoverMonitoringProjectQueue(queue);
  assert.equal(recovered.status, 'interrupted');
  assert.equal(recovered.items[0].status, 'success');
  assert.equal(recovered.items[1].status, 'pending');
  assert.deepEqual(pendingQueueProjectIds(recovered), ['evening', 'weekly']);
  assert.equal(queueSummary(recovered).productCount, 25);
});

test('queue summary report file is stored safely', () => {
  const queue = createMonitoringProjectQueue(projects, ['morning']);
  assert.equal(attachQueueSummaryReport(queue, 'queue-summary.xlsx').summaryFileName, 'queue-summary.xlsx');
  assert.equal(attachQueueSummaryReport(queue, '..\\secret.xlsx').summaryFileName, '');
});

test('filters projects by local name, brand query, store and last outcome', () => {
  const source = [
    { id: 'one', name: 'Щоденний догляд', query: 'Estée Lauder', stores: ['eva', 'notino'], lastOutcome: 'success' },
    { id: 'two', name: 'Макіяж', query: 'Lamel', stores: ['makeup', 'eva'], lastOutcome: 'error' },
    { id: 'three', name: 'Новий проєкт', query: 'Nivea', stores: ['varus', 'eva'], lastOutcome: '' },
  ];
  assert.deepEqual(filterMonitoringProjectsForQueue(source, { search: 'estee' }).map((item) => item.id), ['one']);
  assert.deepEqual(filterMonitoringProjectsForQueue(source, { store: 'makeup' }).map((item) => item.id), ['two']);
  assert.deepEqual(filterMonitoringProjectsForQueue(source, { outcome: 'error' }).map((item) => item.id), ['two']);
  assert.deepEqual(filterMonitoringProjectsForQueue(source, { outcome: 'never' }).map((item) => item.id), ['three']);
});
