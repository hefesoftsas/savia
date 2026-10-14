# VS Code authoring for published Savia plugins

Status: Approved by the user on 2026-10-12.

## Intent

Provide a native VS Code extension that connects to a Savia workspace, opens the
authored source of published plugins as ordinary local files, and publishes new
immutable plugin versions from VS Code. The user chose a native extension rather
than a terminal-only workflow. Published history, tenant permissions, and the
shared registry remain authoritative on the backend.

## First release

- A Savia sidebar groups published plugins by ID and version and marks the latest
  and installed versions. Historical versions open as read-only virtual documents.
- Connect using a server origin, workspace ID and a personal API key with dedicated
  plugin scopes. The token goes in VS Code SecretStorage; files, settings and logs
  never contain it. A connection validates the workspace and available permissions.
- Open the latest authored source in a user-selected empty local folder. Reconstruct
  real files from the existing original-source archive, preserving workspace-relative
  paths and the entry module. A historical version can explicitly become the base
  of a new editable local project.
- Edit with VS Code's ordinary file explorer, editor, extensions and Git tools.
  Saving files updates the local working copy; it does not publish or replace a
  remote release or another person's UI draft.
- Validate and build with the same authoring rules and packaged dependencies as
  the Savia browser editor. Show build errors in VS Code's Problems view.
- Publish to the connected workspace or its shared store. Ask for a new version
  and show the plugin, target, version and file changes before the publish action.
  A successful receipt reports the published version and digest.
- Provide Refresh, Compare with Published Source, Open in Savia and Disconnect
  commands. Refresh and comparison never replace local edits automatically.

Initial distribution is a downloadable, tested VSIX. Publishing the extension to
Microsoft Marketplace or Open VSX is a separate release action. This is a desktop
VS Code extension; running it inside Savia's restricted web extension host is not
part of this release.

## Existing capabilities and required changes

The backend already has a versioned plugin catalog, source export, tenant ZIP
upload, shared-registry publication, immutable artifacts and permission checks.
The browser editor already compiles and packages authored source. Personal API
keys currently authorize recording and record operations, and deliberately deny
adjacent Studio authoring routes. There is no native VS Code package in the repo.

Add `plugins:read` and `plugins:publish` scopes to the existing personal-key schema,
key creation UI and route policy. Scopes limit a credential; they do not grant
permissions the principal lacks. Existing tenant binding, deployment binding,
expiry, revocation and extension-administration checks remain mandatory.

Expose a narrow plugin-development API under the tenant's Studio gateway:

- Capabilities: connection identity, workspace label, supported authoring format,
  compiler version and publication destinations available to that principal.
- Catalog: plugin/version metadata and permission-filtered authoring availability.
- Checkout: an explicit release's source, manifest, source provenance, source
  digest and current publication-head identity from a consistent snapshot.
- Publish: a bounded ZIP plus destination and the expected publication-head
  identity. Reuse artifact validation, source persistence and registry publication.

These routes are the only new personal-key authoring surface. The credential does
not gain generic access to Studio, plugin deletion, records, settings or activation.
OpenAPI descriptions are generated through the repository's existing mechanism.

## Local project and compiler

The local descriptor contains only schema version, origin, tenant ID, plugin ID,
source version, expected head version/digest, source digest and entry path. It is
portable project metadata, not a credential or a replacement for backend state.
Local modifications are an intentional working copy for ordinary desktop editing.

Extract the environment-independent authoring compiler and ZIP packaging into a
shared module with browser and Node adapters. Ship the same pinned runtime/vendor
bundles with the VS Code extension. Retain the existing import restrictions,
source and artifact limits, source archive representation, manifest validation and
runtime contract. Do not introduce a second compiler with different behavior.

The extension does not automatically run downloaded package scripts, install
dependencies, or fetch arbitrary compiler modules. Building and publishing require
a trusted VS Code workspace. Missing source assets or unsupported imports produce
diagnostics. Type declarations are shipped to support completion without requiring
the complete Savia monorepo checkout.

Compiled-only legacy releases remain visibly identified as compiled-only. They
can be inspected but cannot be represented as recovered authored source. Export
must not generate a placeholder renderer or publish one over the original plugin.

## Version and conflict semantics

