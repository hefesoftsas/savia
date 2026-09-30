# Disposable Keycloak SAML fixture

`apps/self-hosted/scripts/saml-keycloak-smoke.ts` starts a disposable Keycloak
container from `quay.io/keycloak/keycloak:26.7.4`, creates an isolated realm and
synthetic users through the local Admin REST API, then drives the browser-facing
SAML HTTP flow with ordinary HTTP requests. It does not import or modify the
development/demo realm, persistent volumes, or existing Savia services.

The test needs Docker and the repository dependencies installed. Run it from
the repository root with:

```sh
pnpm test:sso
```

Set `SAVIA_KEYCLOAK_IMAGE` to another explicit Keycloak tag when deliberately
testing another release. The default tag follows the official Keycloak Docker
getting-started command and is pinned so fixture behavior does not float with
`latest`.

To point the same fixture at a built Savia image, set `SAVIA_SAML_APP_IMAGE` to
that image tag. The runner gives it a fresh ephemeral container filesystem and
removes the container after the test.
