import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createWorkerCrypto } from './worker-crypto.mjs';
import licensePackage from '../license-access.js';

const { validateSignedLicense } = licensePackage;

test('Cloudflare Web Crypto signer produces a license accepted by the desktop app', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const workerCrypto = createWorkerCrypto(Buffer.from(privatePem, 'utf8').toString('base64'));
  const payload = {
    schemaVersion: 1,
    licenseId: 'cloudflare-test-license',
    customerName: 'Cloudflare Test',
    edition: 'licensed',
    status: 'active',
    issuedAt: '2026-10-06T12:00:00.000Z',
    notBefore: '2026-10-06T11:55:00.000Z',
    expiresAt: '2026-10-20T12:00:00.000Z',
    paidUntil: '2026-12-31T21:59:59.999Z',
    maxDevices: 3,
    deviceId: 'a'.repeat(64),
    stores: ['eva', 'makeup'],
    features: { all: true },
    updateChannel: 'licensed',
    serverManaged: true,
  };
  const signed = await workerCrypto.signLicense(payload);
  assert.equal(validateSignedLicense(signed, publicPem).valid, true);
  assert.equal(await workerCrypto.hashActivationCode('PMAAAA'), crypto.createHash('sha256').update('PMAAAA').digest('hex'));
});
