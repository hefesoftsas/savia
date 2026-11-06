# Tenant registration and verified Microsoft personal sign-in

Status: Approved by the user on September 30, 2026; implementation plan approved; direct execution in progress.

## Intent and accepted requirements

A tenant administrator can independently enable public registration with email and password. This is separate from Google/Microsoft federated registration. Cloudflare deployments use Turnstile; self-hosted Docker uses the free, locally verified ALTCHA implementation already present in Savia. Registration and CAPTCHA configuration must be manageable from the administration UI.

Registration defaults to off for every tenant, including existing tenants. Accounts created through this flow receive only the Viewer tenant role. New email/password accounts must verify their email before any session or active membership is issued. The previous one-time verification of existing preview accounts does not automatically verify future registrations.

## Approach

Add a dedicated tenant registration settings surface and an anonymous registration page. Reuse Savia's internal account-creation and email-verification flow, encrypted credential storage conventions, CAPTCHA implementations, and minimum-role identity provisioning safeguards.

Keep Better Auth's generic public email signup endpoint disabled. A new public registration endpoint validates tenant routing, current policy, CAPTCHA, and abuse limits before invoking a restricted internal auth operation. Do not expose the existing administrative user-creation API anonymously.

Provider selection follows the deployment: Turnstile on Cloudflare, ALTCHA on Docker. Tenant settings can inherit deployment credentials or store a Turnstile site key and encrypted secret override through the UI. Docker uses its existing server-managed CAPTCHA secret with registration-specific key separation; users do not need an external CAPTCHA account.

A deployment-only CAPTCHA configuration with only the registration switch in the UI would be smaller, but would not fulfill the requested UI configuration of the protection. Per-tenant settings with inherited defaults provide that configuration while allowing existing deployments to work without entering the same credentials repeatedly.

## Administrator UI

Add a **User registration** tab to Service credentials, scoped to the selected tenant and addressable by `tenantId` and `tab=registration`. Preserve the existing tabs and form styling.

The tab contains:

- An off-by-default **Allow registration with email and password** switch, independent of the federated registration switch.
- A fixed **Initial access: Viewer** explanation and the existing tenant user-limit context.
- The effective CAPTCHA provider and readiness state.
- On Cloudflare, inherited/tenant credentials selection, a site-key field, and a secret replacement field. Responses expose only whether the secret is configured. Blank secret input preserves an existing secret; explicit removal clears the override.
- On Docker, the ALTCHA readiness state, with server-managed configuration and no paid-service credentials.
- Email delivery readiness and a link to the existing tenant email-delivery tab. Administrators must configure working delivery before enabling public registration.
- Save, loading, validation, error, and saved states, localized in English and Spanish.

Only an active platform administrator or active tenant administrator may read or change settings. Cross-tenant access is denied. Deleting settings resets registration to off and removes tenant credential overrides. Tenant deletion removes registration settings and owned registration state.

## Public UI

Show **Create an account** on a dedicated tenant login page only when registration is enabled and its prerequisites are ready. Do not offer tenant registration on the main platform login or recovery-only screens.

Use an anonymous frontend entry following the existing public-form routing pattern, outside the authenticated admin shell. It must not start an admin OAuth redirect before rendering. The server resolves the tenant from the actual request hostname; query parameters and body fields cannot choose the target tenant.

The page uses incumbent tenant branding and contains name, email, password, password confirmation, the CAPTCHA, and **Create account**. Password requirements match the existing minimum of 12 characters. The security widget and form remain usable on narrow screens and with keyboard/screen-reader navigation.

After acceptance, show a generic **Check your email** confirmation. After verification, the user returns to their tenant login and starts a fresh authorization flow. Return URLs are built from validated tenant routing rather than arbitrary browser input or expired OAuth query strings.

## Registration and verification flow

1. Resolve an active tenant from the trusted hostname and read its current registration and SSO policies. Reject canonical platform hosts, inactive tenants, disabled registration, and SSO-only tenants.
2. Read effective CAPTCHA and email-delivery readiness. A missing or invalid configuration fails closed. Public responses expose only safe configuration needed by the widget.
3. Validate allowlisted form fields and current user capacity. Enforce backend abuse limits before delivering email or creating an account.
4. Verify CAPTCHA server-side, including expiration, action, hostname/origin and tenant binding. Persist an atomic proof-consumption marker to prevent replay. A public-form proof must never be valid for registration.
5. Invoke a bridge-authenticated internal auth operation that fixes `role=user`, the trusted tenant, and `emailVerified=false`. It stores a server-owned pending-registration identifier and sends the existing verification email. Client-supplied tenant IDs, roles, verification flags, and redirects are ignored or rejected.
6. Before verification, the account has no usable session and no active tenant membership. Pending state does not consume an active-user seat. Existing accounts, foreign tenant identities, administrator accounts, and memberships are never linked, transferred, or changed by registration.
7. On the first valid password sign-in after native email verification, recheck current tenant registration/SSO policy and the server-owned pending intent. Finalize an active Viewer identity membership before issuing any session. Enforce the active-user limit atomically, including concurrent last-seat attempts.
8. Clear pending status only after idempotent finalization succeeds. Failure leaves no session and a recoverable pending account. Repeated requests must not grant additional roles or duplicate users/memberships.

