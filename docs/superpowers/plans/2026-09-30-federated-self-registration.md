# Tenant Federated Self-registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let tenant administrators enable first-login registration with Google or Microsoft, creating only verified users with viewer membership.

**Architecture:** Bind the tenant and settings revision to Better Auth's server-side OAuth context. Stage new authentication users until an authenticated API service operation finalizes their tenant membership. Issue a session only after finalization; compensate partial failures without deleting existing users.

**Tech Stack:** TypeScript, Better Auth 1.7.6, Cloudflare Workers/D1, Hono/Zod, React, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-30-federated-self-registration-design.md`

## Global Constraints

- Registration defaults to off; off requires administrator-precreated users.
- New membership role is fixed to `viewer`; no global or custom role assignments.
- No transfer, elevation, reactivation, or deletion of existing users.
- Only exact provider-verified email is accepted; Microsoft remains organization-only.
- Existing local signup, SAML policy, MFA, capacity enforcement, and tenant isolation remain.
- Product UI is localized; source code, tests, and guides are English.
- Generate OpenAPI types; do not hand-edit the API reference.
- Deploy preview only; deployment must not turn registration on.

## Review Focus

- Legacy settings clients omit the new flag: preserve compatibility and default false.
- OAuth callbacks return on the canonical host: resolve the intended tenant from trusted persisted context.
- Two callbacks register the same identity: one account/membership, no foreign-tenant transfer.
- Settings change during provider sign-in: reject stale attempts before granting access.
- Workspace membership creation fails after authentication user creation: no session and safe compensation.

---

### Task 1: Tenant registration setting

**Files:** `apps/auth/src/social-sign-in.ts`, `apps/auth/test/social-sign-in.test.ts`, `apps/api/src/tenant-social/routes.ts`, `apps/api/test/tenant-social.test.ts`.

**Interfaces:** Add `allowRegistration: boolean` to tenant social settings and responses. Input accepts omission as false. Better Auth schema uses a false default for existing rows through its migration mechanism.

- [ ] Write regressions for missing/default false, explicit true/false, persistence, deletion resetting false, tenant-admin authorization, and policy revision invalidation.
- [ ] Run `pnpm --filter @savia/auth test test/social-sign-in.test.ts` and the API tenant-social test; confirm new assertions fail.
- [ ] Extend settings parsing/schema/bridge responses; preserve provider validation and session revocation.
- [ ] Re-run both test files and commit `feat: configure tenant federated registration`.

### Task 2: Trusted OAuth registration context

**Files:** `apps/api/src/api-shell.ts`, `apps/auth/src/social-registration-context.ts` (new), `apps/auth/src/social-sign-in.ts`, `apps/auth/test/social-registration-context.test.ts` (new), API auth shell tests.

**Interfaces:** Gateway injects `x-savia-social-tenant-id` only after resolving an active tenant hostname and overwriting incoming context. `trustedSocialRegistrationContext(request, environment, adapter)` returns `{ tenantId, provider, revision, attemptId, expiresAt } | null`. Use `addOAuthServerContext` / `getOAuthState` from `better-auth/api` for trusted server context.

- [ ] Write failing tests for canonical host, forged headers, invalid bridge key, disabled registration/provider, inactivity, revision change, expiry, replay, and canonical callback recovery.
- [ ] Run the focused auth/API tests and observe failures.
- [ ] Bind a single-use registration attempt to server-side OAuth state at social start; never trust browser `additionalData`, roles, tenant IDs, or email domains. Reject direct id-token sign-in and retain existing provider restrictions.
- [ ] Re-run focused tests and commit `feat: bind federated registration to trusted tenant context`.

### Task 3: Idempotent minimum-permission membership finalization

**Files:** `apps/api/src/tenant-social/registration.ts` (new), `apps/api/src/api-shell.ts`, `apps/api/test/tenant-social-registration.test.ts` (new), `packages/db/migrations/0005_social_registration.sql` (new), `packages/db/postgres/0006_social_registration.sql` (new), `packages/db/postgres/manifest.json`.

**Interfaces:** Internal `POST /_internal/social-registration` accepts bridge-authenticated `{ attemptId, tenantId, subject, email, displayName, provider, revision }`. `finalizeSocialRegistration(db, input)` returns `{ principalId, membershipId, created }`; conflicting identity ownership is rejected. `DELETE` for an attempt compensates only rows owned by that incomplete operation.

- [ ] Write failing tests for missing bridge key, duplicate attempt, conflicting subject/email, foreign membership, last-seat concurrency, revoked registration revision, and failure rollback.
- [ ] Run `pnpm --filter @savia/api test test/tenant-social-registration.test.ts` and relevant database/capacity tests; observe failures.
- [ ] Add a provisioning ledger with unique attempt and auth subject. Use identity email uniqueness and capacity preflight; batch final identity/membership writes so the membership trigger enforces capacity. Insert viewer membership directly rather than using transfer; never insert global roles or access assignments. Revalidate current tenant/provider policy via the internal auth bridge before committing.
- [ ] Audit successful finalization and rejected/compensated operations without token data. Verify SQLite/D1 and PostgreSQL migrations behave equivalently.
- [ ] Re-run tests and commit `feat: finalize federated users with viewer access`.

### Task 4: Callback provisioning and service wiring

**Files:** `apps/auth/src/social-registration.ts` (new), `apps/auth/src/social-sign-in.ts`, `apps/auth/src/index.ts`, `apps/auth/test/social-registration.test.ts` (new), `scripts/render-cloudflare-production-config.mjs`, `scripts/preview-deploy.mjs`, `scripts/dev-api-runtime.mjs`, `apps/self-hosted/src/application.ts`, corresponding runtime/config tests.

**Interfaces:** Auth environment receives `SAVIA_IDENTITY: { fetch(request: Request): Promise<Response> }`, bound to the API service; self-hosted passes a lazy in-process service adapter. Registration proof records the newly created user and attempt. `provisionSocialUser(context, proof, user)` awaits finalization before any session creation.

- [ ] Write failing tests for registration off requiring precreation, enabled provider-verified first login, unverified email, Microsoft directory mismatch, MFA, and partial API/service failure producing no session.
- [ ] Run focused auth and runtime tests; observe failures.
- [ ] Replace unconditional social signup blocking with proof-gated creation. Existing-account policy stays intact. Use user create hooks to set trusted tenant/user/verified fields and finalize membership before account/session issuance. Account and session hooks recheck proof/revision. On failure clean only the new attempt's accounts/principal; retry through the ledger and retain evidence for cleanup. Keep email/password signup disabled.
- [ ] Wire the identity binding for preview, production configuration generation, local development, and self-hosted. Do not deploy production.
- [ ] Re-run tests, including hostile callback/concurrency cases, and commit `feat: provision federated identities before issuing sessions`.

### Task 5: Registration controls and guide

**Files:** `apps/admin/src/features/tenant-social/tenant-social-settings-panel.tsx`, `tenant-social-messages.ts` and panel tests in that directory, generated admin OpenAPI types, `docs/guides/social-sign-in.md`.

**Interfaces:** Form GET/PUT includes `allowRegistration`; missing responses resolve to false. User-facing option explains disabled = administrator-precreated users, enabled = verified first-login registration, initial access = Viewer, and capacity limits.

- [ ] Write failing panel tests for legacy false, load/save true, switching tenants, disabling registration, and removal reset.
- [ ] Run the panel tests and observe failures.
- [ ] Use Impeccable incumbent form styles and add the accessible switch after provider configuration with a fixed Viewer label. Localize using existing message structure. Update the guide and generate API types using `pnpm --filter @savia/admin run generate:api`.
- [ ] Run panel tests and admin TypeScript; inspect desktop/mobile together, fix observed defects, then perform one confirmation pass.
- [ ] Commit `feat: expose federated registration controls`.

### Task 6: Combined review and preview deployment

- [ ] Review the whole diff against the approved spec, including the five review-focus cases and rollback ownership. Run relevant auth/API/admin/self-hosted suites, package TypeScript checks, migration/config checks, and changed-file Prettier.
- [ ] Create and attach a PR. Require successful CI before merging. Allow main CI to trigger preview deployment and verify the deployed release SHA and health.
- [ ] Verify off rejects unknown identities, on creates only viewer membership, and disabling blocks further creation. Use controlled provider fixtures for callback evidence; report any real provider authentication that still requires user interaction.
- [ ] Leave tenant registration off until a tenant administrator explicitly saves it on. Report exact checks performed and any unresolved limitations.
