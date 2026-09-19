# PostgreSQL for Docker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. The original sequence is retained below; the execution record tracks delivered outcomes and deviations.

**Goal:** Deliver an optional PostgreSQL-backed Docker installation and verified offline import from SQLite, preserving existing deployments.

**Architecture:** Shared business services retain prepared statements; explicit dialect capabilities own SQL differences. The native composition root selects three PostgreSQL schemas or three SQLite files. PostgreSQL migrations and import validation are separate from SQLite migration history.

**Tech Stack:** Existing Node 22 runtime, TypeScript, Vitest, Docker Compose, `pg` (already used by db-bridge), Better Auth 1.7.2, PostgreSQL 17 release line.

**Spec:** `docs/superpowers/specs/2026-09-19-postgres-docker-design.md` (approved by the user).

## Global Constraints

- Preserve the SQLite installation path and Cloudflare D1 deployment.
- The first release supports one application instance.
- Do not implement general SQLite-to-PostgreSQL SQL rewriting.
- PostgreSQL must cover core, authentication and request data.
- Never log connection URLs containing credentials.
- A failed import rolls back the destination data and leaves the source unchanged.
- Do not advertise PostgreSQL support or merge a selectable production path until the release checks pass.
- English source, tests, guides and conventional commits; preserve existing localized product messages.

## Review Focus

- JSON false, zero, missing and explicit null must not change filter results or widen ACL access (Tasks 2 and 4).
- A pooled transaction failure must not commit another request's statements or leak a poisoned connection (Task 1).
- Parallel startup must not replay seeds, race authentication initialization or accept traffic before migration completion (Tasks 3 and 5).
- Import failure after copying authentication must not leave a partly populated destination or alter the source (Task 7).
- Generated IDs and encrypted/MFA data must remain usable after migration and restart (Tasks 7 and 8).

## Execution boundaries and file ownership

Use the clean isolated `codex/postgres-docker` branch, based on the completed Docker runtime. Refresh `origin/main` before implementation and before integration; preserve unrelated changes. The spec and plan are the only changes currently committed on this branch.

Tasks 1–3 establish contracts; Task 4 depends on them. Tasks 5–8 integrate and verify the complete system. Do not expose a partially working driver through the production configuration. If delegated, keep shared manifests, runtime wiring and integration commits with one owner; database dialect and native driver work have separate files. Review each completed task before dependent work proceeds.

The new modules are:

| Module                                           | Responsibility                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `packages/db/src/dialect.ts`                     | Runtime-neutral SQL capability interface and SQLite default            |
| `packages/db/src/postgres-dialect.ts`            | Explicit PostgreSQL expressions and statements, no Node imports        |
| `apps/self-hosted/src/postgres/parameters.ts`    | Lexical placeholder conversion                                         |
| `apps/self-hosted/src/postgres/database.ts`      | Pool, prepared statements, transactional batches, result normalization |
| `apps/self-hosted/src/postgres/migrations.ts`    | Migration checksums, advisory locking and schema initialization        |
| `apps/self-hosted/src/databases.ts`              | Open/close three stores and provide authentication's native database   |
| `apps/self-hosted/src/postgres/import-sqlite.ts` | Read-only source inspection and atomic destination import              |
| `apps/self-hosted/src/postgres/import-cli.ts`    | Explicit offline command and non-secret report                         |
| `apps/self-hosted/test/postgres-fixture.ts`      | Disposable real PostgreSQL database fixture and cleanup                |
| `packages/db/postgres/`                          | Reviewed core migration SQL and parity manifest                        |
| `apps/savia-request/postgres/`                   | Reviewed request-store migration SQL                                   |

### Task 1: Real PostgreSQL statement and transaction driver

**Files:** Create the PostgreSQL driver, parameters and fixture modules listed above; create `apps/self-hosted/test/postgres-database.test.ts`; modify `apps/self-hosted/package.json` and the lockfile.

**Interfaces:**

```ts
export function postgresParameters(sql: string): {
  text: string;
  parameterCount: number;
};
export function openPostgresDatabase(options: {
  connectionString: string;
  schema: "savia_core" | "savia_auth" | "savia_request";
  maxConnections: number;
}): PostgresDatabase;
// PostgresDatabase implements D1Database and adds close(): Promise<void>.
// Its prepare/bind/first/all/run/raw/batch methods preserve the existing API contract.
```

- Add `pg` and its types using the existing workspace version range. Build a disposable PostgreSQL test fixture using a dedicated test URL, unique database name, and a finally block that closes connections and removes only that fixture database. Tests must fail clearly when the live lane is requested without its database; optional default tests may skip that lane.
- Write failing placeholder and live transaction cases. Keep the driver tests independent of application migrations:

