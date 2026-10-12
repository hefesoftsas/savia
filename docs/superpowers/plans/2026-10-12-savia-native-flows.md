# Native Savia Flows implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Preserve existing work; no commits, deployment or approval pauses are needed for this authorized increment.

**Goal:** Start flows from local collection record changes and read/write Savia records with native, permission-aware nodes.

**Architecture:** Transactional SQLite outbox capture feeds signed private event admission. Native nodes use a signed private host adapter that reuses Studio permissions/validation and atomic idempotency receipts. The shared protocol is `packages/studio-shared/src/savia-flows.ts`.

**Tech stack:** TypeScript, Hono, SQLite/D1, React Flow, local Miniflare, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-savia-native-flows.md`.

## Constraints and review focus

- English source/tests/docs; existing Savia theme and backend-only persistence.
- Local collections and Miniflare only; external sources and schema events excluded.
- Never expose host credentials or trust client-selected tenant/principal authority.
- Pin rollback and retry cases; outbox delivery is asynchronous and deduplicated.
- Pin revoked/field/row access, stale versions, unsupported sources and causal cycles.

## Tasks

### 1. Transactional event capture and outbox (worker)

Files: new Studio server collection-event repository/tests, core migration
0057 and PostgreSQL counterpart, mutation checkpoint extension in services.
Consume the shared event interface. Produce `CollectionEventOutbox` with
`claim(limit,now)`, `complete(id,lease,now)`, `retry(id,lease,error,now)` and
`get(id)`; row mapping returns the canonical event. SQL capture uses the
existing history actor context and covers every local record write path.

- [x] Write/run failing local D1 lifecycle/rollback/replay/no-op tests.
- [x] Implement capture, leased retry/retention and delete checkpoint support.
- [x] Run scoped Studio tests/typecheck and review SQL behavior.

### 2. Flows trigger, native nodes and editor (worker)

Files: Flows shared/runtime types, new Savia nodes and service adapter, API
subscription/event routes and migrations, app trigger and collection widgets.
Consume the canonical protocol and the signed host endpoint from the spec.
Subscriptions store the current configuring principal; event admission is
durable/idempotent and ignores disabled subscriptions and causal ancestry.

- [x] Write/run failing native node, matching/admission/authorization tests.
- [x] Implement signed host adapter, registration and native runtime identity.
- [x] Implement subscription persistence and private event admission/recovery.
- [x] Implement collection/field selectors and clear local-edition states.
- [x] Run scoped API/runtime/app tests and TypeScript checks.

### 3. Host collection adapter and event delivery (coordinator)

Files: new `apps/api/src/savia-flows/` modules/tests, existing route/runtime
integration, root dev runner, migration metadata. Rehydrate current actors,
reuse collection access and validation, and append receipts to CRUD transactions.
Dispatcher signs the event body and retains failed deliveries for retry.

- [x] Write/run failing signature, tenant/row/field, receipt and delivery tests.
- [x] Implement native operation handler, per-run receipts and event projection.
- [x] Connect deferred/scheduled/local delivery and update migration manifests.
- [x] Run focused host regressions and typecheck.

### 4. Integration, review and verification (coordinator)

- [x] Install dependency changes once and verify source/license inventory.
- [x] Run real local collection-to-flow-to-collection smoke with restart/retry.
- [x] Review combined code and fix material findings with bounded workers.
- [x] Build host/child, inspect desktop/mobile trigger and native input controls.
- [x] Update guides, parity/verification record and this ledger with actual checks.

## Ledger

- User explicitly approved implementation; retain the existing managed worktree.
- Capture uses record-level SQLite triggers rather than adding best-effort callbacks
  to each write endpoint; this preserves atomic bundle/import/sync coverage.
- Existing flows and Studio workflows remain separate. No external activation.

- Real Miniflare verification covers native CRUD and collection-to-flow-to-collection
  execution on Worker and durable runtimes, redelivery, cycles, revocation and restart.
- Review fixed separate list/read capability enforcement, explicit subscription
  cutoffs, deterministic terminal Worker replay, and compact canvas/full inspector.
- Native mutation receipts are atomic; unfinished imported Worker side effects
  retain at-least-once crash recovery. Disable does not cancel an admitted run.
- Detailed results and unverified environments are recorded in
  `docs/verification/2026-10-12-savia-native-flows.md`.
- TDD note: the first outbox red run failed in fixture setup; subsequent outbox
  tests verify real D1 behavior. Host routes and capability regression had observed
  assertion failures before their fixes. No claim of a complete strict TDD cycle
  is made for every delegated file.
