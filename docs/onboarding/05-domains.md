# 05 — Key domains (reference)

Entry points into the code by topic. The `*.test.ts` files next to each area
are the executable spec: read them before the runbooks.

- **Studio engine**: `apps/admin/src/features/studio-engine/` (design in
  `DESIGN.md`, index in `README.md`) + `packages/studio-server/` (contract in
  `API.md`, `INTEGRATIONS.md`) + `packages/studio-shared/`.
- **Domains and collections**: `apps/api/src/routes/data-domains.ts`,
  `studio.ts` (`/v1/dynamic-crm/*`, `/v1/data-domains/*`),
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
  invariants in the `tenants` / `tenant-membership` tests.
- **Insurance results**: `apps/api/src/insurance-results/` (`README.md`,
  `InsuranceResult` contract) + `packages/insurance-portfolio-dashboard/`.
- **Legacy**: `apps/legacy-api/` (opt-in Postgres source, `/legacy` routes),
  `apps/legacy-exporter/`; boundary in [legacy-api.md](../legacy-api.md).
- **Solutions**: `solutions/insurance/manifest.json` +
  `scripts/build-solution-catalog.mjs`; guide in
  [solution-packages.md](../solution-packages.md).
