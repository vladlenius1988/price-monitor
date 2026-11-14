const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');
const { PriceScraper } = require('../../scraper');
const { StoreHealthMonitor, STORE_ORDER } = require('../../license-server/store-health-monitor');

const testData = path.resolve(process.env.PRICE_MONITOR_HEALTH_TEST_DATA || path.join(os.tmpdir(), 'price-monitor-health-electron'));
const resultFile = path.resolve(process.env.PRICE_MONITOR_HEALTH_RESULT || path.join(testData, 'result.json'));
fs.mkdirSync(path.dirname(resultFile), { recursive: true });
app.setPath('userData', testData);

function finish(payload, exitCode = 0) {
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, JSON.stringify(payload, null, 2), 'utf8');
  process.exitCode = exitCode;
}

app.whenReady().then(async () => {
  const keeper = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const scraper = new PriceScraper({ BrowserWindow, cacheFile: path.join(testData, 'brands-cache.json') });
  try {
    const monitor = new StoreHealthMonitor({
      stateFile: path.join(testData, 'health.json'),
      checkStore: async ({ store, query }) => {
        const result = await scraper.parseBrand(store, query, () => {}, { healthCheck: true });
        return { productCount: result.products.length };
      },
    });
    const result = await monitor.run();
    const failed = result.results.filter((item) => item.status !== 'ok');
    const payload = { ok: failed.length === 0 && result.results.length === STORE_ORDER.length, result };
    finish(payload, payload.ok ? 0 : 1);
  } catch (error) {
    finish({ ok: false, error: error?.message || String(error) }, 1);
  } finally {
    scraper.cancel();
    keeper.destroy();
    app.quit();
  }
});
