# Configurable Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution method awaits user selection; no agents have been delegated.

**Goal:** Let platform and agency administrators configure and assign scoped roles with server-enforced page, action, row and field permissions.

**Architecture:** Persist policies in D1 and resolve a trusted authorization context per request. Share pure contracts and evaluation across API and CRM services; use the server's effective-permission projection in the admin. Preserve single-tenant membership, existing access and the bounded offline lease.

**Tech Stack:** TypeScript, Zod, Hono/OpenAPIHono, Drizzle, Cloudflare D1/R2, React/ra-core, Vitest, existing Dexie synchronization.

**Spec:** `docs/superpowers/specs/2026-09-19-configurable-access-control-design.md` (approved by user).

## Global Constraints

- Agency administration must remain limited to the agency's own space.
- Multiple roles must not introduce multiple tenant memberships.
- Client-supplied principal IDs, tenant keys or permission snapshots never authorize operations.
- Custom roles default to no grants.
- Keep row predicates and field grants together.
- Unauthorized write fields cause a validation/authorization error rather than silent dropping.
- Role/assignment editing requires connectivity.
- Regenerate OpenAPI/Scalar contracts from route schemas.
- This release does not claim immediate offline revocation.
- Code, tests and new documentation are in English; conventional English commits.
- Preserve other work in this dirty worktree, including public forms, generated API types and offline-shell changes. Stage explicit paths/hunks only. No production deployment is part of execution.

## Review Focus

1. A matching grant in one role must not expose fields from a different nonmatching role (Task 2).
2. Updating a row can remove its visibility without a role edit; replication must remove it and redact stale fields (Tasks 7–8).
3. Assignment racing a tenant transfer must not create an effective cross-tenant grant; revision checks and active membership checks remain authoritative (Task 3).
4. Retrying an acknowledged mutation after revocation must not leak its previous response or re-execute side effects (Task 7).
5. Export/search/relationship/assistant paths must not reveal protected fields or counts that normal reads hide (Tasks 5–6, 10).

## Execution rules and dependency order

Use the existing linked worktree after checking current instructions and status. Read the worktree, TDD and verification skills when execution starts; read impeccable before UI implementation. Read the approved spec with this plan. Do not treat this plan as approval to broaden scope or deploy.

Tasks 1–4 establish contracts, compatibility and administration. Tasks 5–8 enforce every data path and revocation. Tasks 9–10 expose the editor and perform release checks. Do not enable role editing against a partly protected backend. Each task follows a failing behavioral test, minimum implementation, passing focused tests and an explicit-path conventional commit. Characterization tests in Task 1 should pass against existing behavior; they are not expected to fail.

Migration filenames must be allocated from the directory at execution time. The existing highest migration may change during concurrent work. Use descriptive suffixes `access_control.sql` in `packages/db/migrations/` and `access_control_sync.sql` in `packages/crm-server/migrations/`; mirror CRM storage changes in the API DB migration when required by the existing deployment layout.

## Shared interface map

Create `packages/crm-shared/src/access-control.ts` for serializable contracts and strict schemas; create `packages/crm-shared/src/access-evaluator.ts` for pure record decisions. Server SQL compilation belongs in `packages/crm-server/src/access-query.ts`, never in the browser contract.

```ts
export type AccessScope = 'platform' | `tenant:${number}` | `domain:${string}`;
export type AccessAction = 'read' | 'create' | 'update' | 'delete' | 'restore'
  | 'import' | 'export' | 'execute' | 'configure' | 'manage';
export type AccessResource = `collection:${string}` | `page:${string}`
  | `capability:${string}`;
export type Scalar = string | number | boolean | null;
export type Operand = { literal: Scalar } | { variable: 'principalId' | 'tenantId' };
export type AccessPredicate = { all: true }
  | { and: AccessPredicate[] } | { or: AccessPredicate[] }
  | { field: string; op: 'eq' | 'lt' | 'lte' | 'gt' | 'gte'; value: Operand }
  | { field: string; op: 'in'; values: Operand[] };
export type AccessGrant = {
  id: string; roleId: string; resource: AccessResource; action: AccessAction;
  predicate: AccessPredicate; fields: string[];
};
export type AccessPolicy = {
  principalId: string; scope: AccessScope; revision: number;
  grants: AccessGrant[];
};
export type AccessRecord = {
  id: string; createdBy: string | null; values: Record<string, unknown>;
};
export type AccessDecision = {
  allowed: boolean; fields: string[]; grantIds: string[];
};
export function decideRecord(policy: AccessPolicy, resource: AccessResource,
  action: AccessAction, record: AccessRecord): AccessDecision;
export function projectRecord(record: AccessRecord, decision: AccessDecision): AccessRecord;
export function decideWrite(policy: AccessPolicy, resource: AccessResource,
  action: 'create' | 'update', before: AccessRecord | null,
  after: AccessRecord, changedFields: string[]): AccessDecision;
```

