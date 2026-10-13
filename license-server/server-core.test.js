const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const test = require('node:test');
const { LicenseService, normalizeLicenseInput } = require('./server-core');
const { LocalLicenseStore } = require('./local-store');
const { createNodeCrypto } = require('./crypto-node');
const { validateSignedLicense } = require('../license-access');

const DEVICE_A = 'a'.repeat(64);
const DEVICE_B = 'b'.repeat(64);
const DEVICE_C = 'c'.repeat(64);
const NOW = Date.parse('2026-10-06T12:00:00.000Z');

test('online activation binds devices, enforces the limit and returns a signed lease', async () => {
  await withService(async ({ service, store, publicKey }) => {
    await seedLicense(store, { maxDevices: 2 });
    const first = await service.activate(request('PM-AAAAA-BBBBB-CCCCC-DDDDD', DEVICE_A, 'install-a'));
    const second = await service.activate(request('PM-AAAAA-BBBBB-CCCCC-DDDDD', DEVICE_B, 'install-b'));
    assert.equal(validateSignedLicense(first.license, publicKey).valid, true);
    assert.equal(first.license.payload.deviceId, DEVICE_A);
    assert.equal(first.license.payload.paidUntil, '2027-01-31T21:59:59.999Z');
    assert.equal(first.license.payload.expiresAt, '2026-10-20T12:00:00.000Z');
    assert.equal(second.license.payload.deviceId, DEVICE_B);
    await assert.rejects(
      service.activate(request('PM-AAAAA-BBBBB-CCCCC-DDDDD', DEVICE_C, 'install-c')),
      (error) => error.code === 'device_limit' && error.status === 409,
    );
  });
});

test('repeat activation of the same computer does not consume a second seat', async () => {
  await withService(async ({ service, store }) => {
    await seedLicense(store, { maxDevices: 1 });
    await service.activate(request('PM-AAAAA-BBBBB-CCCCC-DDDDD', DEVICE_A, 'install-a'));
    await service.activate(request('PM-AAAAA-BBBBB-CCCCC-DDDDD', DEVICE_A, 'install-a-new'));
    const devices = await store.listDevices('lic_test_2026');
    assert.equal(devices.length, 1);
    assert.equal(devices[0].installationId, 'install-a-new');
  });
});

test('daily check renews the local lease and carries flexible policy fields', async () => {
  await withService(async ({ service, store }) => {
    await seedLicense(store, {
      maxDevices: 3,
      stores: ['eva', 'makeup'],
      features: { variants: true, barcodeDatabase: false, resultLimit: 5000 },
    });
    const activated = await service.activate(request('PM-AAAAA-BBBBB-CCCCC-DDDDD', DEVICE_A, 'install-a'));
    const checked = await service.check({
      licenseId: activated.license.payload.licenseId,
      deviceId: DEVICE_A,
      installationId: 'install-a',
      appVersion: '4.19.0',
    });
    assert.deepEqual(checked.license.payload.stores, ['eva', 'makeup']);
    assert.equal(checked.license.payload.features.resultLimit, 5000);
    assert.equal(checked.policy.leaseDays, 14);
  });
});

test('revocation is returned as a signed blocked license', async () => {
  await withService(async ({ service, store, publicKey }) => {
    await seedLicense(store);
    await service.activate(request('PM-AAAAA-BBBBB-CCCCC-DDDDD', DEVICE_A, 'install-a'));
    await store.updateLicense('lic_test_2026', { status: 'revoked' });
    const result = await service.check({ licenseId: 'lic_test_2026', deviceId: DEVICE_A, installationId: 'install-a' });
    assert.equal(result.license.payload.status, 'revoked');
    assert.equal(validateSignedLicense(result.license, publicKey).valid, true);
  });
});

test('removed device frees a seat', async () => {
  await withService(async ({ service, store }) => {
    await seedLicense(store, { maxDevices: 1 });
    await service.activate(request('PM-AAAAA-BBBBB-CCCCC-DDDDD', DEVICE_A, 'install-a'));
    assert.equal(await store.removeDevice('lic_test_2026', DEVICE_A), true);
    const result = await service.activate(request('PM-AAAAA-BBBBB-CCCCC-DDDDD', DEVICE_B, 'install-b'));
    assert.equal(result.license.payload.deviceId, DEVICE_B);
  });
});

async function withService(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-server-'));
  try {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
    const provider = createNodeCrypto(privatePem);
    const store = new LocalLicenseStore(path.join(directory, 'db.json'));
    const service = new LicenseService({ store, ...provider, now: () => NOW });
    await callback({ service, store, provider, publicKey: publicPem });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function seedLicense(store, overrides = {}) {
  const provider = createNodeCrypto(crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const activationCode = 'PMAAAAABBBBBCCCCCDDDDD';
  const activationHash = await provider.hashActivationCode(activationCode);
  return store.createLicense({
    id: 'lic_test_2026',
    ...normalizeLicenseInput({
      customerName: 'Тестовий клієнт',
      paidUntil: '2027-01-31T23:59:59.999+02:00',
      maxDevices: overrides.maxDevices || 1,
      leaseDays: overrides.leaseDays || 14,
      stores: overrides.stores,
      features: overrides.features,
    }, NOW),
    activationHash,
    activationHint: 'DDDDD',
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
  });
}

function request(activationCode, deviceId, installationId) {
  return { activationCode, deviceId, installationId, appVersion: '4.19.0' };
}
