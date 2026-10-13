const fs = require('fs');
const path = require('path');

const STORES = Object.freeze({
  eva: {
    id: 'eva', label: 'EVA', host: 'eva.ua', filePrefix: 'eva',
    brandIndexUrl: 'https://eva.ua/ua/brands/',
    fallbackSearchUrl: 'https://eva.ua/ua/search/?q=',
  },
  varus: {
    id: 'varus', label: 'VARUS', host: 'varus.ua', filePrefix: 'varus',
    brandIndexUrl: 'https://varus.ua/ua/brands',
    fallbackSearchUrl: 'https://varus.ua/search?q=',
  },
  makeup: {
    id: 'makeup', label: 'MAKEUP', host: 'makeup.com.ua', filePrefix: 'makeup',
    brandIndexUrl: 'https://makeup.com.ua/ua/brand/',
    fallbackSearchUrl: 'https://makeup.com.ua/ua/search/?q=',
  },
  aurora: {
    id: 'aurora', label: 'Аврора', host: 'avrora.ua', filePrefix: 'avrora',
    brandIndexUrl: null,
    fallbackSearchUrl: 'https://avrora.ua/?subcats=Y&status=A&pshort=Y&pfull=Y&pname=Y&pkeywords=Y&pcode_from_q=Y&search_performed=Y&dispatch=products.search&q=',
  },
  notino: {
    id: 'notino', label: 'Notino', host: 'notino.ua', filePrefix: 'notino',
    brandIndexUrl: 'https://www.notino.ua/kosmetychni-brendy/',
    fallbackSearchUrl: 'https://www.notino.ua/search.asp?exps=',
  },
  rozetka: {
    id: 'rozetka', label: 'Rozetka', host: 'rozetka.com.ua', filePrefix: 'rozetka',
    brandIndexUrl: null,
    fallbackSearchUrl: 'https://rozetka.com.ua/ua/search/?text=',
  },
});

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const NAVIGATION_TIMEOUT_MS = 45_000;
const CONTENT_TIMEOUT_MS = 35_000;
const MAX_PAGES = 100;
const MAX_LOAD_ATTEMPTS = 2;
const ROZETKA_DETAIL_CONCURRENCY = 2;
const MAKEUP_DETAIL_CONCURRENCY = 2;

class PriceScraper {
  constructor({ BrowserWindow, cacheFile, recoveryFile = null }) {
    this.BrowserWindow = BrowserWindow;
    this.cacheFile = cacheFile;
    this.recoveryFile = recoveryFile;
    this.brandCache = this.readCache();
    this.brandPromises = new Map();
    this.activeWindow = null;
    this.workerWindows = new Set();
    this.cancelled = false;
    this.jobRunning = false;
    this.recoverySeedProducts = [];
    this.partialProducts = [];
    this.recoveryState = null;
    this.recoveryTimer = null;
  }

  async warmBrands(store) {
    await this.ensureBrands(store);
  }

  async suggestBrands(store, query) {
    validateStore(store);
    if (!query) return [];
    if (!STORES[store].brandIndexUrl) return [];

    let brands = [];
    try {
      brands = await this.ensureBrands(store);
    } catch (_error) {
      brands = this.brandCache[store]?.brands || [];
    }

    return rankBrands(brands, query).slice(0, 8).map(({ item, score }) => ({
      name: item.name,
      score,
    }));
  }

  async parseBrand(store, query, onProgress = () => {}, options = {}) {
    validateStore(store);
    if (!query) throw new Error('Введіть назву торгової марки.');
    if (this.jobRunning) throw new Error('Інший пошук уже виконується.');

    const barcodeQuery = normalizeBarcode(query);
    if (!barcodeQuery && looksLikeBarcodeInput(query)) {
      throw new Error('Штрихкод має неправильну контрольну цифру. Перевірте введене значення.');
    }
    if (barcodeQuery && store !== 'makeup') {
      throw new Error('Пошук за штрихкодом поки що працює тільки для MAKEUP.');
    }
    const parseOptions = barcodeQuery
      ? { ...options, includeBarcodes: true, barcodeQuery }
      : options;

    this.cancelled = false;
    this.jobRunning = true;
    this.beginRecovery(store, query, parseOptions);
    const progress = (payload) => onProgress({ store, ...payload });
    let match = null;
    let resultBrand = String(query).trim();

    try {
      progress({
        phase: barcodeQuery ? 'barcode' : 'brand',
        message: barcodeQuery ? `Шукаю товар за штрихкодом ${barcodeQuery}…` : 'Шукаю торгову марку…',
      });
      match = barcodeQuery
        ? {
          name: barcodeQuery,
          url: STORES.makeup.fallbackSearchUrl + encodeURIComponent(barcodeQuery),
          searchMode: true,
          barcodeMode: true,
        }
        : await this.resolveBrand(store, query);
      this.setRecoveryBrand(match.name);
      this.assertNotCancelled();

      progress({
        phase: barcodeQuery ? 'barcode' : 'brand',
        message: barcodeQuery ? 'Знайдено результат. Перевіряю штрихкод у картці…' : `Знайдено марку: ${match.name}`,
        brand: match.name,
      });

      let products = await this.parseResolvedBrand(store, match, progress, parseOptions);

      products = deduplicateProducts(products).map((product) => ({
        ...product,
        brand: product.brand || match.name,
      }));
      if (barcodeQuery) {
        products = products.filter((product) => normalizeBarcode(product.barcode) === barcodeQuery);
        this.resetPartialToSeed();
        if (!products.length) {
          throw new Error(`MAKEUP не підтвердив штрихкод ${barcodeQuery} у картці товару.`);
        }
        resultBrand = products[0].brand || 'MAKEUP';
      } else {
        resultBrand = match.name;
      }
      this.rememberPartial(products, resultBrand);

      if (!products.length) {
        throw new Error(`На сторінці марки «${resultBrand}» товари не знайдено.`);
      }

      progress({
        phase: 'done',
        message: barcodeQuery
          ? `Готово: штрихкод ${barcodeQuery} підтверджено`
          : `Готово: знайдено ${products.length} товарів`,
        current: products.length,
        total: products.length,
        brand: resultBrand,
      });
      this.markRecovery('completed');

      return {
        store,
        brand: resultBrand,
        matchedBy: barcodeQuery ? 'barcode' : match.searchMode ? 'search' : 'directory',
        products,
      };
    } catch (error) {
      if (error?.code === 'CANCELLED') {
        const partialProducts = this.partialProducts.map((product) => ({
          ...product,
          brand: product.brand || match?.name || query,
        }));
        const products = barcodeQuery
          ? deduplicateProducts([
            ...this.recoverySeedProducts,
            ...partialProducts.filter((product) => normalizeBarcode(product.barcode) === barcodeQuery),
          ])
          : partialProducts;
        if (barcodeQuery) {
          this.partialProducts = products;
          if (this.recoveryState) this.recoveryState.products = [...products];
        }
        this.markRecovery('cancelled');
        progress({
          phase: 'cancelled',
          message: products.length
            ? `Пошук зупинено. Збережено ${products.length} товарів`
            : 'Пошук зупинено',
          current: products.length,
          brand: match?.name || query,
        });
        return {
          store,
          brand: products[0]?.brand || match?.name || query,
          matchedBy: barcodeQuery ? 'barcode' : match?.searchMode ? 'search' : 'directory',
          products,
          cancelled: true,
        };
      }
      this.markRecovery('error');
      progress({ phase: 'error', message: friendlyError(error) });
      throw new Error(friendlyError(error));
    } finally {
      this.closeActiveWindow();
      this.jobRunning = false;
    }
  }

  cancel() {
    if (!this.jobRunning) return;
    this.cancelled = true;
    this.markRecovery('cancelled');
    // Прерываем не только загрузку документа, но и все зависшие ожидания в
    // дочерних окнах. Иначе Electron может ждать сетевой таймаут несколько минут.
    this.closeActiveWindow();
  }

  dispose() {
    if (this.jobRunning) this.cancel();
    this.flushRecovery();
    this.closeActiveWindow();
  }

  getRecovery() {
    const saved = this.readRecovery();
    if (!saved || !Array.isArray(saved.products) || !saved.products.length) return null;
    return { ...saved, products: deduplicateProducts(saved.products) };
  }

  clearRecovery() {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    this.recoveryState = null;
    this.recoverySeedProducts = [];
    this.partialProducts = [];
    if (!this.recoveryFile) return;
    for (const file of [this.recoveryFile, `${this.recoveryFile}.bak`, `${this.recoveryFile}.tmp`]) {
      try { fs.unlinkSync(file); } catch (_error) { /* Файла может уже не быть. */ }
    }
  }

  beginRecovery(store, query, options = {}) {
    this.recoverySeedProducts = deduplicateProducts(
      Array.isArray(options.previousProducts) ? options.previousProducts : [],
    );
    this.partialProducts = [...this.recoverySeedProducts];
    this.recoveryState = {
      version: 1,
      store,
      query: String(options.recoveryQuery || query || '').trim(),
      brand: String(query || '').trim(),
      options: {
        includeVariants: Boolean(options.includeVariants),
        includeSellers: Boolean(options.includeSellers),
        includeBarcodes: Boolean(options.includeBarcodes),
      },
      status: 'running',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      products: [...this.partialProducts],
    };
    this.scheduleRecovery(true);
  }

  setRecoveryBrand(brand) {
    if (!this.recoveryState) return;
    this.recoveryState.brand = String(brand || this.recoveryState.brand || '').trim();
    this.scheduleRecovery();
  }

  rememberPartial(products, brand = '') {
    const current = Array.isArray(products) ? products : [];
    this.partialProducts = deduplicateProducts([...this.recoverySeedProducts, ...current]);
    if (!this.recoveryState) return;
    if (brand) this.recoveryState.brand = String(brand);
    this.recoveryState.products = [...this.partialProducts];
    this.recoveryState.updatedAt = new Date().toISOString();
    this.scheduleRecovery();
  }

