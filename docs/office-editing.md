# Office documents and editing

Owner: Savia platform team. Reviewed: 2026-10-02.

Savia opens DOCX, XLSX and PPTX attachments in a separate `/office/` tab using
ZetaOffice (LibreOffice compiled to WebAssembly). The document engine runs in the
browser; authenticated Savia endpoints keep Savia-hosted file bytes in R2 and
revision metadata in D1. Connected Google Drive and OneDrive documents are stored
by their provider; Savia persists private document references in D1. No browser
database is used for either workflow.

## User workflow

Open **Office suite** from the sidebar to create a Document (DOCX), Spreadsheet
(XLSX), or Presentation (PPTX). Choose a type and name inline, then select
**Create and save**. The saved-document list opens each file in a separate editor
tab. Files are private to their owner and active workspace; document bytes stay
in R2 and metadata and immutable revision history stay in D1. Returning to the
list refreshes its current versions. There is no browser document persistence.

The editor shows a discreet ZetaOffice attribution in its loading screen and
footer. Product navigation and creation controls use **Office suite**.
The editor uses the native ZetaOffice interface, including its menus, toolbars,
rulers and sidebar. Savia provides the document header, save action and revision
history around the native editor.

## Connected Google Drive and OneDrive documents

In **Office suite**, choose the document type, name and where it should be
created. **Savia** uses the native WASM editor. Google Drive, OneDrive Personal
and OneDrive for Business appear only when the user's own integration is
configured and connected. Connect or reconnect accounts through **My integrations**.

Google Drive creates a native Google document, spreadsheet or presentation.
OneDrive receives a valid blank DOCX, XLSX or PPTX file under the requested name.
A filename conflict is rejected rather than overwriting an existing file.
Creation uses the existing
server-side Nango connection belonging to the caller. OAuth tokens and Nango
connection identifiers are never exposed to the frontend.

After the provider creates the file and Savia saves its reference, the provider's
editor opens in a separate tab. If the browser blocks the new tab, use the saved
link in Savia. The saved-document list identifies the provider and retains the
link after a refresh. File contents and future edits remain with the provider;
these entries do not have Savia R2 revisions or automatic synchronization.
Disconnecting an integration stops new creation but preserves existing references.
Provider permissions still govern who can open each external document.

Creation requests use a stable request ID for the same attempt. A retry does not
silently repeat an uncertain external creation. Check the provider's files if a
request reports an unresolved outcome; creating again with a new attempt can
produce another document. Creating a reference does not publish the file or
create an anonymous sharing permission.

The implementation follows Google's [files.create API](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create)
and Microsoft's [driveItem content upload API](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0).
Google OAuth requires a writable Drive scope such as `drive.file`; Microsoft
requires a delegated permission such as `Files.ReadWrite`. An existing connection
with insufficient consent may need to be reauthorized.

## Tenant availability

In **Tenants → Edit**, platform administrators can allow or block the Office
suite for an individual tenant. In **Service credentials → Office suite**, a
tenant administrator can enable or disable it for their own workspace. Platform
administrators can manage both settings there by selecting a tenant.

Availability requires both **Allowed by platform** and **Enabled for tenant**.
A tenant administrator cannot override a platform restriction. Both settings
are persisted in D1 and default to enabled when no policy has been saved.
The same availability policy applies to connected document creation and listings.
Disabling removes creation and editing controls and rejects direct Office API
access, including existing editor links. Stored documents and revisions are
preserved and become accessible again after re-enabling. Ordinary attachment
uploads and downloads continue to use their existing permissions.

In a saved record's **Documents** tab, choose **Create file**, select Document
(DOCX), Spreadsheet (XLSX), or Presentation (PPTX), and enter a name. **Create and
attach** uploads a blank file through the existing attachment endpoint. Creation expands inline instead of opening a modal. After
the upload succeeds, **Open in the office suite** opens that attachment for editing.
Edits saved in the editor create revisions of the same attachment.

Attachment fields also offer **Create file** for formats allowed by their
configured MIME policy. These files join the form's pending attachments and
follow its normal upload/save flow; a new record must be saved before editing
its attachments. Existing file-count, size and server permission checks apply.
Blank templates are bundled static assets and contain no user data.

Open an existing supported attachment with **Editar**. Edit the document and press
**Guardar** (or Ctrl/Cmd+S). The native editor Save action also requests a Savia save.
Every successful save creates a revision; **Historial de versiones** downloads old
versions. **Descargar copia** exports the current in-memory document, including when
saving fails or the session expires. Closing with unsaved changes prompts the user.

A stale save returns a conflict and keeps the draft in the current tab. Download a
copy before reopening the newest version; there is no automatic merge. Temporary
attachments must first be attached to a saved record. Read-only fields cannot be
edited. Existing collection/domain permissions apply to all revision operations.

Saved attachments can also be copied to OneDrive or sent through Outlook after a separate review and confirmation. See [Documents and deliveries](guides/document-delivery.md). These actions use the saved revision; save Office edits first.

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

For an isolated admin preview against an API on another local port, set
`SAVIA_DEV_API_URL` when starting Vite, for example
`SAVIA_DEV_API_URL=http://127.0.0.1:8798 pnpm --filter @savia/admin exec vite --port 5183`.
The default proxy target remains port 8787. Start the matching authentication
worker and configure its public origin and callback for that admin origin.

During development, reload the editor tab after changing its source; the page-global
WASM engine cannot be recreated by React hot reload.

Use HTTPS in deployment, or localhost in development. The gateway sets COOP
`same-origin` and COEP `require-corp` on the editor; SharedArrayBuffer is required.
These isolation headers do not apply to the normal admin UI.

## Deployment

Apply the normal application D1 migrations, including
`packages/db/migrations/0055_office_revisions.sql` and
`packages/db/migrations/0018_office_documents.sql`,
`packages/db/migrations/0019_office_settings.sql` and
`packages/db/migrations/0020_connected_office_documents.sql`, before deploying the API. The
standalone Studio harness uses `packages/studio-server/migrations/0016_office_revisions.sql`.
Deploy the API and multi-entry admin build through the existing deployment workflow.
The preview deployment prepares and verifies the pinned runtime, packages it with
Brotli, and uploads its five immutable objects to `savia-documents-preview` before
deploying the gateway. The upload step rejects other buckets and environments.
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
