const STATUS_LABELS = {
  ready: 'Підготовлено',
  running: 'Виконується',
  stopping: 'Зупиняється',
  stopped: 'Зупинено користувачем',
  completed: 'Завершено',
  interrupted: 'Перервано закриттям програми',
  pending: 'Не запущено',
  success: 'Успішно',
  partial: 'Частково',
  cancelled: 'Зупинено',
  error: 'Помилка',
};

function buildMonitoringProjectQueueWorkbook(queue = {}) {
  const items = (Array.isArray(queue.items) ? queue.items : []).slice(0, 200).map(normalizeItem).filter(Boolean);
  const totals = summarize(items);
  const header = (value) => ({
    value, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#112A46', alignVertical: 'center',
  });
  const accent = (value) => ({ value, fontWeight: 'bold', textColor: '#F5632C' });
  return [{
    sheet: 'Підсумок черги',
    columns: [34, 21, 18, 42, 25, 25, 18].map((width) => ({ width })),
    data: [
      [header('Показник'), header('Значення')],
      ['Стан черги', STATUS_LABELS[queue.status] || 'Завершено'],
      ['Створено (UTC)', safeIso(queue.createdAt)],
      ['Почато (UTC)', safeIso(queue.startedAt)],
      ['Завершено (UTC)', safeIso(queue.completedAt)],
      ['Усього проєктів', accent(items.length)],
      ['Успішно або частково', totals.completed],
      ['Помилок', totals.failed],
      ['Зупинено', totals.cancelled],
      ['Не запущено', totals.pending],
      ['Товарних рядків', accent(totals.productCount)],
      ['Окремих Excel', totals.reportCount],
      [],
      ['Проєкт', 'Результат', 'Товарних рядків', 'Окремий Excel', 'Почато (UTC)', 'Завершено (UTC)', 'Тривалість'].map(header),
      ...items.map((item) => [
        item.name,
        STATUS_LABELS[item.status] || item.status,
        item.productCount,
        item.reportFileName,
        item.startedAt,
        item.completedAt,
        formatDuration(item.startedAt, item.completedAt),
      ]),
    ],
    stickyRowsCount: 1,
  }];
}

function normalizeItem(item) {
  const projectId = clean(item?.projectId, 100);
  if (!projectId) return null;
  return {
    projectId,
    name: clean(item?.name, 80) || 'Проєкт без назви',
    status: Object.hasOwn(STATUS_LABELS, item?.status) ? item.status : 'error',
    productCount: Math.max(0, Math.floor(Number(item?.productCount) || 0)),
    reportFileName: safeFileName(item?.reportFileName),
    startedAt: safeIso(item?.startedAt),
    completedAt: safeIso(item?.completedAt),
  };
}

function summarize(items) {
  return items.reduce((result, item) => {
    if (['success', 'partial'].includes(item.status)) result.completed += 1;
    else if (item.status === 'error') result.failed += 1;
    else if (item.status === 'cancelled') result.cancelled += 1;
    else if (['pending', 'running'].includes(item.status)) result.pending += 1;
    result.productCount += item.productCount;
    if (item.reportFileName) result.reportCount += 1;
    return result;
  }, { completed: 0, failed: 0, cancelled: 0, pending: 0, productCount: 0, reportCount: 0 });
}

function formatDuration(startedAt, completedAt) {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const seconds = Math.round((end - start) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours) return `${hours} год ${minutes} хв`;
  if (minutes) return `${minutes} хв ${rest} с`;
  return `${rest} с`;
}

function safeIso(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function safeFileName(value) {
  const name = clean(value, 240);
  return !name || name.includes('..') || /[\\/:*?"<>|]/.test(name) ? '' : name;
}

function clean(value, limit) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

module.exports = { buildMonitoringProjectQueueWorkbook, formatDuration };
