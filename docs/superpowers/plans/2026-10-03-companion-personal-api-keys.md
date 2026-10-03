# Companion Personal API Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: ready for user review and execution-method selection.

**Goal:** Create tenant-bound personal API keys and use them to connect Companion to preview with restricted recording access.

**Architecture:** A database-backed credential repository feeds the existing authentication boundary. An explicit method/path policy limits credentials to recording operations; storage enforces owner and tenant together. Personal account settings manage credentials, and Companion retains the secret only in memory.

**Tech Stack:** TypeScript, Hono/OpenAPI, Cloudflare D1/R2, PostgreSQL adapter, React, Tauri/Rust, Vitest.

**Spec:** [Approved design](../specs/2026-10-02-companion-personal-api-keys-design.md).

## Global Constraints

- Personal keys only; no service accounts, wildcard scopes or production enablement.
- Credential prefix `savia_pat_`; at least 32 cryptographically random secret bytes; SHA-256 digest only in the database.
- Expiry choices 7, 30 and 90 days; default 30; maximum 90; no non-expiring keys.
- Required names of at most 80 characters; at most 20 live keys per owner, enforced atomically.
- Scopes: `recordings:read`, `recordings:upload`, `recordings:process`, `recordings:delete`; Companion defaults to read + upload.
- Recheck identity, tenant, membership, expiry and revocation on every request. No positive authorization cache.
- Metadata belongs in the backend. Secrets remain in memory and appear only once at creation; no browser persistence.
- Existing OAuth/session behavior and legacy owner-private recordings remain supported. Personal keys cannot read legacy recordings without tenant metadata.
- English code/tests/docs, translated product copy, conventional commits. API reference generated from route schemas.
- Reuse this isolated worktree and `codex/companion-personal-api-keys`; preserve unrelated edits. At most two Luna workers, no worker-created agents.

## Review Focus

1. A bad key plus a valid cookie must still fail authentication (Task 2).
2. A copied database must not activate another environment's credentials (Tasks 1–2).
3. Revoking membership during a desktop session must deny its next request (Task 2).
4. A filtered R2 page may be empty with a continuation cursor; the library must continue pagination (Task 3).
5. Switching the browser's active tenant must not change a key's provider account or access scope (Task 3).

## File and interface map

- New `apps/api/src/auth/personal-api-keys.ts`: schemas, credential generation, database lifecycle and current eligibility lookup.
- New `apps/api/src/auth/personal-api-key-policy.ts`: pure method/path/scope policy.
- New `apps/api/src/auth/personal-api-key-routes.ts`: interactive key-management endpoints with generated schemas.
- Existing auth types, authenticator, API shell/app and runtime: credential context and trusted deployment binding.
- Existing Companion repository/routes/configuration: tenant metadata, permission checks and bound-tenant provider selection.
- New `apps/admin/src/features/account/personal-api-keys.tsx` and client: account management panel, reusing existing primitives.
- Existing Companion frontend/native boundary: credential wording and granted-operation display.
- Database schema, migrations and PostgreSQL manifest; tests and guides alongside owning components.

### Task 1: Credential lifecycle and migrations

**Files:** Create `apps/api/src/auth/personal-api-keys.ts`, `apps/api/test/personal-api-keys.test.ts`; modify `packages/db/src/core-schema.ts`, `packages/db/postgres/manifest.json`, `apps/api/test/schema.test.ts`; add the next available `personal_api_keys` migration in each database migration directory.

**Interfaces:** Export `RecordingScope`, `PersonalApiKeySummary` (id, name, prefix, tenantId, scopes, createdAt, expiresAt, revokedAt, lastUsedAt; no secret/digest), and `PersonalApiKeys(db, deploymentId, now?)`. Methods: `create(actor, {name,tenantId,scopes,lifetimeDays}): Promise<{key: PersonalApiKeySummary; secret:string}>`, `list(ownerId): Promise<PersonalApiKeySummary[]>`, `revoke(ownerId,keyId): Promise<void>`, `authenticate(secret): Promise<{actor:AppActor; key:PersonalApiKeySummary}>`, `touch(keyId): Promise<void>`. `now` returns epoch milliseconds for deterministic expiry tests.

