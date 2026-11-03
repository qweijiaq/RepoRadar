-- GitHub 没有设置 topics 时，用 AI 从 README/摘要推断的标签。
ALTER TABLE repos ADD COLUMN IF NOT EXISTS inferred_topics TEXT[] NOT NULL DEFAULT '{}';
