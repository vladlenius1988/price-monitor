const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMonitoringProjectQueue,
  failedQueueProjectIds,
  finishMonitoringProjectQueue,
  finishQueueItem,
  markQueueItemRunning,
  queueSummary,
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
