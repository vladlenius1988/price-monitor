const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const privateDirectory = path.join(repositoryRoot, '.license-private');
const privateKeyPath = path.join(privateDirectory, 'production-license-private.pem');
const adminTokenPath = path.join(privateDirectory, 'production-admin-token.txt');
const publicKeyPath = path.join(repositoryRoot, 'license-public-production.pem');
const ownerTokenPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Price Monitor Owner', 'admin-token.txt');

fs.mkdirSync(privateDirectory, { recursive: true });

if (!fs.existsSync(privateKeyPath)) {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}

const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
const publicKeyPem = crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' });
fs.writeFileSync(publicKeyPath, publicKeyPem, 'utf8');

if (!fs.existsSync(adminTokenPath)) {
  fs.writeFileSync(adminTokenPath, `${crypto.randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
}

fs.mkdirSync(path.dirname(ownerTokenPath), { recursive: true });
fs.copyFileSync(adminTokenPath, ownerTokenPath);

console.log('Production secrets are ready. Secret values were not printed.');
console.log(`Public key: ${publicKeyPath}`);
console.log(`Owner token installed: ${ownerTokenPath}`);
