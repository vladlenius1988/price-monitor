const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  LicenseService,
  LicenseServiceError,
  normalizeLicenseInput,
  normalizeLicensePatch,
} = require('./server-core');
const { LocalLicenseStore } = require('./local-store');
const { createActivationCode, createLicenseId, createNodeCrypto } = require('./crypto-node');
const { ReleaseService } = require('./release-service');
const { TelegramNotifier } = require('./telegram-notifier');

const DEFAULT_ADMIN_PORT = 8787;
const DEFAULT_PUBLIC_PORT = 8788;
const ADMIN_HOST = '127.0.0.1';

async function startLocalLicenseServer(options = {}) {
  const projectRoot = path.resolve(__dirname, '..');
  const adminPort = normalizePort(options.adminPort ?? options.port ?? process.env.PRICE_MONITOR_ADMIN_PORT, DEFAULT_ADMIN_PORT);
  const publicPort = normalizePort(options.publicPort ?? (options.port === 0 ? 0 : process.env.PRICE_MONITOR_PUBLIC_PORT), DEFAULT_PUBLIC_PORT);
  const publicHost = normalizePublicHost(options.publicHost ?? process.env.PRICE_MONITOR_PUBLIC_HOST ?? '127.0.0.1');
  const adminToken = String(options.adminToken ?? process.env.PRICE_MONITOR_ADMIN_TOKEN ?? 'local-admin');
  const dataPath = path.resolve(options.dataPath ?? process.env.PRICE_MONITOR_LICENSE_DATA ?? path.join(__dirname, 'data', 'local-db.json'));
  const releaseDirectory = path.resolve(options.releaseDirectory ?? path.join(path.dirname(dataPath), 'releases'));
  const privateKeyPath = path.resolve(options.privateKeyPath ?? process.env.PRICE_MONITOR_PRIVATE_KEY ?? path.join(projectRoot, '.license-private', 'license-private.pem'));

  if (!adminToken || adminToken.length < 8) throw new Error('admin_token_invalid');
  if (!fs.existsSync(privateKeyPath)) throw new Error(`Не знайдено приватний ключ сервера: ${privateKeyPath}`);

  const store = new LocalLicenseStore(dataPath);
  const cryptoProvider = createNodeCrypto(fs.readFileSync(privateKeyPath, 'utf8'));
  const service = new LicenseService({ store, ...cryptoProvider });
  const releaseService = new ReleaseService({ store, signPayload: cryptoProvider.signLicense, releaseDirectory });
  const telegram = new TelegramNotifier({ store, fetchFn: options.fetchFn });
  const limiter = createRateLimiter();

  const publicServer = http.createServer(async (request, response) => {
    try {
      setSecurityHeaders(response, false);
      if (!limiter.allow(request.socket?.remoteAddress || 'unknown')) throw new LicenseServiceError('rate_limited', 429);
      const url = requestUrl(request, publicHost, publicPort);
      if (request.method === 'OPTIONS') return sendEmpty(response, 204);
      if (request.method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, { ok: true, service: 'price-monitor-license-public', time: new Date().toISOString() });
      }
      if (request.method === 'POST' && url.pathname === '/v1/licenses/activate') {
        const result = await service.activate(await readJson(request), requestContext(request));
        const device = result.license?.payload?.deviceId || '';
        if (result.license?.payload?.status === 'pending') {
          telegram.notifyOnce(
            `activation:${result.license.payload.licenseId}:${device}`,
            `Price Monitor: новий пристрій очікує підтвердження. Клієнт «${result.license.payload.customerName}», код ${shortDevice(device)}.`,
          ).catch(() => {});
        }
        return sendJson(response, 200, result);
      }
      if (request.method === 'POST' && url.pathname === '/v1/licenses/check') {
        return sendJson(response, 200, await service.check(await readJson(request), requestContext(request)));
      }
      if (request.method === 'POST' && url.pathname === '/v1/updates/check') {
        const body = await readJson(request);
        await authorizeUpdateCheck(store, body);
        const update = await releaseService.latest(body.channel, body.currentVersion);
        return sendJson(response, 200, { update });
      }
      const downloadMatch = url.pathname.match(/^\/v1\/updates\/download\/(rel_[a-f0-9]+)$/i);
      if (request.method === 'GET' && downloadMatch) {
        const release = await releaseService.download(downloadMatch[1]);
        if (!release) return sendJson(response, 404, { error: 'release_not_found' });
        return sendDownload(response, release);
      }
      return sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      return sendError(response, error);
    }
  });

  const adminServer = http.createServer(async (request, response) => {
    try {
      setSecurityHeaders(response, true);
      const url = requestUrl(request, ADMIN_HOST, adminPort);
      if (request.method === 'OPTIONS') return sendEmpty(response, 204);
      if (url.pathname === '/admin' && request.method === 'GET') return sendFile(response, path.join(__dirname, 'admin.html'), 'text/html; charset=utf-8');
      if (url.pathname === '/admin.js' && request.method === 'GET') return sendFile(response, path.join(__dirname, 'admin.js'), 'text/javascript; charset=utf-8');
      if (url.pathname.startsWith('/admin/api/')) {
        requireAdmin(request, adminToken);
        if (request.method === 'GET' && url.pathname === '/admin/api/overview') {
          const overview = await store.overview();
          return sendJson(response, 200, { ...overview, publicServer: { host: publicHost, port: actualPort(publicServer, publicPort) } });
        }
        if (request.method === 'POST' && url.pathname === '/admin/api/licenses') {
          const body = await readJson(request);
          const normalized = normalizeLicenseInput({ ...body, status: body.status || 'pending' });
          const activationCode = createActivationCode();
          const activationHash = await cryptoProvider.hashActivationCode(activationCode.replace(/[^A-Z0-9]/g, ''));
          const now = new Date().toISOString();
          const record = await store.createLicense({ id: createLicenseId(), ...normalized, activationHash, activationHint: activationCode.slice(-5), createdAt: now, updatedAt: now });
          return sendJson(response, 201, { license: sanitizeLicense(record), activationCode });
        }
        const licenseMatch = url.pathname.match(/^\/admin\/api\/licenses\/([^/]+)$/);
        if (licenseMatch && request.method === 'PATCH') {
          const id = decodeURIComponent(licenseMatch[1]);
          const current = await store.findLicenseById(id);
          if (!current) throw new LicenseServiceError('license_not_found', 404);
          const normalized = normalizeLicensePatch(await readJson(request), current);
          const updated = await store.updateLicense(id, { ...normalized, updatedAt: new Date().toISOString() });
          telegram.notifyOnce(
            `status:${updated.id}:${updated.status}:${updated.updatedAt}`,
            `Price Monitor: для клієнта «${updated.customerName}» встановлено статус «${updated.status}».`,
          ).catch(() => {});
          return sendJson(response, 200, { license: sanitizeLicense(updated) });
        }
        const deviceMatch = url.pathname.match(/^\/admin\/api\/licenses\/([^/]+)\/devices\/([a-f0-9]{64})$/i);
        if (deviceMatch && request.method === 'DELETE') {
          const removed = await store.removeDevice(decodeURIComponent(deviceMatch[1]), deviceMatch[2].toLowerCase());
          if (!removed) throw new LicenseServiceError('device_not_found', 404);
          return sendJson(response, 200, { removed: true });
        }
        if (request.method === 'POST' && url.pathname === '/admin/api/releases') {
          const release = await releaseService.publish(await readJson(request));
          return sendJson(response, 201, { release: sanitizeRelease(release) });
        }
        if (request.method === 'PATCH' && url.pathname === '/admin/api/settings/telegram') {
          const body = await readJson(request);
          const current = await store.getSettings();
          const patch = {
            telegramEnabled: Boolean(body.enabled),
            telegramChatId: String(body.chatId || current.telegramChatId || '').trim().slice(0, 100),
          };
          if (String(body.botToken || '').trim()) patch.telegramBotToken = String(body.botToken).trim().slice(0, 200);
          await store.updateSettings(patch);
          return sendJson(response, 200, { saved: true });
        }
        if (request.method === 'POST' && url.pathname === '/admin/api/settings/telegram/test') {
          return sendJson(response, 200, await telegram.send('Price Monitor: тестове повідомлення. Сервер сповіщень працює.'));
        }
      }
      return sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      return sendError(response, error);
    }
  });

  await listen(publicServer, publicPort, publicHost);
  try {
    await listen(adminServer, adminPort, ADMIN_HOST);
  } catch (error) {
    await closeServer(publicServer);
    throw error;
  }

  const publicActualPort = actualPort(publicServer, publicPort);
  const adminActualPort = actualPort(adminServer, adminPort);
  const baseUrl = `http://127.0.0.1:${publicActualPort}`;
  const adminBaseUrl = `http://${ADMIN_HOST}:${adminActualPort}`;
  let closing = null;
  return {
    server: publicServer, publicServer, adminServer, store, service, releaseService, telegram,
    host: publicHost, port: publicActualPort, adminPort: adminActualPort,
    baseUrl, publicBaseUrl: baseUrl, adminBaseUrl, adminUrl: `${adminBaseUrl}/admin`,
    dataPath, privateKeyPath,
    close: () => {
      if (!closing) closing = Promise.all([closeServer(publicServer), closeServer(adminServer)]).then(() => undefined);
      return closing;
    },
  };
}

