# Native PostgreSQL baseline

`0001_initial.sql` is the native PostgreSQL schema snapshot for the final
SQLite-compatible core schema recorded in `manifest.json`. It is generated from
the fully applied native schema chain, so it includes the final tables,
constraints, indexes, functions, views, and triggers without replaying obsolete
renames, table removals, or tenant migrations. PostgreSQL-only derived data such
as SQLite FTS and read-cache tables remains intentionally absent.

`0002_bootstrap.sql` contains the optional initial core rows. The migration
runner sets `savia.seed` for each transaction; `seed: false` leaves the schema
empty, and an applied bootstrap is never replayed when a later startup requests
`seed: true`. SQLite import must copy source bootstrap rows as well as user rows.

Run through `migratePostgres`, which owns the deployment advisory lock, trusted
search path, checksum history, and transaction. Future changes must use new
additive migration files. These initial files establish the clean starting point
for preproduction; once released, treat them as immutable.

Flags remain integers, JSON remains text, timestamps remain API-compatible UTC
text, and IDs use bigint with checked conversion in the adapter. Native trigger
functions preserve access invalidation, synchronization tombstones, history,
workflow dispatch, tenant/agency mirroring, and relation guards. PostgreSQL
sequences can have gaps after rollback; application revisions, history rows, and
synchronization tombstones remain transactional.

The live migration test compares final table, column, index, foreign-key, and
check inventories with the SQLite manifests. It excludes triggers used only by
SQLite-derived tables and accounts for the PostgreSQL email guard using one
trigger for both insert and update. The test also exercises core history,
synchronization, rollback, access revisions, tenant removal, relation guards,
and workflow dispatch.

Known compatibility boundary: PostgreSQL `jsonb` expressions reject escaped
U+0000, which SQLite JSON accepts. Text storage and `savia_json_valid` alone do
not resolve that execution difference. This remains a release review issue.

`0003_record_read_acceleration.sql` adds native derived record counts and
configured summaries and backfills them from existing records/metadata. The
source manifest retains SQLite source tables separately from
`postgresDerivedTables`; import rebuilds these native projections instead of
copying SQLite cache/search internals. Configured expression indexes are installed
from portable metadata during initialization and import, and updated atomically
when performance settings are published.
