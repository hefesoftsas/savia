# External database plugins implementation plan

## Implementation status — 2026-09-19

Tasks 1–8 are implemented. Task 9 delivered the guide, disposable live fixtures,
regression suites, and independent review. All five review findings were fixed
with regression coverage. Runtime adapters share a transactional relational core;
MongoDB uses a directly configured endpoint to preserve host allowlists.

Verified: shared contracts (103 tests), bridge (41 tests), admin database forms
and source manager (22 tests), API source/migration/policy suites, generated API
contracts, and the bundled bridge build. Browser inspection covered source choices,
SQL Server TLS/defaults, and MongoDB connection fields. Native CRUD passed for all
four engines. The final PostgreSQL, MySQL and MongoDB run passed; SQL Server
passed separately after replacing log-based startup detection with authenticated
query readiness. The runner starts and removes each engine sequentially.
Repository validation completed on the final implementation:

- `pnpm run typecheck`: passed across all packages.
- Admin: 138 test files, 710 tests passed.
- API: 54 test files, 321 tests passed.
- Remaining workspace packages, run sequentially: 74 test files, 391 tests passed.
- Repository contracts: 53 tests passed.
- Total: 1,475 passing tests. Four native fixture tests are intentionally skipped
  by the unit lane and were verified separately against their database engines.

The earlier admin failures did not recur when run without heavy concurrent load.
`pnpm run lint` remains non-green: 32 formatting warnings occur in files unchanged
by this task, and the existing command passes `scripts/dev-local.sh` to Prettier
without a shell parser. None of the task-modified files appears in those warnings.
Detailed local command results are recorded in the execution ledger.

Integration verification against `main` at `02b4764`: full TypeScript check passed,
471 tests in the affected admin suites passed, all 397 API tests passed, all
450 workspace tests passed, and repository contracts passed. The prior merged
admin-wide run also passed 781 tests. The form conflict retains both database
adaptation and related-record scope handling; a duplicate OpenAPI import from
the automatic merge was removed.

The original checklist below remains as the planned specification; the status
above records the actual delivered and verified scope.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver PostgreSQL, MySQL, SQL Server, and MongoDB source adapters with discovery, metadata synchronization, and permission-controlled CRUD in Savia.

**Architecture:** Retain the Worker-to-Node bridge and register four native drivers behind one validated protocol. Keep source credentials, source policy, and collection authorization in the backend. Integrate through the existing source manager and collection record surfaces.

**Tech Stack:** TypeScript, Zod, Hono, Cloudflare Workers/D1, React, Vitest, pnpm, pg, mysql2, mssql, mongodb.

**Spec:** [Approved design](../specs/2026-09-19-external-database-plugins-design.md).

**Status:** Implemented and verified. Integration with current `main` preserves scoped permissions, related-record forms, offline bundles, and workflows.

## Global constraints

- Use stable engine kinds `postgres`, `mysql`, `mssql`, and `mongodb`.
- Keep native drivers out of the Worker and browser dependency graphs.
- Keep current PostgreSQL sources and bindings read-only after migration.
- New sources default to read-only and may enable writes in configuration.
- Views remain read-only.
- Synchronization never issues external DDL.
- Do not retry writes automatically after a timeout; the outcome may be uncertain.
- Do not introduce a local row mirror or imply realtime detection of writes made outside Savia.
- Code, tests, and docs in English. Follow existing application localization conventions for user-visible text.
- API reference is generated (OpenAPI/Scalar), never hand-written.
- Use the existing isolated worktree; inspect its state before execution. Do not deploy or mutate existing business databases as part of verification.

## Review focus

1. Disabling writes after binding must immediately block stale browser requests, not merely hide buttons. Task 7 tests source-policy revocation.
2. A lost response after commit must not cause a duplicate write. Tasks 3 and 7 test one dispatch and explicit uncertain-outcome reporting.
3. A 24-character hexadecimal MongoDB string identifier must remain distinct from ObjectId. Task 6 tests both types with the same text.
4. Two connections with the same host but different credentials must never share an authenticated pool. Task 3 tests pool key isolation and eviction.
5. A schema change after binding must not allow writing a newly generated or incompatible field. Tasks 2, 4–7 test fresh metadata enforcement and stale binding reconciliation.

