# External database plugins design

Date: 2026-09-19
Status: Approved by the user on 2026-09-19; implementation plan awaiting review.

## Intent

Complete Savia's PostgreSQL integration and add SQL Server, MySQL, and MongoDB
as external data-source adapters. The user confirmed that all four must support
reading, creating, updating, and deleting records according to permissions.
Use NocoBase's data-source management model as a reference while preserving
Savia's Workers API, tenant boundaries, and existing collection UI.

Success means an administrator can configure a source, test it, discover its
resources, bind selected fields, synchronize metadata, and use the existing
collection screens for supported CRUD operations against the external database.

## Reference and architectural choice

NocoBase separates source management from individual source plugins, imports
external metadata, and leaves the actual external schema under its owner's
control. Follow these concepts, not its commercial implementation.

- https://docs.nocobase.com/data-sources/data-source-manager
- https://docs.nocobase.com/data-sources/external/mysql
- https://docs.nocobase.com/data-sources/external/mssql

The reviewed NocoBase source list does not establish a MongoDB implementation;
MongoDB will use the same management contract with document-specific metadata.

Extend the existing `apps/db-bridge` with a driver registry and one adapter per
engine. This reuses its authenticated HTTP boundary and avoids copying the API
and UI four times. Separate bridge services per engine would multiply deployment
and protocol maintenance. Direct Worker connections would discard the existing
boundary and require different runtime support for each driver.

Use `pg`, `mysql2`, `mssql`, and the official `mongodb` driver inside the Node
bridge. Keep native drivers out of the Worker and browser dependency graphs.
Adapters are internal source plugins; independently distributed installation
packages and a new plugin marketplace are outside this change.

## Existing code and defects to address

- `packages/crm-shared/src/sql-sources.ts` defines a PostgreSQL-only protocol.
- `apps/db-bridge/src/driver.ts` exposes discovery and read operations only.
- `apps/api/src/crm/collection-sources.ts` manages encrypted credentials,
  binding, and record dispatch with PostgreSQL-specific branches.
- `apps/admin/src/features/crm-engine/collection-sources-panel.tsx` exposes
  PostgreSQL as a read-only source.
- `packages/db/migrations/0050_collection_sql_sources.sql` restricts source kinds.
- `serializeValue` in `pg-driver.ts` applies `Number.isFinite` to strings and
  booleans, turning valid values into null. Correct this with regression tests.
- PostgreSQL introspection reports every member of a compound unique constraint
  as individually unique and always labels resources as tables. Discover complete
  constraints and resource kinds before deriving CRUD capabilities.

## Shared contract and compatibility

Use stable engine kinds `postgres`, `mysql`, `mssql`, and `mongodb`. A shared
registry describes labels, configuration fields, defaults, and driver selection.
Use engine-specific validated connection schemas rather than giving MongoDB a
PostgreSQL-shaped connection object. Normalize metadata to engine-neutral types;
preserve compatibility for persisted PostgreSQL configuration and bindings.

Provide explicit bridge operations for connection testing, resource listing,
field introspection, list, read, create, update, and delete. Mutations have their
own discriminated schemas and require a record identifier for update/delete.
Clients cannot submit SQL, Mongo operators, connection URLs for the bridge itself,
or arbitrary operation endpoints.

Keep current PostgreSQL sources and bindings read-only after migration. New
sources default to read-only and may enable writes in configuration. Changing
source write policy updates effective capabilities without bypassing collection
permissions. The user's approval authorizes implementing writes, not running
mutations against existing business data.

Extend the source-kind constraint with a new D1 migration; preserve identifiers,
tenant/owner scoping, timestamps, encrypted credentials, and all existing rows.
Do not edit an already applied migration.

## Configuration and credentials

SQL sources use host, port, database, username, password, and TLS settings.
PostgreSQL defaults to port 5432 and schema public; MySQL to 3306 and its database;
SQL Server to 1433 and schema dbo. SQL Server exposes encryption and certificate
trust as separate settings, with certificate verification enabled by default.
MongoDB uses host, port 27017, database, optional credentials, authentication
database, and TLS. Initial support is a directly configured server/replica-set
endpoint; SRV discovery and arbitrary connection strings are not advertised.

Persist credentials only through existing backend encryption. Responses, audit
events, UI state persisted to disk, and logs must not reveal secrets. Preserve
bridge authentication, host allowlists, body limits, and bounded timeouts.
Bound connection pools and close them on eviction and shutdown.

## Discovery, binding, and metadata synchronization

