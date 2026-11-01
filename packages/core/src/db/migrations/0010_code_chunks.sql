-- 候选仓库的代码片段索引，用于给接入/对比建议提供代码级证据。
CREATE TABLE IF NOT EXISTS code_chunks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo_full_name TEXT NOT NULL,
  path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo_full_name, path, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_code_chunks_repo ON code_chunks (repo_full_name);
CREATE INDEX IF NOT EXISTS idx_code_chunks_updated ON code_chunks (updated_at DESC);
