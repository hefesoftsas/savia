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
filters stream records and can cost more on large collections.

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
