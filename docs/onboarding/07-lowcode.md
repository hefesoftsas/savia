# 07 — How the lowcode works

## Core idea: metadata, not code or migrations

Everything configurable lives as **data in fixed D1 tables** (`crm_objects`,
`crm_records`, `crm_views`, `crm_schema_versions`, …). Creating a new
"entity" creates no SQL tables: records are JSON documents validated against a
versioned schema. Files go to R2.

## Hierarchy

**Domain → Object → Records → Screens/Views**, each level versioned:

- **Domain**: independent space (e.g. Platform, or a custom one like
  inventory). Internal scopes `domain:platform` / `domain:<id>`; clients never
  pick an arbitrary tenant.
- **Object**: entity with fields (types, labels), relations
  (`config.relation`, including mutual ones), sections, and layout. Some
  operational fields are protected: they cannot be deleted or retyped.
- **Records**: CRUD with validation, uniqueness, audit, optimistic versions,
  and `Idempotency-Key` on creation.
- **Screens**: lists, forms (designer with drag-and-drop, selectors backed by
  registered collections), presentation. **Manage screens** configures
  presentation; the **form designer** publishes fields.

## Three runtime pieces

1. **React UI** (`apps/admin/src/features/crm-engine/`): designer,
   `dynamic-form`, collection source/relation/operation panels,
   conversational wizard. User-visible name: **Studio** (route `#/studio`,
   `#/crm` kept as legacy alias).
2. **Server** (`packages/crm-server`, `createCrmApp`): mounted by the API.
3. **Shared metadata** (`packages/crm-shared`): zod schemas, validation,
   utilities — used by both admin and API.

> Fase 1 note: only the UI names and the `#/studio` route were renamed.
> Code, package names (`crm-engine`, `crm-server`, `crm-shared`), D1 tables
> (`crm_*`) and `/v1/crm/*` (external HubSpot integration — correctly named)
> keep their names until Fase 2.

## Everything configurable generates its own API

- `/v1/data-domains/:id/api/*` and `/v1/dynamic-crm/:agencyId/api/*`: per-object
  CRUD, designer, **generated OpenAPI/Scalar with per-object endpoints**, and
  integrations (import an external OpenAPI schema, run operations, map results
  into the domain with per-domain isolated credentials).
- **Solutions**: that metadata exports/imports as versioned packages
  installable per space (`solutions/insurance/`, [solution-packages.md](../solution-packages.md)).
  Atomic install, collision detection, no data or customization destruction.

Next: [08-plugins.md](08-plugins.md).
