# Local-first collections: assessment and proposed architecture

Status: historical assessment, superseded by `docs/local-first-collections.md`. Owner: Savia platform. Reviewed: 2026-09-18.

## Objective

Make collection navigation, filtering, record details and eligible edits operate
against durable local records in IndexedDB. Synchronization runs behind the UI.
The backend remains authoritative for permissions, accepted records and business
side effects. This explicitly supersedes the earlier decision to avoid local row
mirrors in the September 17 offline plan. The current user request authorizes
planning a local replica, not a backend-only client-storage policy.

## Evidence in the current code

- `apps/admin/src/offline/db.ts`: only queryCache, outbox and collectionVersions;
  there are no business-record collections, local indexes or reactive row queries.
- `apps/admin/src/app.tsx`: persists the outer TanStack Query client.
- `apps/admin/src/features/crm-engine/app.tsx` Root: constructs a separate
  QueryClient inside CoreAdminContext and clears it on unmount. Consequently the
  outer persister does not persist queries owned by this CRM client.
- `apps/admin/src/features/crm-engine/api.ts`: getList/getOne/create/update/delete
  call HTTP directly; getMany issues one request per requested record.
- `apps/admin/src/offline/persisted-keys.ts`: selected query prefixes only;
  record-detail is explicitly excluded; the pilot covers quotation list queries.
- `apps/admin/src/offline/query-persister.ts`: serializes query cache under one
  key and filters customer lists older than 12 hours on restore. This is not a
  searchable database of all authorized records.
- `apps/admin/src/offline/outbox.ts`: only appearance/sidebar preferences can be
  queued. Entries have no account/tenant/domain ownership. `use-outbox.ts` has
  a per-hook flushing lock, not a cross-tab coordinator.
- `apps/admin/src/app-services.ts`: logout clears queryClient and persister, but
  not outbox or collectionVersions; async disk removal is not awaited.
- `apps/admin/src/offline/offline-policy.ts`: eligibility is a union of loaded
  tenant policies. Several CRM keys omit tenant/domain; this risks cache reuse
  and incorrect policy application across scopes, not a proven data disclosure.
- `apps/admin/src/offline/use-offline-policy.ts`: refreshSeconds enables query
  polling; this is refetching, not incremental replication.
- `apps/admin/src/features/crm-engine/records.tsx`: realtime invalidates queries,
  then saves an advisory collection version without awaiting successful refetch.
  A failed refresh can therefore be recorded as covered. It has no replay cursor.
- `apps/api/src/routes/dynamic-crm.ts`: collection version increments after the
  proxied write, best-effort. It does not atomically record all record changes and
  cannot cover all external writes or all other API entrypoints.
- `packages/crm-server/src/services.ts`: useful foundations already exist:
  record versions, transactional writes, soft deletes and create idempotency.
  Create currently assigns the UUID on the server; local creates need a stable
  client ID contract or durable ID mapping for references.
- `apps/admin/vite.config.ts`: boot shell precache exists; other JS chunks cache
  on first use only. A screen never opened online may lack its offline assets.

This was a source review, not a browser performance benchmark or production sync
integrity test. Record volumes, device budgets and external connector capabilities
must be measured in the pilot.

## Library decision

Historical candidate (rejected; implementation uses Dexie with fixed stores): RxDB with its open-source Dexie RxStorage (IndexedDB),
custom HTTP replication and reactive queries. It supplies local collections,
replication checkpoints, conflict hooks and multi-tab leadership. Validate schema
changes, query coverage, bundle and device performance before broad adoption.
The current free edition limits simultaneously open collections to 13. This is
material for Savia's dynamic catalog. Premium removes that limit; the pricing page
lists Pro from $99/month billed annually. Its direct optimized IndexedDB storage
is also premium. Do not approve RxDB for broad adoption as an unrestricted free
solution. The small pilot can fit the free edition, but commercial suitability
must be decided before building around it. Without an accepted paid dependency,
prefer Dexie/liveQuery and implement the server-backed replication coordinator.
Pin compatible versions after the compatibility spike.

Alternatives:

| Option                  | Fit                                                      | Cost/tradeoff                                                                                                               |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Dexie + liveQuery       | Strong IndexedDB fit; already installed                  | We own durable replication, checkpoint recovery, conflicts and leadership                                                   |
| RxDB + Dexie storage    | Closest fit to a DataStore-like API over current backend | Added runtime/schema constraints; requires server sync endpoints                                                            |
| PouchDB + CouchDB       | Strong established replication model                     | Existing REST/D1 is not a CouchDB replication endpoint; adds infrastructure or a large compatibility layer                  |
| Amplify Gen 1 DataStore | Useful reference architecture                            | Cloud sync targets AppSync/DynamoDB; adopting it changes backend architecture                                               |
| TanStack DB             | Good local reactive query/collection layer               | Its documented persistence path uses SQLite/WASM; not the direct IndexedDB row model requested; backend sync still required |

Do not add RxDB and TanStack DB simultaneously in the first slice. Keep TanStack
Query for remote commands and existing non-migrated screens. If RxDB fails the
pilot's schema/query/device tests, retain the server protocol and implement the
same repository interfaces with Dexie/liveQuery; record this decision explicitly.

