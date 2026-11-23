const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const writeExcelFileModule = require('write-excel-file/node');
const readExcelFileModule = require('read-excel-file/node');
const { parseDelimitedText, parseMonitoringProjectRows, spreadsheetRows } = require('./monitoring-project-import');
const writeExcelFile = writeExcelFileModule.default || writeExcelFileModule;
const readExcelFile = readExcelFileModule.default || readExcelFileModule;

test('imports Ukrainian project rows with store aliases and schedule', () => {
  const result = parseMonitoringProjectRows([
    ['Назва проєкту', 'Торгові марки', 'Магазини', 'Режим', 'Запуск', 'Час'],
    ['Догляд', 'Nivea, Dove', 'Єва; MAKEUP; Нотіно', 'Детально', 'Щодня', '08:30'],
  ]);
  assert.equal(result.validRows, 1);
  assert.equal(result.invalidRows, 0);
  assert.deepEqual(result.projects[0], {
    id: 'import-2', name: 'Догляд', query: 'Nivea, Dove', stores: ['eva', 'makeup', 'notino'],
    mode: 'detailed', schedule: { kind: 'daily', time: '08:30' },
  });
});

test('reports invalid and duplicate rows without discarding valid projects', () => {
  const result = parseMonitoringProjectRows([
    ['Project', 'Brands', 'Stores'],
    ['Morning', 'Lamel', 'EVA, Rozetka'],
    ['Morning', 'Dove', 'EVA, MAKEUP'],
    ['Broken', '', 'EVA'],
  ]);
  assert.equal(result.validRows, 1);
  assert.equal(result.invalidRows, 2);
  assert.match(result.errors[0].message, /повторюється/);
  assert.match(result.errors[1].message, /торгові марки/);
});

test('parses semicolon CSV exported by Excel including quoted delimiters', () => {
  const rows = parseDelimitedText('Назва проєкту;Торгові марки;Магазини\r\n"Ранок; Київ";"Nivea, Dove";"EVA, MAKEUP"');
  assert.deepEqual(rows, [
    ['Назва проєкту', 'Торгові марки', 'Магазини'],
    ['Ранок; Київ', 'Nivea, Dove', 'EVA, MAKEUP'],
  ]);
  assert.equal(parseMonitoringProjectRows(rows).validRows, 1);
});

test('round-trips a real XLSX file through the packaged reader', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-project-import-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'projects.xlsx');
  const buffer = await writeExcelFile([
    ['Назва проєкту', 'Торгові марки', 'Магазини', 'Режим', 'Запуск', 'Час'].map((value) => ({ value })),
    ['Щоденний', 'Lamel, Nivea', 'EVA, MAKEUP', 'Детально', 'Щодня', '07:45'].map((value) => ({ value })),
  ]).toBuffer();
  fs.writeFileSync(filePath, buffer);
  const rows = spreadsheetRows(await readExcelFile(filePath));
  const result = parseMonitoringProjectRows(rows);
  assert.equal(result.validRows, 1);
  assert.equal(result.projects[0].schedule.time, '07:45');
});
