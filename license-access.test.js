const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LicensedAccessStore, stableStringify } = require('./license-access');

const DEVICE_ID = 'a'.repeat(64);

function signLicense(privateKey, overrides = {}) {
  const payload = {
    schemaVersion: 1,
    licenseId: 'test-license-2026-10',
    customerName: 'Тестова ліцензія',
    edition: 'licensed',
    status: 'active',
    issuedAt: '2026-10-04T00:00:00.000Z',
    notBefore: '2026-10-04T00:00:00.000Z',
    expiresAt: '2026-10-31T21:59:59.999Z',
    maxDevices: 1,
    deviceId: DEVICE_ID,
    stores: ['eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka'],
    updateChannel: 'licensed',
    ...overrides,
  };
  if (overrides.deviceId === null) delete payload.deviceId;
  const signature = crypto.sign(
    null,
    Buffer.from(stableStringify(payload), 'utf8'),
    privateKey,
  ).toString('base64');
  return { payload, signature };
}

function withLicensedStore(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-license-'));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPath = path.join(directory, 'license-public.pem');
  const bundledLicensePath = path.join(directory, 'paid-license.json');
  const licensePath = path.join(directory, 'profile', 'license.json');
  const statePath = path.join(directory, 'profile', 'license-state.dat');
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  fs.writeFileSync(bundledLicensePath, JSON.stringify(signLicense(privateKey)));
  let now = Date.parse('2026-10-04T12:00:00.000Z');
  const create = (options = {}) => new LicensedAccessStore({
    edition: 'licensed',
    publicKeyPath,
    bundledLicensePath,
    licensePath,
    statePath,
    now: () => now,
    deviceIdProvider: () => DEVICE_ID,
    ...options,
  });
  const clean = () => fs.rmSync(directory, { recursive: true, force: true });
  let result;
  try {
    result = run({
      create,
      privateKey,
      bundledLicensePath,
      licensePath,
      statePath,
      getNow: () => now,
      setNow: (value) => { now = value; },
    });
  } catch (error) {
    clean();
    throw error;
  }
  if (result && typeof result.then === 'function') return result.finally(clean);
  clean();
  return result;
}

test('licensed edition installs and verifies the bundled offline license', () => {
  withLicensedStore(({ create, licensePath }) => {
    const status = create().getStatus();
    assert.equal(status.allowed, true);
    assert.equal(status.isLicensed, true);
    assert.equal(status.customerName, 'Тестова ліцензія');
    assert.equal(status.maxDevices, 1);
    assert.equal(status.onlineConfigured, false);
    assert.equal(fs.existsSync(licensePath), true);
  });
});

test('licensed edition blocks offline after the signed expiry date', () => {
  withLicensedStore(({ create, setNow }) => {
    const store = create();
    assert.equal(store.getStatus().allowed, true);
    setNow(Date.parse('2026-11-01T00:00:00.000Z'));
    const expired = store.getStatus();
    assert.equal(expired.allowed, false);
    assert.equal(expired.blockedReason, 'time_expired');
    assert.equal(store.beginSearch().allowed, false);
  });
});

test('licensed edition rejects a modified license signature', () => {
  withLicensedStore(({ create, bundledLicensePath }) => {
    const changed = JSON.parse(fs.readFileSync(bundledLicensePath, 'utf8'));
    changed.payload.expiresAt = '2099-12-31T23:59:59.999Z';
    fs.writeFileSync(bundledLicensePath, JSON.stringify(changed));
    const status = create().getStatus();
    assert.equal(status.allowed, false);
    assert.equal(status.blockedReason, 'signature_invalid');
  });
});

test('licensed edition blocks a valid license copied to another computer', () => {
  withLicensedStore(({ create }) => {
    const status = create({ deviceIdProvider: () => 'b'.repeat(64) }).getStatus();
    assert.equal(status.allowed, false);
    assert.equal(status.blockedReason, 'device_mismatch');
    assert.equal(status.deviceCode, 'BBBB-BBBB-BBBB-BBBB');
  });
});

