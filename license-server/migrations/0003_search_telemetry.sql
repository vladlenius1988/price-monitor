CREATE TABLE IF NOT EXISTS search_metrics (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  store TEXT NOT NULL CHECK (store IN ('eva', 'varus', 'makeup', 'aurora', 'notino', 'rozetka')),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'error', 'cancelled')),
  duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 0 AND 86400000),
  product_count INTEGER NOT NULL DEFAULT 0 CHECK (product_count BETWEEN 0 AND 1000000),
  app_version TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_metrics_time ON search_metrics(occurred_at);
CREATE INDEX IF NOT EXISTS idx_search_metrics_license_time ON search_metrics(license_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_search_metrics_store_time ON search_metrics(store, occurred_at);
