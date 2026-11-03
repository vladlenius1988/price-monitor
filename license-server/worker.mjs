import corePackage from './server-core.js';
import safetyPackage from './server-safety.js';
import telemetryPackage from './telemetry.js';
import supportPackage from './support-diagnostics.js';
import releasePackage from './cloud-releases.js';
import { D1LicenseStore } from './d1-store.mjs';
import { createActivationCode, createLicenseId, createWorkerCrypto } from './worker-crypto.mjs';

const {
  LicenseService,
  LicenseServiceError,
  normalizeLicenseInput,
  normalizeLicensePatch,
} = corePackage;
const { rateLimitPolicy, requestId, safeEnvironment } = safetyPackage;
const { normalizeSearchTelemetry } = telemetryPackage;
const { normalizeSupportDiagnostic, telegramSupportMessage } = supportPackage;
const {
  MAX_UPLOAD_PART_BYTES, UPLOAD_PART_BYTES, createUpdatePayload,
  normalizeReleaseMetadata, normalizeUpdateCheck, validateCompletedParts,
} = releasePackage;

export default {
  async fetch(request, env) {
    const currentRequestId = requestId(request.headers.get('CF-Ray'), () => `req_${crypto.randomUUID().replace(/-/g, '')}`);
    let store = null;
    try {
      const url = new URL(request.url);
      store = new D1LicenseStore(env.DB);
      await enforceRateLimit(request, url, env, store);
      const cryptoProvider = createWorkerCrypto(env.LICENSE_PRIVATE_KEY_B64);
      const service = new LicenseService({ store, ...cryptoProvider });
      if (request.method === 'GET' && url.pathname === '/health') {
        const database = await store.health();
        return json(200, serviceStatus(env, database.ok, currentRequestId), currentRequestId);
      }
      if (request.method === 'POST' && url.pathname === '/v1/licenses/activate') {
        return json(200, await service.activate(await readJson(request), context(request)), currentRequestId);
      }
      if (request.method === 'POST' && url.pathname === '/v1/licenses/check') {
        return json(200, await service.check(await readJson(request), context(request)), currentRequestId);
      }
      if (request.method === 'POST' && url.pathname === '/v1/telemetry/search') {
        const normalized = normalizeSearchTelemetry(await readJson(request));
        if (!normalized.ok) throw new LicenseServiceError(normalized.reason, 400);
        const metric = normalized.value;
        const license = await store.findLicenseById(metric.licenseId);
        if (!license) throw new LicenseServiceError('license_not_found', 404);
        const device = await store.findDevice(metric.licenseId, metric.deviceId);
        if (!device || device.status !== 'active') throw new LicenseServiceError('device_not_allowed', 403);
        if (!license.stores.includes(metric.store)) throw new LicenseServiceError('store_not_allowed', 403);
        const saved = await store.recordSearchMetric({
          ...metric,
          occurredAt: new Date().toISOString(),
        });
        return json(202, { accepted: true, duplicate: !saved.inserted }, currentRequestId);
      }
      if (request.method === 'POST' && url.pathname === '/v1/updates/check') {
        const normalized = normalizeUpdateCheck(await readJson(request));
        if (!normalized.ok) throw new LicenseServiceError(normalized.reason, 400);
        const check = normalized.value;
        const license = await store.findLicenseById(check.licenseId);
        if (!license) throw new LicenseServiceError('license_not_found', 404);
        if (license.status !== 'active' || Date.parse(license.paidUntil) <= Date.now()) {
          throw new LicenseServiceError('license_not_active', 403);
        }
        if (check.channel !== license.updateChannel) throw new LicenseServiceError('update_channel_invalid', 403);
        const device = await store.findDevice(check.licenseId, check.deviceId);
        if (!device || device.status !== 'active') throw new LicenseServiceError('device_not_allowed', 403);
        const release = await store.latestRelease(check.channel, check.currentVersion);
        return json(200, { update: release ? { payload: createUpdatePayload(release), signature: release.signature } : null }, currentRequestId);
      }
      const downloadMatch = url.pathname.match(/^\/v1\/updates\/download\/(rel_[a-f0-9]+)$/i);
      if (request.method === 'GET' && downloadMatch) {
        const release = await store.findRelease(downloadMatch[1]);
        if (!release) throw new LicenseServiceError('release_not_found', 404);
        const object = await env.RELEASES.get(release.objectKey);
        if (!object) throw new LicenseServiceError('release_file_missing', 404);
        return releaseDownload(object, release, currentRequestId);
      }
      if (request.method === 'POST' && url.pathname === '/v1/support/diagnostics') {
        const normalized = normalizeSupportDiagnostic(await readJson(request));
        if (!normalized.ok) throw new LicenseServiceError(normalized.reason, 400);
        const diagnostic = normalized.value;
        const license = await store.findLicenseById(diagnostic.licenseId);
        if (!license) throw new LicenseServiceError('license_not_found', 404);
        const device = await store.findDevice(diagnostic.licenseId, diagnostic.deviceId);
        if (!device || device.status !== 'active') throw new LicenseServiceError('device_not_allowed', 403);
        const saved = await store.recordSupportDiagnostic({ ...diagnostic, receivedAt: new Date().toISOString() });
        const shouldNotify = saved.item?.severity === 'error'
          && (saved.inserted || [3, 10].includes(Number(saved.item?.repeatCount)));
        if (shouldNotify) await safeTelegramSupport(env, saved.item);
        return json(202, {
          accepted: true,
          caseId: saved.item?.id || diagnostic.reportId,
          repeated: Boolean(saved.repeated),
          repeatCount: Number(saved.item?.repeatCount) || 1,
        }, currentRequestId);
      }
      if (url.pathname.startsWith('/admin/api/')) {
        requireAdmin(request, env.ADMIN_TOKEN);
        if (request.method === 'GET' && url.pathname === '/admin/api/overview') {
          const overview = await store.overview();
          return json(200, {
            ...overview,
            service: serviceStatus(env, true, currentRequestId),
          }, currentRequestId);
        }
        if (request.method === 'POST' && url.pathname === '/admin/api/releases/uploads') {
          const normalized = normalizeReleaseMetadata(await readJson(request));
          if (!normalized.ok) throw new LicenseServiceError(normalized.reason, 400);
          const metadata = normalized.value;
          const releaseId = `rel_${crypto.randomUUID().replace(/-/g, '')}`;
          const objectKey = `${safeEnvironment(env.ENVIRONMENT)}/${metadata.channel}/${metadata.version}/${releaseId}.exe`;
          const multipart = await env.RELEASES.createMultipartUpload(objectKey, {
            httpMetadata: { contentType: 'application/vnd.microsoft.portable-executable' },
            customMetadata: { releaseId, version: metadata.version, channel: metadata.channel },
          });
          try {
            await store.createReleaseUpload({
              ...metadata, releaseId, objectKey, uploadId: multipart.uploadId, createdAt: new Date().toISOString(),
            });
          } catch (error) {
            await multipart.abort().catch(() => {});
            throw error;
          }
          await safeAudit(store, 'admin_release_upload_started', '', request, {
            releaseId, version: metadata.version, channel: metadata.channel, size: metadata.size,
          });
          return json(201, { upload: { releaseId, partSize: UPLOAD_PART_BYTES } }, currentRequestId);
        }
        const releasePartMatch = url.pathname.match(/^\/admin\/api\/releases\/uploads\/(rel_[a-f0-9]+)\/parts\/(\d+)$/i);
        if (releasePartMatch && request.method === 'PUT') {
          const releaseId = releasePartMatch[1];
          const partNumber = Number(releasePartMatch[2]);
          const length = Number(request.headers.get('content-length') || 0);
          if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 100) throw new LicenseServiceError('release_part_invalid', 400);
          if (length < 1 || length > MAX_UPLOAD_PART_BYTES) throw new LicenseServiceError('release_part_size_invalid', 413);
          const pending = await store.findReleaseUpload(releaseId);
          if (!pending) throw new LicenseServiceError('release_upload_not_found', 404);
          const multipart = env.RELEASES.resumeMultipartUpload(pending.objectKey, pending.uploadId);
          const uploaded = await multipart.uploadPart(partNumber, request.body);
          return json(200, { partNumber: uploaded.partNumber, etag: uploaded.etag }, currentRequestId);
        }
        const releaseCompleteMatch = url.pathname.match(/^\/admin\/api\/releases\/uploads\/(rel_[a-f0-9]+)\/complete$/i);
        if (releaseCompleteMatch && request.method === 'POST') {
          const pending = await store.findReleaseUpload(releaseCompleteMatch[1]);
          if (!pending) throw new LicenseServiceError('release_upload_not_found', 404);
          const normalizedParts = validateCompletedParts((await readJson(request)).parts, pending.size, UPLOAD_PART_BYTES);
          if (!normalizedParts.ok) throw new LicenseServiceError(normalizedParts.reason, 400);
          const multipart = env.RELEASES.resumeMultipartUpload(pending.objectKey, pending.uploadId);
          let release = null;
          let previous = null;
          try {
            const completed = await multipart.complete(normalizedParts.value);
            if (Number(completed.size) !== pending.size) throw new LicenseServiceError('release_size_mismatch', 400);
            const publishedAt = new Date().toISOString();
            const payload = createUpdatePayload({ ...pending, publishedAt });
            const document = await cryptoProvider.signLicense(payload);
            previous = await store.findReleaseVersion(pending.channel, pending.version);
            release = await store.createRelease({
              ...payload, signature: document.signature, objectKey: pending.objectKey,
            });
          } catch (error) {
            await env.RELEASES.delete(pending.objectKey).catch(() => {});
            await store.deleteReleaseUpload(pending.releaseId).catch(() => {});
            throw error;
          }
          await store.deleteReleaseUpload(pending.releaseId);
          if (previous?.objectKey && previous.objectKey !== pending.objectKey) await env.RELEASES.delete(previous.objectKey).catch(() => {});
          await safeAudit(store, 'admin_release_published', '', request, {
            releaseId: release.releaseId, version: release.version, channel: release.channel, size: release.size,
          });
          return json(201, { release: sanitizeRelease(release) }, currentRequestId);
        }
        const releaseUploadMatch = url.pathname.match(/^\/admin\/api\/releases\/uploads\/(rel_[a-f0-9]+)$/i);
        if (releaseUploadMatch && request.method === 'DELETE') {
          const pending = await store.findReleaseUpload(releaseUploadMatch[1]);
          if (!pending) return json(200, { aborted: true }, currentRequestId);
          const multipart = env.RELEASES.resumeMultipartUpload(pending.objectKey, pending.uploadId);
          await multipart.abort().catch(() => {});
          await store.deleteReleaseUpload(pending.releaseId);
          await safeAudit(store, 'admin_release_upload_aborted', '', request, { releaseId: pending.releaseId });
          return json(200, { aborted: true }, currentRequestId);
        }
        const releaseDeleteMatch = url.pathname.match(/^\/admin\/api\/releases\/(rel_[a-f0-9]+)$/i);
        if (releaseDeleteMatch && request.method === 'DELETE') {
          const removed = await store.deleteRelease(releaseDeleteMatch[1]);
          if (!removed) throw new LicenseServiceError('release_not_found', 404);
          await env.RELEASES.delete(removed.objectKey);
          await safeAudit(store, 'admin_release_unpublished', '', request, {
            releaseId: removed.releaseId, version: removed.version, channel: removed.channel,
          });
          return json(200, { removed: true }, currentRequestId);
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
          await safeAudit(store, 'admin_license_created', record.id, request, {
            customerName: record.customerName,
            maxDevices: record.maxDevices,
            paidUntil: record.paidUntil,
          });
          return json(201, { license: sanitizeLicense(record), activationCode }, currentRequestId);
        }
        const supportMatch = url.pathname.match(/^\/admin\/api\/support\/([^/]+)$/);
        if (supportMatch && request.method === 'PATCH') {
          const id = decodeURIComponent(supportMatch[1]);
          const body = await readJson(request);
          const status = String(body.status || '');
          if (!['open', 'resolved'].includes(status)) throw new LicenseServiceError('support_status_invalid', 400);
          const updated = await store.updateSupportDiagnostic(id, status);
          if (!updated) throw new LicenseServiceError('support_case_not_found', 404);
          await safeAudit(store, 'admin_support_updated', updated.licenseId, request, { supportId: id, status });
          return json(200, { support: updated }, currentRequestId);
        }
        const activationCodeMatch = url.pathname.match(/^\/admin\/api\/licenses\/([^/]+)\/activation-code$/);
        if (activationCodeMatch && request.method === 'POST') {
          const id = decodeURIComponent(activationCodeMatch[1]);
          const current = await store.findLicenseById(id);
          if (!current) throw new LicenseServiceError('license_not_found', 404);
          const activationCode = createActivationCode();
          const activationHash = await cryptoProvider.hashActivationCode(activationCode.replace(/[^A-Z0-9]/g, ''));
          const updated = await store.updateLicense(id, {
            activationHash,
            activationHint: activationCode.slice(-5),
            updatedAt: new Date().toISOString(),
          });
          await safeAudit(store, 'admin_activation_code_rotated', id, request);
          return json(200, { license: sanitizeLicense(updated), activationCode }, currentRequestId);
        }
        const licenseMatch = url.pathname.match(/^\/admin\/api\/licenses\/([^/]+)$/);
        if (licenseMatch && request.method === 'PATCH') {
          const id = decodeURIComponent(licenseMatch[1]);
          const current = await store.findLicenseById(id);
          if (!current) throw new LicenseServiceError('license_not_found', 404);
          const input = await readJson(request);
          const normalized = normalizeLicensePatch(input, current);
          const updated = await store.updateLicense(id, { ...normalized, updatedAt: new Date().toISOString() });
          await safeAudit(store, 'admin_license_updated', id, request, {
            fields: Object.keys(input || {}).filter((key) => ['customerName', 'paidUntil', 'status', 'maxDevices', 'leaseDays', 'stores', 'features', 'updateChannel'].includes(key)),
          });
          return json(200, { license: sanitizeLicense(updated) }, currentRequestId);
        }
        const deviceMatch = url.pathname.match(/^\/admin\/api\/licenses\/([^/]+)\/devices\/([a-f0-9]{64})$/i);
        if (deviceMatch && request.method === 'DELETE') {
          const removed = await store.removeDevice(decodeURIComponent(deviceMatch[1]), deviceMatch[2].toLowerCase());
          if (!removed) throw new LicenseServiceError('device_not_found', 404);
          await safeAudit(store, 'admin_device_removed', decodeURIComponent(deviceMatch[1]), request, {
            deviceId: deviceMatch[2].toLowerCase(),
          });
          return json(200, { removed: true }, currentRequestId);
        }
      }
      return json(404, { error: 'not_found', requestId: currentRequestId }, currentRequestId);
    } catch (error) {
      const status = error instanceof LicenseServiceError ? error.status : 500;
      const code = error instanceof LicenseServiceError ? error.code : 'internal_error';
      if (status >= 500) console.error(error);
      if (status >= 500 && store) {
        await safeAudit(store, 'server_error', '', request, { code, requestId: currentRequestId });
      }
      return json(status, { error: code, requestId: currentRequestId }, currentRequestId, {
        retryAfterSeconds: error?.retryAfterSeconds,
      });
    }
  },

  async scheduled(_controller, env) {
    const store = new D1LicenseStore(env.DB);
    const expiredBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const expiredUploads = await store.listExpiredReleaseUploads(expiredBefore);
    for (const pending of expiredUploads) {
      await env.RELEASES.resumeMultipartUpload(pending.objectKey, pending.uploadId).abort().catch(() => {});
      await store.deleteReleaseUpload(pending.releaseId);
    }
    await store.cleanupOperationalData();
  },
};

