# Developing plugins in Savia

Plugins run inside Savia's sandboxed iframe and receive the host's `savia` API.
Use the workspace SDK and UI packages to avoid reimplementing mounting, forms,
collection access, pickers, and panel behavior. These packages are currently
workspace packages, not published npm releases.

## Create and run a plugin

From the repository root:

```sh
pnpm plugin:create tasks
pnpm install
pnpm dev
```

In another terminal:

```sh
pnpm plugin:dev packages/plugin-tasks --tenant 0
```

Open the URL printed by the command and sign in to the local application. Tenant
`0` is the local platform workspace; another existing local tenant ID can be
selected explicitly. The command does not create tenants or sign into the UI.
The local bootstrap credentials are described in [local setup](../onboarding/03-local-setup.md).

Edit `packages/plugin-tasks/entry.tsx`. The watcher bundles the plugin, validates
it through the ordinary upload handler and installs a new immutable build version.
After installation, the running admin clears cached object/extension metadata and
remounts the plugin iframe in place, preserving the current route. Unsaved state
inside that plugin resets; persistent collection records remain. If another screen
is open, the metadata is cleared and the Studio queries are marked stale for the
next visit. The watcher tracks imported workspace source files and the plugin's
manifest/store declaration. A failed build keeps the last successfully installed
version active and reports its error. Use `--once` for one build.

The local dev endpoint keeps a small per-plugin list of build versions it created.
Before the next upload it prunes only older inactive builds in that tenant; the
installed version stays available. Release uploads are not tracked or deleted by
the dev CLI, and plugin collection records are untouched.

`--origin` selects a loopback API (default `http://127.0.0.1:8787`);
`--admin-origin` overrides the printed admin URL. By default the CLI reads
`SAVIA_PUBLIC_ORIGIN` from the generated local API runtime, so Vite's selected
port is respected. Only loopback HTTP origins are accepted. The release manifest is never rewritten:
builds use a timestamp patch version in the local database. Do not distribute
those development artifacts. Returning a local installation to a lower release
version requires the normal explicit rollback flow.

## Files and public packages

- `savia-extension.json`: plugin identity, release version, and dependencies.
- `store.json`: collections, screens, actions, and configurable lookup fields.
- `entry.tsx`: the renderer mounted by the host.
- `test/`: plugin unit tests using the mock SDK.
- `@savia/plugin-sdk`: the supported host API types and `definePlugin` lifecycle.
- `@savia/plugin-sdk/react`: React mounting and resource hooks.
- `@savia/plugin-sdk/testing`: deterministic collection mocks and fault simulation.
- `@savia/plugin-ui`: generic workbench, record editor, record picker, attachments,
  schema helpers, and shared styles. It has no insurance package dependency.

The checked-in `packages/plugin-example-tasks` is a runnable generic example.
Existing consumers of `@savia/insurance-workbench` continue through compatibility
exports; insurance-specific presentation and financial helpers stay there.

## Mounting and host access

```tsx
import type { PluginApi } from "@savia/plugin-sdk";
import { defineReactPlugin } from "@savia/plugin-sdk/react";

function Screen({ savia }: { savia: PluginApi }) {
  // Render your interface, using savia for host operations.
  return <div>My plugin</div>;
}

const plugin = defineReactPlugin(Screen);
export const { render, renderPanel } = plugin;
```

`definePlugin` is the non-React equivalent: renderers return cleanup functions.
Repeated mounting and cleanup are handled per element. The React adapter manages
roots and locale context. A panel renderer must consume `savia.ui.panel`; the
shared Workbench already implements the hosted record-editor flow. Arbitrary
panel view names are not yet supported by the host's panel contract.

The parent document, credentials, and internal React state are not exposed.
Operations cross the existing host bridge and the authenticated backend. Use
`savia.ui` for supported panels, `savia.settings` for versioned settings,
`savia.files` for attachments, and `savia.actions` for configured server actions.
Check optional capabilities before using them. Keep external-service secrets in
backend-managed connections.

## Collections and connected fields

```ts
const available = await savia.collections.list();
const customers = savia.collections.collection<Customer>(configuredCollection);
const schema = await customers.describe();
const page = await customers.list({
  q: search,
  searchFields: configuredSearchFields,
  page: 1,
  perPage: 20,
});
await customers.update(record.id, changes, { version: record._version });
```

