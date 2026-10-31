# Security Policy

## Supported versions

Security fixes are applied to the `main` branch. There are no maintained release branches yet.

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Use GitHub's private vulnerability reporting on this repository:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include affected version/commit, reproduction steps, impact, and any suggested fix.

If private reporting is unavailable, contact the maintainers through the address listed in the repository profile.

We will acknowledge a report as soon as possible and coordinate disclosure after a fix is available.

## Scope

Reports are especially useful for:

- authentication or session handling;
- IDOR / access to another user's reports, tokens, notifications, or patches;
- encrypted-secret handling and key management;
- GitHub webhook signature verification;
- SSRF or command injection in repository, dependency, or patch flows;
- Docker sandbox escape or host access from generated builds;
- XSS in generated HTML, email templates, or public snapshot pages;
- privilege escalation between regular users and administrators.

## Deployment safety

Operators must:

- set a strong `AUTH_SECRET` and keep it stable; rotating it makes encrypted data unreadable;
- set `ADMIN_LOGINS` explicitly on public deployments;
- set `SETUP_TOKEN` before exposing a fresh instance to the internet;
- keep `AUTH_DEV_MODE` disabled in production;
- run the worker with Docker isolation, and never expose the Docker socket to the web process;
- isolate the Docker sandbox from databases, internal networks, and host secrets.

## Sandbox warning

Patch generation, dependency upgrades, and repository verification execute untrusted repository code inside Docker. The current sandbox limits memory, CPU, process count, and new privileges, but Docker access is still a high-trust capability. Treat the worker host as security-sensitive and do not co-locate it with secrets or internal services.
