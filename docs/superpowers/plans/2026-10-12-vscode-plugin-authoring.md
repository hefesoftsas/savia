# VS Code Plugin Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a native VSIX that checks out published Savia plugin sources, builds them with the browser editor's compiler and publishes immutable versions to a workspace or shared store.

**Architecture:** A narrow tenant API exposes catalog, checkout and guarded publication through dedicated personal-key scopes. A shared authoring package supplies browser and Node adapters with identical package contents. The native extension uses ordinary local files, VS Code SecretStorage, a version tree, diagnostics and explicit publication commands.

**Tech Stack:** TypeScript, VS Code Extension API, Hono/Zod, existing D1/Postgres adapter and R2 registry, Sucrase/Acorn, pnpm, Vitest and VS Code Extension Host tests.

**Spec:** [Approved design](../specs/2026-10-12-vscode-plugin-authoring-design.md).

## Global Constraints

- Dedicated scopes are exactly `plugins:read` and `plugins:publish`; neither grants activation, deletion or general Studio access.
- Retain principal ACL, tenant/deployment binding, key expiry and revocation. Do not issue keys or expand existing keys automatically.
- HTTPS origins only, except explicit loopback HTTP. No bearer forwarding through redirects.
- Tokens live only in VS Code SecretStorage or request memory. Project descriptors, artifacts and logs contain no credentials.
- Published history is immutable; older versions are read-only unless explicitly copied as the base of a higher version.
- No automatic activation, dependency installation, downloaded-script execution, cloud draft synchronization or public extension-marketplace publication.
- Building and publishing require a trusted workspace; opening a folder never selects its origin as a credential destination automatically.
- Retain existing limits: project 5 MiB, original-source archive 2 MiB/256 files, compiled entry 2 MiB, release ZIP 6 MiB.
- Local files are intentional working copies. Remote publication and permissions remain authoritative on the backend.
- English source, tests and documentation; localized ES/EN/PT user-facing commands and messages.
- Preserve the unrelated dirty `apps/admin/src/api/generated/openapi.ts`. Generate API changes in an isolated checkout and review only this feature's generated delta.
- Use ordinary PR/CI/preview deployment and disposable smoke-test plugins. Never modify an existing user release during verification.

## Review Focus

1. Switching connections during a request must not put the old tenant's sources or receipt in the new connection (Task 5).
2. Two workspace roots with conflicting descriptors must not choose a publication target silently (Tasks 5 and 7).
3. Case/Unicode path collisions and symlink substitutions must not overwrite or escape checkout files (Task 6).
4. A lost publish response must be recoverable without a new version, different ZIP or duplicated side effects (Tasks 4 and 7).
5. Head/source deletion or permission removal after checkout must preserve local edits and reject publication (Tasks 3, 4 and 7).

---

## File and dependency map

- `packages/studio-shared/src/plugin-development.ts`: schemas for capabilities, catalog, checkout, local descriptor, publication request and receipt.
- `packages/plugin-authoring/src/{types,compiler,source-compiler,project,zip,index}.ts`: existing authoring logic extracted without DOM or Vite dependencies.
- `packages/plugin-authoring/src/bundles.ts`: injected runtime/vendor-bundle contract; build-time generation reuses `apps/admin/build/plugin-ide-runtime.ts`.
- `packages/studio-server/src/plugin-development.ts`: narrow router and current-principal authorization.
- `packages/studio-server/src/plugin-development-snapshot.ts`: explicit-version source export and head snapshots.
- `packages/studio-server/src/plugin-development-publication.ts`: guarded local creation and shared publication/retry receipts.
- `apps/api/src/auth/personal-api-{keys,key-policy}.ts`: scopes and route allowlist, with existing authentication preserved.
- `apps/vscode/src/{connection,client,checkout,project,build,publication,tree,documents,extension}.ts`: native extension boundaries.
- `apps/vscode/extension/package.json`: VS Code manifest with ID `savia.savia-plugin-authoring`, desktop entry and commands.
- `apps/vscode/package.json`: pnpm workspace package `@savia/vscode`; build produces a standalone staging directory for VSIX packaging.
- `apps/vscode/scripts/{build,package}.mjs`: bundle the extension and pinned compiler assets; package with no workspace symlinks or secrets.

Tasks 1–2 establish the backend contract, Task 3 supplies checkout, and Task 4 supplies publication. Task 5 establishes the compiler and native client. Tasks 6–7 complete the user workflow; Task 8 verifies and delivers it. These are one connected feature, not independent product launches.

