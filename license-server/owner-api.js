const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);
const MAX_BODY_BYTES = 256 * 1024;

function createOwnerApiClient({ apiBaseUrl, adminToken, fetchFn = globalThis.fetch } = {}) {
  const baseUrl = normalizeBaseUrl(apiBaseUrl);
  const token = String(adminToken || '').trim();
  if (!baseUrl) throw new Error('owner_api_url_invalid');
  if (token.length < 8) throw new Error('owner_admin_token_invalid');
  if (typeof fetchFn !== 'function') throw new Error('owner_fetch_unavailable');

  return {
    async request(input = {}) {
      const path = normalizeAdminPath(input.path);
      const method = String(input.method || 'GET').toUpperCase();
      if (!ALLOWED_METHODS.has(method)) return failure(405, 'method_not_allowed');
      const body = normalizeBody(input.body);
      if (body.error) return failure(413, body.error);
      try {
        const response = await fetchFn(`${baseUrl}${path}`, {
          method,
          headers: {
            'content-type': 'application/json',
            'x-admin-token': token,
          },
          ...(body.value && method !== 'GET' ? { body: body.value } : {}),
        });
        const responseBody = await response.json().catch(() => ({}));
        return { ok: Boolean(response.ok), status: Number(response.status) || 0, body: responseBody };
      } catch (_error) {
        return failure(0, 'server_unavailable');
      }
    },
  };
}

function normalizeBaseUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
    if (url.protocol !== 'https:' && !loopback) return '';
    if (url.username || url.password || (url.pathname && url.pathname !== '/') || url.search || url.hash) return '';
    return url.origin;
  } catch (_error) {
    return '';
  }
}

function normalizeAdminPath(value) {
  const path = String(value || '');
  if (!/^\/admin\/api\/[a-z0-9_\-./%]+$/i.test(path) || path.includes('..') || path.includes('//')) {
    throw new Error('owner_api_path_invalid');
  }
  return path;
}

function normalizeBody(value) {
  if (value === undefined || value === null || value === '') return { value: '' };
  if (typeof value !== 'string') return { error: 'body_invalid' };
  if (Buffer.byteLength(value, 'utf8') > MAX_BODY_BYTES) return { error: 'body_too_large' };
  return { value };
}

function failure(status, error) {
  return { ok: false, status, body: { error } };
}

module.exports = { createOwnerApiClient, normalizeAdminPath, normalizeBaseUrl };
