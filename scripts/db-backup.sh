#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env && -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out_dir="${BACKUP_DIR:-backups}"
mkdir -p "$out_dir"
out="$out_dir/repo-radar-$stamp.dump"
tmp="$out.partial"
trap 'rm -f "$tmp"' ERR

if command -v pg_dump >/dev/null 2>&1 && [[ -n "${DATABASE_URL:-}" ]]; then
  pg_dump --format=custom --no-owner --file "$tmp" "$DATABASE_URL"
elif docker compose ps postgres >/dev/null 2>&1; then
  docker compose exec -T postgres pg_dump \
    -U "${POSTGRES_USER:-radar}" \
    --format=custom \
    --no-owner \
    "${POSTGRES_DB:-radar}" > "$tmp"
else
  echo "找不到 pg_dump，也没有可用的 Compose postgres 服务。" >&2
  echo "请在装有 PostgreSQL 客户端的机器上运行，或使用 docker compose exec postgres pg_dump。" >&2
  exit 1
fi

mv "$tmp" "$out"
trap - ERR

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$out" | awk '{print $1}' > "$out.sha256"
else
  sha256sum "$out" | awk '{print $1}' > "$out.sha256"
fi

echo "备份已写入：$out"
echo "校验文件：$out.sha256"
