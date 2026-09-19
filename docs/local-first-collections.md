# Local-first collections

Owner: Savia platform. Reviewed: 2026-09-18.

## Data flow

The embedded CRM reads eligible collections from a scoped Dexie/IndexedDB replica,
even while online. React Query caches derived results in memory; it is no longer
persisted as the data model. Record creation, editing and deletion commit the
visible record and its outbox mutation in one local transaction. The UI can finish
without waiting for HTTP. Server validation, authorization and business rules
remain authoritative; rejected edits remain visible in the synchronization panel.

Each database has five fixed stores: `records`, `collections`, `outbox`,
`syncState`, and `conflicts`. Collection names are data, not IndexedDB schema.
Creating a collection does not upgrade the database version. Scope includes the
API environment, principal, domain API prefix and permissions snapshot. No access
tokens are persisted by this subsystem.

The server manifest declares read-write, read-only or remote capability. Native
D1 collections support replicas; external connector and business adapters remain
remote until they implement a durable change feed. File upload, schema editing,
bulk operations and integrations still require connectivity. The first complete
collection download requires connectivity; an unhydrated collection is never
presented as an empty complete replica.

## Replication and correctness

D1 triggers atomically capture record changes, including imports, bulk writes,
soft deletes, restores and hard deletes. The journal retains the latest state per
record with a monotonically increasing sequence, rather than every historical
edit. Deletion tombstones must remain until an explicit cursor reset/retention
protocol is implemented. A cursor and its downloaded records commit together.
Local pending edits are protected from incoming remote versions.

Mutations use stable client record IDs and unique operation IDs. The server commits
its receipt in the same transaction as the mutation. Repeating a request after a
lost response returns its existing result. Version conflicts expose the server
record and require an explicit choice. Automation completion is recorded in the
receipt; a retry resumes unfinished effects using existing automation event
idempotency. There is no independent background sweep of unfinished effects.

Web Locks serialize synchronization across tabs for a scope. Browser support is
required for automatic synchronization; unsupported clients fail closed instead
of running concurrent writers. Realtime notifications wake synchronization; the
durable pull cursor, not a socket event, establishes completeness. A central
60-second watchdog repairs missed events. Retries use exponential backoff and
jitter. Local queries use IndexedDB indexes for pagination and ordering; complex
filters use scalar index ranges and set intersections/unions. Derived match IDs
and exact totals are reused across pages.

## Offline access and recovery

A successful online session provisions a twelve-hour offline identity/permission
lease. First login requires connectivity. Explicit logout invalidates the lease.
An explicit server authentication rejection does not fall back to cached access.
Replication authorization failures hide the replica and stop retries, preserving
pending work for recovery. Offline devices cannot learn a revocation until they
reconnect or the lease expires.

The synchronization panel shows preparation, pending writes and conflicts.
Conflicts can accept the server version or retry local changes. Rejected writes
can be retried or discarded; pending problems can be exported. Logout closes
active replicas and removes clean scoped databases. Databases with unsent work
are retained but cannot be reopened through the app without the matching session.
The retired preference outbox is never replayed into the new record protocol.

Browser storage remains subject to quota, private-mode restrictions and eviction.
Local transactions must succeed before reporting a local save. This is not a
backup for unsynchronized work. A full initial replica can be expensive for large
catalogs; measure record count, bytes and sync traffic before enabling very large
workspaces. Receipts and tombstones currently have no automatic retention policy;
do not delete them ad hoc because that breaks replay safety.

## Deployment and validation

Apply `packages/db/migrations/0053_local_sync.sql` before deploying the API, and
`packages/crm-server/migrations/0015_local_sync.sql` for standalone CRM databases.
Deploy the server protocol before the new admin. Historical offline policy tables
are retained for migration compatibility, but their API, management screen and
query-cache implementation are retired.

The service worker precaches the boot/CRM route dependency closure. Optional
editors and other routes cache on use. API responses are never stored in the
service-worker cache. Existing open tabs need the new application version before
they use this protocol.

Tests cover real SQLite/D1 journal and receipt behavior, IndexedDB transactions,
reopening, dirty-row protection, conflicts, revoked access, derived queries and
10,000-record ordering. A browser smoke test also reopened a real 10,000-record IndexedDB replica and
confirmed that a pending local edit survived page reload; a sorted page query took
84.5 ms on that development machine. Production latency, quota and external adapter behavior
must be measured separately; unit test timings are not device benchmarks.

## Table responsiveness and lazy loading

