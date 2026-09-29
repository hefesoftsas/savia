# Tenant-only Isolation Implementation Plan

> **For agentic workers:** Execute the assigned bounded work with regression tests; the coordinator integrates and reviews all changes.

**Goal:** Make tenants the sole runtime data-isolation boundary.
**Architecture:** Canonical `tenant:<id>` storage, tenant workspace catalog, reserved platform tenant zero, forward migrations preserving existing data.
**Tech Stack:** TypeScript, Hono, React, SQLite/D1, PostgreSQL, Vitest.
**Spec:** ../specs/2026-09-28-tenant-only-isolation-design.md

## Global constraints

Preserve existing user edits. Do not reset databases or silently discard data.
Keep historical SQL migrations unchanged. Keep global platform administration
separate from tenant data scopes. Do not rename business-domain or DNS concepts.

## Review focus

Tenant zero must not be rejected by truthiness checks. Custom domain grants must
not expand access across principal memberships. Storage namespace collisions must
fail before mutation. Encrypted credentials must retain authenticated context.
R2 references are opaque keys and must remain readable after ownership migration.

## Tasks

- [x] Shared contracts: regression tests reject domain scopes and permit tenant:0;
      update access scopes and widget paths. Run studio-shared tests.
- [x] Database: inventory text tenant keys, create forward SQLite and PostgreSQL
      migrations with collision/membership preflight; convert custom domains and
      platform data, ACLs and stored navigation references. Test populated fixtures,
      rollback, encrypted context, and tenant-zero migration locally.
- [x] API (worker): new GET /v1/tenant-workspaces catalog; canonical Studio
      handler including tenant zero; remove data-domain runtime routes and refactor
      public forms, request pages, preferences, assistant and source integration
      consumers. Tests pin cross-tenant denial and removed endpoints.
- [x] Admin (worker): tenant workspace types, selector, navigation and creation
      flow; update credentials, widgets, forms, assistant and role pages; regenerate
      OpenAPI client from completed API. Test tenant zero and workspace selection.
- [x] Integration (coordinator): MCP paths, Studio retention and encrypted
      credential reading; canonical fixtures and affected documentation. Run focused
      tests, typechecks, contract checks and review the combined diff.

## Execution decisions

The user approved the design and explicitly requested implementation. Work proceeds
in this existing checkout with disjoint API/admin worker ownership; coordinator
owns migrations, shared types, Studio server, MCP and integration. No branch,
commit, deployment or live-data mutation is required for reviewable local changes.

Encrypted values that embed old workspace keys will carry an explicit authenticated
context envelope after migration. Readers verify the expected canonical context
before decrypting with the retained original AAD; replacing a credential produces
canonical encryption. This preserves credentials without exposing a legacy
workspace resolver. Opaque R2 storage keys are retained and authorization is always
performed against the canonical tenant row.

## Integration findings

The separate self-hosted Request database requires its own forward migration and
must receive the core tenant map before conversion. Its standalone migration
rejects unmapped custom domains. Request inputs now reject legacy scopes instead
of silently selecting the shared catalog on an invalid query parameter.

Local native PostgreSQL testing exposed SQLite-only authentication notice
triggers; dialect-aware triggers and native transition coverage unblock the
actual authentication/CRUD/restart/import checks. The PostgreSQL namespace
migration preserves original foreign-key timing and user-trigger states.

## Local verification

Validation ran by lane and with focused reruns after corrections:

- API: 82 files, 559 tests passed.
- Admin: 224 files, 1,213 tests passed; regenerated OpenAPI types and typecheck passed.
- Other workspace packages excluding self-hosted: 906 passed, 10 optional tests skipped.
- Savia Request after the separate-store migration: 49 passed; typecheck passed.
- Contracts: 80 passed, including populated SQLite migration and D1 runner checks.
- Native PostgreSQL: real local PostgreSQL 17 exercised authentication, CRUD,
  restart, source import, migration idempotency, preserved FK timing, and
  collision rollback. Final migration/import regression group: 21 passed;
  final Request source checksum and import rerun: 2 passed.
- Plugin deployment tenant discovery: 32 passed, 1 optional test skipped.
- Repository typecheck passed; changed-file formatting and diff whitespace were checked.

The root aggregate command was not repeated after all corrections; its lanes and
affected regressions were validated separately. Full lint remains blocked by
pre-existing formatting issues and its unsupported `scripts/dev-local.sh` parser.
No remote deployment or production database migration was performed. Optional
external integration tests were not enabled; local native tests used a disposable
PostgreSQL container and isolated databases.