## File ownership and delivery order

Contracts and capability rules belong in `packages/crm-shared`. Native driver code belongs in `apps/db-bridge`. Backend source lifecycle and dispatch belong in `apps/api/src/crm`. UI consumes metadata and capabilities; it does not infer authorization. Tasks are sequential because their interfaces depend on the preceding tasks. The four native adapters form one subsystem, not four independently redesigned products.

Each task follows red/green verification and commits only its own changes using the commit message provided. Run existing affected tests before the first edit to distinguish regressions. Do not treat a test import error caused by unrelated setup as the expected red result.

## Task 1: Preserve PostgreSQL scalar values

**Files:** Modify `apps/db-bridge/src/pg-driver.ts`; test `apps/db-bridge/test/pg-driver.test.ts`.

**Interface:** Existing exported `serializeValue(value: unknown): string | number | boolean | null` stays compatible.

- [ ] Add the following regression tests to the existing driver suite, importing `serializeValue`:

```ts
it.each(["Acme", "", true, false, 0, 1.5, null])(
  "preserves the scalar %j",
  (value) => {
    expect(serializeValue(value)).toBe(value);
  },
);
it("preserves bigint precision and rejects nonfinite numbers", () => {
  expect(serializeValue(9007199254740993n)).toBe("9007199254740993");
  expect(serializeValue(NaN)).toBeNull();
  expect(serializeValue(Infinity)).toBeNull();
});
```

- [ ] Run `pnpm --filter @savia/db-bridge test test/pg-driver.test.ts`; strings and booleans must expose the defect.
- [ ] Split primitive handling before the existing Date, Buffer, and object branches:

```ts
if (typeof value === "string" || typeof value === "boolean") return value;
if (typeof value === "number") return Number.isFinite(value) ? value : null;
```

- [ ] Run the full bridge suite and commit `fix: preserve PostgreSQL scalar values`.

## Task 2: Define neutral connection, metadata, and CRUD contracts

**Files:** Create `packages/crm-shared/src/database-sources.ts` and `packages/crm-shared/test/database-sources.test.ts`; modify `packages/crm-shared/src/sql-sources.ts` and `packages/crm-shared/src/metadata.ts`.

**Interfaces:** Export the following types and Zod schemas from `database-sources.ts`. Infer runtime types from schemas; these signatures define the intended shape.

```ts
export type DatabaseKind = "postgres" | "mysql" | "mssql" | "mongodb";
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type DatabaseConnection =
  | {
      kind: "postgres";
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
      schema: string;
      ssl: boolean;
    }
  | {
      kind: "mysql";
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
      ssl: boolean;
    }
  | {
      kind: "mssql";
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
      schema: string;
      encrypt: boolean;
      trustServerCertificate: boolean;
    }
  | {
      kind: "mongodb";
      host: string;
      port: number;
      database: string;
      username?: string;
      password?: string;
      authSource: string;
      replicaSet?: string;
      ssl: boolean;
    };
export type DatabaseField = {
  name: string;
  nativeType: string;
  valueType:
    | "string"
    | "boolean"
    | "number"
    | "decimal"
    | "bigint"
    | "date"
    | "json"
    | "binary"
    | "unsupported";
  nullable: boolean;
  generated: boolean;
  writable: boolean;
  hasDefault: boolean;
  defaultValue?: string | null;
};
export type ResourceMetadata = {
  resource: string;
  kind: "table" | "view" | "collection";
  fields: DatabaseField[];
  primaryKey: string[];
  uniqueKeys: string[][];
  idType?: "string" | "objectId";
  sampled: boolean;
};
export type DatabaseRead = {
  connection: DatabaseConnection;
  resource: string;
  operation: "list" | "read";
  id?: string;
  idColumn?: string;
  idType?: "string" | "objectId";
  columns: string[];
  page: number;
  perPage: number;
  sort?: string;
  order: "ASC" | "DESC";
  filters: {
    field: string;
    op: "eq";
    value: null | boolean | number | string;
  }[];
  search?: string;
  searchColumns: string[];
};
export type DatabaseMutation = {
  connection: DatabaseConnection;
  resource: string;
  idColumn: string;
  idType?: "string" | "objectId";
  columns: string[];
} & (
  | { operation: "create"; values: Record<string, JsonValue> }
  | { operation: "update"; id: string; values: Record<string, JsonValue> }
  | { operation: "delete"; id: string }
);
export type DatabaseResult = {
  data: Record<string, JsonValue> | Record<string, JsonValue>[] | null;
  page?: number;
  perPage?: number;
  total?: number;
  hasNext?: boolean;
};
```

