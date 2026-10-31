#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

file="${1:-}"
if [[ -z "$file" || ! -f "$file" ]]; then
  echo "用法：CONFIRM=YES pnpm db:restore <backup.dump>" >&2
  exit 1
fi
if [[ "${CONFIRM:-}" != "YES" ]]; then
  echo "恢复会覆盖当前数据库，请先备份，再用 CONFIRM=YES 重试：" >&2
  echo "  CONFIRM=YES pnpm db:restore $file" >&2
  exit 1
fi

if [[ -f "$file.sha256" ]]; then
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  else
    actual="$(sha256sum "$file" | awk '{print $1}')"
  fi
  expected="$(tr -d '[:space:]' < "$file.sha256")"
  if [[ "$actual" != "$expected" ]]; then
    echo "校验失败：备份文件 checksum 不匹配。" >&2
    exit 1
  fi
fi

if [[ -f .env && -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
fi

if command -v pg_restore >/dev/null 2>&1 && [[ -n "${DATABASE_URL:-}" ]]; then
  pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" "$file"
elif docker compose ps postgres >/dev/null 2>&1; then
  docker compose exec -T postgres pg_restore \
    -U "${POSTGRES_USER:-radar}" \
    --clean \
    --if-exists \
    --no-owner \
    --dbname "${POSTGRES_DB:-radar}" < "$file"
else
  echo "找不到 pg_restore，也没有可用的 Compose postgres 服务。" >&2
  exit 1
fi

echo "恢复完成：$file"
