const assert = require('node:assert/strict');
const test = require('node:test');
const { createOwnerApiClient, normalizeAdminPath, normalizeBaseUrl } = require('./owner-api');

test('owner API accepts HTTPS and loopback only', () => {
  assert.equal(normalizeBaseUrl('https://price-monitor-license-staging.vladlenius.workers.dev/'), 'https://price-monitor-license-staging.vladlenius.workers.dev');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  assert.equal(normalizeBaseUrl('http://example.com'), '');
  assert.equal(normalizeBaseUrl('https://example.com/admin'), '');
});

test('owner API forwards only protected admin routes and keeps the token out of the result', async () => {
  let captured;
  const client = createOwnerApiClient({
    apiBaseUrl: 'https://example.com',
    adminToken: 'owner-secret-token',
    fetchFn: async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200, json: async () => ({ licenses: [] }) };
    },
  });
  const result = await client.request({ path: '/admin/api/overview' });
  assert.equal(captured.url, 'https://example.com/admin/api/overview');
  assert.equal(captured.options.headers['x-admin-token'], 'owner-secret-token');
  assert.deepEqual(result, { ok: true, status: 200, body: { licenses: [] } });
  assert.doesNotMatch(JSON.stringify(result), /owner-secret-token/);
  assert.throws(() => normalizeAdminPath('/health'), /owner_api_path_invalid/);
  assert.throws(() => normalizeAdminPath('/admin/api/../health'), /owner_api_path_invalid/);
});

test('owner API rejects oversized bodies before a network request', async () => {
  let called = false;
  const client = createOwnerApiClient({
    apiBaseUrl: 'https://example.com',
    adminToken: 'owner-secret-token',
    fetchFn: async () => { called = true; },
  });
  const result = await client.request({ path: '/admin/api/licenses', method: 'POST', body: 'x'.repeat(300 * 1024) });
  assert.equal(called, false);
  assert.equal(result.status, 413);
  assert.equal(result.body.error, 'body_too_large');
});
