const MAX_INSTALLER_BYTES = 500 * 1024 * 1024;
const MAX_UPLOAD_PART_BYTES = 10 * 1024 * 1024;
const UPLOAD_PART_BYTES = 8 * 1024 * 1024;

function normalizeReleaseMetadata(input = {}) {
  const version = normalizeVersion(input.version);
  const channel = normalizeChannel(input.channel);
  const fileName = normalizeFileName(input.fileName);
  const size = Math.round(Number(input.size) || 0);
  const sha256 = String(input.sha256 || '').trim().toLowerCase();
  const notes = String(input.notes || '').trim().slice(0, 4000);
  if (!version) return invalid('release_version_invalid');
  if (!channel) return invalid('release_channel_invalid');
  if (!fileName) return invalid('release_file_invalid');
  if (size < 1 || size > MAX_INSTALLER_BYTES) return invalid('release_size_invalid');
  if (!/^[a-f0-9]{64}$/.test(sha256)) return invalid('release_hash_invalid');
  return { ok: true, value: { version, channel, fileName, size, sha256, notes, required: Boolean(input.required) } };
}

function normalizeUpdateCheck(input = {}) {
  const licenseId = String(input.licenseId || '').trim();
  const deviceId = String(input.deviceId || '').trim().toLowerCase();
  const currentVersion = normalizeVersion(input.currentVersion);
  const channel = normalizeChannel(input.channel);
  if (!/^[a-z0-9_-]{8,80}$/i.test(licenseId)) return invalid('license_id_invalid');
  if (!/^[a-f0-9]{64}$/.test(deviceId)) return invalid('device_id_invalid');
  if (!currentVersion) return invalid('current_version_invalid');
  if (!channel) return invalid('release_channel_invalid');
  return { ok: true, value: { licenseId, deviceId, currentVersion, channel } };
}

function createUpdatePayload(record = {}) {
  return {
    schemaVersion: 1,
    kind: 'price-monitor-update',
    releaseId: String(record.releaseId || ''),
    version: String(record.version || ''),
    channel: String(record.channel || ''),
    fileName: String(record.fileName || ''),
    size: Math.round(Number(record.size) || 0),
    sha256: String(record.sha256 || '').toLowerCase(),
    notes: String(record.notes || ''),
    required: Boolean(record.required),
    publishedAt: String(record.publishedAt || ''),
    downloadPath: `/v1/updates/download/${String(record.releaseId || '')}`,
  };
}

function compareVersions(left, right) {
  const a = String(left || '').split(/[.+-]/).map((item) => Number.parseInt(item, 10) || 0);
  const b = String(right || '').split(/[.+-]/).map((item) => Number.parseInt(item, 10) || 0);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

function validateCompletedParts(parts, expectedSize, partSize = UPLOAD_PART_BYTES) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 100) return invalid('release_parts_invalid');
  const expectedCount = Math.ceil(Number(expectedSize) / Number(partSize));
  if (parts.length !== expectedCount) return invalid('release_parts_incomplete');
  const normalized = [];
  for (let index = 0; index < parts.length; index += 1) {
    const item = parts[index] || {};
    const partNumber = Number(item.partNumber);
    const etag = String(item.etag || '').trim();
    if (partNumber !== index + 1 || !/^[a-z0-9"_-]{8,200}$/i.test(etag)) return invalid('release_parts_invalid');
    normalized.push({ partNumber, etag });
  }
  return { ok: true, value: normalized };
}

function normalizeVersion(value) {
  const version = String(value || '').trim();
  return /^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(version) ? version : '';
}

function normalizeChannel(value) {
  const channel = String(value || 'licensed').trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(channel) ? channel : '';
}

function normalizeFileName(value) {
  const fileName = String(value || '').trim().replace(/[\\/\r\n"]/g, '').slice(0, 180);
  return fileName && fileName.toLowerCase().endsWith('.exe') ? fileName : '';
}

function invalid(reason) { return { ok: false, reason }; }

module.exports = {
  MAX_INSTALLER_BYTES,
  MAX_UPLOAD_PART_BYTES,
  UPLOAD_PART_BYTES,
  compareVersions,
  createUpdatePayload,
  normalizeReleaseMetadata,
  normalizeUpdateCheck,
  validateCompletedParts,
};
