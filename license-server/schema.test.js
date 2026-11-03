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

test('D1 license updates persist regenerated activation codes', () => {
  const source = fs.readFileSync(path.join(__dirname, 'd1-store.mjs'), 'utf8');
  assert.match(source, /activation_hash = \?3/);
  assert.match(source, /activation_hint = \?4/);
  assert.match(source, /record\.activationHash/);
  assert.match(source, /record\.activationHint/);
});

test('operational safety migration adds durable rate limits and event indexes', () => {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, 'migrations', '0002_operational_safety.sql'), 'utf8');
  for (const source of [schema, migration]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS request_limits/);
    assert.match(source, /idx_request_limits_expiry/);
    assert.match(source, /idx_events_type_time/);
  }
});

test('search telemetry schema is deduplicated, bounded and indexed without query fields', () => {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, 'migrations', '0003_search_telemetry.sql'), 'utf8');
  for (const source of [schema, migration]) {
    const table = source.match(/CREATE TABLE IF NOT EXISTS search_metrics[\s\S]*?\n\);/)?.[0] || '';
    assert.match(table, /CREATE TABLE IF NOT EXISTS search_metrics/);
    assert.match(table, /id TEXT PRIMARY KEY/);
    assert.match(source, /idx_search_metrics_license_time/);
    assert.doesNotMatch(table, /search_query|brand_name|product_name|barcode/);
  }
});

test('support diagnostics schema stores only bounded technical data without commercial fields', () => {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, 'migrations', '0004_support_diagnostics.sql'), 'utf8');
  for (const source of [schema, migration]) {
    const table = source.match(/CREATE TABLE IF NOT EXISTS support_diagnostics[\s\S]*?\n\);/)?.[0] || '';
    assert.match(table, /repeat_count INTEGER/);
    assert.match(table, /status TEXT NOT NULL/);
    assert.match(source, /idx_support_fingerprint/);
    assert.doesNotMatch(table, /search_query|brand_name|product_name|price|barcode|ean|gtin/i);
  }
});

test('cloud release migration stores signed manifests and resumable upload state', () => {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, 'migrations', '0005_cloud_releases.sql'), 'utf8');
  assert.match(schema, /release_id TEXT NOT NULL UNIQUE/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS release_uploads/);
  assert.match(schema, /idx_release_uploads_created/);
  assert.match(migration, /ALTER TABLE releases ADD COLUMN release_id/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS release_uploads/);
});
