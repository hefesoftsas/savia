# 08 — Plugin development

## Mental model: trusted extensions, not a marketplace

Plugin code **ships inside the Savia release** (review + CI + new-version
deploy). The tenant administrator only **installs/activates** what the
compiled catalog already carries. No JS/TS uploads and no dynamic third-party
execution exist — an explicit security decision, not a missing feature.

## The 3 plugin surfaces

1. **React screen** (`src/screens/`): replaces a normal CRM view (e.g.
   Pólizas). Registered explicitly in
   `apps/admin/src/features/crm-engine/extension-screens.tsx`. Contributions
   can specify `hidden: true` on `ExtensionScreenContribution` if the screen
   should not appear in the left sidebar (e.g. secondary screens only opened
   from other pages or workflows). Receives
   `{ savia }` already scoped to tenant + user + extension: no D1, no tokens,
   no credentials. In dev, Vite imports it from the workspace with hot-reload.
2. **Host collections API** (`packages/crm-shared/src/plugin-api.ts`):
   versioned `list/describe/get/list/create/update/remove` +
   `services.get()` scoped to the owning extension's services (server-side
   logic without exposing endpoints).
3. **Read-only MCP tool** (`savia_extension_*` in `apps/mcp/src/extensions`):
   only with `annotations.readOnlyHint: true`. Writes go through
   `savia_prepare_command` + explicit user confirmation.

## Contract and lifecycle

- **Manifest** `savia.extension` (`savia-extension.json` + `src/manifest.ts`,
  schema in `extension-package.ts`): id, semver, `requires` (built-ins or
  tenant-active only).
- **Idempotent collection requirements**
  (`extension-object-requirements.ts`): missing `polizas` gets a minimal one;
  a compatible existing one is kept untouched; an incompatible one fails
  install without activating. **Repair installation** re-runs the idempotent
  install.
- **Per-tenant state** (`crm-server/src/extensions.ts`, migration
  `0045_extensions.sql`): `install` → `enabled` on/off. No arbitrary hooks or
  migrations in this increment, no downgrades, no destructive uninstall, and
  anything required by another active extension cannot be disabled.

## Step by step (example: `packages/insurance-portfolio-dashboard/`)

1. Copy the directory; change `id/label/version/requires` in
   `savia-extension.json` and `src/manifest.ts`.
2. Declare the contribution in `src/admin.ts` (collection + view + component).
3. Implement in `src/screens/` receiving `{ savia }`; discover with
   `list()/describe()` before assuming collections.
4. Own collection → idempotent requirement in `src/<collection>-object.ts` +
   registration in the API catalog.
5. Server-side logic → service in the catalog, consumed with
   `services.get("name")`.
6. MCP only if the assistant needs it (read-only, validates active extension).
7. Verify and pack:

```bash
pnpm --filter @savia/insurance-portfolio-dashboard test
pnpm --filter @savia/insurance-portfolio-dashboard typecheck
pnpm extension:pack insurance-portfolio-dashboard  # dist/extensions/*.savia-extension.zip + SHA-256
```

The ZIP is a release candidate for review, not something installable from the
UI. Full file map in `docs/solution-packages.md` § Desarrollo, and the
worked example in `packages/insurance-portfolio-dashboard/README.md`.

## Intentional limits (not bugs)

No D1/Env/secrets access, no other tenant, no permission bypass, no generic
filters/aggregations until a real case requires them, ordinary screens intact
on disable.

## Additional worked examples

`packages/insurance-collections/` and `packages/insurance-renewals/` contribute
independently installable worklists with versioned record updates. Their shared
sector UI lives in `packages/insurance-workbench/`. Claims, commissions,
endorsements, opportunities, activities, issuance, documents and service use the same host contract in their
independent `packages/insurance-*` packages. See the
[operations guide](../insurance-operations.md) for supported workflows and limits.

`packages/insurance-automation/` contributes declarative relation/workflow bundles
to the release catalog. Generic preparation and matched creation live in the host;
sector field mappings stay inside this optional package. See the operations guide
for explicit publication and scheduler requirements.

The current optional insurance catalog and its activation dependencies are listed in
[Insurance plugin coverage](../insurance-plugin-coverage.md). `PluginApi.files`
uses the native record-file routes (multipart upload, authenticated binary download
and versioned deletion). `PluginApi.access.effective()` reads only the current
authenticated policy; it never accepts a client-selected principal or scope.