Discover accessible SQL tables/views and MongoDB collections. Expose field type,
nullability, defaults, generated/computed status, and complete key information.
MongoDB introspection samples at most 100 documents and labels inferred metadata
as sampled. Empty collections allow explicit field configuration. Mixed types
remain JSON values rather than being coerced into an arbitrary scalar type.

Bind selected fields with their original names and stable source identity.
Synchronizing metadata preserves labels and display configuration for unchanged
fields, flags removed or incompatible fields, and disables unsafe writes until
the binding is reconciled. Synchronization never issues external DDL.

Views remain read-only. SQL record operations require a single-column primary key
or a verified non-null single-column unique key. Compound-key-only resources
remain list-only unless another qualifying key is selected; never mutate by one
member of a compound key. MongoDB uses `_id`, supporting ObjectId and string IDs
with explicit type metadata so hexadecimal strings are not guessed as ObjectIds.
Unsupported MongoDB identifier types keep record mutations disabled.

## Reads and writes

Retain bounded pagination (maximum 100 rows), declared-field projection, equality
filters, text search, and deterministic ordering with an identifier tie-breaker.
Unsupported filters return validation errors rather than being ignored. MongoDB
search escapes user text as literal text and rejects operator injection.

The Worker checks tenant/owner access, existing collection authorization, source
write policy, binding capabilities, and declared writable fields before dispatch.
The bridge independently validates the request and current resource metadata.
Database account permissions remain the final authority and errors are surfaced
without leaking server details or credentials.

Create omits absent values so database defaults work. Generated/computed fields
are not writable; supplied keys are accepted only when not generated. Update
modifies supplied fields only and cannot change the record identifier. Delete
targets exactly one identifier. Missing records return 404; constraint conflicts
return 409; invalid fields/types return 422; unavailable sources return 502/503
and timeouts return 504. SQL operations use parameters for values and validated,
quoted identifiers. MongoDB uses structured driver operations with approved keys.

SQL mutations use one connection and a transaction when mutation plus result
readback requires it. MongoDB single-document mutations use native atomic
operations without requiring multi-document transactions. Do not retry writes
automatically after a timeout; the outcome may be uncertain. Return that condition
clearly so the user can refresh before repeating the action.

Preserve strings, booleans, nulls, dates, JSON, and exact large numbers across the
bridge. Use explicit field-aware JSON/BSON conversion; never round a bigint or
decimal through a JavaScript number. Reject unsupported writable binary/special
types with a clear field error while retaining readable representations.

External writes and local audit storage cannot share an atomic transaction.
Record successful outcomes through existing audit/invalidation hooks; never
describe a committed external mutation as rolled back if local bookkeeping fails.
Do not introduce a local row mirror or imply realtime detection of writes made
outside Savia. Refresh reads authoritative external state.

## UI and API integration

Extend the existing source manager with four engines, engine-specific connection
forms, test-connection feedback, resource selection, metadata synchronization,
and a read/write policy. Existing collection forms and action visibility consume
effective capabilities and writable field metadata. Show why a resource is
read-only, including views and unusable identifiers.

Keep database operation definitions fixed by the adapter. The JSON:API operation
editor cannot override them or redirect database operations. Generate OpenAPI
from source schemas and route definitions; do not hand-write API reference docs.
Add an English guide under `docs/` and update the docs index and bridge README.

## Verification and acceptance

1. Regression tests preserve PostgreSQL strings/booleans and correctly identify
   views, composite constraints, generated columns, and large numeric values.
2. Shared contract tests cover all engine configurations and reject malformed
   operations, unknown write fields, immutable identifiers, and injection input.
3. Adapter tests cover discovery, filters, stable pagination, CRUD, no-match
   mutations, defaults, constraint errors, and resource cleanup.
4. API tests prove tenant/owner isolation, read-only compatibility, permission
   enforcement, field projection, capability changes, and bridge error mapping.
5. Migration tests preserve existing PostgreSQL and JSON:API source rows.
6. UI tests verify engine forms, connection errors, resource selection, write
   policy, and create/edit/delete behavior driven by capabilities.
7. Run real CRUD smoke tests on disposable databases/collections for all four
   engines when runtimes are available. Clean up only fixtures created by the
   test. Report unexecuted engine tests explicitly; mocks are not live evidence.
8. Run relevant package tests, repo typecheck, and required contract checks.
   Distinguish pre-existing failures from regressions and review changed files.

## Scope limits

This delivery does not manage external DDL, execute arbitrary SQL or aggregation
pipelines, support bulk mutations, edit compound identifiers, infer cross-source
relationships, implement distributed transactions, or add external change-data
capture. Those capabilities must not be advertised in the UI or metadata.
