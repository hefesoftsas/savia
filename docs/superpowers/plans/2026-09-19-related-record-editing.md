# Related record editing implementation plan

**Goal:** Create and edit a local parent record and its related records from one low-code form, with atomic persistence and recoverable drafts.
**Architecture:** Extend local relation field metadata with presentation settings. A bounded record-bundle endpoint validates and commits parent, children and link changes in one D1 batch. The frontend stages child edits until the parent form is submitted. Existing collection adapters remain selector-only.
**Tech stack:** Existing React form engine, TanStack Query, IndexedDB workspace, Hono, D1 and shared Zod metadata.
**Spec:** User-approved in-chat proposal: relation selectors, subforms and editable tables; create/link/edit related rows; configurable fields and permissions; explicit unlinking; consistent save; local drafts and on-demand details.

## Global constraints

- Preserve existing selector behavior and tenant authorization; no arbitrary target collection supplied by client.
- One level of related editing, at most 100 rows and 10 relation groups per submission, local collections only.
- Require parent/edited-child versions and an idempotency key. Reject all changes on invalid data, conflict, cardinality or permission failure.
- Unlink never deletes source records. No cascade UI deletion in this feature.
- Existing workflow agent owns workflows; emit existing hooks only after successful persistence, do not change workflow semantics.

## Contract

`POST /api/record-bundles/:object` accepts `{record:{id?,version?,data},relations:[{relationId,previousIds?,rows:[{id?,version?,data?}]}]}`. Rows with only id link existing records; data without id creates; id+version+data edits. Each supplied group replaces the parent link selection; omitted groups are unchanged. Returns `{data:parent,related:[{relationId,records:children}]}`. Error responses include a human-readable message with relation/row context. API scopes tenant from authenticated gateway, never body.

Field metadata: `config.relationPresentation` is `selector|subform|table` (default selector); `config.relationFields` optional ordered field names. Only bound local relation fields support non-selector presentations. Table requires to-many. Exclude nested relations and attachment upload fields from child editing in v1, with visible explanation.

## Tasks

- [x] Backend: write rollback, conflict, tenant isolation, replay, cardinality and unlink tests; implement preparation of CRM write statements and atomic bundle endpoint; wire authenticated gateway and generated dynamic API docs.
- [x] Frontend: stage related rows without network writes; lazy-load schema and selected page; render subform/table and link picker; validate child fields; expose errors without dropping edits; integrate parent save callback.
- [x] Designer/shared metadata: validate presentation/field settings; expose settings beside relation binding; preserve required/read-only fields; document supported local scope.
- [x] Integration/drafts: pass bundles through parent save; persist scoped drafts locally, restore/reconcile saved versions, clear only after success; trigger collection refresh for affected objects.
- [x] Verification: exercise create/edit/link/unlink end to end, inspect visual layouts, run focused then relevant broad tests, typecheck, regenerate API docs, review diff and push main.

## Review focus

- A concurrent edit to any child leaves the entire bundle unchanged.
- Replaying after a lost response cannot duplicate children or events.
- A relation/schema/tenant change cannot publish a stale or unauthorized link.
- Closing/reopening or failed/offline saves preserve edits without mixing tenant scopes.
- Large associations are paginated and cannot silently drop unvisited rows.

## Verification evidence

- Shared metadata suite: 95 tests passed.
- Backend bundle, relation and realtime suite: 31 tests passed; after immutable automation delivery was added, all 14 bundle tests and 10 operations tests passed again.
- Draft wrapper/storage and legacy selector suite: 24 tests passed, including offline restoration, readonly creation defaults, original versions and stale-writer cleanup.
- Editor, related form, legacy selector and date/contact field regression suite: 20 tests passed.
- Save synchronization, designer settings and relation binding suite: 7 tests passed.
- Independent review identified six issues; all were corrected and re-reviewed with no remaining findings.
- Browser verification exercised a real inline subform with parent/child field-name collisions and an atomic submission payload. Further mobile interactions could not be completed because browser commands timed out; no mobile verification claim is made.

- Final admin, API and CRM server TypeScript checks passed; contract tests and staged release hygiene checks passed.
