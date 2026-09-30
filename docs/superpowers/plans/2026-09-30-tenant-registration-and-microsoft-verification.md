# Tenant Registration and Microsoft Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete personal Microsoft sign-in with Savia email verification and independently configurable tenant email/password signup protected by Turnstile or ALTCHA.

**Architecture:** Auth owns encrypted settings, mail, pending identity proofs, provider-account binding, and session/MFA issuance. API resolves trusted tenant hosts, verifies CAPTCHA, limits abuse, and atomically provisions Viewer memberships through authenticated service bridges. Deliver the Microsoft verification path first, then email registration, sharing purpose-separated verification and provisioning primitives.

**Tech Stack:** TypeScript, Better Auth 1.7.6, Hono/Zod OpenAPI, React, Cloudflare Workers/D1, native Docker/PostgreSQL, existing Turnstile and ALTCHA libraries, pnpm/Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-tenant-email-registration-design.md` (approved September 30, 2026).

## Global Constraints

- Registration defaults to off for every tenant, including existing tenants.
- New members receive exactly Viewer; native auth accounts use `role=user` and never acquire platform/global/custom grants.
- Local email/password registration and federated registration remain independent.
- Keep Better Auth's generic public email signup endpoint disabled.
- Password requirements match the existing minimum of 12 characters.
- Microsoft verification links expire after 15 minutes; Microsoft intents expire after 20 minutes and require the original HttpOnly browser nonce.
- Registration CAPTCHA uses `tenant_signup`; public forms keep `public_submit`. ALTCHA challenge expiry remains 5 minutes. No CAPTCHA bypass for signup, including localhost.
- Secrets and pending proofs stay backend-owned. No raw passwords, CAPTCHA tokens, email links, OAuth tokens, or credentials in logs, audit records, browser persistence, or settings responses.
- English code/tests/docs; English and Spanish UI. Equivalent D1/SQLite and PostgreSQL domain migrations and generated API types.
- Deploy preview only after required checks; leave registration options off until an administrator saves an opt-in. Do not deploy production.

## Review Focus

1. Alias or canonical-host requests must resolve a trusted tenant or reject signup; query/body/header tenant spoofing must never select a different organization (Tasks 4 and 7).
2. Email verification on a different device must explain returning to the original browser, without creating a session on that device (Tasks 2 and 6).
3. Provider-email changes after explicit Microsoft linking must retain the proven local identity and resolve by provider subject, without transferring accounts (Task 3).
4. Secret rotations and blank secret replacement fields must preserve expected settings semantics, invalidate outstanding CAPTCHA challenges, and keep accepted pending email registrations intact (Tasks 1 and 5).
5. Administrative user edits, lost bridge responses, and concurrent last-seat requests must preserve edited accounts and never leave usable orphan identities or extra grants (Tasks 3 and 7).

---

### Task 1: Tenant registration settings and readiness contract

**Files:** Create `apps/auth/src/tenant-registration-settings.ts`, `apps/api/src/tenant-registration/settings-routes.ts`; modify `apps/auth/src/index.ts`, `apps/api/src/app.ts`; test `apps/auth/test/tenant-registration-settings.test.ts`, `apps/api/test/tenant-registration-settings.test.ts`.

**Interfaces:** Bridge `GET/PUT/DELETE /_internal/tenant-registration/:tenantId`; public admin `GET/PUT/DELETE /v1/tenants/{tenantId}/registration-settings`. Write JSON is `{allowEmailRegistration:boolean, captchaMode:"inherit"|"tenant", siteKey?:string, secretKey?:string|null}`. Safe response is `{allowEmailRegistration:boolean,captchaMode:"inherit"|"tenant",siteKey:string,secretConfigured:boolean,emailReady:boolean,revision:string}`; API adds `{captchaProvider:"turnstile"|"altcha",captchaReady:boolean,registrationReady:boolean}`. `null` explicitly removes an override; omitted/blank secret preserves it. An authenticated service-only effective-settings response may decrypt the override for API verification, never for the browser.

- [ ] Write settings tests: `defaults_registration_off`, `preserves_hidden_secret_on_blank_save`, `encrypts_tenant_secret_with_tenant_binding`, `rejects_cross_tenant_admin`, `cannot_enable_with_missing_email_or_captcha`, `delete_resets_off`.
- [ ] Run `pnpm --filter @savia/auth test test/tenant-registration-settings.test.ts` and `pnpm --filter @savia/api test test/tenant-registration-settings.test.ts`; confirm missing behavior fails.
- [ ] Implement settings persistence using the existing SMTP encrypted-storage convention with a separate encryption purpose, schema initialization in auth, active administrator checks following tenant-social routes, and combined API readiness. Only the bridge caller can supply prerequisite results; browser-supplied readiness/secret flags are rejected. Deleting a tenant removes owned settings.
- [ ] Run both test commands until green, including corrupt-ciphertext and credential-rotation cases; run auth/API typechecks.
- [ ] Commit `feat: add tenant registration settings and readiness`.

### Task 2: Purpose-bound pending email verification

**Files:** Create `apps/auth/src/pending-email-verification.ts`, `apps/auth/test/pending-email-verification.test.ts`; reuse `apps/auth/src/account-email.ts` delivery and `apps/auth/src/index.ts` trusted routing.

**Interfaces:** `PendingVerification` has `{id,purpose:"microsoft_link"|"password_registration",tenantId,email,revision,returnOrigin,browserNonceHash,expiresAt,providerSubject?:string,providerTenantId?:string}`. Export `createPendingVerification(input, environment, adapter)`, `sendPendingVerification(id, environment, dependencies, adapter)`, and `consumePendingVerification({id,token,browserNonce,origin}, environment, adapter): Promise<PendingVerification>`. Token and nonce hashes remain server-owned. Domain-side rate-limit decisions are supplied by authenticated API callers; public auth resend routes apply their own equivalent limits.

- [ ] Write `consumes_once_under_concurrency`, `rejects_wrong_purpose_tenant_browser_origin_and_expiry`, `different_browser_has_no_session`, `mail_failure_leaves_no_usable_identity`, and `resend_preserves_one_intent_and_bounds_attempts` tests with literal 15/20-minute Microsoft limits.
- [ ] Run `pnpm --filter @savia/auth test test/pending-email-verification.test.ts`; verify the failure names the absent verification behavior.
- [ ] Implement a dedicated auth plugin schema for owned pending intents and proof hashes. Use conditional D1 mutation/returning for single consumption, signed HttpOnly cookies, server-built links, and existing tenant mail delivery. Verification never sets up a session by itself. Cleanup removes expired intents; password-account cleanup checks ownership and verification state before deletion.
- [ ] Run the tests, including a genuine second browser nonce and concurrent duplicate requests; typecheck auth.
- [ ] Commit `feat: add purpose-bound email ownership verification`.

### Task 3: Complete Microsoft verification, account binding, and MFA

**Files:** Create `apps/auth/src/microsoft-email-verification.ts`, `apps/auth/test/microsoft-email-verification.test.ts`; modify `apps/auth/src/social-sign-in.ts`, `apps/auth/src/social-registration-context.ts`, `apps/auth/src/index.ts`, `apps/auth/test/social-sign-in.test.ts`, `apps/auth/test/social-registration.test.ts`; update `docs/guides/social-sign-in.md`.

**Interfaces:** Constrained plugin routes `GET /api/auth/microsoft-email-verification`, `POST /api/auth/microsoft-email-verification/send`, and `GET /api/auth/microsoft-email-verification/verify`. `beginMicrosoftVerification` consumes only an already signature/audience/issuer/state/PKCE-validated callback plus trusted tenant OAuth context and produces a Task 2 `microsoft_link` intent. A server-owned provider binding stores `{tenantId,userId,provider:"microsoft",providerSubject,providerTenantId,verifiedEmail}` with uniqueness on provider subject. Existing generic `/link-social`, token, and unlink endpoints stay blocked.

- [ ] Write actual callback tests with the observed consumer-token shape: `{tid:"9188040d-6c67-4c5b-b112-36a304b66dad",oid:"consumer-subject",email:"member@example.test"}` and no verified-email claim. Assert verification UI redirect and zero new users/accounts/memberships/sessions before proof.
- [ ] Add tests for precreated users with registration off, new Viewer creation only with federated opt-in, local-registration opt-in not authorizing social signup, linked-subject login after email changes, subject conflicts, missing/foreign/inactive/admin users, policy revisions, email proof replay, and MFA before session. Exercise bridge failures and preserve administrator edits.
- [ ] Run `pnpm --filter @savia/auth test test/microsoft-email-verification.test.ts test/social-sign-in.test.ts test/social-registration.test.ts`; verify red.
- [ ] Extend trusted tenant OAuth attempts to support eligible Microsoft linking when registration is off. Intercept unverified personal callbacks before Better Auth automatic creation/linking. After Task 2 proof, bind to the verified eligible local user or call existing federated Viewer finalization for an opted-in new user. Populate the existing social proof checks for account/session writes. Resolve proven later logins by provider subject and retain local email. Route first linking and later sign-in through the existing signed two-factor challenge/marker before usable sessions; never add a custom session path exempt from that check.
- [ ] Run the tests and full auth suite; verify existing Google, organizational Microsoft, SSO-only, MFA and compensation paths remain green. Document Entra audience plus `api.requestedAccessTokenVersion=2` and Savia email delivery prerequisites.
- [ ] Commit `feat: verify email ownership for personal Microsoft sign-in`.

### Task 4: Generalize CAPTCHA purposes without public-form regressions

**Files:** Create `apps/api/src/captcha/verification.ts`, `apps/api/test/registration-captcha.test.ts`; modify `apps/api/src/public-forms/captcha.ts`, `apps/api/src/public-forms/turnstile.ts` and their existing tests.

**Interfaces:** `CaptchaBinding = {purpose:"public_submit"|"tenant_signup",subject:string,origin:string}`. Export `createCaptchaChallenge(options,binding)`, `verifyCaptchaProof(options,{token,submissionId,ip,binding})`, and `captchaProofIdentity(options,token)`. Public-form wrappers retain current signatures, data encoding and `formId` behavior. Signup uses the trusted tenant ID as subject; neither caller-controlled origins nor public-form tokens can substitute.

- [ ] Write tests for wrong purpose/tenant/origin, expired and replayed proofs, Turnstile action/hostname/cdata failures, forbidden test keys, invalidated challenges after secret rotation, and an actual ALTCHA solve. Existing public-form proof fixtures must remain valid only for public forms.
- [ ] Run `pnpm --filter @savia/api test test/registration-captcha.test.ts`; confirm red.
- [ ] Extract shared verification with fixed server-selected bindings. Keep existing public-form wrappers backward compatible. Signup configuration always ignores `disableCaptcha`, derives the ALTCHA key with a registration-specific purpose, validates deployment credentials, and preserves the existing challenge parameters and 5-minute expiry.
- [ ] Run new and existing public-form CAPTCHA tests; assert no public-form changes in accepted token semantics.
- [ ] Commit `feat: bind registration captcha to tenant and purpose`.

### Task 5: Atomic email-registration identity provisioning

**Files:** Create `apps/api/src/tenant-registration/provisioning.ts`, `apps/api/test/email-registration-provisioning.test.ts`, `packages/db/migrations/0006_email_registration.sql`, `packages/db/postgres/0007_email_registration.sql`; modify `apps/api/src/app.ts`, `packages/db/src/core-schema.ts`, `packages/db/postgres/manifest.json`, and relevant schema/migration tests.

**Interfaces:** Authenticated `POST /_internal/email-registration` accepts `{attemptId,tenantId,subject,email,displayName,revision}` and returns `{principalId,membershipId,created}`. `DELETE /_internal/email-registration/:attemptId` cancels/compensates only that owned attempt. No client role/provider/verification values are accepted. The ledger, cancellation fence, audit rows and proof-consumption table are separate from the deployed social-provider-constrained tables.

- [ ] Write tests asserting one Viewer membership on retry, disabled current policy rejection, no foreign/admin identity transfer, two concurrent last-seat attempts yielding exactly one success, cancellation-before-insert, lost-response retry, preserved administrator upgrades, and accepted pending registrations surviving CAPTCHA secret rotation.
- [ ] Run `pnpm --filter @savia/api test test/email-registration-provisioning.test.ts`; confirm red.
- [ ] Implement idempotent batch finalization following the existing social cancellation fence and quota triggers. Store domain signup proof consumption atomically under a unique token hash; expire it after its proof/request retry window. Generate equivalent PostgreSQL metadata with the existing manifest-generation procedure; do not edit old deployed migrations.
- [ ] Run provisioning and schema/migration checks on SQLite; run PostgreSQL concurrency cases if the configured service is available and report skips explicitly.
- [ ] Commit `feat: provision verified email registrations with minimum access`.

### Task 6: Public and branded verification interfaces

**Files:** Create `apps/admin/src/features/tenant-registration/registration-page.tsx`, `registration-messages.ts`, `registration-page.test.tsx`; modify `apps/admin/src/bootstrap.tsx`, `bootstrap.test.tsx`, `apps/auth/src/login-ui.tsx` and relevant login UI tests. Extract shared widget rendering from `apps/admin/src/features/public-forms/public-form-submission.tsx` only where required.

**Interfaces:** Anonymous `/register` entry bypasses authenticated-shell OAuth startup. Consumes `GET /v1/public/registration` safe configuration, `GET /v1/public/registration/challenge` for ALTCHA, and `POST /v1/public/registration` with `{name,email,password,passwordConfirmation,captchaToken,requestId}`. Microsoft verification renders through the auth login UI and consumes Task 3 routes. Success copy is **Check your email**; verification copy is **Verify your email to continue**; local password minimum is 12 characters.

- [ ] Write UI tests for anonymous bootstrap, tenant branding, prerequisites/disabled state, password mismatch, widget expiry/reset, keyboard labels, generic success, rate-limit retry feedback, and another-browser verification guidance without a session.
- [ ] Run `pnpm --filter @savia/admin test src/features/tenant-registration/registration-page.test.tsx src/bootstrap.test.tsx`; confirm red.
- [ ] Use Impeccable on the incumbent form layout. Render name/email/password/confirmation and the effective security widget. Add the tenant-only login account-creation link when ready, never on the canonical platform/recovery pages. Reuse existing loading/errors and translation patterns; do not persist proofs in browser storage.
- [ ] Run focused tests; inspect desktop and narrow-screen forms, screen-reader labels and overflow. Keep Task 3 proof handling entirely server-side.
- [ ] Commit `feat: add branded registration and verification screens`.

### Task 7: Email signup acceptance and first password login

**Files:** Create `apps/api/src/tenant-registration/public-routes.ts`, `apps/api/test/tenant-registration.test.ts`, `apps/auth/src/email-registration.ts`, `apps/auth/test/email-registration.test.ts`; modify `apps/api/src/auth/tenant-host-guard.ts` only for reusable trusted resolution, `apps/api/src/app.ts`, `apps/auth/src/index.ts`.

**Interfaces:** Task 6 public routes resolve from the actual trusted hostname. Bridge `POST /_internal/email-registration/start` accepts the server-resolved tenant, Task 4 accepted proof/request identity, name/email/password and settings revision; auth fixes `role=user`, `emailVerified=false`, `emailTenantId`, and owned pending intent. Password session creation consumes Task 5 finalization only after native email verification and current local-registration policy validation.

- [ ] Write host spoofing/canonical host/inactive/SSO-only/disabled/unready tests, CAPTCHA replay tests, existing-address generic responses, mail delivery rollback, no pre-verification membership/session, first-login quota and policy-change tests. Assert pending status cannot be cleared by a client and Microsoft proof cannot authorize password signup.
- [ ] Run new API/auth tests and confirm red.
- [ ] Register anonymous routes before protected API middleware using current public-form conventions. Apply trusted IP and per-tenant/IP/email-hash rate limits before mail/account creation. Atomically consume CAPTCHA proofs, invoke the constrained bridge, and preserve generic success for existing addresses. Use native auth verification mail, then finalize through Task 5 before password-session creation. Keep failures recoverable and sessionless; cleanup preserves verified/completed/administratively changed accounts.
- [ ] Run both suites and integration cases crossing API/auth; assert local and federated flags act independently.
- [ ] Commit `feat: complete protected tenant email signup`.

### Task 8: Administrator UI and Workers/Docker wiring

**Files:** Create `apps/admin/src/features/tenant-registration/tenant-registration-settings-panel.tsx` and its tests; modify `apps/admin/src/features/service-credentials/studio-tenant-credentials-section.tsx` and its tests, `apps/admin/src/features/tenant-social/tenant-social-settings-panel.tsx` and messages, `apps/api/src/runtime.ts`, `apps/self-hosted/src/application.ts`, relevant Cloudflare runtime configuration and native tests; regenerate `apps/admin/src/api/generated/openapi.ts`.

**Interfaces:** Add `tab=registration` using Task 1 admin API. API receives inherited CAPTCHA options from the existing runtime public-form configuration and applies trusted tenant overrides. Native Docker uses its existing `captchaSecret` and native limiter; Workers use inherited Turnstile secrets. Microsoft settings report mail readiness and link to the tenant email tab. Preserve lazy auth/API service binding initialization.

- [ ] Write tests for workspace/tenant switching, deep links, default-off load/save, hidden-secret replacement/removal, readiness errors and email-settings links. Add native tests exercising ALTCHA without a Cloudflare account and proving signup ignores localhost bypass.
- [ ] Run admin/native tests; confirm missing UI/wiring fails.
- [ ] Implement localized admin controls and read-only Viewer/quota explanation. Wire both runtimes, tenant deletion cleanup and bounded pending/proof cleanup. Generate OpenAPI/admin types with `pnpm --filter @savia/admin generate:api`; never hand-write reference output.
- [ ] Run admin/API/auth/native typechecks, runtime/config and focused tests; inspect the settings panel and public forms together on desktop/mobile.
- [ ] Commit `feat: configure tenant registration across workers and docker`.

### Task 9: Whole-flow review, documentation, and preview delivery

**Files:** Update `docs/guides/social-sign-in.md`, add `docs/guides/tenant-user-registration.md`, update `docs/guides/self-hosted-docker.md` and `docs/README.md`; keep PR #80 title/body aligned with its final scope.

- [ ] Verify spec acceptance cases across all prior tasks, including an actual local ALTCHA solve and a genuine personal Microsoft login reaching Savia email verification. Use controlled test mail delivery to exercise proof completion, Viewer provisioning and MFA; do not mark provider-returned email verified without the new proof.
- [ ] Document exact UI fields, separate registration policies, verification/prerequisite errors, Docker defaults, and retry behavior. Remove statements that personal-account support is complete before the linking flow exists.
- [ ] Run `pnpm test`, `pnpm run typecheck`, changed-file Prettier, schema/config checks and relevant source-boundary checks. Report the known intermittent tenant-credentials heading timeout by name if it recurs; do not conceal full-suite failures behind focused reruns. Required sharded CI must pass.
- [ ] Obtain whole-branch review and resolve actionable findings. Mark PR #80 ready only when both deliverables are complete. Merge using required branch checks; retain existing preview deployment authorization.
- [ ] Verify deployed release SHA, auth/API health, settings default-off state, tenant login links, CAPTCHA readiness, generic confirmation and Microsoft verification path. Remove temporary callback URLs, test identities and diagnostic servers owned by this task. Report any unperformed real email/provider/PostgreSQL checks.
- [ ] Commit documentation and record release evidence before claiming completion.
