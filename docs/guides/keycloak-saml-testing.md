# Testing tenant SAML with Keycloak

Savia's self-hosted SAML smoke test exercises the signed SAML protocol against a
disposable Keycloak server. It creates a fresh local Savia data directory,
container, realm, tenant records, and synthetic credentials for each run, then
removes them when it exits. It never uses the development demo's database,
Keycloak realm, or long-running services.

Install the repository dependencies and make sure Docker is available, then run
from the repository root:

```sh
pnpm test:sso
```

The runner binds both services to loopback on dynamically selected ports. It
uses `quay.io/keycloak/keycloak:26.7.4` by default, as shown in Keycloak's
[official Docker getting-started guide](https://www.keycloak.org/getting-started/getting-started-docker).
Set `SAVIA_KEYCLOAK_IMAGE` to an explicit alternative tag to check compatibility
with a different Keycloak release.

To run the same HTTP flow against a locally built Savia self-hosted image, set
`SAVIA_SAML_APP_IMAGE` to its image tag before `pnpm test:sso`. The runner starts
that image on a dynamically selected loopback port with an ephemeral writable
container layer and removes it at the end. Without this variable, it starts the
self-hosted app directly in the current Node process against isolated SQLite
files.

Each test client cookie jar uses one reserved documentation IP address from
`198.51.100.0/24` so independent cases do not exhaust Savia's normal per-client
authentication rate limit. A client keeps the same address throughout. In
Docker image mode, the fixture trusts only the local Docker bridge gateway and
forwards that synthetic address through `X-Forwarded-For`; native mode uses the
same header, which the local server ignores unless its peer is a configured
trusted proxy. SSO initiation honors `Retry-After` for at most two retries.

The fixture signs in a Savia bootstrap administrator, enrolls its local TOTP,
creates tenant users in two tenants, configures a SAML provider with Keycloak's
generated realm metadata, and enrolls TOTP for the SSO user. It submits
Keycloak's actual form-posted SAML assertion to Savia, requires a second-factor
challenge before creating a session, and carries an OAuth authorization through
SAML login, MFA, consent, authorization-code redemption, and token issuance. It
also checks that tampered assertions, replays, unknown identities, and
cross-tenant identities are denied, tenant password login is blocked in
SSO-only mode, pending SAML MFA challenges stop working after provider changes,
pending password MFA challenges stop working after enabling SSO-only mode, and
platform-administrator local recovery remains available.

Keycloak's realm-wide metadata advertises signed AuthnRequests even when this
fixture's SAML client is configured to accept unsigned requests. Better Auth
currently sends unsigned AuthnRequests, so the runner changes only that
`WantAuthnRequestsSigned` metadata flag to `false` before saving the IdP
metadata. Keycloak still signs the assertion and the test verifies that
signature against Keycloak's generated certificate.

The runner sets `SAVIA_SSO_ALLOW_LOCAL_IDP=true` only in its disposable local
Savia process. Production deployment keeps the HTTPS requirement for identity
provider endpoints.
