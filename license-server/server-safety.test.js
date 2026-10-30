const assert = require('node:assert/strict');
const test = require('node:test');
const { rateLimitPolicy, requestId, safeEnvironment } = require('./server-safety');

test('assigns conservative limits only to known public and owner routes', () => {
  assert.deepEqual(rateLimitPolicy('POST', '/v1/licenses/activate'), {
    name: 'activation', limit: 30, windowSeconds: 900,
  });
  assert.equal(rateLimitPolicy('GET', '/v1/licenses/activate'), null);
  assert.deepEqual(rateLimitPolicy('POST', '/v1/telemetry/search'), {
    name: 'telemetry', limit: 600, windowSeconds: 3600,
  });
  assert.deepEqual(rateLimitPolicy('POST', '/v1/support/diagnostics'), {
    name: 'diagnostics', limit: 30, windowSeconds: 3600,
  });
  assert.equal(rateLimitPolicy('GET', '/unrelated'), null);
  assert.equal(rateLimitPolicy('PATCH', '/admin/api/licenses/lic_1').name, 'admin');
});

test('keeps Cloudflare request ids safe and generates a fallback', () => {
  assert.equal(requestId('abcDEF_123-456', () => 'unused'), 'abcDEF_123-456');
  assert.equal(requestId('<script>', () => 'req_safe_123'), 'req_safe_123');
  assert.match(requestId('', () => ''), /^req_[a-z0-9]+$/);
});

test('normalizes the public environment label', () => {
  assert.equal(safeEnvironment('Production'), 'production');
  assert.equal(safeEnvironment('../../secret'), 'unknown');
});
