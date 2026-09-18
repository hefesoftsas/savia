> Superseded implementation details: see `docs/local-first-collections.md`. The delivered design uses Dexie and fixed logical collection stores, not RxDB.

# Local-first Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make authorized collection records available as durable, reactive IndexedDB collections so reads and eligible writes do not wait for HTTP.

**Architecture:** RxDB with Dexie RxStorage is conditional on a commercial/collection-limit gate; Dexie/liveQuery is the alternative without that dependency. Worker sync endpoints expose durable server changes and idempotent writes; existing Durable Objects provide hints. A scoped repository serves React Admin and CRM views.

**Tech Stack:** React, React Admin, RxDB candidate, Dexie/IndexedDB, Cloudflare Workers, D1, existing realtime hub, Vitest and real-browser tests.

**Spec:** `docs/superpowers/specs/2026-09-18-local-first-collections.md` (proposal; read before execution).

## Global Constraints

- Code, tests, and docs in English. Conventional commits in English.
- API reference is generated (OpenAPI/Scalar), never hand-written.
- No resurrection of retired provider tooling.
- Scope = API environment + principal + tenant + data domain + permissions epoch.
- Target IndexedDB. RxDB Free currently allows at most 13 open collections; do not assume an unrestricted free catalog. No license purchase is authorized.
- Before Task 1 implementation, choose RxDB with accepted commercial constraints or Dexie/liveQuery. For Dexie, Task 6 uses one transactional local outbox and Task 5 a custom coordinator; RxDB-specific instructions apply only to the RxDB branch.
- Every supported business collection has a registry entry and honest coverage state.
- Server authorization remains authoritative; no secrets or session tokens in replica documents.
- Initial pilot: two related, small, D1-owned collections from the actual tenant catalog. Prefer quotation collections only if source inspection proves D1 ownership; do not assume it from their names.
- Initial performance targets: p95 local interaction <=100 ms for 10,000 records; warm offline boot <=2 seconds. These are acceptance targets, not current measurements.
- No app behavior changes or deployment are part of this planning deliverable.

## Shared interfaces to establish in Task 1

Create `apps/admin/src/local-data/contracts.ts` and mirrored runtime-validated transport schemas in `apps/api/src/sync/protocol.ts`. Generate transport types from OpenAPI rather than hand-maintaining duplicate API declarations.

```ts
export type ReplicaScope = {
  environment: string;
  principal: string;
  tenant: string;
  domain: string;
  permissionsEpoch: string;
};
export type Coverage =
  "bootstrapping" | "complete" | "partial" | "reset-required";
export type RecordDocument = {
  id: string;
  collection: string;
  serverVersion: number;
  schemaVersion: number;
  deleted: boolean;
  data: Record<string, unknown>;
};
export type QuerySpec = {
  equals: Record<string, string | number | boolean | null>;
  search?: { field: string; text: string };
  sort: { field: string; order: "asc" | "desc" }[];
  offset: number;
  limit: number;
};
export type LocalResult = {
  records: RecordDocument[];
  total: number;
  coverage: Coverage;
};
export interface CollectionRepository {
  query(collection: string, query: QuerySpec): Promise<LocalResult>;
  get(collection: string, id: string): Promise<RecordDocument | undefined>;
  observe(
    collection: string,
    query: QuerySpec,
    next: (value: LocalResult) => void,
  ): () => void;
  save(
    collection: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<void>;
  remove(collection: string, id: string): Promise<void>;
  close(): Promise<void>;
}
```

Unsupported query operators must produce an explicit capability result at the
adapter boundary; no silent partial local evaluation. Extend QuerySpec only with
operators covered by parity tests against the server.

## Task 1: Prove the storage/query choice and capture a baseline

**Files:** Create `apps/admin/src/local-data/contracts.ts`, `database.ts`, `database.test.ts`; modify `apps/admin/package.json`, `pnpm-lock.yaml`; create `docs/local-first-benchmark.md`.

**Consumes:** The scope and record contracts above, actual collection catalog/configuration.
**Produces:** `openReplica(scope: ReplicaScope): Promise<CollectionRepository>` and measured library decision.

- [ ] Record the engine/license decision against the actual catalog size; if no paid dependency is accepted, use Dexie/liveQuery and document ownership of checkpointing, leadership and conflict handling.
- [ ] Write tests for reopening durable records, per-scope isolation, filtered sorting and schema migration with pending edits.
- [ ] Run `pnpm --filter @savia/admin test src/local-data/database.test.ts`; confirm failures reflect missing behavior.
- [ ] Implement the pilot database with RxDB Dexie storage. Use separate named collections for business collection IDs; stable envelope plus validated business schema. Do not write directly to RxDB internal IndexedDB stores with Dexie.
- [ ] Test nested configurable fields, relation IDs, indexes, multiple tabs, Safari/Chromium and 10,000 representative records. Measure local queries, heap, bundle and bootstrap size.
- [ ] Run the same fixture through Dexie/liveQuery if RxDB fails schema/query or latency criteria. Select one engine and record evidence; no dual storage engine in production.
- [ ] Commit `feat: establish scoped local collection storage` with passing storage tests and benchmark evidence.

