import corePackage from './server-core.js';
import { D1LicenseStore } from './d1-store.mjs';
import { createActivationCode, createLicenseId, createWorkerCrypto } from './worker-crypto.mjs';

const {
  LicenseService,
  LicenseServiceError,
  normalizeLicenseInput,
  normalizeLicensePatch,
} = corePackage;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const store = new D1LicenseStore(env.DB);
      const cryptoProvider = createWorkerCrypto(env.LICENSE_PRIVATE_KEY_B64);
      const service = new LicenseService({ store, ...cryptoProvider });
      if (request.method === 'GET' && url.pathname === '/health') {
        return json(200, { ok: true, service: 'price-monitor-license', time: new Date().toISOString() });
      }
      if (request.method === 'POST' && url.pathname === '/v1/licenses/activate') {
        return json(200, await service.activate(await readJson(request), context(request)));
      }
      if (request.method === 'POST' && url.pathname === '/v1/licenses/check') {
        return json(200, await service.check(await readJson(request), context(request)));
      }
      if (url.pathname.startsWith('/admin/api/')) {
        requireAdmin(request, env.ADMIN_TOKEN);
        if (request.method === 'GET' && url.pathname === '/admin/api/overview') {
          return json(200, await store.overview());
        }
        if (request.method === 'POST' && url.pathname === '/admin/api/licenses') {
          const normalized = normalizeLicenseInput(await readJson(request));
          const activationCode = createActivationCode();
          const activationHash = await cryptoProvider.hashActivationCode(activationCode.replace(/[^A-Z0-9]/g, ''));
          const now = new Date().toISOString();
          const record = await store.createLicense({
            id: createLicenseId(),
            ...normalized,
            activationHash,
            activationHint: activationCode.slice(-5),
            createdAt: now,
            updatedAt: now,
          });
          return json(201, { license: sanitizeLicense(record), activationCode });
        }
        const licenseMatch = url.pathname.match(/^\/admin\/api\/licenses\/([^/]+)$/);
        if (licenseMatch && request.method === 'PATCH') {
          const id = decodeURIComponent(licenseMatch[1]);
          const current = await store.findLicenseById(id);
          if (!current) throw new LicenseServiceError('license_not_found', 404);
          const normalized = normalizeLicensePatch(await readJson(request), current);
          const updated = await store.updateLicense(id, { ...normalized, updatedAt: new Date().toISOString() });
          return json(200, { license: sanitizeLicense(updated) });
        }
        const deviceMatch = url.pathname.match(/^\/admin\/api\/licenses\/([^/]+)\/devices\/([a-f0-9]{64})$/i);
        if (deviceMatch && request.method === 'DELETE') {
          const removed = await store.removeDevice(decodeURIComponent(deviceMatch[1]), deviceMatch[2].toLowerCase());
          if (!removed) throw new LicenseServiceError('device_not_found', 404);
          return json(200, { removed: true });
        }
      }
      return json(404, { error: 'not_found' });
    } catch (error) {
      const status = error instanceof LicenseServiceError ? error.status : 500;
      const code = error instanceof LicenseServiceError ? error.code : 'internal_error';
      if (status >= 500) console.error(error);
      return json(status, { error: code });
    }
  },
};

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 128 * 1024) throw new LicenseServiceError('body_too_large', 413);
  try {
    return await request.json();
  } catch (_error) {
    throw new LicenseServiceError('json_invalid');
  }
}

function context(request) {
  return { ip: request.headers.get('CF-Connecting-IP') || '' };
}

function requireAdmin(request, expectedToken) {
  const supplied = request.headers.get('x-admin-token') || '';
  if (!expectedToken || !constantTimeEqual(supplied, expectedToken)) {
    throw new LicenseServiceError('admin_unauthorized', 401);
  }
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index % (a.length || 1)] || 0) ^ (b[index % (b.length || 1)] || 0);
  return difference === 0;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

function sanitizeLicense(record) {
  if (!record) return null;
  const { activationHash: _activationHash, ...safe } = record;
  return safe;
}