Sources checked September 18, 2026:

- https://rxdb.info/premium/
- https://rxdb.info/rx-collection.html
- https://rxdb.info/replication.html
- https://rxdb.info/replication-http.html
- https://rxdb.info/rx-storage-dexie.html
- https://rxdb.info/rx-storage-indexeddb.html
- https://rxdb.info/migration-schema.html
- https://dexie.org/docs/liveQuery()
- https://pouchdb.apache.org/guides/replication.html
- https://docs.amplify.aws/gen1/react/build-a-backend/more-features/datastore/how-it-works/
- https://tanstack.com/blog/tanstack-db-0.6-app-ready-with-persistence-and-includes

## Architecture and invariants

UI -> scoped local repository -> reactive collections -> IndexedDB.
A background replication coordinator connects these collections to authenticated
Worker pull/push endpoints. Durable Objects send coalesced change hints only;
reconnect/start/focus also reconcile via the durable cursor. Socket delivery is
never the sole mechanism for correctness.

Every supported business collection has a registry entry, schema, capability and
coverage state. Replicate the authorized dataset, not all tenants or secrets.
For the pilot, synchronize the entire authorized small collection. Larger datasets
may use declared subsets, but the UI must distinguish partial coverage from a
complete replica. Local totals/search must never imply completeness on partial data.
Binary attachments need their own download policy; records can store metadata.

Scope = API environment + principal + tenant + data domain + permissions epoch.
Use a separate database identity per scope; include collection identity and schema
version in the registry. Close old subscriptions before switching scope. Cached
permission metadata may unlock an already provisioned offline workspace for a
bounded lease; it never authorizes server access. Server validates every sync call.
Offline revocation cannot be immediate; a permission change on reconnect purges
or reboots the affected scope before further rendering/sync.

Use RxDB document replication for eligible record state. Do not create a second
independent CRUD outbox alongside RxDB. A separate command queue is only for
explicitly replay-safe commands, not an alternative record writer. Pending edits
must survive reload, schema migration and conflicts; never clear them to repair sync.

The server protocol must provide:

- A manifest of authorized collections, schema version, capability, scope epoch,
  coverage predicate and remote high-watermark.
- Bounded pull batches, ordered by a server-generated committed sequence, with
  opaque scope-bound checkpoints. Deletes are tombstones; ACL removals require
  eviction/reset semantics, not just filtering them out of subsequent responses.
- A race-safe initial bootstrap: capture high-watermark H, keyset-read records,
  then replay retained changes after H before marking coverage complete. A fresh
  replica may see newer base rows; version comparisons prevent old replay states
  from replacing them. Never advance to a watermark beyond delivered changes.
- Cursor expiry after 30 days of retained change history returns an explicit
  reset-required result; rebootstrap committed state while preserving dirty edits.
- Push with stable mutation IDs, client record IDs, assumed master version and
  candidate state. Atomic version comparison, validation, mutation, receipt and
  change entry on owned D1 records. Handle replay-after-lost-response safely.
- Terminal validation/authorization errors are durable user-visible rejections,
  not infinite retries. Conflicts retain local intent and server state. Do not
  silently use RxDB's default server-wins handler for important user edits.

Change capture belongs in the write service, including imports, bulk writes,
restore, automation and connector ingestion. The gateway's current best-effort
counter cannot be promoted into this protocol. For D1, append the journal in the
same transaction. For external systems, use their durable change feed/webhooks
with deduplication and periodic server reconciliation, or materialize an authorized
server read model. Do not claim atomic transactions across D1 and external APIs.

Default pilot policy: local reads for all authorized pilot records; offline writes
only to owned CRUD fields. Identity/admin changes, quote execution, policy issuance,
payments, email and provider commands remain online. External collections start
with read replicas until their write/idempotency/conflict contracts are proven.

## Acceptance targets (proposed, measured on agreed baseline devices)

- Warm list/detail/filter response p95 <=100 ms on 10,000 representative records;
  no HTTP in the critical path for already synchronized reads.
- Warm offline launch to usable pilot screen <=2 seconds, including a detail not
  previously opened online. First ever visit still requires network provisioning.
- Eligible edit acknowledged locally <=100 ms; reload offline retains it; retry
  after lost acknowledgement creates no duplicate record or external effect.
- Two tabs share one replication leader; closing the leader transfers ownership.
- Dropped socket events, offline deletes and concurrent edits converge; checkpoint
  only advances after durable local application under the chosen library contract.
- Tenant/account/domain switch cannot reuse another scope's records or mutations.
- Handle IndexedDB unavailable/quota failure explicitly; never show 'saved locally'
  before durable persistence. Use storage estimates and opt-in persistent storage.
- Publish bootstrap bytes, local query latency, backlog, conflicts, replay batch
  size and server rows read/written. No full collection download after each hint.

## Rollout

Use a per-tenant/per-collection localReplica flag. First ship read-only local
collections and details; then enable eligible writes and conflict UX; finally
expand adapters. For rollback, stop new local writes but retain/export/drain pending
work before replacing the reader. Never roll back by deleting unsent data.