- [ ] Export schemas named `databaseConnectionSchema`, `databaseReadSchema`, `databaseMutationSchema`, `resourceMetadataSchema`, and `databaseResultSchema`. Export `databaseSourceInputSchema` and `databaseSourceConfigSchema` for source persistence: input includes `id`, `label`, connection settings, and `writeEnabled`; persisted config excludes password, id, label, and kind. The persisted source row retains kind. Export a display registry `databaseKinds` keyed by `DatabaseKind`.
- [ ] Add a contract test with a complete fixture:

```ts
const connection = {
  kind: "postgres",
  host: "pg.internal",
  port: 5432,
  database: "erp",
  username: "writer",
  password: "secret",
  schema: "public",
  ssl: true,
};
it("requires an identifier for update", () => {
  expect(
    databaseMutationSchema.safeParse({
      connection,
      resource: "orders",
      idColumn: "id",
      columns: ["id", "name"],
      operation: "update",
      values: { name: "Acme" },
    }).success,
  ).toBe(false);
});
it("defaults persisted sources to read-only", () => {
  const { password, kind, ...settings } = connection;
  expect(
    databaseSourceConfigSchema.parse({ kind, ...settings }).writeEnabled,
  ).toBe(false);
});
```

The persisted-config schema consumes a kind discriminator to validate then omits it from stored config; parsing reconstructs it from the row. Fix the test/transform together so kind cannot be persisted inconsistently.

- [ ] Run `pnpm --filter @savia/crm-shared test test/database-sources.test.ts` for red evidence.
- [ ] Implement strict discriminated schemas with engine defaults, finite JSON numbers, body/value size limits, per-page limit 100, maximum 20 filters and search fields, maximum 100 projected fields, and maximum 500 discovered resources. Bound JSON depth and total payload size. Reject dangerous keys (`__proto__`, `constructor`, `prototype`) and Mongo operator/path keys in writable field names. SQL identifiers remain quoted and validated; Mongo collection names use their own validator rather than the SQL regex.
- [ ] Export `resolveRecordKey(metadata: ResourceMetadata, selected?: string): string | undefined`; select only a non-null single-column primary/unique key. Mongo uses `_id` only with supported id metadata. Export `deriveDatabaseCapabilities(metadata, writeEnabled, idColumn?)`, returning the existing `CollectionCapabilities` type; resource/field support can restrict but never grant permissions. Views disable writes. Resources with no usable key remain list-only.
- [ ] Add table tests for every engine default, missing/extra settings, compound keys, nullable unique keys, views, malformed identifiers, unsafe values, and missing Mongo id metadata. Preserve legacy PostgreSQL exports and read protocol during transition; introduce an explicit conversion to neutral metadata instead of renaming persisted properties blindly.
- [ ] Run shared tests and typecheck; commit `feat: define database source contracts and capabilities`.

## Task 3: Register drivers and enforce the bridge boundary

**Files:** Modify `apps/db-bridge/src/driver.ts`, `app.ts`, `index.ts`, and `test/app.test.ts`. Create `src/database-errors.ts`, `src/connection-pools.ts`, `test/connection-pools.test.ts`; modify `apps/api/src/crm/sql-bridge.ts` and add `apps/api/test/database-bridge-client.test.ts`.

