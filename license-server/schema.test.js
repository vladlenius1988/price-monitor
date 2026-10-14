const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const expectedLicenseStatuses = ['pending', 'active', 'suspended', 'revoked'];
const schemaFiles = [
  path.join(__dirname, 'schema.sql'),
  path.join(__dirname, 'migrations', '0001_initial.sql')
];

for (const schemaFile of schemaFiles) {
  test(`${path.basename(schemaFile)} accepts every supported license status`, () => {
    const sql = fs.readFileSync(schemaFile, 'utf8');
    const match = sql.match(/CREATE TABLE IF NOT EXISTS licenses[\s\S]*?CHECK \(status IN \(([^)]+)\)\)/);

    assert.ok(match, `License status constraint is missing in ${schemaFile}`);

    const statuses = match[1]
      .split(',')
      .map((value) => value.trim().replace(/^'|'$/g, ''));

    assert.deepEqual(statuses, expectedLicenseStatuses);
  });
}
