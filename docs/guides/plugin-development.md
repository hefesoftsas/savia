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

Open **Plugin Studio** in the left navigation to access the dedicated `/plugin-studio`
workspace. Choose an authorized workspace, then create or reopen a saved project.
The store's **Create plugin** and **Edit source** actions also open this workspace.
The editor, compiler and React runtime load on demand.

Desktop opens with a keyboard-accessible file explorer, Monaco editor and Savia AI
conversation. Drag the separators to resize panels, or hide Files/Chat from the
workspace toolbar. Files open in tabs; returning to a file preserves its editor
and undo history during the session. Preview is another editor tab. Narrow layouts
show **Files**, **Code**, **Preview** or **Chat** one at a time, without resetting
source or the running plugin. Monaco is bundled with the app shell (no CDN), and
`entry.tsx` offers ghost-text inline completions from the workspace's
server-side AI configuration; provider keys never reach the browser.

Send a request with Enter (Shift+Enter inserts a line break). The request appears
immediately and the assistant answer streams live, with input/output token usage
(↑/↓) beside the pending indicator and under the finished answer. While a
generation runs, the composer stays enabled and further prompts join a visible
capped queue that drains in order; cancel stops only the running request.
Failed requests can be retried without duplicating the conversation. Changed
files open in Monaco's inline diff viewer before **Apply changes**. The current
code stays unchanged until applied. Saved-project status appears in the bottom
status bar.

**Run** validates and opens preview; **Publish** releases the validated revision.
The project options menu contains import/export and the optional publication
destination. This is a bounded Savia plugin workspace with the four files below,
not a general-purpose npm workspace, terminal or VS Code extension host.

The resizable layout uses [Allotment](https://github.com/johnwalley/allotment),
a React component derived from VS Code's split-view implementation, alongside
Savia's existing Monaco and assistant Markdown renderer. Alternatives reviewed:
[monaco-vscode-api](https://github.com/CodinGame/monaco-vscode-api) integrates full
VS Code services but requires initialization before any existing Monaco instance;
[Eclipse Theia](https://github.com/eclipse-theia/theia) is a broader IDE framework;
[Sandpack](https://github.com/codesandbox/sandpack) provides an editor/preview toolkit
with its own bundler iframe. Keeping Savia's compiler and isolated preview preserves
the publish validation contract and existing on-demand editors.

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
untouched; generation can be cancelled. Previewing the current files remains available
while AI is generating; applying changes and publishing wait until generation finishes.
The chat shows elapsed time and permits retry after a failure. The server applies a
90-second deadline across configuration, metadata lookup and generation; the client
also bounds token acquisition and transport at 100 seconds even if cancellation is
not honored by the transport. Provider credential, quota and timeout failures are
reported separately.

Generated files must pass the manifest, store, collection, source-policy and fixture
validators. If they fail, the server asks the model once to repair the rejected files
using bounded per-file diagnostics within the same deadline. Only validated proposals
are returned. If repair fails, the chat displays the affected file and validation
path; it does not replace the current project or a previous pending proposal.

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
to this workspace's store and activates that exact version in the workspace.
For an installed plugin with the same ID, this updates its active version.
**Publish without activating** in project options retains a catalog-only release.
If activation fails, the publication receipt offers **Activate this version**
to retry without uploading again. Existing
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

The store project list groups releases by plugin ID and sorts semantic versions newest
first. **Edit latest version** creates an editable project from the latest release.
Historical releases offer **Use as base**: the selected release's files are copied
into a new project, with its target version incremented from the current catalog
latest version (not from the historical version). Published releases remain
immutable; publishing a new version at or below the catalog latest is rejected.
Identical retries of an existing release remain idempotent.

Repository-built ZIPs include `src/original-source.json`, a map of workspace-owned
files from the build graph, including original TSX, JavaScript, CSS, JSON, and image
assets. The editor opens the source entry in Monaco and lets users edit source
modules and text assets with their repository paths. Retained PNG/WebP data URIs
are read-only. Preview and publication compile the edited module graph, including
relative imports, `@savia` workspace aliases, CSS, and literal dynamic imports.
React, Zod, and PDF-lib are bundled locally; no dependency is downloaded during
compilation. The old compiled entry is kept only for exact runtime recovery and
is hidden while complete originals are available. Saving, exporting, importing,
and publishing preserve the source map. The assistant currently supports
single-module projects; edit multi-module originals directly in the code editor.
Reopen a published release to obtain newly attached originals; existing drafts
are not overwritten.

Older packages uploaded without
authoring sources, or whose historical source archives omitted required image
assets, open the retained compiled JavaScript together with the original
manifest and store configuration. A notice identifies this as a compiled copy; original TSX
cannot be reconstructed from the bundle. Preview runs the actual plugin rather
than a replacement starter. Reopen the published version to recover it; existing
projects created from the older counter fallback remain separate drafts. Runtime artifacts and sources are retained atomically;
published source versions are immutable. The **Create plugin** project list also offers
published store versions to open as new projects. **Export project**
and **Import project** remain available for portable JSON backups (chat
history is saved in server projects but is not included in that portable export).

Deployment requires database migration `0038_plugin_authoring_projects.sql` (D1
or the matching PostgreSQL migration), the API and admin bundles, and existing
workspace AI configuration. Shared publication additionally needs `publishToken`
in `PLUGIN_REGISTRY_TENANTS`; see [the registry guide](plugin-registry.md).

AI authoring supports one TSX module, built-in React, and the Savia host API.
Manual source editing additionally supports the retained multi-module build graph
and the shipped dependencies described above. It does not install arbitrary npm dependencies, run Node processes,
or grant direct network access. Use the repository SDK/build workflow for plugins
requiring extra bundled libraries. AI authoring files remain limited to 100 KB.
Saved editor projects accept up to 2 MB in `entry.tsx` for compiled release recovery, 100 KB per configuration
file, and 5 MB for serialized project JSON (including escape sequences);
the optional original source archive accepts up to 256 files and 2 MB.
preview fixtures allow up to 200 records per collection. Store artifacts are
limited to 6 MB each, with a 64 MiB aggregate quota per tenant and up to 10
versions per plugin.

Large retained source records and editor drafts are compressed transparently on
backend storage to fit the database row limit. The API and editor recover the
exact original file text; existing uncompressed records remain readable. Records
that still exceed the storage limit after compression are rejected before writing.
