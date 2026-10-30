CREATE TABLE IF NOT EXISTS support_diagnostics (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  app_version TEXT NOT NULL DEFAULT '',
  app_edition TEXT NOT NULL DEFAULT 'licensed',
  generated_at TEXT NOT NULL,
  system_json TEXT NOT NULL DEFAULT '{}',
  access_json TEXT NOT NULL DEFAULT '{}',
  server_json TEXT NOT NULL DEFAULT '{}',
  stores_json TEXT NOT NULL DEFAULT '[]',
  events_json TEXT NOT NULL DEFAULT '[]',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  repeat_count INTEGER NOT NULL DEFAULT 1 CHECK (repeat_count >= 1),
  resolved_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_support_status_time ON support_diagnostics(status, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_support_license_time ON support_diagnostics(license_id, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_support_fingerprint ON support_diagnostics(license_id, device_id, fingerprint, status);
