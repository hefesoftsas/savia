# Direct Office editing

Owner: Savia platform team. Reviewed: 2026-09-19.

Savia opens DOCX, XLSX and PPTX attachments in a separate `/office/` tab using
ZetaOffice (LibreOffice compiled to WebAssembly). The document engine runs in the
browser; authenticated Savia endpoints keep file bytes in R2 and revision metadata
in D1. No editor service, third-party document upload, or browser database is used.

## User workflow

Open an existing supported attachment with **Editar**. Edit the document and press
**Guardar** (or Ctrl/Cmd+S). The native editor Save action also requests a Savia save.
Every successful save creates a revision; **Historial de versiones** downloads old
versions. **Descargar copia** exports the current in-memory document, including when
saving fails or the session expires. Closing with unsaved changes prompts the user.

A stale save returns a conflict and keeps the draft in the current tab. Download a
copy before reopening the newest version; there is no automatic merge. Temporary
attachments must first be attached to a saved record. Read-only fields cannot be
edited. Existing collection/domain permissions apply to all revision operations.

## Local setup

Run from the repository root:

```sh
node scripts/prepare-office-runtime.mjs
pnpm dev
```

The preparation command downloads the five assets pinned by SHA-256 in
`apps/admin/office-runtime.json` into the ignored `.cache/office-runtime/` directory.
It rejects changed upstream assets instead of silently installing a different
build. Vite serves these files only from the allowlisted runtime path. The Office
page is a separate build entry; it does not load the admin bootstrap or register a
service worker. `/office/` is excluded from the PWA navigation and runtime caches.

During development, reload the editor tab after changing its source; the page-global
WASM engine cannot be recreated by React hot reload.

Use HTTPS in deployment, or localhost in development. The gateway sets COOP
`same-origin` and COEP `require-corp` on the editor; SharedArrayBuffer is required.
These isolation headers do not apply to the normal admin UI.

## Deployment

Apply the normal application D1 migrations, including
`packages/db/migrations/0055_office_revisions.sql`, before deploying the API. The
standalone Studio harness uses `packages/studio-server/migrations/0016_office_revisions.sql`.
Deploy the API and multi-entry admin build through the existing deployment workflow.
The rendered admin gateway configuration binds `OFFICE_RUNTIME` to the selected
environment's documents bucket and routes `/office` and `/office/*` through its
worker. Preview and production must use their own configured buckets.

Prepare compressed runtime objects locally:

```sh
node scripts/prepare-office-runtime.mjs
node scripts/package-office-runtime.mjs
```

The second command verifies the raw hashes again and writes Brotli files plus an
`upload/objects.json` inventory under the pinned cache directory. Upload each listed
file to the selected R2 bucket using its exact `key`, `contentType` and
`contentEncoding` metadata. For example, from `apps/admin`, use the environment's
Wrangler configuration and the inventory values:

```sh
pnpm exec wrangler r2 object put "BUCKET/office-runtime/BUILD/soffice.wasm" \
  --file "/ABSOLUTE/CACHE/PATH/upload/soffice.wasm.br" \
  --content-type application/wasm --content-encoding br --remote
```

Repeat for all five inventory entries; paths with spaces must be quoted. The
scripts only prepare files and never upload or deploy. Runtime objects must remain
immutable within a build prefix; use a new manifest/build ID to upgrade. Only
trusted deployment tooling should write that prefix. The gateway serves immutable
runtime assets with same-origin resource policy; missing assets return 503, not the
admin HTML shell. Verify the uploaded metadata before enabling editing for users.

## Persistence and limits

- Maximum edited file: 5 MiB, or the field's smaller configured limit. The field's
  MIME allowlist is rechecked on save.
- ZIP validation checks headers, paths, duplicates, overlap and actual streamed
  expansion, bounded to 64 MiB. Encrypted archives, macros, ZIP64 and legacy binary
  DOC/XLS/PPT formats are rejected. This is not antivirus scanning or complete OOXML
  semantic validation.
- Macros and automatic external-link updates are disabled when opening documents.
- R2 receives a new immutable object before a version-checked D1 transaction updates
  the current pointer, history and audit entry. Conflicts preserve the old revision;
  unreferenced failed uploads are removed when commit status can be established.
- File deletion checks the version transactionally before removing revision blobs.
  A storage cleanup failure can leave inaccessible orphan objects for maintenance.
- Editing is single-user with optimistic conflicts, not collaborative coauthoring.
  There is no offline draft persistence or automatic recovery after closing the tab.
- Prefer a current desktop browser. The shell is responsive, but the embedded Office
  desktop interface is not optimized for phones or screen readers.
- First use downloads approximately 65 MB with the provided Brotli packaging;
  decompressed runtime assets occupy about 262 MB, and working memory is higher.
  Formatting/font fidelity follows LibreOffice import/export; test complex documents
  before relying on an exact Microsoft Office round trip.

## Runtime provenance

The pinned build is the upstream runtime used by ZetaOffice's Web Office demo
(asset metadata dated 2025-05-13). See the manifest for exact source URLs and hashes.
Review upstream releases and refresh the pinned build as part of security maintenance.

- [ZetaOffice and its browser integration](https://zetaoffice.net/)
- [ZetaJS source and MIT license](https://github.com/zetajs/zetajs)
- [LibreOffice licensing and source availability](https://www.libreoffice.org/about-us/licenses/)
- [LibreOffice dispatch interception API](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1frame_1_1XDispatchProviderInterception.html)
- [Cloudflare compression streams](https://developers.cloudflare.com/workers/runtime-apis/web-standards/#compression-streams)

Preserve upstream notices and provide corresponding source/license materials when
distributing the runtime. Savia's bridge code does not relicense upstream binaries.
