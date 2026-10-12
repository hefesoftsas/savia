# Plugin Editor Marketplace and VSIX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install, manage, and run compatible VS Code web extensions from Open VSX or uploaded VSIX files in the Savia plugin editor.

**Architecture:** An authenticated studio-server service validates and stores immutable packages in R2 with tenant/principal-scoped database records. A separately deployed asset-only editor runtime executes third-party extensions in a WebWorker and exchanges bounded project messages with the Savia parent. Project settings reference exact installed versions; the existing bundled extension allowlist remains separate.

**Tech Stack:** Cloudflare Workers, D1/R2, PostgreSQL migration counterparts, Hono, Zod, React, Vite, Monaco VS Code API 37.3.11, Vitest.

**Spec:** [Approved design](../specs/2026-10-10-plugin-editor-marketplace-vsix-design.md).

## Global Constraints

- Open VSX only for marketplace access; no Microsoft Marketplace bypass.
- Browser extensions and supported declarative contributions only; no remote Node host.
- 20 MiB compressed per package, 64 MiB expanded, 10,000 files, 8 MiB per expanded file, and 128 MiB installed package data per tenant.
- Immutable identity/version/digest; changed bytes under an existing identity/version are a conflict.
- Third-party code never runs on a Savia application or tenant-cookie origin.
- Backend-only persistence; no localStorage, IndexedDB, or Cache API for installations or preferences.
- Every artifact/installation lookup includes tenant and principal; project writes also enforce management permission and optimistic version checks.
- English code, tests, and docs; Spanish, English, and Portuguese UI messages.
- Preserve the unrelated existing change in apps/admin/src/api/generated/openapi.ts.
- No implementation until plan review; follow normal CI/review/merge/automatic preview deployment.

## Review Focus

- A project switch during package transfer must cancel the old session and never expose the previous project's files.
- A quota race between two installations must never exceed 128 MiB or leave a usable partial record.
- A previously installed extension with now-missing dependencies must remain installed but cannot activate.
- A failed update must retain the prior enabled version and editable document contents.
- Removing a package referenced by another project must not silently change that project's active version.

## Ownership and file structure

The coordinator owns runtime isolation, protocol, installation/runtime integration,
deployment, and final review. A bounded worker may own shared package validation
and its tests. A second bounded worker may own backend persistence after shared
types are fixed. Serialize project schemas and panel integration. At most two
workers run concurrently; workers do not spawn additional agents.

New units:

- packages/studio-shared/src/plugin-editor-extensions.ts: metadata, installation/reference schemas, quotas, compatibility reasons.
- packages/studio-shared/src/plugin-editor-vsix.ts: bounded ZIP decoding and manifest/resource validation, shared by server and isolated runtime.
- packages/studio-server/src/plugin-editor-marketplace.ts: Open VSX-only search and exact-version downloads.
- packages/studio-server/src/plugin-editor-extension-artifacts.ts: R2 staging, scoped installation records, quota reservation, cleanup.
- packages/studio-server/src/plugin-editor-extensions.ts: authenticated HTTP routes.
- apps/admin/src/features/studio-engine/plugin-editor-extension-client.ts: typed API client.
- apps/admin/src/features/studio-engine/plugin-editor-installed-extensions.ts: activation/dependency resolution and resource lifecycle in the child.
- apps/admin/src/features/studio-engine/plugin-editor-extension-transfer.ts: session-bound package transfer.
- apps/admin/vite.plugin-editor.config.ts: isolated runtime assets without the application shell or service worker.
- apps/plugin-editor-runtime/src/index.ts and wrangler.jsonc: asset-only host and security headers.

### Task 1: Prove the isolated WebWorker runtime

**Files:** Modify plugin-vscode-runtime.ts, plugin-vscode-editor.tsx, plugin-vscode-protocol.ts in apps/admin/src/features/studio-engine; create apps/admin/vite.plugin-editor.config.ts; create apps/plugin-editor-runtime/{package.json,wrangler.jsonc,src/index.ts}; create apps/admin/src/features/studio-engine/test/plugin-editor-runtime-security.test.ts; extend test/plugin-vscode-editor.test.tsx.

**Interfaces:** Define EditorSession = { nonce: string; projectId: string; parentOrigin: string }. Wrap all state, completion, format, ready, search, error, and edit messages in a session envelope. Define resolvePluginEditorRuntimeUrl(configuredUrl: string | undefined): URL | null; reject credentials, non-HTTPS production URLs, and any hostname within the effective Savia cookie domain. Permit explicit localhost origins only in development.

