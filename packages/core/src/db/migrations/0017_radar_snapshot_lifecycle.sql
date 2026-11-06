-- 分享快照生命周期：支持过期和手动撤销。
ALTER TABLE radar_snapshots ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE radar_snapshots ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

UPDATE radar_snapshots
SET expires_at = created_at + INTERVAL '90 days'
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_radar_snapshots_user ON radar_snapshots (user_id, created_at DESC);