- [ ] Write failing repository tests asserting: only creation returns plaintext; stored digest differs from secret; lifetime values/default and name limits; owner isolation; idempotent revoke; no recovery via list; exact expiry boundary; ineligible tenant creation rejected. Race two creates when 19 keys exist and assert exactly one succeeds and live count is 20.
Key assertions (using the repository and seeded eligible actor):

```ts
const created = await repo.create(actor, {
  name: "Companion preview", tenantId: 1,
  scopes: ["recordings:read", "recordings:upload"], lifetimeDays: 30,
});
expect(created.secret).toMatch(/^savia_pat_/);
expect(Date.parse(created.key.expiresAt) - now()).toBe(30 * 86400000);
expect(await repo.list(actor.principal.id)).not.toEqual(
  expect.arrayContaining([expect.objectContaining({secret: expect.any(String)})]),
);
await repo.revoke(actor.principal.id, created.key.id);
await expect(repo.authenticate(created.secret)).rejects.toThrow();
```

- [ ] Run `pnpm --filter @savia/api test test/personal-api-keys.test.ts` and confirm the new assertions fail before implementation.
- [ ] Implement repository and forward-only schema migrations. Use Web Crypto, parameterized SQL and conditional insertion for the cap. Keep public key ID separate from display prefix; never log secret material. Atomically write creation/revocation audit metadata. Validate active tenant and membership for create/authenticate, including the existing tenant-0 platform-admin membership rule.
- [ ] Add copied-database test: the same row authenticates under deployment A but not B; inactive principal, tenant and membership reject; changing active browser tenant does not alter stored binding.
- [ ] Run repository/schema tests and `pnpm --filter @savia/self-hosted test test/postgres-migrations.test.ts`; expect all passing. Check migration manifest conventions before changing it.
- [ ] Commit only Task 1 files as `feat: add personal API key lifecycle`.

### Task 2: Shared authentication, route policy and management API

**Files:** Create policy/routes modules and `apps/api/test/personal-api-key-auth.test.ts`, `apps/api/test/personal-api-key-routes.test.ts`; modify `apps/api/src/auth/types.ts`, `apps/api/src/auth/better-auth.ts`, `apps/api/src/api-shell.ts`, `apps/api/src/app.ts`, `apps/api/src/runtime.ts`, and existing auth tests as needed.

**Interfaces:** Add optional discriminated `credential` to `AppActor`: `{kind:'personal-api-key'; keyId:string; tenantId:number; scopes:RecordingScope[]}` or `{kind:'interactive'}`. Export `authorizePersonalApiKeyRequest(request:Request, scopes:readonly RecordingScope[]):void` and `registerPersonalApiKeyRoutes(app, repository):void`. Inject the Task 1 repository into `betterAuthAuthenticator` without changing custom test authenticators.

- [ ] Write failing auth tests for valid key; expired/revoked/wrong-deployment keys; invalid key plus valid cookie; unknown opaque Bearer plus cookie; unchanged valid JWT/session paths; live membership removal between two requests. Add a table-driven scope × method × path test with explicit denied unknown routes and methods.
- [ ] Run the new auth/policy tests and verify expected failures.
- [ ] Implement prefix-first authentication and fail-closed Bearer handling. Derive deployment ID from canonical backend OAuth/public-origin configuration, never incoming Host; local development uses its configured local origin. Wire all production authenticator construction sites, including notifications, assistant and lookups. Match exact paths and validate recording UUIDs; deny all paths outside the allowlist, including cloud imports and stateless transcribe/summarize.
- [ ] Register interactive-only `GET/POST /v1/account/api-keys`, `DELETE /v1/account/api-keys/{id}`, and `GET /v1/account/api-keys/tenants`. Use existing authenticated actor/MFA rules, require API write scope for OAuth management mutations, and apply existing origin/CSRF protections to cookie mutations. Return 201 for creation, 204 for revoke, and no-store headers. Restrict eligible tenants to current memberships; keys cannot manage keys, even themselves.
- [ ] Add tests for cross-owner revoke/list, missing cookie-origin protections, unknown scopes, max-limit rejection and secret omission from list/errors/audit. Test read permits list/audio/notes, upload permits both native and binary upload, process permits notes generation, delete permits deletion; capabilities accepts any recording scope. Do not enable the future questions path until its real handler exists.
- [ ] Run auth/routes tests plus `pnpm --filter @savia/api test test/better-auth.test.ts test/admin-oauth.test.ts test/tenant-host-guard.test.ts`; expect passing with OAuth compatibility preserved.
- [ ] Commit Task 2 as `feat: authenticate scoped personal API keys`.