  resetPartialToSeed() {
    this.partialProducts = [...this.recoverySeedProducts];
    if (this.recoveryState) this.recoveryState.products = [...this.partialProducts];
  }

  markRecovery(status) {
    if (!this.recoveryState) return;
    this.recoveryState.status = status;
    this.recoveryState.products = [...this.partialProducts];
    this.recoveryState.updatedAt = new Date().toISOString();
    this.scheduleRecovery(true);
  }

  scheduleRecovery(immediate = false) {
    if (!this.recoveryFile || !this.recoveryState) return;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    if (immediate) {
      this.flushRecovery();
      return;
    }
    this.recoveryTimer = setTimeout(() => this.flushRecovery(), 500);
    this.recoveryTimer.unref?.();
  }

  flushRecovery() {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    if (!this.recoveryFile || !this.recoveryState) return;
    const temporaryFile = `${this.recoveryFile}.tmp`;
    const backupFile = `${this.recoveryFile}.bak`;
    try {
      fs.mkdirSync(path.dirname(this.recoveryFile), { recursive: true });
      fs.writeFileSync(temporaryFile, JSON.stringify(this.recoveryState), 'utf8');
      if (fs.existsSync(this.recoveryFile)) fs.copyFileSync(this.recoveryFile, backupFile);
      fs.copyFileSync(temporaryFile, this.recoveryFile);
      fs.unlinkSync(temporaryFile);
    } catch (_error) {
      // Поиск продолжает работать, даже если Windows временно не дала записать файл.
    }
  }

