-- 接入回访现在同时记录新版本和安全公告。
ALTER TABLE integration_impacts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'release';
