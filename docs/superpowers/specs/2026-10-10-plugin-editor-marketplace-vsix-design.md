# Plugin editor marketplace and VSIX installation

Status: approved by the user on 2026-10-11; implementation plan awaiting review.

## Outcome

Users can search a VS Code-compatible marketplace inside the plugin editor,
install a selected extension version, or upload a VSIX file. Installed extensions
can be enabled, disabled, removed, and explicitly updated. Compatible extensions
must change actual editor behavior, and survive reopening the project.

The marketplace is Open VSX. Microsoft's Marketplace access restrictions exclude
alternative products. A manually supplied VSIX is supported subject to its
license and browser compatibility; uploading one does not imply compatibility.

## Alternatives and recommendation

1. Recommended: Open VSX and VSIX packages in an isolated browser extension host.
   This builds on the existing Monaco/VS Code services and supports browser
   extensions and declarative contributions.
2. A remote Node extension host would support more desktop extensions, but adds
   tenant compute, process isolation, filesystem and network policies, lifecycle
   management, and operational costs. It is a separate future feature.
3. Running arbitrary extensions in the current same-origin iframe would be
   smaller, but exposes Savia's application origin. Do not use this approach.

## User experience

Extend the existing Extensions panel with Marketplace and Installed views and an
Upload VSIX action. Marketplace search shows publisher, description, version,
license, and browser compatibility. Details and installation state have separate
loading and error states. An upload is inspected before activation and shows the
same information as a marketplace package.

Installation requires an explicit Install action. The interface explains that
an enabled extension can read and edit the open project. Only installed,
compatible versions can be enabled. Unsupported packages show a specific reason,
such as requiring Node, a native executable, or an unsupported editor capability.
An extension activation failure is visible and does not prevent editing.

Updates are explicit and pinned to an exact version and package digest. Keep the
previous active version when download, validation, or activation fails. Removing
an extension first disables it. Existing bundled formatter and React snippets
remain available throughout the migration.

## Runtime boundary

Move the editor runtime to an asset-only Cloudflare Worker on a different site
from Savia, initially using its workers.dev hostname. Do not place it under the
Savia tenant cookie domain: the current authentication helper deliberately shares
cookies across that domain. Deploy the runtime without API proxy routes, auth
bindings, or application secrets.

Use the library's LocalWebWorker extension host for third-party executable code.
The existing LocalProcess host remains restricted to reviewed bundled code.
Register installed manifests and package resources using the library's extension
registration APIs. Package resources are transferred from the authenticated
parent to the isolated runtime; the child does not receive Savia credentials.

The parent owns persistence, preview, compilation, publication, and authenticated
AI requests. Its message bridge checks the expected source window, exact origin,
session nonce, schema, size limits, project identity, and current read-only state.
Expose only project text operations and existing bounded editor actions. Child
messages cannot select another tenant, project, or arbitrary HTTP endpoint.

Apply response headers to the isolated runtime and extension host documents.
Restrict network destinations to runtime resources, disallow navigation and
forms, and allow only the worker/blob/WASM features required by verified runtime
tests. Third-party external network access, authentication providers, terminals,
debugging, and arbitrary webviews are outside this release. Extensions needing
these capabilities receive a compatibility error rather than a silent no-op.

## Installation service and persistence

Add an authenticated installation service in studio-server and corresponding
shared schemas. Scope every installation and artifact read to tenant and
principal; project activation additionally uses existing project-management
authorization. Persist installation metadata in the database and immutable
package resources in R2. Keep project references separate from the current
two-item bundled extension allowlist. Never persist packages, preferences, or
installation state in browser storage.

The service searches Open VSX and retrieves a specific package version through
an allowlisted HTTPS origin. Validate redirects, timeouts, and streamed response
sizes; never accept a client-provided download URL. Uploaded VSIX files and
marketplace downloads pass through the same validation pipeline.

Initial limits: 20 MiB compressed per package, 64 MiB expanded, 10,000 files,
8 MiB per expanded file, and 128 MiB installed package data per tenant. Enforce
limits during streaming and decompression, not only from ZIP header claims.
Reject encrypted/multipart archives, symlinks, duplicate or conflicting paths,
absolute paths, traversal, invalid UTF-8 names, and inconsistent local/central
directory records. Require extension/package.json and validate the publisher,
name, semantic version, engine range, entry points, and contribution resources.
Preserve original package bytes and digest, and never rewrite executable code.

Validate compatibility against the pinned runtime's VS Code API version.
Declarative themes, snippets, and supported language grammars may run without an
entry point. Executable extensions require a valid browser entry point and
supported APIs. Do not treat a browser field alone as proof of runtime support.
Required extension dependencies must be present and compatible before enabling;
the first release explains missing dependencies so users can install them
explicitly. Extension packs do not silently install or activate other packages.

Install uses staged artifacts and a database commit; failed validation never
creates an installed record. Identical package/version/digest uploads are
idempotent. A different digest for an existing identity/version is a conflict.
Garbage-collect unreferenced staged resources and retain shared artifacts until
their last installation reference is removed. Uninstall is scoped and cannot
delete another principal's installation or another project's active version.

Add matched core D1, studio-server D1, and PostgreSQL migrations and update the
migration manifest. Update the plugin editor guide and generated API reference
through its generator. Preserve concurrent generated OpenAPI edits.

## Verification and rollout

Before enabling arbitrary code, prove cross-origin WebWorker activation and
resource resolution with a browser extension fixture. Fail closed if the
runtime cannot maintain the isolation boundary; do not fall back to same-origin
execution.

Backend tests cover malformed archives, streaming quotas, package identity,
compatibility, scoped authorization, duplicate installation, update failure,
and uninstall references. Bridge tests reject forged origins, stale sessions,
oversized messages, unknown paths, and writes to historical read-only versions.

Browser acceptance covers a real compatible Open VSX package and an uploaded
VSIX with observable editor behavior; reopening retains the enabled version.
Also exercise search failure, incompatible desktop packages, missing dependencies,
activation failure, disable, update, uninstall, and the existing source-search,
undo, save, preview, and publish flows. A hostile fixture must fail to access
Savia cookies, APIs, parent DOM, or another project's files.

Deploy the isolated runtime before enabling its configured URL in preview.
Verify no Savia session cookie is sent to that origin, CSP is enforced, and the
service worker does not rewrite runtime or extension resource requests. Complete
the normal CI, review, merge, and automatic preview deployment workflow. Keep
third-party installation disabled unless the isolated runtime is healthy.

## References

- [VS Code Marketplace access restrictions](https://code.visualstudio.com/docs/supporting/faq)
- [VS Code web extensions](https://code.visualstudio.com/api/extension-guides/web-extensions)
- [Extension host environments](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [Open VSX integration](https://github.com/eclipse-openvsx/openvsx/wiki/Using-Open-VSX-in-VS-Code)
- [Monaco VS Code API](https://github.com/CodinGame/monaco-vscode-api/wiki/)
