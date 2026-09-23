# Native PostgreSQL baseline

`0001_baseline.sql` is a native schema snapshot of all source migrations recorded
in `manifest.json`. It is checked-in SQL, not a runtime SQLite translator. The
manifest maps every final SQLite table, column, foreign key, explicit index,
trigger and seed count to the native baseline. The request database has its own
baseline and source manifest in `apps/savia-request/postgres/`.

Run through `migratePostgres`, which owns the deployment advisory lock, trusted
search path, checksum history and transaction. Startup can share one reserved
client across core, request and native authentication using
`withPostgresDeploymentLock`. Add future changes as new migration files; never
edit an applied migration. Missing or changed applied files stop startup.

`seed: false` creates an empty import destination. An applied baseline never
replays its seeds, including when a later startup requests `seed: true`. Import
must copy the source's baseline rows as well as its user rows. Explicit identity
values are accepted; the importer must synchronize identity sequences afterwards.
PostgreSQL sequences can have gaps after rollback; application revisions, history
rows and synchronization tombstones remain transactional.

Flags remain integers, JSON remains text, timestamps remain API-compatible UTC
text and IDs use bigint with checked conversion in the adapter. Native trigger
functions preserve access invalidation, synchronization tombstones, history,
workflow dispatch, tenant/agency mirroring and relation guards.

The live migration test compares table/column/index/trigger inventory and foreign
key/check counts, then compares SQLite and PostgreSQL behavior for history,
synchronization, rollback, access revisions, tenant removal, relation guards and
workflow dispatch. Legacy customer synchronization triggers still need broader
end-to-end fixture coverage before the release acceptance gate is complete.

Known compatibility boundary: PostgreSQL `jsonb` expressions reject escaped
U+0000, which SQLite JSON accepts. Text storage and `savia_json_valid` alone do not
resolve that execution difference. This is a release review issue, not a claim
of complete compatibility for arbitrary SQLite JSON payloads.

`0002_workflow_collection_triggers.sql` applies the collection workflow behavior
introduced by SQLite migration `0059`: combined create/update events, soft and
hard deletion events, typed conditions with all/any matching, and captured event
metadata. The source manifest describes the final inventory after both native
migrations. Existing native installations apply only the additive migration;
`0001_baseline.sql` remains unchanged.

`0006_public_form_short_links.sql` adds the persisted Savia short-link mapping to
the native core schema. Existing installations apply it after the notification
migrations; the baseline remains unchanged.

Native pools discard failed idle connections without logging their credential-bearing
client objects. Shutdown waits for socket removal as well as pool shutdown before
allowing database teardown; the next query after an idle connection loss obtains
a replacement connection.
