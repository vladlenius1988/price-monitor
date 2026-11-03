const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { MAX_INSTALLER_BYTES, UPLOAD_PART_BYTES } = require('./cloud-releases');

async function uploadCloudRelease(options = {}) {
  const sourcePath = path.resolve(String(options.sourcePath || ''));
  const apiBaseUrl = String(options.apiBaseUrl || '').replace(/\/$/, '');
  const adminToken = String(options.adminToken || '').trim();
  const fetchFn = options.fetchFn || globalThis.fetch;
  const progress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  if (!sourcePath || path.extname(sourcePath).toLowerCase() !== '.exe') throw new Error('release_file_invalid');
  if (!/^https:\/\//i.test(apiBaseUrl) || adminToken.length < 8 || typeof fetchFn !== 'function') throw new Error('release_upload_not_configured');
  const stats = await fs.promises.stat(sourcePath).catch(() => null);
  if (!stats?.isFile()) throw new Error('release_file_missing');
  if (stats.size < 1 || stats.size > MAX_INSTALLER_BYTES) throw new Error('release_size_invalid');
  progress({ phase: 'hashing', uploaded: 0, total: stats.size, percent: 0 });
  const sha256 = await sha256File(sourcePath);
  const metadata = {
    version: String(options.version || ''),
    channel: String(options.channel || 'licensed'),
    fileName: path.basename(sourcePath),
    size: stats.size,
    sha256,
    notes: String(options.notes || ''),
    required: Boolean(options.required),
  };
  const initialized = await jsonRequest(fetchFn, `${apiBaseUrl}/admin/api/releases/uploads`, adminToken, {
    method: 'POST', body: JSON.stringify(metadata),
  });
  const releaseId = String(initialized.upload?.releaseId || '');
  const partSize = Number(initialized.upload?.partSize) || UPLOAD_PART_BYTES;
  if (!/^rel_[a-f0-9]+$/i.test(releaseId) || partSize < 5 * 1024 * 1024 || partSize > 10 * 1024 * 1024) {
    if (/^rel_[a-f0-9]+$/i.test(releaseId)) await abortUpload(fetchFn, apiBaseUrl, adminToken, releaseId);
    throw new Error('release_upload_invalid');
  }
  const parts = [];
  let uploaded = 0;
  let file = null;
  try {
    file = await fs.promises.open(sourcePath, 'r');
    for (let partNumber = 1; uploaded < stats.size; partNumber += 1) {
      const length = Math.min(partSize, stats.size - uploaded);
      const buffer = Buffer.allocUnsafe(length);
      const result = await file.read(buffer, 0, length, uploaded);
      if (result.bytesRead !== length) throw new Error('release_file_read_failed');
      const response = await fetchFn(`${apiBaseUrl}/admin/api/releases/uploads/${releaseId}/parts/${partNumber}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(length),
          'x-admin-token': adminToken,
        },
        body: buffer,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.etag) throw new Error(body.error || `release_part_${partNumber}_failed`);
      parts.push({ partNumber, etag: String(body.etag) });
      uploaded += length;
      progress({ phase: 'uploading', uploaded, total: stats.size, percent: Math.round(uploaded * 100 / stats.size) });
    }
  } catch (error) {
    await abortUpload(fetchFn, apiBaseUrl, adminToken, releaseId);
    throw error;
  } finally {
    if (file) await file.close();
  }
  try {
    progress({ phase: 'publishing', uploaded: stats.size, total: stats.size, percent: 100 });
    const completed = await jsonRequest(fetchFn, `${apiBaseUrl}/admin/api/releases/uploads/${releaseId}/complete`, adminToken, {
      method: 'POST', body: JSON.stringify({ parts }),
    });
    progress({ phase: 'complete', uploaded: stats.size, total: stats.size, percent: 100 });
    return completed;
  } catch (error) {
    await abortUpload(fetchFn, apiBaseUrl, adminToken, releaseId);
    throw error;
  }
}

async function jsonRequest(fetchFn, url, token, options = {}) {
  const response = await fetchFn(url, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-admin-token': token, ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `http_${response.status}`);
  return body;
}

async function abortUpload(fetchFn, apiBaseUrl, token, releaseId) {
  if (!releaseId) return;
  await fetchFn(`${apiBaseUrl}/admin/api/releases/uploads/${releaseId}`, {
    method: 'DELETE', headers: { 'x-admin-token': token },
  }).catch(() => {});
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

module.exports = { sha256File, uploadCloudRelease };
