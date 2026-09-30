# Tenant email registration

Email/password registration is off by default and independent of **Create new users through federated sign-in**. With either option off, an administrator must precreate users for that method. Completed accounts keep their access when registration is later disabled; pending first sign-ins are rejected.

Open **Settings → Service credentials → User registration** for the selected tenant, or use `/#/service-credentials?tenantId=4&tab=registration`. Configure account email delivery in the tenant's **Email** tab first. Registration is unavailable for inactive tenants, SSO-only tenants, or deployments with missing email, CAPTCHA, or abuse-limiter configuration.

## Cloudflare Turnstile

Cloudflare deployments inherit the existing Turnstile deployment keys. Administrators can instead select tenant credentials and save a real site key and secret key. Save credentials while registration is off, then enable registration when readiness is confirmed. Register the tenant hostname with the Cloudflare widget. Local bypass flags and Cloudflare test keys cannot enable registration.

Secrets are encrypted on the auth backend, bound to the tenant and a dedicated encryption purpose. The UI shows only whether a secret exists. An empty secret preserves the saved value; the explicit removal control clears it. Changing CAPTCHA credentials invalidates unsent challenges while preserving accounts that already passed the registration checks.

The backend validates Turnstile through Siteverify and checks the request hostname, `tenant_signup` action and tenant identifier. Tokens are single-use and expire after five minutes. See [Cloudflare validation documentation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

## Docker ALTCHA

Docker uses the bundled open-source ALTCHA widget, a server-managed secret and the native abuse limiter. No Cloudflare account or external CAPTCHA service is needed. The same settings tab shows ALTCHA readiness and controls registration; the server secret is never returned to the browser. Keep the existing `captchaSecret` stable across restarts. See [self-hosted Docker](self-hosted-docker.md) for deployment configuration.

Challenges expire after five minutes and are bound to the trusted tenant hostname, tenant ID and registration purpose. Public-form challenges cannot authorize signup. Proof/request state expires after one hour and is cleaned in bounded batches. Identical retries after an uncertain service response reuse the durable accepted proof instead of consuming a single-use challenge again.

## Account lifecycle

Visitors open `/register` on their tenant hostname, enter their name, email and a password of 12–128 characters, confirm it and complete CAPTCHA. The canonical Savia hostname does not allow registration. Caller-supplied tenant, role, verification and redirect values are rejected.

A successful submission displays the same email confirmation for new and existing addresses. New accounts start unverified with the authentication role `user`, no session and no tenant membership. Existing accounts are neither modified nor given a new membership. The native email verification link lasts 15 minutes; verification alone does not create a session.

On the first verified password sign-in, Savia rechecks the current registration revision, tenant activity and SSO policy, then atomically creates a **Viewer** membership under the tenant's active-user quota. A quota or service failure issues no session and leaves the pending account recoverable. Existing MFA requirements still apply. Finalization is idempotent and clients cannot select additional permissions.

Unverified pending password accounts expire after 24 hours. Bounded cleanup removes only unchanged, unverified accounts owned by the registration attempt. Completed accounts and administrative edits are preserved. Verified pending accounts retain their ownership guard and can complete a later first login under the unchanged current policy. Administratively changed pending users require administrator assistance; cleanup cannot implicitly grant access. Disabling registration prevents pending finalization even after email verification.

Personal Microsoft accounts use a separate browser-bound email-ownership proof when Microsoft does not attest a verified address. That flow requires the tenant's personal-account option and, for new users, the federated-registration option. It cannot authorize password creation or password recovery. See [social sign-in](social-sign-in.md).
