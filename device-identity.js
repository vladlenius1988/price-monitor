const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DEVICE_NAMESPACE = 'price-monitor-device-v1';

function getDeviceId() {
  const source = process.platform === 'win32'
    ? readWindowsMachineGuid()
    : `${os.platform()}|${os.hostname()}|${os.arch()}`;
  if (!source) throw new Error('device_id_unavailable');
  return crypto.createHash('sha256').update(`${DEVICE_NAMESPACE}|${source.trim().toLowerCase()}`).digest('hex');
}

function getDeviceCode(deviceId = getDeviceId()) {
  const compact = String(deviceId || '').replace(/[^a-f0-9]/gi, '').toUpperCase().slice(0, 16);
  if (compact.length !== 16) return '';
  return compact.match(/.{1,4}/g).join('-');
}

function readWindowsMachineGuid() {
  const windowsDirectory = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const regPath = path.join(windowsDirectory, 'System32', 'reg.exe');
  const output = execFileSync(regPath, [
    'query',
    'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
    '/v',
    'MachineGuid',
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
  return match ? match[1].trim() : '';
}

module.exports = { getDeviceCode, getDeviceId };
