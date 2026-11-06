-- Feed 快照版本：评分版本或快照结构变化时自动让旧快照失效。
ALTER TABLE feed_snapshots ADD COLUMN IF NOT EXISTS version TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS idx_feed_snapshots_version ON feed_snapshots (version, built_at);
