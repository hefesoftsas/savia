# Initial database baseline

Savia's pre-production migration history was consolidated on September 29, 2026.
Each SQLite/D1 store and native PostgreSQL store now starts from the current
schema in `0001_initial.sql`. Required built-in rows are separate in
`0002_bootstrap.sql` for the core; Studio and Request have no bootstrap rows.
Authentication remains owned by Better Auth's schema initializer.

The initial schema includes platform constraints, indexes, views and triggers,
including record counts, search and configured summary maintenance. It does not
replay legacy table imports, renames, backfills or old deployment repairs. The
retired history remains available in Git before this consolidation.

## Retired tables excluded from the core

The final pre-production baseline removes 35 inherited tables in both D1 and
PostgreSQL: agency mirrors and contacts/branches; legacy customer profiles and
auxiliary catalogs; automatic customer CRM jobs/mappings/rules; old vehicle
quote requests/offers; insurer/insurance-line catalogs; legacy import ledgers;
and one-time tenant consolidation/namespace bookkeeping. Request also removes
its namespace bookkeeping table and now needs only its initial migration. Their indexes,
sequences, mirror functions, compatibility views and triggers are removed too.

`tenants` is the canonical organization store. Identity, credentials, tenant
permissions, generic CRM connections, Studio record synchronization, configurable
collections, and solution-package installation remain supported. Insurance
solutions use Studio collections rather than recreating the retired SQL tables.
The old automatic customer-to-HubSpot synchronization endpoints and scheduled
worker are retired because their source customer tables no longer exist. Generic
CRM connections and contact/company operations remain available.

An existing pre-production database needs an explicit backed-up reconciliation
before adopting these revised initial checksums. Remove only the retired schema
objects, verify the remaining schema against a fresh installation, and preserve
identity/credential and retained record fingerprints. Replaying the initial SQL
against an existing database is not an upgrade. Authentication schema is unchanged.

## New installations

Use the normal setup/deployment command. SQLite and PostgreSQL migration runners
apply their initial schema and bootstrap once, recording checksums where supported.
The D1 deployment runner submits complete SQL statements in transactional batches.
A failed batch does not record the migration as applied. PostgreSQL's `seed: false`
continues to create an empty import destination.

## Existing pre-production databases

This baseline is an intentional history reset, not an automatic upgrade for
existing installations. Existing migration ledgers are rejected rather than
replaying the initial schema on populated tables. Back up the database before
resetting it. Recreate disposable local databases with the existing local reset
tool only when their contents may be discarded.

For preview, preserve authentication users, password hashes, MFA secrets, OAuth
client credentials, application identity mappings, necessary tenant memberships
and permissions, and provider/API credentials with their ownership context.
Keep Worker encryption/authentication secrets unchanged. Clear application records,
execution histories and configuration outside that preservation set. A verified
schema reconciliation may adopt the new ledger after the scoped reset; it must
check the actual final schema first, never merely rename migration entries.

D1 foreign-key deferral does not suppress cascading deletes. The reset must
preserve required parent rows and validate foreign keys and retained credential
fingerprints afterward. See [Cloudflare's foreign-key documentation](https://developers.cloudflare.com/d1/sql-api/sql-statements/).

## Future schema changes

Keep the baseline immutable after this reset. Add a small forward migration for
each subsequent change. `pnpm --filter @savia/db generate <change_name>` creates
an empty numbered SQL migration for review. Use `--> statement-breakpoint` between
complete statements, never inside a trigger body. SQL is authoritative: the old
partial Drizzle snapshots are removed so generation cannot recreate retired tables.
Update native PostgreSQL SQL and source manifests when applicable.

Verify fresh setup, repeat setup without replaying bootstrap, failure rollback,
foreign keys, and affected runtime behavior. The original consolidation matched the old final schema. The subsequent cleanup
intentionally removes the retired objects; fresh-schema, dependency and runtime
regressions now enforce their absence.
