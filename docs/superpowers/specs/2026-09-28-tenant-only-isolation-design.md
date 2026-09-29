# Tenant-only data isolation

Status: approved by the user and implemented; validation is recorded in the implementation plan.

## Intent

Use tenants as the only data-isolation concept throughout Savia. Remove the
independent data-domain catalog, selector, creation flow, API surface, and access
scopes. Preserve existing data and tenant isolation. Business-domain modules and
DNS domain names are unrelated and remain unchanged.

## Current behavior

- `apps/api/src/routes/data-domains.ts` lists commercial tenants alongside custom
  data domains and a platform domain, and creates independent custom domains.
- Custom domains are stored in `studio_data_domains`; their Studio storage keys
  and ACL scopes use `domain:<slug>`.
- The platform workspace uses `domain:platform`, although tenant `0` already
  exists in `tenants` with kind `platform`.
- Tenant Studio routes currently reject tenant `0`, and existing Studio storage
  can use either `agency:<id>` or `tenant:<id>`.
- Identity enforces one principal tenant membership. Domain ACL assignments can
  currently grant access separately from that membership.
- Public forms, collection sources, preferences, assistant/MCP integrations,
  frontend navigation, and generated API types consume the existing conventions.

## Proposed design

### Identity and storage

`tenants.id` is the authoritative isolation identity. Studio data uses the
canonical key `tenant:<id>`, including `tenant:0` for platform data. Platform
administration privileges remain global privileges, separate from workspace data
ownership. Tenant zero stays reserved for platform administrators.

Convert each custom domain into its own tenant, preserving separation rather
than merging unrelated datasets. Record a deterministic old-key-to-tenant mapping
for migration and troubleshooting. Do not create a second runtime catalog or a
permanent domain resolution layer.

Normalize existing `agency:<id>` Studio keys as part of the same migration. Detect
collisions with existing `tenant:<id>` rows before mutation; do not silently
discard or overwrite records. Preserve numeric tenant identities already used
by business tables.

### Access control

Data access requires an active tenant and authorized membership or platform
administration. Move tenant-scoped role definitions, policies, assignments,
revisions, and audit references to canonical tenant scopes.

Before migration, report domain assignments whose principals belong to a
different tenant. Do not transfer their membership, grant additional tenant
membership, widen access, or silently discard grants. Such conflicts require an
explicit migration mapping or resolution before applying the affected migration.

### API and consumers

Use one authorized tenant workspace catalog and the existing tenant Studio
handler. Extend that handler to support the reserved platform tenant explicitly.
Remove data-domain creation and data-domain runtime routes from the application
and generated OpenAPI contract. Regenerate client types from the API source.

Replace domain selection and navigation parameters with tenant selection across
the admin, assistant, MCP, service credentials, public forms, preferences, and
collection integrations. Keep business-domain concepts unrelated to isolation.

### Migration safety

Add forward migrations for SQLite/D1 and PostgreSQL; preserve historical
migrations. Inventory every persisted Studio key and ACL scope, including JSON
configuration and stored links, before implementation. Include R2 object keys and
credential encryption context in that inventory: if either embeds an old key,
provide a supported migration rather than merely changing the SQL reference.

Run migrations against isolated local fixtures first. A preflight must identify
namespace collisions, invalid references, and membership conflicts before any
destructive step. Remove the independent catalog only after its data and
references have migrated successfully. Do not reset existing user data.

## Verification and acceptance

- No active runtime flow creates or selects a data domain.
- New workspaces and persisted Studio data are keyed by tenant.
- Existing custom-domain and platform fixtures retain records, relationships,
  files, configuration, and applicable permissions after migration.
- Cross-tenant access is rejected for reads, writes, public forms, and integration
  paths; inactive tenants are rejected and tenant zero remains reserved.
- Migration tests cover SQLite and PostgreSQL, collision handling, and membership
  conflicts without silent data loss or authorization expansion.
- Admin tests cover selection, tenant zero, navigation, and absence of domain
  creation. API, shared schema, Studio, and MCP tests cover affected contracts.
- Run the affected tests, repository typechecks, and contract tests. Document
  failures and checks not performed. Update the applicable user/developer guides.

## Baseline evidence

On 2026-09-28, the following local command passed 2 files and 11 tests:

```sh
pnpm --filter @savia/api exec vitest run test/tenant-agnostic-access.test.ts test/access-tenant-lifecycle.test.ts
```

This establishes the initial baseline only; it does not verify the proposed
refactor.