An administrator disabling registration prevents new submissions and pending first-login finalization. It does not delete previously completed accounts or memberships. CAPTCHA credential changes invalidate outstanding CAPTCHA challenges while preserving accounts that already passed registration checks.

## Microsoft personal accounts and email ownership

The separately approved tenant option **Allow personal Microsoft accounts** remains off by default. Microsoft OAuth uses `common`; the Entra application uses `AzureADandPersonalMicrosoftAccount` and access-token version 2. The configured organizational directory UUID continues to restrict work/school identities. The personal option admits only Microsoft’s consumer directory, never arbitrary organizational directories.

A live diagnostic against the configured application on September 30, 2026 verified a genuine personal-account token signature, audience, issuer, nonce, and immutable subject. The token supplied an email but no `email_verified` signal or exact verified-primary/secondary-email match. Therefore the policy switch alone does not provide a usable first personal sign-in under Savia’s existing verified-email gate. The candidate policy/UI change in PR #80 passed all 17 required CI checks, but remains unmerged and undeployed until this flow is implemented.

The implementation must obtain separate Savia proof of email ownership instead of trusting the reported Microsoft address. Keep the accepted provider-verification path for Google and Microsoft tokens that do carry exact-email proof.

### First personal sign-in

1. Resolve the tenant through the trusted login-host bridge before starting OAuth, including when federated registration is off. Bind the attempt to the tenant, provider, policy revision, validated return origin, and an HttpOnly browser nonce. Client headers, tenant IDs, arbitrary return URLs, or additional OAuth parameters cannot create this trusted context.
2. Verify the Microsoft OAuth response using the existing provider signature, audience, issuer, PKCE, state, nonce, consumer-directory and immutable-subject checks. When the exact email remains unverified, create a short-lived backend verification intent rather than creating a Better Auth user, linked account, membership, or usable session. Discard raw provider tokens after validation; retain only the validated identity fields and their server-owned binding.
3. Show **Verify your email to continue** in the branded tenant flow. The provider email can prefill the address but is not trusted. Send a Savia verification message through the configured tenant delivery service. Enforce tenant/IP/address resend limits and generic responses that do not reveal existing accounts. Email verification remains available to eligible precreated users even when both local and federated registration are off.
4. The verification link is single-use, expires after 15 minutes, and binds to the OAuth intent, normalized address, tenant, consumer subject, and original browser nonce. The intent expires after 20 minutes. Verification in another browser instructs the user to return to the original sign-in browser; it does not issue a session elsewhere. Consume proofs atomically before finalization and reject expired, replayed, changed-policy, changed-email, wrong-browser, wrong-origin, or wrong-tenant attempts.
5. With a verified address, resolve an eligible existing tenant user or create a new one only when **federated registration** is currently enabled. Local email/password registration is independent and must not authorize social account creation. Preserve the existing rejection of foreign-tenant, inactive, banned, and platform-administrator identities. New members receive exactly Viewer and require atomic quota enforcement and ownership-safe compensation.
6. Bind the validated Microsoft immutable subject to the verified Savia user only after both proofs succeed. An existing subject bound to another user is a hard conflict; verification never transfers provider accounts. Once linked, resolve future personal sign-ins from the stored provider subject and current tenant policy, preserving the local verified email rather than relinking from a mutable provider email. Explicit provider email-verification evidence is not required again for that already-proven binding. Disabling the personal option prevents these sign-ins.
7. Existing Savia MFA must complete before a usable session, including the first linking flow. Reuse the signed two-factor challenge and social proof marker; recheck the current tenant policy and proof revision on completion. A successful email link returns to a fresh tenant authorization flow rather than reusing expired application OAuth parameters.

No generic anonymous account-linking endpoint is opened. The new verification and finalization routes form a constrained auth plugin that uses the existing account/session hooks, fixed tenant ownership, and signed MFA challenges. Readiness for personal sign-in must report tenant email-delivery availability; administrators get a link to configure delivery. If email delivery is unavailable, the flow fails with actionable guidance and no new account/session.

