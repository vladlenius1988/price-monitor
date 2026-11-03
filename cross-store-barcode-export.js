const { normalizeBarcode } = require('./cross-store-barcode');
const { productDiscount, sortableProductPrice } = require('./result-view');

const STORE_IDS = new Set(['eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka']);

function buildCrossStoreBarcodeWorkbook({ barcode, reference, products, reports, capturedAt } = {}) {
  const normalizedBarcode = normalizeBarcode(barcode);
  if (!normalizedBarcode || !reference || !Array.isArray(products) || !products.length || products.length > 200) {
    throw new Error('Немає дійсних результатів пошуку за штрихкодом для експорту.');
  }
  if (products.some((product) => !STORE_IDS.has(String(product?.store || '')) || !product?.name)) {
    throw new Error('Результати містять невідомий магазин або товар без назви.');
  }
  const header = (value) => ({
    value, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#2F6F4E', alignVertical: 'center',
  });
  const number = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? null : { value: Number(value), type: Number, format: '#,##0.00' };
  const percentage = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? null : { value: Number(value), type: Number, format: '0.00' };
  const rows = products.map((product) => {
    const discount = productDiscount(product);
    return [
      product.storeLabel || product.store,
      product.matchLabel || (product.matchType === 'exact_barcode' ? 'Точно: штрихкод підтверджено' : 'Неточно: знайдено за назвою'),
      percentage(Math.round((Number(product.matchScore) || 0) * 10_000) / 100),
      product.name || '', product.brand || '', String(product.barcode || ''),
      product.variant || '', product.seller || '',
      number(sortableProductPrice(product)), number(product.priceWithDiscount), number(product.priceWithoutDiscount),
      number(discount?.amount), percentage(discount?.percent), number(product.promoPrice),
      product.promotionCondition || product.promoCode || '', product.url || '',
    ];
  });
  const safeReports = (Array.isArray(reports) ? reports : []).filter((item) => STORE_IDS.has(String(item?.store || '')));
  return [
    {
      sheet: 'Порівняння цін', stickyRowsCount: 1,
      columns: [17, 34, 16, 72, 27, 19, 34, 28, 20, 20, 20, 17, 14, 22, 48, 60].map((width) => ({ width })),
      data: [[
        'Магазин', 'Точність збігу', 'Оцінка збігу, %', 'Назва товару', 'Торгова марка',
        'Підтверджений штрихкод', 'Варіант / відтінок / об’єм', 'Продавець', 'Поточна ціна, грн',
        'Ціна зі знижкою, грн', 'Ціна без знижки, грн', 'Економія, грн', 'Знижка, %',
        'Ціна за промокодом, грн', 'Промокод / умова', 'Посилання',
      ].map(header), ...rows],
    },
    {
      sheet: 'Джерела і точність', stickyRowsCount: 8,
      columns: [28, 90, 20, 26].map((width) => ({ width })),
      data: [
        [header('Параметр'), header('Значення'), null, null],
        ['Введений штрихкод', normalizedBarcode],
        ['Точне джерело', 'MAKEUP: штрихкод перевірено у картці конкретного доступного варіанта.'],
        ['Еталонний товар', `${reference.brand || ''} ${reference.name || ''} ${reference.variant || ''}`.replace(/\s+/g, ' ').trim()],
        ['Час перевірки (UTC)', capturedAt || new Date().toISOString()],
        ['Важливо', 'Рядки з позначкою «Ймовірно» або «Неточно» знайдені за назвою. Їхній штрихкод магазином не підтверджено.'],
        ['Залишки', 'У файл потрапляють лише доступні пропозиції на момент перевірки.'],
        [header('Магазин'), header('Результат перевірки'), header('Знайдено рядків'), header('Пошуковий запит')],
        ...safeReports.map((report) => [
          report.storeLabel || report.store,
          report.statusLabel || report.status || '',
          Math.max(0, Number(report.matchCount) || 0),
          report.query || '',
        ]),
      ],
    },
  ];
}

module.exports = { buildCrossStoreBarcodeWorkbook };
