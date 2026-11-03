const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { sha256File, uploadCloudRelease } = require('./cloud-release-uploader');

test('hashes and uploads a release through init, part and complete requests', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'price-monitor-cloud-upload-'));
  const filePath = path.join(directory, 'Price Monitor Online Setup 4.28.0.exe');
  const contents = Buffer.from('test installer bytes');
  fs.writeFileSync(filePath, contents);
  const calls = [];
  const progress = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body });
    if (url.endsWith('/admin/api/releases/uploads')) return response(200, { upload: { releaseId: `rel_${'a'.repeat(32)}`, partSize: 8 * 1024 * 1024 } });
    if (url.includes('/parts/1')) return response(200, { etag: 'etag-part-0001' });
    if (url.endsWith('/complete')) return response(200, { release: { version: '4.28.0', channel: 'licensed' } });
    return response(500, { error: 'unexpected' });
  };
  try {
    assert.equal(await sha256File(filePath), crypto.createHash('sha256').update(contents).digest('hex'));
    const result = await uploadCloudRelease({
      sourcePath: filePath, apiBaseUrl: 'https://example.test', adminToken: 'owner-secret-token',
      version: '4.28.0', channel: 'licensed', notes: 'Test', fetchFn,
      onProgress: (item) => progress.push(item.phase),
    });
    assert.equal(result.release.version, '4.28.0');
    assert.deepEqual(calls.map((item) => item.method), ['POST', 'PUT', 'POST']);
    const init = JSON.parse(calls[0].body);
    assert.equal(init.sha256, crypto.createHash('sha256').update(contents).digest('hex'));
    assert.equal(Buffer.compare(calls[1].body, contents), 0);
    assert.deepEqual(JSON.parse(calls[2].body).parts, [{ partNumber: 1, etag: 'etag-part-0001' }]);
    assert.deepEqual(progress, ['hashing', 'uploading', 'publishing', 'complete']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
