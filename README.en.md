# RepoRadar

> A personalized radar for open-source projects — discovered, explained, and validated.

RepoRadar watches GitHub and turns noisy project lists into decisions: what deserves your attention, why it fits your stack, and what to do next. It is open source and self-hostable; your data and credentials stay in your own database.

[中文说明](README.md)

## What it does

- **Personalized discovery** — builds a taste profile from your stars, active repositories and recent GitHub events, then ranks candidates with topic, language and diversity constraints.
- **Evidence, not just lists** — every recommendation carries repo metadata, activity signals and an LLM-written explanation. High-scoring projects can be built in a Docker sandbox with logs kept as evidence.
- **Weekly intelligence** — generates a narrative digest of what changed, why it matters and what to try next.
- **Maintainer reports** — analyzes your repositories' health, open issues/PRs and outdated dependencies.
- **Integration suggestions** — given a project you maintain, finds libraries that fill a real gap, with copy-ready briefs for an AI coding agent. Up to five projects and five suggestions per project are analyzed per run.
- **Recommendation library** — `/library` aggregates every historical recommendation by repository with adoption, rejection and pending counts, instead of forcing you to re-read old reports.
- **Watch intents** — describe what you are looking for in one sentence; the AI matches it against a curated pool.
- **Repository management** — batch create, edit and delete your GitHub repositories (requires elevated OAuth scope).
- **Partner chat** — a Copilot that has read your projects, reports and watch intents. Renders Markdown, supports copy and regenerate.
- **Background jobs** — discovery, enrichment, reports, patches, upgrades and verification run as cancellable queued jobs.
- **Production plumbing** — Docker Compose, migrations, backups, quotas, retention, privacy export/deletion, Prometheus metrics, alert emails, hardened sandbox, PWA offline fallback.

## Quick start

```bash
docker compose up -d postgres
pnpm install
cp .env.example .env
# edit .env: AUTH_SECRET, ADMIN_LOGINS, and optionally GITHUB_TOKEN / LLM_API_KEY
pnpm db:migrate
pnpm radar pipeline --topics=llm,ai-agents --limit=20
pnpm dev:web          # http://localhost:3000
pnpm worker           # optional: run queued jobs and scheduled discovery
```

Or run the full stack, including web, worker and migrations:

```bash
cp .env.example .env
# edit .env
docker compose up -d --build
curl -fsS http://localhost:3000/api/health
```

Open `/setup` to configure a GitHub OAuth App, then sign in. The first user (or `ADMIN_LOGINS`) can configure the model provider, SMTP, site URL and quotas from `/settings`.

## GitHub permissions

- Default login scope: `read:user user:email` — enough for public data and taste profiling.
- Repository management, private repository analysis, maintainer reports, issue plans and patch generation require `repo` and `delete_repo`; grant them from `/repos`.

## Scheduled discovery

The worker refreshes the candidate pool every six hours (guarded by a PostgreSQL advisory lock), enriching new repositories with the configured model. Admins can also trigger a refresh from Settings → Candidate pool. Set `DISCOVERY_AUTO=off` to disable automatic runs.

## Deployment and security

- `docker-compose.yml` binds web to `127.0.0.1`; put Caddy/Nginx in front for TLS.
- Sandboxed builds run untrusted repository code with a non-root UID, dropped capabilities, read-only root, tmpfs and cgroup limits. The worker needs the Docker socket for this — isolate it accordingly.
- See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for TLS, backups, migrations, quotas, retention and metrics.
- Security policy: [SECURITY.md](SECURITY.md).

## Tech stack

pnpm monorepo · TypeScript · Next.js 16 (webpack mode) · React 19 · Auth.js · PostgreSQL 16 + pgvector · raw SQL · Docker · Playwright · Vitest.

## License

Apache License 2.0. See [LICENSE](LICENSE).
