const STORE_LABELS = {
  eva: 'EVA',
  varus: 'VARUS',
  makeup: 'MAKEUP',
  aurora: 'Аврора',
  notino: 'Notino',
  rozetka: 'Rozetka',
};

function buildPilotStatisticsWorkbook(summary = {}) {
  const totals = summary.totals || {};
  const header = (value) => ({
    value, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#112A46', alignVertical: 'center',
  });
  const accent = (value) => ({ value, fontWeight: 'bold', textColor: '#F5632C' });
  const duration = (value) => formatDuration(value);
  const periodLabel = summary.period?.days ? `Останні ${summary.period.days} днів` : 'Увесь період';
  const byStore = Array.isArray(summary.byStore) ? summary.byStore : [];
  const byBrand = Array.isArray(summary.byBrand) ? summary.byBrand : [];
  const recent = Array.isArray(summary.recent) ? summary.recent : [];

  return [
    {
      sheet: 'Цінність роботи',
      columns: [{ width: 38 }, { width: 72 }],
      data: [
        [header('Показник'), header('Значення')],
        ['Період', periodLabel],
        ['Сформовано (UTC)', summary.generatedAt || new Date().toISOString()],
        ['Пошуків', accent(number(totals.searches))],
        ['Успішність', accent(`${number(totals.successRate)}%`)],
        ['Унікальних торгових марок', number(totals.uniqueBrands)],
        ['Підготовлено товарних рядків', accent(number(totals.productCount))],
        ['Час роботи Price Monitor', duration(totals.durationMs)],
        ['Середній час одного пошуку', duration(totals.averageDurationMs)],
        ['Оцінка ручної роботи', accent(duration(totals.estimatedManualMs))],
        ['Орієнтовно зекономлено', accent(duration(totals.estimatedSavedMs))],
        ['Орієнтовно зекономлено, %', `${number(totals.estimatedSavedPercent)}%`],
        ['Excel-вивантажень', accent(number(totals.excelExports))],
        ['Рядків вивантажено в Excel', number(totals.exportedRows)],
        ['Часткових пошуків', number(totals.partialSearches)],
        ['Зупинених користувачем', number(totals.cancelledSearches)],
        ['Невдалих пошуків', number(totals.failedSearches)],
        ['Приватність', summary.privacy?.noteUa || 'Марки зберігаються лише локально.'],
        ['Метод оцінки', summary.estimate?.noteUa || '15 секунд ручної роботи на товарний рядок мінус фактичний час програми.'],
        ['Важливо', 'Оцінка економії часу є орієнтиром. Для пілоту її слід порівнювати з тим самим обсягом реального ручного процесу.'],
      ],
      stickyRowsCount: 1,
    },
    {
      sheet: 'За магазинами',
      columns: [24, 16, 16, 18, 20, 20, 18].map((width) => ({ width })),
      data: [
        ['Магазин', 'Пошуків', 'Успішних', 'Товарних рядків', 'Час роботи', 'Excel-вивантажень', 'Рядків у Excel'].map(header),
        ...byStore.map((row) => [
          STORE_LABELS[row.store] || row.store,
          number(row.searches),
          number(row.successfulSearches),
          number(row.productCount),
          duration(row.durationMs),
          number(row.excelExports),
          number(row.exportedRows),
        ]),
      ],
      stickyRowsCount: 1,
    },
    {
      sheet: 'За торговими марками',
      columns: [{ width: 46 }, { width: 17 }, { width: 17 }, { width: 22 }, { width: 36 }, { width: 25 }],
      data: [
        ['Торгова марка', 'Пошуків', 'Успішних', 'Товарних рядків', 'Магазини', 'Останній пошук (UTC)'].map(header),
        ...byBrand.map((row) => [
          row.brand || '', number(row.searches), number(row.successfulSearches), number(row.productCount),
          (row.stores || []).map((store) => STORE_LABELS[store] || store).join(', '), row.lastSearchAt || '',
        ]),
      ],
      stickyRowsCount: 1,
    },
    {
      sheet: 'Останні пошуки',
      columns: [{ width: 25 }, { width: 38 }, { width: 42 }, { width: 18 }, { width: 18 }, { width: 18 }],
      data: [
        ['Час (UTC)', 'Магазин', 'Марки', 'Результат', 'Товарних рядків', 'Тривалість'].map(header),
        ...recent.map((row) => [
          row.at || '',
          (row.stores || []).map((store) => STORE_LABELS[store] || store).join(', '),
          (row.brands || []).join(', '),
          outcomeLabel(row.outcome),
          number(row.productCount),
          duration(row.durationMs),
        ]),
      ],
      stickyRowsCount: 1,
    },
  ];
}

function formatDuration(value) {
  const totalSeconds = Math.max(0, Math.round((Number(value) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours} год ${minutes} хв`;
  if (minutes) return `${minutes} хв ${seconds} с`;
  return `${seconds} с`;
}

function outcomeLabel(value) {
  return {
    success: 'Успішно', partial: 'Частково', cancelled: 'Зупинено', error: 'Помилка',
  }[value] || value || '';
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

module.exports = { buildPilotStatisticsWorkbook, formatDuration };
