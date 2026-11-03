(function exposeCrossStoreBarcode(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.priceMonitorCrossStoreBarcode = api;
}(typeof window !== 'undefined' ? window : null, () => {
  const STORE_ORDER = Object.freeze(['makeup', 'eva', 'notino', 'rozetka', 'aurora', 'varus']);
  const STOP_WORDS = new Set([
    'для', 'та', 'і', 'або', 'з', 'зі', 'у', 'в', 'на', 'до', 'від', 'по', 'the', 'and', 'for',
    'шт', 'мл', 'ml', 'мг', 'mg', 'г', 'gr', 'кг', 'kg', 'см', 'cm', 'мм', 'mm', 'pcs', 'pc',
  ]);

  function normalizeBarcode(value) {
    const barcode = String(value ?? '').replace(/[\s-]+/g, '');
    if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(barcode)) return '';
    const data = barcode.slice(0, -1);
    let sum = 0;
    for (let index = data.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
      sum += Number(data[index]) * (position % 2 === 0 ? 3 : 1);
    }
    return (10 - (sum % 10)) % 10 === Number(barcode.at(-1)) ? barcode : '';
  }

  function buildProductSearchQuery(reference = {}) {
    const brand = cleanText(reference.brand);
    const name = cleanText(reference.name);
    const variant = cleanText(reference.variant);
    const values = [];
    if (brand && !normalizeText(name).includes(normalizeText(brand))) values.push(brand);
    if (name) values.push(name);
    if (variant && !normalizeText(name).includes(normalizeText(variant))) values.push(variant);
    return values.join(' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  function scoreProductMatch(reference = {}, candidate = {}) {
    const expectedBarcode = normalizeBarcode(reference.barcode);
    const actualBarcode = normalizeBarcode(candidate.barcode);
    if (expectedBarcode && actualBarcode === expectedBarcode) return 1;

    const referenceText = [reference.brand, reference.name, reference.variant].filter(Boolean).join(' ');
    const candidateText = [candidate.brand, candidate.name, candidate.variant].filter(Boolean).join(' ');
    const referenceTokens = tokenWeights(referenceText);
    const candidateTokens = tokenWeights(candidateText);
    if (!referenceTokens.size || !candidateTokens.size) return 0;

    let intersection = 0;
    let union = 0;
    const allTokens = new Set([...referenceTokens.keys(), ...candidateTokens.keys()]);
    for (const token of allTokens) {
      const left = referenceTokens.get(token) || 0;
      const right = candidateTokens.get(token) || 0;
      intersection += Math.min(left, right);
      union += Math.max(left, right);
    }
    const tokenScore = union ? intersection / union : 0;
    const referenceBrand = normalizeText(reference.brand);
    const candidateBrand = normalizeText(candidate.brand);
    const brandScore = !referenceBrand || !candidateBrand
      ? 0.35
      : referenceBrand === candidateBrand ? 1
        : referenceBrand.includes(candidateBrand) || candidateBrand.includes(referenceBrand) ? 0.8 : 0;
    const referenceName = normalizeText(reference.name);
    const candidateName = normalizeText(candidate.name);
    const containment = referenceName && candidateName
      && (referenceName.includes(candidateName) || candidateName.includes(referenceName)) ? 1 : 0;
    let score = tokenScore * 0.72 + brandScore * 0.2 + containment * 0.08;

    const expectedNumbers = numericTokens(referenceText);
    const candidateNumbers = numericTokens(candidateText);
    if (expectedNumbers.size && candidateNumbers.size
      && ![...expectedNumbers].some((value) => candidateNumbers.has(value))) score -= 0.18;
    if (referenceBrand && candidateBrand && brandScore === 0) score -= 0.2;
    return Math.max(0, Math.min(0.99, Math.round(score * 1000) / 1000));
  }

  function selectCandidateMatches(reference, products, { store = '', storeLabel = '', limit = 8, minimumScore = 0.4 } = {}) {
    const expectedBarcode = normalizeBarcode(reference?.barcode);
    return (Array.isArray(products) ? products : [])
      .filter((product) => product && product.available !== false)
      .map((product) => {
        const exact = Boolean(expectedBarcode && normalizeBarcode(product.barcode) === expectedBarcode);
        const score = exact ? 1 : scoreProductMatch(reference, product);
        return {
          ...product,
          barcode: exact ? expectedBarcode : '',
          store,
          storeLabel,
          referenceBarcode: expectedBarcode,
          matchType: exact ? 'exact_barcode' : 'probable_name',
          matchScore: score,
          matchLabel: exact
            ? 'Точно: штрихкод підтверджено'
            : score >= 0.68 ? 'Ймовірно: збіг за назвою' : 'Неточно: знайдено за назвою',
        };
      })
      .filter((product) => product.matchType === 'exact_barcode' || product.matchScore >= minimumScore)
      .sort((left, right) => right.matchScore - left.matchScore)
      .slice(0, Math.max(1, Math.min(20, Number(limit) || 8)));
  }

  function exactBarcodeMatches(reference, products, store = 'makeup', storeLabel = 'MAKEUP') {
    return selectCandidateMatches(reference, products, { store, storeLabel, minimumScore: 0.99, limit: 20 })
      .filter((product) => product.matchType === 'exact_barcode');
  }

  function tokenWeights(value) {
    const weights = new Map();
    for (const token of tokenize(value)) {
      const weight = /^\d+(?:[.,]\d+)?$/.test(token) ? 1.8 : token.length >= 7 ? 1.3 : 1;
      weights.set(token, Math.max(weights.get(token) || 0, weight));
    }
    return weights;
  }

  function tokenize(value) {
    return normalizeText(value).split(' ')
      .map(canonicalToken)
      .filter((token) => token && !STOP_WORDS.has(token) && (token.length > 1 || /^\d$/.test(token)));
  }

  function numericTokens(value) {
    return new Set(normalizeText(value).split(' ').map(canonicalToken).filter((token) => /^\d+(?:[.,]\d+)?$/.test(token)));
  }

  function canonicalToken(token) {
    if (/^\d+$/.test(token)) return String(Number.parseInt(token, 10));
    return token;
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLocaleLowerCase('uk-UA')
      .replace(/[’'`]/g, '')
      .replace(/[^\p{L}\p{N}.,]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanText(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  }

  return {
    STORE_ORDER,
    buildProductSearchQuery,
    exactBarcodeMatches,
    normalizeBarcode,
    normalizeText,
    scoreProductMatch,
    selectCandidateMatches,
  };
}));
