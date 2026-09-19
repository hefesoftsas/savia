# Audit and Duplicate Implementation Plan

**Goal:** Finish a permission audit browser and safe local record duplication.
**Architecture:** Extend existing access routes and role UI; reuse existing creation forms and local persistence.
**Spec:** ../specs/2026-09-19-audit-and-duplicate-design.md

## Tasks

1. Add authenticated audit list/detail routes with generated schemas, scoped keyset pagination, bounded filters and tests. Extend the typed access client. Validate cross-scope denial, malformed cursors, timestamp ties and snapshot omission from lists.
2. Add the lazy Audit tab and detail comparison using existing UI components. Cover paging/filter resets, delayed detail fetches, retry, scope changes and authorization errors.
3. Add safe duplication projection and wire it into existing record actions/create flow. Test unique/readonly/identity/relation/attachment omission, source immutability, unsupported capability exclusion and explicit create-only save.
4. Verify focused tests, typechecks, accessibility and desktop/mobile visual behavior. Update docs, perform independent review, integrate current main without overwriting other agents, push and verify CI/deployment.

## API contract

GET /v1/access-control/audit?scope=...&limit=25&cursor=...&action=...&actorId=...&targetId=...&from=...&to=...
Returns { data: Array<{id,scope,actor:{id,displayName},action,targetId,createdAt}>, nextCursor: string|null }.
GET /v1/access-control/audit/{id}?scope=... returns a summary plus {before: unknown, after: unknown}.
Client exports AccessAuditPage, AccessAuditEntry, AccessAuditDetail, AuditFilters and methods listAudit(scope, filters), getAudit(scope,id).

## Review focus

- Audit data from another scope or previous session never remains visible on a new authorization failure.
- Same timestamp entries and newly inserted events do not duplicate older pages.
- History preserves removed role/actor identifiers without joining away events.
- Copying never keeps identity/unique values or silently copies related records/files.
- Cancelled/failed duplicate creation never edits its source or clears another form's draft.

## Completion evidence

- Implemented both features and updated their guides and generated API types.
- Independent review found a configurable ownership field omission; a regression test reproduced it and the projection now excludes that field.
- Admin suite: 832/837 initially passed; all five timing-sensitive failures passed in an isolated 62-test rerun, including the final audit and duplication tests.
- API suite: 403/404 initially passed; the timed-out public-form integration passed in an isolated 14-test rerun.
- Admin/API TypeScript checks and all 56 contract tests passed.
- Audit history and details were inspected at desktop and mobile widths using synthetic fixtures. Mobile actions remain visible without horizontal scrolling. The UI detector reported no findings.
- Changed files pass formatting checks except `dynamic-form.tsx`, whose existing formatting is preserved to avoid unrelated changes; its only addition is the transient-draft prop.