No implicit wildcard fields in custom policies: resolve field IDs against the collection schema. Protected compatibility permissions are compiled from current metadata on the server. Enforce at most 16 predicate depth, 200 nodes, 100 membership operands, and 500 explicit fields; reject excess with 422. Empty AND/OR groups are invalid. Registry validation limits operations by field type; null supports equality only. Use `$createdBy` for the trusted record creator. String ordering must have the same documented binary semantics in SQL and the evaluator. Avoid locale-dependent comparisons. Reserved tenant/creator metadata cannot appear in writable fields.

## Task 1: Characterize existing access and inventory entry points

**Files:** create `apps/api/test/access-control-parity.test.ts`, `apps/api/test/access-control-fixtures.ts`, `docs/access-control-entry-points.md`; reuse `apps/api/test/auth-fixtures.ts`, `apps/api/test/combined-app.ts`, `apps/api/test/test-app.ts` and existing real-D1 migration setup from `identity.test.ts`.

**Interfaces:** consumes current authenticators and `createApp`; produces `createAccessFixture(): Promise<AccessFixture>`. Define `AccessFixture.request(role: 'platform_admin'|'tenant_admin'|'agency_admin'|'operator'|'viewer', tenantId: number, path: string, init?: RequestInit): Promise<Response>`, `principalId(role): string`, `db: D1Database`, `dispose(): Promise<void>`. Seed two tenants (101 and 102), one independent domain, a native collection `acl_contacts`, shared and private provider collections, and a client with a file. Use real migrations and existing adapter fakes; do not mock authorization decisions.

- [ ] Read the API/CRM registrations and list each route family, aliases, actor source, owner service, existing guard and required action in the entry-point document. Include API operational commands/documents, request pages/results, assistant/MCP, relations, files, imports/exports, bulk, integrations, queues, published routes, bootstrap, metadata and sync. Trace registrations outside `apps/api/src/app.ts` through `combined-app.ts` and runtime entrypoints.
- [ ] Write concrete parity cases using the fixture, including this existing cross-tenant invariant:

```ts
const f = await createAccessFixture();
const response = await f.request('viewer', 101,
  '/v1/dynamic-crm/102/api/records/acl_contacts');
expect(response.status).toBe(403);
await f.dispose();
```

- [ ] Capture current allow/deny expectations for all five roles in table-driven tests, including operator customer writes, shared CRM read-only access and independent-domain denial. Check response data as well as status. Record inconsistent legacy behavior explicitly; never silently broaden it during migration.
- [ ] Run `pnpm --filter @savia/api test test/access-policy.test.ts test/access-control-parity.test.ts`; expected PASS. Correct fixture errors without changing product behavior.
- [ ] Commit these files as `test: characterize existing access boundaries`.

## Task 2: Implement strict contracts and pure grant evaluation

**Files:** create shared `access-control.ts`, `access-evaluator.ts`, `access-control.test.ts`, `access-evaluator.test.ts` under `packages/crm-shared/src/`.

**Interfaces:** implement the shared map above and export `accessPolicySchema`, `accessPredicateSchema`; evaluator throws no HTTP errors and returns a denied decision for no applicable grants. Registry/type validation rejects malformed policies before evaluation.

- [ ] Add a cross-product regression with complete policy input:

```ts
const policy: AccessPolicy = { principalId: 'u1', scope: 'tenant:101', revision: 1,
  grants: [
    { id: 'g1', roleId: 'r1', resource: 'collection:clients', action: 'read',
      predicate: { field: '$createdBy', op: 'eq', value: { variable: 'principalId' } },
      fields: ['name', 'commission'] },
    { id: 'g2', roleId: 'r2', resource: 'collection:clients', action: 'read',
      predicate: { all: true }, fields: ['name'] }
  ] };
const row: AccessRecord = { id: 'c1', createdBy: 'u2', values: { name: 'Ada', commission: 12 } };
expect(decideRecord(policy, 'collection:clients', 'read', row).fields).toEqual(['name']);
expect(projectRecord(row, decideRecord(policy, 'collection:clients', 'read', row)).values)
  .toEqual({ name: 'Ada' });
```

