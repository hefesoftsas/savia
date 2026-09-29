# Initial database baseline

Savia's pre-production migration history was consolidated on September 29, 2026.
Each SQLite/D1 store and native PostgreSQL store now starts from the current
schema in `0001_initial.sql`. Required built-in rows are separate in
`0002_bootstrap.sql`; Studio's standalone test store has no bootstrap rows.
Authentication remains owned by Better Auth's schema initializer.

The initial schema includes current constraints, indexes, views and triggers,
including record counts, search and configured summary maintenance. It does not
replay legacy table imports, renames, backfills or old deployment repairs. The
retired history remains available in Git before this consolidation.

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
foreign keys, and affected runtime behavior. The one-time SQLite baseline was
compared with databases created from the entire previous chain: schema objects
and bootstrap data matched exactly for core, Studio and request stores.
