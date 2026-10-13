(function exposeResultViewUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.priceMonitorResultView = api;
}(typeof window !== 'undefined' ? window : null, () => {
  function filterAndSortProducts(
    products,
    query,
    sorting = 'original',
    changeFilter = 'all',
    saleFilter = 'all',
    minPrice = '',
    maxPrice = '',
  ) {
    const source = Array.isArray(products) ? products : [];
    const normalizedQuery = normalizeResultText(query);
    let filtered = normalizedQuery
      ? source.filter((product) => searchableProductText(product).includes(normalizedQuery))
      : [...source];
    if (['new', 'cheaper', 'expensive', 'unchanged'].includes(changeFilter)) {
      filtered = filtered.filter((product) => product?.comparisonStatus === changeFilter);
    }
    if (saleFilter === 'discounted') {
      filtered = filtered.filter((product) => Boolean(productDiscount(product)));
    } else if (saleFilter === 'regular') {
      filtered = filtered.filter((product) => !productDiscount(product));
    }

    const minimum = numericFilterValue(minPrice);
    const maximum = numericFilterValue(maxPrice);
    if (minimum !== null || maximum !== null) {
      filtered = filtered.filter((product) => {
        const price = sortableProductPrice(product);
        return price !== null
          && (minimum === null || price >= minimum)
          && (maximum === null || price <= maximum);
      });
    }

    if (sorting === 'name-asc' || sorting === 'brand-asc') {
      const property = sorting === 'name-asc' ? 'name' : 'brand';
      filtered.sort((left, right) => String(left?.[property] || '').localeCompare(
        String(right?.[property] || ''), 'uk', { sensitivity: 'base', numeric: true },
      ));
    } else if (sorting === 'price-asc' || sorting === 'price-desc') {
      const direction = sorting === 'price-asc' ? 1 : -1;
      filtered.sort((left, right) => compareProductPrices(left, right, direction));
    } else if (sorting === 'discount-desc' || sorting === 'discount-asc') {
      const direction = sorting === 'discount-asc' ? 1 : -1;
      filtered.sort((left, right) => compareProductDiscounts(left, right, direction));
    }
    return filtered;
  }

  function searchableProductText(product) {
    return normalizeResultText([
      product?.name,
      product?.brand,
      product?.barcode,
      product?.variant,
      product?.seller,
      product?.promotionCondition,
      product?.promoCode,
    ].join(' '));
  }

  function normalizeResultText(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('uk');
  }

  function compareProductPrices(left, right, direction) {
    const leftPrice = sortableProductPrice(left);
    const rightPrice = sortableProductPrice(right);
    if (leftPrice === null && rightPrice === null) return 0;
    if (leftPrice === null) return 1;
    if (rightPrice === null) return -1;
    return (leftPrice - rightPrice) * direction;
  }

  function sortableProductPrice(product) {
    for (const value of [product?.priceWithDiscount, product?.priceWithoutDiscount]) {
      const price = Number(value);
      if (value !== '' && value !== null && value !== undefined && Number.isFinite(price)) return price;
    }
    return null;
  }

  function productDiscount(product) {
    const current = numericPrice(product?.priceWithDiscount);
    const regular = numericPrice(product?.priceWithoutDiscount);
    if (current === null || regular === null || regular <= current) return null;
    const amount = roundMoney(regular - current);
    const percent = Math.round((amount / regular) * 10_000) / 100;
    return { amount, percent };
  }

  function summarizeProducts(products) {
    const source = Array.isArray(products) ? products : [];
    const prices = source.map(sortableProductPrice).filter((value) => value !== null);
    const discounts = source.map(productDiscount).filter(Boolean);
    return {
      total: source.length,
      discountedCount: discounts.length,
      cheapestPrice: prices.length ? Math.min(...prices) : null,
      largestDiscountPercent: discounts.length
        ? Math.max(...discounts.map((discount) => discount.percent))
        : null,
    };
  }

  function productsToTsv(products, storeLabel = '') {
    const source = Array.isArray(products) ? products : [];
    const headings = [
      'Назва товару',
      'Торгова марка',
      'Штрихкод',
      'Варіант / відтінок / об’єм',
      'Продавець',
      'Ціна зі знижкою',
      'Ціна без знижки',
      'Економія',
      'Знижка, %',
      'Магазин',
      'Посилання',
    ];
    const rows = source.map((product) => {
      const discount = productDiscount(product);
      return [
        product?.name,
        product?.brand,
        product?.barcode,
        product?.variant,
        product?.seller,
        numericPrice(product?.priceWithDiscount),
        numericPrice(product?.priceWithoutDiscount),
        discount?.amount,
        discount?.percent,
        storeLabel,
        product?.url,
      ];
    });
    return [headings, ...rows].map((row) => row.map(tsvCell).join('\t')).join('\n');
  }

  function compareProductDiscounts(left, right, direction) {
    const leftDiscount = productDiscount(left)?.percent ?? null;
    const rightDiscount = productDiscount(right)?.percent ?? null;
    if (leftDiscount === null && rightDiscount === null) return 0;
    if (leftDiscount === null) return 1;
    if (rightDiscount === null) return -1;
    return (leftDiscount - rightDiscount) * direction;
  }

  function numericFilterValue(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(String(value).replace(',', '.'));
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function numericPrice(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function roundMoney(value) {
    return Math.round(value * 100) / 100;
  }

  function tsvCell(value) {
    if (value === null || value === undefined) return '';
    const text = String(value).replace(/[\t\r\n]+/g, ' ').trim();
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
  }

  return {
    filterAndSortProducts,
    normalizeResultText,
    productDiscount,
    productsToTsv,
    sortableProductPrice,
    summarizeProducts,
  };
}));
