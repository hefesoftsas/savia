# SECOP Automatic Monitoring Implementation Plan

> **For agentic workers:** Use bounded native workers with disjoint file ownership; coordinator integrates and reviews.

**Goal:** Hourly remote checks and durable in-app status/deadline alerts for saved SECOP interests.

**Architecture:** Declarative plugin monitors, generic API runner with leased D1 state, existing principal-bound MCP transport and notification outbox.

**Tech Stack:** TypeScript, Cloudflare scheduled Workers, D1, React, pnpm/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-14-secop-automatic-monitoring.md`

## Global Constraints

- Optional procurement plugin; no industry assumptions in platform core.
- Hourly checks, reminders at 168/72/24 hours, creator's own OAuth source.
- Backend persistence, safe error codes, no provider secrets or executable server plugin code.
- Source updates and notice events commit atomically with version/claim guards.

## Review Focus

- Credential/permission revocation and plugin disable between claim and commit.
- Naive/date-only/offset timestamps and overdue or unavailable deadlines.
- Repeated, concurrent and delayed checks without alert storms.
- User edits during remote reads without lost notes or status changes.
- Fair bounded iteration across records/installations.

## Tasks

- [x] Define strict monitor schema with fixed read-only MCP action reference and collection field validation; extend SECOP package/UI/guide and tests.
- [x] Test and implement pure observation/date/reminder planning, including changed status and deadline revision deduplication.
- [x] Add D1 claim/observation schema, runner, current creator access checks, atomic source updates/outbox and regression tests.
- [x] Wire existing cron runtime and isolated preview cron configuration, preserving secrets and all current bindings.
- [x] Run focused tests/typechecks, review combined diff, package/install new immutable plugin version, deploy only isolated preview API and verify live check/inbox compatibility. Commit and push without unrelated files.

## Verification evidence

- Focused API scheduler/observation/MCP/policy tests: 34 passed, including source deletion/replacement and revocation immediately before commit, hidden lookup fields, conflicting user edits, and competing ticks.
- Shared package contract tests: 58 passed; SECOP plugin tests: 11 passed; server store/action tests: 51 passed and 1 skipped; preview/configuration scripts: 27 passed; admin plugin-project tests: 10 passed.
- Typechecks: API, admin, studio-server, studio-shared and SECOP plugin passed. The admin IDE's empty store template now includes the default empty monitor list. Scheduled-runtime fixtures apply the current migrations and verify the monitor transport in both schedule modes.
- Isolated preview API uses the existing encryption keys and one-minute cron; SECOP plugin `1.1.0` is installed and enabled. No shared preview or production deployment was changed.
- Live detail lookup returned one exact Socrata row. Autonomous checks at `2026-10-14T17:47:01.470Z` and `2026-10-14T17:52:01.476Z` persisted healthy observations and the next hourly due time. The second check was queued early only for the explicitly labeled verification record. No false notice was emitted for unchanged status or unavailable deadline. Scheduled tail outcomes were `ok`.
- Browser verification showed the current source status, missing-deadline text, Bogota check timestamp, enabled monitoring toggle and pause guidance in the installed plugin. Deterministic fixtures verified alert delivery; no real SECOP state change was fabricated.
- Full repository tests were not completed. An exploratory command forwarded a test argument incorrectly, started the full API lane and was stopped; it reported an unrelated public-form integration failure that was not investigated in this task. All subsequent checks above were explicitly focused.