The shared pending-intent storage and mail delivery can serve both registration flows, with distinct server-selected purposes. Password registration must never consume a Microsoft linking proof, and a Microsoft linking proof must never authorize password creation or recovery. Audit only nonsecret outcome/intent metadata. Cleanup must preserve completed accounts and administrative changes.

Supporting provider references: [Microsoft ID-token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference), [optional claims](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference), and [UserInfo limitations](https://learn.microsoft.com/en-us/entra/identity-platform/userinfo).

## CAPTCHA reuse and boundaries

Generalize the existing CAPTCHA implementation around a fixed server-selected purpose and subject binding, retaining backward-compatible public-form wrappers. Registration uses `tenant_signup`; public forms keep `public_submit`. Turnstile validates success, action, hostname, and tenant-specific custom data. ALTCHA signs the same purpose, trusted origin, tenant binding, nonce, and expiry.

Do not honor a CAPTCHA-disable option for this public signup flow, including Docker localhost. Production accepts neither test keys nor unauthenticated client overrides. Token hashes and consumption state remain backend-owned; raw proof tokens, passwords, email-verification tokens, and secrets do not enter audit logs or browser persistence.

Turnstile requires server-side validation and provides expiring, single-use tokens: [Cloudflare validation documentation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/). ALTCHA's free self-hosted core uses locally verified proof of work: [ALTCHA documentation](https://altcha.org/docs/).

## Persistence and service boundaries

Auth owns tenant registration settings, encrypted CAPTCHA overrides, pending auth-account state, and verification email delivery. API owns anonymous request/proof consumption, abuse controls, identity membership finalization, cancellation guards, and audit evidence. Only authenticated service bindings cross the boundary.

Reuse the existing federated provisioning pattern for idempotency, fixed Viewer creation, quota enforcement, ownership-safe cleanup, and serialized cancellation. Extract shared implementation where needed without changing existing federated policies or rebuilding its deployed tables. Email registration gets its own source-specific ledger/schema where the social provider constraint cannot safely be reused.

New persistence has equivalent SQLite/D1 and PostgreSQL migrations and generated PostgreSQL metadata. Stale anonymous proof/request state and expired pending intents have bounded expiry and cleanup. Cleanup only deletes unverified accounts still owned by that intent; administrative edits or completed memberships are preserved.

Use existing trusted client-IP handling and backend rate limiting. Limit submissions and verification resends per tenant/IP and normalized email hash, return generic responses for existing addresses, and provide retry feedback for rate limits. Do not use CAPTCHA as a substitute for verified email or user-capacity enforcement.

## Runtime and delivery

Cloudflare inherits existing deployment Turnstile credentials by default. Docker inherits the existing ALTCHA secret and native backend limiter. Configure overrides through the UI, encrypt them at rest, and return readiness indicators rather than secret values. Registration must work without a Cloudflare account in Docker.

Public and internal routes must be wired in both Workers and the native application. Preserve service-binding bootstrap ordering. Generate OpenAPI/admin types rather than writing API reference manually. Update the registration, authentication, and Docker guides.

The existing authorization to deploy this work to preview remains applicable. Keep all tenants opted out after deployment until an administrator saves registration on. Do not deploy production.

## Acceptance and verification

- Legacy tenants default to registration off; enabled and disabled settings persist independently of federated registration.
- Authorized UI configuration saves correctly, preserves hidden secrets, and rejects cross-tenant access.
- Disabled/unready/SSO-only tenants do not expose usable signup or accept direct endpoint submissions.
- Missing, forged, expired, replayed, wrong-origin, wrong-tenant, or public-form CAPTCHA proofs create no account.
- Both Turnstile verification fixtures and a genuine local ALTCHA solve exercise the backend path.
- New accounts remain unverified and sessionless until email verification; existing preview accounts are unchanged.
- A verified first password login creates exactly one Viewer membership, no global/admin/custom grants, and respects capacity under concurrency.
- Existing/foreign/admin identities are preserved; lost responses, mail failures, retries, cancellation races, and administrative account changes do not create usable orphan identities.
- Registration page and admin settings are checked together on desktop and mobile; errors, missing prerequisites, loading, and email-confirmation states are covered.
- A genuine Microsoft personal token without email-verification claims reaches Savia verification, never automatic account creation or linking. First linking, later subject-based sign-in, provider-email changes, MFA, disabled policies, conflicts, proof replay, foreign tenants, and mail failures have integration coverage.
- Relevant auth/API/admin/native tests, typechecks, schema/config checks, source safety, and required CI pass before merge. Preview health and release SHA match the tested commit. Record any unavailable live PostgreSQL or external provider checks explicitly.