- [ ] Write failing security tests for exact origin/source/nonce checks, wrong project, late completion results, oversized completion payloads, read-only writes, and missing isolated runtime configuration. Assert third-party activation is unavailable in the same-origin fallback.
- [ ] Run pnpm --filter @savia/admin exec vitest run src/features/studio-engine/test/plugin-vscode-editor.test.tsx src/features/studio-engine/test/plugin-editor-runtime-security.test.ts; confirm failures concern the missing session/isolation behavior.
- [ ] Implement the cross-origin bridge and separate asset build. Bound AI prefix/suffix to 100 KiB each, edit text to existing project limits, and concurrent completion requests to four. Parent responses recheck session and project after awaiting. Reset acknowledgements and pending transfers on project changes.
- [ ] Configure getExtensions({ enableWorkerExtensionHost: true }) with the library's actual worker resources. Use registerExtension(manifest, ExtensionHostKind.LocalWebWorker) and registerFileUrl for a browser fixture that registers a visibly identifiable completion provider. Keep bundled providers in LocalProcess.
- [ ] Serve an asset-only host with CSP and explicit permissions/referrer/content-type headers. No API proxy, auth bindings, SPA fallback, or persistent browser state. Derive the minimal worker/blob/WASM policy through a real browser test; do not solve failed activation by running third-party code on Savia's origin.
- [ ] Verify the fixture activates cross-origin and cannot read parent DOM/cookies or fetch a Savia API. Re-run editor tests and build the dedicated assets. Save the observed worker/resource configuration and proof; stop third-party enablement if isolation fails.
- [ ] Commit only this runtime boundary with feat: isolate plugin editor web extension host.

### Task 2: Validate VSIX packages and compatibility

**Files:** Create shared plugin-editor-extensions.ts, plugin-editor-vsix.ts and test/plugin-editor-extensions.test.ts, test/plugin-editor-vsix.test.ts under packages/studio-shared.

**Interfaces:** EditorExtensionMetadata = { id: string; publisher: string; name: string; version: string; sha256: string; license: string | null; compressedBytes: number; expandedBytes: number; dependencies: string[]; compatibility: { supported: boolean; reason: string | null } }. ParsedEditorVsix = { metadata: EditorExtensionMetadata; manifest: Record<string, unknown>; files: Map<string, Uint8Array> }. parseEditorVsix(bytes: Uint8Array, runtimeVersion: string): Promise<ParsedEditorVsix>. InstalledEditorExtension = EditorExtensionMetadata & { installationId: string; source: 'open-vsx' | 'vsix'; createdAt: string }. ProjectEditorExtensionReference = { installationId: string; sha256: string }.

- [ ] Write failing fixtures/tests for a browser provider, theme/snippets, desktop-only main entry, incompatible engine range, missing browser resource, unsupported contributions/APIs, invalid dependency names, traversal, symlinks, duplicate normalized paths, encrypted ZIP, inconsistent headers, truncated streams, CRC mismatch, invalid UTF-8, and each exact quota plus one byte/file.
- [ ] Run pnpm --filter @savia/studio-shared exec vitest run test/plugin-editor-extensions.test.ts test/plugin-editor-vsix.test.ts; verify meaningful failures.
- [ ] Implement bounded ZIP parsing with checks before allocation and while inflating. Validate a safe manifest subset and require all declared resources inside extension/. Derive runtimeVersion from the pinned library's VS Code product metadata, not its npm version. Reject unsupported capabilities with stable reason codes; surface codes through localized UI later.
- [ ] Add schemas for installation metadata and unique project references (maximum 32 per project); preserve the two bundled IDs unchanged. Test identical package hashing and deterministic metadata across server/browser usage.
- [ ] Run the focused tests and pnpm --filter @savia/studio-shared typecheck; commit feat: validate browser-compatible editor VSIX packages.

### Task 3: Provide scoped marketplace and installation APIs

**Files:** Create the three studio-server service files listed above and matching test files. Modify packages/studio-server/src/plugin-store.ts to register routes. Create 0055_plugin_editor_installations.sql in packages/db/migrations, packages/studio-server/migrations, and packages/db/postgres; modify packages/db/postgres/manifest.json. Recheck the next free migration number before writing if another contributor adds a migration.

**Interfaces:** registerPluginEditorExtensions(app: Hono<Env>, options: PluginStoreOptions): void. Under the existing tenant-scoped studio mount, expose GET /api/plugin-editor-extensions/marketplace?q=&offset=, GET /marketplace/:publisher/:name/:version, POST /inspect (VSIX upload or exact Open VSX coordinates), POST /install (validated inspection ID), GET /installed, GET /installed/:installationId/package, and DELETE /installed/:installationId. Inspections expire after 15 minutes and are scoped to the caller. Search pages contain at most 20 results; query length is at most 200 characters.

