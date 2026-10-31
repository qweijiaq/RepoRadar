CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS repos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  html_url TEXT NOT NULL,
  homepage TEXT,
  language TEXT,
  topics TEXT[] NOT NULL DEFAULT '{}',
  stars INTEGER NOT NULL DEFAULT 0,
  forks INTEGER NOT NULL DEFAULT 0,
  open_issues INTEGER NOT NULL DEFAULT 0,
  license TEXT,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  is_fork BOOLEAN NOT NULL DEFAULT FALSE,
  pushed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  readme_hash TEXT,
  summary TEXT,
  problem TEXT,
  audience TEXT,
  verdict TEXT,
  reason TEXT,
  quality_score REAL,
  quality_detail JSONB,
  embedding vector(1536),
  enriched_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repos_pending_enrich ON repos (stars DESC) WHERE enriched_at IS NULL;

CREATE TABLE IF NOT EXISTS star_snapshots (
  repo_id BIGINT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  captured_on DATE NOT NULL,
  stars INTEGER NOT NULL,
  PRIMARY KEY (repo_id, captured_on)
);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  query_count INTEGER NOT NULL DEFAULT 0,
  repos_seen INTEGER NOT NULL DEFAULT 0,
  repos_new INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  github_id BIGINT UNIQUE,
  login TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar_url TEXT,
  profile JSONB,
  prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  stars_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_stars (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_full_name TEXT NOT NULL,
  starred_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, repo_full_name)
);

CREATE INDEX IF NOT EXISTS idx_user_stars_repo ON user_stars (repo_full_name);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

CREATE TABLE IF NOT EXISTS feedback (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_full_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('save', 'hide')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, repo_full_name)
);

CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback (user_id);

ALTER TABLE repos ADD COLUMN IF NOT EXISTS verify_status TEXT;
ALTER TABLE repos ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS verifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo_full_name TEXT NOT NULL,
  commit_sha TEXT,
  status TEXT NOT NULL,
  stack TEXT,
  commands JSONB NOT NULL DEFAULT '[]'::jsonb,
  exit_code INTEGER,
  duration_ms INTEGER,
  log_path TEXT,
  log_tail TEXT,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verifications_repo ON verifications (repo_full_name, verified_at DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('topic', 'language', 'author', 'release')),
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, value)
);

CREATE TABLE IF NOT EXISTS release_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo_full_name TEXT NOT NULL,
  tag TEXT NOT NULL,
  name TEXT,
  url TEXT,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo_full_name, tag)
);

CREATE INDEX IF NOT EXISTS idx_release_events_repo ON release_events (repo_full_name, published_at DESC);

CREATE TABLE IF NOT EXISTS user_signals (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_full_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('star', 'owned', 'event')),
  weight REAL NOT NULL DEFAULT 1,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, repo_full_name, source)
);

CREATE INDEX IF NOT EXISTS idx_user_signals_user ON user_signals (user_id);

CREATE TABLE IF NOT EXISTS issue_drafts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  html TEXT NOT NULL,
  markdown TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issue_drafts_user ON issue_drafts (user_id, created_at DESC);

ALTER TABLE issue_drafts ADD COLUMN IF NOT EXISTS summary JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inbox_seen_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS collections (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  repo_full_name TEXT NOT NULL,
  note TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, repo_full_name)
);

CREATE INDEX IF NOT EXISTS idx_collections_user ON collections (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_projects (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_full_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'owned',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_pushed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, repo_full_name)
);

CREATE TABLE IF NOT EXISTS integration_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integration_reports_user ON integration_reports (user_id, created_at DESC);


CREATE TABLE IF NOT EXISTS maintainer_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maintainer_reports_user ON maintainer_reports (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS discoverability_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_full_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discoverability_reports_user
  ON discoverability_reports (user_id, repo_full_name, created_at DESC);

CREATE TABLE IF NOT EXISTS comparison_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_full_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comparison_reports_user
  ON comparison_reports (user_id, project_full_name, created_at DESC);

CREATE TABLE IF NOT EXISTS watch_intents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watch_intents_user ON watch_intents (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS watch_matches (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  intent_id BIGINT NOT NULL REFERENCES watch_intents(id) ON DELETE CASCADE,
  repo_full_name TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (intent_id, repo_full_name)
);

CREATE INDEX IF NOT EXISTS idx_watch_matches_intent ON watch_matches (intent_id, score DESC);

CREATE TABLE IF NOT EXISTS integration_outcomes (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_full_name TEXT NOT NULL,
  suggestion_repo TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('adopted', 'rejected')),
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_full_name, suggestion_repo)
);

CREATE TABLE IF NOT EXISTS issue_plans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_full_name TEXT NOT NULL,
  issue_number INT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issue_plans_user
  ON issue_plans (user_id, repo_full_name, issue_number, created_at DESC);

CREATE TABLE IF NOT EXISTS feed_dismissals (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('too-broad', 'too-official', 'not-my-stack', 'already-known', 'other')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_feed_dismissals_user ON feed_dismissals (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feed_statuses (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('done')),
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_feed_statuses_user ON feed_statuses (user_id, updated_at DESC);

ALTER TABLE issue_drafts ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE issue_drafts ADD COLUMN IF NOT EXISTS provider_id TEXT;

CREATE TABLE IF NOT EXISTS watch_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  intent_id BIGINT NOT NULL REFERENCES watch_intents(id) ON DELETE CASCADE,
  model TEXT,
  provider_id TEXT,
  match_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watch_runs_intent ON watch_runs (intent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  progress TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_user ON ai_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_active ON ai_jobs (status) WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS copilot_threads (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_copilot_threads_user ON copilot_threads (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS copilot_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id BIGINT NOT NULL REFERENCES copilot_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  model TEXT,
  provider_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_copilot_messages_thread ON copilot_messages (thread_id, created_at);

CREATE TABLE IF NOT EXISTS activity_sync_state (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_full_name TEXT NOT NULL,
  initialized BOOLEAN NOT NULL DEFAULT FALSE,
  last_synced_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, repo_full_name)
);

CREATE TABLE IF NOT EXISTS activity_seen (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_full_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  actor TEXT,
  title TEXT,
  url TEXT,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, repo_full_name, kind, external_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_seen_user ON activity_seen (user_id, seen_at DESC);

ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 2;
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
ALTER TABLE ai_jobs DROP CONSTRAINT IF EXISTS ai_jobs_status_check;
ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_status_check
  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'));

CREATE TABLE IF NOT EXISTS feed_impressions (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_full_name TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, repo_full_name)
);

CREATE INDEX IF NOT EXISTS idx_feed_impressions_user ON feed_impressions (user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS llm_usage (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id BIGINT,
  kind TEXT NOT NULL,
  provider_id TEXT,
  model TEXT NOT NULL,
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_user ON llm_usage (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS radar_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_queue (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'push')),
  subject TEXT NOT NULL,
  body TEXT,
  body_html TEXT,
  url TEXT,
  dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_delivery_queue_pending ON delivery_queue (status, created_at) WHERE status = 'queued';
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_queue_dedupe ON delivery_queue (user_id, channel, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS patch_drafts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo_full_name TEXT NOT NULL,
  issue_number INT,
  title TEXT NOT NULL,
  summary TEXT,
  patch TEXT NOT NULL,
  files JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation JSONB,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patch_drafts_user ON patch_drafts (user_id, created_at DESC);

ALTER TABLE delivery_queue ADD COLUMN IF NOT EXISTS body_html TEXT;
ALTER TABLE delivery_queue ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS github_tokens (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
