CREATE TABLE IF NOT EXISTS repo_translations (
  source_hash TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  translated TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repo_translations_updated ON repo_translations (updated_at DESC);