- [ ] Test invalid variables/operators, deep predicates, null/missing fields, empty groups, disabled grants excluded by resolver, no grants, and attempted creator/tenant changes. Update tests require a grant matching both before/after and authorizing all changed fields; unrelated grants cannot make an otherwise unauthorized compound write succeed.
- [ ] Run `pnpm --filter @savia/crm-shared test src/access-control.test.ts src/access-evaluator.test.ts`; expected FAIL before implementation.
- [ ] Implement recursive strict Zod validation and matching. For reads, union fields only from matching grants; deduplicate/sort fields and grant IDs for deterministic snapshots. For writes, select grants satisfying both record states and the full changed-field set.

```ts
const applicable = policy.grants.filter(g => g.resource === resource && g.action === action);
// Implement predicate matching with a typed visitor over AccessPredicate.
// Each matching grant contributes only its own fields to that record's decision.
```

- [ ] Rerun focused tests and shared typecheck; expected PASS. Commit as `feat: add scoped access policy evaluator`.

## Task 3: Persist policies, assignments, revisions and audit atomically

**Files:** modify `packages/db/src/core-schema.ts`; create allocated `access_control.sql`, `apps/api/src/auth/access-repository.ts`, `apps/api/src/auth/access-compatibility.ts`, `apps/api/test/access-repository.test.ts`; extend Task 1 fixtures and parity tests.

**Interfaces:** `loadAccessPolicy(db, actor: AppActor, scope: AccessScope): Promise<AccessPolicy>`; `saveAccessRole(db, actor, input: SaveAccessRole): Promise<{id:string; revision:number}>`; `replaceAccessAssignments(db, actor, input: ReplaceAccessAssignments): Promise<{revision:number}>`. Export these input types; new role IDs are server-generated and target membership derives from the database:

```ts
export type SaveAccessRole = {
  scope: AccessScope; id?: string; name: string; label: string;
  description: string; enabled: boolean; expectedRevision: number;
  grants: Array<Omit<AccessGrant, 'id' | 'roleId'>>;
};
export type ReplaceAccessAssignments = {
  scope: AccessScope; principalId: string; roleIds: string[]; expectedRevision: number;
};
```

Input revisions refer to the scope revision, including role creation; revision zero is the initial empty scope. Use the returned scope revision for subsequent writes.

- [ ] Add real-D1 tests for same-named roles in different scopes, duplicate assignments, inactive membership, foreign-role IDs, protected-role edits, revision races, tenant transfer and transaction failure. Verify no assignment, audit row or revision survives a failed batch.
- [ ] Use the following concurrency assertion with `saveAccessRole` inputs created in the test:

```ts
const outcomes = await Promise.allSettled([
  saveAccessRole(f.db, actor, { ...input, expectedRevision: 1 }),
  saveAccessRole(f.db, actor, { ...input, expectedRevision: 1 })
]);
expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
```

- [ ] Run `pnpm --filter @savia/api test test/access-repository.test.ts`; expected FAIL.
- [ ] Add `access_roles`, `access_grants`, `access_assignments`, `access_revisions`, `access_audit`. Use composite scope/ID uniqueness and foreign keys; keep the existing membership constraint. Atomic mutations use a D1 batch with a revision compare-and-swap whose failure aborts the whole batch (an assertion constraint), not a pre-read followed by an unconditional write. Audit only sanitized policy metadata. Reload active membership on every resolution so even an assignment raced with a transfer has no authority.
- [ ] Seed protected compatibility roles for existing users/scopes from the Task 1 map. Include future membership creation and protected-role changes in the identity repository path; the legacy single role remains a compatibility label, not the custom business-role store. User suspension, deletion and transfer invalidate old assignments/revisions.
- [ ] Run repository, parity, identity and tenant-membership tests, plus DB typecheck. Commit as `feat: persist scoped roles and assignments`.

## Task 4: Expose policy administration and trusted request context

