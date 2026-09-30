# Tenant SAML SSO implementation plan

**Goal:** Add tenant-managed SAML sign-in using Better Auth and verify the real protocol against a disposable Keycloak instance.

**Architecture:** Use the official SSO plugin, aligned with Better Auth. Savia remains the authority for tenant memberships and roles. Only preprovisioned, email-verified, active tenant users may link an SAML identity; no just-in-time user creation or role claims. Tenant admins manage their own connection through authenticated API-to-auth bridge routes. Platform administrators retain local recovery access. Optional SSO-only mode blocks tenant password sign-in and reset delivery. Public provider mutation endpoints remain unavailable.

**Runtime constraint:** Better Auth's `resolveUser` requires native transactions unavailable in D1. Use supported database hooks to constrain account linking and session creation on both runtimes, with no implicit signup. Stable provider IDs are generated server-side and rotate when the identity authority changes. Signed assertions, audience/recipient checks, request correlation, timestamps and replay protection are owned by the official plugin.

**Contract:** `GET/PUT/DELETE /v1/tenants/{tenantId}/sso-settings` proxies to `/_internal/tenant-sso/{tenantId}` with the existing bridge key. Input: `displayName`, `domain`, `idpMetadata` (XML), `enabled`, `ssoOnly`. Response: `configured` and these fields plus server-generated `providerId`, `entityId`, `acsUrl`, `metadataUrl`. The authenticated actor subject is forwarded only by the API. Keycloak uses an explicitly enabled local-test HTTP exception. Production IdP endpoints require HTTPS.

- [x] Add and align dependencies; inspect official plugin behavior and regression-test current authentication.
- [x] Implement provider configuration, strict tenant account/session hooks and SSO-only policy in auth; meaningful positive and negative tests.
- [x] Add tenant-authorized API, administration UI and login action, preserving Savia's visual system and localization.
- [x] Add disposable Keycloak fixture and real SAML HTTP integration tests, including denied unknown/cross-tenant accounts and replay.
- [x] Verify Docker and Workers compatibility, existing email flows, types, generated API and documentation; review the combined change.

**Validation:** Fresh synthetic accounts and isolated containers/volumes only. Do not modify the existing demo installation. Do not commit or deploy. Preserve the working tree's prior changes.

## Verification results

- Auth Workers/D1 suite: 74 tests passed across 8 files, including email regressions, SSO policy and late-session insertion protection.
- Focused tenant SSO/lifecycle API suites: 20 tests passed; tenant SSO UI: 2 tests passed.
- TypeScript checks passed for auth, API, admin and self-hosted.
- Real Keycloak smoke passed in native SQLite and the self-hosted Docker image: signed assertion, MFA, OAuth code redemption, tamper/replay/unknown/cross-tenant denial, pending challenge invalidation, SSO-only enforcement and administrator recovery.
- PostgreSQL auth and auth-notice regressions: 2 tests passed. This is runtime compatibility evidence, not a PostgreSQL SAML end-to-end run.
- Targeted formatting and diff whitespace checks passed; final auth security review found no actionable blocker.
- Browser visual review remains unverified because the available browser blocked localhost.
- A broader API run was interrupted after reporting failures in public forms, solution packages and access-control parity outside these focused suites. No claim that the entire repository suite passes.
