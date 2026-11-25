const test = require('node:test');
const assert = require('node:assert/strict');
const writeExcelFileModule = require('write-excel-file/node');
const writeExcelFile = writeExcelFileModule.default || writeExcelFileModule;
const { buildMonitoringProjectQueueWorkbook, formatDuration } = require('./monitoring-project-queue-export');

test('builds a readable queue summary workbook without exposing project queries', async () => {
  const queue = {
    status: 'completed',
    createdAt: '2026-11-25T08:00:00Z',
    startedAt: '2026-11-25T08:01:00Z',
    completedAt: '2026-11-25T08:11:00Z',
    items: [
      {
        projectId: 'one', name: 'Догляд', status: 'success', productCount: 120,
        reportFileName: 'care.xlsx', startedAt: '2026-11-25T08:01:00Z', completedAt: '2026-11-25T08:04:00Z',
        query: 'must-not-be-exported',
      },
      { projectId: 'two', name: 'Макіяж', status: 'error', productCount: 0 },
    ],
  };
  const sheets = buildMonitoringProjectQueueWorkbook(queue);
  const buffer = await writeExcelFile(sheets).toBuffer();
  assert.ok(buffer.length > 1000);
  assert.equal(sheets[0].sheet, 'Підсумок черги');
  assert.match(JSON.stringify(sheets), /Догляд/);
  assert.doesNotMatch(JSON.stringify(sheets), /must-not-be-exported/);
  assert.equal(formatDuration('2026-11-25T08:01:00Z', '2026-11-25T08:04:05Z'), '3 хв 5 с');
});

test('rejects unsafe report file names in the summary', () => {
  const sheets = buildMonitoringProjectQueueWorkbook({
    items: [{ projectId: 'one', name: 'Проєкт', status: 'success', reportFileName: '..\\secret.xlsx' }],
  });
  assert.doesNotMatch(JSON.stringify(sheets), /secret\.xlsx/);
});
