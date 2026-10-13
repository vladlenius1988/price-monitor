const { currentProductPrice } = require('./comparison');
const { productDiscount } = require('./result-view');

const STORE_IDS = ['eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka'];

function buildCombinedArchiveWorkbook(records, stores) {
  if (!Array.isArray(records) || records.length < 2 || records.length > STORE_IDS.length) {
    throw new Error('Оберіть від двох до шести збережених перевірок із різних магазинів.');
  }
  const usedStores = new Set();
  for (const record of records) {
    if (!record || !STORE_IDS.includes(record.store) || usedStores.has(record.store)
      || !stores?.[record.store]?.label || !record.id || !record.query
      || !Number.isFinite(Date.parse(record.capturedAt))
      || !Array.isArray(record.products) || !record.products.length
      || record.products.length > 5_000) {
      throw new Error('Кожен магазин повинен мати одну дійсну перевірку з товарами.');
    }
    usedStores.add(record.store);
  }

  const header = (value) => ({
    value, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#2F6F4E', alignVertical: 'center',
  });
  const number = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? null : { value: Number(value), type: Number, format: '#,##0.00' };

  const productRows = records.flatMap((record) => record.products.map((product) => {
    const discount = productDiscount(product);
    return [
      stores[record.store].label,
      record.capturedAt,
      record.query,
      product.name || '',
      product.brand || '',
      String(product.barcode || ''),
      product.variant || '',
      product.seller || '',
      number(currentProductPrice(product)),
      number(product.priceWithDiscount),
      number(product.priceWithoutDiscount),
      number(discount?.amount),
      number(discount?.percent),
      number(product.promoPrice),
      product.promotionCondition || product.promoCode || '',
      product.url || '',
      record.truncated ? 'Так' : 'Ні',
      record.id,
    ];
  }));

  return [
    {
      sheet: 'Усі товари',
      stickyRowsCount: 1,
      columns: [18, 25, 35, 72, 28, 19, 34, 28, 20, 20, 20, 17, 14, 21, 48, 60, 19, 40]
        .map((width) => ({ width })),
      data: [
        [
          'Магазин', 'Час перевірки (UTC)', 'Запит', 'Назва товару', 'Торгова марка',
          'Штрихкод', 'Варіант / відтінок / об’єм', 'Продавець', 'Поточна ціна, грн',
          'Ціна зі знижкою, грн', 'Ціна без знижки, грн', 'Економія, грн', 'Знижка, %',
          'Ціна за промокодом, грн', 'Промокод / умова', 'Посилання',
          'Архів скорочено', 'Ідентифікатор перевірки',
        ].map(header),
        ...productRows,
      ],
    },
    {
      sheet: 'Джерела і межі',
      stickyRowsCount: 5,
      columns: [20, 27, 40, 40, 21, 20, 22, 18, 18, 18, 18].map((width) => ({ width })),
      data: [
        [header('Параметр'), header('Значення'), ...Array(9).fill(null)],
        ['Джерело', 'Локальний архів — не поточні ціни та залишки'],
        ['Час', 'UTC. У програмі дати показано за часовим поясом комп’ютера.'],
        ['Важливо', 'Перевірки різних магазинів могли проводитися в різний час. Наявність стосується тільки часу відповідної перевірки.'],
        [
          'Магазин', 'Час перевірки (UTC)', 'Запит', 'Ідентифікатор перевірки',
          'Рядків у файлі', 'Рядків у пошуку', 'Архів скорочено',
          'Варіанти', 'Продавці', 'Штрихкоди', 'Джерело',
        ].map(header),
        ...records.map((record) => [
          stores[record.store].label,
          record.capturedAt,
          record.query,
          record.id,
          record.products.length,
          Math.max(record.products.length, Number(record.sourceCount) || record.products.length),
          record.truncated ? 'Так — частина рядків не збережена' : 'Ні',
          record.options?.includeVariants ? 'Так' : 'Ні',
          record.options?.includeSellers ? 'Так' : 'Ні',
          record.options?.includeBarcodes ? 'Так' : 'Ні',
          'Архів',
        ]),
      ],
    },
  ];
}

