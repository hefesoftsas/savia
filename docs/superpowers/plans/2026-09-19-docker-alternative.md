# Docker Alternative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track verified progress below.

**Goal:** Add a production Docker option while preserving Cloudflare and shared application behavior.
**Architecture:** Node composition root with adapters matching existing application contracts, shared Fetch applications, isolated hooks, S3 storage and SQLite volumes. Existing Cloudflare entrypoints stay supported.
**Tech Stack:** Node, Hono, SQLite, S3, Docker Compose; existing React app and Better Auth.
**Spec:** docs/superpowers/specs/2026-09-19-docker-alternative.md

## Global constraints

- Cloudflare remains supported; no duplicated business API.
- English source/docs, existing localized UI conventions.
- Native Docker startup never invokes Wrangler or requires Cloudflare credentials.
- No default passwords, unsafe public internal routes, unrestricted hooks or lost transactions.
- Single-host SQLite topology with persistent volumes; no unsupported multi-writer claims.

## Review focus

- SQLite batch rollback, triggers, receipts and migration failures.
- File metadata/ranges/conditional writes and S3 endpoint portability.
- CAPTCHA expiry/replay/form binding and existing Turnstile compatibility.
- Untrusted hook CPU/memory/network isolation and realtime ticket isolation.
- Origin/tenant/auth routing, shutdown/restart and secret handling.

## Tasks

- [x] Implement/test SQLite and S3 adapters in apps/self-hosted/src, including rollback/reopen and conditional storage behavior.
- [x] Add configurable self-hosted CAPTCHA to public forms, preserving Turnstile default and submission security tests.
- [x] Implement/test Node realtime and isolated hook execution preserving existing protocol.
- [x] Extract shared runtime construction where needed; compose auth/API/connectors/request applications without Cloudflare module imports at Node startup.
- [x] Build Docker images and Compose with migrations, persistent services, healthchecks, explicit secrets and scheduler.
- [x] Add integration/contract tests, run native runtime and Docker smoke including restart; run Cloudflare regression lanes.
- [x] Review, fix findings, document operator guide and verify deployment artifacts before integration.

## Execution decisions

- Existing approved design authorizes continuous implementation; integration choices stay in this plan rather than requiring repeated approval.
- Reuse the existing isolated worktree. Root owns package manifests/lockfile, runtime wiring, Dockerfiles and docs. Adapter implementers own separate source/test files.

## Verified evidence

- Production Docker image built and started with fresh named volumes; initialization, bootstrap MFA, CRUD/local sync, attachment upload/download, WebSockets and local CAPTCHA passed the live HTTP smoke.
- Recreated all containers using existing volumes and verified the prior record, attachment, public form and MFA before repeating the smoke. Native QuickJS execution also passed inside the production container.
- Native unit/composition tests, API and workspace lanes, contracts and monorepo typecheck passed. The full admin run hit four timing failures; all four passed targeted reruns. Public-form UI submission and local CAPTCHA were additionally checked in the browser.
- Independent review findings were resolved, including S3 credential ownership, vault key format and native outbound integration transport.
- Integrated main through `860b231`: preserved remote MCP OAuth and workflow scheduling; added native streamed-MCP and webhook-transport regressions. After integration, 49 native tests, 40 auth tests, 26 targeted API tests, repository contracts and full monorepo typecheck passed.
- The final upgrade smoke exposed a migration-order bug when main introduced pending files before existing names. A failing regression reproduced it; the runner now checks historical filenames/checksums and appends pending migrations atomically in filename order. All 49 native tests and native typecheck passed after the fix; independent review found no integrity issues.
- Rebuilt the final image after the migration fix and upgraded the existing Docker volumes successfully. The full live HTTP smoke passed again, including previous data/files/MFA, MCP discovery/challenge, CRUD/local sync, S3, WebSockets and ALTCHA. The container reported healthy.
