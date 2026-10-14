# Savia Flows Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for coordinated execution with bounded workers. Steps use checkbox syntax for tracking. The user explicitly requested no approval pauses.

**Goal:** Deliver Dafthunk's editor and functional catalog as Savia Flows inside this monorepo.

**Architecture:** Preserve the pinned upstream runtime/API/editor and adapt host identity, private transport and the existing Savia visual system. Isolate the frontend's router and styles in a same-origin embedded application. Use a separate backend database and runtime bindings.

**Tech Stack:** pnpm, TypeScript, React, React Flow, Hono, Cloudflare Workers/Workflows, D1, R2, Durable Objects.

**Spec:** `docs/superpowers/specs/2026-10-12-savia-flows-design.md`

## Global Constraints

- Baseline commit: `66be3083dc6c5349e150de5c9631477942399896`.
- Project: `apps/flows`; packages use `@savia/flows-*`.
- Preserve MIT notices and imported functionality; no upstream account ids or secrets.
- Host authorization uses `tenant:<integer>` and the existing authenticated actor.
- Private backend context is signed, expiring and audience/issuer constrained.
- Savia tokens stay in the host; provider credentials stay in the backend.
- Existing Studio workflows and Savia Request remain independent.
- First-version services are local Miniflare only. No deploy/provision/remote bindings/provider connections or billable service calls. Runtime egress is denied by default.
- Code, tests and docs are English. Product identity is Savia Flows.

## Review Focus

- Forged transport messages/headers must not become an authorized principal.
- Tenant switching must not reuse a previous tenant's response or connection.
- Revoked roles must prevent subsequent management operations and resumes.
- A crash after a remote side effect must not be described as exactly-once delivery.
- Missing Cloudflare/provider configuration must fail visibly rather than fake success.

### Task 1: Import and register the complete source project

**Files:** `apps/flows/{api,app,packages}`, `apps/flows/UPSTREAM.json`, `apps/flows/LICENSE.dafthunk`, `apps/flows/parity.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`.

- [x] Import the pinned source and preserve tests, migrations, assets and container definitions; omit marketing, agent files and upstream deployment environments.
- [x] Rename package references, register nested workspace packages and create reproducible provenance/catalog inventory.
- [x] Replace upstream configuration/account resource names with isolated local Savia names. Remove remote bindings, containers and production environments from active config; keep source definitions for future authorized use.
- [x] Install dependencies and verify package resolution, catalog integrity and migration applicability.

### Task 2: Host gateway and private identity bridge

**Files:** `apps/api/src/routes/savia-flows.ts`, `apps/api/src/{app,runtime}.ts`, `apps/flows/api/src/savia-bridge.ts`, imported auth/context/entrypoint, gateway and bridge tests.

**Interfaces:** Host forwards `SaviaFlowsService.fetch(Request)` with signed context; backend verifies issuer `savia` and audience `savia-flows`, expiring in 60 seconds. Actor/tenant come from the authenticated host, never client headers.

- [x] Write and run failing tests for wrong tenant, revoked membership, member edits, malformed scope, restricted API keys, forged headers and expired bridge claims.
- [x] Implement `/v1/savia-flows/*` gateway with body/status/stream preservation and strict role/scope authorization.
- [x] Implement private backend context verification and transactional identity mirroring; adapt imported middleware to consume verified context.
- [x] Replace standalone auth/session and tenant-management surfaces with host-derived responses. Keep public triggers separately protected.
- [x] Run focused gateway/bridge tests and existing API gateway regression tests.

### Task 3: Embedded transport and Savia UI

**Files:** `apps/flows/app/src/savia/*`, imported entry/router/theme/auth/services/layout, `apps/admin/src/features/savia-flows/*`, admin route/navigation/auth/locales.

**Interfaces:** Same-origin frame messages have a session channel, request id and bounded module-relative path. Host calls `ApiClient.requestResponse` with authenticated tenant context. No token is posted to the child.

