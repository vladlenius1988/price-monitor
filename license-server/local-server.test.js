const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LicensedAccessStore } = require('../license-access');
const { startLocalLicenseServer } = require('./local-server');

const ADMIN_TOKEN = 'test-admin-token-2026';
const DEVICE_ID = 'c'.repeat(64);

test('local server creates, activates, refreshes and manages a real client license', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-local-server-'));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privateKeyPath = path.join(directory, 'license-private.pem');
  const publicKeyPath = path.join(directory, 'license-public.pem');
  fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));

  const instance = await startLocalLicenseServer({
    port: 0,
    adminToken: ADMIN_TOKEN,
    dataPath: path.join(directory, 'license-data.json'),
    privateKeyPath,
  });

  try {
    const health = await fetch(`${instance.baseUrl}/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const created = await adminRequest(instance.adminBaseUrl, '/admin/api/licenses', {
      method: 'POST',
      body: {
        customerName: 'Локальний тестовий клієнт',
        paidUntil: '2099-12-31T21:59:59.999Z',
        maxDevices: 2,
        leaseDays: 14,
        stores: ['eva', 'makeup'],
        status: 'active',
      },
    });
    assert.match(created.activationCode, /^PM(?:-[A-Z0-9]{5}){8}$/);
    assert.deepEqual(created.license.stores, ['eva', 'makeup']);

    const accessStore = new LicensedAccessStore({
      edition: 'licensed',
      licensePath: path.join(directory, 'client', 'license.json'),
      statePath: path.join(directory, 'client', 'license-state.dat'),
      publicKeyPath,
      serverUrl: instance.baseUrl,
      appVersion: '4.21.0',
      deviceIdProvider: () => DEVICE_ID,
    });
    const activated = await accessStore.activateOnline(created.activationCode);
    assert.equal(activated.updated, true);
    assert.equal(activated.status.allowed, true);
    assert.deepEqual(activated.status.stores, ['eva', 'makeup']);
    assert.equal(accessStore.beginSearch({ store: 'eva' }).allowed, true);
    assert.equal(accessStore.beginSearch({ store: 'rozetka' }).reason, 'store_not_allowed');

    await adminRequest(instance.adminBaseUrl, `/admin/api/licenses/${encodeURIComponent(created.license.id)}`, {
      method: 'PATCH',
      body: { stores: ['eva', 'rozetka'], leaseDays: 7 },
    });
    const refreshed = await accessStore.refreshOnline();
    assert.equal(refreshed.updated, true);
    assert.deepEqual(refreshed.status.stores, ['eva', 'rozetka']);
    assert.equal(accessStore.beginSearch({ store: 'makeup' }).reason, 'store_not_allowed');
    assert.equal(accessStore.authorizeParse('', 'rozetka').allowed, true);

    const overview = await adminRequest(instance.adminBaseUrl, '/admin/api/overview');
    assert.equal(overview.licenses.length, 1);
    assert.equal(overview.licenses[0].devices.length, 1);
    assert.equal(overview.licenses[0].devices[0].appVersion, '4.21.0');
    assert.equal(overview.eventCount >= 2, true);
  } finally {
    await instance.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('local server rejects the owner API without the admin token', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-local-server-auth-'));
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const privateKeyPath = path.join(directory, 'license-private.pem');
  fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const instance = await startLocalLicenseServer({
    port: 0,
    adminToken: ADMIN_TOKEN,
    dataPath: path.join(directory, 'license-data.json'),
    privateKeyPath,
  });
  try {
    const response = await fetch(`${instance.adminBaseUrl}/admin/api/overview`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'admin_unauthorized');
  } finally {
    await instance.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('public listener never exposes the owner panel and pending activation becomes live after approval', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-pending-server-'));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privateKeyPath = path.join(directory, 'license-private.pem');
  const publicKeyPath = path.join(directory, 'license-public.pem');
  fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  const instance = await startLocalLicenseServer({
    port: 0, adminToken: ADMIN_TOKEN, dataPath: path.join(directory, 'license-data.json'), privateKeyPath,
  });
  try {
    assert.equal((await fetch(`${instance.baseUrl}/admin`)).status, 404);
    assert.equal((await fetch(`${instance.baseUrl}/admin/api/overview`)).status, 404);
    const created = await adminRequest(instance.adminBaseUrl, '/admin/api/licenses', {
      method: 'POST',
      body: { customerName: 'Очікує рішення', paidUntil: '2099-12-31T21:59:59.999Z', maxDevices: 1, leaseDays: 14, stores: ['eva'] },
    });
    assert.equal(created.license.status, 'pending');
    const accessStore = new LicensedAccessStore({
      edition: 'licensed', licensePath: path.join(directory, 'client', 'license.json'),
      statePath: path.join(directory, 'client', 'state.dat'), publicKeyPath,
      serverUrl: instance.baseUrl, appVersion: '4.21.0', deviceIdProvider: () => DEVICE_ID,
    });
    const pending = await accessStore.activateOnline(created.activationCode);
    assert.equal(pending.updated, true);
    assert.equal(pending.status.allowed, false);
    assert.equal(pending.status.blockedReason, 'pending_approval');
    await adminRequest(instance.adminBaseUrl, `/admin/api/licenses/${created.license.id}`, { method: 'PATCH', body: { status: 'active' } });
    const approved = await accessStore.refreshOnline();
    assert.equal(approved.status.allowed, true);
  } finally {
    await instance.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('server publishes a signed update and serves the exact installer to an active client', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-update-server-'));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privateKeyPath = path.join(directory, 'license-private.pem');
  const publicKeyPath = path.join(directory, 'license-public.pem');
  const installerPath = path.join(directory, 'test-installer.exe');
  fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  fs.writeFileSync(installerPath, Buffer.from('signed-test-installer'));
  const instance = await startLocalLicenseServer({ port: 0, adminToken: ADMIN_TOKEN, dataPath: path.join(directory, 'db.json'), privateKeyPath });
  try {
    const created = await adminRequest(instance.adminBaseUrl, '/admin/api/licenses', {
      method: 'POST', body: { customerName: 'Update test', paidUntil: '2099-12-31T21:59:59.999Z', maxDevices: 1, leaseDays: 14, stores: ['eva'], status: 'active' },
    });
    const accessStore = new LicensedAccessStore({
      edition: 'licensed', licensePath: path.join(directory, 'client-license.json'), statePath: path.join(directory, 'client-state.dat'),
      publicKeyPath, serverUrl: instance.baseUrl, appVersion: '4.21.0', deviceIdProvider: () => DEVICE_ID,
    });
    await accessStore.activateOnline(created.activationCode);
    await adminRequest(instance.adminBaseUrl, '/admin/api/releases', {
      method: 'POST', body: { version: '4.21.1', channel: 'licensed', sourcePath: installerPath, notes: 'Тест', required: false },
    });
    const update = await accessStore.checkForUpdate();
    assert.equal(update.checked, true);
    assert.equal(update.update.payload.version, '4.21.1');
    assert.ok(await instance.store.findRelease(update.update.payload.releaseId), update.update.payload.releaseId);
    const download = await fetch(accessStore.resolveServerPath(update.update.payload.downloadPath));
    assert.equal(download.ok, true, `${download.status} ${await download.clone().text()}`);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from('signed-test-installer'));
  } finally {
    await instance.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function adminRequest(baseUrl, pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-admin-token': ADMIN_TOKEN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, JSON.stringify(payload));
  return payload;
}
