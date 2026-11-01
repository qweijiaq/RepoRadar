# Contributing

Thanks for helping improve RepoRadar.

## Prerequisites

- Node.js 22+
- pnpm 11
- Docker (for verification and patch sandboxes)
- PostgreSQL 16 with pgvector, or the included Docker Compose service

## Local setup

```bash
docker compose up -d postgres
pnpm install
pnpm db:migrate
pnpm dev:web
```

Set `AUTH_SECRET` in `apps/web/.env.local` or the process environment. For local demo login, set `AUTH_DEV_MODE=1`.

Database changes go in a new numbered file under `packages/core/src/db/migrations/`; never edit a migration that has already been applied. `pnpm db:migrate` records versions and checksums in `schema_migrations`.

Run the background worker in a second terminal:

```bash
pnpm worker
```

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
TEST_DATABASE_URL=postgres://radar:radar@localhost:5433/radar pnpm test:db
pnpm build
pnpm test:e2e
```

`pnpm lint` must pass with zero warnings; `pnpm test:db` runs real SQL against a temporary `radar_integration` schema and cleans it up afterwards. `pnpm format` is available but not enforced in CI yet — avoid mixing large formatting-only diffs into feature pull requests.

E2E tests use Playwright with the local Google Chrome channel; CI installs Chromium. The Playwright server runs in development mode on an isolated `.next-e2e` dist directory, so it can run alongside `pnpm dev:web`.

Next.js 16 runs with the webpack mode (`next dev --webpack` / `next build --webpack`) because `packages/core` uses NodeNext `.js` import specifiers and `next.config.ts` supplies a webpack extension alias. Keep those flags unless the core package is migrated to a Turbopack-compatible resolution strategy.

Please run all of them before opening a pull request. Tests and builds must pass without relying on local secrets.

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