Independent acceptance example:

```ts
await replica.save("contacts", "c1", { name: "Ana" });
await replica.close();
const reopened = await openReplica(scope);
expect((await reopened.get("contacts", "c1"))?.data.name).toBe("Ana");
```

Run persistence assertions in a real browser as well as unit tests; an in-memory mock cannot prove restart durability.

## Task 2: Isolate sessions and fix current cache ownership

**Files:** Modify `apps/admin/src/app-services.ts`, `auth/react-admin-auth-provider.ts`, `features/crm-engine/app.tsx`, `offline/offline-policy.ts`; create `local-data/session.ts`, `session.test.ts`.

**Consumes:** `openReplica`, scope contract.
**Produces:** `activateReplica(scope)` and `closeReplica({ discardConfirmed })` lifecycle owned by app services.

- [ ] Add tests: A logs out, B logs in, and neither A's records nor preference outbox operations execute as B. Switching domains with equal collection names keeps records isolated.
- [ ] Reproduce the separate CRM QueryClient/persister behavior before changing ownership.
- [ ] Make app services own replica lifetime; remove the implicit assumption that the outer persister persists the inner CRM client. Pass the local repository explicitly to embedded CRM contexts.
- [ ] Scope query keys/policies for screens still using Query. Await disk cleanup and cancel writes/subscriptions before logout completion. Include legacy outbox, versions and policy snapshots in cleanup.
- [ ] Specify pending-edit handling on logout: show unsynced count, allow sync/export or explicit discard; never transfer pending work to a new account.
- [ ] Run session/auth regression tests; commit `fix: isolate offline state by authenticated workspace`.

## Task 3: Capture durable record changes at the write boundary

**Files:** Create `packages/crm-server/src/sync/change-log.ts`, corresponding test; add the next unused migration under `packages/db/migrations/` (reserve its number immediately before execution); modify `packages/crm-server/src/services.ts` and each discovered owned write path.

**Consumes:** D1 record transactions, versions and soft deletes.
**Produces:** Ordered committed journal entries with domain/collection/record identity, record version, document state or tombstone, and server sequence.

- [ ] Add failing tests for create/update/delete/restore/bulk changes, transaction rollback and repeated mutation IDs.
- [ ] Append journal and idempotency receipt within the same D1 transaction as each owned write. Index scope/collection/sequence. Use server sequence ordering, not client timestamps.
- [ ] Inventory imports, automations, source adapters and both dynamic-CRM/data-domain entrypoints; route owned writes through capture. Document externally owned writes separately.
- [ ] Establish retention floor and bounded cleanup of history older than 30 days; make reset-required detectable before deleting history.
- [ ] Verify failed transactions emit no changes and duplicate requests emit no extra accepted mutation; commit `feat: journal committed collection changes`.

## Task 4: Implement authorized manifest and race-safe pull

**Files:** Create `apps/api/src/sync/{protocol,routes,pull,manifest}.ts`, `apps/api/test/sync-pull.test.ts`; register routes in `apps/api/src/app.ts`; update collection capability configuration.

**Consumes:** Durable journal, authorized schema catalog and record readers.
**Produces:** Manifest and bounded pull with opaque scope-bound checkpoint, coverage and reset-required responses.

- [ ] Add tests for pagination while records are concurrently inserted/updated/deleted, checkpoint reuse across scopes, permission changes, and expired cursors.
- [ ] Use a maximum 500-document batch. Bootstrap at high-watermark H, keyset-page authorized records, then replay changes after H. Return complete only after catch-up; compare document versions against newer bootstrap rows.
- [ ] Include tombstones. On permission/filter epoch change, require replica reset/eviction; excluding rows from future responses alone is insufficient.
- [ ] Rebuild into a new replica generation while retaining the old dirty documents; switch only after the new base is ready. Reconcile retained local intent against new master versions.
- [ ] Generate API types from registered schemas; run `pnpm --filter @savia/api test test/sync-pull.test.ts`; commit `feat: expose scoped collection replication reads`.

## Task 5: Connect replication and make list/detail reads local

**Files:** Create `apps/admin/src/local-data/{replication,repository,react-admin-adapter,use-local-query}.ts`; modify `apps/admin/src/features/crm-engine/api.ts`, `records.tsx`, `record-detail.tsx`, `app.tsx`; modify `realtime/use-realtime.ts`; add local-data integration tests.

**Consumes:** Repository and pull/manifest contracts.
**Produces:** Read-only local-first pilot across list, detail, filters, lookup labels and summaries.

- [ ] Add tests where the network throws after bootstrap and list/detail/filter/pagination still succeed, including a detail never opened online.
- [ ] Wire one sync leader per workspace across tabs. Map realtime hints and reconnect to coalesced RxDB RESYNC; combine bursts and enforce one in-flight pull per collection.
- [ ] Route React Admin reads through the repository. Subscribe once per scope/query and invalidate only local derived results when records change; these invalidations must not trigger remote full-list fetches.
- [ ] Remove old advisory version gating for migrated collections. Let replication metadata reflect durably applied batches. Keep unrelated remote queries in TanStack Query.
- [ ] Match server filtering, sorting, null handling, total counts and relation labels using fixtures. Display coverage for incomplete datasets; no false full totals.
- [ ] Run browser airplane-mode and latency tests; commit `feat: serve CRM reads from local replicas`.

