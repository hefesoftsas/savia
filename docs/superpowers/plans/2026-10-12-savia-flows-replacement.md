# Savia Flows replacement implementation

Spec: `docs/superpowers/specs/2026-10-12-savia-flows-replacement.md`.
Execution: current managed worktree, at most two Luna workers with disjoint files.
Global constraints: local Miniflare, no external services, backend persistence,
preserve unrelated edits, English code/tests/docs, no commits or deployment.

## Task 1: Adopt the transactional runtime and private adapter

Owner: backend worker. Move `packages/studio-server/src/workflows/*` into
`apps/flows/packages/native/src/*`, expose `@savia/flows-native`, update active Core
and Studio imports, retain compatibility exports, update package dependencies.
Preserve existing contracts and database state. Add optional validated graph
positions to shared workflow definitions. Implement the private signed Core host
adapter with method/path allowlist, fresh authorization, objects/catalog and
inventory, and native route dispatch. Register it in Core. Test identity forgery,
scope, permissions, replay-safe in-place adoption and original engine behavior.
Do not modify Flows API/app or Admin files. Report at `/tmp/savia-flows-native-backend-report.md`.

## Task 2: Native catalog and visual editor

Owner: UI worker. Add a native-flow service using `/{org}/savia/native/*` in
`apps/flows/app`, list native flows in the main Flows catalog, support creation
and URL-addressable graph editing, all original typed controls, webhook endpoint
and destination management, immutable publish/activation, manual input, history,
failed-step retry/cancel, inbox resolution and bundle preparation. Reuse current
Studio property forms after adapting UI imports. Replace the sequence canvas
with React Flow handles for next/true/false; validate connections and persist
positions in `definition.positions`. No client storage. Match Savia tokens,
mobile overlays and accessible node selection. Root supplies the private API.
Own only Flows app files; root owns Admin retirement and shared dependencies.
Report at `/tmp/savia-flows-native-ui-report.md`.

## Task 3: Flows API bridge and composition

Owner: root. Add a body-bound native-host client and tenant routes with the same
allowlist, session-only identity, and private service binding. Preserve imported
implementations. Cover local host round trips and current permissions. The
optional composition node in the spec is a subsequent capability: Studio did
not support subflows, and replacement parity is provided by the native mode.

## Task 4: Retire the old UI and unify causation

Owner: root. Replace Studio workflow navigation with a tenant-preserving Flows
link; retain compatibility APIs. Ensure legacy/new collection write contexts carry
shared ancestry and depth before scheduler or event dispatch can recurse.
Update guides, migration instructions and ownership references.

## Task 5: Integration, review and verification

Owner: root plus read-only reviewer. Validate relocated original suites and new
native flows locally, all node and trigger semantics, save/publish/layout,
inbox/webhooks/retry/cancel, tenant and revocation boundaries. Inspect Chrome
graph and narrow layout. Run type checks, host/child builds, source verification,
scoped formatting and diff checks. Record actual results and limits before final.

## Progress

- Initial audit: old engine has material parity gaps and hard dependencies.
- Design decision: reuse transactional runtime inside Flows; zero-copy backend
  adoption and compatibility endpoints preserve semantics and avoid duplicate runs.
- User clarified test data may be deleted; preservation is optional, parity is required.
- Runtime adoption and native editor implemented; catalog and Core compatibility
  routes use the same canonical definitions and scheduler.
- Native host/geometry and shared causation received red/green checks. Actual
  Miniflare adoption test covers all native step types, same-step retry, inbox,
  webhook secrets/receipts, pinned versions, schedules, revocation and restart.
- Review fixes: compiled extension registry forwarded; Studio is a native runtime
  peer dependency; branch deletion, tenant cache, curl examples and dirty navigation
  fixed. Native permissions intentionally preserve the original host policy.
- Completed execution outputs and blocked-run retry restored in the new UI.
  Mobile nested values, composite label associations and parent theme colors fixed.
- Final local verification: 13 Miniflare integrations, 869 Flows API tests,
  117 UI tests and 324 Studio tests passed (7 Studio tests remain skipped).
  Focused Core/shared/Admin contracts, types, builds, source hashes and formatting
  passed. Evidence and explicit verification limits are in
  `docs/verification/2026-10-12-savia-flows-replacement.md`.
