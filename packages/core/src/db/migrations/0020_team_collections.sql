-- 团队共享收藏集：个人收藏集 team_id 为空，团队收藏集归属一个团队。
ALTER TABLE collections ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES teams(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_collections_team ON collections (team_id, created_at DESC);