### Task 1: Define the development contract and scoped access

**Files:** Create `packages/studio-shared/src/plugin-development.ts` and `test/plugin-development-contracts.test.ts`; modify `apps/api/src/auth/personal-api-keys.ts`, `personal-api-key-policy.ts`, their existing tests, the personal/tenant API-key clients and creation UI.

**Interfaces:** Export `PluginHead = {version:string; sha256:string}`; checkout includes selected `sourceVersion`, `sourceSha256`, current `head`, `sharedHead`, `authoringKind`, `files` and `entryPath`. Export schemas/types for `PluginDevelopmentCapabilities`, `PluginCatalogEntry`, `PluginCheckout`, `LocalPluginDescriptor`, `PluginPublicationRequest` and `PluginPublicationReceipt`.

Publication metadata contains `mode: "create" | "retry-shared"`, `destination: "tenant" | "shared"`, `pluginId`, proposed `version`, selected `sourceVersion/sourceSha256` and `expectedHead`. Receipt contains `state: "published" | "shared-pending" | "shared-conflict"`, local release identity/digest, optional shared release identity/digest, current head and sanitized issues.

- [ ] Write schema tests for missing source identity, malformed digests, invalid versions/destinations and descriptor secrets/unknown fields. Write policy tests for exact tenant route/method pairs, wrong tenant, revoked/expired keys, generic Studio denial and publish scopes not authorizing activation/deletion.
- [ ] Run `pnpm --filter @savia/studio-shared test test/plugin-development-contracts.test.ts` and the API personal-key policy/auth tests; confirm failures are the new missing contract and scopes.
- [ ] Add scopes and adapt the allowed-scope count to the schema's options. Allow capabilities with either plugin scope, catalog/checkout with `plugins:read`, and publication with `plugins:publish`, only under `/v1/studio/:tenantId/api/plugin-development`. Leave existing record-route policy unchanged.
- [ ] Add ES/EN/PT scope labels to personal and tenant key forms. Creating a key still requires explicit selection and existing authority; existing keys keep their original scopes.
- [ ] Run the contract, personal/tenant key route/auth and key-form suites; run API/shared typechecks. Verify scope denial occurs before plugin handlers or mutations.
- [ ] Commit `feat: add scoped plugin development contracts`.

### Task 2: Register a narrow capability/catalog API

**Files:** Create `packages/studio-server/src/plugin-development.ts`; modify `src/index.ts`, `src/plugin-store.ts` (options type) and `apps/api/src/studio/collection-gateway.ts`; create `apps/api/src/studio/plugin-development-openapi.ts` and incorporate it through `dynamic-openapi.ts`; test `packages/studio-server/test/plugin-development-api.test.ts` and existing API boundary tests.

**Interfaces:** `registerPluginDevelopment(app: Hono<Env>, options: PluginStoreOptions): void`; routes `GET /api/plugin-development/capabilities`, `GET /api/plugin-development/catalog`, `GET /api/plugin-development/:id/checkout?version=...`, `POST /api/plugin-development/:id/publish`.

Capabilities return schema/compiler version, principal/tenant identity, workspace label and authorized destinations. Catalog returns bounded published version metadata grouped client-side; it does not return whole source archives.

Add request-bound `PluginStoreOptions.pluginDevelopmentAccess?: {workspaceLabel:string; read:boolean; publish:boolean}`. The API gateway derives it from the authenticated actor's scopes (or authorized browser session) and current extension-management permission. It contains no token. Missing access configuration makes the new native routes unavailable; it does not change the existing UI routes.

- [ ] Write real-DB route tests: a valid scoped connection gets its own identity/catalog; principal ACL denial and wrong tenant fail; `shared` is unavailable without a configured backend publisher credential; catalog never exposes credentials.
- [ ] Run `pnpm --filter @savia/studio-server test test/plugin-development-api.test.ts`; confirm missing routes fail.
- [ ] Implement capability/catalog handlers using existing catalog and permission predicates; route checkout/publication to the services defined below. Enforce read/management checks for source operations and publication on every request, not only connection.
- [ ] Verify a read-only key belonging to an administrator still has no publish destination; a publish-only key does not gain catalog/source access. Preserve the native-record narrowing in `api-key-access.ts`; plugin capabilities must not restore collection grants or general Studio access.
- [ ] Describe schemas using the existing generated OpenAPI mechanism and test the tenant OpenAPI document includes the four narrow routes and their scoped errors. Keep registry credentials out of responses.
- [ ] Run route and API-boundary tests; commit `feat: expose plugin development capabilities and catalog`.