**Files:** create `apps/api/src/auth/access-context.ts`, `apps/api/src/auth/access-registry.ts`, `apps/api/src/routes/access-control.ts`, `apps/api/test/access-control-routes.test.ts`; modify `apps/api/src/app.ts`, `apps/api/src/auth/identity-repository.ts`, `apps/api/src/routes/identity.ts`.

**Interfaces:** `resolveAccessContext(db, actor, scope): Promise<AccessPolicy>`; `registerAccessControlRoutes(app, db): void`. Register `/v1/access-control/roles` GET/POST, `/roles/:id` PATCH/DELETE, `/assignments/:principalId` GET/PUT, `/catalog` GET and `/effective` GET, all under that prefix. Query scope is parsed then verified against the actor. Mutations carry expectedRevision; effective preview accepts a target principal only for scoped administrators. Define strict Zod request/response schemas in this module, including structured 403/409/422 errors.

- [ ] Add API tests for agency CRUD/assignment within tenant 101, tenant 102 and domain denial, preview denial for ordinary users, immutable administrative roles and inability to grant `capability:identity.manage`. A stale save must return 409 and its current revision without another tenant's policy contents.

```ts
const response = await f.request('agency_admin', 101,
  '/v1/access-control/roles?scope=tenant%3A102');
expect(response.status).toBe(403);
```

- [ ] Run `pnpm --filter @savia/api test test/access-control-routes.test.ts`; expected FAIL.
- [ ] Implement server-derived scope resolution and an explicit capability registry. Tenant role managers can assign business capabilities only; protected agency-admin status and global identity stay platform-only. Check role and scope IDs jointly on every lookup. Persist assignment changes with Task 3 repository operations and reject disabled roles.
- [ ] Return `Cache-Control: no-store` for policy APIs. Scope-filter the catalog, include supported actions/fields/predicates per adapter, and never list secrets or unsupported operations. Extend session permissions with scope/revision and effective resource summaries, keeping record-sensitive decisions on the server.
- [ ] Run focused API tests and `pnpm --filter @savia/admin generate:api`; inspect generated changes, retaining public-form contracts. Commit as `feat: expose scoped permission administration`.

## Task 5: Enforce native CRM queries, mutations, relations and files

**Files:** create `packages/crm-server/src/access-query.ts`, `packages/crm-server/src/access-authorization.ts`, `packages/crm-server/test/access-authorization.test.ts`; modify `context.ts`, `index.ts`, `services.ts`, `query.ts`, `operations.ts`, `schema.ts`, `menu-layout.ts` under that package; modify `apps/api/src/crm/collection-gateway.ts`, `apps/api/src/routes/dynamic-crm.ts`, `apps/api/src/routes/data-domains.ts`.

**Interfaces:** add `authorization: AccessPolicy` to the trusted CRM app options and Hono context; production tenant mode rejects missing authorization. Explicit localhost demo mode receives a local-only policy. `compileAccessWhere(policy, resource, action, columns: Readonly<Record<string,string>>): {sql:string; bindings:Scalar[]}` compiles validated identifiers and bound values. `requireRecordAccess(policy, resource, action, record): AccessDecision` throws 403 when denied; use `decideWrite` for writes. SQL predicates always include tenant/domain scope independently of role predicates.

- [ ] Add real-storage tests comparing SQL and pure predicate decisions, including Unicode strings, nulls and numeric comparison. Exercise each CRUD operation, bulk selection, restore, import, export, count, ordering, filters, relationships and files through HTTP. Test hidden field inference attempts, unauthorized fields in a payload, direct file IDs, published aliases, bootstrap and metadata.

```ts
const decision = decideRecord(policy, 'collection:clients', 'read', row);
expect(decision.allowed).toBe(false);
expect((await response.json()).data).not.toContainEqual(expect.objectContaining({ id: row.id }));
```

- [ ] Run `pnpm --filter @savia/crm-server test test/access-authorization.test.ts`; expected FAIL.
- [ ] Apply SQL row constraints before count/pagination. For query fields, require availability over the entire queried authorized scope; reject conditional hidden-field queries rather than infer data. Project each returned record before serialization; authorize relationship targets and file-owning records. Require import/export permission plus the respective CRUD/read decisions; restore requires its explicit action. Make bulk authorization fail the whole operation before mutations when any target is unauthorized.
- [ ] Supply the context from the gateway and replace coarse method/manager guards with registered actions while retaining tenant existence and active-state checks. Separate schema/menu configuration from record access. Protect read-modify-write operations with existing record versions and authorization predicates in the write statement; no authorization-only pre-read followed by an unguarded mutation.
- [ ] Run the focused authorization tests, CRM API/record-integrity tests and API parity tests. Commit as `feat: enforce record and field access in crm`.