test('licensed edition replaces the previous unbound local preview with the bundled device license', () => {
  withLicensedStore(({ create, privateKey, licensePath }) => {
    fs.mkdirSync(path.dirname(licensePath), { recursive: true });
    fs.writeFileSync(licensePath, JSON.stringify(signLicense(privateKey, { deviceId: null })));
    const status = create().getStatus();
    assert.equal(status.allowed, true);
    const migrated = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
    assert.equal(migrated.payload.deviceId, DEVICE_ID);
  });
});

test('licensed edition detects a system clock rollback', () => {
  withLicensedStore(({ create, setNow }) => {
    const store = create();
    store.getStatus();
    setNow(Date.parse('2026-10-20T12:00:00.000Z'));
    assert.equal(store.getStatus().allowed, true);
    setNow(Date.parse('2026-10-10T12:00:00.000Z'));
    const rolledBack = store.getStatus();
    assert.equal(rolledBack.allowed, false);
    assert.equal(rolledBack.blockedReason, 'clock_rollback');
  });
});

test('server-ready refresh accepts only a newly signed matching license', async () => {
  await withLicensedStore(async ({ create, privateKey, licensePath }) => {
    const renewed = signLicense(privateKey, { expiresAt: '2026-11-30T21:59:59.999Z' });
    const fetchFn = async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.equal(body.licenseId, 'test-license-2026-10');
      assert.equal(body.edition, 'licensed');
      assert.equal(body.deviceId, DEVICE_ID);
      return { ok: true, json: async () => ({ license: renewed }) };
    };
    const store = create({ serverUrl: 'https://license.example.test', fetchFn });
    const result = await store.refreshOnline();
    assert.equal(result.checked, true);
    assert.equal(result.updated, true);
    assert.equal(result.status.expiresAt, '2026-11-30T21:59:59.999Z');
    const saved = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
    assert.equal(saved.payload.expiresAt, '2026-11-30T21:59:59.999Z');
  });
});

test('server probe works before the first license is activated', async () => {
  await withLicensedStore(async ({ create }) => {
    const fetchFn = async (url, request) => {
      assert.equal(url, 'https://license.example.test/health');
      assert.equal(Boolean(request.signal), true);
      return { ok: true, json: async () => ({ ok: true, service: 'price-monitor-license' }) };
    };
    const store = create({ bundledLicensePath: '', serverUrl: 'https://license.example.test', fetchFn });
    assert.equal(store.getStatus().blockedReason, 'license_missing');
    assert.deepEqual(await store.probeServer(), { checked: true, available: true, reason: '' });
  });
});

test('server probe reports an unavailable endpoint without changing local access', async () => {
  await withLicensedStore(async ({ create }) => {
    const store = create({
      serverUrl: 'https://license.example.test',
      fetchFn: async () => { throw new Error('network_down'); },
    });
    const before = store.getStatus();
    assert.deepEqual(await store.probeServer(), { checked: true, available: false, reason: 'server_unavailable' });
    assert.equal(store.getStatus().allowed, before.allowed);
  });
});

test('universal licensed build activates a clean computer without a bundled license', async () => {
  await withLicensedStore(async ({ create, privateKey, licensePath }) => {
    const online = signLicense(privateKey, {
      paidUntil: '2027-01-31T21:59:59.999Z',
      expiresAt: '2026-10-18T21:59:59.999Z',
      features: { all: true, barcodeDatabase: false },
    });
    const fetchFn = async (url, request) => {
      assert.match(url, /\/v1\/licenses\/activate$/);
      const body = JSON.parse(request.body);
      assert.equal(body.activationCode, 'PMAAAAABBBBBCCCCCDDDDD');
      assert.equal(body.deviceId, DEVICE_ID);
      assert.equal(body.installationId.length >= 8, true);
      return { ok: true, json: async () => ({ license: online }) };
    };
    const store = create({ bundledLicensePath: '', serverUrl: 'https://license.example.test', fetchFn });
    assert.equal(store.getStatus().blockedReason, 'license_missing');
    const result = await store.activateOnline('PM-AAAAA-BBBBB-CCCCC-DDDDD');
    assert.equal(result.updated, true);
    assert.equal(result.status.allowed, true);
    assert.equal(result.status.paidUntil, '2027-01-31T21:59:59.999Z');
    assert.equal(result.status.features.barcodeDatabase, false);
    assert.equal(fs.existsSync(licensePath), true);
  });
});