### Task 3: Recording tenant isolation and provider configuration

**Files:** Modify `apps/api/src/companion/recordings.ts`, `apps/api/src/companion/routes.ts`, `apps/api/src/assistant/configuration.ts`, and their recording/configuration tests; modify the admin recording list/client only if cursor traversal needs correction.

**Interfaces:** Export `RecordingAccess = {ownerId:string; tenantId?:number; requireTenant:boolean}` from the repository. Replace owner-only repository operation parameters with this context, including notes, audio, deletion and locks. Extend `Recording` with optional `tenantId`. Add `effectiveConfigurationForTenant(principalId:string, tenantId:number): Promise<EffectiveAssistantConfiguration>`; validate eligibility and share existing provider fallback logic without mutating active-tenant preferences. Add optional `grantedRecordingScopes` to capabilities for personal keys, preserving existing interactive clients.

- [ ] Write failing tests for cross-tenant audio/notes/process/delete rejection before provider calls; same-owner legacy recordings denied to keys but readable interactively; tenant-mismatched idempotent upload conflict; server-derived tenant metadata; filtered empty pages with a usable continuation cursor. Verify audio/notes deletion occurs only after the tenant check.
- [ ] Run focused Companion tests and confirm new assertions fail.
- [ ] Implement context construction from credential or validated interactive tenant. Preserve owner-prefixed R2 keys and legacy interactive access. Store/check tenant metadata, filter list results with bounded per-page work, and make UI pagination consume continuation cursors even for empty pages. Never trust a body-supplied tenant ID.
- [ ] Add explicit provider selection for bound keys. Test key tenant A uses A's credentials despite browser preference B, missing overrides follow existing global fallback, and tenant 0 uses platform configuration. Configuration reads must not reveal plaintext keys in responses.
- [ ] Run `pnpm --filter @savia/api test test/companion-recordings.test.ts test/companion-recording-notes.test.ts test/companion-import-routes.test.ts test/companion-routes.test.ts` plus new tenant/configuration cases; expect all passing.
- [ ] Commit Task 3 as `feat: isolate API key recording access by tenant`.

### Task 4: Personal key management and Companion connection

**Files:** Create `apps/admin/src/features/account/personal-api-keys.tsx`, `personal-api-keys-client.ts`, `personal-api-keys.test.tsx`; modify account page/tests and relevant locale modules; modify `apps/companion/src/main.tsx`, `client.ts`, `client.test.ts`, and native backend tests if needed. Create `docs/guides/personal-api-keys.md`; update account/Companion guide links and `apps/companion/README.md`.

**Interfaces:** `PersonalApiKeysPanel({api:ApiClient})` consumes Task 2 endpoints. Its client returns metadata-only summaries except the typed create response. Companion capabilities accepts optional `grantedRecordingScopes`; absence retains existing OAuth behavior, while explicit scopes control upload availability.

