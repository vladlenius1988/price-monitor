const { productDiscount, sortableProductPrice } = require('./result-view');
const { STORE_LABELS, STORE_ORDER } = require('./multi-store-search');

const STORE_IDS = new Set(STORE_ORDER);

function buildMultiStoreLiveWorkbook({ query, products, reports, capturedAt, mode = 'fast', limited = false } = {}) {
  const safeProducts = Array.isArray(products) ? products : [];
  if (!safeProducts.length || safeProducts.length > 50_000) {
    throw new Error('Немає дійсних результатів багатомагазинного пошуку для експорту.');
  }
  if (safeProducts.some((product) => !STORE_IDS.has(String(product?.store || '')) || !product?.name)) {
    throw new Error('Результати містять невідомий магазин або товар без назви.');
  }
  const header = (value) => ({
    value, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#2F6F4E', alignVertical: 'center',
  });
  const number = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? null : { value: Number(value), type: Number, format: '#,##0.00' };
  const percentage = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? null : { value: Number(value), type: Number, format: '0.00' };
  const hasBarcode = safeProducts.some((product) => product.barcode);
  const rows = safeProducts.map((product) => {
    const discount = productDiscount(product);
    const row = [
      product.storeLabel || STORE_LABELS[product.store] || product.store,
      product.name || '', product.brand || '',
    ];
    if (hasBarcode) row.push(String(product.barcode || ''));
    row.push(
      product.variant || '', product.seller || '',
      number(sortableProductPrice(product)), number(product.priceWithDiscount), number(product.priceWithoutDiscount),
      number(discount?.amount), percentage(discount?.percent), number(product.promoPrice),
      product.promotionCondition || product.promoCode || '', product.url || '',
    );
    return row;
  });
  const headings = ['Магазин', 'Назва товару', 'Торгова марка'];
  const widths = [17, 72, 28];
  if (hasBarcode) { headings.push('Штрихкод'); widths.push(19); }
  headings.push(
    'Варіант / відтінок / об’єм', 'Продавець', 'Поточна ціна, грн', 'Ціна зі знижкою, грн',
    'Ціна без знижки, грн', 'Економія, грн', 'Знижка, %', 'Ціна за промокодом, грн',
    'Промокод / умова', 'Посилання',
  );
  widths.push(34, 28, 20, 20, 20, 17, 14, 22, 48, 60);
  const safeReports = (Array.isArray(reports) ? reports : []).filter((report) => STORE_IDS.has(String(report?.store || '')));
  return [
    {
      sheet: 'Моніторинг цін', stickyRowsCount: 1,
      columns: widths.map((width) => ({ width })),
      data: [headings.map(header), ...rows],
    },
    {
      sheet: 'Джерела і стан', stickyRowsCount: 7,
      columns: [{ width: 28 }, { width: 90 }, { width: 22 }, { width: 22 }],
      data: [
        [header('Параметр'), header('Значення'), null, null],
        ['Запит', String(query || '').trim()],
        ['Час перевірки (UTC)', capturedAt || new Date().toISOString()],
        ['Режим', mode === 'detailed' ? 'Детальний' : 'Швидкий'],
        ['Ліміт результату', limited ? 'Так — результат скорочено лімітом редакції' : 'Ні'],
        ['Повнота', safeReports.some((report) => ['error', 'partial'].includes(report.status))
          ? 'Частковий результат — дивіться стан магазинів нижче' : 'Усі вибрані магазини завершили перевірку'],
        [header('Магазин'), header('Стан'), header('Товарів'), header('Помилок марок')],
        ...safeReports.map((report) => [
          report.storeLabel || STORE_LABELS[report.store] || report.store,
          report.statusLabel || report.status || '',
          Math.max(0, Number(report.productCount) || 0),
          Math.max(0, Number(report.failureCount) || 0),
        ]),
      ],
    },
  ];
}

module.exports = { buildMultiStoreLiveWorkbook };
