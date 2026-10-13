function buildPriceHistoryWorkbook({ storeLabel, product, points }) {
  if (!Array.isArray(points) || !points.length) {
    throw new Error('Немає збережених цін для експорту.');
  }
  const header = (value) => ({ value, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#2F6F4E' });
  const money = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? null : { value: Number(value), type: Number, format: '#,##0.00' };
  const ordered = [...points].sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
  const prices = ordered.map((point) => point.price);
  return [
    {
      sheet: 'Історія ціни',
      stickyRowsCount: 1,
      columns: [24, 20, 20, 24, 36, 42, 48, 40].map((width) => ({ width })),
      data: [
        ['Час перевірки (UTC)', 'Поточна ціна, грн', 'Звичайна ціна, грн', 'Зміна до попередньої, грн', 'Ціна за промокодом, грн', 'Умова / промокод', 'Запит', 'Ідентифікатор перевірки'].map(header),
        ...ordered.map((point, index) => [
          point.capturedAt,
          money(point.price),
          money(point.regularPrice),
          index ? money(Math.round((point.price - ordered[index - 1].price) * 100) / 100) : null,
          money(point.promoPrice),
          point.promotionCondition || point.promoCode || '',
          point.query || '',
          point.archiveId,
        ]),
      ],
    },
    {
      sheet: 'Товар і параметри',
      stickyRowsCount: 1,
      columns: [{ width: 35 }, { width: 95 }],
      data: [
        [header('Параметр'), header('Значення')],
        ['Магазин', storeLabel],
        ['Назва товару', product.name || ''],
        ['Торгова марка', product.brand || ''],
        ['Штрихкод', String(product.barcode || '')],
        ['Варіант / відтінок / об’єм', product.variant || ''],
        ['Продавець', product.seller || ''],
        ['Посилання', product.url || ''],
        ['Збережених перевірок', ordered.length],
        ['Перша перевірка (UTC)', ordered[0].capturedAt],
        ['Остання перевірка (UTC)', ordered.at(-1).capturedAt],
        ['Мінімальна поточна ціна, грн', money(Math.min(...prices))],
        ['Максимальна поточна ціна, грн', money(Math.max(...prices))],
        ['Зміна від першої до останньої, грн', money(Math.round((prices.at(-1) - prices[0]) * 100) / 100)],
        ['Джерело', 'Локальний архів — не поточні ціни та залишки'],
        ['Час', 'UTC. Час у програмі показано у часовому поясі комп’ютера.'],
        ['Обмеження', 'Історія накопичується з 4.10.0 та обмежена збереженим архівом. Відсутність товару в іншому запиті не є нульовою ціною або відсутністю залишку.'],
        ['Промокодні ціни', 'Умовні ціни наведено окремо, вони не підміняють поточну ціну та зміну ціни.'],
      ],
    },
  ];
}

module.exports = { buildPriceHistoryWorkbook };
