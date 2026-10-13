const crypto = require('crypto');
const { stableStringify } = require('../license-access');

function createNodeCrypto(privateKeyPem) {
  const privateKey = String(privateKeyPem || '');
  if (!privateKey.includes('PRIVATE KEY')) throw new Error('private_key_invalid');
  return {
    hashActivationCode: async (code) => crypto.createHash('sha256').update(String(code), 'utf8').digest('hex'),
    signLicense: async (payload) => ({
      payload,
      signature: crypto.sign(
        null,
        Buffer.from(stableStringify(payload), 'utf8'),
        privateKey,
      ).toString('base64'),
    }),
  };
}

function createActivationCode() {
  const compact = crypto.randomBytes(20).toString('hex').toUpperCase();
  return `PM-${compact.match(/.{1,5}/g).join('-')}`;
}

function createLicenseId() {
  return `lic_${crypto.randomUUID().replace(/-/g, '')}`;
}

module.exports = { createActivationCode, createLicenseId, createNodeCrypto };