Example acceptance:

```ts
await bootstrapFixture();
await context.setOffline(true);
await page.getByRole("link", { name: "Contacts" }).click();
await page.getByText("Ana").click();
await expect(page.getByText("ana@example.test")).toBeVisible();
```

## Task 6: Add idempotent push and durable local edits

**Files:** Create `apps/api/src/sync/push.ts`, `apps/api/test/sync-push.test.ts`; modify CRM write services; create `apps/admin/src/local-data/{mutations,conflicts}.ts` and tests; integrate CRM forms and status UI.

**Consumes:** Atomic journal/receipt writes, local repository and record versions.
**Produces:** Create/update/delete of explicitly eligible records while offline.

- [ ] Test lost acknowledgements, duplicated requests, two clients editing one record, update-vs-delete and server validation rejection.
- [ ] Accept client-generated UUIDs for new owned records with uniqueness and scope validation; retain server-generated IDs for existing REST callers. If a provider mandates IDs, persist mappings and resolve dependent references before push.
- [ ] Adapt RxDB push documents/assumed master state to existing validation and version guards. Store durable mutation identity/receipts; exact transport retries must return the prior accepted result.
- [ ] Do not add a competing CRUD outbox. Persist conflict candidates/rejection status and expose resolution; never silently discard edits via default server-wins.
- [ ] Merge disjoint fields only when business invariants permit; same-field or relation conflicts require a user decision. Retry network failures with jitter; stop on terminal auth/validation failures.
- [ ] Verify offline edit -> browser reload -> reconnect -> exactly one accepted server change; commit `feat: synchronize durable offline record edits`.

## Task 7: Expand the collection registry across source types

**Files:** Create `apps/api/src/sync/source-adapter.ts`, adapter tests; modify existing backend source integrations selected from the runtime catalog; extend local collection registry and schema migration tests.

**Consumes:** Manifest and journal contracts.
**Produces:** Every business collection classified as full replica, declared subset replica, or unsupported with an explicit blocker.

- [ ] Test a representative external collection where a change occurs outside Savia; it must reach the replica without opening its screen.
- [ ] Prefer provider change feeds/webhooks with deduplication; otherwise reconcile on the server into a materialized read model. Budget reconciliation per provider, not per browser.
- [ ] Cover source deletes and permission removals; a missing row in an incomplete provider page is not proof of deletion.
- [ ] Start external sources read-only. Enable writes only after confirming conditional updates, deduplication, failure recovery and action semantics.
- [ ] Handle low-code field addition/removal/type changes while unsent edits exist; preserve conflicting old values in the conflict record.
- [ ] Commit each independently verified source adapter with its supported capability grid. Do not label unsupported sources fully offline.

## Task 8: Complete offline boot, rollout and operational verification

**Files:** Modify `apps/admin/vite.config.ts`, auth session workspace bootstrap, offline policy UI; create browser tests under the existing E2E harness (or establish a Playwright harness if absent); update `docs/realtime-cost-controls.md` and create `docs/local-first-operations.md`.

**Consumes:** Pilot replica lifecycle, migration, local reads and writes.
**Produces:** Verified deployable rollout with honest sync state and rollback.

- [ ] Test reload with network disabled, uncached lazy routes, expired offline lease, storage quota exceeded, IndexedDB denied, and closing the replication leader tab.
- [ ] Precache the supported offline route dependency graph within a measured asset budget. Avoid downloading every chunk or API responses into Cache Storage.
- [ ] Expose bootstrap progress, local pending writes, conflicts and last server contact without blocking local interactions. Request durable storage when appropriate; never claim data survived a failed write.
- [ ] Roll out behind per-tenant/per-collection flags: read pilot, write pilot, then source adapters. Capture p95 interaction, bootstrap bytes, pull batch volume, backlog and conflicts.
- [ ] Run `pnpm run typecheck`, focused API/admin sync tests, `pnpm run test:contracts`, browser offline tests and changed-file formatting. Compare costs and latency to Task 1 baseline.
- [ ] Verify rollback stops new writes while retaining/exporting/draining existing pending edits. Commit `feat: roll out verified local-first workspaces`.

## Execution order and release gates

Tasks 1–2 establish the foundation. Tasks 3–5 produce the first usable read-first
release. Task 6 adds offline CRUD. Tasks 7–8 complete broad coverage and rollout;
Task 8's browser checks also gate the read-first release. Do not wait for every
external connector before validating that the pilot feels local.

Estimated planning range, not a delivery commitment: 1–2 weeks for a read-first
vertical slice, another 1–2 weeks for resilient owned-record writes, and 2–4+
weeks for connector coverage, migration and browser hardening, assuming dedicated
engineering time. Re-estimate after Task 1 and the source inventory.
