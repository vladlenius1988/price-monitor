const ROUTE_LIMITS = Object.freeze({
  activation: Object.freeze({ limit: 30, windowSeconds: 15 * 60 }),
  licenseCheck: Object.freeze({ limit: 120, windowSeconds: 15 * 60 }),
  telemetry: Object.freeze({ limit: 600, windowSeconds: 60 * 60 }),
  admin: Object.freeze({ limit: 300, windowSeconds: 10 * 60 }),
  health: Object.freeze({ limit: 120, windowSeconds: 60 }),
});

function rateLimitPolicy(method, pathname) {
  const verb = String(method || 'GET').toUpperCase();
  const path = String(pathname || '');
  if (verb === 'POST' && path === '/v1/licenses/activate') return { name: 'activation', ...ROUTE_LIMITS.activation };
  if (verb === 'POST' && path === '/v1/licenses/check') return { name: 'license-check', ...ROUTE_LIMITS.licenseCheck };
  if (verb === 'POST' && path === '/v1/telemetry/search') return { name: 'telemetry', ...ROUTE_LIMITS.telemetry };
  if (path.startsWith('/admin/api/')) return { name: 'admin', ...ROUTE_LIMITS.admin };
  if (verb === 'GET' && path === '/health') return { name: 'health', ...ROUTE_LIMITS.health };
  return null;
}

function requestId(value, fallback = () => '') {
  const supplied = String(value || '').trim();
  if (/^[a-z0-9_-]{8,100}$/i.test(supplied)) return supplied;
  const generated = String(fallback() || '').trim();
  return /^[a-z0-9_-]{8,100}$/i.test(generated) ? generated : `req_${Date.now().toString(36)}`;
}

function safeEnvironment(value) {
  const normalized = String(value || 'unknown').trim().toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(normalized) ? normalized : 'unknown';
}

module.exports = { rateLimitPolicy, requestId, safeEnvironment };