  readRecovery() {
    if (!this.recoveryFile) return null;
    for (const file of [this.recoveryFile, `${this.recoveryFile}.bak`]) {
      try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (value && typeof value === 'object') return value;
      } catch (_error) {
        // Пробуем резервную копию.
      }
    }
    return null;
  }

  async resolveBrand(store, query) {
    const directUrl = parseSupportedUrl(query, STORES[store].host);
    if (directUrl) {
      return { name: brandNameFromUrl(directUrl), url: directUrl, searchMode: false };
    }

    if (!STORES[store].brandIndexUrl) {
      return {
        name: query.trim(),
        url: STORES[store].fallbackSearchUrl + encodeURIComponent(query.trim()),
        searchMode: true,
      };
    }

    let brands = [];
    try {
      brands = await this.ensureBrands(store);
    } catch (_error) {
      brands = this.brandCache[store]?.brands || [];
    }

    const best = rankBrands(brands, query)[0];
    const threshold = normalizeText(query).length <= 3 ? 0.72 : 0.55;
    if (best && best.score >= threshold) return { ...best.item, searchMode: false };

    return {
      name: query.trim(),
      url: STORES[store].fallbackSearchUrl + encodeURIComponent(query.trim()),
      searchMode: true,
    };
  }

  async ensureBrands(store) {
    validateStore(store);
    if (!STORES[store].brandIndexUrl) return [];
    const cached = this.brandCache[store];
    if (cached?.brands?.length && Date.now() - Number(cached.updatedAt || 0) < CACHE_MAX_AGE_MS) {
      return cached.brands;
    }

    if (this.brandPromises.has(store)) return this.brandPromises.get(store);

    const promise = this.fetchBrandDirectory(store)
      .then((brands) => {
        this.brandCache[store] = { updatedAt: Date.now(), brands };
        this.writeCache();
        return brands;
      })
      .catch((error) => {
        if (cached?.brands?.length) return cached.brands;
        throw error;
      })
      .finally(() => this.brandPromises.delete(store));

    this.brandPromises.set(store, promise);
    return promise;
  }

  async fetchBrandDirectory(store) {
    const browser = this.createHiddenWindow(`brands-${store}`);
    try {
      await this.navigate(browser, STORES[store].brandIndexUrl);
      await waitFor(async () => {
        const count = await browser.webContents.executeJavaScript(
          `document.querySelectorAll('a[href]').length`, true,
        );
        return count > 40 ? count : null;
      }, CONTENT_TIMEOUT_MS);

      const links = await browser.webContents.executeJavaScript(
        `(${extractBrandLinks.toString()})(${JSON.stringify(store)})`, true,
      );
      const brands = uniqueBrands(links);
      if (brands.length < 10) throw new Error('Довідник марок не завантажився.');
      return brands;
    } finally {
      safeDestroy(browser);
    }
  }

  async parseResolvedBrand(store, match, progress, options = {}) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt += 1) {
      this.assertNotCancelled();
      this.closeActiveWindow();
      this.activeWindow = this.createHiddenWindow(store);

      try {
        if (store === 'makeup') {
          return await this.parseMakeup(this.activeWindow, match, progress, options);
        }
        if (store === 'eva') {
          return await this.parseEva(this.activeWindow, match, progress, options);
        }
        if (store === 'notino') {
          return await this.parseNotino(this.activeWindow, match, progress, options);
        }
        if (store === 'aurora') {
          return await this.parseAurora(this.activeWindow, match, progress, options);
        }
        if (store === 'rozetka') {
          return await this.parseRozetka(this.activeWindow, match, progress, options);
        }
        return await this.parsePagedStore(this.activeWindow, store, match, progress);
      } catch (error) {
        lastError = error;
        if (error?.code === 'CANCELLED' || attempt >= MAX_LOAD_ATTEMPTS || !isRetryableLoadError(error)) {
          throw error;
        }

        progress({
          phase: 'retry',
          message: `Каталог не завантажився. Повторюю спробу ${attempt + 1} із ${MAX_LOAD_ATTEMPTS}…`,
          attempt: attempt + 1,
          totalAttempts: MAX_LOAD_ATTEMPTS,
          brand: match.name,
        });
        this.closeActiveWindow();
        await delay(1_000);
      }
    }
    throw lastError;
  }

  async parsePagedStore(browser, store, match, progress) {
    const products = [];
    let page = 1;
    let totalPages = 1;

    do {
      this.assertNotCancelled();
      const pageUrl = page === 1 ? match.url : withPage(match.url, store, page);
      progress({
        phase: 'loading',
        message: page === 1 ? 'Відкриваю каталог…' : `Завантажую сторінку ${page} із ${totalPages}…`,
        page, totalPages, current: products.length, brand: match.name,
      });

      await this.navigate(browser, pageUrl);
      await this.waitForProducts(browser, store);
      this.assertNotCancelled();

      const pageResult = await browser.webContents.executeJavaScript(
        `(${extractPage.toString()})(${JSON.stringify(store)}, ${JSON.stringify(match.name)})`, true,
      );

      products.push(...pageResult.products);
      this.rememberPartial(products, match.name);
      totalPages = Math.min(MAX_PAGES, Math.max(totalPages, Number(pageResult.totalPages || 1)));
      const uniqueCount = deduplicateProducts(products).length;
      progress({
        phase: 'collecting', message: `Зібрано товарів: ${uniqueCount}`,
        page, totalPages, current: uniqueCount, brand: match.name,
      });
      page += 1;
    } while (page <= totalPages);

    return products;
  }

  async parseEva(browser, match, progress, options = {}) {
    const products = await this.parsePagedStore(browser, 'eva', match, progress);
    if (!options.includeVariants) {
      return products.map(({ variant: _variant, needsVariantDetail: _needsVariantDetail, ...product }) => product);
    }
    return this.expandEvaVariants(browser, products, match, progress);
  }

  async parseAurora(browser, match, progress, options = {}) {
    const products = await this.parsePagedStore(browser, 'aurora', match, progress);
    if (!options.includeVariants) {
      return products.map(({ variantOptions: _variantOptions, needsVariantDetail: _needsVariantDetail, ...product }) => product);
    }
    const expanded = expandAuroraProducts(products);
    this.rememberPartial(expanded, match.name);
    return expanded;
  }

  async expandEvaVariants(browser, products, match, progress) {
    const expanded = [];
    const detailTargets = products.filter((product) => product.needsVariantDetail);
    const untouched = products.filter((product) => !product.needsVariantDetail);
    expanded.push(...untouched);
    this.resetPartialToSeed();
    this.rememberPartial(expanded, match.name);

    for (let index = 0; index < detailTargets.length; index += 1) {
      this.assertNotCancelled();
      const product = detailTargets[index];
      progress({
        phase: 'variants',
        message: `Перевіряю відтінки EVA: ${index + 1} із ${detailTargets.length}…`,
        current: index + 1,
        total: detailTargets.length,
        brand: match.name,
      });

      try {
        await this.navigate(browser, product.url);
        let variants = await browser.webContents.executeJavaScript(
          `(${extractEvaVariants.toString()})(${JSON.stringify(product)})`, true,
        );
        if (!variants.length) {
          await delay(750);
          variants = await browser.webContents.executeJavaScript(
            `(${extractEvaVariants.toString()})(${JSON.stringify(product)})`, true,
          );
        }
        if (variants.length) expanded.push(...variants);
        else expanded.push({ ...product, variant: 'Не вдалося перевірити відтінки' });
      } catch (error) {
        if (error?.code === 'CANCELLED') throw error;
        expanded.push({ ...product, variant: 'Не вдалося перевірити відтінки' });
      }
      this.rememberPartial(expanded, match.name);
    }

    return expanded;
  }

  async parseMakeup(browser, match, progress, options = {}) {
    await this.navigate(browser, match.url);
    await this.waitForProducts(browser, 'makeup');

    let stalledAttempts = 0;
    let iterations = 0;
    while (iterations < MAX_PAGES) {
      this.assertNotCancelled();
      const state = await browser.webContents.executeJavaScript(
        `(${makeupLoadState.toString()})()`, true,
      );

      progress({
        phase: 'loading',
        message: state.total
          ? `Завантажено ${state.count} із ${state.total} товарів…`
          : `Завантажено товарів: ${state.count}…`,
        current: state.count, total: state.total, brand: match.name,
      });

      if (!state.hasMore || (state.total && state.count >= state.total)) break;
      await browser.webContents.executeJavaScript(
        `document.querySelector('.Products__pagination > button')?.click()`, true,
      );

      const grew = await waitFor(async () => {
        this.assertNotCancelled();
        const count = await browser.webContents.executeJavaScript(
          `document.querySelectorAll('[data-testid="product-tile"]').length`, true,
        );
        return count > state.count ? count : null;
      }, 25_000, false);

      stalledAttempts = grew ? 0 : stalledAttempts + 1;
      if (stalledAttempts >= 2) break;
      iterations += 1;
    }

    const result = await browser.webContents.executeJavaScript(
      `(${extractPage.toString()})('makeup', ${JSON.stringify(match.name)})`, true,
    );
    if (!options.includeVariants && !options.includeBarcodes) {
      return result.products.map(({ needsVariantDetail: _needsVariantDetail, ...product }) => product);
    }
    return this.expandMakeupVariants(browser, result.products, match, progress, options);
  }

  async expandMakeupVariants(browser, products, match, progress, options = {}) {
    const results = [];
    const targets = [...products];
    const includeVariants = Boolean(options.includeVariants);
    const includeBarcodes = Boolean(options.includeBarcodes);
    const detailLabel = includeVariants && includeBarcodes
      ? 'відтінки та штрихкоди'
      : includeBarcodes ? 'штрихкоди' : 'відтінки';
    this.resetPartialToSeed();

    const secondaryWindow = this.createHiddenWindow('makeup-detail-2');
    this.workerWindows.add(secondaryWindow);
    const browsers = [browser, secondaryWindow]
      .slice(0, Math.min(MAKEUP_DETAIL_CONCURRENCY, targets.length));
    let nextIndex = 0;
    let completed = 0;

    progress({
      phase: 'details',
      message: `Перевіряю ${detailLabel} MAKEUP: 0 із ${targets.length}…`,
      current: 0,
      total: targets.length,
      brand: match.name,
    });

    const worker = async (detailWindow) => {
      while (true) {
        this.assertNotCancelled();
        const index = nextIndex;
        nextIndex += 1;
        if (index >= targets.length) return;
        const product = targets[index];

        let variantData = null;
        try {
          for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS && !variantData; attempt += 1) {
            try {
              await this.navigate(detailWindow, product.url);
              variantData = await waitFor(async () => {
                this.assertNotCancelled();
                return detailWindow.webContents.executeJavaScript(
                  `(${extractMakeupVariantData.toString()})()`, true,
                );
              }, 15_000, false);
            } catch (error) {
              if (error?.code === 'CANCELLED') throw error;
              if (attempt < MAX_LOAD_ATTEMPTS) await delay(650);
            }
          }
        } catch (error) {
          if (error?.code === 'CANCELLED') throw error;
        }

        if (variantData) {
          const requestedBarcode = normalizeBarcode(options.barcodeQuery);
          if (requestedBarcode) {
            let barcodeVariantId = normalizeBarcode(variantData.barcode) === requestedBarcode
              ? String(variantData.defaultVariantId || '')
              : '';
            if (!barcodeVariantId && variantData.id && variantData.variants?.length) {
              barcodeVariantId = await detailWindow.webContents.executeJavaScript(
                `(${findMakeupBarcodeVariant.toString()})(${JSON.stringify(variantData.id)}, ${JSON.stringify(variantData.variants)}, ${JSON.stringify(requestedBarcode)})`,
                true,
              );
            }
            variantData.barcodeVariantId = barcodeVariantId;
            if (barcodeVariantId) variantData.barcode = requestedBarcode;
          }
          results.push(...expandMakeupVariantData(product, variantData, {
            includeVariants,
            includeBarcodes,
            barcodeQuery: options.barcodeQuery,
          }));
        } else {
          const { needsVariantDetail: _needsVariantDetail, ...base } = product;
          results.push({
            ...base,
            ...(includeVariants ? { variant: 'Не вдалося перевірити варіанти' } : {}),
            ...(includeBarcodes ? { barcode: '' } : {}),
          });
        }

        completed += 1;
        this.rememberPartial(results, match.name);
        progress({
          phase: 'details',
          message: `Перевіряю ${detailLabel} MAKEUP: ${completed} із ${targets.length}…`,
          current: completed,
          total: targets.length,
          brand: match.name,
        });
      }
    };

    try {
      await Promise.all(browsers.map((detailWindow) => worker(detailWindow)));
    } finally {
      this.workerWindows.delete(secondaryWindow);
      safeDestroy(secondaryWindow);
    }
    return deduplicateProducts(results);
  }

  async parseNotino(browser, match, progress, options = {}) {
    await this.navigate(browser, match.url);
    await this.waitForProducts(browser, 'notino');

    await browser.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('[data-testid="footer-action-button"]');
      const root = button?.parentElement?.parentElement;
      if (root) root.dataset.priceMonitorListing = 'true';
    })()`, true);

    let stalledAttempts = 0;
    let iterations = 0;
    while (iterations < MAX_PAGES) {
      this.assertNotCancelled();
      const state = await browser.webContents.executeJavaScript(
        `(${notinoLoadState.toString()})()`, true,
      );

      progress({
        phase: 'loading',
        message: `Завантажено товарів Notino: ${state.count}…`,
        current: state.count,
        brand: match.name,
      });

      if (!state.hasMore) break;
      await browser.webContents.executeJavaScript(`(() => {
        const root = document.querySelector('[data-price-monitor-listing="true"]') || document;
        root.querySelector('[data-testid="footer-action-button"]')?.click();
      })()`, true);

      const grew = await waitFor(async () => {
        this.assertNotCancelled();
        const next = await browser.webContents.executeJavaScript(
          `(${notinoLoadState.toString()})()`, true,
        );
        return next.count > state.count ? next.count : null;
      }, 25_000, false);

      stalledAttempts = grew ? 0 : stalledAttempts + 1;
      if (stalledAttempts >= 2) break;
      iterations += 1;
    }

    const result = await browser.webContents.executeJavaScript(
      `(${extractPage.toString()})('notino', ${JSON.stringify(match.name)})`, true,
    );
    if (!options.includeVariants) {
      return result.products.map(({ variant: _variant, needsVariantDetail: _needsVariantDetail, ...product }) => product);
    }
    return this.expandNotinoVariants(browser, result.products, match, progress);
  }

  async expandNotinoVariants(browser, products, match, progress) {
    const expanded = [];
    const detailTargets = products.filter((product) => product.needsVariantDetail);
    const untouched = products.filter((product) => !product.needsVariantDetail);
    expanded.push(...untouched);
    this.resetPartialToSeed();
    this.rememberPartial(expanded, match.name);

    for (let index = 0; index < detailTargets.length; index += 1) {
      this.assertNotCancelled();
      const product = detailTargets[index];
      progress({
        phase: 'variants',
        message: `Перевіряю відтінки та варіанти: ${index + 1} із ${detailTargets.length}…`,
        current: index + 1,
        total: detailTargets.length,
        brand: match.name,
      });

      try {
        await this.navigate(browser, product.url);
        let variants = await browser.webContents.executeJavaScript(
          `(${extractNotinoVariants.toString()})(${JSON.stringify(product)})`, true,
        );
        if (!variants.length) {
          await delay(750);
          variants = await browser.webContents.executeJavaScript(
            `(${extractNotinoVariants.toString()})(${JSON.stringify(product)})`, true,
          );
        }
        if (variants.length) expanded.push(...variants);
        else expanded.push({ ...product, variant: 'Не вдалося перевірити варіанти' });
      } catch (error) {
        if (error?.code === 'CANCELLED') throw error;
        expanded.push({ ...product, variant: 'Не вдалося перевірити варіанти' });
      }
      this.rememberPartial(expanded, match.name);
    }

    return expanded;
  }

  async parseRozetka(browser, match, progress, options = {}) {
    const targetUrl = new URL(match.url);
    if (/\/p\d+\/?$/i.test(targetUrl.pathname)) {
      const parentProduct = {
        name: match.name,
        brand: match.name,
        url: match.url,
        hasAdditionalSellers: Boolean(options.includeSellers),
      };
      if (options.includeSellers) {
        const offers = await this.expandRozetkaSellers(browser, [parentProduct], match, progress);
        if (offers[0]?.brand) match.name = offers[0].brand;
        return offers;
      }
      await this.navigate(browser, match.url);
      const offer = await this.waitForRozetkaOffer(browser, parentProduct);
      if (offer?.brand) match.name = offer.brand;
      if (!offer?.available) return [];
      const {
        sellerOfferUrls: _sellerOfferUrls, sellerOffersReady: _sellerOffersReady,
        hasAdditionalSellers: _hasAdditionalSellers, ...cleanOffer
      } = offer;
      return [cleanOffer];
    }

    if (match.searchMode || /\/search\/?$/i.test(targetUrl.pathname)) {
      progress({
        phase: 'brand',
        message: `Уточнюю виробника «${match.name}» у Rozetka…`,
        brand: match.name,
      });
      const resolved = await this.resolveRozetkaProducer(browser, match);
      Object.assign(match, resolved, { searchMode: false });
    }

    const products = await this.parsePagedStore(browser, 'rozetka', match, progress);
    if (!options.includeSellers) {
      return products.map(({ variantUrls: _variantUrls, needsSellerDetail: _needsSellerDetail, ...product }) => product);
    }
    return this.expandRozetkaSellers(browser, products, match, progress);
  }

  async resolveRozetkaProducer(browser, match) {
    await this.navigate(browser, match.url);
    await this.waitForProducts(browser, 'rozetka');

    try {
      const currentUrl = new URL(browser.webContents.getURL());
      if (currentUrl.searchParams.has('producer')) {
        return { name: match.name, url: currentUrl.href };
      }
    } catch (_error) {
      // Якщо адреса ще змінюється, нижче дочекаємося звичайного фільтра.
    }

    await browser.webContents.executeJavaScript(
      `(${fillRozetkaProducerFilter.toString()})(${JSON.stringify(match.name)})`, true,
    );
    const producer = await waitFor(async () => {
      this.assertNotCancelled();
      return browser.webContents.executeJavaScript(
        `(${findRozetkaProducer.toString()})(${JSON.stringify(match.name)})`, true,
      );
    }, 12_000, false);

    if (!producer?.url) {
      throw new Error(`Не вдалося знайти виробника «${match.name}» у фільтрі Rozetka.`);
    }
    return { name: producer.name || match.name, url: producer.url };
  }

  async expandRozetkaSellers(browser, products, match, progress) {
    const targets = [];
    const seenUrls = new Set();
    const addTarget = (product) => {
      const url = String(product?.url || '').replace(/#.*$/, '');
      if (!url || seenUrls.has(url)) return false;
      seenUrls.add(url);
      targets.push({ ...product, url });
      return true;
    };
    for (const product of products) {
      const { variantUrls = [], needsSellerDetail: _needsSellerDetail, ...base } = product;
      addTarget(base);
      for (const variantUrl of variantUrls) {
        if (variantUrl && variantUrl !== base.url) addTarget({ ...base, url: variantUrl });
      }
    }

    const results = [];
    this.resetPartialToSeed();
    const secondaryWindow = this.createHiddenWindow('rozetka-detail-2');
    this.workerWindows.add(secondaryWindow);
    const browsers = [browser, secondaryWindow].slice(0, Math.min(ROZETKA_DETAIL_CONCURRENCY, targets.length));
    let nextIndex = 0;
    let completed = 0;

    progress({
      phase: 'sellers',
      message: `Перевіряю продавців Rozetka: 0 із ${targets.length}…`,
      current: 0,
      total: targets.length,
      brand: match.name,
    });

    const worker = async (detailWindow) => {
      while (true) {
        this.assertNotCancelled();
        const index = nextIndex;
        nextIndex += 1;
        if (index >= targets.length) return;
        const product = targets[index];

        let offer = null;
        try {
          for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS && !offer; attempt += 1) {
            try {
              await this.navigate(detailWindow, product.url);
              offer = await this.waitForRozetkaOffer(detailWindow, product);
            } catch (error) {
              if (error?.code === 'CANCELLED') throw error;
              if (attempt < MAX_LOAD_ATTEMPTS) await delay(650);
            }
          }
        } catch (error) {
          if (error?.code === 'CANCELLED') throw error;
        }

        if (offer?.available) {
          const {
            sellerOfferUrls = [], sellerOffersReady: _sellerOffersReady,
            hasAdditionalSellers: _hasAdditionalSellers, isAdditionalSeller: _isAdditionalSeller,
            ...cleanOffer
          } = offer;
          results.push(cleanOffer);
          if (product.hasAdditionalSellers) {
            for (const sellerUrl of sellerOfferUrls) {
              addTarget({
                name: product.name,
                brand: product.brand,
                url: sellerUrl,
                image: product.image,
                hasAdditionalSellers: false,
                isAdditionalSeller: true,
              });
            }
          }
        } else if (!offer && !product.isAdditionalSeller
          && product.currentPrice !== null && product.currentPrice !== undefined) {
          const {
            hasAdditionalSellers: _hasAdditionalSellers, isAdditionalSeller: _isAdditionalSeller,
            ...fallbackProduct
          } = product;
          results.push({ ...fallbackProduct, seller: 'Не вдалося перевірити' });
        }

        completed += 1;
        this.rememberPartial(results, match.name);
        progress({
          phase: 'sellers',
          message: `Перевіряю продавців Rozetka: ${completed} із ${targets.length}…`,
          current: completed,
          total: targets.length,
          brand: match.name,
        });
      }
    };

    try {
      await Promise.all(browsers.map((detailWindow) => worker(detailWindow)));
    } finally {
      this.workerWindows.delete(secondaryWindow);
      safeDestroy(secondaryWindow);
    }
    return deduplicateProducts(results);
  }

  async waitForRozetkaOffer(browser, parentProduct) {
    const offer = await waitFor(async () => {
      this.assertNotCancelled();
      return browser.webContents.executeJavaScript(
        `(${extractRozetkaOffer.toString()})(${JSON.stringify(parentProduct)})`, true,
      );
    }, 15_000, false);
    if (!offer || !parentProduct?.hasAdditionalSellers || offer.sellerOffersReady) return offer;

    const withSellerOffers = await waitFor(async () => {
      this.assertNotCancelled();
      const updated = await browser.webContents.executeJavaScript(
        `(${extractRozetkaOffer.toString()})(${JSON.stringify(parentProduct)})`, true,
      );
      return updated?.sellerOffersReady ? updated : null;
    }, 5_000, false);
    return withSellerOffers || offer;
  }

  async waitForProducts(browser, store) {
    const selector = store === 'eva'
      ? '[data-testid="o-listing"] [data-testid="product-card-simple"], [data-testid="o-listing"] [data-testid="product-card-configurable"]'
      : store === 'makeup'
        ? '[data-testid="product-tile"]'
      : store === 'notino'
          ? '[data-testid="product-container"] [data-testid="product-card-name"]'
        : store === 'rozetka'
          ? 'main article a.tile-title'
        : store === 'aurora'
          ? 'form[name^="product_form_"] a.product-title'
          : '.products__grid .sf-product-card__block';

    const found = await waitFor(async () => {
      this.assertNotCancelled();
      return browser.webContents.executeJavaScript(
        `document.querySelectorAll(${JSON.stringify(selector)}).length || null`, true,
      );
    }, CONTENT_TIMEOUT_MS, false);

    if (!found) {
      const title = browser.webContents.getTitle();
      throw new Error(`Каталог не завантажився${title ? ` (${title})` : ''}.`);
    }

    // Карточки появляются раньше цен. Даём динамическому каталогу полностью
    // дорисоваться, иначе на медленном компьютере часть цен может потеряться.
    const minimumSettleMs = store === 'eva' ? 3_000 : 1_500;
    const startedAt = Date.now();
    let previousSignature = '';
    let stableChecks = 0;
    await waitFor(async () => {
      this.assertNotCancelled();
      const state = await browser.webContents.executeJavaScript(
        `(${catalogLoadState.toString()})(${JSON.stringify(store)})`, true,
      );
      const signature = `${state.cards}:${state.priced}`;
      if (signature === previousSignature) stableChecks += 1;
      else stableChecks = 0;
      previousSignature = signature;
      return Date.now() - startedAt >= minimumSettleMs && stableChecks >= 3 ? state : null;
    }, 12_000, false);
  }

  async navigate(browser, url) {
    this.assertNotCancelled();
    try {
      await promiseWithTimeout(
        browser.loadURL(url, { userAgent: browser.webContents.getUserAgent() }),
        NAVIGATION_TIMEOUT_MS,
        'Сайт надто довго не відповідає.',
      );
    } catch (error) {
      if (this.cancelled) this.assertNotCancelled();
      // Некоторые SPA (в частности EVA) отменяют первоначальный документ после
      // клиентского перенаправления. Страница при этом продолжает загружаться,
      // поэтому ниже проверяем фактическое появление карточек.
      if (!/ERR_ABORTED|ERR_FAILED/.test(String(error?.message))) throw error;
    }

    const expectedUrl = new URL(url);
    const pageKey = expectedUrl.searchParams.has('p')
      ? 'p'
      : expectedUrl.searchParams.has('page') ? 'page' : null;
    if (pageKey) {
      await waitFor(() => {
        try {
          const currentUrl = new URL(browser.webContents.getURL());
          return currentUrl.searchParams.get(pageKey) === expectedUrl.searchParams.get(pageKey);
        } catch (_error) {
          return false;
        }
      }, 10_000, false);
    }
    await delay(450);
  }

  createHiddenWindow(partitionName) {
    const browser = new this.BrowserWindow({
      show: false,
      width: 1440,
      height: 1000,
      webPreferences: {
        partition: `persist:price-monitor-${partitionName}`,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        javascript: true,
        // Некоторые каталоги привязывают дорисовку карточек к загрузке изображений.
        // Оставляем её включённой ради полноты ассортимента.
        images: true,
        backgroundThrottling: false,
      },
    });

    const chromeVersion = process.versions.chrome || '120.0.0.0';
    browser.webContents.setUserAgent(
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
      `(KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`,
    );
    browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    browser.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    return browser;
  }

  assertNotCancelled() {
    if (!this.cancelled) return;
    const error = new Error('Cancelled');
    error.code = 'CANCELLED';
    throw error;
  }

  closeActiveWindow() {
    safeDestroy(this.activeWindow);
    this.activeWindow = null;
    for (const browser of this.workerWindows) safeDestroy(browser);
    this.workerWindows.clear();
  }

  readCache() {
    try {
      return JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')) || {};
    } catch (_error) {
      return {};
    }
  }

  writeCache() {
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.brandCache));
    } catch (_error) {
      // Подсказки продолжат работать в памяти, даже если кэш нельзя записать.
    }
  }
}

function extractBrandLinks(store) {
  const result = [];
  for (const anchor of document.querySelectorAll('a[href]')) {
    const name = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 100) continue;

    let url;
    try {
      url = new URL(anchor.getAttribute('href'), location.origin);
    } catch (_error) {
      continue;
    }

    const brandPath = url.pathname;
    const isBrand =
      (store === 'eva' && /^\/ua\/brnd-\d+\/?$/.test(brandPath)) ||
      (store === 'makeup' && /^\/ua\/brand\/\d+\/?$/.test(brandPath)) ||
      (store === 'varus' && /^\/brands\/[^/]+\/?$/.test(brandPath)) ||
      (store === 'notino'
        && Boolean(anchor.closest('.crossroad-brands .brand'))
        && /^\/[^/]+\/?$/.test(brandPath));
    if (isBrand) result.push({ name, url: url.href });
  }
  return result;
}

function fillRozetkaProducerFilter(query) {
  // У каталозі Rozetka поле пошуку виробника має type=search, а головний
  // рядок пошуку — звичайний textbox. Це стабільніше за згенеровані Angular-класи.
  const input = document.querySelector('input[type="search"][placeholder*="Пошук"], input[type="search"]');
  if (!input) return false;

  const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')?.set;
  if (setter) setter.call(input, String(query || '').trim());
  else input.value = String(query || '').trim();
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function findRozetkaProducer(query) {
  const normalize = (value) => String(value || '')
    .normalize('NFKD')
    .replace(/[’`´]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLocaleLowerCase('uk');
  const expected = normalize(query);
  if (!expected) return null;

  const candidates = [...document.querySelectorAll('a[href*="producer="]')]
    .map((anchor) => ({
      name: String(anchor.textContent || '').replace(/\s+/g, ' ').trim().replace(/\s+\d+$/, ''),
      url: anchor.href,
    }))
    .filter((item) => item.name && item.url)
    .map((item) => {
      const name = normalize(item.name);
      const score = name === expected ? 1
        : name.startsWith(expected) ? 0.94
          : name.includes(expected) || expected.includes(name) ? 0.84 : 0;
      return { ...item, score };
    })
    .filter((item) => item.score >= 0.84)
    .sort((left, right) => right.score - left.score || left.name.length - right.name.length);
  return candidates[0] || null;
}

