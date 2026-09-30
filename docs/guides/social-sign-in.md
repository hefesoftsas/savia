# Google and Microsoft sign-in

Savia can let existing tenant members sign in with Google or Microsoft. Provider credentials are deployment-wide; each tenant separately chooses which configured provider its members may use. Tenant login pages display deployment-configured providers; Savia enforces tenant eligibility after the provider identifies the user. Social sign-in does not create users, add tenant memberships, or provide platform-administrator access.

The main platform login (including the plain localhost Docker origin) offers only local email/password access and recovery: it renders no federated provider controls or SSO discovery form. Members use their dedicated tenant hostname for optional federated access.

The tenant login screen places compact Google and Microsoft buttons below the email and password form, followed by a smaller organization SSO action. Provider buttons and their divider disappear when no providers are configured or when a recovery, verification, or SSO panel is open. Provider marks are decorative; the full button labels provide accessible names.

## Register provider applications

Register Savia as a confidential web application with [Google Cloud](https://developers.google.com/identity/protocols/oauth2/web-server) or [Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app?tabs=client-secret). Use the callback URL shown in **Settings → Service credentials → Google / Microsoft** for each provider. The callback must use the same public origin configured as `BETTER_AUTH_URL` and end in one of these paths:

```text
{BETTER_AUTH_URL}/api/auth/callback/google
{BETTER_AUTH_URL}/api/auth/callback/microsoft
```

For a local run, register the exact localhost URL shown by the running Savia instance. For self-hosted Docker, use the public origin from `SAVIA_PUBLIC_ORIGIN` (for example `http://localhost:8080` for a local-only installation). For a Cloudflare Worker, use the deployed public origin. Google and Microsoft treat each origin and callback URI as an exact registration; add each development, test, and production callback that you use.

Configure the Google OAuth consent screen and a Web application client. Configure a Microsoft Entra application registration for organizational accounts and a Web redirect URI. Savia uses Microsoft’s `organizations` authority and checks that the verified token's `tid` matches the directory ID entered for the tenant. Personal Microsoft accounts are not supported.

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

Provider availability and tenant opt-in are separate settings. Configuring credentials makes a provider available to Savia, but does not enable it for every tenant. Saving a change invalidates that tenant's existing sessions so the new policy applies on the next request. Public provider discovery currently reflects deployment credentials because it has no trusted tenant context; it does not reveal tenant settings or identify whether an account exists. The callback checks the matched user's actual tenant policy and rejects sign-in when the provider is disabled, the tenant is inactive, or SSO-only mode is enabled. Tenant-specific provider discovery requires the trusted host-routing layer to pass a resolved tenant context to auth.

## Account and security policy

Social sign-in is limited to users who already exist in Savia with a verified email, are active members of an active tenant, and have an enabled provider in that tenant's settings. Savia matches the verified provider email to the existing user and does not create a user or membership from a provider response. Platform administrators must use local recovery sign-in. Tenant SSO-only mode blocks social sign-in; use that tenant's configured SAML connection instead. If Savia MFA is enabled for the user, the social callback sends the user through Savia's MFA challenge before creating a session.

The provider must supply an email-verification signal Savia accepts. A Microsoft `email` or `preferred_username` claim by itself is not proof that the exact address was verified. Savia accepts Microsoft's `email_verified` claim or an exact match in `verified_primary_email` or `verified_secondary_email`; tokens without one of these signals fail closed. Microsoft's [`xms_edov` claim](https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference) only confirms that the email domain is verified by its owner, so Savia does not treat it as proof of the individual email address. Microsoft also cautions that `email` is mutable and not guaranteed to be correct for authorization decisions ([ID token claims reference](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)). Configure the Entra token to provide an accepted exact-email verification claim. If the Entra setup cannot provide one, use the tenant's existing SAML SSO route.

## Testing and limits

Automated tests cover configuration, callback policy, tenant isolation, account eligibility, and MFA handling without contacting Google or Microsoft. A live provider sign-in requires real OAuth credentials, the registered callback URL, and an account with an eligible pre-existing Savia tenant membership. Local tests cannot verify provider consent, claim configuration, or the external login flow without those credentials.