- [ ] Write failing UI tests for default 30-day read/upload preset, tenant selection, one-time reveal/copy, secret disappearance after closing, reload restoring metadata only, revocation, empty/error states and keyboard-accessible controls. Test create failures never display stale secret material.
- [ ] Run `pnpm --filter @savia/admin test src/features/account/personal-api-keys.test.tsx` and targeted Companion tests; confirm expected new failures.
- [ ] Implement the account panel using existing components, translations and authenticated API client. Display selected tenant, expiry and last use. Do not automatically copy secrets, add browser storage or allow scope edits. Document rotation and legacy recording restrictions.
- [ ] Update Companion wording and scopes-driven upload guidance. Preserve in-memory credentials, provider-key rejection, HTTPS validation, exact origins, redirect rejection and no automatic retry. Keep native and browser-preview behavior distinct.
- [ ] Run account tests, `pnpm --filter @savia/companion test`, API type generation via `pnpm --filter @savia/admin generate:api`, and affected typechecks. Inspect the real UI for creation/reveal/revoke and connection errors; inspect generated changes rather than hand-editing API types.
- [ ] Commit Task 4 as `feat: manage personal API keys and connect Companion`.

### Task 5: Review, preview deployment and real key validation

**Files:** Update `docs/companion/live-flow-smoke.md` and implementation status with measured results. No production configuration changes.

- [ ] Review the combined diff against the approved spec, especially route allowlisting, tenant-0 behavior, legacy metadata, bad-Bearer cookie fallback, migrations and secret handling. Use a fresh reviewer; fix actionable findings and rerun affected tests.
- [ ] Run targeted tests from Tasks 1–4, `pnpm run typecheck`, `git diff --check`, and a Companion build. Run native Rust tests/build when the existing toolchain is available; report platform checks that cannot run. Do not claim the known pre-existing monorepo formatting baseline is green.
- [ ] Create a draft PR with scope and validation evidence and attach it to this chat. Respect branch protections and the established main → CI → preview deployment workflow; a PR alone is not a preview deployment. If merge authorization is required, make this reviewed PR the concrete approval target. Do not bypass CI or touch production.
- [ ] On the updated preview, create a short-lived personal key using authorized account access, copy it only into Companion's password field, connect and upload synthetic native audio. Creation of a persistent credential through UI may require action-time confirmation under computer-use policy; batch that handoff with the concrete key name, tenant, scopes and expiry. Do not print or save the credential in test artifacts.
- [ ] Verify read/upload success, processing and deletion denial for the default preset, wrong-tenant denial and revocation on the next request. Confirm the saved audio remains after reload. Record the distinction between native capture, native upload and web import; failure of one must not be reported as full-flow success.
- [ ] Record sanitized evidence and remaining blockers. Retain only authorized sample data and no secret-bearing screenshots. Commit the report as `docs: record Companion API key preview validation`.

## Separate follow-up work retained from the original request

The API key plan is not the full completion criterion. Provider processing failure diagnosis and recording questions are separate increments with their own implementation/testing decisions; do not expand authentication tasks to contain them.

1. Obtain a sanitized backend error code/status for the existing synthetic sample. The streamed JSON was reproduced as valid; do not change serialization without new evidence. Verify whether notes contain a retained transcript. Reproduce any proven bug in a failing regression, fix its source, then perform a single controlled provider retest with known billing expectations. A generic UI failure does not identify the provider cause.
2. Implement single-recording questions against an existing saved transcript and explicit consent, with owner/tenant checks and the process scope before provider calls. Use the configured summary model, structured answer plus insufficient-evidence outcome, no invented timestamps and no business writes. Add tests for missing transcript, unknown facts, owner/tenant denial and provider failures; add the real route to the scope allowlist only alongside its implementation. Present its bounded design before code if any unanswered product decision emerges.
3. Finish with synthetic-audio summary persistence and grounded question-answer validation in preview. Native CoreAudio capture remains an independent known blocker until a real capture succeeds.

## Execution recommendation

Use native execution in this session with a fresh final review. Tasks 1–3 share security interfaces and should run sequentially; the account UI can be delegated to one Luna worker after the management contract is stable if the user prefers delegation. The repository's Astra/Luna ownership rules remain in force. No sidebar chats are needed.

Self-review: lifecycle, authorization, environment separation, tenant storage, provider binding, UI, native boundary, migration portability, documentation and preview verification each map to a task. Follow-up provider/Q&A work is explicitly retained rather than counted as implemented by the key feature.
