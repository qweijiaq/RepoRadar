-- 已接入项目对应的库发布新版本时，记录一条回访，避免重复通知。
CREATE TABLE IF NOT EXISTS integration_impacts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_full_name TEXT NOT NULL,
  suggestion_repo TEXT NOT NULL,
  version TEXT NOT NULL,
  title TEXT,
  url TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, suggestion_repo, version)
);

CREATE INDEX IF NOT EXISTS idx_integration_impacts_user
  ON integration_impacts (user_id, created_at DESC);
