# PostgreSQL deployment option for Docker

Date: 2026-09-19
Status: Proposed for review; implementation has not started.

## Intent and acceptance boundary

Add PostgreSQL as an optional persistence backend for the existing native Docker deployment. Preserve the SQLite installation path and Cloudflare D1 deployment. Users should be able to install a fresh PostgreSQL-backed Savia or migrate an existing self-hosted SQLite installation without losing tenant records, permissions, files, credentials, or local-sync history.

The first release supports one application instance. PostgreSQL alone does not make process-local WebSockets, rate limits or scheduling safe for multiple application replicas. Distributed application execution, Cloudflare data export and managed PostgreSQL provisioning are separate work.

## Evidence from the current implementation

- `apps/self-hosted/src/application.ts` opens separate core, authentication and request SQLite databases. PostgreSQL must cover all three, not just collection records.
- `apps/self-hosted/src/sqlite.ts` implements the D1-shaped statement/batch interface, migration history, checksums and transactional rollback.
- Shared application code uses SQLite-specific JSON extraction/type/iteration, date functions, schema introspection, conflict syntax and insert metadata. Queries also construct dynamic filters and ACL predicates.
- Core migrations contain triggers protecting access revisions, record history and synchronization. Schema parity alone is insufficient.
- Authentication currently supplies a D1 database to Better Auth and asks Better Auth to initialize its schema. Native PostgreSQL authentication needs an explicit database adapter and compatible internal administrative queries.
- Docker S3 storage, CAPTCHA, hook sandbox and HTTP frontend are independent of the database backend.

## Approaches considered

1. **Explicit SQL dialect support and native PostgreSQL migrations (selected).** Preserve the shared business services and introduce narrowly scoped dialect operations where SQL differs. More initial work, but differences remain reviewable and testable.
2. **Translate arbitrary SQLite SQL at runtime.** Smaller apparent entry point, but creates a second SQL engine with difficult JSON, trigger, affinity and conflict semantics. Rejected as the production architecture.
3. **Rewrite all persistence around an ORM.** Broadly changes working Cloudflare and SQLite paths before delivering the deployment option. Rejected for this scope.

## Persistence boundary

Introduce a shared database capability contract compatible with the existing prepared-statement API. Existing Cloudflare bindings retain their default SQLite dialect. The native runtime selects SQLite or PostgreSQL explicitly.

The PostgreSQL driver owns a bounded connection pool, parameter binding, result normalization, transactional batches and graceful shutdown. A batch reserves one connection from BEGIN through COMMIT or ROLLBACK; no statement may escape to another pool connection. Do not implement transaction state with process-global mutable state. Queries must not interpolate bound values.

Keep parameter conversion lexical and limited to placeholders; do not attempt general SQL rewriting. Placeholders in quoted literals, identifiers and comments must remain unchanged. PostgreSQL-specific SQL is constructed explicitly by dialect operations or named backend-specific statements.

Dialect operations cover JSON values/types/array iteration, timestamps, conflict policies, table/column introspection and identifier quoting. Preserve the API representation of timestamps, integer flags, JSON text, binary values, counts and generated IDs. Reject unsafe integer conversions. Preserve missing-versus-null JSON filter and ACL semantics through contract tests. Do not silently translate INSERT OR REPLACE into an update where delete/insert semantics are observable.

One PostgreSQL database has separate `savia_core`, `savia_auth` and `savia_request` schemas. Schema selection is fixed by trusted runtime configuration, never a tenant input. The runtime role does not require PostgreSQL superuser privileges. Tenant isolation remains enforced by the existing application authorization model.

## Authentication

Use Better Auth's native PostgreSQL database support through an injected database dependency while keeping its Cloudflare D1 configuration unchanged. Keep authentication's internal administrative SQL on the shared database boundary with explicit dialect support. Provision and migrate the authentication schema under the same deployment lock as the rest of startup; concurrent initializations must not race.

Validate bootstrap, password login, MFA, OAuth, remote MCP token exchange, session handling and password-reset configuration against real PostgreSQL. Existing secrets retain their meanings. Database selection must not regenerate encryption or authentication keys.

## Schema and migrations

Maintain native, versioned PostgreSQL migrations for the core and request schemas, including seed data, constraints, indexes and trigger functions. Record PostgreSQL migration checksums separately from SQLite history. Existing SQLite migrations remain unchanged.

Port revision increments, tombstones, audit/history capture, uniqueness and tenant lifecycle behavior explicitly. PostgreSQL triggers must preserve the externally observable semantics used by offline synchronization and access revocation. Every migrated capability needs corresponding contract evidence, including rollback behavior.

Use a PostgreSQL advisory lock for migration/startup coordination and fail startup if migrations are missing, changed or unsuccessful. Each supported migration runs atomically. A fresh installation and an upgrade must both work without manual SQL.

## Docker and configuration

SQLite remains the default. Add `SAVIA_DATABASE_DRIVER=sqlite|postgres` and a PostgreSQL connection setting supplied through the private environment file. Invalid selection, incomplete credentials and unsupported connection settings fail before traffic is accepted. Never log connection URLs containing credentials.

Provide a documented Compose override for PostgreSQL with a pinned supported image, private network connectivity, persistent volume and healthcheck. Do not publish the database port by default. The same application image supports either driver. External PostgreSQL connections support verified TLS; do not disable certificate verification as a convenience default.

The existing S3 volume and credentials are unchanged. Backup documentation must cover PostgreSQL, S3 and encryption/authentication secrets as a coordinated recovery set.

## SQLite import

Provide an explicit offline migration command, never an automatic startup migration. The source installation must be stopped and backed up. Open source SQLite files read-only and verify the source schema version before copying anything.

The destination must be newly initialized for import and contain no user data. Import core, authentication and request data with explicit type mappings and dependency ordering. Preserve identifiers, password hashes, MFA state, encrypted credentials, revisions, tombstones, audit history and object keys. S3 objects stay in their current store; changing object storage is not part of this command.

Prevent application triggers from producing duplicate history during the copy using controlled import migrations/trigger setup, without requiring superuser privileges. Load and validate foreign keys, row counts, keys and representative values, then synchronize generated-ID sequences before committing. Do not copy SQLite migration bookkeeping as PostgreSQL migration history.

A failed import rolls back the destination data and leaves the source unchanged. A successful import produces a non-secret verification report. Cutover remains explicit: retain the same secrets and S3 configuration, change the database driver, then start the app and verify it. Rollback before new PostgreSQL writes is possible by restoring the previous configuration; rollback after new writes requires a coordinated data recovery process.

## Verification and release criteria

- Real PostgreSQL driver contracts: placeholders, nulls/binary/numeric values, result metadata, batches, rollback, concurrent requests and connection cleanup.
- Schema contracts: migrations and seeds, triggers, FK/unique constraints, revisions, tombstones and audit history.
- Shared business contracts on both native databases: JSON filters/sorting, ACL predicates, CRUD, relations, transactions, public submissions, file metadata and workflows.
- Authentication and OAuth/MCP tests on PostgreSQL.
- Offline-sync tests include writes and access revocation, not merely initial record reads.
- Real SQLite-to-PostgreSQL fixture import covering all three databases, generated IDs, secrets, MFA, files and local-sync continuation; forced failure proves rollback/source preservation.
- Docker fresh install, restart, upgrade, healthcheck and full HTTP smoke against PostgreSQL.
- Existing SQLite smoke and Cloudflare regression lanes continue passing.
- Operator documentation states single-instance limits and supplies setup, migration, backup and restore commands.

Do not advertise PostgreSQL support or merge a selectable production path until these checks pass. A connection-only prototype is not completion.