```ts
expect(postgresParameters("SELECT '?' AS literal, ? AS value -- ?\n")).toEqual({
  text: "SELECT '?' AS literal, $1 AS value -- ?\n",
  parameterCount: 1,
});
await db.exec("CREATE TABLE item (id INTEGER PRIMARY KEY, value TEXT)");
await expect(
  db.batch([
    db.prepare("INSERT INTO item VALUES (?,?)").bind(1, "first"),
    db.prepare("INSERT INTO item VALUES (?,?)").bind(1, "duplicate"),
  ]),
).rejects.toThrow();
expect(await db.prepare("SELECT count(*) AS n FROM item").first("n")).toBe(0);
```

- Run `pnpm --filter @savia/self-hosted exec vitest run test/postgres-database.test.ts`; confirm the missing driver causes failure. Add cases for dollar-quoted strings, escaped quotes, comments, malformed parameters, buffers, null values, empty raw results and unsafe bigint conversion.
- Implement positional conversion with a lexer, immutable bound statements, per-pool value parsers and checked integer conversion. Use a reserved client for batches with `BEGIN`, `COMMIT`, `ROLLBACK` and `finally { client.release(); }`. Reject cross-database statements. Never execute multiple prepared SQL statements as an accidental batch.
- Verify two concurrent batches, a failed batch followed by a successful query, affected-row counts and generated-ID metadata against real PostgreSQL. Generated IDs must use explicit RETURNING support or named insert operations; do not pretend a pooled session's `lastval()` is the last insert for an arbitrary caller.
- Commit `feat: add PostgreSQL database adapter contracts` after the focused tests and native typecheck pass.

### Task 2: Explicit SQL dialect operations

**Files:** Create `packages/db/src/dialect.ts`, `packages/db/src/postgres-dialect.ts`, `apps/self-hosted/test/database-dialect.test.ts`; update `packages/db/package.json` exports and consumers' workspace dependencies.

**Interfaces:**

```ts
export type SqlStatement = { sql: string; parameters: unknown[] };
export interface SqlDialect {
  readonly name: "sqlite" | "postgres";
  quoteIdentifier(name: string): string;
  jsonValue(document: string, path: string): string;
  jsonType(document: string, path: string): string;
  jsonEach(document: string, path: string, alias: string): string;
  utcNow(): string;
  tableExists(name: string): SqlStatement;
  tableColumns(name: string): SqlStatement;
}
export function dialectFor(database: object): SqlDialect;
export function registerDialect(database: object, dialect: SqlDialect): void;
```

The arguments to expression functions are trusted SQL expressions assembled by code; paths derived from user fields must be bound or validated and encoded, never directly interpolated. `dialectFor` defaults to SQLite for unregistered D1 bindings. The registry is a WeakMap, not a mutable process-wide selected backend.

- Write a cross-database fixture containing `{"value":null}`, `{}`, `{"value":false}`, `{"value":0}`, arrays, numeric-looking strings and quoted Unicode keys. Assert identical result sets, ordering and type predicates for the user-visible operators, including relation membership.
- Run the dialect test before implementation and observe the missing capability failure.
- Implement explicit SQLite and PostgreSQL expressions with contract-preserving type handling. Do not globally cast every JSON value to text: numerical comparisons and boolean filters need defined types. Add named statement builders where a single expression cannot preserve semantics.
- Add identifier escaping and malicious field/path cases; assert that they remain data or fail validation and cannot alter SQL structure. Add date output and table/column introspection cases.
- Run the dialect tests on both engines and commit `feat: add explicit database dialect capabilities`.

### Task 3: Native PostgreSQL schema, seeds and trigger parity

**Files:** Create `packages/db/postgres/0001_baseline.sql`, `packages/db/postgres/manifest.json`, `apps/savia-request/postgres/0001_baseline.sql`, `apps/self-hosted/src/postgres/migrations.ts`, `apps/self-hosted/test/postgres-migrations.test.ts`.

**Interfaces:**

```ts
export async function migratePostgres(options: {
  connectionString: string;
  schema: "savia_core" | "savia_request";
  directory: string;
  seed: boolean;
}): Promise<string[]>;
```

