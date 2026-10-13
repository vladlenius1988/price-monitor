const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class ReleaseService {
  constructor({ store, signPayload, releaseDirectory }) {
    this.store = store;
    this.signPayload = signPayload;
    this.releaseDirectory = path.resolve(releaseDirectory);
  }

  async publish(input = {}) {
    const version = normalizeVersion(input.version);
    const channel = normalizeChannel(input.channel);
    const sourcePath = path.resolve(String(input.sourcePath || ''));
    if (!version) throw serviceError('release_version_invalid');
    if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw serviceError('release_file_missing');
    }
    if (path.extname(sourcePath).toLowerCase() !== '.exe') throw serviceError('release_file_invalid');
    fs.mkdirSync(this.releaseDirectory, { recursive: true });
    const id = `rel_${crypto.randomUUID().replace(/-/g, '')}`;
    const fileName = `Price-Monitor-${channel}-${version}-${id.slice(-8)}.exe`;
    const filePath = path.join(this.releaseDirectory, fileName);
    fs.copyFileSync(sourcePath, filePath);
    const stats = fs.statSync(filePath);
    const payload = {
      schemaVersion: 1,
      kind: 'price-monitor-update',
      releaseId: id,
      version,
      channel,
      fileName,
      size: stats.size,
      sha256: sha256File(filePath),
      notes: String(input.notes || '').trim().slice(0, 4000),
      required: Boolean(input.required),
      publishedAt: new Date().toISOString(),
      downloadPath: `/v1/updates/download/${id}`,
    };
    const document = await this.signPayload(payload);
    return this.store.createRelease({ ...payload, signature: document.signature, filePath });
  }

  async latest(channel, currentVersion = '') {
    const releases = await this.store.listReleases(normalizeChannel(channel));
    const release = releases.find((item) => compareVersions(item.version, currentVersion) > 0);
    if (!release) return null;
    const { filePath: _filePath, ...payload } = release;
    const signature = payload.signature;
    delete payload.signature;
    return { payload, signature };
  }

  async download(id) {
    const release = await this.store.findRelease(String(id || ''));
    if (!release || !release.filePath || !fs.existsSync(release.filePath)) return null;
    return release;
  }
}

function compareVersions(left, right) {
  const a = String(left || '').split('.').map((item) => Number.parseInt(item, 10) || 0);
  const b = String(right || '').split('.').map((item) => Number.parseInt(item, 10) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

function normalizeVersion(value) {
  const version = String(value || '').trim();
  return /^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(version) ? version : '';
}

function normalizeChannel(value) {
  const channel = String(value || 'licensed').trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(channel) ? channel : 'licensed';
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function serviceError(code) {
  const error = new Error(code);
  error.code = code;
  error.status = 400;
  return error;
}

module.exports = { ReleaseService, compareVersions };
