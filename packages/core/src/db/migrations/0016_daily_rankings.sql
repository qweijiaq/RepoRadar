-- 每日榜单持久化，支持按日期回看。
CREATE TABLE IF NOT EXISTS daily_rankings (
  date_key DATE PRIMARY KEY,
  basis TEXT NOT NULL,
  previous_date DATE,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