## Task 6: Cover managed adapters, extensions and background execution

**Files:** modify `apps/api/src/crm/collection-domain-provider.ts`, `collection-operations.ts`, `collection-relations.ts`, `collection-options.ts`, `customer-sync.ts`, `auto-sync.ts`, `apps/api/src/assistant/service.ts`, `apps/api/src/request-pages/routes.ts`, `packages/crm-server/src/integrations.ts`, `extension-actions.ts`, `extension-summaries.ts`, `operations.ts`; create `apps/api/test/access-control-entry-points.test.ts` and `packages/crm-server/test/access-extension-actions.test.ts`. Add additional owners from the concrete Task 1 inventory to this task's checklist before editing them.

**Interfaces:** thread trusted `AccessPolicy` into adapter read/write commands. Add explicit adapter capabilities describing row/field enforcement. User-initiated queued operations carry `principalId`, `scope`, and resource/action IDs, never grants; resolve current policy at execution. System execution uses a server-created discriminated context `{kind:'system', scope, jobName}` on an allowlisted job path; absence of a user never implies system access.

- [ ] Test relation options, operational customers, managed exports, summaries, assistant/MCP calls, direct extension execution, queued execution after revocation and connectors without fine-grained support. The provider transport must not be called on denial:

```ts
expect(response.status).toBe(403);
expect(providerFetch).not.toHaveBeenCalled();
```

- [ ] Run `pnpm --filter @savia/api test test/access-control-entry-points.test.ts` and `pnpm --filter @savia/crm-server test test/access-extension-actions.test.ts`; expected FAIL.
- [ ] Authorize before the external request/side effect and project returned fields. For adapters that cannot push down predicates safely, return a structured unsupported-policy response and advertise the limitation in the catalog; do not fetch a page, filter it locally and report an incorrect global total. Keep full-scope compatibility access only where Task 1 confirms it.
- [ ] Revalidate queued work against active current membership before execution; leave genuinely system-owned jobs on explicit scoped policies. Public-form capability contexts remain separate and cannot manufacture an authenticated role. Ensure MCP and assistant routes call the same protected services rather than bypassing them.
- [ ] Rerun focused tests, provider/extension regression tests and Task 1 parity cases. Update every inventory row with enforcing service and test name. Commit as `feat: apply access policy to adapters and actions`.

## Task 7: Bind server synchronization to policy and remove revoked data

**Files:** modify `packages/crm-server/src/local-sync.ts`, `packages/crm-server/test/local-sync.test.ts`; create `packages/crm-server/test/access-sync.test.ts`; add allocated CRM and API DB migrations if creator metadata or journal projection requires it. Reuse durable existing record/change-journal storage; do not introduce a permissive shadow API.

**Interfaces:** manifest includes `principalId`, `scope`, `policyRevision`; cursor v2 includes those plus collection and sequence. Responses retain documents/cursor/hasMore and add `removedIds: string[]`. Return 409 with code `ACCESS_SCOPE_RESET` on old-version or mismatched identity/revision cursors. A cursor is a position, never a source of permission; resolve current server policy regardless of its contents.

- [ ] Test another principal's cursor, forged high revision, old v1 cursor, role revocation between pages, hidden fields, a record moving out of a predicate, and retrying an old mutation receipt after revocation. Unknown historical creators match no own-records grant; never backfill the requesting user as creator.

```ts
expect(resetResponse.status).toBe(409);
expect(await resetResponse.json()).toMatchObject({ error: { code: 'ACCESS_SCOPE_RESET' } });
expect(delta.removedIds).toContain(previouslyVisibleId);
expect(JSON.stringify(delta)).not.toContain('private-commission');
```

