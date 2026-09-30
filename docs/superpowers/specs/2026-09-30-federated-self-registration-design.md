# Tenant federated self-registration

Status: approved by the user on 2026-09-30. This document does not enable registration.

## Outcome

Tenant administrators can optionally let people with verified Google or
Microsoft identities join their tenant at first sign-in. They do not need to
create those users manually. New users receive the minimum existing membership
role, `viewer`, with no administrative or custom access assignments.

The existing preview accounts were corrected separately: all five current
authentication users are now email-verified. This is a one-time administrative
correction; future federated identities still need provider verification.

## Product behavior

Add **Allow new users to join through federated sign-in** under the Google and
Microsoft settings. Default to off for existing and new tenants. Explain that
enabling it lets any provider-verified email join this space using an enabled
provider, subject to the provider restrictions and the tenant's user capacity.

Show **Initial access: Viewer** as a fixed value. This grants the platform's
existing minimum role, including permitted shared read access, and no editing,
user administration, service settings, or custom role assignments. Do not offer
an initial administrator role. Preserve current permissions for existing users.

Turning the option off prevents further registrations and does not delete
members who already joined. Google and Microsoft opt-in remain separate. SAML
SSO behavior and Microsoft personal-account support are outside this change:
Microsoft continues to require an organizational identity from the configured
Entra directory. An SSO-only tenant cannot self-register using social login.

The form uses the incumbent layout and typography. Place the registration
switch after the provider settings, with the initial role and concise helper
text. Include localized success and failure messages, keyboard-accessible
controls, and responsive layout. Update the social sign-in guide.

## Trusted tenant context

The public tenant hostname determines the intended tenant. The API gateway
resolves that hostname to an active tenant and overwrites client-supplied
context headers before passing context through the authenticated internal
bridge. Canonical platform login cannot register users into a tenant.

At social authorization start, store an opaque server-side attempt containing
the resolved tenant, provider, settings revision, expiry, and return origin.
Bind that attempt to the OAuth transaction; carry only an opaque reference
through the callback. OAuth state and PKCE verification remain mandatory.

The callback must recheck the attempt, host binding, active tenant, provider
opt-in, registration flag, settings revision, and provider identity. Never use
a browser-supplied tenant ID, callback query value, email domain, or role claim
as tenant authorization. Open registration is intentional when this setting
is enabled; an email-domain allowlist is not part of this option.

## Account handling

For existing users, retain exact verified-email linking and existing tenant
policy. Do not transfer a user from another tenant, reactivate banned or
inactive users, elevate roles, or change platform administrator access.

For a new user, accept only the provider's verified exact email. Microsoft must
also satisfy the configured directory check. Build the user with auth role
`user` and the resolved tenant ID; the trusted provider proof marks the email
verified. Never create a password from OAuth data or accept client role claims.

Replace unconditional social signup rejection with a callback-scoped,
validated registration proof. Keep local email/password public signup disabled.
No social account or session creation is allowed without the proof. Existing
MFA hooks, proof revision checks, and tenant-activity checks remain in force.

## Provisioning across services

Authentication and tenant identity live in separate databases. Implement an
idempotent provisioning operation keyed by OAuth attempt and auth subject.
Reuse principal creation, identity email uniqueness checks, active tenant
validation, capacity preflight, and the database-enforced membership limit.
Create a `viewer` membership without global or custom access assignments.

Do not reuse membership transfer as registration: a conflicting existing
principal or membership must reject the operation. Concurrent callbacks must
resolve to one account and one membership. The capacity trigger is authoritative
when simultaneous registrations consume the last available seat.

Do not issue an application session, authorization code, or tenant access until
membership finalization succeeds. On failure, compensate newly created auth
accounts and principals, revoke pending sessions, and retain enough operation
state for safe cleanup or retry. Never delete pre-existing accounts as rollback.
Audit successful registration and policy/capacity failures without tokens or
secrets. Policy updates invalidate pending attempts through revision checks.

## Validation

- Registration disabled rejects unknown users without writing accounts.
- Enabled registration creates exactly one verified user and viewer membership.
- Tampered, expired, replayed, canonical-host, and cross-tenant attempts fail.
- Disabled providers, inactive tenants, SSO-only policy, invalid email proof,
  Microsoft directory mismatch, and banned accounts fail closed.
- Existing members retain their roles; foreign-tenant users are never moved.
- Concurrent first login and quota races cannot duplicate or exceed capacity.
- Partial provisioning failures cannot issue sessions and can be retried safely.
- Settings persist through the API and migrations default registration to off.
- UI is checked at desktop and mobile sizes with localized copy and keyboard use.
- Preview smoke test covers both existing-account login and new-account login;
  real provider interaction requires the user to complete provider authentication.

## Implementation boundaries

Auth: social settings schema/migrations, OAuth attempt binding, validated signup
proof, account/session hooks, and callback error handling. API: trusted tenant
context, internal registration finalization, identity/capacity/audit primitives,
and generated OpenAPI settings schema. Admin: API client types, settings form,
locales, and focused regression tests. Deploy and verify preview after review;
do not activate registration for any tenant as a migration side effect.