- Inventory every current SQL migration in the core and request directories. Record filename/checksum coverage in the parity manifest and map each table, constraint, index, seed and trigger to the native baseline. Later PostgreSQL changes append their own migrations rather than editing the baseline.
- Write failing live tests for empty initialization, idempotent restart, changed/missing applied migration rejection, rollback on invalid SQL and simultaneous initialization. Use a unique fixture schema; assert no seed duplicates after two concurrent calls.
- Implement checksum tracking and an advisory lock on one dedicated connection. Establish trusted schema search paths and release the lock in all failure paths. Keep migration SQL transactional and refuse an unknown schema name.
- Author native PostgreSQL DDL and trigger functions. Use integer flags and API-compatible textual timestamps for shared core/request data unless a reviewed mapping requires otherwise. Port history, sync revisions, deletion tombstones and tenant cleanup explicitly. Provide import mode without user-data seeds.
- Add trigger parity assertions on insert/update/delete, rolled-back writes, tenant removal and access revocation. Compare externally visible history and cursor results to SQLite rather than asserting only table existence.
- Run `pnpm --filter @savia/self-hosted exec vitest run test/postgres-migrations.test.ts`; commit `feat: add PostgreSQL migrations and revision triggers`.

### Task 4: Port shared SQL consumers without changing business semantics

**Files:** Modify the SQL-bearing consumers in these groups, and record each reviewed file in `docs/superpowers/plans/2026-09-19-postgres-sql-inventory.md`:

- `packages/crm-server/src/{query,access-query,access-authorization,services,schema,index,operations,local-sync,record-history,record-history-storage,office-files,solutions,extensions,menu-layout,geocoding-settings}.ts`
- `packages/crm-server/src/workflows/runtime.ts`
- `apps/api/src/auth/{access-registry,access-repository,access-audit,access-compatibility,tenant-membership-invariants}.ts`
- `apps/api/src/crm/{collection-gateway,collection-relations,record-bundles,hubspot-workspace,auto-sync}.ts`
- `apps/api/src/routes/{tenants,data-domains,dynamic-crm,crm}.ts`
- `apps/api/src/tenant-branding/{service,routes}.ts`, `apps/api/src/request-pages/routes.ts`
- `apps/savia-request/src/server/{store,index}.ts`, `apps/auth/src/oauth.ts`
- Create `apps/self-hosted/test/postgres-business.test.ts` and extend existing focused tests alongside each consumer.

**Interfaces:** Consume `dialectFor(database)` and named statement builders from Task 2. Preserve public business-service signatures and API payloads. Pure query builders accept an optional dialect argument whose default is SQLite.

- Scan the full workspace for dialect assumptions, including `INSERT OR`, JSON functions, `PRAGMA`, `sqlite_master`, `strftime`, collations, casts, generated IDs and SQLite's permissive GROUP BY. Treat this scan as an inventory aid, not proof of completeness; review each raw SQL consumer.
- For each group, first add an engine-paired behavior regression. Start with filtered collection CRUD, then relations/ACL, then revisions/history, then metadata/plugins/workflows and peripheral stores. Keep each group in a separately reviewable commit.
- Replace SQLite-specific constructs with the explicit dialect capability or a reviewed named statement. Keep conflict targets explicit. Where REPLACE has observable delete/insert effects, implement a transactional operation preserving those effects rather than substituting ON CONFLICT UPDATE.
- Exercise identical query/ACL fixtures on SQLite and PostgreSQL. Include these acceptance assertions:

```ts
expect(postgresVisibleRecordIds).toEqual(sqliteVisibleRecordIds);
expect(postgresAfterRevocation).not.toContain(restrictedRecordId);
expect(postgresSyncAfterDelete.tombstones).toEqual(
  sqliteSyncAfterDelete.tombstones,
);
expect(postgresVersionAfterRollback).toBe(postgresVersionBeforeRollback);
```

- Run each group's original regression files plus `test/postgres-business.test.ts`; require actual PostgreSQL execution, not a fake D1 implementation. Verify query plans for paginated collection access and sync cursors use the intended indexes on a nontrivial fixture.
- Commit each finished group as `refactor: support PostgreSQL in <domain> persistence`. Re-run the inventory and explain remaining SQLite-only occurrences before marking this task complete.

### Task 5: PostgreSQL authentication and native composition

**Files:** Create `apps/self-hosted/src/databases.ts`, `apps/self-hosted/test/postgres-auth.test.ts`; modify `apps/auth/src/index.ts`, `apps/self-hosted/src/application.ts`, `apps/self-hosted/src/config.ts`, `apps/self-hosted/test/application.test.ts`.

**Interfaces:**

```ts
export interface DatabaseSet {
  core: D1Database;
  auth: D1Database;
  request: D1Database;
  authDatabase: import("better-auth").BetterAuthOptions["database"];
  initialize(): Promise<void>;
  close(): Promise<void>;
}
// openDatabases consumes the validated database configuration union.
```

