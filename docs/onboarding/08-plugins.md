# 08 — Plugin development

## Mental model: per-tenant store, not a compiled catalog

Plugin code ships as **versioned ZIPs published to the tenant store**
(`store-ports/`, `pnpm store:pack`), never inside the Savia release.
The tenant administrator **uploads, installs and activates** each
plugin only for their own space. Execution is sandboxed (iframe
opaco + bridge `savia`), and server-side capabilities are declarative
(`store.json`: actions, connectors, collections, screens, widgets).

## The plugin surfaces

1. **Screen** (`dist/plugin.js` → `render(element, savia, screen)`): replaces
   a normal view (e.g. Pólizas) when `store.json` declares
   `screens[]` and the plugin is active. Receives `{ savia }` already
   scoped to tenant + user + extension: no D1, no tokens, no
   credentials. The optional `screen` argument contains the selected
   `{ object, view }` so a ZIP that declares multiple screens can open
   the matching view. Heavy work (summaries) computes client-side from
   collections. The authenticated iframe shell uses the current workspace
   API prefix (for example,
   `/v1/data-domains/platform/api/plugin-store/`). Screen shells invoke
   `render`; widget shells invoke the declared `widgets[id]` handler, with
   `renderWidget` or `render` as fallbacks. The authenticated shell issues a
   two-minute signed URL for its ZIP entry module; the opaque iframe loads
   that module without session cookies. The entry route verifies the grant
   and requires the installation to remain active.
2. **Host collections API** (`packages/studio-shared/src/plugin-api.ts`):
   versioned `list/describe/get/create/update/remove` plus
   `settings`, `connections`, `actions` and `access` scoped to the
   tenant and user.
3. **Declarative backend** (`store.json`): `simulation` fixtures,
   `delegate` to an available host action, `http` connectors with tenant-held
   secrets and SSRF allowlists, `savia-request` flows, `settings`
   defaults and `collections` provisioning on install.
4. **Read-only MCP tools** (`savia_store_catalog`,
   `savia_store_execute`): only declared read-only actions with
   sanitized labels. Writes go through explicit user confirmation.

## Contract and lifecycle

- **Manifest** `savia.extension` (`savia-extension.json`, schema in
  `extension-package.ts`): id, semver, `requires` (built-ins or
  tenant-active only).
- **Declarative config** `store.json` (schema in `plugin-store.ts`):
  actions, connectors, collections, screens, widgets, bundles,
  settings and MCP flags.
- **Idempotent collection requirements**: missing collections get a
  minimal one; a compatible existing one is kept untouched; an
  incompatible one fails install without activating. **Repair
  installation** re-runs the idempotent install.
- **Per-tenant state** (`studio-server/src/extensions.ts`): `install`
  → `enabled` on/off. No arbitrary hooks or migrations, no
  downgrades, no destructive uninstall, and anything required by
  another active extension cannot be disabled.

## Step by step (example: `store-ports/collections/`)

1. Generate the scaffold: `pnpm store:port insurance-collections`.
2. Review `savia-extension.json` (same id, version above any installed version),
   `entry.tsx` (mounts the real screen) and `store.json`
   (collections + screens from source).
3. Pack: `pnpm store:pack store-ports/collections` (validates the
   bundle, `dist/plugin-store/*.store.zip` + SHA-256).
4. Upload in **Mis plugins**, install (provisions collections),
   activate. The object route renders the sandboxed screen.
5. For a newer ZIP with the same plugin ID, upload the new version and
   choose **Update** in **Mis plugins**. Uploading alone does not switch
   the active installation to the new artifact.

Full contract in [plugin-store](../plugin-store.md) and the worked
ports under `store-ports/`.

## Intentional limits (not bugs)

No D1/Env/secrets access from UI code, no other tenant, no permission
bypass, no generic filters/aggregations until a real case requires
them, ordinary screens intact on disable. Server-side execution is
always declarative (`store.json`) or release services — never
uploaded code.

## Additional worked examples

`packages/insurance-collections/` and `packages/insurance-renewals/` contribute
independently installable worklists with versioned record updates. Their shared
sector UI lives in `packages/insurance-workbench/`. Claims, commissions,
endorsements, opportunities, activities, issuance, documents and service use the same host contract in their
independent `packages/insurance-*` packages. See the
[operations guide](../insurance-operations.md) for supported workflows and limits.

`store-ports/automation/` publishes declarative relation/workflow bundles
as a tenant ZIP. Generic preparation and matched creation live in the host;
sector field mappings stay in the optional port. See the operations guide
for explicit publication and scheduler requirements.

The current optional insurance catalog and its activation dependencies are listed in
[Insurance plugin coverage](../insurance-plugin-coverage.md). `PluginApi.files`
uses the native record-file routes (multipart upload, authenticated binary download
and versioned deletion). `PluginApi.access.effective()` reads only the current
authenticated policy; it never accepts a client-selected principal or scope.