- [ ] Write failing tests proving tenant/principal/management authorization, forged inspection IDs, inspection expiry, duplicate idempotency, conflicting digest, untrusted redirects, network timeout, response overrun, quota races, missing R2 object, and removal of another principal's installation.
- [ ] Run pnpm --filter @savia/studio-server exec vitest run test/plugin-editor-marketplace.test.ts test/plugin-editor-extension-artifacts.test.ts test/plugin-editor-extensions.test.ts; confirm new behavior is absent.
- [ ] Implement allowlisted Open VSX fetches using verified official REST contracts. Restrict requests/redirects to https://open-vsx.org with no credentials, enforce a 15-second deadline and streamed size limits, and validate metadata before returning it. Return bounded data rather than marketplace HTML.
- [ ] Add installation, staged-artifact, and quota-reservation tables. Reserve bytes atomically before R2 writes; hash immutable original ZIP objects and include tenant/principal in object keys. Commit installation metadata only after validation and successful artifact storage. Count retained package objects once per scope/digest against the tenant quota.
- [ ] Implement expired staging cleanup on installation/list operations with bounded batches. Release reservations on failures; preserve cleanup records when R2 deletion fails. Refuse uninstall with 409 and referencing project IDs while other project references remain; never change those projects silently.
- [ ] Run focused tests and existing migration compatibility checks, validate all three SQL variants/manifest checksums, and run pnpm --filter @savia/studio-server typecheck. Commit feat: add scoped editor extension installation service.

### Task 4: Persist exact project extension references

**Files:** Modify packages/studio-shared/src/plugin-projects.ts, packages/studio-server/src/plugin-projects.ts, apps/admin/src/features/studio-engine/plugin-project-session.ts, plugin-project-workspace.tsx, and corresponding existing tests. Add an installed_editor_extensions column through the Task 3 migration, retaining editor_extensions for bundled preferences.

**Interfaces:** Extend project load/save models with installedEditorExtensions: ProjectEditorExtensionReference[] defaulting to []. Validate every reference against an installation owned by the authenticated tenant/principal and its stored sha256 before committing a project update. Preserve the existing project version CAS.

- [ ] Write failing tests for reload persistence, nonexistent/foreign installation IDs, digest mismatch, duplicate references, stale project versions, read-only historical versions, and code recovery that omits all extension settings.
- [ ] Run the focused shared/server plugin-projects and admin plugin-project-session/plugin-project-workspace tests; confirm failures.
- [ ] Implement reference persistence with authorization validation in the same update boundary as the project save. Keep invalid code draft saving behavior and original-source archives intact. Historical plugin versions remain read-only; copying one into a new draft revalidates installation references.
- [ ] Run the focused tests and package typechecks; commit feat: persist installed editor extensions per project.

### Task 5: Transfer packages and activate installed extensions

**Files:** Create plugin-editor-extension-transfer.ts and plugin-editor-installed-extensions.ts plus matching admin tests. Modify plugin-vscode-protocol.ts, plugin-vscode-editor.tsx, plugin-vscode-runtime.ts.

**Interfaces:** transferEditorExtension(session: EditorSession, installation: InstalledEditorExtension, bytes: Uint8Array, send: (message: unknown) => void): Promise<void>. Child InstalledEditorExtensionManager exposes enable(reference: ProjectEditorExtensionReference): Promise<void>, disable(installationId: string): Promise<void>, and dispose(): Promise<void>. Extend session protocol with transfer begin/chunk/end/ack and extension activation result messages.

- [ ] Write failing tests for 64 KiB bounded chunks, 20 MiB total limits, wrong digest, duplicate/out-of-order chunks, transfer cancellation on project switch, absent dependencies, dependency cycles, enable/disable resource disposal, and a failed version update retaining the prior enabled version and unsaved edits.
- [ ] Run pnpm --filter @savia/admin exec vitest run src/features/studio-engine/test/plugin-editor-extension-transfer.test.ts src/features/studio-engine/test/plugin-editor-installed-extensions.test.ts; confirm failures.
- [ ] Implement package fetch in the authenticated parent with current project/session checks. Transfer bytes without credentials; rehash and parse them in the isolated child. Limit one transfer at a time, apply acknowledgement backpressure, and discard incomplete buffers on timeout or session change.
- [ ] Register all resources before activation, resolve only explicitly installed dependencies, and report activation errors. On update failure dispose the candidate and restore the old package/providers without resetting editor models. Dispose blob URLs and registrations on disable/session teardown. External networking remains blocked.
- [ ] Verify a real WebWorker fixture contributes completion/formatting, an uploaded snippet/theme changes editor behavior, and changes reach the parent only within its write policy. Run the tests and dedicated runtime build; commit feat: activate installed extensions in isolated editor workers.

