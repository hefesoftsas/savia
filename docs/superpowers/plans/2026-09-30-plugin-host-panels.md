# Host-managed plugin panels implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Open the existing editors of all 11 Workbench plugins in host-sized panels with isolated iframe content.

**Architecture:** A typed host UI protocol creates a second same-plugin frame while retaining the original list frame. The shared Workbench selects editor-only rendering from the bootstrap context and reports save, cancellation, dirty and busy state. The host owns modal presentation and lifecycle.

**Tech Stack:** TypeScript, React, existing Radix dialog primitives, sandboxed iframes, postMessage, Vitest, existing plugin ZIP release pipeline.

**Spec:** `docs/superpowers/specs/2026-09-30-plugin-host-panels-design.md` (approved).

## Global constraints

- No parent DOM access is granted. Keep the existing iframe sandbox and authenticated host API path.
- Allow at most one panel per owning screen and reject nested panel requests.
- Never accept a plugin-supplied shell URL or tenant override.
- Do not persist draft form data in browser storage.
- Preserve fields, validation, permissions, record versions, payments, attachments and localization.
- Source changes alone do not update installed ZIPs: verify published and installed versions in preview.

## Review focus

1. Save races with close: busy editors remain open, failed saves preserve input (tasks 2–3).
2. Old frame messages after tenant/session change cannot reach a new editor (tasks 1–2).
3. Tab/Shift+Tab and Escape cross the iframe boundary correctly (tasks 1–2, browser verification).
4. Plugins on older hosts retain a usable inline fallback (tasks 1 and 3).
5. Installed optional plugin versions may remain stale after catalog upload (task 4).

## Task 1: Typed UI protocol and shell handshake

**Files:** Create `packages/studio-shared/src/plugin-panels.ts` and `packages/studio-shared/test/plugin-panels.test.ts`; modify `packages/studio-shared/src/plugin-api.ts`, package exports if needed, `packages/studio-server/src/plugin-store.ts`, and `packages/studio-server/test/plugin-store.test.ts`.

**Interfaces:** Define `PluginPanelRequest = { view: "record-editor"; title: string; params: { recordId?: string; mode?: "details" | "payment" } }`; `PluginPanelResult = { status: "saved" | "cancelled" }`; `PluginPanelState = { dirty: boolean; busy: boolean }`; `PluginPanelContext = { panelId: string; request: PluginPanelRequest }`.

Optional `PluginApi.ui` exposes `openPanel(request): Promise<PluginPanelResult>`, `panel: PluginPanelContext | null`, `setPanelState(state): void`, `requestClose(): void`, and `completePanel(result): void`. The protocol module provides `parsePanelRequest(value: unknown): PluginPanelRequest | null` and discriminated messages with namespace, protocol version, owner session, request ID and panel ID where applicable.

- [ ] Add failing tests: reject unknown views, extra tenant/URL overrides, record IDs over 256 characters, titles over 160 characters, invalid modes, and payloads over 4 KiB. Assert accepted requests round-trip without executable values.
- [ ] Run `pnpm --filter @savia/studio-shared test` and confirm the new tests fail for the missing protocol.
- [ ] Implement types and validation; add shell handshake before rendering. Accept messages only from `parent`. Keep API request timeouts separate from potentially long-lived open-panel requests; settle pending UI requests on disposal.
- [ ] Extend shell tests: verified initialization provides context before render; spoofed initialization is ignored; unsupported host handshake falls back within 2 seconds without exposing a nonfunctional UI capability. A panel handshake failure shows an error rather than accidentally rendering the list.
- [ ] Run shared and server plugin-store tests; confirm all pass. Commit `feat: add isolated plugin panel protocol`.

## Task 2: Host overlay and frame lifecycle

**Files:** Create `apps/admin/src/features/studio-engine/plugin-host-panel.tsx`, `plugin-panel-controller.ts`, and corresponding tests under `test/`; modify `custom-plugin-frame.tsx` and `test/custom-plugin-frame.test.tsx`. Add localized panel messages in the existing locale infrastructure.

**Interfaces:** `PluginHostPanel` receives a verified request, derived shell/screen identity, and controller callbacks. `createPluginPanelController` owns the open request, frame session, dirty/busy state, close requests and completion; it consumes Task 1 types. Do not duplicate collection authorization or route requests around `pluginApiFetch`.