function extractPage(store, fallbackBrand) {
  const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const price = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const normalized = clean(String(value || '')).replace(/[^\d.,]/g, '').replace(',', '.');
    const number = Number.parseFloat(normalized);
    return Number.isFinite(number) ? number : null;
  };
  const absoluteUrl = (value) => {
    try { return new URL(value, location.origin).href; } catch (_error) { return ''; }
  };

  let cards = [];
  if (store === 'eva') {
    const listing = document.querySelector('[data-testid="o-listing"]') || document;
    cards = [...listing.querySelectorAll(
      '[data-testid="product-card-simple"], [data-testid="product-card-configurable"]',
    )].map((card) => {
      const nameElement = card.querySelector('[data-testid="product-name"]');
      const brand = clean(card.querySelector('[data-testid="product-brand"]')?.textContent) || fallbackBrand;
      const finalPrice = price(card.querySelector('[data-testid="product-final-price"]')?.textContent);
      const originalPrice = price(card.querySelector('[data-testid="product-price"]')?.textContent);
      const onSale = Boolean(card.querySelector('[data-testid="product-discount-percent"]')) && originalPrice !== null;
      const currentPrice = finalPrice ?? originalPrice;
      const buyButton = card.querySelector('button[data-testid="add-to-cart-button"]');
      const available = currentPrice !== null
        && Boolean(buyButton)
        && !buyButton.disabled
        && buyButton.getAttribute('aria-disabled') !== 'true';
      return {
        name: clean(nameElement?.textContent), brand,
        priceWithDiscount: onSale ? currentPrice : null,
        priceWithoutDiscount: onSale ? originalPrice : currentPrice,
        currentPrice, onSale, available,
        needsVariantDetail: card.matches('[data-testid="product-card-configurable"]'),
        url: absoluteUrl(nameElement?.getAttribute('href')),
        image: card.querySelector('img')?.currentSrc || card.querySelector('img')?.src || '',
      };
    });
  } else if (store === 'makeup') {
    cards = [...document.querySelectorAll('[data-testid="product-tile"]')].map((card) => {
      const nameElement = card.querySelector('.ProductCard__title');
      const title = clean(nameElement?.textContent);
      const subtitle = clean(card.querySelector('.ProductCard__subTitle')?.textContent);
      const name = subtitle && subtitle.toLocaleLowerCase() !== title.toLocaleLowerCase()
        ? `${title} — ${subtitle}`
        : title;
      const currentPrice = price(card.querySelector('.Price__priceCurrent')?.textContent);
      const originalPrice = price(card.querySelector('.Price__priceOld')?.textContent);
      const onSale = originalPrice !== null && currentPrice !== null && originalPrice > currentPrice;
      const buyButton = card.querySelector('button[data-testid="product-tile-buy-icon"]');
      const available = currentPrice !== null
        && Boolean(buyButton)
        && !buyButton.disabled
        && buyButton.getAttribute('aria-disabled') !== 'true';
      return {
        name, brand: fallbackBrand,
        priceWithDiscount: onSale ? currentPrice : null,
        priceWithoutDiscount: onSale ? originalPrice : currentPrice,
        currentPrice, onSale, available,
        needsVariantDetail: true,
        url: absoluteUrl(nameElement?.getAttribute('href')),
        image: card.querySelector('img')?.currentSrc || card.querySelector('img')?.src || '',
      };
    });
  } else if (store === 'varus') {
    cards = [...document.querySelectorAll('.products__grid .sf-product-card__block')].map((card) => {
      const nameElement = card.querySelector('.sf-product-card__title');
      const linkElement = card.querySelector('.sf-product-card__link');
      const specialPrice = price(card.querySelector('.sf-price__special')?.textContent);
      const oldPrice = price(card.querySelector('.sf-price__old')?.textContent);
      const regularPrice = price(card.querySelector('.sf-price__regular')?.textContent);
      const onSale = specialPrice !== null && oldPrice !== null;
      const currentPrice = onSale ? specialPrice : regularPrice;
      const buyButton = card.querySelector('.m-product-add-to-cart button, .a-add-to-cart');
      const available = currentPrice !== null
        && Boolean(buyButton)
        && !buyButton.disabled
        && buyButton.getAttribute('aria-disabled') !== 'true';
      return {
        name: clean(nameElement?.textContent), brand: fallbackBrand,
        priceWithDiscount: onSale ? currentPrice : null,
        priceWithoutDiscount: onSale ? oldPrice : currentPrice,
        currentPrice, onSale, available,
        url: absoluteUrl(linkElement?.getAttribute('href')),
        image: card.closest('.sf-product-card')?.querySelector('img')?.src || '',
      };
    });
  } else if (store === 'aurora') {
    cards = [...document.querySelectorAll('form[name^="product_form_"]')].map((card) => {
      const nameElement = card.querySelector('a.product-title');
      const productName = clean(nameElement?.textContent);
      const brand = clean(card.querySelector('.gtm-array')?.getAttribute('data-gtm-brand')) || fallbackBrand;
      const currentPrice = price(card.querySelector('[id^="sec_discounted_price_"]')?.textContent);
      const originalPrice = price(card.querySelector('[id^="sec_list_price_"]')?.textContent);
      const onSale = originalPrice !== null && currentPrice !== null && originalPrice > currentPrice;
      const buyButton = card.querySelector(
        'a[href*="dispatch=products.popup_get_item_in_shops"], .ty-btn__add-to-cart',
      );
      const available = currentPrice !== null
        && Boolean(buyButton)
        && !buyButton.disabled
        && buyButton.getAttribute('aria-disabled') !== 'true';
      const variantOptions = [...card.querySelectorAll('.product-variation-color a[href*="variant_color_id"]')]
        .map((anchor) => {
          const image = anchor.querySelector('img');
          const fullLabel = clean(image?.getAttribute('alt') || image?.getAttribute('title'));
          const variant = fullLabel.toLocaleLowerCase().startsWith(productName.toLocaleLowerCase())
            ? clean(fullLabel.slice(productName.length).replace(/^\s*[-–—]\s*/, ''))
            : fullLabel;
          return {
            variant: variant || `Варіант ${new URL(anchor.href, location.origin).searchParams.get('variant_color_id') || ''}`.trim(),
            url: absoluteUrl(anchor.getAttribute('href')),
            image: image?.currentSrc || image?.src || '',
          };
        })
        .filter((option, index, items) => option.url && items.findIndex((item) => item.url === option.url) === index);
      return {
        name: productName, brand,
        priceWithDiscount: onSale ? currentPrice : null,
        priceWithoutDiscount: onSale ? originalPrice : currentPrice,
        currentPrice, onSale, available,
        variantOptions,
        needsVariantDetail: variantOptions.length > 0 || /(?:в асортименті|\bмікс\b)/i.test(productName),
        url: absoluteUrl(nameElement?.getAttribute('href')),
        image: card.querySelector('img.ty-pict, img')?.currentSrc || card.querySelector('img.ty-pict, img')?.src || '',
      };
    });
  } else if (store === 'notino') {
    const canonicalUrl = (value) => absoluteUrl(value).replace(/\/p-\d+\/?(?:[?#].*)?$/, '/');
    let listing = [];
    try {
      const state = JSON.parse(document.querySelector('#navigation-fragment-state')?.textContent || '{}');
      listing = state?.fragmentContextData?.DataContextProvider?.listing?.products || [];
    } catch (_error) {
      listing = [];
    }

    const structuredByUrl = new Map();
    const promotionRules = new Map();
    for (const item of listing) {
      structuredByUrl.set(canonicalUrl(item?.url), item);
      const promotion = item?.promotionData;
      const code = clean(promotion?.voucherCode);
      if (code && promotion?.discountWithCondition) {
        promotionRules.set(code.toLocaleLowerCase(), promotion.discountWithCondition);
      }
    }

    const root = document.querySelector('[data-price-monitor-listing="true"]') || document;
    cards = [...root.querySelectorAll('[data-testid="product-container"]')].map((card) => {
      const nameElement = card.querySelector('[data-testid="product-card-name"]');
      const variantName = clean(card.querySelector('[data-testid="product-card-variant-name"]')?.textContent);
      const productUrl = canonicalUrl(card.querySelector('a[href]')?.getAttribute('href'));
      const structured = structuredByUrl.get(productUrl);
      const currentPrice = price(structured?.priceInformation?.price)
        ?? price(card.querySelector('[data-testid="price-component"]')?.textContent);
      const originalPrice = price(structured?.priceInformation?.originalPrice);
      const onSale = originalPrice !== null && currentPrice !== null && originalPrice > currentPrice;
      const cardText = clean(card.textContent);
      const code = clean(structured?.promotionData?.voucherCode)
        || clean((cardText.match(/Код на знижку\s+([^\s]+)/i) || [])[1]);
      const rule = structured?.promotionData?.discountWithCondition
        || promotionRules.get(code.toLocaleLowerCase());
      const directPromoPrice = price(structured?.promotionData?.discountedPrice);
      const percentage = Number(rule?.discount);
      const calculatedPromoPrice = currentPrice !== null
        && Number.isFinite(percentage) && percentage > 0 && percentage < 100
        ? Math.round(currentPrice * (1 - percentage / 100) * 100) / 100
        : null;
      const promoPrice = directPromoPrice ?? calculatedPromoPrice;
      const conditionSuffix = rule?.conditionType === 'Price' && Number(rule.condition) > 0
        ? `, якщо сума від ${Number(rule.condition)} грн`
        : '';
      const promotionCondition = code
        ? rule
          ? `Промокод ${code}: −${percentage}% на категорію «${clean(rule.name)}»${conditionSuffix}`
          : `Промокод ${code}; умову перевірте на сайті`
        : '';
      const stock = clean(structured?.stockAvailability).toLocaleLowerCase();
      const available = currentPrice !== null
        && !structured?.isForbiddenToOffer
        && !/outofstock|unavailable|none/.test(stock)
        && !/немає в наявності/i.test(cardText);
      const title = clean(nameElement?.textContent);
      const name = variantName && variantName.toLocaleLowerCase() !== title.toLocaleLowerCase()
        ? `${title} — ${variantName}`
        : title;
      const structuredVariants = Array.isArray(structured?.variants) ? structured.variants : [];
      const variant = structuredVariants.length === 1
        ? clean(structuredVariants[0]?.additionalInfo)
        : '';
      const variantCount = Number(structured?.productVariants?.count || structuredVariants.length || 0);
      const needsVariantDetail = variantCount > 1
        || structuredVariants.length > 1
        || /\bвід\b/i.test(clean(card.querySelector('[data-testid="prefix-component"]')?.textContent));
      return {
        name,
        brand: clean(card.querySelector('[data-testid="product-card-brand"]')?.textContent) || fallbackBrand,
        priceWithDiscount: onSale ? currentPrice : null,
        priceWithoutDiscount: onSale ? originalPrice : currentPrice,
        currentPrice,
        onSale,
        available,
        promoCode: code,
        promoPrice,
        promoDiscountPercent: Number.isFinite(percentage) ? percentage : null,
        promotionCondition,
        variant,
        needsVariantDetail,
        url: productUrl,
        image: card.querySelector('img')?.currentSrc || card.querySelector('img')?.src || '',
      };
    });
  } else if (store === 'rozetka') {
    cards = [...document.querySelectorAll('main article')].map((card) => {
      const nameElement = card.querySelector('a.tile-title');
      const currentPrice = price(card.querySelector('rz-tile-price .price, .price')?.textContent);
      const originalPrice = price(card.querySelector('rz-tile-price .old-price, .old-price')?.textContent);
      const onSale = originalPrice !== null && currentPrice !== null && originalPrice > currentPrice;
      const buyButton = card.querySelector('button.buy-button[aria-label="Купити"], button.buy-button');
      const available = currentPrice !== null
        && Boolean(buyButton)
        && !buyButton.disabled
        && buyButton.getAttribute('aria-disabled') !== 'true';
      const productUrl = absoluteUrl(nameElement?.getAttribute('href')).replace(/#.*$/, '');
      const variantUrls = [...card.querySelectorAll('rz-tile-colors a[data-testid="filter-link"][href]')]
        .map((anchor) => absoluteUrl(anchor.getAttribute('href')).replace(/#.*$/, ''))
        .filter(Boolean);
      const hasAdditionalSellers = Boolean(card.querySelector('rz-tile-same-offer'));
      return {
        name: clean(nameElement?.textContent),
        brand: fallbackBrand,
        priceWithDiscount: onSale ? currentPrice : null,
        priceWithoutDiscount: onSale ? originalPrice : currentPrice,
        currentPrice,
        onSale,
        available,
        needsSellerDetail: true,
        hasAdditionalSellers,
        variantUrls,
        url: productUrl,
        image: card.querySelector('img.tile-image, img')?.currentSrc || card.querySelector('img.tile-image, img')?.src || '',
      };
    });
  }

  cards = cards.filter((item) => item.name && item.url && item.available);
  const pageParameter = store === 'eva' ? 'p' : 'page';
  const pageNumbers = [...document.querySelectorAll('a[href]')].map((anchor) => {
    try { return Number(new URL(anchor.href, location.origin).searchParams.get(pageParameter)); }
    catch (_error) { return 0; }
  }).filter(Number.isFinite);

  return { products: cards, totalPages: Math.max(1, ...pageNumbers) };
}

function extractRozetkaOffer(parentProduct) {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const price = (value) => {
    const normalized = clean(value).replace(/[^\d.,]/g, '').replace(',', '.');
    const number = Number.parseFloat(normalized);
    return Number.isFinite(number) ? number : null;
  };
  const root = document.querySelector('rz-product-main-info');
  if (!root) return null;

  const status = clean(root.querySelector('rz-status-label')?.textContent);
  const currentPrice = price(root.querySelector('.product-price__big')?.textContent);
  const originalPrice = price(root.querySelector('.product-price__small')?.textContent);
  const buyButton = root.querySelector('button.buy-button[aria-label="Купити"], button.buy-button');
  const sellerRoot = root.querySelector('rz-seller-title');
  if (currentPrice === null || !status || !sellerRoot) return null;
  const available = currentPrice !== null
    && /є в наявності/i.test(status)
    && Boolean(buyButton)
    && !buyButton.disabled
    && buyButton.getAttribute('aria-disabled') !== 'true';
  const seller = clean(sellerRoot?.querySelector('img[alt]')?.getAttribute('alt'))
    || clean(sellerRoot?.querySelector('.seller-market-link, a[href*="seller"]')?.textContent)
    || clean(sellerRoot?.textContent).replace(/^Продавець:\s*/i, '');
  if (!seller) return null;
  const brandControl = [...document.querySelectorAll('button, a')]
    .find((element) => /^Усі товари бренду\b/i.test(clean(element.textContent)));
  let structuredBrand = '';
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const rootValue = JSON.parse(script.textContent || 'null');
      const queue = Array.isArray(rootValue) ? [...rootValue] : [rootValue];
      while (queue.length) {
        const value = queue.shift();
        if (!value || typeof value !== 'object') continue;
        if (String(value['@type'] || '').toLocaleLowerCase() === 'product') {
          structuredBrand = clean(value.brand?.name || value.brand);
          if (structuredBrand) break;
        }
        queue.push(...Object.values(value).filter((nested) => nested && typeof nested === 'object'));
      }
    } catch (_error) {
      // Невалідний JSON-LD не заважає прочитати ціну та продавця зі сторінки.
    }
    if (structuredBrand) break;
  }
  const pageBrand = structuredBrand
    || clean(document.querySelector('[itemprop="brand"]')?.getAttribute('content'))
    || clean(document.querySelector('[itemprop="brand"]')?.textContent)
    || clean(brandControl?.textContent).replace(/^Усі товари бренду\s*/i, '');
  const onSale = originalPrice !== null && originalPrice > currentPrice;
  const sellerOfferUrls = parentProduct?.hasAdditionalSellers
    ? [...document.querySelectorAll('rz-product-offers a[href*="/p"]')]
      .map((anchor) => {
        try {
          const url = new URL(anchor.getAttribute('href'), location.origin);
          url.hash = '';
          return url.href;
        } catch (_error) {
          return '';
        }
      })
      .filter((url, index, items) => url && url !== location.href.replace(/#.*$/, '') && items.indexOf(url) === index)
    : [];

  return {
    ...parentProduct,
    name: clean(document.querySelector('h1')?.textContent) || clean(parentProduct?.name),
    brand: pageBrand || clean(parentProduct?.brand),
    seller,
    priceWithDiscount: onSale ? currentPrice : null,
    priceWithoutDiscount: onSale ? originalPrice : currentPrice,
    currentPrice,
    onSale,
    available,
    url: location.href.replace(/#.*$/, ''),
    sellerOfferUrls,
    sellerOffersReady: !parentProduct?.hasAdditionalSellers || sellerOfferUrls.length > 0,
    needsSellerDetail: false,
    variantUrls: undefined,
  };
}

function extractMakeupVariantData() {
  const script = [...document.scripts]
    .find((item) => String(item.textContent || '').includes('window.__staticQueryClientHydrationData'));
  const source = String(script?.textContent || '');
  const start = source.indexOf('JSON.parse(');
  const end = source.lastIndexOf(');');
  if (start < 0 || end <= start) return null;

  let state;
  try {
    state = JSON.parse(JSON.parse(source.slice(start + 11, end)));
  } catch (_error) {
    return null;
  }

  const query = (state?.queries || []).find((item) => (
    Array.isArray(item?.queryKey)
      && item.queryKey[0] === 'shop'
      && item.queryKey[1] === 'products'
      && item.queryKey.length === 4
      && item?.state?.data?.id
  ));
  const product = query?.state?.data;
  if (!product) return null;

  const priceData = (value) => ({
    current: Number.isFinite(Number(value?.current)) ? Number(value.current) : null,
    old: Number.isFinite(Number(value?.old)) ? Number(value.old) : null,
  });
  const variants = (Array.isArray(product.variants) ? product.variants : []).map((variant) => ({
    id: String(variant?.id ?? ''),
    title: String(variant?.title || '').replace(/\s+/g, ' ').trim(),
    inStock: variant?.inStock === true,
    region: String(variant?.region || ''),
    image: variant?.media?.thumbnail || variant?.media?.url || '',
    ...priceData(variant?.price),
  }));

  return {
    id: String(product.id ?? ''),
    name: String(product.title || '').replace(/\s+/g, ' ').trim(),
    brand: String(product.brand?.title || '').replace(/\s+/g, ' ').trim(),
    inStock: product.inStock === true,
    hasVariants: Boolean(product.hasVariants),
    barcode: String(product.meta?.gtin13 || ''),
    defaultVariantId: String(product.defaultVariant?.id ?? ''),
    defaultVariantTitle: String(product.defaultVariant?.title || '').replace(/\s+/g, ' ').trim(),
    defaultVariantRegion: String(product.defaultVariant?.region || ''),
    defaultVariantInStock: product.defaultVariant?.inStock === true,
    defaultVariantPrice: priceData(product.defaultVariant?.price),
    ...priceData(product.price),
    variants,
  };
}

function expandMakeupVariantData(parentProduct, detail, options = {}) {
  const { needsVariantDetail: _needsVariantDetail, ...base } = parentProduct || {};
  const includeVariants = options.includeVariants !== false;
  const includeBarcodes = Boolean(options.includeBarcodes);
  const barcode = includeBarcodes ? normalizeBarcode(detail?.barcode) : '';
  const barcodeQuery = normalizeBarcode(options.barcodeQuery);
  const makePriceFields = (currentValue, oldValue) => {
    const currentPrice = Number(currentValue);
    const oldPrice = Number(oldValue);
    const hasCurrent = Number.isFinite(currentPrice) && currentPrice > 0;
    const onSale = hasCurrent && Number.isFinite(oldPrice) && oldPrice > currentPrice;
    return {
      currentPrice: hasCurrent ? currentPrice : null,
      priceWithDiscount: onSale ? currentPrice : null,
      priceWithoutDiscount: onSale ? oldPrice : (hasCurrent ? currentPrice : null),
      onSale,
    };
  };

  if (barcodeQuery && detail?.hasVariants) {
    const exactVariant = (detail.variants || []).find((variant) => (
      String(variant?.id || '') === String(detail?.barcodeVariantId || '')
    ));
    const prices = makePriceFields(exactVariant?.current, exactVariant?.old);
    if (!exactVariant || exactVariant.inStock !== true || prices.currentPrice === null) return [];
    const region = exactVariant.region === 'eu' ? ' · ЄС' : '';
    return [{
      ...base,
      name: detail?.name || base.name,
      brand: detail?.brand || base.brand,
      variant: `${exactVariant.title}${region}`,
      ...prices,
      available: true,
      barcode: barcodeQuery,
      url: `${String(base.url || '').replace(/#.*$/, '')}#/option/${encodeURIComponent(exactVariant.id)}/`,
      image: exactVariant.image || base.image,
    }];
  }

  if (!includeVariants || !detail?.hasVariants) {
    const exactDefault = !includeVariants && includeBarcodes && detail?.hasVariants;
    const prices = makePriceFields(
      exactDefault ? detail?.defaultVariantPrice?.current : detail?.current,
      exactDefault ? detail?.defaultVariantPrice?.old : detail?.old,
    );
    const inStock = exactDefault ? detail?.defaultVariantInStock : detail?.inStock;
    if (inStock === false || prices.currentPrice === null) return [];
    const defaultRegion = detail?.defaultVariantRegion === 'eu' ? ' · ЄС' : '';
    return [{
      ...base,
      name: detail?.name || base.name,
      brand: detail?.brand || base.brand,
      ...(exactDefault && detail?.defaultVariantTitle
        ? { variant: `${detail.defaultVariantTitle}${defaultRegion}` }
        : {}),
      ...prices,
      available: true,
      ...(includeBarcodes ? { barcode } : {}),
    }];
  }

  const rows = [];
  for (const variant of detail.variants || []) {
    const prices = makePriceFields(variant?.current, variant?.old);
    if (!variant?.id || !variant?.title || variant?.inStock !== true || prices.currentPrice === null) continue;
    const region = variant.region === 'eu' ? ' · ЄС' : '';
    rows.push({
      ...base,
      name: detail?.name || base.name,
      brand: detail?.brand || base.brand,
      variant: `${variant.title}${region}`,
      ...prices,
      available: true,
      ...(includeBarcodes ? {
        barcode: String(variant.id) === String(detail?.defaultVariantId || '') ? barcode : '',
      } : {}),
      url: `${String(base.url || '').replace(/#.*$/, '')}#/option/${encodeURIComponent(variant.id)}/`,
      image: variant.image || base.image,
    });
  }
  return deduplicateProducts(rows);
}

async function findMakeupBarcodeVariant(productId, variants, expectedBarcode, request = fetch) {
  const cleanBarcode = (value) => String(value ?? '').replace(/[\s-]+/g, '');
  const expected = cleanBarcode(expectedBarcode);
  if (!productId || !expected) return '';

  const candidates = (variants || [])
    .filter((variant) => variant?.id && variant?.inStock === true)
    .sort((left, right) => Number(left?.region === 'eu') - Number(right?.region === 'eu'));

  for (let offset = 0; offset < candidates.length; offset += 4) {
    const batch = candidates.slice(offset, offset + 4);
    const matches = await Promise.all(batch.map(async (variant) => {
      try {
        const url = new URL(`/shop/v1/products/${encodeURIComponent(productId)}/`, location.origin);
        url.searchParams.set('variant', String(variant.id));
        const response = await request(url.href, {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });
        if (!response?.ok) return '';
        const product = await response.json();
        return cleanBarcode(product?.meta?.gtin13) === expected ? String(variant.id) : '';
      } catch (_error) {
        return '';
      }
    }));
    const match = matches.find(Boolean);
    if (match) return match;
  }
  return '';
}

function extractEvaVariants(parentProduct) {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const numericPrice = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const exactVariantUrl = (value) => {
    try {
      const url = new URL(parentProduct?.url || location.href, location.origin);
      url.searchParams.set('variant', String(value));
      return url.href;
    } catch (_error) {
      return parentProduct?.url || '';
    }
  };
  const decodeNuxtPayload = (serialized) => {
    const raw = JSON.parse(serialized || '[]');
    const cache = new Map();
    const wrappers = new Set([
      'Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'Readonly', 'ShallowReadonly',
    ]);
    const specialValues = new Map([
      [-1, undefined], [-2, Number.NaN], [-3, Number.POSITIVE_INFINITY],
      [-4, Number.NEGATIVE_INFINITY], [-5, -0], [-6, undefined],
    ]);

    const hydrate = (reference) => {
      if (typeof reference !== 'number') return reference;
      if (reference < 0) return specialValues.get(reference);
      if (cache.has(reference)) return cache.get(reference);

      const value = raw[reference];
      if (value === null || typeof value !== 'object') {
        cache.set(reference, value);
        return value;
      }

      if (Array.isArray(value) && typeof value[0] === 'string') {
        if (wrappers.has(value[0])) {
          const result = hydrate(value[1]);
          cache.set(reference, result);
          return result;
        }
        if (value[0] === 'EmptyRef') {
          let result = null;
          try { result = JSON.parse(hydrate(value[1])); } catch (_error) { /* empty ref */ }
          cache.set(reference, result);
          return result;
        }
      }

      const result = Array.isArray(value) ? [] : {};
      cache.set(reference, result);
      if (Array.isArray(value)) {
        for (const item of value) result.push(hydrate(item));
      } else {
        for (const [key, nested] of Object.entries(value)) result[key] = hydrate(nested);
      }
      return result;
    };

    return hydrate(0);
  };

  let payload;
  try {
    payload = decodeNuxtPayload(document.querySelector('#__NUXT_DATA__')?.textContent || '[]');
  } catch (_error) {
    return [];
  }

  const product = payload?.pinia?.product?.product;
  const swatches = product?.swatches;
  const configuration = swatches?.configuration_info;
  if (!configuration || typeof configuration !== 'object') return [];

  const labelsByValue = new Map();
  for (const item of Array.isArray(swatches?.items) ? swatches.items : []) {
    const group = clean(item?.label);
    for (const option of Array.isArray(item?.options) ? item.options : []) {
      labelsByValue.set(String(option?.value), {
        label: clean(option?.label),
        group,
        available: option?.is_in_stock !== false,
      });
    }
  }

  const variants = [];
  for (const [value, child] of Object.entries(configuration)) {
    const option = labelsByValue.get(String(value));
    const currentPrice = numericPrice(child?.final_price);
    const originalPrice = numericPrice(child?.price);
    const available = currentPrice !== null
      && child?.is_in_stock !== false
      && option?.available !== false;
    if (!available) continue;

    const onSale = originalPrice !== null && originalPrice > currentPrice;
    const variantLabel = option?.label || clean(child?.sku) || String(value);
    variants.push({
      ...parentProduct,
      name: clean(parentProduct?.name) || clean(product?.name) || clean(child?.name),
      brand: clean(parentProduct?.brand) || clean(product?.brand),
      variant: option?.group ? `${option.group}: ${variantLabel}` : variantLabel,
      priceWithDiscount: onSale ? currentPrice : null,
      priceWithoutDiscount: onSale ? originalPrice : currentPrice,
      currentPrice,
      onSale,
      available: true,
      url: exactVariantUrl(value),
      needsVariantDetail: false,
    });
  }

  return variants.sort((left, right) =>
    clean(left.variant).localeCompare(clean(right.variant), 'uk', { numeric: true }),
  );
}

function makeupLoadState() {
  const count = document.querySelectorAll('[data-testid="product-tile"]').length;
  const totalText = document.querySelector('.Products__total')?.textContent || '';
  const total = Number((totalText.match(/\d[\d\s]*/) || ['0'])[0].replace(/\s/g, '')) || 0;
  const button = document.querySelector('.Products__pagination > button');
  return { count, total, hasMore: Boolean(button) };
}

function notinoLoadState() {
  const button = document.querySelector('[data-testid="footer-action-button"]');
  const root = document.querySelector('[data-price-monitor-listing="true"]')
    || button?.parentElement?.parentElement
    || document;
  const count = [...root.querySelectorAll('[data-testid="product-container"]')]
    .filter((card) => card.querySelector('[data-testid="product-card-name"]')).length;
  const loadMore = root.querySelector('[data-testid="footer-action-button"]');
  return {
    count,
    hasMore: Boolean(loadMore && !loadMore.disabled && loadMore.getAttribute('aria-disabled') !== 'true'),
  };
}

function extractNotinoVariants(parentProduct) {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const absoluteUrl = (value) => {
    try { return new URL(value, location.origin).href; } catch (_error) { return ''; }
  };
  const numericPrice = (value) => {
    const raw = value && typeof value === 'object' ? value.value : value;
    const number = Number(raw);
    return Number.isFinite(number) ? number : null;
  };
  const variants = new Map();
  const seen = new WeakSet();

  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 14 || seen.has(value)) return;
    seen.add(value);

    if (value.__typename === 'CatalogVariant') {
      const currentPrice = numericPrice(value.price);
      const originalPrice = numericPrice(value.originalPrice);
      const state = clean(value.availability?.state);
      const stock = clean(value.availability?.stockAvailability || value.stockAvailability?.code);
      const available = currentPrice !== null
        && (!state || state === 'CanBeBought')
        && !/outofstock|unavailable|none|watchdog/i.test(`${state} ${stock}`);
      const url = absoluteUrl(value.url);

      if (available && url) {
        const onSale = originalPrice !== null && originalPrice > currentPrice;
        const percentage = Number(parentProduct?.promoDiscountPercent);
        const promoPrice = parentProduct?.promoCode
          && Number.isFinite(percentage) && percentage > 0 && percentage < 100
          ? Math.round(currentPrice * (1 - percentage / 100) * 100) / 100
          : null;
        variants.set(url, {
          ...parentProduct,
          name: clean(parentProduct?.name) || clean(value.name),
          brand: clean(value.brand?.name) || clean(parentProduct?.brand),
          variant: clean(value.additionalInfo),
          priceWithDiscount: onSale ? currentPrice : null,
          priceWithoutDiscount: onSale ? originalPrice : currentPrice,
          currentPrice,
          onSale,
          available: true,
          promoPrice,
          url,
          needsVariantDetail: false,
        });
      }
    }

    for (const nested of Object.values(value)) visit(nested, depth + 1);
  };

  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    try { visit(JSON.parse(script.textContent || '{}')); } catch (_error) { /* ignore invalid state */ }
  }

  return [...variants.values()].sort((left, right) =>
    clean(left.variant).localeCompare(clean(right.variant), 'uk', { numeric: true }),
  );
}

function catalogLoadState(store) {
  if (store === 'eva') {
    const listing = document.querySelector('[data-testid="o-listing"]') || document;
    return {
      cards: listing.querySelectorAll(
        '[data-testid="product-card-simple"], [data-testid="product-card-configurable"]',
      ).length,
      priced: listing.querySelectorAll('[data-testid="product-final-price"], [data-testid="product-price"]').length,
    };
  }
  if (store === 'makeup') {
    return {
      cards: document.querySelectorAll('[data-testid="product-tile"]').length,
      priced: document.querySelectorAll('.Price__priceCurrent').length,
    };
  }
  if (store === 'notino') {
    return {
      cards: document.querySelectorAll('[data-testid="product-container"] [data-testid="product-card-name"]').length,
      priced: document.querySelectorAll('[data-testid="product-container"] [data-testid="price-component"]').length,
    };
  }
  if (store === 'rozetka') {
    return {
      cards: document.querySelectorAll('main article a.tile-title').length,
      priced: document.querySelectorAll('main article rz-tile-price .price, main article .price').length,
    };
  }
  if (store === 'aurora') {
    return {
      cards: document.querySelectorAll('form[name^="product_form_"] a.product-title').length,
      priced: document.querySelectorAll('form[name^="product_form_"] [id^="sec_discounted_price_"]').length,
    };
  }
  return {
    cards: document.querySelectorAll('.products__grid .sf-product-card__block').length,
    priced: document.querySelectorAll('.products__grid .sf-price__regular, .products__grid .sf-price__special').length,
  };
}

function withPage(baseUrl, store, page) {
  const url = new URL(baseUrl);
  url.searchParams.set(store === 'eva' ? 'p' : 'page', String(page));
  return url.href;
}

function uniqueBrands(brands) {
  const result = new Map();
  for (const brand of brands || []) {
    const name = String(brand?.name || '').replace(/\s+/g, ' ').trim();
    const url = String(brand?.url || '').trim();
    if (!name || !url) continue;
    const key = normalizeText(name);
    const current = result.get(key);
    if (!current || name.length < current.name.length) result.set(key, { name, url });
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name, 'uk'));
}

function rankBrands(brands, query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];
  return (brands || [])
    .map((item) => ({ item, score: similarity(normalizedQuery, normalizeText(item.name)) }))
    .filter((entry) => entry.score > 0.2)
    .sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length);
}