### Task 6: Integrate marketplace and VSIX management UI

**Files:** Create plugin-editor-extension-client.ts; modify plugin-editor-extensions-panel.tsx, plugin-editor-extensions-messages.ts, plugin-ide-panel.tsx, plugin-project-workspace.tsx. Extend test/plugin-editor-extensions-panel.test.tsx and create test/plugin-editor-extension-client.test.ts.

**Interfaces:** PluginEditorExtensionClient exposes search(query, offset, signal), inspectUpload(file, signal), inspectMarketplace({publisher,name,version}, signal), install(inspectionId), list(), downloadPackage(installationId, signal), and uninstall(installationId). Panel callbacks return promises; disabling/enabling persists project references through Task 4 before reporting success.

- [ ] Write failing UI tests for marketplace search, stale response cancellation, pagination, explicit inspection/install, VSIX size/type rejection, upload retry, incompatible reason display, missing dependencies, operation errors, explicit update, disable, referenced-package removal conflict, and keyboard/mobile access.
- [ ] Run the focused panel/client tests and verify failures.
- [ ] Implement Marketplace and Installed tabs, Upload VSIX, package details, Install/Enable/Disable/Update/Remove actions, and accessible progress/errors. Render registry text as text; do not execute registry HTML or arbitrary icon URLs. Use the existing panel visual language and ES/EN/PT translations.
- [ ] Tie activation state to child acknowledgements: an enabled checkbox does not mean successful activation. Cancel search/uploads when the project or tenant changes. Disable third-party installation when the isolated host is unavailable and retain editing with bundled extensions.
- [ ] Run focused tests and the existing plugin-ide-panel/project-workspace tests; commit feat: install marketplace and VSIX extensions from the editor.

### Task 7: Document, review, and deploy preview

**Files:** Modify docs/guides/plugin-development.md, scripts/render-cloudflare-production-config.mjs and its test, scripts/verify-preview-resources.mjs and its test, .github/workflows/deploy-preview.yml, apps/admin/package.json; add isolated host deployment config rendering/tests. Update API schema generation sources and regenerate the reference using the repository generators without overwriting concurrent edits.

- [ ] Write failing deployment configuration tests proving separate preview runtime naming, workers.dev origin outside the Savia cookie domain, no auth/API/secrets bindings, and runtime deployment before admin enablement. Preserve existing plugin-editor service-worker routing regression tests.
- [ ] Implement runtime build/deploy and configured parent URL through the existing protected workflow. The admin build must not precache third-party packages or the isolated runtime. Production configuration may support the feature, but this task deploys only through the preview workflow.
- [ ] Document compatible extension types, Open VSX search, VSIX import, project permissions, quotas, dependency installation, explicit updates, failures, and removal. Generate API types/reference from their source. Review the combined diff against the approved spec, especially authorization, CSP, artifact cleanup, and rollback.
- [ ] Run relevant admin/shared/server unit suites, migration/contract checks, affected configuration tests, pnpm run typecheck, and production asset builds. Record any existing unrelated failures separately and do not claim unrun checks passed.
- [ ] Perform real browser acceptance using an Open VSX package whose license/browser behavior has been verified and a separately uploaded VSIX. Exercise observable behavior, reload persistence, disable/update/remove, Node-only rejection, network failure, wrong-origin messages, read-only history, and all existing edit/search/undo/save/preview/publish flows. Do not overwrite the user's Actividades source.
- [ ] Request independent review, fix findings, create/attach the PR, wait for CI, merge normally, and wait for main CI and automatic preview deployment. Verify runtime response headers and absence of Savia cookies on the deployed origin. Smoke-test the live editor and report exactly which extensions and operations passed.

## Plan self-review

The tasks cover both installation paths, compatibility, the runtime boundary,
scoped persistence, explicit version management, resource cleanup, and deployment.
Task 1 is a prerequisite for activating arbitrary code; Tasks 2 and 3 establish
the shared/API interfaces before project/UI integration. The five Review Focus
cases have explicit owning tests in Tasks 3, 4, and 5. No terminal/Node host or
Microsoft Marketplace access is implied. If the isolated host fails its proof,
report that failure and revise the runtime design before enabling installation.