async function authorizeUpdateCheck(store, body) {
  const license = await store.findLicenseById(String(body.licenseId || ''));
  if (!license || license.status !== 'active') throw new LicenseServiceError('license_blocked', 403);
  const device = await store.findDevice(license.id, String(body.deviceId || '').toLowerCase());
  if (!device || device.status !== 'active') throw new LicenseServiceError('device_not_activated', 403);
  if (String(body.channel || 'licensed') !== String(license.updateChannel || 'licensed')) throw new LicenseServiceError('update_channel_invalid', 403);
}

function createRateLimiter() {
  const buckets = new Map();
  return { allow(key) { const now = Date.now(); const bucket = buckets.get(key); if (!bucket || now - bucket.startedAt >= 60000) { buckets.set(key, { startedAt: now, count: 1 }); return true; } bucket.count += 1; return bucket.count <= 600; } };
}

function requireAdmin(request, adminToken) { if (String(request.headers['x-admin-token'] || '') !== adminToken) throw new LicenseServiceError('admin_unauthorized', 401); }
async function readJson(request) {
  const chunks = []; let total = 0;
  for await (const chunk of request) { total += chunk.length; if (total > 256 * 1024) { const error = new Error('body_too_large'); error.code = 'body_too_large'; throw error; } chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_error) { throw new LicenseServiceError('json_invalid'); }
}

