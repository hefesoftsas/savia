# Account email delivery

## Verification and password recovery

New password accounts require email verification by default. Creating an account sends a Better Auth verification link; signing in is blocked until the link is consumed. The login screen offers **Forgot your password?** only when an email transport is configured for that access (tenant SMTP or the global fallback). Without email delivery, the recovery link and form are omitted, including on direct recovery URLs. This checks configuration, not live SMTP reachability. A verification-email resend action is also available. Public recovery and resend responses use the same confirmation for known and unknown addresses.

The administrator can explicitly enable **Email verified** when creating or editing a user, including the initial user of a new tenant, after confirming ownership through another channel. The bootstrap administrator remains verified to preserve initial access. Existing ordinary accounts retain their stored verification state; they are not silently marked verified.

Password recovery uses Better Auth's request/reset endpoints. Links expire after 15 minutes, can be used once, and lead to `/auth/reset-password`. Passwords require at least 12 characters. A completed reset revokes existing sessions. Accounts created without a temporary password receive a password setup link as well as their verification message. Provisioning fails and removes the newly created account when the required verification message cannot be sent.

## Tenant SMTP

Savia sends account messages such as password resets and email verification through SMTP. A tenant can save its own SMTP connection from **Service credentials → Tenant email delivery**. Only platform administrators and administrators of that tenant can read or change these settings.

Tenant SMTP settings are stored in the auth database as AES-GCM ciphertext, with the tenant ID authenticated as encryption context. The API never receives the saved password back: responses include `passwordConfigured`, while leaving the password field empty on save retains the current password. Send a test message to the signed-in administrator's account email to confirm delivery. Removing tenant settings returns account mail to the global SMTP configuration.

Tenant SMTP connections require TLS or STARTTLS, a valid sender address, and a public host. Loopback, private, link-local and internal hostnames are rejected. Account email uses the tenant associated with the authenticated account; the test-email action cannot choose a recipient.

## Local Mailpit

The default compose stack includes Mailpit. Its SMTP listener is available to the host at `127.0.0.1:1025`, and its inbox UI at `http://127.0.0.1:8025`. From the Savia dev container, use the compose service hostname `mailpit` for the SMTP host.

Run `pnpm dev:mail` to start Mailpit, then `pnpm dev`. The local launcher defaults to Mailpit at `127.0.0.1:1025` unless `SAVIA_SMTP_HOST` is configured. Open the inbox at `http://127.0.0.1:8025`; no mail leaves the local simulator.

For local account-message testing, set:

```dotenv
SAVIA_SMTP_HOST=mailpit
SAVIA_SMTP_PORT=1025
SAVIA_SMTP_SECURITY=plain
SAVIA_SMTP_ALLOW_INSECURE=true
SAVIA_SMTP_FROM=savia@example.test
```

Username and password can be omitted for Mailpit. `SAVIA_SMTP_ALLOW_INSECURE=true` explicitly permits unencrypted SMTP for local development. Do not use that mode for a tenant's saved SMTP connection or production mail. To test tenant-level SMTP configuration, use a public test SMTP service with TLS or STARTTLS.

Run `pnpm --filter @savia/self-hosted test:email` with Mailpit running for a disposable end-to-end check. It creates isolated temporary databases, checks actual SMTP delivery, verifies the sign-in gate and email link, resets a password, rejects token replay, and checks session revocation. It removes its temporary databases on exit and leaves captured test messages in Mailpit.

## API

The authenticated API exposes `GET`, `PUT` and `DELETE /v1/tenants/{tenantId}/email-settings`, plus `POST /v1/tenants/{tenantId}/email-settings/test`. The API authorizes the tenant administrator, then forwards the request to the auth worker over the bridge-key protected internal route. The auth worker owns encrypted settings and selects them for account mail when the account's tenant matches; otherwise it uses the global SMTP sender.