### Task 3: Export consistent authored-source snapshots

**Files:** Create `packages/studio-server/src/plugin-development-snapshot.ts` and `test/plugin-development-snapshot.test.ts`; reuse/extract the existing source resolver in `plugin-store.ts` without changing its legacy UI response.

**Interfaces:** `loadPluginCheckout(db, scope, pluginId, version, registry?): Promise<PluginCheckout>`; internal `readPublicationSnapshot(db, tenantId, pluginId)` returns the current head plus bounded raw version/digest and source-row snapshot values for guarded writes.

- [ ] Write tests for exact-version export, nested original-source reconstruction, source digest stability, latest versus historical versions, explicit version requirement, unavailable assets, compiled-only legacy sources and source deletion during checkout.
- [ ] Run `pnpm --filter @savia/studio-server test test/plugin-development-snapshot.test.ts`; confirm the new export path fails.
- [ ] Read artifact/source rows in a consistent DB snapshot and derive the head using existing semantic-version ordering. Hash canonical authored files. Preserve plain authored `entry.tsx` projects and original-source archives; expose compiled-only data for inspection and reject editable checkout of synthesized source.
- [ ] Return server-provided head/source identity and source provenance; never use a mutable `latest` download alias or generate a substitute renderer. Bound all data by existing source limits.
- [ ] Run snapshot and existing plugin-store source tests, including tenant isolation and permission removal after an earlier capability read. Commit `feat: export versioned plugin authoring snapshots`.

### Task 4: Publish against a guarded head and support exact retries

**Files:** Create `packages/studio-server/src/plugin-development-publication.ts` and `test/plugin-development-publication.test.ts`; extend `plugin-store.ts` persistence preparation and extract shared upload transport from `plugin-registry.ts`.

**Interfaces:** `publishPluginDevelopment(db, scope, input: PluginPublicationRequest, zipBytes: Uint8Array, options): Promise<PluginPublicationReceipt>`; `persistParsedStoreArtifact` gains optional guarded-write input without changing existing callers. Shared transport returns the actual registry receipt, including deduplication and digest.

- [ ] Write tests proving an unchanged head accepts a higher version; changed head/source identity, equal/lower version, different manifest ID and lost ACL reject before persistence. Pause the guarded batch, publish through the existing UI upload path, then resume and assert rollback with no orphaned source/artifact rows.
- [ ] Run the new publication suite and confirm its failures before implementation.
- [ ] Parse bounded multipart input (ZIP at most 6 MiB, total body at most ZIP limit plus 64 KiB). Validate metadata/source identities before mutation. Compare expected head and source digest; place exact bounded version/digest/source-row snapshot guards inside the same DB batch as artifact and source persistence. A preflight-only check is insufficient; preserve raw DB values instead of comparing canonicalized JSON strings to stored JSON.
- [ ] For `tenant`, return the immutable local receipt without activation. For `shared`, create the guarded local artifact first and publish the incoming ZIP bytes through the existing dedicated backend publisher credential. Check a higher shared version before a new shared publication; report current head separately from created release.
- [ ] On shared failure, return HTTP 200 with explicit `shared-pending` or `shared-conflict`, the retained local receipt and sanitized issues. `retry-shared` requires the incoming ZIP digest to match the existing local artifact; it does not create a second version or bypass current ACL. If the shared coordinate already has the same semantic release, accept its actual receipt; if a higher remote head prevents creating a missing older release, return a conflict with the local artifact retained.
- [ ] Test remote failure/retry, lost response, remote semantic deduplication with distinct ZIP-byte digest, local/source deletion after a partial result, newer shared head and unconfigured publisher. Run existing store/registry publication suites and server typecheck.
- [ ] Commit `feat: add guarded native plugin publication`.

### Task 5: Share the compiler and establish the native connection

**Files:** Create `packages/plugin-authoring/package.json`, `tsconfig.json`, `src/{types,bundles,compiler,source-compiler,project,zip,index}.ts`, `test/compiler-parity.test.ts`; modify browser `plugin-ide-project.ts`, `plugin-source-compiler.ts`, `plugin-ide-zip.ts` and runtime-bundle generation. Create `apps/vscode/package.json`, `tsconfig.json`, `src/{connection,client}.ts`, their tests and a valid unscoped VS Code manifest in `extension/package.json`.

