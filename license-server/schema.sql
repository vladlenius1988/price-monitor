PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  activation_hash TEXT NOT NULL UNIQUE,
  activation_hint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  paid_until TEXT NOT NULL,
  max_devices INTEGER NOT NULL DEFAULT 1 CHECK (max_devices >= 1),
  lease_days INTEGER NOT NULL DEFAULT 14 CHECK (lease_days BETWEEN 1 AND 90),
  stores_json TEXT NOT NULL,
  features_json TEXT NOT NULL,
  update_channel TEXT NOT NULL DEFAULT 'licensed',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'removed')),
  app_version TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  removed_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (license_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_devices_license_status ON devices(license_id, status);

CREATE TABLE IF NOT EXISTS releases (
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  installer_url TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  signature TEXT NOT NULL,
  mandatory INTEGER NOT NULL DEFAULT 0,
  minimum_version TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL,
  PRIMARY KEY (channel, version)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  license_id TEXT NOT NULL DEFAULT '',
  device_id TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_events_license_time ON events(license_id, occurred_at);

CREATE TABLE IF NOT EXISTS barcode_mappings (
  store TEXT NOT NULL,
  store_product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL DEFAULT '',
  ean TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  variant_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('verified', 'probable', 'unverified')),
  verified_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (store, store_product_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_barcode_ean ON barcode_mappings(ean);
