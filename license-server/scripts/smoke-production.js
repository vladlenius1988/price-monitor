const fs = require('node:fs');
const path = require('node:path');
const { validateSignedLicense } = require('../../license-access');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const baseUrl = 'https://price-monitor-license-production.vladlenius.workers.dev';
const token = fs.readFileSync(path.join(repositoryRoot, '.license-private', 'production-admin-token.txt'), 'utf8').trim();
const publicKey = fs.readFileSync(path.join(repositoryRoot, 'license-public-production.pem'), 'utf8');
const cleanupIdPath = path.join(repositoryRoot, '.license-private', 'production-smoke-license-id.txt');

async function main() {
  if (!process.argv.includes('--confirm')) {
    throw new Error('Run with --confirm: this creates a temporary record that must be removed after the test.');
  }
  const created = await request('/admin/api/licenses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify({
      customerName: 'SYSTEM SMOKE TEST 4.24.0',
      paidUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      maxDevices: 1,
      leaseDays: 1,
      stores: ['eva'],
      status: 'active',
    }),
  });
  fs.writeFileSync(cleanupIdPath, `${created.license.id}\n`, 'utf8');
  const activated = await request('/v1/licenses/activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      activationCode: created.activationCode,
      deviceId: 'f'.repeat(64),
      installationId: 'production-smoke-installation',
      deviceLabel: 'SMOKE-TEST',
      appVersion: '4.24.0',
    }),
  });
  const validation = validateSignedLicense(activated.license, publicKey);
  if (!validation.valid) throw new Error(`signature_${validation.reason || 'invalid'}`);
  if (validation.document.payload.licenseId !== created.license.id) throw new Error('license_id_mismatch');
  console.log(JSON.stringify({
    ok: true,
    licenseId: created.license.id,
    signed: true,
    stores: validation.document.payload.stores,
  }));
}

async function request(pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${body.error || `http_${response.status}`} ${body.requestId || ''}`.trim());
  return body;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
