-- AI 生成的结构化功能画像，按 README/manifest 的 hash 缓存。
CREATE TABLE IF NOT EXISTS repo_profiles (
  repo_full_name TEXT PRIMARY KEY,
  positioning TEXT NOT NULL,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  use_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
  not_for JSONB NOT NULL DEFAULT '[]'::jsonb,
  quickstart JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_hash TEXT,
  model TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
