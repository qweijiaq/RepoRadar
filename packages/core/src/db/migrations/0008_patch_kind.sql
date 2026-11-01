-- 区分「Issue 修复补丁」和「接入预演补丁」，共用 patch_drafts 的展示与验证结果。
ALTER TABLE patch_drafts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'issue';

CREATE INDEX IF NOT EXISTS idx_patch_drafts_kind
  ON patch_drafts (user_id, kind, created_at DESC);
