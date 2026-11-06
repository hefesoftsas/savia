# Native Savia collections in Flows verification

Date: 2026-10-12. Environment: local Miniflare only, disposable synthetic tenant
and identity. No provider, cloud deployment or billable service was activated.

## Behavior and coverage

Implemented created/updated/deleted/restored local collection triggers, explicit
subscriptions, typed field conditions, and five native CRUD/query nodes. Current
host membership and collection/row/field permissions authorize every native
operation and event projection. Core migration 0057 atomically captures events
and native receipts; Flows migration 0067 persists subscriptions and admissions.
The local catalog adds six Savia types to its 359 imported configured types.

The real Miniflare test in `apps/flows/scripts/native-collections.test.mjs` uses
all core and Flows migrations, the actual Savia gateway and Studio routes,
both directions of private service binding, and actual Worker/durable runtimes.
It verifies all five native actions, optimistic conflict rejection, created and
filtered status-update triggers, event data copied through JSON nodes into a
second collection, concurrent duplicate delivery, delete/restore events,
own-change cycle prevention, revoked subscriber access, and persisted
subscriptions/executions/records after restarting the same state.

Host tests verify body-bound signatures, tenant isolation, row/field grants,
field projection, version requirements, atomic write receipts, receipt mismatch,
replay after revocation, separate read/list capabilities, and outage/retry.
Outbox tests verify four lifecycle operations, transaction rollback, direct
bundle/relation updates, no-op/sync suppression, actor metadata, leases and
bounded retention. Local controller tests reject remote/credentialed origins
and verify dedicated short-lived authority and disabled redirect following.

## Checks

- Core host and existing Flows gateway tests: 36 passed.
- Studio server: 324 passed, 7 skipped; 47 passing files and 2 skipped files.
- Flows runtime: 3,758 passed, 7 skipped; 383 files.
- Flows app: 96 passed; 13 files.
- DB TypeScript and migration hash/inventory checks passed. PostgreSQL migration
  trigger names/check counts were compared statically with SQLite.
- Frozen offline dependency install and pinned upstream verification passed:
  1,897 imported files, 526 unchanged implementation files, 48 categories.

- Flows API: 859 passed; 62 files before the final routing refinement.
  Final targeted event admission and execution replay checks: 9 passed.
  The final host attribution/authorization regression suite: 13 passed. The initial whole suite caught a missing
  optional host binding in a prompt-facts fixture; its regression is fixed.
- Local Miniflare/controller suite: 11 passed, including the complete native
  integration. Its separate-runtime harness now uses managed registry shutdown
  to avoid a nondeterministic Miniflare watcher deadlock on disposal.
- Root local-runtime/API-boundary/SQLite baseline contracts: 13 passed.
- API, Admin, DB and all six Flows package TypeScript checks passed. Child and
  dry-run Worker builds and the Admin host build passed. Existing build warnings
  concern large imported chunks and missing upstream sourcemaps; no build error
  remains. Scoped Prettier and `git diff --check` pass. Root-wide lint remains
  pre-existing red and was not used as a clean completion gate.

## Visual review and limits

Native Chrome exercises the actual child app/host bridge against the local
fixture, with readable collection/field selectors and a compact canvas summary
plus full inspector. The 390-by-844 mobile overlay, scrolling, condition controls,
save action and return to canvas were verified. The save action completed
without an error; a fresh backend read retained the selected collection and
condition. The preview uses a synthetic identity and full core
database migrations. It does not establish full authenticated Admin login,
pointer-drag wiring, live provider compatibility, PostgreSQL runtime behavior,
or cloud deployment.

Event delivery is at least once. Native writes have atomic receipts; terminal
Worker snapshots and durable instances are reused. An unfinished Worker crash
can replay imported arbitrary side effects. Disabling a subscription prevents
new admission, while an already admitted run may finish. Local collection
changes are covered; linked sources, schema events, notification and file nodes
remain subsequent increments.

## Review fixes

Two independent bounded reviews checked the host/outbox and event/runtime sides.
Material findings were addressed: separate read/list capability enforcement,
current actor attribution on native creates, pre-authorization source/operation
gates and terminal unsupported-source handling, atomic admission claims, a terminal
Worker snapshot replay guard, subscription cutoffs and explicit re-enable, and
compact canvas widgets with full inspector forms. The remaining mid-run retry
and in-flight disable semantics are stated above, rather than treated as strict
exactly-once or cancellation guarantees.