**Interfaces:** Keep the legacy `BridgeDriver`/`SqlBridgeClient` until migration is complete. Introduce `DatabaseDriver` and `DatabaseBridgeClient`:

```ts
export interface DatabaseDriver {
  testConnection(connection: DatabaseConnection): Promise<void>;
  listResources(connection: DatabaseConnection): Promise<
    {
      resource: string;
      kind: "table" | "view" | "collection";
    }[]
  >;
  inspect(
    connection: DatabaseConnection,
    resource: string,
  ): Promise<ResourceMetadata>;
  read(input: DatabaseRead): Promise<DatabaseResult>;
  mutate(input: DatabaseMutation): Promise<DatabaseResult>;
  close(): Promise<void>;
}
export type DatabaseBridgeClient = Omit<DatabaseDriver, "close">;
```

Import shared types from Task 2. Export `DatabaseBridgeError` with a safe code, status, and optional `outcome: "unknown"`; never return raw native exceptions. Add `createDatabaseBridgeClient` beside the legacy client.

- [ ] Extend `createDbBridgeApp` options with `drivers?: Partial<Record<DatabaseKind, DatabaseDriver>>`. Retain the optional legacy `driver` while existing tests/callers migrate.
- [ ] Add authenticated `/database/test`, `/database/resources`, `/database/inspect`, `/database/read`, and `/database/mutate` endpoints. The client uses these exact paths. Test an invalid mutation before driver dispatch:

```ts
it("rejects an update without its identifier", async () => {
  const app = createDbBridgeApp({ drivers: {}, sharedSecret: "test-secret" });
  const response = await app.request("http://bridge/database/mutate", {
    method: "POST",
    headers: {
      authorization: "Bearer test-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ operation: "update" }),
  });
  expect(response.status).toBe(422);
});
```

- [ ] Run bridge tests for red evidence, then apply auth, allowlist, size limit, schema validation, and engine selection in that order after parsing the minimal envelope. Missing registered engines return 503. Invalid bodies return 422 before dispatch. Connection validation must also apply to all hosts discovered by Mongo topology; reject connections to unapproved discovered hosts or constrain to a directly configured endpoint.
- [ ] Implement bounded pools keyed by every connection-affecting setting including password, auth source, TLS, and engine. Never log keys. Close evicted pools without terminating in-flight work; shutdown drains active operations with a bounded timeout. Test two credentials on one host get separate pools and eviction closes only the evicted resource.
- [ ] Make the HTTP client validate result schemas, reject redirects, enforce the existing request timeout, map safe 404/409/422/503/504 responses, and dispatch writes once. Aborted mutation responses report unknown outcome. Inject a counting fetcher that throws after receiving a mutation and assert exactly one invocation.
- [ ] Run bridge and bridge-client tests plus affected typechecks; commit `feat: add multi-engine database bridge protocol`.

## Task 4: Complete PostgreSQL discovery and CRUD

**Files:** Modify `apps/db-bridge/src/pg-driver.ts`, `test/pg-driver.test.ts`; create `src/database-values.ts`, `test/database-values.test.ts`, and `test/pg-crud.test.ts`.

**Interface:** Add `createPostgresDatabaseDriver(): DatabaseDriver`; retain `createPgDriver` as a legacy read adapter until Task 7 migrates consumers. Shared conversion in `database-values.ts` consumes `DatabaseField` and `JsonValue`.

- [ ] Add regression tests for actual view kind, identity/generated fields, compound constraints, defaults, no-match writes, unsafe projection, and schema drift. Use driver mocks to assert SQL text and parameters independently of builder output. For example, a mocked write result with zero returned rows must produce a safe 404, not `{data: null}` success.
- [ ] Run `pnpm --filter @savia/db-bridge test test/pg-driver.test.ts test/pg-crud.test.ts` and record red behavior.
- [ ] Introspect `information_schema`/PostgreSQL catalogs using schema-qualified joins and ordered full constraint columns. Do not infer individual uniqueness from membership in a composite key. Query table/view kind and generated flags. Identify supported writable native types and preserve exact bigint/numeric strings.
- [ ] Implement validated, parameterized writes. The core SQL forms are:

```sql
INSERT INTO "public"."orders" ("name") VALUES ($1) RETURNING "id", "name";
INSERT INTO "public"."orders" DEFAULT VALUES RETURNING "id", "name";
UPDATE "public"."orders" SET "name" = $1 WHERE "id" = $2 RETURNING "id", "name";
DELETE FROM "public"."orders" WHERE "id" = $1 RETURNING "id";
```

Resource/column names come exclusively from validated metadata and quoting, not these example constants. On one checked-out connection, inspect/lock the resource for the transaction, validate the current key and writable fields, execute, verify at most one affected row, and commit. Roll back errors and always release. Read-only transactions remain read-only; writable pools must not set session-wide `default_transaction_read_only=on`.

- [ ] Map PostgreSQL unique/FK conflicts to 409, bad values to 422, privilege errors to a safe denial, and statement timeouts to 504. Keep details out of logs. Preserve JSON objects/arrays in the neutral protocol while the legacy adapter retains old representations.
- [ ] Verify single-key stable pagination, declared-field projection, literal LIKE escaping, large numbers, and transaction rollback. Run all bridge tests; commit `feat: complete PostgreSQL source CRUD`.

## Task 5: Add MySQL and SQL Server adapters

**Files:** Create `apps/db-bridge/src/mysql-driver.ts`, `src/mssql-driver.ts`, `test/mysql-driver.test.ts`, `test/mssql-driver.test.ts`; modify bridge `package.json`, `src/index.ts`, and root `pnpm-lock.yaml`.

**Interfaces:** Export `createMysqlDriver(): DatabaseDriver` and `createMssqlDriver(): DatabaseDriver` using Tasks 2–4 contracts and pool/error/value helpers.

- [ ] Add dependencies only to `@savia/db-bridge` (`mysql2`, `mssql`, and `@types/mssql` if required), resolve current supported versions from primary package documentation at execution time, then run `pnpm install`. Confirm the selected versions support the repository's Node runtime.
- [ ] Add independent parameterization tests; a customer value such as `x'; DELETE FROM orders; --` must appear only in bound parameters. Test null equality, literal search wildcard characters, composite keys, generated columns, view writes, decimal/bigint preservation, and zero affected rows. Run each new suite to establish red evidence.
- [ ] MySQL: use `mysql2/promise`, `supportBigNumbers: true`, `bigNumberStrings: true`, and no multi-statement option. Discover `information_schema` tables, columns, and complete unique indexes scoped to the selected database. Use backtick quoting, `?` placeholders, explicit `IS NULL`, and `LIMIT ? OFFSET ?`. Use a transaction for insert/update and readback; generated ids must retain precision. Empty creates use MySQL's supported default-values form. For unchanged updates, distinguish a matched row from a missing row; do not interpret changed-row count as existence.
- [ ] SQL Server: use `mssql`, encrypt/certificate settings from the contract, bracket quoting, and typed request parameters (`@p0`, `@p1`). Discover schema-scoped objects, identity/computed fields, and full key indexes from system catalogs. Use `OFFSET ... FETCH NEXT` with deterministic order and `OUTPUT INSERTED`/`OUTPUT DELETED` for mutations. Account for tables with triggers by using a supported OUTPUT/readback strategy on the same transaction. Preserve bigint and decimal strings through driver configuration or explicit textual projection, never unsafe numeric coercion.

The corresponding parameterized mutation shapes are:

```sql
-- MySQL, followed by projected SELECT on the same transaction/connection
UPDATE `orders` SET `name` = ? WHERE `id` = ?;
-- SQL Server, use an OUTPUT destination when triggers require it
UPDATE [dbo].[orders] SET [name] = @p0
  OUTPUT INSERTED.[id], INSERTED.[name] WHERE [id] = @p1;
```