- [ ] Run `pnpm --filter @savia/crm-server test test/access-sync.test.ts`; expected FAIL.
- [ ] Apply current policy to manifest/schema and journal documents; advance cursor over examined journal rows even if none match. Add `crm_access_deliveries` keyed by principal, scope, policy revision, collection and record ID. Persist an idempotent delivery entry before returning each authorized record; the ledger records only IDs and sequence, not record contents. For a now-nonmatching journal entry, send a removal ID only if that same principal/scope/revision previously received or was offered the record; otherwise skip it without exposing its ID. Repeated removals are harmless; retain delivery entries for the life of the associated cursor revision so retries cannot lose revocations. Test that a principal never offered a hidden record sees neither its ID nor contents. If an adapter lacks a durable visibility-removal mechanism, require a reset instead of incremental replication.
- [ ] Persist creator identity on server-created native rows and journal changes if absent. Protect creator from updates/import overrides. Return read-only manifest capability when writes are disallowed and never include fields the user cannot read in replicated records. Check current authorization before returning old mutation receipts; redact receipt responses by current read policy and do not rerun acknowledged effects.
- [ ] Run focused sync tests plus existing local-sync tests and schema/migration tests. Commit as `feat: enforce permissions in synchronization`.

## Task 8: Invalidate browser replicas, caches and queued work

**Files:** modify `apps/admin/src/local-data/contracts.ts`, `sync.ts`, `store.ts`, `workspaces.ts`, `session.ts`, `transport.ts`, and corresponding existing `.test.ts` files; modify `apps/admin/src/auth/auth-session.ts`, `better-auth-oauth-session.ts` and its tests. Add `apps/admin/src/local-data/access-revocation.test.ts`.

**Interfaces:** extend `PullBatch` with `removedIds?: string[]`, scope/revision metadata as required by Task 7; workspace identity includes server policy revision. Add `LocalStore.invalidateAccess(revision: number): Promise<void>` to the existing store API: block reads first, quarantine pending work, atomically delete clean rows and old cursors, and reopen only after a matching authorized manifest/full projection.

- [ ] With fake IndexedDB and mocked transport, test field removal rather than merge, row removal, revision changes between manifest/pull, late results from the old scope, denied outbox writes, tab reuse, logout/relogin, cached metadata and expiry of the twelve-hour lease. Denied pending work must not be exposed by conflict previews or export.

```ts
expect(await store.authorizationError()).toBeTruthy();
expect(await store.get('clients', 'revoked-client')).toBeUndefined();
expect(await store.db.records.where('collection').equals('clients').count()).toBe(0);
```

Seed a clean revoked-client row before invalidation; separately seed pending work and verify it is quarantined and inaccessible through the transport and recovery UI. Assert both app-visible query output and persisted clean-row deletion.

- [ ] Run `pnpm --filter @savia/admin test src/local-data/access-revocation.test.ts`; expected FAIL.
- [ ] Consume reset/removal messages in a single store transaction. Abort obsolete workspaces; suppress responses whose principal/scope/revision/generation no longer match. Ensure authorization failures clear retained UI rows and cached metadata. Do not auto-replay rejected mutations after reacquiring a less privileged policy. Preserve inaccessible pending-work recovery using the existing session protections.
- [ ] Update offline snapshots with server revision and keep the existing lease duration. Explicit server rejection must never fall back to offline access. Do not add a browser role/policy source of truth.
- [ ] Run all local-data tests and auth session tests. Commit as `fix: invalidate replicas after access changes`.

## Task 9: Build scoped role administration and replace frontend role gates

**Files:** create `apps/admin/src/api/access-control-client.ts` and test; create `apps/admin/src/features/access-control/role-pages.tsx`, `role-editor.tsx`, `grant-editor.tsx`, `assignment-editor.tsx`, `effective-permissions.tsx`, `role-editor.test.tsx`, `assignment-editor.test.tsx`; modify `apps/admin/src/app.tsx`, `features/users/user-pages.tsx`, `auth/react-admin-auth-provider.ts`, `auth/react-admin-auth-provider.test.ts`, `features/crm-engine/runtime.ts`, `features/crm-engine/screen-administration.tsx`, `features/crm-engine/collection-capabilities.ts` and relevant screen/form components identified by the access inventory.

**Interfaces:** `createAccessControlClient(apiClient)` wraps generated contracts: listRoles(scope), saveRole(input), deleteRole(scope,id,expectedRevision), getAssignments(scope,principalId), replaceAssignments(input), getCatalog(scope), getEffective(scope,principalId). UI query keys include principal and scope. Use existing API error and mutation patterns. Backend effective summaries drive navigation and actions; record-sensitive controls consume corresponding server decisions.