function serviceStatus(env, databaseOk, currentRequestId) {
  return {
    ok: Boolean(databaseOk),
    service: 'price-monitor-license',
    version: String(env.SERVICE_VERSION || 'unknown').slice(0, 40),
    environment: safeEnvironment(env.ENVIRONMENT),
    database: databaseOk ? 'ready' : 'unavailable',
    recoveryDays: 7,
    time: new Date().toISOString(),
    requestId: currentRequestId,
    telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    releaseStorage: env.RELEASES ? 'ready' : 'unavailable',
  };
}

async function safeTelegramSupport(env, item) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { sent: false, reason: 'telegram_not_configured' };
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: telegramSupportMessage(item) }),
    });
    return response.ok ? { sent: true, reason: '' } : { sent: false, reason: 'telegram_send_failed' };
  } catch (_error) {
    return { sent: false, reason: 'telegram_send_failed' };
  }
}

async function enforceRateLimit(request, url, env, store) {
  if (String(env.RATE_LIMITING_ENABLED || '').toLowerCase() !== 'true') return;
  const policy = rateLimitPolicy(request.method, url.pathname);
  if (!policy) return;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const material = `${safeEnvironment(env.ENVIRONMENT)}|${policy.name}|${ip}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const key = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const result = await store.consumeRateLimit({ key, ...policy });
  if (result.allowed) return;
  await safeAudit(store, 'rate_limited', '', request, {
    route: policy.name,
    retryAfterSeconds: result.retryAfterSeconds,
  });
  const error = new LicenseServiceError('rate_limited', 429);
  error.retryAfterSeconds = result.retryAfterSeconds;
  throw error;
}

async function safeAudit(store, type, licenseId, request, details = {}) {
  try {
    await store.appendEvent({
      type,
      licenseId: licenseId || '',
      deviceId: String(details.deviceId || ''),
      occurredAt: new Date().toISOString(),
      ip: String(request?.headers?.get('CF-Connecting-IP') || '').slice(0, 100),
      details,
    });
  } catch (_error) {
    // Аудит не повинен ламати основну операцію.
  }
}

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

function json(status, body, currentRequestId = '', options = {}) {
  const retryAfterSeconds = Number(options.retryAfterSeconds);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...(currentRequestId ? { 'x-request-id': currentRequestId } : {}),
      ...(Number.isFinite(retryAfterSeconds) ? { 'retry-after': String(Math.max(1, Math.ceil(retryAfterSeconds))) } : {}),
    },
  });
}

function releaseDownload(object, release, currentRequestId) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', 'application/vnd.microsoft.portable-executable');
  headers.set('content-length', String(object.size));
  headers.set('content-disposition', `attachment; filename="${String(release.fileName).replace(/["\r\n]/g, '')}"`);
  headers.set('cache-control', 'private, max-age=300');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-request-id', currentRequestId);
  headers.set('etag', object.httpEtag);
  return new Response(object.body, { status: 200, headers });
}

function sanitizeLicense(record) {
  if (!record) return null;
  const { activationHash: _activationHash, ...safe } = record;
  return safe;
}

function sanitizeRelease(record) {
  if (!record) return null;
  const { objectKey: _objectKey, signature: _signature, ...safe } = record;
  return safe;
}
