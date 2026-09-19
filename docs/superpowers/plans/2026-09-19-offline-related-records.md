# Offline Related Records Implementation Plan

**Goal:** Save and display related forms offline, synchronize atomically, and recover whole-bundle conflicts.
**Architecture:** Extend the existing outbox with bundle mutations and a fixed link snapshot table. Reuse the current synchronization coordinator and record-bundle server endpoint.
**Tech Stack:** TypeScript, Dexie, React, Hono, D1, Vitest.
**Spec:** ../specs/2026-09-19-offline-related-records-design.md

## Tasks
- [ ] Backend: test stable client-generated create IDs, idempotent replay and wrong-principal rejection; extend shared contract, endpoint and generated OpenAPI. Inspect/fix the confirmed stale schema-count assertion blocking preview CI.
- [ ] Local store: test atomic enqueue/rollback, indexed optimistic records, link snapshots, overlapping-write rejection, pull protection, atomic acknowledgement/discard/rebase, and collection revocation. Implement fixed schema v2 and bundle storage helpers.
- [ ] Sync: send bundles through existing authenticated Web Lock coordinator; preserve operation IDs across network failures, reject conflicts as one unit, and implement explicit online fresh-state resolution. Cache/overlay complete links through local transport.
- [ ] Forms/recovery: route workspace saves into the local queue, retain drafts on enqueue failure, label pending saves correctly and expose whole-form recovery actions with no independent child write.
- [ ] Verification: inspect deployment health, exercise policy/beneficiary/coverage-shaped fixtures, run relevant store/sync/transport/form/backend suites and typechecks; independently review concurrency/revocation/replay; merge/push main and verify CI/deployment.

## Review focus
- A lost response never duplicates client-generated children or changes the replay body.
- Incoming pulls and unrelated queued edits cannot overwrite any pending bundle member.
- A revoked child collection prevents delivery and removes visible data for that member.
- Reopen/offline link selection is complete, not a network-only illusion.
- Conflict resolution checks current remote data and keeps the whole unit on failure.
