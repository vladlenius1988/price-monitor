ALTER TABLE releases ADD COLUMN release_id TEXT NOT NULL DEFAULT '';
ALTER TABLE releases ADD COLUMN file_name TEXT NOT NULL DEFAULT '';
ALTER TABLE releases ADD COLUMN size INTEGER NOT NULL DEFAULT 0;
ALTER TABLE releases ADD COLUMN object_key TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_releases_id ON releases(release_id) WHERE release_id <> '';
CREATE INDEX IF NOT EXISTS idx_releases_channel_time ON releases(channel, published_at);

CREATE TABLE IF NOT EXISTS release_uploads (
  release_id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_release_uploads_created ON release_uploads(created_at);
