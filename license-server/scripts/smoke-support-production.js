const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const baseUrl = 'https://price-monitor-license-production.vladlenius.workers.dev';
const token = fs.readFileSync(path.join(repositoryRoot, '.license-private', 'production-admin-token.txt'), 'utf8').trim();
const cleanupIdPath = path.join(repositoryRoot, '.license-private', 'production-support-smoke-id.txt');

async function main() {
  if (!process.argv.includes('--confirm')) throw new Error('Run with --confirm. The script creates one temporary support case.');
  const before = await request('/admin/api/overview', { headers: { 'x-admin-token': token } });
  const license = (before.licenses || []).find((item) => item.status === 'active'
    && (item.devices || []).some((device) => device.status === 'active'));
  if (!license) throw new Error('active_device_not_found');
  const device = license.devices.find((item) => item.status === 'active');
  const reportId = crypto.randomUUID();
  fs.writeFileSync(cleanupIdPath, `${reportId}\n`, 'utf8');
  const submitted = await request('/v1/support/diagnostics', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      reportId,
      licenseId: license.id,
      deviceId: device.deviceId,
      appVersion: '4.27.0',
      appEdition: 'licensed',
      generatedAt: new Date().toISOString(),
      system: { platform: 'win32', release: '10.0.19045', arch: 'x64', locale: 'uk-UA' },
      access: { allowed: true, blockedReason: '', onlineConfigured: true, expiresAt: '', lastOnlineSuccessAt: '' },
      server: { checked: true, available: true, reason: '' },
      stores: ['eva'],
      events: [{ at: new Date().toISOString(), area: 'server', outcome: 'warning', code: 'server_check_failed', store: '' }],
    }),
  });
  if (!submitted.accepted || submitted.caseId !== reportId) throw new Error('support_not_accepted');
  const overview = await request('/admin/api/overview', { headers: { 'x-admin-token': token } });
  const visible = (overview.support || []).find((item) => item.id === reportId);
  if (!visible || visible.status !== 'open' || visible.appVersion !== '4.27.0') throw new Error('support_not_visible');
  const resolved = await request(`/admin/api/support/${encodeURIComponent(reportId)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify({ status: 'resolved' }),
  });
  if (resolved.support?.status !== 'resolved') throw new Error('support_not_resolved');
  console.log(JSON.stringify({ ok: true, supportId: reportId, visible: true, resolved: true }));
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${body.error || `http_${response.status}`} ${body.requestId || ''}`.trim());
  return body;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