- [x] Write and run failing tests for origin/source validation, path traversal, unmount cancellation, tenant switching and theme propagation.
- [x] Implement authenticated transport, frame/host lifecycle and local navigation; retain upstream editor/resource surfaces.
- [x] Apply Savia theme, branding, attribution, loading/error states and module navigation without duplicate global chrome.
- [x] Add the authorized Savia Flows destination and lazy route. Build/serve frame assets under `/flows-ui/`.
- [x] Run transport/UI tests and build frontend.

### Task 4: Execution, triggers and optional services

**Files:** imported runtime, Workflow/Durable Object bindings, public-trigger gateway, local/full configuration profiles and runtime tests.

- [x] Run upstream execution specifications and adapt only verified host-boundary differences.
- [x] Exercise fresh local persistence: create workflow, save/reload graph, run, inspect results/history, secret round-trip without plaintext disclosure.
- [x] Verify async/retry/parallel/durable runtime paths; retain all trigger/provider implementations.
- [x] Separate public trigger routes from management/auth routes and test missing/invalid signatures and resource isolation.
- [x] Enforce local-only egress and test denied external requests and clear unavailable-provider/container behavior without remote calls.

### Task 5: Developer workflow and deployment packaging

**Files:** root scripts, `scripts/dev-local.sh`, admin asset build integration, private Worker configs and setup/runbook docs.

- [x] Add explicit module dev/build/test/typecheck/migrate commands with non-conflicting ports.
- [x] Include module artifacts in the admin build and private local API service binding; do not enable a cloud deployment pipeline.
- [x] Ensure fresh config contains no upstream production ids/domains and no automatically executed third-party CI.
- [x] Run Worker dry-run build, frontend build and relevant existing contracts.

### Task 6: Functional parity and final review

**Files:** `docs/guides/savia-flows.md`, docs index, `apps/flows/parity.json`, verification record and implementation ledger.

- [x] Verify every imported functional category against source and run relevant imported tests.
- [x] Inspect desktop and mobile UI. Native Chrome verified the actual embedded editor/bridge with a synthetic local identity: create/save/reload/run/history, mobile navigation/properties, theme propagation and graph framing. Full Admin login and pointer dragging remain outside this browser check.
- [x] Run typechecks, appropriate existing unit/contracts tests and new module suites; explicitly record external tests not performed.
- [x] Review combined diff, credential/tenant boundaries, licensing and deploy packaging; fix material findings.
- [x] Mark goal complete only when all required work is done.

## Execution ledger

- User waived approval pauses and restricted the first edition to local Miniflare. No external or billable service was activated, provisioned or deployed.
- Existing managed detached worktree reused. Independent source/UI/backend work and a separate read-only final review were coordinated with bounded workers; integration and verification remained with the coordinator.
- Imported 1,897 pinned source files with the original MIT notice and 526 unchanged node implementations in 48 categories. Namespace, ownership, credentials, history, host transport and local configuration adapters are tracked separately.
- Implemented the Savia gateway, signed identity/tenant context, narrow public trigger surface, one-use editor tickets, current-role authorization on every editor command and authenticated resource preview transport.
- Completed the Savia-themed embedded editor, navigation, read-only member behavior, public form entrypoints, lease reconnection and child asset packaging.
- Installed and pinned dependencies; frozen offline lockfile installation passes. Added a tracked Cloudflare test-pool patch for URL-escaped workspace paths.
- Verified all 67 local migrations, restart persistence, actual Worker/Workflows execution, JavaScript isolates, image WASM, HTTP/form/queue/schedule triggers, human input resume, resource isolation and immediate socket revocation. The complete local test runner exits successfully after repairing the Miniflare registry teardown race.
- All scoped package tests, host/Admin regressions, relevant developer contracts, TypeScript checks, local API dry-run build, Admin production build and source/license verification pass. No cloud deployment pipeline or production binding was enabled.
- Native Chrome became available on continuation. Desktop and 390-by-844 mobile inspection exposed and verified repairs to the dashboard billing gate, unavailable AI entry, mobile properties overlay and first-frame graph measurement. UI-created Addition workflows ran with result 5 and appeared in persisted execution history. Browser-fixture and pointer limitations are recorded in `docs/verification/2026-10-12-savia-flows.md`; no live-provider success is claimed.
- The authorized local edition is complete; external provider/container/AI parity requires a future explicit authorization and verification phase.
