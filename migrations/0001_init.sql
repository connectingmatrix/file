CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  organization_id TEXT,
  path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT,
  size BIGINT NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'memory',
  storage_metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_org ON files(organization_id);
