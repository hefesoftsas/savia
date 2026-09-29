# 05 — Key domains (reference)

Entry points into the code by topic. The `*.test.ts` files next to each area
are the executable spec: read them before the runbooks.

- **Studio engine**: `apps/admin/src/features/studio-engine/` (design in
  `DESIGN.md`, index in `README.md`) + `packages/studio-server/` (contract in
  `API.md`, `INTEGRATIONS.md`) + `packages/studio-shared/`.
- **Tenant workspaces and collections**: `apps/api/src/routes/tenant-workspaces.ts`,
  `studio.ts` (`/v1/studio/*` + legacy `/v1/dynamic-crm/*`),
  `apps/api/src/studio/collection-relations.ts`; runbooks `data-domain-studio`,
  `collection-sources`, `collection-relations`, `collection-operation-mapping`.
- **savia-request**: `apps/savia-request/src/server/` (`index.ts` routes,
  `runner.ts` execution, `hooks.ts` sandbox, `catalog.json` operations,
  `store.ts` persistence); proxy at `apps/api/src/routes/savia-request.ts`.
- **Provider credentials**: admin UI (`provider-credentials`),
  `user_provider_credentials` table, savia-request worker's `ENCRYPTION_KEY`.
- **Assistant and MCP**: `apps/api/src/assistant/` (service, configuration,
  presentations), `apps/mcp/`; personal integrations (Google/Microsoft) and
  HubSpot via Nango: runbooks `nango-personal-productivity`, `nango-hubspot`,
  `crm-auto-sync`, `connected-crm-workspace`.
- **Auth and tenants**: `apps/auth/` (Better Auth, admin bootstrap, TOTP MFA,
  OAuth/OIDC) + `apps/api/src/routes/identity.ts`, `tenants.ts`;
  invariants in the `tenants` / `tenant-membership` tests. Successful auth
  bootstrap is shared per auth database and configuration; a changed
  environment configuration initializes its bootstrap separately, and failed
  initialization can be retried. The API caches the parsed public JWKS per auth
  service binding and issuer for up to five minutes, refreshing on expiry or
  an unknown signing key; signature, issuer, audience, and expiry are still
  checked for every bearer token. Cookie-session checks are not cached.
- **Insurance results**: `apps/api/src/insurance-results/` (`README.md`,
  `InsuranceResult` contract) + `packages/insurance-portfolio-dashboard/`.
- **Legacy**: `apps/legacy-api/` (opt-in Postgres source, `/legacy` routes),
  `apps/legacy-exporter/`; boundary in [legacy-api.md](../legacy-api.md).
- **Solutions**: `solutions/insurance/manifest.json` +
  `scripts/build-solution-catalog.mjs`; guide in
  [solution-packages.md](../solution-packages.md).