Add an optional native database dependency to the existing `AuthDependencies`; default to `environment.AUTH_DB`. Authentication initialization must share the startup advisory-lock boundary, and the existing request path must not repeat unlocked native DDL. Keep the internal administrative-query database separate from the Better Auth native adapter configuration, but backed by the same auth schema.

- Read the installed Better Auth native PostgreSQL and migration implementation before choosing the injection. Confirm its expected pool/schema configuration with an executable test; do not cast a D1 wrapper into a PostgreSQL pool.
- Parameterize the real application fixture by driver and add failing PostgreSQL tests for bootstrap login, MFA enrollment/verification, restart, session revocation and OAuth/MCP exchange.
- Implement `DatabaseSet` with bounded total connection counts, trusted schema names and awaited close on startup failures and normal shutdown. Preserve the SQLite initialization path unchanged in behavior.
- Serialize native authentication schema initialization with core/request initialization. Test concurrent initialization, invalid credentials, unavailable database and migration failure: each must reject startup without leaking pools or serving partial traffic.
- Run native auth/application fixtures, the existing auth suite and typecheck. Commit `feat: compose Savia with PostgreSQL authentication and stores`.

### Task 6: Optional Compose configuration and operational documentation

**Files:** Create `docker-compose.self-hosted.postgres.yml`, `apps/self-hosted/test/postgres-config.test.ts`; modify `apps/self-hosted/src/config.ts`, `infra/self-hosted/env.example`, `scripts/configure-self-hosted.mjs`, `docs/guides/self-hosted-docker.md`, `apps/self-hosted/Dockerfile` only if packaging requires it.

**Interfaces:**

```ts
type DatabaseConfiguration =
  | { driver: "sqlite"; dataDirectory: string }
  | { driver: "postgres"; connectionString: string; maxConnections: number };
```

- Write failing configuration tests: absent driver means SQLite; unknown driver, missing PostgreSQL URL, invalid pool size and insecure externally configured TLS fail with redacted errors.
- Implement configuration parsing and helper support for explicit driver selection. Keep secrets in the existing ignored file. Pin the PostgreSQL 17 image to a tested patch/digest when building the Compose override; document that selected artifact.
- Add the private PostgreSQL service, healthcheck, persistent volume and application dependency in the override. Do not publish port 5432. Verify the base SQLite Compose file still resolves independently.
- Build the application image and start the PostgreSQL override from empty volumes. Run health, authenticated CRUD and restart checks before calling this configuration usable.
- Document `docker compose -f docker-compose.self-hosted.yml -f docker-compose.self-hosted.postgres.yml up --build -d`, required secrets, verified external TLS, single-instance limits, database-plus-S3 backup and a tested restore command sequence. Explain that the SQL source connector is unrelated to the application's own database selection.
- Commit `feat: add optional PostgreSQL Docker deployment` after configuration and fresh-start tests pass.

### Task 7: Atomic offline SQLite import

**Files:** Create `apps/self-hosted/src/postgres/{import-sqlite,import-cli,import-mappings}.ts`, `apps/self-hosted/test/postgres-import.test.ts`; update `apps/self-hosted/package.json` and the Docker guide.

**Interfaces:**

```ts
export async function importSqlite(options: {
  sourceDirectory: string;
  destinationUrl: string;
}): Promise<{
  tables: Array<{
    schema: string;
    table: string;
    sourceRows: number;
    importedRows: number;
  }>;
  verified: true;
}>;
```

- Build a SQLite fixture through the real application containing MFA, an encrypted credential, related tenant records, history, a tombstone, access revisions, request data and an S3 object key. Record source file checksums before import.
- Write failing tests for successful round-trip, unknown source schema, nonempty destination and an injected row-copy failure after authentication data has been copied. Assert all three destination schemas remain empty of imported data after failure and source checksums remain unchanged.
- Implement read-only source opens and explicit schema/type mappings. Obtain a destination advisory lock and reserve one connection for the cross-schema import transaction. Refuse incompatible source histories, partial target installations and any existing user data.
- Initialize import-ready schema without normal data seeds; load data in dependency order with only application-owned triggers controlled during import. Use the reviewed mapping for auth booleans/timestamps and all generated IDs. Validate constraints and synchronize sequences before commit; do not need superuser or disable server-wide replication/constraint enforcement.
- Verify counts, IDs and mapped-value digests; compare decrypted fixture credentials and successful MFA after starting the imported application with unchanged secrets. Verify the next generated ID cannot collide and old local-sync cursors still work. Report counts without passwords, tokens or encrypted payloads.
- Add the explicit offline CLI command and documented source-stop/backup/cutover/rollback sequence. Do not auto-import on application boot or modify the source configuration.
- Run `test/postgres-import.test.ts` against PostgreSQL and commit `feat: migrate self-hosted SQLite data to PostgreSQL`.

