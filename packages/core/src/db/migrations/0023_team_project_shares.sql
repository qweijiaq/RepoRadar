-- 团队共享维护项目：只共享项目引用和最新报告视图，不改变项目原有归属。
CREATE TABLE IF NOT EXISTS team_project_shares (
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project_full_name TEXT NOT NULL,
  shared_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, project_full_name)
);

CREATE INDEX IF NOT EXISTS idx_team_project_shares_project
  ON team_project_shares (project_full_name);
