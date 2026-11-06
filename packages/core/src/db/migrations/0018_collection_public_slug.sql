-- 公开收藏集使用随机 slug，避免自增 ID 被枚举。
ALTER TABLE collections ADD COLUMN IF NOT EXISTS public_slug TEXT;

UPDATE collections
SET public_slug = substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 12)
WHERE public_slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_public_slug
  ON collections (public_slug)
  WHERE public_slug IS NOT NULL;
