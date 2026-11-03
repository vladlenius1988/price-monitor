const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { uploadCloudRelease } = require('../cloud-release-uploader');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const baseUrl = 'https://price-monitor-license-production.vladlenius.workers.dev';
const token = fs.readFileSync(path.join(repositoryRoot, '.license-private', 'production-admin-token.txt'), 'utf8').trim();

async function main() {
  if (!process.argv.includes('--confirm')) {
    throw new Error('Run with --confirm. The script publishes and removes one temporary smoke release.');
  }
  const sourcePath = path.join(os.tmpdir(), `price-monitor-release-smoke-${crypto.randomUUID()}.exe`);
  const contents = Buffer.from(`PRICE MONITOR RELEASE STORAGE SMOKE ${new Date().toISOString()}\n`, 'utf8');
  let releaseId = '';
  try {
    await fs.promises.writeFile(sourcePath, contents);
    const published = await uploadCloudRelease({
      sourcePath,
      apiBaseUrl: baseUrl,
      adminToken: token,
      version: `0.0.${Date.now()}`,
      channel: 'smoke',
      notes: 'Temporary production storage smoke test',
    });
    releaseId = String(published.release?.releaseId || '');
    if (!releaseId) throw new Error('release_id_missing');
    const downloaded = await fetch(`${baseUrl}${published.release.downloadPath}`);
    if (!downloaded.ok) throw new Error(`download_http_${downloaded.status}`);
    const actual = Buffer.from(await downloaded.arrayBuffer());
    if (!actual.equals(contents)) throw new Error('download_contents_mismatch');
    const overview = await request('/admin/api/overview');
    if (!(overview.releases || []).some((item) => item.releaseId === releaseId && item.channel === 'smoke')) {
      throw new Error('release_not_visible');
    }
    console.log(JSON.stringify({ ok: true, releaseId, bytes: actual.length, listed: true }));
  } finally {
    await fs.promises.rm(sourcePath, { force: true }).catch(() => {});
    if (releaseId) await request(`/admin/api/releases/${encodeURIComponent(releaseId)}`, { method: 'DELETE' }).catch(() => {});
  }
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { 'x-admin-token': token, ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${body.error || `http_${response.status}`} ${body.requestId || ''}`.trim());
  return body;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
