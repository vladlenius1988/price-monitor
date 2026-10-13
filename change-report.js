const { canCompareArchives, compareArchivedChecks } = require('./archive-tools');
const { currentProductPrice } = require('./comparison');

const STORE_IDS = ['eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka'];
const STATUS_LABELS = {
  new: 'Новий у видачі',
  cheaper: 'Подешевшав',
  expensive: 'Подорожчав',
  missing: 'Зник із видачі',
};

function buildCrossStoreChangeReport(archives, stores, requestedPeriod = {}) {
  const source = Array.isArray(archives) ? archives : [];
  const period = normalizeReportPeriod(requestedPeriod);
  const storeReports = [];
  const rows = [];
  for (const store of STORE_IDS) {
    const allRecords = source.filter((record) => record?.store === store)
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
    const records = period.active
      ? allRecords.filter((record) => isInsidePeriod(record?.capturedAt, period))
      : allRecords;
    let pair = null;
    for (const current of records) {
      const compatible = records.filter((candidate) => canCompareArchives(candidate, current));
      const previous = period.active ? compatible.at(-1) : compatible[0];
      if (previous) { pair = { previous, current }; break; }
    }
    const label = stores?.[store]?.label || store;
    if (!pair) {
      storeReports.push({
        store, label, checkCount: records.length, totalCheckCount: allRecords.length, comparable: false,
        reason: records.length
          ? `Немає двох сумісних повних нескорочених перевірок${period.active ? ' у вибраному періоді' : ''}.`
          : period.active && allRecords.length
            ? 'У вибраному періоді немає архівних перевірок.'
            : 'Ще немає архівних перевірок.',
      });
      continue;
    }
    const { previous, current } = pair;
    const result = compareArchivedChecks(previous, current);
    const summary = result.summary;
    storeReports.push({
      store, label, checkCount: records.length, totalCheckCount: allRecords.length, comparable: true,
      previousId: previous.id, currentId: current.id,
      previousCapturedAt: previous.capturedAt, currentCapturedAt: current.capturedAt,
      previousQuery: previous.query, currentQuery: current.query,
      summary, currentCount: current.products.length,
    });
    for (const product of result.products) {
      if (!STATUS_LABELS[product.comparisonStatus]) continue;
      rows.push({
        store, storeLabel: label,
        previousCapturedAt: previous.capturedAt, currentCapturedAt: current.capturedAt,
        query: current.query,
        name: product.name || '', brand: product.brand || '',
        barcode: String(product.barcode || ''), variant: product.variant || '',
        seller: product.seller || '', url: product.url || '',
        status: product.comparisonStatus,
        previousPrice: numberOrNull(product.previousPrice),
        currentPrice: currentProductPrice(product),
        difference: numberOrNull(product.priceDifference),
      });
    }
    for (const product of result.missing) {
      rows.push({
        store, storeLabel: label,
        previousCapturedAt: previous.capturedAt, currentCapturedAt: current.capturedAt,
        query: current.query,
        name: product.name || '', brand: product.brand || '',
        barcode: String(product.barcode || ''), variant: product.variant || '',
        seller: product.seller || '', url: product.url || '',
        status: 'missing', previousPrice: numberOrNull(product.previousPrice),
        currentPrice: null, difference: null,
      });
    }
  }
  return { version: 2, period, storeReports, rows };
}

