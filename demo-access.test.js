const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_LIMITS, DemoAccessStore } = require('./demo-access');

function withStore(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-demo-'));
  let now = Date.parse('2026-10-01T12:00:00Z');
  const filePath = path.join(directory, 'demo-access.dat');
  const create = (edition = 'demo') => new DemoAccessStore({ edition, filePath, now: () => now });
  try {
    run({ create, filePath, getNow: () => now, setNow: (value) => { now = value; } });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('full edition stays unrestricted and does not create demo state', () => {
  withStore(({ create, filePath }) => {
    const store = create('full');
    assert.equal(store.getStatus().isDemo, false);
    assert.equal(store.beginSearch({ brandCount: 500 }).allowed, true);
    assert.equal(fs.existsSync(filePath), false);
  });
});

test('demo starts with visible time, search and scope limits', () => {
  withStore(({ create }) => {
    const status = create().getStatus();
    assert.equal(status.allowed, true);
    assert.equal(status.daysRemaining, DEFAULT_LIMITS.days);
    assert.equal(status.searchesRemaining, DEFAULT_LIMITS.searches);
    assert.equal(status.maxBrands, 3);
    assert.equal(status.maxResults, 1000);
  });
});

test('demo rejects oversized brand batches before a search starts', () => {
  withStore(({ create }) => {
    const store = create();
    const rejected = store.beginSearch({ brandCount: 4 });
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.reason, 'brand_limit');
    assert.equal(store.getStatus().searchesRemaining, 20);
  });
});

test('demo counts only a search that delivered rows', () => {
  withStore(({ create }) => {
    const store = create();
    const empty = store.beginSearch({ brandCount: 1 });
    assert.equal(store.authorizeParse(empty.token).allowed, true);
    store.limitParseResult(empty.token, { products: [] });
    assert.equal(store.finishSearch(empty.token).counted, false);
    assert.equal(store.getStatus().searchesRemaining, 20);

    const useful = store.beginSearch({ brandCount: 1 });
    assert.equal(store.authorizeParse(useful.token).allowed, true);
    store.limitParseResult(useful.token, { products: [{ name: 'Товар' }] });
    assert.equal(store.finishSearch(useful.token).counted, true);
    assert.equal(store.getStatus().searchesRemaining, 19);
  });
});

test('demo enforces one shared 1000-row cap across brands', () => {
  withStore(({ create }) => {
    const store = create();
    const session = store.beginSearch({ brandCount: 2 });
    assert.equal(store.authorizeParse(session.token).allowed, true);
    const first = store.limitParseResult(session.token, { products: Array.from({ length: 800 }, (_, id) => ({ id })) });
    assert.equal(first.products.length, 800);
    assert.equal(store.authorizeParse(session.token).allowed, true);
    const second = store.limitParseResult(session.token, { products: Array.from({ length: 500 }, (_, id) => ({ id })) });
    assert.equal(second.products.length, 200);
    assert.equal(second.demoLimitReached, true);
    assert.equal(store.finishSearch(session.token).deliveredRows, 1000);
  });
});

test('demo counter survives a new application instance and clock rollback', () => {
  withStore(({ create, getNow, setNow }) => {
    const first = create();
    const session = first.beginSearch({ brandCount: 1 });
    first.authorizeParse(session.token);
    first.limitParseResult(session.token, { products: [{ name: 'Товар' }] });
    first.finishSearch(session.token);

    setNow(getNow() + 5 * 24 * 60 * 60 * 1000);
    assert.equal(create().getStatus().daysRemaining, 9);
    setNow(getNow() - 3 * 24 * 60 * 60 * 1000);
    const rolledBack = create().getStatus();
    assert.equal(rolledBack.daysRemaining, 9);
    assert.equal(rolledBack.searchesRemaining, 19);
  });
});

test('demo blocks new searches after the time or count limit', () => {
  withStore(({ create, getNow, setNow }) => {
    const store = create();
    for (let index = 0; index < 20; index += 1) {
      const session = store.beginSearch({ brandCount: 1 });
      store.authorizeParse(session.token);
      store.limitParseResult(session.token, { products: [{ name: String(index) }] });
      store.finishSearch(session.token);
    }
    assert.equal(store.getStatus().blockedReason, 'search_limit');
    assert.equal(store.beginSearch({ brandCount: 1 }).allowed, false);

    const anotherDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-demo-time-'));
    try {
      const timed = new DemoAccessStore({ edition: 'demo', filePath: path.join(anotherDirectory, 'state.dat'), now: () => getNow() });
      timed.getStatus();
      setNow(getNow() + 14 * 24 * 60 * 60 * 1000);
      assert.equal(timed.getStatus().blockedReason, 'time_expired');
    } finally {
      fs.rmSync(anotherDirectory, { recursive: true, force: true });
    }
  });
});

test('demo build keeps a separate identity and exposes the counter API', () => {
  const config = fs.readFileSync(path.join(__dirname, 'electron-builder.demo.yml'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
  assert.match(config, /appId:\s*com\.vladlen\.retailpricemonitor\.demo/);
  assert.match(config, /productName:\s*Price Monitor Demo/);
  assert.match(main, /Price Monitor Demo/);
  assert.match(preload, /access:status/);
  assert.match(preload, /access:begin-search/);
  assert.match(preload, /access:finish-search/);
  assert.match(html, /id="demo-access-banner"/);
  assert.match(renderer, /function updateAccessUi/);
});