Released versions are immutable. Opening historical files is read-only; using a
historical version as a base creates a working copy that must publish a version
greater than the current publication head.

Checkout records both the selected source version and the current head. Before
publication, the extension compares remote state and shows a conflict if the head
changed. The backend repeats the check in the transaction that creates the local
artifact, so an intervening UI or VS Code publication cannot pass a stale check.
Conflict responses preserve local files and offer comparison and explicit rebase;
the extension never silently changes the expected head and retries publication.

For shared-store publication, first create the guarded immutable local artifact,
then publish its exact bytes through the configured backend publisher credential.
The client never receives the R2 publisher token. The two destinations do not
share a transaction: if shared publication fails, report the local artifact
receipt separately and allow retry of those same immutable bytes. Existing
registry ownership and coordinate claims prevent overwrites; same-content retries
remain idempotent. A shared release published concurrently elsewhere is reported
as a newer head when relevant, not overwritten or presented as activated.
For a shared destination, also read the shared head before publication and require
a higher proposed version. The local transaction cannot lock the independent
registry's global head: the receipt must distinguish creating an immutable release
from that release still being the latest when the response arrives.

Publication does not activate a version automatically. Activation changes the
running workspace and remains an explicit operation in Savia for this first
release. VS Code can open the relevant Savia screen after publishing.

## Security and local file safety

Only HTTPS origins are accepted, with explicit loopback HTTP support for local
development. Bind credentials to the exact origin and tenant; reject redirects
instead of forwarding bearer tokens. Disconnect removes the saved secret.

Validate exported paths, entry identity and all byte limits before writing. Reject
absolute paths, traversal, duplicate normalized paths, reserved descriptor paths,
symlinks and writes outside the selected project root. Require an empty target
folder for checkout; comparison and refresh do not overwrite an existing project.
Only validated plugin source and public metadata are written to disk.

Publication uses the connection profile chosen by the user and matching local
descriptor. Merely opening an untrusted folder cannot send a stored credential to
an origin found in that folder. Permission changes, expired/revoked keys and wrong
tenant requests fail closed. Do not create keys or expand existing keys silently.

## Implementation boundaries

- `apps/vscode`: native extension, sidebar, commands, connection profiles, local
  checkout, diagnostics and publication client; bundle and package a VSIX.
- Shared authoring module: existing compiler/package logic and environment adapters,
  with browser/Node output parity tests.
- API/auth: dedicated scopes, generated API descriptions, capabilities, checkout
  snapshot and guarded publication, retaining existing ACL and tenant policies.
- Admin: scoped-key creation labels and instructions for connecting VS Code.
- CI/docs: extension tests, typecheck, VSIX artifact, preview deployment of backend
  changes and a native authoring guide.

## Acceptance and verification

1. Install the built VSIX and connect to preview using an explicitly created scoped
   key; verify the actual VS Code Extension Host, not just mocked UI components.
2. List a published plugin, checkout its latest authored source and edit a real
   imported module without needing the full Savia repository.
3. Build equivalent browser and Node fixtures, including multi-file source and
   supported assets, and verify equivalent validated package contents.
4. Publish a disposable plugin as a higher workspace version and verify source
   round-trip from Savia's UI. Test shared publication with disposable releases
   only and verify the exact published digest and retry receipt.
5. Publish from the UI after checkout, then verify stale VS Code publication is
   rejected without losing local edits. Cover the intervening-write race.
6. Inspect an old version read-only, then use it as the base of a higher release.
7. Reject wrong-tenant, expired, revoked and insufficient-scope credentials, and
   principals whose management permission was removed after connection.
8. Test malicious source paths, symlinks, oversized bodies, redirects, untrusted
   project origins and compiled-only legacy releases without exposing secrets.

No existing user releases are deleted or changed during verification. Preview
deployment follows the normal PR, CI and verified-release workflow. Deliver the
VSIX and its installation instructions; public marketplace publication, browser
OAuth sign-in, continuous cloud draft synchronization and remote debugging are
outside the first release.

## References

- Existing implementation: `plugin-store.ts`, `plugin-registry.ts`,
  `plugin-projects.ts`, `plugin-ide-project.ts`, `plugin-source-compiler.ts`,
  `personal-api-key-policy.ts` and `personal-api-keys.ts`.
- [VS Code Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view).
- [VS Code extension packaging](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
