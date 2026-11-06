-- 团队维护摘要邮件开关。
ALTER TABLE teams ADD COLUMN IF NOT EXISTS digest_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_teams_digest ON teams (digest_enabled) WHERE digest_enabled = TRUE;
