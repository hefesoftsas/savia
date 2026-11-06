# Office Editing Implementation Plan

**Goal:** Ship direct editing of Office attachments with safe persisted revisions.
**Spec:** ../specs/2026-09-19-office-editing.md
**Execution:** Native in this existing worktree, preserving pre-existing changes. User requested implementation after the spike.

## Task 1: Revision API

- [x] Add real D1/R2 tests against createCrmApp; observe metadata/save failures before registration.
- [x] Add shared Office format and bounded ZIP validation, revision migrations, and focused office-files routes.
- [x] Use guard + transaction for expected file/record versions; retain original blobs; keep revisions inaccessible after deletion.
- [x] Test old/latest downloads, format/size rejection, concurrent saves, cross-tenant access and storage failure.

## Task 2: Isolated runtime and editor

- [x] Test allowed editor URLs, isolated gateway headers, resource routing and save/error states.
- [x] Add pinned runtime manifest/preparation script, local asset plugin and R2 gateway handler.
- [x] Add /office/ entry and runtime adapter using an UNO worker with macros/external updates disabled.
- [x] Add attachment entry points, dirty guard, revision history and recovery download.

## Task 3: Verification and guide

- [x] Run focused tests, typechecks/build, browser round trip and regression checks appropriate to touched packages.
- [x] Write docs/office-editing.md with setup/deployment/migration commands and limitations.
- [x] Review the completed diff independently and address material findings.

## Shared interfaces

GET /api/file/:id/office -> {data:{id,name,mime,version,size,field,maxSize,object,recordId}}
GET /api/file/:id/revisions -> {data:[{version,size,created_at,created_by}]}
GET /api/file/:id/revisions/:version/download -> version-specific bytes
POST /api/file/:id/revisions -> multipart file + version; 201 {data:{version,...}}; 409 on conflict.
Runtime adapter: open(bytes,name), save()->Uint8Array; onDirty(), onError(Error).

## Review focus

Cross-tenant IDs; concurrent saves and deletion; runtime missing/blocked; save failure retains draft; browser isolation/PWA routing.

## Verification evidence (2026-09-19)

- Full CRM server suite: 16 files, 125 tests passed. Final focused revision,
  archive-validation and attachment-operation suite: 25 tests passed.
- Authenticated dynamic CRM and generated API publication suites: 12 tests passed.
- Admin gateway, attachment entry points, record detail, PWA isolation and editor
  state/lifecycle tests passed. Cleanup regressions failed before the fix and all
  eight engine/page tests passed afterward.
- Admin, API, CRM server and shared-package TypeScript checks passed.
- Multi-entry Vite build passed; icon import and optional PWA glob warnings remain.
- Browser synthetic round trips used the actual WASM editor and real local D1/R2:
  DOCX text persisted; XLSX A2 became 2000 while C2 retained =SUM(A2:B2) and cached
  value 2190; PPTX title gained “ - Saved”. All saved files were reopened and also
  decoded independently with python-docx, openpyxl and python-pptx.
- Native toolbar Save, revision history, desktop layout and a 390 px shell checked.
  The upstream desktop canvas still requires horizontal navigation on small screens.
- Independent review findings addressed: actual bounded ZIP inflation, deletion
  races, late edits during upload, duplicate runtime startup and worker cleanup.
- No production deployment was performed. The guide documents migrations and
  uploading the prepared, verified Brotli runtime objects.
