export function createWorkerCrypto(privateKeyBase64) {
  let keyPromise = null;
  return {
    hashActivationCode: async (code) => bytesToHex(await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(String(code)),
    )),
    signLicense: async (payload) => {
      if (!keyPromise) keyPromise = importPrivateKey(privateKeyBase64);
      const key = await keyPromise;
      const signature = await crypto.subtle.sign(
        { name: 'Ed25519' },
        key,
        new TextEncoder().encode(stableStringify(payload)),
      );
      return { payload, signature: bytesToBase64(new Uint8Array(signature)) };
    },
  };
}

export function createActivationCode() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const compact = bytesToHex(bytes).toUpperCase();
  return `PM-${compact.match(/.{1,5}/g).join('-')}`;
}

export function createLicenseId() {
  return `lic_${crypto.randomUUID().replace(/-/g, '')}`;
}

async function importPrivateKey(privateKeyBase64) {
  const pem = new TextDecoder().decode(base64ToBytes(String(privateKeyBase64 || '')));
  const der = base64ToBytes(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ''));
  return crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
