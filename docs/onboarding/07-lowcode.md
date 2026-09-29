# 07 — How the lowcode works

## Core idea: metadata, not code or migrations

Everything configurable lives as **data in fixed D1 tables** (`studio_objects`,
`studio_records`, `studio_views`, `studio_schema_versions`, …). Creating a new
"entity" creates no SQL tables: records are JSON documents validated against a
versioned schema. Files go to R2.

## Hierarchy

**Tenant → Object → Records → Screens/Views**, each level versioned:

- **Tenant**: authorized workspace backed by `tenants.id`. Studio storage uses
  `tenant:<id>`; `tenant:0` is the reserved platform workspace. Custom data
  domains are migrated to tenants. See [tenant isolation](../guides/tenant-isolation.md).
- **Object**: entity with fields (types, labels), relations
  (`config.relation`, including mutual ones), sections, and layout. Some
  operational fields are protected: they cannot be deleted or retyped.
- **Records**: CRUD with validation, uniqueness, audit, optimistic versions,
  and `Idempotency-Key` on creation.
- **Screens**: lists, forms (designer with drag-and-drop, selectors backed by
  registered collections), presentation. **Manage screens** configures
  presentation; the **form designer** publishes fields.

## Three runtime pieces

1. **React UI** (`apps/admin/src/features/studio-engine/`): designer,
   `dynamic-form`, collection source/relation/operation panels,
   conversational wizard. User-visible name: **Studio** (route `#/studio`,
   `#/crm` kept as legacy alias).
2. **Server** (`packages/studio-server`, `createStudioApp`): mounted by the
   API (`apps/api/src/studio/`, external HubSpot integration isolated in
   `apps/api/src/external-crm/`).
3. **Shared metadata** (`packages/studio-shared`): zod schemas, validation,
   utilities — used by both admin and API.

> Fase 3 note: engine D1 tables are renamed to `studio_*`
> (`0068_rename_engine_crm_to_studio.sql`, `studio-server/0022_...`),
> agency workspaces moved to the canonical `/v1/studio/*` API prefix
> (legacy `/v1/dynamic-crm/*` alias kept), sidebar ids migrated
> `dynamic-crm` → `studio` (legacy accepted and normalized on read),
> MCP/assistant tools duplicated as `savia_*_studio_*` (legacy
> `savia_*_crm_*` aliases kept, `domain: "crm"` still accepted),
> and secrets dual-read `STUDIO_INTEGRATION_KEY` with
> `CRM_INTEGRATION_KEY` fallback. Intentionally keeping old names:
> `/v1/crm/*`, collection kind `"crm"` and `Crm*` sync types (all three
> mean the external HubSpot integration), error codes `CRM_*`, and the
> external sync tables (`crm_connections`, `crm_sync_*`,
> `crm_collection_bindings`).

## Everything configurable generates its own API

- `/v1/studio/:tenantId/api/*` (`/v1/dynamic-crm/*` alias kept): per-object
  CRUD, designer, **generated OpenAPI/Scalar with per-object endpoints**, and
  integrations (import an external OpenAPI schema, run operations, map results
  into the tenant with per-tenant isolated credentials).
- **Solutions**: that metadata exports/imports as versioned packages
  installable per space (`solutions/insurance/`, [solution-packages.md](../solution-packages.md)).
  Atomic install, collision detection, no data or customization destruction.

Next: [08-plugins.md](08-plugins.md).
