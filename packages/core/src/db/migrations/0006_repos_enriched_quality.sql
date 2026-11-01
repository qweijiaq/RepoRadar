-- feed 每次都按质量分取前 N 个已富化仓库，数据量上来后避免全表排序。
CREATE INDEX IF NOT EXISTS idx_repos_enriched_quality
  ON repos (quality_score DESC NULLS LAST)
  WHERE enriched_at IS NOT NULL;