**Interfaces:** `AuthoringBundles = {runtimeBundle:string; vendorBundles:Record<string,string>}`; `compileAuthoringProject(files, bundles): Promise<CompiledAuthoringProject>` and `packageAuthoringProject(files, bundles): Promise<{zipBytes:Uint8Array; manifest:PluginStoreManifest; entryJs:string}>`. Browser wrappers preserve existing function signatures and Blob results.

`PluginDevelopmentClient(profile, tokenProvider, transport)` consumes Task 1 contracts and implements `capabilities()`, `catalog()`, `checkout(id, version)`, `publish(input, zipBytes)`. Connection profiles contain only ID/origin/tenant/principal identity; a selected profile, not a folder descriptor, determines the token destination.

- [ ] Write compiler parity tests for single/multi-file entries, retained SDK sources, assets, fixtures, unsupported imports, cyclic imports and byte limits. Compare deterministic ZIP bytes and parsed contents for browser/Node adapters, and assert user source is not executed during building.
- [ ] Run shared compiler and existing browser compiler/packaging suites; confirm missing shared exports fail.
- [ ] Extract existing logic with injected pinned runtime/vendor bundles; keep browser-only preview DOM code in admin. Ship exactly the supported vendors already used by the browser editor (`react`, `react-dom/client`, `zod`, `pdf-lib`). Do not add arbitrary npm resolution or a second compiler.
- [ ] Write native connection/client tests for HTTPS and loopback validation, redirect refusal, SecretStorage isolation, disconnect, cancellation, key errors, unexpected capability identity and connection switching while a response is pending.
- [ ] Create the native package with minimum VS Code `^1.96.2`, a bundled CommonJS desktop entry, `vscode` external to the bundle and pinned runtime/compiler assets. Store secrets with `ExtensionContext.secrets`. Non-secret profiles can use VS Code's profile state; no token goes in settings or local project files.
- [ ] Implement bounded requests and schema-checked responses; preserve structured conflict and partial receipts. Use generation guards so old connections cannot overwrite current UI state. Run compiler/client tests and package typechecks; commit `feat: share authoring compiler and add native connections`.

### Task 6: Checkout safe ordinary files and read-only history

**Files:** Create `apps/vscode/src/{checkout,project,tree,documents}.ts`, corresponding tests and shipped TypeScript declarations derived from the existing IDE declarations.

**Interfaces:** `checkoutProject(rootUri, checkout, profile): Promise<LocalPluginDescriptor>`; `readLocalProject(rootUri, profile): Promise<{descriptor; files}>`; `PublishedSourceProvider` implements read-only documents under `savia-source:`; `PluginTreeProvider` groups catalog IDs/versions and marks current/installed versions.

- [ ] Write tests for empty-folder checkout, nested source and assets, historical virtual documents, explicit historical-copy-as-base, plain entry projects and compiled-only rejection for editable checkout.
- [ ] Add path tests for traversal, absolute/reserved paths, duplicate Unicode/case-normalized paths, preexisting files, symlink ancestors and substitutions during writes. Assert all writes stay in the selected root and failed checkout cannot expose a partially valid descriptor.
- [ ] Run `pnpm --filter @savia/vscode test` and confirm missing checkout/provider behavior fails.
- [ ] Materialize validated source paths using a staging directory owned by the operation, with filesystem containment and symlink checks before committing into the empty destination. Write the non-secret descriptor last. Keep `.savia/` metadata, receipts, retained ZIP artifacts and type declarations out of the published source archive.
- [ ] Decode the existing `data:image/png;base64,...` and `data:image/webp;base64,...` archive values into real image files; text/SVG files use UTF-8. Encode those images back into the same archive representation when reading a local project. Test checkout/edit/build source round-trip rather than writing data-URI text into a `.png` file.
- [ ] Implement read-only historical documents and compare views. Refresh reloads remote metadata, not local files. Require an explicit project root selection in multi-root workspaces; match origin/tenant/plugin identity to the selected profile before reading build inputs.
- [ ] Run filesystem/provider tests and typecheck; commit `feat: add safe native plugin checkout and history`.

### Task 7: Wire edit/build/publish commands and conflict UX

**Files:** Create `apps/vscode/src/{build,publication,extension,i18n}.ts` and command/controller tests; add commands/view contributions to `apps/vscode/extension/package.json`.

