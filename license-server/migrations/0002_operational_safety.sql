CREATE TABLE IF NOT EXISTS request_limits (
  rate_key TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_request_limits_expiry ON request_limits(expires_at);

CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type, occurred_at);