### Task 8: Full compatibility, real Docker and release review

**Files:** Extend `apps/self-hosted/test/docker.integration.test.ts`; create `apps/self-hosted/test/postgres-release.test.ts`; update the Docker guide, documentation index and this plan with actual evidence.

- Run full native tests with a real PostgreSQL fixture enabled, plus `pnpm run typecheck`, `pnpm run test:unit:api`, `pnpm run test:unit:admin`, `pnpm run test:unit:workspace` and `pnpm run test:contracts`. Record exact failures and reruns; never label a failing aggregate run green.
- Build from the final branch and exercise a fresh PostgreSQL Docker install, real MFA, tenant/collection CRUD, filtered pagination, relations/ACL, public CAPTCHA submission, S3 upload/download, WebSockets, MCP and workflow persistence.
- Recreate containers retaining volumes; verify prior records, files, MFA, sync cursors and history. Perform the SQLite import into a separate disposable stack and repeat the HTTP smoke.
- Restore a database backup plus its matching S3 fixture and secrets into a disposable project; verify the same persisted fixtures. Do not delete or repurpose existing user volumes.
- Re-run the existing SQLite Docker smoke and verify Cloudflare runtime build/test compatibility. Stop disposable stacks and retain or clean only explicitly owned fixtures.
- Obtain a whole-branch review concentrating on tenant isolation, transactions, JSON/ACL semantics, migration integrity, credential preservation and pool lifecycle; resolve findings and run affected checks.
- Refresh main, integrate safely, repeat checks affected by incoming changes and push only after all release criteria pass. Report the commit, supported topology, migration instructions and any remaining limitations without claiming multi-instance readiness.

## Plan self-review

The tasks cover every accepted spec area: driver and SQL semantics (1–4), all three stores and authentication (3–5), optional Docker and secure configuration (6), source-preserving import (7), and backup/restore plus deployment verification (8). Each review-focus item has explicit regression coverage. General SQL translation and distributed execution are excluded. Shared interfaces are declared at their first producer and consumed by later tasks.

## Execution record — 2026-09-19

Tasks 1–7 are implemented and reviewed. The SQL inventory is published as `docs/guides/postgres-sql-compatibility.md`. Implementation commits are consolidated for integration instead of following the proposed per-task commit sequence. Incoming main migration 0059 is supported by additive PostgreSQL migration 0002, preserving the baseline checksum.

- [x] Native PostgreSQL lane: 21 files and 94 tests passed; two optional S3/Docker cases skipped in that lane and covered by separate Docker runs.
- [x] Full monorepo typecheck and final self-hosted typecheck passed.
- [x] API: 70 files / 475 tests passed. Workspace and contract lanes passed. Changed SQLite ACL, workflow and auth regressions passed.
- [x] Admin aggregate: 939 tests passed, two timing failures in `app.test.ts`; its unchanged focused rerun passed all 18 tests. The original aggregate is not reported as green.
- [x] Docker PostgreSQL fresh install and container recreation passed MFA, CRUD, attachments, CAPTCHA, WebSocket and MCP HTTP checks, including persisted history, old sync cursors and tombstones. Native integration tests separately cover filtered pagination, relations/ACL and workflows.
- [x] Coordinated PostgreSQL dump, object storage and secrets restored into a separate disposable Docker project; the persisted HTTP fixture passed.
- [x] SQLite Docker fresh installation and recreation passed the same HTTP fixture.
- [x] Actual Docker SQLite import verified 334 tables and 103 fixture rows; migrated HTTP checks passed with original MFA, records, history, sync cursors, tombstones and S3 files. A read-only volume failure was reproduced and fixed with immutable SQLite source URIs; the focused importer lane passed all four tests with read-only files and directory, and typecheck passed.
- [x] Scoped implementation reviews completed; final pool lifecycle and lazy auth startup review found no blocker.
- [x] All release gates passed; owned fixtures stopped and main refreshed without additional changes. Implementation is consolidated into the release commit; the push result is reported separately.

The remote main history was replaced during implementation. Its tree changes were integrated and the feature rebased onto the new main without discarding working changes; integration uses a normal fast-forward push. The previous branch history is retained on a local backup branch.

Final Docker image validation compared all 989 runtime source files with the workspace with no differences. The full build was followed by source overlays for the verified lazy-auth and immutable-import corrections; dependencies and frontend output were unchanged.
