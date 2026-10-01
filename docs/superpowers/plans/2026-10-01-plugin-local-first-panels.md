# Reusable Local-first Plugin Editors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open prepared plugin editors without repeating iframe startup, and save eligible edits through the existing durable local replica with honest synchronization status.

**Architecture:** Add an opt-in reusable editor lifecycle to the sandbox bridge and retain one standby frame per mounted plugin screen. Add an explicit local-record API without changing legacy collection API commit semantics. Reuse the selected workspace's existing transport, outbox and synchronization UI.

**Tech Stack:** React, TypeScript, sandboxed iframes, postMessage, existing Dexie replica, Vitest and the browser runtime. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-01-plugin-local-first-panels-design.md`

## Global Constraints

- Implement and verify locally before preview deployment.
- Retain the 640 px desktop drawer, full-width mobile layout and fixed actions.
- Keep source-window, session and activation validation; no arbitrary frame URLs.
- At most one standby editor per mounted plugin screen; no persistent executable storage.
- Reuse the existing scoped replica and outbox; no Jotai or second database.
- Preserve old plugin network-confirmed write semantics.
- Files, credentials, integrations, bulk operations and business actions stay remote.
- Server authorization and collection capability remain authoritative.
- Preserve drafts on write failure and pending work on synchronization failure.
- Code, tests and documentation are in English; UI copy uses existing localization.

## Review Focus

- Cancelling before handshake and immediately reopening must not accept the old reply (Tasks 1–2).
- Prepared frames must remain inert and execute no business effects (Tasks 1–3).
- Pending records and stale versions must not bypass conflict protection (Tasks 4–5).
- Logout, tenant changes and installation replacement must invalidate both frames (Tasks 2, 6).
- Remote/payment operations must not inherit optimistic local-success semantics (Tasks 4–5).

## Ownership and execution

Implement the tightly coupled protocol and host steps sequentially in this chat.
Use bounded review assistance under repository orchestration rules; do not create
sidebar tasks. Review the complete branch before local browser acceptance.

### Task 1: Reusable sandbox lifecycle

**Files:** `packages/studio-shared/src/plugin-panels.ts`,
`packages/studio-shared/test/plugin-panels.test.ts`,
`packages/studio-server/src/plugin-store.ts`,
`packages/studio-server/test/plugin-store.test.ts`.

**Interfaces:** Extend `PluginPanelApi` with optional
`preparePanel(): void`. Add host messages `activate` carrying
`PluginPanelContext` and `deactivate` carrying the activation ID. Add an explicit
reusable entry export `renderPanel(element, savia): (() => void)`; its return
value is mandatory cleanup. Legacy `render` remains unchanged. The shell, not
the React app, owns the active renderer and invokes its cleanup.

- [ ] Add failing protocol tests: two activations use distinct panel IDs; old
      activation state/results are ignored; a foreign source/session is rejected;
      deactivation cleans up once; prepare does not invoke render or records APIs.
- [ ] Run `pnpm --filter @savia/studio-shared test` and the server plugin-store
      suite; confirm the new lifecycle assertions fail before implementation.
- [ ] Implement optional preparation negotiation, idle editor initialization,
      activation/deactivation and renderer cleanup. Keep the serialized bridge
      self-contained under esbuild `keepNames`; use the existing transform regression.
- [ ] Version every bridge request with its activation ID when in editor mode.
      Drop stale replies after deactivation, including legacy API bridge replies.
- [ ] Test unsupported ports and old hosts retain the existing fresh-frame path,
      and an absent `renderPanel` never executes list rendering in standby mode.
- [ ] Run both suites and commit `feat: add reusable sandbox editor lifecycle`.

### Task 2: Stable host drawer and cancellable preparation

**Files:** `apps/admin/src/features/studio-engine/custom-plugin-frame.tsx`,
`plugin-panel-controller.ts`, `plugin-host-panel.tsx`, and their tests under
`apps/admin/src/features/studio-engine/test/`.

**Interfaces:** Consume Task 1's messages. Extend controller state with
`phase: "loading" | "active"`; mutation `busy` remains separate.
Keep the child iframe in one stable mounted container while the drawer opens
and closes. Bind API responses to frame generation plus activation ID.

- [ ] Add failing tests: prepare/open/close/reopen keeps the same iframe element;
      each activation gets a new ID; loading can close; active writes cannot close;
      delayed replies cannot mutate a replacement activation.
- [ ] Run the controller and CustomPluginFrame tests and observe these failures.
- [ ] Implement the retained child container and explicit visibility lifecycle.
      A closed standby frame is hidden, inert and absent from the tab sequence.
      Do not move the iframe between different React parents or portal containers.
- [ ] Dispose both frames on parent navigation, session/identity change and
      installation invalidation. Clear readiness and pending callbacks on disposal.
- [ ] Keep bounded timeout/retry, dirty confirmation, focus transfer and the
      existing responsive drawer; permit closing during loading immediately.
- [ ] Run host tests, including error/retry and stale-generation cases, and commit
      `feat: retain prepared plugin drawers and cancel loading`.

### Task 3: Workbench opt-in and clean editor mounts

**Files:** `packages/insurance-workbench/src/workbench.tsx`,
`hosted-record-editor.tsx`, `test/hosted-editor.test.tsx`; `entry.tsx` under the
11 affected `store-ports`: activities, collections, commissions, claims,
compliance, issuance, endorsements, documents, opportunities, service, renewals.

**Interfaces:** Workbench calls `savia.ui?.preparePanel?.()` after list readiness.
Each upgraded port's `renderPanel` creates a React root and returns its unmount
function. The existing `render` entry and inline fallback stay compatible.

- [ ] Add failing tests: closing and reopening New restores defaults; editing A
      then B loads B; preparing never runs renewals backfill or compliance templates;
      prior operations cannot update an unmounted editor.
- [ ] Run the Workbench tests to establish failure.
- [ ] Add the explicit port exports and Workbench preparation call. Each activation
      mounts a fresh editor; preparation must not mount the ordinary plugin screen.
- [ ] Run tests for all 11 real entrypoints and the package typecheck; commit
      `feat: prepare workbench editors without retaining drafts`.

### Task 4: Explicit local record transport and receipt contract

**Files:** create `apps/admin/src/features/studio-engine/plugin-record-transport.ts`
and `test/plugin-record-transport.test.ts`; modify `custom-plugin-frame.tsx`,
`packages/studio-shared/src/plugin-api.ts`,
`packages/studio-server/src/plugin-store.ts`,
`apps/admin/src/local-data/transport.ts` and its tests only as required to expose
an existing mutation identity without creating new storage.

**Interfaces:** Add optional `PluginApi.localRecords` exposing
`collection<T>(name): PluginLocalCollection<T>`. Reads match existing list/get/
describe methods. Writes return
`PluginRecordReceipt<T> = { data: T; persistence: "local" | "server"; mutationId?: string }`.
The bridge marks these requests with `consistency: "local-first"`.
Legacy `collections` methods keep network semantics. A host helper
`pluginRecordFetch(path, init, consistency)` routes only approved record and
metadata operations to `getStudioRuntime().localWorkspace.transport`.

- [ ] Add failing tests using a real fake-indexeddb workspace: hydrated eligible
      records read/write without network; a durable outbox entry exists before a
      local receipt; quota/transaction failure returns no success; remote and
      read-only capabilities retain their behavior.
- [ ] Add tests that files, settings, actions, arbitrary routes and bulk requests
      cannot request local persistence through this API.
- [ ] Run tests and confirm the missing opt-in transport/receipt fails.
- [ ] Implement the explicit SDK methods and validated routing. Delegate schema,
      version, authorization, hydration and capability decisions to existing local
      transport. Return network receipts when that transport uses a remote collection.
- [ ] Preserve the mutation identity produced by the durable transaction. Never
      infer synchronization success from connectivity or an empty request queue.
- [ ] Run local transport, access-revocation and bridge suites; commit
      `feat: expose scoped local-first records to opted-in plugins`.

### Task 5: Honest editor results and list reconciliation

**Files:** `packages/insurance-workbench/src/editor.tsx`,
`hosted-record-editor.tsx`, `workbench.tsx`, `localization.ts`,
`packages/studio-shared/src/plugin-panels.ts`,
`apps/admin/src/features/studio-engine/custom-plugin-frame.tsx`,
`apps/admin/src/local-data/sync-status.tsx`, and focused tests beside each.

**Interfaces:** Extend saved `PluginPanelResult` with optional persistence and
mutation identity. Workbench details mode opts into Task 4. Payment mode and
custom business actions retain legacy network methods. Add a scoped host-to-
plugin `records-changed` notification sourced from existing replica updates;
it cannot reset list filters, scroll or an active draft.

- [ ] Add failing tests: local save closes only after transaction commit and
      reports pending; remote save waits for acknowledgement; failed local writes
      preserve drafts; payment/actions never receive a local-success receipt.
- [ ] Add tests for pending-record reopen, server conflict and delayed sync
      acknowledgement; newer local edits must remain intact.
- [ ] Implement localized local/server result copy and list refresh from the
      opted-in record API. Surface pending/conflict status using the existing sync
      panel and a visible plugin status hint rather than claiming backend success.
- [ ] Connect scoped replica notifications to mounted-list refresh without
      reloading an active editor or resetting filters and scroll.
- [ ] Run Workbench, sync-status and host tests; commit
      `feat: distinguish local plugin saves from synchronized records`.

### Task 6: Local end-to-end acceptance and documentation

**Files:** local-only review fixtures following existing fixtures under
`apps/admin/src/local-data/test/fixtures/`; regression tests in local-data and
plugin packages; update `docs/plugin-store.md`, `docs/local-first-collections.md`
and `docs/onboarding/08-plugins.md`.

- [ ] Run relevant protocol, host, Workbench, transport, store, sync, session,
      access-revocation and server suites, full typecheck and contract tests.
- [ ] Use the browser runtime with real sandboxed frames and a real local replica.
      Measure cold and prepared openings separately; verify identical iframe reuse
      and fresh editor state instead of relying on a changed loading label.
- [ ] Test desktop and 390 x 844: footer, scroll, focus, Escape, cancellation during
      delayed startup, failed preload/retry and reduced motion.
- [ ] Disconnect the local test transport after hydration; save, reload, inspect
      the durable pending record, reconnect and verify exactly-once synchronization
      against a controlled backend. Report unavailable backend checks explicitly.
- [ ] Test account/tenant switch, revoked authorization and plugin replacement;
      verify no standby editor or stale response survives scope invalidation.
- [ ] Review the full diff independently and fix findings. Remove temporary
      fixtures not intended as maintained tests; stop temporary servers.
- [ ] Update guides with the opt-in API, lifecycle, pending/conflict semantics,
      offline prerequisites and limitations. Commit the validated milestone.
- [ ] Report local acceptance evidence before any preview rollout. If proceeding
      to release, version changed immutable artifacts and update only previously
      active installations after CI; do not enable disabled/uninstalled plugins.

## Local acceptance — October 1, 2026

Implementation is on `codex/plugin-local-first-panels`. The local milestone covers
all eleven Workbench ports; release packaging and preview rollout are separate.

- Real sandboxed Collections bundle, host drawer and IndexedDB replica exercised
  against a controlled localhost HTTP sync backend. Prepared reopening took
  289 ms in one automation-inclusive sample; this is not a preview performance SLA.
- Offline creation and editing returned durable pending receipts. A pending edit
  survived page reload. Reconnection produced two unique mutation receipts for
  two operations, one resulting record at version 2, and an empty pending queue.
- Desktop and 390 × 844 layout, fixed actions, discard confirmation, fresh defaults
  after closing and reopening, and Escape closing were checked in the browser.
- Automated coverage includes actual `renderPanel` exports for all eleven ports,
  stale activation requests/replies, cancellation, immediate preload retry,
  installation version invalidation, authorization revocation, local failure,
  delete version preservation, network payments and conflict notice reconciliation.
- Final focused suites: 140 Admin tests, 49 Workbench tests, 252 shared tests,
  and 43 server tests passed; one existing server case was skipped. Contract
  checks and the full monorepo typecheck passed.
- No production/preview data was written. No NAS persistence test, full repository
  test run, or cold offline application installation was performed. Temporary
  local review pages and servers were removed/stopped.

Decisions made during implementation: lifecycle callbacks stay internal to the
serialized shell; the public capability is `preparePanel`. The retained drawer
uses permanently mounted nonmodal Radix content with explicit background inertness,
focus confinement and scroll locking so a closed frame cannot block the app.
Disposed sessions reject subsequent bridge requests. Reusable ports must use their
activation-bound SDK rather than ambient `fetch`; this deliberately trades raw-fetch
compatibility for isolation from asynchronous work belonging to a closed editor.
Legacy nonreusable ports retain their existing API behavior.
