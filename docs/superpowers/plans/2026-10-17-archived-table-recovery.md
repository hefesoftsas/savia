# Archived-table recovery and daily backup preparation

**Goal:** Preserve all nine retired production tables and their 85 rows during
recovery, and prepare unattended daily capture without deployment or IaC apply.

**Design:** Production's FTS5 fallback becomes a schema-bearing logical dump
(`d1Methods: schema-dump`). Preserve the exact original tables (including all
nine retired tables and `d1_migrations`), data, explicit indexes/views/triggers,
external-content FTS rebuilds and AUTOINCREMENT sequences. Restore into verified
empty D1 targets without applying current migrations first: a local actual-data
rehearsal exposed unique-role seed collisions when current migrations preceded
replay. Do not delete, merge, rename or remap historical data to avoid conflicts.
Check target emptiness read-only before any data load and use authoritative
Pulumi UUIDs for both checks and loads, avoiding stale Wrangler bindings.
Existing data-only table-dump archives retain their legacy migration behavior.
Use an isolated local recovery of the encrypted diagnostic to prove preservation;
that diagnostic remains incomplete across databases and is never relabeled as a
valid production backup.

Daily capture runs from a dedicated backup environment, retries only typed
consistency drift into fresh private directories, validates integrity before
publishing encrypted output, and always removes plaintext. A separate freshness
check runs without deployment approval and fails on missing/stale valid artifacts.
This prepares automation; continuous writes can still exhaust bounded retries.
Flows continues to require an explicitly paused maintenance window until a
reviewed writer gate is deployed. No new runtime subsystem is introduced here.

## Work and acceptance checks

- [x] Archive DDL/data round-trip tests fail first, then pass with schema retained,
      duplicate/NULL/blob values, indexes/triggers and preexisting-target refusal.
- [x] Typed drift classification test fails first, then passes; identity,
      configuration and credential failures remain permanent.
- [x] Daily runner tests cover drift retry, exhaustion, invalid manifest/hash,
      cleanup, encryption and permanent errors without accepting partial output.
- [x] Freshness tests cover successful main-branch artifacts, failed/expired runs,
      stale timestamps, denied API access and job failure summaries.
- [x] Local actual-data rehearsal preserves nine tables/85 rows and validates
      integrity, foreign keys, and source-row multisets without emitting row data.
- [x] Integrate new checks into contracts, review both changes independently,
      run relevant package tests/typecheck/format and update operational guides.

## Constraints

No live SQL restore, migration, Worker publication, infrastructure apply, workflow
dispatch, secrets disclosure or cloud resource changes. Preserve existing edits.
No archive table is silently skipped, dropped, renamed or merged into canonical
business data. Backend creation/migration and environment credentials remain
explicit activation prerequisites. No commit or push is requested.

## Validation outcome

393 contract tests, 177 infrastructure tests and all three Pulumi typechecks pass.
Actual diagnostic replay preserves every captured source row multiset across
166 tables, including nine retired tables / 85 rows and the original migration
ledger. The source schema and rebuilt FTS index match and pass integrity checks.
Wrangler local transport also preserves all nine archived tables and 47 ledger
rows. Live nonempty-target preflight refuses before writes. Three live captures
remain invalid due to concurrent auth writes; no success manifest is retained.
Bounded retries and an independent freshness watchdog are prepared, but a full
writer barrier is still unimplemented and must precede a guaranteed RPO under
current traffic. No deployment, resource apply or production restore occurred.