Record lists keep bounded pages (25 by default, at most 200). Empty search and
empty filter constraints use indexed count/page reads instead of scanning each
record. Compound equality, range, membership and empty predicates resolve from
existing field indexes. Field substring predicates inspect scalar index keys.
Unrestricted substring searches inspect documents in batches of 256 on the first
query; subsequent pages reuse the ordered matching IDs and exact total. Neither
substring matching nor a first broad filter is constant time. Search keystrokes are coalesced for
180 ms while the input remains immediately editable.

Pages above 20 records virtualize rows with TanStack Virtual, a bounded viewport,
measured row heights, and six overscan rows. Small pages keep native rows. Column
widths stay fixed during vertical scrolling. Focus is pinned by record identity,
and row actions, selection, sorting and page controls retain their existing
semantics. This is row virtualization; columns are not virtualized.

Lists preserve their latest successful page during query transitions and transient
errors, label stale results and disable their actions until the requested results
arrive. An explicit permission rejection or query reset/removal clears retained
rows. Background replication does not replace a populated table with a skeleton.
Committed IndexedDB key ranges drive refreshes for changed collections, including
same-count edits and other database connections. Unchanged sync heartbeats and
outbox-only status changes do not refresh record queries.

Studio administration, screen/menu editors and form configuration panels load on
first use. The production service worker precaches list/detail/create-edit static
dependency closures; optional studio panels and icon catalogs remain on demand.
An optional editor needs one online visit before it is available offline.

To reproduce browser measurements, run the admin development server and open
`/tools/local-performance.html`. The fixture uses an isolated IndexedDB database
with 10,000 synthetic records, queries pages of 200, and compares the shared full
and virtual tables. It reports query time, aggregate React render time and time
through two animation frames separately. Reload after changing source files;
HMR and concurrent builds invalidate timing comparisons. Development results are
diagnostics, not production INP or a low-end-device benchmark.

A development-browser sample with 200 rows mounted 200 native rows versus 14
virtual rows. Aggregate React render time was 79.7 ms versus 15.1 ms; these
measurements are illustrative and vary by machine. Deferred panels reduce the
initial JavaScript path, while precaching operational screens increases the
offline cache footprint; lazy loading does not imply a smaller total download.

## Filter cache and pagination

Each open database retains at most eight filtered ID lists and 100,000 IDs in
aggregate. Records themselves are fetched only for the requested page (except
initial unrestricted text-search batches). Larger result sets are not cached.
Every record-changing store transaction also updates `syncState.dataRevision`.
Queries read that revision, the pull cursor, pending mutation IDs and the page
in one readonly transaction. Cursor/outbox identity also detects older clients
that write without advancing the new revision. Delayed cross-tab notifications
do not determine cache correctness. Mutation
notifications additionally evict affected collections; empty sync heartbeats do
not change the revision. Legacy replicas acquire their first revision on the next
pull. Summaries aggregate scalar group/amount index keys without loading records.

Hydrated native collections paginate locally with zero list HTTP calls. First
provisioning coalesces requests for the same collection, preempts an unrelated
background pass in the same coordinator, and downloads the requested collection
before resuming background work. It still needs that collection's complete first
snapshot; another tab's Web Lock and explicit full manual synchronization may
still delay it. Aborted pushes retain their idempotency keys.

Remote collections continue to paginate through their backend. Native D1 listing
uses one batch for count and page, preserving a consistent transaction and
avoiding a serial roundtrip. It still uses `LIMIT/OFFSET`; deep remote pages and
custom JSON-field sorts can remain expensive. An optional domain-provider query
hook can load all rows before filtering, but the built-in provider does not enable
that hook. Pushing its arbitrary filters/sorts down requires an adapter contract
with equivalent semantics, rather than silently changing results.

The developer benchmark also provides compound-filter, next-page, unrestricted
text and former full-scan comparisons. Reload between source changes, prepare
the fixture after a protocol upgrade, and measure without a concurrent build.

A development-browser sample over 10,000 synthetic records (200-row pages)
measured the former compound-filter scan at 283.9 ms, the indexed first query at
163.5 ms, and the cached next page at 22.6 ms. These are illustrative local timings,
not production latency guarantees. Unrestricted first-time text search still does
work proportional to the collection; its result is reused for later pages.


## Scoped permissions

See [Roles and permissions](permissions.md) for policy revision binding, creator attribution, row removals, field redaction and quarantine behavior. Policy changes require clearing old projections before replay. An acknowledged mutation is reauthorized against the current record before its response is returned. The existing offline lease still bounds disconnected access.