function buildChangeReportWorkbook(report) {
  if (!report || !Array.isArray(report.storeReports) || !report.storeReports.some((item) => item.comparable)
    || !Array.isArray(report.rows)) {
    throw new Error('Немає сумісних збережених перевірок для звіту.');
  }
  const header = (value) => ({ value, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#2F6F4E' });
  const money = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? null : { value: Number(value), type: Number, format: '#,##0.00' };
  const changed = report.rows.filter((row) => row.status !== 'missing');
  const missing = report.rows.filter((row) => row.status === 'missing');
  const headings = [
    'Магазин', 'Попередня перевірка (UTC)', 'Пізніша перевірка (UTC)', 'Запит',
    'Назва товару', 'Торгова марка', 'Штрихкод', 'Варіант / відтінок / об’єм',
    'Продавець', 'Статус', 'Попередня ціна, грн', 'Пізніша ціна, грн',
    'Зміна ціни, грн', 'Посилання',
  ];
  const rowData = (row) => [
    row.storeLabel, row.previousCapturedAt, row.currentCapturedAt, row.query,
    row.name, row.brand, String(row.barcode || ''), row.variant, row.seller,
    STATUS_LABELS[row.status] || row.status, money(row.previousPrice),
    money(row.currentPrice), money(row.difference), row.url,
  ];
  const columns = [18, 27, 27, 35, 72, 28, 19, 34, 28, 22, 20, 20, 19, 60].map((width) => ({ width }));
  return [
    { sheet: 'Зміни', stickyRowsCount: 1, columns, data: [headings.map(header), ...changed.map(rowData)] },
    { sheet: 'Зникли з видачі', stickyRowsCount: 1, columns, data: [headings.map(header), ...missing.map(rowData)] },
    {
      sheet: 'Підсумок і джерела', stickyRowsCount: 6,
      columns: [18, 27, 27, 36, 36, 19, 16, 16, 16, 16, 16, 16, 32].map((width) => ({ width })),
      data: [
        [header('Параметр'), header('Значення'), ...Array(11).fill(null)],
        ['Джерело', 'Локальний архів — не поточні ціни та залишки'],
        ['Період', report.period?.active ? `${report.period.from} — ${report.period.to} включно (UTC)` : 'Увесь локальний архів'],
        ['Сумісність', report.period?.active
          ? 'Для кожного магазину взято найранішу та найпізнішу сумісні повні нескорочені перевірки в межах вибраного періоду. Дати різних магазинів можуть відрізнятися.'
          : 'Для кожного магазину взято найновішу пару повних нескорочених перевірок однакового запиту й режимів. Дати різних магазинів можуть відрізнятися.'],
        ['Зниклі товари', '«Зник із видачі» не означає підтверджену відсутність на складі сьогодні.'],
        [
          'Магазин', 'Попередня перевірка (UTC)', 'Пізніша перевірка (UTC)',
          'Попередній запит', 'Пізніший запит', 'Сумісних перевірок', 'Нові',
          'Подешевшали', 'Подорожчали', 'Без змін', 'Зникли', 'У пізнішій видачі', 'Причина пропуску',
        ].map(header),
        ...report.storeReports.map((item) => [
          item.label, item.previousCapturedAt || '', item.currentCapturedAt || '',
          item.previousQuery || '', item.currentQuery || '', item.comparable ? 'Так' : 'Ні',
          item.comparable ? item.summary.new : null,
          item.comparable ? item.summary.cheaper : null,
          item.comparable ? item.summary.expensive : null,
          item.comparable ? item.summary.unchanged : null,
          item.comparable ? item.summary.missing : null,
          item.comparable ? item.currentCount : null,
          item.reason || '',
        ]),
      ],
    },
  ];
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeReportPeriod(period = {}) {
  const from = normalizeUtcDate(period?.from);
  const to = normalizeUtcDate(period?.to);
  if ((from && !to) || (!from && to)) throw new Error('Оберіть обидві дати періоду або очистьте їх.');
  if (from && from > to) throw new Error('Дата початку періоду не може бути пізнішою за дату завершення.');
  return { active: Boolean(from && to), from, to };
}

function normalizeUtcDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Дата періоду має формат РРРР-ММ-ДД.');
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error('У періоді вказано неіснуючу дату.');
  }
  return text;
}

function isInsidePeriod(capturedAt, period) {
  const time = Date.parse(capturedAt);
  if (!Number.isFinite(time)) return false;
  const date = new Date(time).toISOString().slice(0, 10);
  return date >= period.from && date <= period.to;
}

module.exports = {
  buildCrossStoreChangeReport,
  buildChangeReportWorkbook,
  normalizeReportPeriod,
  STATUS_LABELS,
};