- [ ] Register both factories in `index.ts`. Classify engine-native conflicts, permissions, invalid values, and timeouts into the safe shared error contract. Test transaction cleanup on native rejection and returned row projection.
- [ ] Run new adapter suites, bridge suite, and bridge typecheck/build. Commit `feat: add MySQL and SQL Server source adapters`.

## Task 6: Add MongoDB discovery and atomic document CRUD

**Files:** Create `apps/db-bridge/src/mongodb-driver.ts`, `test/mongodb-driver.test.ts`; modify bridge `package.json`, `src/index.ts`, and `pnpm-lock.yaml`.

**Interface:** Export `createMongoDriver(): DatabaseDriver`. Export `decodeMongoId(id: string, type: "string" | "objectId"): string | ObjectId` only from the native driver module.

- [ ] Add the official MongoDB driver to the bridge, checking its Node support. Add the identifier regression:

```ts
it("does not guess a hexadecimal string identifier", () => {
  const id = "507f1f77bcf86cd799439011";
  expect(decodeMongoId(id, "string")).toBe(id);
  expect(decodeMongoId(id, "objectId").toString()).toBe(id);
  expect(typeof decodeMongoId(id, "objectId")).toBe("object");
});
```

- [ ] Run the new suite for red evidence. Implement id conversion using only stored metadata. Reject invalid ObjectId syntax before dispatch; inspect `_id` type when establishing a binding. Mixed/unsupported sampled id types disable record mutations. Empty collections permit explicit string/ObjectId selection; autogenerated IDs default to ObjectId.
- [ ] List real collections and views; views stay read-only. Sample at most 100 documents with a bounded projection/depth. Union top-level fields, preserve absent versus null on writes, mark inference as sampled, and expose mixed/nested values as JSON. Explicit user fields support empty collections. Refresh metadata without replacing display labels.
- [ ] Build literal driver filters without accepting user operators. Use escaped regular expressions for search, declared projections, `_id` as ordering tie-breaker, limit-plus-one pagination, and native insertOne/findOneAndUpdate/findOneAndDelete. Convert Decimal128/Long/ObjectId/Date values explicitly; preserve JSON arrays and objects. Reject nested operator/path keys in user-supplied write values.

```ts
const result = await collection.findOneAndUpdate(
  { _id: decodeMongoId(input.id, input.idType) },
  { $set: validatedValues },
  { returnDocument: "after", includeResultMetadata: false, projection },
);
```

Here `collection` is selected from the configured database and validated resource, `input` is the validated update variant, `validatedValues` is the approved field map, and `projection` derives exclusively from `input.columns`. Implement these locals inside `mutate`; do not pass raw request bodies into the native call.

- [ ] Test string/ObjectId collisions, empty collections, mixed fields, nested JSON, duplicate-key conflicts, unknown fields, operator injection, no-match writes, and cleanup. Register the driver, run bridge tests/typecheck, and commit `feat: add MongoDB source adapter`.

## Task 7: Integrate source lifecycle, policy, sync, and record dispatch

**Files:** Modify `apps/api/src/crm/collection-sources.ts`, `collection-operations.ts`, `collection-gateway.ts`, `sql-bridge.ts`, `dynamic-openapi.ts`; create `database-source-service.ts`. Modify shared `metadata.ts`; create `packages/db/migrations/0055_collection_database_sources.sql` after checking that 0055 remains unused. Add `apps/api/test/database-sources.test.ts`, `database-source-migration.test.ts`; preserve and extend `postgres-sources.test.ts`.

**Interfaces:** `database-source-service.ts` owns source config decoding, encrypted credential hydration, field projection, metadata reconciliation, and dispatch through `DatabaseBridgeClient`. Keep `createCollectionSourceApp` positional arguments compatible; add an optional final database client parameter while legacy tests migrate. Existing record routes and response envelopes remain stable. New routes are `POST /api/sources/:id/test` and `POST /api/collection-bindings/:name/sync`. Sync accepts `{version: number}` and uses the existing optimistic-concurrency guard.

