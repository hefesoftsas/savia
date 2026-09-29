# Savia Request PostgreSQL baseline

`0001_initial.sql` is the native PostgreSQL schema snapshot for the final
Savia Request SQLite schema recorded in `manifest.json`. It includes the global
flow catalog, tenant overlays, bundle provenance, audit records, and namespace
mapping table.

`0002_bootstrap.sql` holds the optional platform namespace mapping. The
migration runner sets `savia.seed` for each transaction; `seed: false` leaves
the schema empty, and an applied bootstrap is never replayed if a later startup
requests `seed: true`.

Run through `migratePostgres` with schema `savia_request`. The runner coordinates
both stores with the deployment advisory lock and records checksums in each
schema. Future changes must use new additive migrations; once released, treat
the initial files as immutable.
