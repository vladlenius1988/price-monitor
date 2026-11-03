const assert = require('node:assert/strict');
const test = require('node:test');
const {
  UPLOAD_PART_BYTES, compareVersions, createUpdatePayload,
  normalizeReleaseMetadata, normalizeUpdateCheck, validateCompletedParts,
} = require('./cloud-releases');

test('normalizes a bounded Windows release without trusting a source path', () => {
  const result = normalizeReleaseMetadata({
    version: '4.28.0', channel: 'licensed', fileName: 'Price Monitor Online Setup 4.28.0.exe',
    size: 106_000_000, sha256: 'a'.repeat(64), notes: 'Хмарне оновлення', required: false,
    sourcePath: 'D:\\secret\\installer.exe',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.version, '4.28.0');
  assert.equal(result.value.required, false);
  assert.equal('sourcePath' in result.value, false);
  assert.equal(normalizeReleaseMetadata({ ...result.value, sha256: 'wrong' }).reason, 'release_hash_invalid');
});

test('validates update checks and compares semantic numeric versions', () => {
  const check = normalizeUpdateCheck({
    licenseId: 'lic_1234567890', deviceId: 'b'.repeat(64), currentVersion: '4.27.0', channel: 'licensed',
  });
  assert.equal(check.ok, true);
  assert.equal(compareVersions('4.28.0', '4.27.9'), 1);
  assert.equal(compareVersions('4.28.0', '4.28.0'), 0);
  assert.equal(compareVersions('4.27.9', '4.28.0'), -1);
});

test('creates the exact signed client payload and requires every uploaded part', () => {
  const record = {
    releaseId: `rel_${'a'.repeat(32)}`, version: '4.28.0', channel: 'licensed',
    fileName: 'Price Monitor Online Setup 4.28.0.exe', size: UPLOAD_PART_BYTES + 20,
    sha256: 'c'.repeat(64), notes: 'Ready', required: true, publishedAt: '2026-11-02T10:00:00.000Z',
  };
  const payload = createUpdatePayload(record);
  assert.equal(payload.downloadPath, `/v1/updates/download/${record.releaseId}`);
  assert.equal(payload.kind, 'price-monitor-update');
  assert.equal(validateCompletedParts([
    { partNumber: 1, etag: 'etag-part-0001' }, { partNumber: 2, etag: 'etag-part-0002' },
  ], record.size).ok, true);
  assert.equal(validateCompletedParts([{ partNumber: 1, etag: 'etag-part-0001' }], record.size).reason, 'release_parts_incomplete');
});