- [ ] Build independent fixtures using the existing migration loader, `createCollectionSourceApp`, D1 bindings, and a recording `DatabaseBridgeClient`. Cover every engine; keep fixture sources/tenants unique so tests do not depend on execution order. A complete source payload example is:

```ts
const source = {
  id: "mysql_erp",
  label: "MySQL ERP",
  kind: "mysql",
  host: "mysql.internal",
  database: "erp",
  username: "writer",
  password: "fixture-secret",
  ssl: true,
  writeEnabled: true,
};
```

Use `app.request("http://localhost/api/sources", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(source)})` and assert 201 plus absence of the password in the response. Read the stored row to verify ciphertext differs from plaintext.

- [ ] Add tests before implementation: existing PostgreSQL without policy rejects writes; enabling policy plus permitted binding allows CRUD; disabling it after binding blocks an already prepared request before bridge dispatch. Another owner or tenant cannot test, inspect, read, mutate, or synchronize the source. Unknown/generated fields and identifier changes fail before native dispatch. Test malformed body, duplicate conflicts, missing rows, and unknown timeout outcomes.
- [ ] Run targeted API tests for red evidence. Add a source-table rebuild migration following 0050 with the expanded CHECK constraint. Preserve all columns/rows and apply only a new migration; test old PostgreSQL and JSON:API ciphertext, ownership, and timestamps survive. Avoid automatic write upgrades.
- [ ] Extract database-only branches into the service without changing JSON:API/domain behavior. Recompute effective capabilities against current source policy on every request and in object metadata responses. Apply existing authorization before decrypting credentials. Keep field definitions and bound source identity server-controlled. Binding records store id column/type, metadata fingerprint, per-field native metadata, and compatibility status.
- [ ] Sync compares old/new field metadata, preserves display settings for unchanged fields, flags missing/incompatible fields, and persists changes with version guards and audit. Read projection uses valid declared fields; unsafe writes remain blocked until the administrator reconciles the selection. Newly generated fields cannot accept stale writes even before sync because the bridge revalidates metadata.
- [ ] Database operation maps are adapter-owned. Reject JSON:API operation overrides and inference for database bindings. Dispatch all database CRUD through the neutral client and return the existing list/detail/delete envelope and 201 for create. Ensure `_id`/alternate keys map to the UI's canonical record id without losing native identity.
- [ ] After a successful external mutation, invoke existing audit/version invalidation paths. If bookkeeping fails after external commit, report a committed outcome with refresh guidance and safe logging; never automatically retry the external operation or claim rollback. Test this by having the bridge succeed and the bookkeeping write fail.
- [ ] Update generated OpenAPI construction from shared schemas for the new source kinds, policy, test/sync operations, and safe errors. Run PostgreSQL, database, collection-operation, relation, gateway, and schema suites, then API/shared typechecks. Commit `feat: integrate external database source CRUD and metadata sync`.

## Task 8: Expose four sources in the admin UI

**Files:** Modify `apps/admin/src/features/crm-engine/collection-sources-panel.tsx`, `collection-capabilities.ts`, `collection-operations-panel.tsx`; create `database-source-fields.tsx`; extend `test/collection-sources-panel.test.tsx`, `test/collection-operations-panel.test.tsx`, `test/collection-record-form.test.tsx`.

**Interface:** `DatabaseSourceFields` receives engine kind, connection draft, `onChange`, and validation errors. Export a typed draft based on shared source input rather than duplicating connection unions. Keep drafts ephemeral; saving/testing uses backend APIs and never localStorage/IndexedDB.