Collection names and field mappings may come from tenant configuration. Reads and
writes keep normal backend row/field permissions. A logical lookup ID does not
grant permission to access its target. See [connected fields](../plugin-store.md#tenant-configured-field-lookups).

`savia.collections` mutations are confirmed by the server. For supported local
collections, `savia.localRecords` returns a receipt whose `persistence` is
`local` or `server`. Do not hide that distinction in a generic save helper.
Actions that require authoritative confirmation, such as payments, use the
server API. Hooks provide loading/error state and refresh but do not add another
persistent browser cache.

## Verification and release

```sh
pnpm --filter @savia/plugin-tasks test
pnpm --filter @savia/plugin-tasks typecheck
pnpm plugin:dev packages/plugin-tasks --tenant 0 --once
pnpm store:pack packages/plugin-tasks
```

Test collection success, denied access, disconnected requests, version conflicts,
and changes to collection or query while a previous request is in flight. The
SDK mock is a unit-test aid, not evidence of backend authorization or offline
persistence. Then test inside the real local iframe: first load, open/close the
host panel, lookup search, save/reopen, and any permission-dependent behavior.
The final `store:pack` uses the checked-in release version and the normal bundle
validation. Upload/install that artifact through the usual release process.

## Local development endpoint

`pnpm dev` generates a private local Worker entry and an independent random
`plugin-development-key` under `apps/api/.wrangler/local-runtime/` (ignored by Git,
file mode 0600). The CLI reads this key directly from disk. The local entry only
accepts loopback requests with that credential and rejects browser Origin headers.
It permits plugin upload/install into an explicitly selected existing tenant.
Production and preview still use `apps/api/src/index.ts`, which does not mount
this development endpoint. Never copy local runtime configurations to a deployment.

## Create with AI inside Savia

Open **My plugins → Create plugin** to open the on-demand editor. The IDE reuses
Monaco, the workspace's configured AI model, and the existing plugin store. It
loads the editor, compiler and React runtime only when authoring is opened.

On phones, **Chat**, **Code** and **Preview** show one workspace area at a time;
switching views preserves the code and running preview. Desktop keeps chat beside
the selected code or preview view. **Run** validates and opens preview, **Publish**
releases the validated revision, and the project options menu contains portable
import/export and the optional publication destination. Select a source file from
the file picker in Code.

Monaco and the preview follow the workspace palette and update when the theme
changes. The isolated preview receives validated color/font values, not access to
the parent document or its stylesheets. Explicit styles written by a plugin still
take precedence; new starter projects inherit the preview font.

The project contains:

- `entry.tsx`: a single TypeScript/JSX module exporting `render(element, savia)`.
  `React` and `createRoot` are available without imports. Return an unmount function
  from `render`. The IDE bundles React into the final self-contained ESM artifact.
- `savia-extension.json`: identity, label, dependencies and semantic release version.
- `store.json`: the normal collections, screens, settings and action declarations.
- `preview.json`: mock `{ collections: { collection_name: [records] }, settings: {} }`
  data for preview; use invented test data rather than secrets or customer records.

Describe the plugin in the chat. The generator uses the selected workspace's
server-side AI configuration and requires an active tenant administrator membership
or platform administrator access to the selected active tenant.
The generator receives bounded collection names, labels and field types through the
workspace’s authenticated collection-definition endpoint. It cannot execute tools,
publish, install plugins or access live record values. A failed schema lookup stops
generation rather than guessing the workspace schema.
Review each changed file in the proposal, then apply or discard it. Applying can
be undone until the next manual edit. Generation errors leave the current project
untouched; generation can be cancelled.

Run the preview after editing. It executes the same compiled module that will be
published, inside an opaque, no-network iframe with mock collection/settings APIs.
Preview writes are temporary and reset on every run. The console reports runtime
errors. Actions, attachments, host panels and integrations need installed-plugin
verification and are not simulated as successful backend operations. Preview is
not proof of backend permissions or integration connectivity.

Publication is enabled only after the current revision previews successfully.
Any edit invalidates that preview. The preview gate is checked immediately before
upload starts; a later runtime error does not roll back an acknowledged release.
**Publish to store** uploads the validated ZIP
to this workspace's store; installation is a separate store action. Existing
permission checks, quotas and immutable versions still apply. Increment the
manifest version for a changed release. When the deployment explicitly configures
a separate registry publisher credential, a destination selector also offers the
shared catalog. This forwards the validated ZIP to that namespace; other tenants
must import and install the release. Reader credentials cannot publish.

Projects are saved automatically on the server, scoped to the signed-in principal
and workspace. **Create plugin** lists saved projects and offers a new project.
Saved projects can be deleted from that list without deleting published releases.
Each save uses optimistic versioning; a conflicting save leaves the draft intact
and offers retry or saving a separate copy. A scoped browser recovery copy protects
pending edits across reloads when local storage is available. The editor warns
before unloading while a server save is still pending. Do not close the page until
“Project saved” appears if browser recovery storage is unavailable.

**Edit source** on a store release creates a new project from its retained source
and increments a plain semantic patch version. Older packages without authoring
sources return an explicit missing-source error. Runtime artifacts and sources
are retained atomically; published source versions are immutable. **Export project**
and **Import project** remain available for portable four-file JSON backups (chat
history is saved in server projects but is not included in that portable export).

Deployment requires database migration `0038_plugin_authoring_projects.sql` (D1
or the matching PostgreSQL migration), the API and admin bundles, and existing
workspace AI configuration. Shared publication additionally needs `publishToken`
in `PLUGIN_REGISTRY_TENANTS`; see [the registry guide](plugin-registry.md).

This first authoring contract supports one TSX module, built-in React, and the
Savia host API. It does not install arbitrary npm dependencies, run Node processes,
or grant direct network access. Use the repository SDK/build workflow for plugins
requiring extra bundled libraries. Each authoring file is limited to 100 KB;
preview fixtures allow up to 200 records per collection. Existing store artifact
size and quota limits apply independently.
