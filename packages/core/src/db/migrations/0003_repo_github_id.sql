ALTER TABLE repos ADD COLUMN IF NOT EXISTS github_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_repos_github_id
  ON repos (github_id)
  WHERE github_id IS NOT NULL;
