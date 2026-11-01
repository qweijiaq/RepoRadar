-- 每个用户的主列表排名快照：worker 定期预计算，feed 直接按序取切片。
CREATE TABLE IF NOT EXISTS feed_snapshots (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ids BIGINT[] NOT NULL,
  pool_size INTEGER NOT NULL DEFAULT 0,
  built_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feed_snapshots_built ON feed_snapshots (built_at);