function similarity(query, candidate) {
  if (!query || !candidate) return 0;
  if (query === candidate) return 1;
  if (candidate.startsWith(query)) return 0.94 - Math.min(0.12, (candidate.length - query.length) / 100);
  if (candidate.includes(query)) return 0.86 - Math.min(0.12, (candidate.length - query.length) / 100);
  if (query.includes(candidate)) return 0.8 - Math.min(0.12, (query.length - candidate.length) / 100);
  const distance = levenshtein(query, candidate);
  return 1 - distance / Math.max(query.length, candidate.length);
}

function levenshtein(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[’`´]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLocaleLowerCase('uk');
}

function normalizeBarcode(value) {
  const barcode = String(value ?? '').replace(/[\s-]+/g, '');
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(barcode)) return '';

  const data = barcode.slice(0, -1);
  let sum = 0;
  for (let index = data.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += Number(data[index]) * (position % 2 === 0 ? 3 : 1);
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number(barcode.at(-1)) ? barcode : '';
}

function looksLikeBarcodeInput(value) {
  const compact = String(value ?? '').replace(/[\s-]+/g, '');
  return /^\d+$/.test(compact) && [8, 12, 13, 14].includes(compact.length);
}

function expandAuroraProducts(products) {
  const expanded = [];
  for (const product of products || []) {
    const {
      variantOptions = [], needsVariantDetail = false,
      ...base
    } = product || {};
    if (variantOptions.length) {
      for (const option of variantOptions) {
        expanded.push({
          ...base,
          variant: option.variant || 'Варіант без назви',
          url: option.url || base.url,
          image: option.image || base.image,
        });
      }
      continue;
    }
    if (needsVariantDetail || /(?:в асортименті|\bмікс\b)/i.test(String(base.name || ''))) {
      expanded.push({ ...base, variant: 'Асортимент — точний варіант сайт не вказує' });
      continue;
    }
    expanded.push(base);
  }
  return deduplicateProducts(expanded);
}

function deduplicateProducts(products) {
  const unique = new Map();
  for (const product of products || []) {
    if (!product?.name) continue;
    const baseKey = product.url || `${normalizeText(product.brand)}:${normalizeText(product.name)}`;
    const key = product.seller ? `${baseKey}:${normalizeText(product.seller)}` : baseKey;
    unique.set(key, product);
  }
  return [...unique.values()];
}

function parseSupportedUrl(value, expectedHost) {
  try {
    const url = new URL(String(value).trim());
    const host = url.hostname.replace(/^www\./, '');
    return host === expectedHost ? url.href : null;
  } catch (_error) {
    return null;
  }
}

function brandNameFromUrl(value) {
  try {
    const url = new URL(value);
    const lastPart = url.pathname.split('/').filter(Boolean).pop() || 'brand';
    return decodeURIComponent(lastPart).replace(/^brnd-\d+$/, 'brand').replace(/[-_]+/g, ' ');
  } catch (_error) {
    return 'brand';
  }
}

function validateStore(store) {
  if (!STORES[store]) throw new Error('Невідомий магазин.');
}

function friendlyError(error) {
  const message = String(error?.message || error || 'Невідома помилка');
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|internet|network/i.test(message)) {
    return 'Немає з’єднання із сайтом. Перевірте інтернет і повторіть спробу.';
  }
  if (/ERR_CONNECTION|ERR_TIMED_OUT|надто довго|timeout/i.test(message)) {
    return 'Магазин надто довго відповідає. Повторіть спробу трохи пізніше.';
  }
  if (/captcha|cloudflare|access denied|403/i.test(message)) {
    return 'Магазин тимчасово обмежив автоматичне завантаження. Повторіть спробу пізніше.';
  }
  return message;
}

function isRetryableLoadError(error) {
  const message = String(error?.message || error || '');
  return /Каталог не завантажився|довго не відповідає|ERR_|ENOTFOUND|network|timeout|timed out|connection/i.test(message);
}

function safeDestroy(browser) {
  if (browser && !browser.isDestroyed()) browser.destroy();
}

async function waitFor(check, timeoutMs, throwOnTimeout = true) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      if (error?.code === 'CANCELLED') throw error;
      lastError = error;
    }
    await delay(250);
  }
  if (!throwOnTimeout) return null;
  throw lastError || new Error('Час очікування відповіді сайту минув.');
}

function promiseWithTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  PriceScraper,
  STORES,
  normalizeText,
  normalizeBarcode,
  looksLikeBarcodeInput,
  rankBrands,
  expandAuroraProducts,
  expandMakeupVariantData,
  findMakeupBarcodeVariant,
  deduplicateProducts,
  isRetryableLoadError,
};
