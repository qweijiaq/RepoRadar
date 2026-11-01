ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS prompt_version TEXT;
ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS score_version TEXT;
ALTER TABLE issue_drafts ADD COLUMN IF NOT EXISTS prompt_version TEXT;
ALTER TABLE watch_runs ADD COLUMN IF NOT EXISTS prompt_version TEXT;
