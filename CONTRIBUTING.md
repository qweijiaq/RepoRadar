# Contributing

Thanks for helping improve RepoRadar.

## Prerequisites

- Node.js 22+
- pnpm 11
- Docker (for verification and patch sandboxes)
- PostgreSQL 16 with pgvector, or the included Docker Compose service

## Local setup

```bash
docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev:web
```

Set `AUTH_SECRET` in `apps/web/.env.local` or the process environment. For local demo login, set `AUTH_DEV_MODE=1`.

Run the background worker in a second terminal:

```bash
pnpm worker
```

## Checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

Please run all three before opening a pull request. Tests and builds must pass without relying on local secrets.

## Code guidelines

- TypeScript ESM with NodeNext resolution; use `.js` extensions on relative imports in `packages/core`.
- Parameterize SQL; never concatenate user input into queries.
- Keep secrets out of commits, logs, error messages, and screenshots.
- New user-facing configuration should be editable in the UI and persisted, not env-only.
- Global settings must be administrator-only; user data must remain scoped by `user_id`.
- Add tests for parsing, validation, ranking, and security-sensitive logic.
- Do not auto-commit, auto-push, or open PRs from generated patches.

## Pull requests

- Keep changes focused and explain the user-visible outcome.
- Include screenshots for UI changes.
- Note database or environment changes.
- Update README/docs when behavior or configuration changes.
- By contributing, you agree that your contribution is licensed under Apache-2.0.