test('offline request carries the full device hash while the interface code stays short', () => {
  withLicensedStore(({ create }) => {
    const store = create({ bundledLicensePath: '' });
    const request = store.getActivationRequest();
    assert.equal(request.deviceId, DEVICE_ID);
    assert.equal(request.deviceId.length, 64);
    assert.equal(request.deviceCode, 'AAAA-AAAA-AAAA-AAAA');
    assert.equal(request.installationId.length >= 8, true);
  });
});

test('offline import accepts only a signed license for the current computer', () => {
  withLicensedStore(({ create, privateKey }) => {
    const store = create({ bundledLicensePath: '' });
    const wrong = store.installLicenseDocument(signLicense(privateKey, { deviceId: 'b'.repeat(64) }));
    assert.equal(wrong.updated, false);
    assert.equal(wrong.reason, 'device_mismatch');
    const correct = store.installLicenseDocument(signLicense(privateKey));
    assert.equal(correct.updated, true);
    assert.equal(correct.status.allowed, true);
  });
});

test('licensed edition enforces the store modules from the signed license', () => {
  withLicensedStore(({ create, privateKey, bundledLicensePath }) => {
    fs.writeFileSync(bundledLicensePath, JSON.stringify(signLicense(privateKey, { stores: ['eva', 'makeup'] })));
    const store = create();
    assert.equal(store.beginSearch({ store: 'eva' }).allowed, true);
    assert.equal(store.authorizeParse('', 'makeup').allowed, true);
    const deniedStart = store.beginSearch({ store: 'rozetka' });
    assert.equal(deniedStart.allowed, false);
    assert.equal(deniedStart.reason, 'store_not_allowed');
    const deniedParse = store.authorizeParse('', 'aurora');
    assert.equal(deniedParse.allowed, false);
    assert.equal(deniedParse.reason, 'store_not_allowed');
  });
});

test('licensed build has a separate Windows identity and data profile', () => {
  const config = fs.readFileSync(path.join(__dirname, 'electron-builder.licensed.yml'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const packageInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.match(config, /appId:\s*com\.vladlen\.retailpricemonitor\.licensed/);
  assert.match(config, /productName:\s*Price Monitor Licensed/);
  assert.match(config, /name:\s*retail-price-monitor-licensed/);
  assert.doesNotMatch(config, /- paid-license\.json/);
  assert.match(config, /priceMonitorBundledLicense:\s*false/);
  assert.match(main, /userDataName:\s*'Price Monitor Licensed'/);
  assert.equal(packageInfo.scripts['dist:licensed'], 'electron-builder --config electron-builder.licensed.yml');
});

test('local server and local client builds have separate identities and profiles', () => {
  const serverConfig = fs.readFileSync(path.join(__dirname, 'electron-builder.server.yml'), 'utf8');
  const clientConfig = fs.readFileSync(path.join(__dirname, 'electron-builder.local-client.yml'), 'utf8');
  const packageInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.match(serverConfig, /appId:\s*com\.vladlen\.pricemonitor\.server/);
  assert.match(serverConfig, /productName:\s*Price Monitor Server/);
  assert.match(serverConfig, /to:\s*license-private\.pem/);
  assert.match(clientConfig, /appId:\s*com\.vladlen\.retailpricemonitor\.localclient/);
  assert.match(clientConfig, /priceMonitorLicenseServerUrl:\s*http:\/\/127\.0\.0\.1:8787/);
  assert.match(clientConfig, /priceMonitorUserDataName:\s*Price Monitor Local Client/);
  assert.doesNotMatch(clientConfig, /license-private\.pem/);
  assert.equal(packageInfo.scripts['dist:server'], 'electron-builder --config electron-builder.server.yml');
  assert.equal(packageInfo.scripts['dist:local-client'], 'electron-builder --config electron-builder.local-client.yml');
});
