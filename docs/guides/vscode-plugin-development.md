# Savia plugin authoring in VS Code

In Savia, open **Plugins → Work from VS Code** above the plugin catalog.
The guide includes the VSIX download, installation steps, personal key scopes,
and the current server origin and workspace ID. Expand **Installation and usage,
step by step** for editing, publication and recovery instructions. The browser
plugin editor also links to this guide from its project options menu; it opens
in another tab to preserve the current draft.

Admin deployments serve the packaged extension at
`/downloads/savia-plugin-authoring-<version>.vsix` with a matching `.sha256` file;
the download button follows the version in the extension manifest.
The common admin `build` and `build:assets` commands build the extension and
verify its checksum before copying the package into the admin static assets.
This includes Cloudflare deployments, setup scripts and the self-hosted Docker
image. For local Vite development, run `pnpm --filter @savia/admin build:downloads`
once to prepare the download without building the entire interface.

Install the downloadable **Savia Plugin Authoring** VSIX in desktop VS Code
1.96.2 or newer: open Extensions, choose **Install from VSIX…**, and select
`savia-plugin-authoring-0.1.0.vsix`. The terminal equivalent is:

```sh
code --install-extension /path/to/savia-plugin-authoring-0.1.0.vsix
```

The extension is distributed as a VSIX. Public Microsoft Marketplace or Open VSX
publication is a separate release action.

## Connect and open source

Create a personal API key in Savia for a commercial workspace. Explicitly select
`plugins:read` and `plugins:publish`. The key owner must currently be allowed to
manage plugins; scopes do not grant extra authority. Existing keys keep their
permissions. These scopes do not authorize activation, deletion, collection data,
or other Studio operations. Platform keys remain recording-only.

Run **Savia: Connect to Savia**, choose a new connection, and enter the HTTPS
server origin, workspace ID, and personal key. HTTP is supported only for explicit
loopback development servers. Credentials are stored in VS Code SecretStorage,
keyed by verified origin, workspace and principal. Project metadata never selects
a credential destination automatically. Disconnect deletes the selected profile's
saved credential; closing VS Code preserves it for explicit saved-profile reuse.

The Savia sidebar groups published workspace plugins by ID and immutable version.
It marks the latest and installed versions independently. To work on a shared-store
release that is not yet in the workspace, import it through Savia first.

Choose **Check out latest version for editing** and select an empty folder.
Checkout reconstructs real nested source files and PNG/WebP bytes. It opens the
entry file and adds the folder to the workspace. Historical versions open in
read-only `savia-source:` documents. Nested paths and filenames with spaces or
parentheses are preserved. **Use this version as a base** explicitly
creates a new working copy from an older release; publication still requires a
version above the current head. Compiled-only legacy releases are inspectable but
cannot be checked out as authored projects.

## Edit, build, and publish

Edit with VS Code's normal explorer, extensions and Git tools. Saving does not
publish, activate, or replace a browser editor draft. Build and publication require
a trusted workspace. No dependency installation or downloaded script execution is
performed. The shared compiler uses the same pinned React, react-dom/client, Zod,
and pdf-lib bundles as the browser editor and resolves retained workspace sources.
Arbitrary npm resolution is unsupported. Checkout ships declarations for those supported
imports and generated TypeScript aliases without installing dependencies. If a
release supplies its own tsconfig, preserve it and merge the `.savia/types` aliases
as needed. Build errors appear in Problems.

Run **Savia: Build plugin** to save and validate the current files. Run **Savia:
Publish a new version** to choose a workspace or shared-store destination and a
new semantic version. Review the plugin, target, source base, included file changes
and artifact digest before confirming. Multi-root workspaces always require an
explicit project selection. The selected release version is applied to the package;
authored files are preserved. Successful publication advances local publication
metadata to the confirmed release, without overwriting newer edits.

The client checks the current head and source; the server checks both again inside
the artifact/source database transaction. A competing browser publication or source
removal rejects stale writes. Publication never activates the release automatically;
use Savia's UI for activation.

## Conflicts and recovery

**Refresh** updates remote metadata without replacing local files. **Compare with
published source** opens a read-only remote version beside the local file. After a
conflict, compare the latest source and merge the desired changes yourself. **Update
publication base (keep files)** explicitly accepts the latest source identity and
head; it changes only the publication reference.

Before sending, the extension retains `.savia/artifacts/<sha256>.zip` and a
non-secret attempt/receipt under `.savia/receipts/`. A lost response can be recovered
with **Recover a pending publication**. A permission change after local creation
also retains an uncertain attempt; restore access and recover that same artifact. Shared publication creates the immutable
workspace release first, then sends those exact bytes using the backend's publisher
credential. A shared failure reports the retained local release separately. **Retry
shared-store publication** reuses the original ZIP and metadata, even if newer local
edits are incomplete. It never recompiles or invents another version. A changed or
missing retained artifact is rejected. A same-content registry retry uses the
registry's actual digest, which can differ from the local ZIP-byte digest.

Receipts distinguish release creation from whether it remains the latest version.
A newer shared head can conflict with creation of an older missing release; the
local release remains retained. R2 and the workspace database are separate systems,
so partial outcomes are explicit rather than transactional across both.

## Files and limits

`.savia/plugin.json` stores the origin, workspace/plugin identity, source version
and digest, expected head and entry path. `.savia/baseline.json` preserves the project
format and source baseline. These files, artifacts, receipts and shipped type
context are excluded from published source. Keep the local metadata with the working
copy when using Git, but avoid committing large retained artifacts unnecessarily.

Source is UTF-8; binary archive values are materialized as actual images and encoded
back on packaging. Existing limits remain: project 5 MiB, original archive 2 MiB and
256 files, compiled entry 2 MiB and release ZIP 6 MiB. The existing workspace
store quota is ten versions per plugin and 64 MiB per tenant; remove unneeded
versions through Savia before publishing when the quota is reached. Checkout rejects traversal,
absolute/reserved paths, case/Unicode collisions, preexisting files and symlinks.
Repository/editor execution configuration and dependency trees (`.git`, `.vscode`,
`node_modules`, `.savia`) cannot be supplied by a published source archive. Choose
physical folders for user-created symlink aliases. Multi-file projects expose their
actual entry modules rather than an unused wrapper file.

Filesystem guards reject symlinks from published archives and verify opened file
identity before returning source bytes. They are not an operating-system sandbox
against another process with the same user privileges replacing directories during
filesystem operations. Work in directories controlled by the trusted operator.

## Development checks

```sh
pnpm --filter @savia/vscode test
pnpm --filter @savia/vscode typecheck
pnpm --filter @savia/vscode build
pnpm --filter @savia/vscode test:host
pnpm --filter @savia/vscode package
```

Build stages a standalone extension with bundled dependencies and compiler assets;
package writes the VSIX and its SHA-256 under `apps/vscode/artifacts/`. Host tests use
isolated VS Code user-data/extension directories and disposable local API/database
fixtures. Preview smoke requires an operator-issued key and a disposable published
plugin; tests do not silently issue production/preview credentials or activate user
plugins.

VS Code references: [SecretStorage and extension APIs](https://code.visualstudio.com/api/references/vscode-api),
[Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust),
[Extension Host testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension).