**Interfaces:** Commands are `savia.connect`, `savia.disconnect`, `savia.refresh`, `savia.checkout`, `savia.useVersionAsBase`, `savia.comparePublished`, `savia.build`, `savia.publish`, `savia.retrySharedPublication`, `savia.openInSavia`. Controllers consume Tasks 1, 5 and 6 only.

- [ ] Write command tests for connection/catalog/checkout, trusted build diagnostics, save-before-build, cancelled target/version/root choices and correct receipt display. A multi-root ambiguity must request a root, not publish the active file's plugin implicitly.
- [ ] Add tests for local edits retained on head conflicts, source/permission removal, connection switching, a lost publication response and recovery using the unchanged local ZIP. An untrusted descriptor origin cannot choose another credential destination.
- [ ] Run native command tests and confirm the new commands fail before wiring.
- [ ] Wire sidebar and ES/EN/PT commands. Build through the shared compiler, map diagnostics to local files and display unsupported source/import errors in Problems. Require workspace trust for build/publication; do not run scripts or install dependencies.
- [ ] Save the immutable ZIP to `.savia/artifacts/<sha256>.zip` before transmission and retain its non-secret receipt. Show plugin, target, new version and changed files before the explicit publish action. Compare remote head first; still rely on Task 4's server guard. On conflict show diff/rebase actions without changing the baseline automatically. Retry shared publication reads and hashes the retained original ZIP; it never rebuilds from newer edits.
- [ ] Offer Open in Savia after a receipt; do not activate automatically. Show separate local/shared outcomes and whether the release remains latest. Disconnect disposes requests/providers and deletes that profile's secret.
- [ ] Run native suites, browser compiler regressions and typechecks. Commit `feat: add native plugin build and publication commands`.

### Task 8: Package, smoke-test and deploy

**Files:** Create `apps/vscode/scripts/{build,package}.mjs`, `apps/vscode/test/extension-host/` tests and `.github/workflows/build-vscode-extension.yml`; integrate package checks through root scripts/existing CI; create `docs/guides/vscode-plugin-development.md` and link it from the plugin guide/docs index.

**Interfaces:** `pnpm --filter @savia/vscode build`, `test`, `test:host`, `typecheck`, `package`; package output `apps/vscode/artifacts/savia-plugin-authoring-<version>.vsix` with its SHA-256 and no source credentials or workspace symlinks.

- [ ] Write package tests that inspect the VSIX manifest, command contributions, bundled compiler/runtime assets, declarations and required files. Assert missing runtime assets fail packaging and no `.env`, token, test secret, unrelated monorepo source or symlink enters the archive.
- [ ] Bundle into a clean staging directory; use a valid standalone extension manifest and package with dependencies already bundled. Keep workspace package name `@savia/vscode` separate from VSIX name `savia-plugin-authoring` and publisher `savia`; public publisher registration is outside this delivery.
- [ ] Test the actual VS Code Extension Host at the minimum supported version using isolated user-data/extension directories. Exercise connection, checkout, read-only history, diagnostics, comparison and publication against a real local API/DB with disposable fixture identities and plugins.
- [ ] Run changed-package checks and required full CI lanes, then review the integrated branch and generated API delta. Preserve unrelated local changes. Document installer, personal-key scopes, connection, build, publication, retry/conflict recovery and supported source limitations.
- [ ] Create/attach a normal PR; after CI/review merge, wait for verified preview deployment and confirm its exact release SHA. Build the distributable VSIX from that same tested source.
- [ ] Run an assisted preview smoke using a key explicitly issued by the operator, never a silently created or broadened credential. Verify source round-trip and a disposable shared release; show the local receipt separately on simulated registry failure. If operator setup is pending, report that specific live-smoke limitation instead of claiming end-to-end preview verification.
- [ ] Deliver the VSIX link, artifact digest, installer instructions and verification results. Do not publish the extension publicly or activate an existing plugin. Commit `feat: package and document native Savia plugin authoring`.

## Execution and review handoff

Recommended execution: native implementation in this chat, because the auth,
snapshot, compiler and publication interfaces are tightly coupled. Perform one
independent whole-branch review before integration; honor the repository's maximum
two-worker limit if bounded review work is delegated. Alternatively, execute the
plan task-by-task with native subagents and individual review gates.

Implementation begins after the user reviews this plan and selects the execution
approach. This plan does not approve creating real credentials, activating plugins
or publishing the VS Code extension to a public marketplace.
