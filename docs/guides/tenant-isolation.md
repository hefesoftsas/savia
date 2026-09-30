# Tenant-only workspace isolation

Studio uses `tenants.id` as its sole data-isolation identity. The authorized
workspace catalog is `GET /v1/tenant-workspaces`. Each entry contains a numeric
`tenantId`, an `id` of `tenant:<id>`, a label, a kind, and an API base path.
Tenant selectors are omitted when there is exactly one authorized choice.
With one tenant, screens use it automatically and omit the selector and its
helper text. Explicit unauthorized Studio URLs still require recovery to the
authorized workspace; hiding the selector does not grant access. Savia Request
platform administrators retain the shared-catalog choice alongside tenant scopes.

Studio routes use `/v1/studio/<tenantId>/api/*`; navigation uses `tenantId`.

The reserved platform workspace is tenant `0`. Only platform administrators can
open it. Other workspaces require an active tenant and authorized membership or
platform administration. Custom access policies remain tenant-scoped. Global
`platform` administration is a privilege scope, not a separate data workspace.

The data-domain catalog, creation operation, runtime routes, and `domain:<slug>`
ACL scopes have been removed. Create workspaces through tenant management.
Business-domain modules (for example the `/v1/domains` capability catalog), DNS
domains, and compatibility identifiers for external agency integrations are
unrelated to data isolation.

## Migrating existing installations

SQLite/D1 migration `0077_tenant_only_isolation.sql` and PostgreSQL migration
`0018_tenant_only_isolation.sql` convert existing workspace storage:

- `domain:platform` becomes `tenant:0`.
- `agency:<id>` becomes `tenant:<id>` without changing the numeric tenant.
- Each custom domain becomes a distinct tenant with a generated numeric ID.
- `tenant_namespace_migrations` records the old key and destination tenant as
  migration provenance. The runtime never uses it to resolve a workspace.

Apply the migration as one transaction. The native SQLite/PostgreSQL runners
already wrap migrations transactionally. The D1 REST migration runner submits
this migration and its ledger entry as one batch of separate query objects,
which preserves trigger bodies and makes failure atomic. See the
[Cloudflare D1 batch request contract](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/).
Do not manually execute the namespace conversion one statement at a time.

Preflight checks reject namespace collisions, unmapped old storage keys, and
custom-domain grants incompatible with a user's tenant membership. Legacy
platform-workspace grants to non-administrators also require explicit resolution. Resolve the
reported condition before retrying. Do not delete records or grants merely to
make the checks pass. When an existing tenant is the intended destination, an
operator can prepare an explicit `old_key`/`tenant_id` mapping in
`tenant_namespace_migrations` before running the migration; the same collision
and membership checks still apply. Back up the database and retain its matching
R2 bucket before a deployment migration.

Stored file keys are opaque references. The migration changes ownership columns
while retaining those keys, so existing R2 objects and file revisions stay
readable without renaming blobs. Authorization uses the canonical tenant row.

Encrypted integration, collection-source, geocoding, webhook, and extension credentials
retain their original authenticated encryption context in a versioned ciphertext
envelope. Readers require the canonical expected context and decrypt using the
original AAD. Saving a replacement credential encrypts directly under the new
context. Migration code does not decrypt or log secrets.

PostgreSQL migration `0019_tenant_identity_projection.sql` also brings the native
identity-table projection into line with the existing SQLite tenant tables and
compatibility views. Historical migration files and checksums are preserved.

Self-hosted installations keep Request data in a separate store. Its forward
SQLite migration `0007_tenant_only_isolation.sql` and PostgreSQL migration
`0005_tenant_only_isolation.sql` convert request overlays, variables, history,
bundles, and audit ownership. During startup migration, self-hosted copies the
core migration map into that store first; conflicting maps stop initialization.
For a standalone Request database, prepare custom-domain mappings from the core
store before applying the migration. Unknown custom domains fail rather than
receiving a guessed tenant ID. The empty Request scope remains the shared
package catalog, not a tenant workspace.

Native PostgreSQL authentication also uses PostgreSQL notice triggers, allowing
email-verification and two-factor events to work during local startup checks.

## Local checks

Run `node --test scripts/tenant-only-migration.test.mjs` for populated SQLite
fixtures, collision rollback, permission conflicts, credentials, and widgets.
Run the API/admin suites for workspace selection, forms, permissions and routes.

For PostgreSQL, use a dedicated test server with database creation rights and set
`SAVIA_TEST_POSTGRES_URL`; then run the self-hosted
`tenant-isolation-migration.test.ts` and `postgres-migrations.test.ts` files.
These tests create and remove isolated databases. Never point them at a shared
production server.