- [ ] Add rendered UI tests in the existing `mount`/`mockTransport` harness: engine choices PostgreSQL/MySQL/SQL Server/MongoDB; defaults 5432/3306/1433/27017; SQL Server encrypt/certificate fields; Mongo auth source; source policy; test success/failure; metadata sync conflict; no password redisplay.
- [ ] Add a capability test for stale policy revocation: initially render a writable bound object, refresh with writes disabled, and assert create/edit/delete controls disappear while reading remains available. Test that generated columns are excluded from write payloads and unchanged nullable fields are not overwritten.
- [ ] Run targeted admin suites for red evidence. Extract the connection fields from the existing large panel, populate choices from the shared registry, and wire test/sync actions with pending and error states. Keep the source manager's established layout and accessible labels. Display specific read-only reasons from capabilities/metadata.
- [ ] Adapt resource binding to SQL tables/views and Mongo collections, including explicit field configuration for empty Mongo collections and supported id-type selection. Preserve field display edits on sync. Hide the JSON:API operation editor for adapter-owned database operations.
- [ ] Run targeted suites, admin typecheck, and browser verification of configuration, binding, and CRUD using test sources. Commit `feat: expose database sources and CRUD policies in admin`.

## Task 9: Live fixtures, documentation, and final verification

**Files:** Create `apps/db-bridge/test/database-live.test.ts`, `apps/db-bridge/vitest.live.config.ts`, `scripts/verify-database-sources.sh`, `docs/external-database-sources.md`; modify `apps/db-bridge/package.json`, `apps/db-bridge/README.md`, `docs/README.md`. Preserve or wrap `scripts/verify-postgres-source.sh` for compatibility.

**Interface:** Add `test:live` isolated from default unit tests. Read explicitly provided test-only connection configuration from environment; never print credentials. The runner exits nonzero if an explicitly selected engine cannot connect. Record missing engine prerequisites as not executed, not passed.

- [ ] Add a live CRUD test per engine using a unique test resource and fixture owner. Fixture setup may create schema objects only in the disposable test database; adapter operations never perform DDL. Create a row/document, list/filter/read it, update it, delete it, confirm 404, and verify cleanup. Include strings, booleans, null, JSON, dates, exact bigint/decimal, generated ids, unique conflicts, and read-only account denial.
- [ ] Use `try/finally` to clean up only resources created by the current test. For SQL Server verify trigger-bearing table writes; for MySQL verify unchanged updates; for Mongo test string/ObjectId distinction. Confirm schema drift disables stale writes. Do not run these against a configured business source.
- [ ] Write the English user guide covering setup, bridge env vars and allowlists, TLS, source policy, account grants, testing, binding, sync, read-only explanations, CRUD, timeout uncertainty, and limitations. Include concrete commands for the existing bridge lifecycle. Update the index and bridge README. Document the protocol rollout order: deploy new bridge before API consumes new endpoints.
- [ ] Run the validation commands:

```sh
pnpm --filter @savia/crm-shared test
pnpm --filter @savia/db-bridge test
pnpm --filter @savia/db-bridge build
pnpm run test:unit:api
pnpm run test:unit:admin
pnpm run test:contracts
pnpm run typecheck
pnpm --filter @savia/db-bridge run test:live
git diff --check
```

Run `test:live` with explicit disposable-engine configuration. Record each engine's result separately. Inspect formatting only for changed files and identify pre-existing repo lint failures rather than changing unrelated files.

- [ ] Review the complete diff against all design acceptance criteria, especially tenant boundaries, policy revocation, exact numeric values, and mutation outcomes. Commit `test: verify and document external database adapters`. Report implementation changes, actual tests run, and any remaining environment limitations; do not claim live verification for skipped engines.

## Coverage and execution handoff

Tasks 1–2 cover contract correctness and backward compatibility; 3 covers protocol security and pools; 4–6 cover all native engines; 7 covers migrations, permissions, synchronization, audit, and generated API docs; 8 covers the existing user workflow; 9 covers live evidence and operational documentation. Every review-focus item is assigned an explicit regression scenario above.

Recommended execution: native implementation in this task, because shared contract, backend integration, and UI must evolve together. Subagent-driven execution is an alternative with a fresh implementer/reviewer per task and greater context cost. Written plan review and execution-method selection precede product changes under the active skill workflow.
