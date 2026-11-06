-- 团队共享关注意图：个人意图 team_id 为空，团队意图归属一个团队。
ALTER TABLE watch_intents ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES teams(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_watch_intents_team ON watch_intents (team_id, created_at DESC);