function buildFilteredArchiveWorkbook(records, stores) {
  if (!Array.isArray(records) || !records.length || records.length > 60) {
    throw new Error('За поточними фільтрами немає перевірок для експорту.');
  }
  const usedIds = new Set();
  let totalProducts = 0;
  for (const record of records) {
    if (!record || !STORE_IDS.includes(record.store) || !stores?.[record.store]?.label
      || !record.id || usedIds.has(record.id) || !record.query
      || !Number.isFinite(Date.parse(record.capturedAt))
      || !Array.isArray(record.products) || !record.products.length
      || record.products.length > 5_000) {
      throw new Error('Архів містить недійсну або повторену перевірку. Відкрийте його знову.');
    }
    usedIds.add(record.id);
    totalProducts += record.products.length;
  }
  if (totalProducts > 100_000) {
    throw new Error('В експорті може бути не більше 100 000 збережених рядків.');
  }

  const header = (value) => ({
    value, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#2F6F4E', alignVertical: 'center',
  });
  const number = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? null : { value: Number(value), type: Number, format: '#,##0.00' };
  const productRows = records.flatMap((record) => record.products.map((product) => {
    const discount = productDiscount(product);
    return [
      stores[record.store].label, record.capturedAt, record.query,
      product.name || '', product.brand || '', String(product.barcode || ''),
      product.variant || '', product.seller || '', number(currentProductPrice(product)),
      number(product.priceWithDiscount), number(product.priceWithoutDiscount),
      number(discount?.amount), number(discount?.percent), number(product.promoPrice),
      product.promotionCondition || product.promoCode || '', product.url || '',
      record.truncated ? 'Так' : 'Ні', record.id,
    ];
  }));

  return [
    {
      sheet: 'Архівні товари', stickyRowsCount: 1,
      columns: [18, 25, 35, 72, 28, 19, 34, 28, 20, 20, 20, 17, 14, 21, 48, 60, 19, 40]
        .map((width) => ({ width })),
      data: [[
        'Магазин', 'Час перевірки (UTC)', 'Запит', 'Назва товару', 'Торгова марка',
        'Штрихкод', 'Варіант / відтінок / об’єм', 'Продавець', 'Поточна ціна, грн',
        'Ціна зі знижкою, грн', 'Ціна без знижки, грн', 'Економія, грн', 'Знижка, %',
        'Ціна за промокодом, грн', 'Промокод / умова', 'Посилання',
        'Архів скорочено', 'Ідентифікатор перевірки',
      ].map(header), ...productRows],
    },
    {
      sheet: 'Вибрані перевірки', stickyRowsCount: 6,
      columns: [20, 27, 40, 40, 21, 20, 22, 18, 18, 18, 18].map((width) => ({ width })),
      data: [
        [header('Параметр'), header('Значення'), ...Array(9).fill(null)],
        ['Джерело', 'Локальний архів — не поточні ціни та залишки'],
        ['Відбір', 'Експортовано всі перевірки, які були видимі після фільтрів архіву в момент збереження.'],
        ['Час', 'UTC. У програмі дати показано за часовим поясом комп’ютера.'],
        ['Важливо', 'Один товар може повторюватися в кількох перевірках. Наявність і ціна стосуються часу кожної окремої перевірки.'],
        [
          'Магазин', 'Час перевірки (UTC)', 'Запит', 'Ідентифікатор перевірки',
          'Рядків у файлі', 'Рядків у пошуку', 'Архів скорочено',
          'Варіанти', 'Продавці', 'Штрихкоди', 'Джерело',
        ].map(header),
        ...records.map((record) => [
          stores[record.store].label, record.capturedAt, record.query, record.id,
          record.products.length,
          Math.max(record.products.length, Number(record.sourceCount) || record.products.length),
          record.truncated ? 'Так — частина рядків не збережена' : 'Ні',
          record.options?.includeVariants ? 'Так' : 'Ні',
          record.options?.includeSellers ? 'Так' : 'Ні',
          record.options?.includeBarcodes ? 'Так' : 'Ні', 'Архів',
        ]),
      ],
    },
  ];
}

module.exports = { buildCombinedArchiveWorkbook, buildFilteredArchiveWorkbook };
