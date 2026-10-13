const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { stableStringify } = require('../license-access');
const { getDeviceId } = require('../device-identity');

const projectRoot = path.resolve(__dirname, '..');
const privateDirectory = path.join(projectRoot, '.license-private');
const privateKeyPath = path.join(privateDirectory, 'license-private.pem');
const publicKeyPath = path.join(projectRoot, 'license-public.pem');

function ensureKeyPair() {
  const privateExists = fs.existsSync(privateKeyPath);
  const publicExists = fs.existsSync(publicKeyPath);
  if (privateExists !== publicExists) {
    throw new Error('Знайдено лише одну частину ключа. Не створюйте нову пару поверх наявної.');
  }
  if (privateExists) return;

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(privateDirectory, { recursive: true });
  fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
}

function issueLicense(options) {
  ensureKeyPair();
  const payload = {
    schemaVersion: 1,
    licenseId: options.licenseId,
    customerName: options.customerName,
    edition: 'licensed',
    status: 'active',
    issuedAt: options.issuedAt,
    notBefore: options.notBefore,
    expiresAt: options.expiresAt,
    maxDevices: options.maxDevices,
    deviceId: options.deviceId,
    stores: options.stores,
    updateChannel: 'licensed',
  };
  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
  const signature = crypto.sign(
    null,
    Buffer.from(stableStringify(payload), 'utf8'),
    privateKey,
  ).toString('base64');
  const outputPath = path.resolve(projectRoot, options.output);
  fs.writeFileSync(outputPath, `${JSON.stringify({ payload, signature }, null, 2)}\n`, 'utf8');
  return outputPath;
}

function readArgument(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

if (require.main === module) {
  const now = new Date().toISOString();
  const outputPath = issueLicense({
    licenseId: readArgument('id', 'preview-2026-10'),
    customerName: readArgument('customer', 'Тестова ліцензія'),
    issuedAt: readArgument('issued', now),
    notBefore: readArgument('from', now),
    expiresAt: readArgument('until', '2026-10-31T21:59:59.999Z'),
    maxDevices: Math.max(1, Number.parseInt(readArgument('devices', '1'), 10) || 1),
    deviceId: readArgument('device', getDeviceId()),
    stores: readArgument('stores', 'eva,varus,makeup,aurora,notino,rozetka').split(',').map((value) => value.trim()).filter(Boolean),
    output: readArgument('output', 'paid-license.json'),
  });
  process.stdout.write(`Ліцензію створено: ${outputPath}\n`);
}

module.exports = { ensureKeyPair, issueLicense };
