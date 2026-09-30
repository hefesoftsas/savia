# Google and Microsoft sign-in

Savia can let existing tenant members sign in with Google or Microsoft. Provider credentials are deployment-wide; each tenant separately chooses which configured provider its members may use. Tenant login pages display deployment-configured providers; Savia enforces tenant eligibility after the provider identifies the user. By default, an administrator must precreate users and tenant memberships. A tenant can enable self-registration to create new users with Viewer membership on their first verified provider sign-in. Social sign-in never provides platform-administrator access.

The main platform login (including the plain localhost Docker origin) offers only local email/password access and recovery: it renders no federated provider controls or SSO discovery form. Members use their dedicated tenant hostname for optional federated access.

The tenant login screen places compact Google and Microsoft buttons below the email and password form, followed by a smaller organization SSO action. Provider buttons and their divider disappear when no providers are configured or when a recovery, verification, or SSO panel is open. Provider marks are decorative; the full button labels provide accessible names.

## Register provider applications

Register Savia as a confidential web application with [Google Cloud](https://developers.google.com/identity/protocols/oauth2/web-server) or [Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app?tabs=client-secret). Use the callback URL shown in **Settings → Service credentials → Google / Microsoft** for each provider. The callback must use the same public origin configured as `BETTER_AUTH_URL` and end in one of these paths:

```text
{BETTER_AUTH_URL}/api/auth/callback/google
{BETTER_AUTH_URL}/api/auth/callback/microsoft
```

For a local run, register the exact localhost URL shown by the running Savia instance. For self-hosted Docker, use the public origin from `SAVIA_PUBLIC_ORIGIN` (for example `http://localhost:8080` for a local-only installation). For a Cloudflare Worker, use the deployed public origin. Google and Microsoft treat each origin and callback URI as an exact registration; add each development, test, and production callback that you use.

Configure the Google OAuth consent screen and a Web application client. Configure a Microsoft Entra application registration with a Web redirect URI. To support personal accounts, select **Accounts in any organizational directory and personal Microsoft accounts** (`AzureADandPersonalMicrosoftAccount`). Savia uses Microsoft’s `common` authority, validates the provider token, and applies each tenant’s account policy after authentication. Organizational accounts must match the configured directory ID; personal accounts require the independent tenant opt-in described below.

Savia requests identity scopes only: OpenID Connect sign-in, basic profile, and email. It does not request Google Drive, Microsoft Graph `User.Read`, files, mail, or offline refresh-token access. Save each provider's client ID and client secret as deployment secrets using the names below. Keep secrets out of source control, frontend variables, and tenant settings.

## Configure deployment credentials

Both values for a provider must be present. A provider is available only when its complete credential pair is configured. A partial pair fails authentication-service startup. Leaving both pairs unset disables social sign-in.

```text
SAVIA_GOOGLE_CLIENT_ID=...
SAVIA_GOOGLE_CLIENT_SECRET=...
SAVIA_MICROSOFT_CLIENT_ID=...
SAVIA_MICROSOFT_CLIENT_SECRET=...
```

For a local Wrangler run, put the values in the ignored `apps/auth/.dev.vars` file. For self-hosted Docker, add them to the configured environment file, which defaults to `infra/secrets/self-hosted.env`; Compose forwards these values to the Savia runtime. For Cloudflare deployments, add each configured value as a GitHub Actions environment secret named exactly as above to both the `preview` and `production` environments. The deployment workflow uploads configured values to that environment's auth Worker. Each provider is optional; if both values are absent, sign-in with that provider stays disabled. A partial pair stops the deployment before any Worker secrets are uploaded. Keep client secrets out of `wrangler.jsonc` vars.

On upgraded self-hosted PostgreSQL installations, startup makes the legacy `savia_auth.account.issuer` column nullable when it still has a `NOT NULL` constraint. This preserves existing account rows and issuer values while allowing the current Better Auth schema to start.

Restart or redeploy the auth service after changing deployment credentials. The tenant settings page shows whether each provider is available and displays the callback URL to register.

## Enable sign-in for a tenant

Open **Settings → Service credentials → Google / Microsoft** for the tenant. Select Google, Microsoft, or both, then save. A Microsoft connection also requires the tenant's Microsoft Entra directory tenant ID as a UUID. The ID is the `tid` value for the organization's directory; it is not the application/client ID.

The Microsoft section also includes **Allow personal Microsoft accounts**, off by default. Enable it to admit personal Outlook/Hotmail/Microsoft accounts in addition to the configured organizational directory. The directory UUID still identifies the allowed work/school directory; do not replace it with `common`, `consumers`, or the Microsoft consumer directory UUID. This option does not enable user registration. When federated registration remains off, personal accounts must already have an eligible verified Savia user and membership. Turning the option off invalidates prior social challenges and revokes existing tenant sessions, like other social policy changes.

Platform administrators can use **Tenants → Edit tenant → Sign-in methods → Configure Google / Microsoft** to open this tab with the tenant already selected. The tenant-scoped **Users** list also provides **Sign-in settings**, from which the Google / Microsoft tab is available. If the credentials page currently shows the platform workspace, select a tenant in **Workspace** to reveal the tenant sign-in tabs. These controls configure provider opt-in; deployment credentials are still required before a provider becomes available.

Provider availability and tenant opt-in are separate settings. Configuring credentials makes a provider available to Savia, but does not enable it for every tenant. Saving a change invalidates that tenant's existing sessions so the new policy applies on the next request. Public provider discovery currently reflects deployment credentials because it has no trusted tenant context; it does not reveal tenant settings or identify whether an account exists. The callback checks the matched user's actual tenant policy and rejects sign-in when the provider is disabled, the tenant is inactive, or SSO-only mode is enabled. Tenant-specific provider discovery requires the trusted host-routing layer to pass a resolved tenant context to auth.

The same settings page includes **Create new users through federated sign-in**. It is off by default, including for tenants with existing social sign-in settings. When it is off, an administrator must create a user's account and tenant membership before federated sign-in. When it is on, a person with an exact, provider-verified email can join through a provider enabled for that tenant. New members receive the fixed minimum role, **Viewer**; this setting never grants administrator or custom role access. Registration is subject to the tenant's user limit. Google and Microsoft provider opt-ins remain independent, and Microsoft registration requires either a verified organizational identity from the configured Entra directory or an explicitly allowed personal Microsoft account. SSO-only tenants cannot register with social sign-in.

Each registration attempt is bound to the initiating tenant host and return origin and consumed atomically before creating an account. A failed finalization never issues a session. Cancellation is persisted and serialized with finalization so a delayed response cannot create an orphan membership after cleanup. Compensation removes only the attempt-owned Viewer membership and new account; if the identity bridge is unavailable, the new account is blocked pending administrator reconciliation. Administratively changed memberships are preserved.

Turning registration off prevents future self-registration but keeps accounts and memberships that were already created. Removing the tenant's social sign-in settings also resets registration to off.

## Account and security policy

For existing accounts, social sign-in requires a verified email, an active membership in an active tenant, and a provider enabled in that tenant's settings. Savia matches the exact verified provider email to the existing user and preserves that user's role and tenant policy. When tenant self-registration is enabled, the callback may instead create a new user and Viewer membership after validating the tenant context, provider verification, tenant policy, and available user capacity. It never transfers a user from another tenant or changes platform-administrator access. Platform administrators must use local recovery sign-in. Tenant SSO-only mode blocks social sign-in; use that tenant's configured SAML connection instead. If Savia MFA is enabled for an existing user, the social callback sends the user through Savia's MFA challenge before creating a session.

The provider must supply an email-verification signal Savia accepts. A Microsoft `email` or `preferred_username` claim by itself is not proof that the exact address was verified. Savia accepts Microsoft's `email_verified` claim or an exact match in `verified_primary_email` or `verified_secondary_email`; organizational tokens without one of these signals fail closed. Personal Microsoft accounts without such claims must instead complete Savia email verification in the original browser. The link expires in 15 minutes and the OAuth intent in 20 minutes; no user, membership or session is created before proof. Microsoft's [`xms_edov` claim](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference) only confirms that the email domain is verified by its owner, so Savia does not treat it as proof of the individual email address. Microsoft also cautions that `email` is mutable and not guaranteed to be correct for authorization decisions ([ID token claims reference](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)). Configure the Entra token to provide an accepted exact-email verification claim. For personal accounts, configure tenant email delivery before enabling sign-in. Existing eligible members can verify with registration off; new members require the separate federated registration opt-in and receive Viewer. After linking, Savia resolves the immutable Microsoft subject and preserves the verified local email. MFA still applies. Configure the application audience as `AzureADandPersonalMicrosoftAccount` and `api.requestedAccessTokenVersion` as `2`.

## Testing and limits

Automated tests cover configuration, callback policy, tenant isolation, account eligibility, and MFA handling without contacting Google or Microsoft. A live provider sign-in requires real OAuth credentials, the registered callback URL, and either an eligible pre-existing Savia tenant membership or tenant self-registration enabled. Local tests cannot verify provider consent, claim configuration, or the external login flow without those credentials.
