const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  StoreHealthMonitor, STORE_ORDER, DEFAULT_STORE_PROBES, DEFAULT_INTERVAL_MS, safeErrorCode,
} = require('./store-health-monitor');

test('checks one primary query and uses the two fallbacks only when needed', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-health-'));
  const calls = [];
  let now = Date.parse('2026-11-14T10:00:00.000Z');
  const monitor = new StoreHealthMonitor({
    stateFile: path.join(directory, 'health.json'),
    now: () => now,
    checkStore: async ({ store, query }) => {
      calls.push([store, query]);
      now += 1_000;
      if (store !== 'varus') return { productCount: 2 };
      if (query === DEFAULT_STORE_PROBES.varus[0]) throw new Error('network failed');
      if (query === DEFAULT_STORE_PROBES.varus[1]) return { productCount: 0 };
      return { productCount: 1 };
    },
  });

  const result = await monitor.run();
  assert.equal(result.running, false);
  assert.equal(result.results.length, STORE_ORDER.length);
  assert.ok(result.results.every((item) => item.status === 'ok'));
  assert.deepEqual(calls.filter(([store]) => store === 'varus').map(([, query]) => query), DEFAULT_STORE_PROBES.varus);
  assert.equal(result.results.find((item) => item.store === 'varus').successfulAttempt, 3);
  assert.equal(calls.length, STORE_ORDER.length + 2);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('persists failures, schedule and enabled state without storing arbitrary errors', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-health-state-'));
  const stateFile = path.join(directory, 'health.json');
  let now = Date.parse('2026-11-14T12:00:00.000Z');
  const monitor = new StoreHealthMonitor({
    stateFile,
    now: () => now,
    checkStore: async ({ store }) => {
      if (store === 'notino') throw new Error('secret server text must not be persisted');
      return { productCount: 1 };
    },
  });
  const result = await monitor.run();
  const notino = result.results.find((item) => item.store === 'notino');
  assert.equal(notino.status, 'error');
  assert.equal(notino.attempts.length, 3);
  assert.ok(notino.attempts.every((item) => item.errorCode === 'unknown_error'));
  assert.doesNotMatch(fs.readFileSync(stateFile, 'utf8'), /secret server text/);
  assert.equal(result.due, false);

  now += DEFAULT_INTERVAL_MS + 1;
  assert.equal(monitor.snapshot().due, true);
  monitor.setEnabled(false);
  const restored = new StoreHealthMonitor({ stateFile, now: () => now, checkStore: async () => ({ productCount: 1 }) });
  assert.equal(restored.snapshot().enabled, false);
  assert.equal(restored.snapshot().due, false);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('maps only safe operational failure categories', () => {
  assert.equal(safeErrorCode(new Error('Notino не підтвердив доступ')), 'access_check');
  assert.equal(safeErrorCode(new Error('net::ERR_CONNECTION_RESET')), 'network_error');
  assert.equal(safeErrorCode(Object.assign(new Error('anything'), { code: 'TIMEOUT' })), 'timeout');
});
