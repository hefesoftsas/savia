# Multi-CRM Workspace Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Tasks assigned to workers have disjoint ownership.

**Goal:** Connect Salesforce, Zoho CRM, and Pipedrive and expose contacts, companies, and deals in Savia.

**Architecture:** Provider adapters translate native metadata and operations. A shared workspace router validates tenant/account bindings and installs screens. Existing HubSpot routes remain compatible.

**Tech Stack:** TypeScript, Hono, Nango, React, D1/Postgres, Vitest.

**Spec:** ../specs/2026-10-03-multi-crm-workspace-design.md

## Global Constraints

- Records remain in the CRM; credentials remain in Nango.
- Preserve HubSpot collection names, unqualified routes, and personal/tenant sharing semantics.
- Unknown capabilities remain disabled; unsupported operations fail explicitly.
- Code, tests, and documentation are in English.
- Report local tests and live account verification separately.

## Review Focus

- Cross-provider or changed-account bindings must never redirect records.
- Missing HubSpot configuration must not disable another configured provider.
- Required native fields and enum values must survive schema translation.
- Provider deletion must not be labeled as reversible archival.
- Pagination and provider errors must not appear as complete empty results.

### Task 1: Provider connections and native adapters

Files: `apps/api/src/external-crm/{nango,providers,runtime,contracts}.ts`, new `workspace-adapter.ts`, provider adapter modules, `apps/api/test/crm-multi-provider.test.ts`.

Interface: `createRemoteWorkspaceAdapter(provider, nango)` returns a typed adapter with resource metadata, describe/list/get/create/update, relationship reads and supported edits. Native metadata controls fields and capabilities. `createRemoteCrmAdapter(provider,nango)` implements existing connection validation contract. Both use the existing Nango proxy boundary.

- [x] Add failing tests for independent configuration, native field mappings, provider identity, rejected proxy paths, required fields, and pagination.
- [x] Implement provider-specific Nango session selection and restricted paths; preserve existing personal integration behavior.
- [x] Implement adapters for Salesforce Contact/Account/Opportunity, Zoho Contacts/Accounts/Deals, and Pipedrive Persons/Organizations/Deals.
- [x] Run `pnpm --filter @savia/api test test/crm-multi-provider.test.ts test/crm-nango.test.ts test/crm-hubspot.test.ts test/personal-nango.test.ts` and API type checking.

### Task 2: Connected workspace and authorization

Files: new `apps/api/src/external-crm/remote-workspace.ts`, gateway/routes/auth access queries, dynamic OpenAPI, `apps/api/test/multi-crm-workspace.test.ts`.

Consumes Task 1 adapters. Produces `/api/crm-workspace/:provider` discovery and `/install`, and generic collection record/relationship routes resolved from server bindings.

- [x] Add failing workspace tests for installation, reads/writes, account replacement, tenant isolation, read-only users, and unsupported operations.
- [x] Implement common binding validation, idempotent metadata installation, provider dispatch, bounded pagination, and safe audit records.
- [x] Extend registered-provider shared access and preserve HubSpot aliases and schemas.
- [x] Add provider-qualified dynamic API descriptions and verify MCP's existing generic collection surface.
- [x] Run workspace, authorization, dynamic API, and MCP tests and relevant type checks.

### Task 3: Provider-aware screens

Files: admin Studio workspace panel, origin links, records, record detail, relationship copy, source labels, corresponding tests.

Consumes provider-qualified discovery/install routes with the existing discovery response shape (`provider`, `connected`, `accountLabel`, `objects`). Uses sourceId for provider labels and cache isolation.

- [x] Add failing tests for Salesforce/Zoho/Pipedrive installation paths, independent cache keys, origin URL validation, and deletion wording.
- [x] Extend existing UI conventions for provider selection and capabilities; retain legacy HubSpot behavior.
- [x] Run affected admin tests and admin type checking.

### Task 4: Documentation and integrated verification

Files: connected workspace runbook and environment configuration guide; spec/plan progress.

- [x] Document per-provider Nango integration variables, native resources, supported operations, and activation steps.
- [x] Run the combined relevant tests, type checks, and changed-file formatting checks.
- [x] Independently review authorization, native mappings, pagination, errors, and UI behavior; fix material findings with regression coverage.
- [x] Report implemented behavior, passing checks, and unverified live OAuth/account operations.

## Execution notes

The user approved the design and explicitly instructed implementation. Execute in the existing task checkout, with at most two workers and integration/review by the coordinator. No additional workflow approval is needed.

## Final local verification (2026-10-03)

- API: 11 focused suites, 107 passing tests, including existing HubSpot/Nango
  behavior and the new adapters, bindings, native schemas, edge cases, and routes.
- Admin: 7 focused suites, 63 passing tests for provider screens, cache updates,
  origin links, relationships, and legacy compatibility.
- MCP: 3 focused suites, 16 passing tests for generic collection access and
  delegated credentials.
- Self-hosted: application suite passed (1 test); 1 PostgreSQL-dependent test
  was skipped because no PostgreSQL test environment was available.
- `tsc --noEmit` passed in API, admin, MCP, and self-hosted packages.
- Changed TypeScript/TSX/Markdown files passed Prettier; `git diff --check` passed.
- Independent review findings were addressed with regression tests, including
  account-bound discovery, private reinstallation, native paths/envelopes,
  exact email search, partial name updates, and Zoho limits.

No deployment, live OAuth flow, or production CRM read/write was performed.
The supplied Nango host was blocked by the environment's outbound proxy, and
no Nango API secret was configured. Real account activation remains pending.

## Organization exclusivity follow-up verification

The user explicitly selected one active CRM connection per organization. The
follow-up enforces the rule in the API, workspace lookups, UI, and SQLite/D1 and
PostgreSQL indexes. Independent review also identified and fixed shared Nango
credential references across organizations and stale UI responses after a tenant
switch. Account owner permissions are preserved.

Final focused verification: 92 API tests passed; 16 admin CRM tests passed;
3 self-hosted/application/migration-manifest tests passed. Eleven tests requiring
live PostgreSQL were skipped because that test database was unavailable. API,
admin, MCP, and self-hosted TypeScript checks passed, as did changed-file
formatting and diff checks. The new migration was exercised against D1, including
concurrent inserts and failure without deletion when existing duplicates are
present. Native PostgreSQL runtime execution and production deployment remain
unverified; the runbook contains migration preflight and activation instructions.