- [ ] Add tests with Testing Library for create/edit/save/reopen, multiple assignments, switching tenant scope, immutable protected roles, a 409 conflict, unsupported adapter controls and offline-disabled saves. Verify a hidden action remains inaccessible through direct API tests from previous tasks.

```ts
await user.click(screen.getByRole('button', { name: 'Save role' }));
expect(await screen.findByRole('alert')).toHaveTextContent('changed');
expect(screen.getByRole('textbox', { name: 'Role name' })).toHaveValue('Claims reviewer');
```

- [ ] Run `pnpm --filter @savia/admin test src/features/access-control src/api/access-control-client.test.ts`; expected FAIL.
- [ ] Build the editor with General, Pages, Data, Administration and Members sections using existing shadcn/ra-core components. Include action tables, row-filter and field selectors, effective access explanation and clear additive-role behavior. Disable forbidden capabilities based on the server catalog; still handle server rejection. Never show global user-management controls to a tenant-only role manager.
- [ ] Replace permissive frontend fallbacks for registered protected resources with server-derived decisions. Preserve public/auth routes through explicit registration. Hide denied collections/fields and gate record actions without treating client checks as enforcement. Invalidate policy queries and workspaces only after a confirmed server save.
- [ ] Run focused UI tests, existing auth-provider tests, admin typecheck and browser verification of keyboard use, narrow layout, role assignment and permission revocation. Use the browser skill for inspection. Commit as `feat: add scoped role and permission editor`.

## Task 10: Complete parity, end-to-end denial and rollout documentation

**Files:** extend `apps/api/test/access-control-parity.test.ts`, `access-control-entry-points.test.ts`, `packages/crm-server/test/access-authorization.test.ts`, `apps/admin/src/local-data/access-revocation.test.ts`; create `docs/permissions.md`; update `docs/README.md`, `docs/runbooks/data-domain-studio.md`, `docs/local-first-collections.md`, `docs/access-control-entry-points.md`; regenerate `apps/admin/src/api/generated/openapi.ts` from schemas.

**Interfaces:** no new policy semantics; require all Task 1 inventory rows to have implementation and regression coverage. Mark adapter capabilities accurately in generated catalogs and user documentation.

- [ ] Exercise a complete administrator flow: create role, grant own-row reads and selected writes, assign to a viewer, verify direct API behavior, add a complementary role, revoke one, verify next online request and replica reset. Repeat a denial through export, relation picker and assistant/MCP entrypoints.
- [ ] Run the targeted suites from Tasks 1–9 once after their final relevant changes. Then run `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm --filter @savia/admin generate:api`, and `git diff --check`. Report existing unrelated lint failures with concrete output; never mark a failed check as passing. Regeneration must preserve unrelated current contracts.
- [ ] Document role administration, action meanings, own-record creator semantics, multi-role field behavior, unsupported adapters, audit visibility, offline lease limitation and migration/recovery procedure. Document schema rollout before enforcing server rollout and UI activation; old clients must receive reset/denial rather than a legacy authorization bypass.
- [ ] Review every raw role check and every trusted-system context against the entry-point inventory. Resolve omissions before claiming completion. Do not enable editing or deploy a partial policy engine.
- [ ] Run final browser checks in two user sessions: agency admin and restricted user. Confirm a saved change affects the restricted user's next online operation and that another agency's data never appears. Keep fixture data local and clean it through existing fixture teardown.
- [ ] Commit explicit task-owned files as `docs: document configurable access control rollout`; present tests, remaining limitations and local change summary. Do not deploy or create external resources without task authorization.

## Self-review and handoff

Coverage: administration and persistence → Tasks 3–4; evaluation and role union → Task 2; server paths and query constraints → Tasks 5–6; offline and receipt revocation → Tasks 7–8; UI → Task 9; migration parity, generated API and operational docs → Tasks 1 and 10. Each Review Focus item maps to concrete tests above.

The recommendation is native execution in this session: the tasks share policy types, legacy access behavior and synchronization state, so one implementer can maintain that context. An independent final review is still appropriate for the authorization boundary. Alternative: subagent-driven execution with a separate implementation/review cycle per task, at higher context cost. User review of this plan and selection of execution method are required before implementation by the writing-plans workflow.