function requestContext(request) { return { ip: request.socket?.remoteAddress || '' }; }
function requestUrl(request, host, port) { return new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`); }
function sendJson(response, status, body) { const contents = Buffer.from(JSON.stringify(body)); response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': contents.length, 'cache-control': 'no-store' }); response.end(contents); }
function sendFile(response, filePath, contentType) { const contents = fs.readFileSync(filePath); response.writeHead(200, { 'content-type': contentType, 'content-length': contents.length, 'cache-control': 'no-store' }); response.end(contents); }
function sendDownload(response, release) { const stats = fs.statSync(release.filePath); response.writeHead(200, { 'content-type': 'application/vnd.microsoft.portable-executable', 'content-length': stats.size, 'content-disposition': `attachment; filename="${String(release.fileName).replace(/["\r\n]/g, '')}"`, 'cache-control': 'private, max-age=300' }); fs.createReadStream(release.filePath).pipe(response); }
function sendEmpty(response, status) { response.writeHead(status); response.end(); }
function sendError(response, error) { const status = error instanceof LicenseServiceError ? error.status : error?.status || (error?.code === 'body_too_large' ? 413 : 500); const code = error instanceof LicenseServiceError ? error.code : error?.code === 'body_too_large' ? 'body_too_large' : error?.code || 'internal_error'; if (status >= 500) process.stderr.write(`${error?.stack || error}\n`); return sendJson(response, status, { error: code }); }
function setSecurityHeaders(response, admin) { response.setHeader('x-content-type-options', 'nosniff'); response.setHeader('x-frame-options', 'DENY'); response.setHeader('referrer-policy', 'no-referrer'); response.setHeader('access-control-allow-origin', 'null'); response.setHeader('access-control-allow-headers', admin ? 'content-type,x-admin-token' : 'content-type'); response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS'); }
function sanitizeLicense(record) { if (!record) return null; const { activationHash: _activationHash, ...safe } = record; return safe; }
function sanitizeRelease(record) { if (!record) return null; const { filePath: _filePath, ...safe } = record; return safe; }
function normalizePort(value, fallback) { const parsed = Number.parseInt(value, 10); if (parsed === 0) return 0; return Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535 ? parsed : fallback; }
function normalizePublicHost(value) { return String(value || '') === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1'; }
function actualPort(server, fallback) { const address = server.address(); return typeof address === 'object' && address ? address.port : fallback; }
function listen(server, port, host) { return new Promise((resolve, reject) => { const onError = (error) => reject(error); server.once('error', onError); server.listen(port, host, () => { server.off('error', onError); resolve(); }); }); }
function closeServer(server) { return new Promise((resolve) => { if (!server?.listening) return resolve(); server.close(() => resolve()); }); }
function shortDevice(value) { return String(value || '').slice(0, 16).toUpperCase().match(/.{1,4}/g)?.join('-') || 'невідомий'; }

if (require.main === module) {
  startLocalLicenseServer({ publicHost: '0.0.0.0' }).then((instance) => { process.stdout.write(`Публічний API: ${instance.publicBaseUrl}\nПанель власника: ${instance.adminUrl}\n`); }).catch((error) => { process.stderr.write(`${error?.stack || error}\n`); process.exitCode = 1; });
}

module.exports = { startLocalLicenseServer };