- [ ] Add failing controller/frame tests: only owner source opens; duplicate/nested opens reject; same-plugin shell is derived by host; stale/session-changed messages are ignored; save refresh result is delivered once; owner unmount disposes panel.
- [ ] Run focused admin tests and confirm failures for missing functionality.
- [ ] Implement the host dialog using existing primitives, portalled outside the screen iframe, above the assistant. Desktop width is `min(960px, 100vw)` with full viewport height; mobile uses full viewport. Keep the original list frame mounted and prevent duplicate shell headers.
- [ ] Implement dirty-discard confirmation for all normal close paths; block ordinary close while busy. Make readiness timeout/retry explicit and require discard confirmation before retrying a dirty frame. Session invalidation forces teardown and invalidates outstanding requests.
- [ ] Add tests for busy save/close races, failed frame, dirty Escape/backdrop/Cancel, and focus restoration. Implement a boundary-focus message so keyboard users can traverse host controls and iframe contents without escaping the dialog.
- [ ] Run focused admin tests; confirm pass. Commit `feat: host plugin editors in application panels`.

## Task 3: Shared editor migration for all affected plugins

**Files:** Modify `packages/insurance-workbench/src/workbench.tsx`, `editor.tsx`, `drawer.tsx`, `workbench.css`, and `messages.ts`; create editor lifecycle helper/tests and DOM integration tests in the existing admin test environment. Inspect all 11 `packages/insurance-{activities,collections,commissions,claims,compliance,issuance,endorsements,documents,opportunities,service,renewals}/src/admin.tsx` entry points and their `store-ports` wrappers.

**Interfaces:** Workbench uses `savia.ui.panel` to render only `RecordEditor`; main-mode create/manage actions await `openPanel`. Editor accepts an embedded presentation and reports state through Task 1 API. Load existing records via `savia.collections.collection(config.object).get(recordId)`; create uses existing defaults.

- [ ] Add failing tests: main mode opens a panel without local drawer; editor mode loads one record and no list; create defaults survive; saved result refreshes list while cancelled does not; no capability preserves the existing inline path.
- [ ] Run focused Workbench/admin tests and confirm expected failures.
- [ ] Split editor content from drawer framing. Keep footer visible with a grid/flex layout and field-only scrolling; remove duplicate close/header in hosted mode. Track actual changes and busy state, including payment mode and attachment operations, without browser persistence.
- [ ] Add integration assertions for create/update/version conflict, payment and attachments, cancellation preserving list filters/page, and retry preserving input. Ensure all 11 plugin entry points use the shared editor path and do not start unrelated screen-only effects in panel mode.
- [ ] Run Workbench tests and all affected plugin tests/type checks; confirm pass. Commit `feat: migrate workbench editors to host panels`.

## Task 4: Documentation, artifacts, browser review and preview

**Files:** Update `docs/plugin-store.md` and `docs/onboarding/08-plugins.md`; update affected `store-ports/<name>/savia-extension.json` release versions and associated manifests according to existing release conventions. Use existing packaging/publishing scripts; retain optional installation status.

- [ ] Document capability detection, editor-only bootstrap, save/close protocol and isolation requirements. Add release checks proving all 11 ZIPs contain the migrated shared editor.
- [ ] Build affected artifacts using `scripts/pack-store-plugin.mjs` and the existing release pipeline; run store-port and deployment-script checks, repository type checks and required CI.
- [ ] Inspect desktop and mobile together in a browser: full-window coverage, visible footer, no assistant overlap, Tab/Shift+Tab across iframe, Escape/discard, slow load, save failure, and restoration of the list. Correct findings and perform one confirmation round.
- [ ] Perform whole-branch review focused on protocol ownership and lifecycle. Create/attach PR, address findings and merge after required checks pass.
- [ ] Deploy host/shell and publish ZIPs to preview through existing workflows. Update already-installed affected plugins in preview without enabling plugins the tenant has not installed; verify installed versions rather than relying on catalog upload alone.
- [ ] Verify preview Cartera create/edit plus representative payment/attachment flows and all 11 available editor entry points. Report any unavailable real-data flow explicitly. Commit final docs/release changes with conventional commit messages.

## Execution recommendation

Use native execution in this session, with a fresh final reviewer. The protocol,
host lifecycle and shared editor are tightly dependent; sequential implementation
avoids concurrent changes to the same interfaces. No production deployment is
included.
