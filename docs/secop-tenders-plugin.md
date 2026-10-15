# SECOP tenders and opportunity tracking

`packages/plugin-secop-tenders` is the optional `procurement.secop` plugin. It is
published as a tenant ZIP; procurement behavior does not become platform core.

## Search and follow up

Open **SECOP tenders** in the installed workspace. Search submits your criteria to
`buscar_licitaciones` through the configured MCP connection. The always-visible filters are
entity, department, SECOP status and procurement method. Department, entity and
modality load independent complete catalogs on screen entry through the
`opciones_licitaciones` MCP tool. They do not inherit the current search filters,
keywords or result pagination. Each catalog shows its own loading state, count
and retry action. If a catalog fails, the UI reports the failure instead of
substituting values from loaded tenders. Free text remains accepted.

Opening a filter shows options; typing searches the entire loaded catalog without
case or accent differences. The dropdown progressively renders additional options
when scrolled, and keyboard navigation can advance beyond the initial batch.
Arrow keys and Enter select an option without submitting the search; Escape
dismisses the list. Long entity names wrap within the dropdown. Combine filters, then
select **Search**. Applied criteria remain visible above the results. **Clear
search** resets all criteria and starts a new first page when a search is active. Search buttons and Enter
in search inputs dispatch through React handlers, so searches work inside the
plugin sandbox without allowing native form submissions. Pages come from the
remote limit/offset inputs, 20 rows at a time. Scrolling near the end of the results
loads the next page and appends unique source IDs. **Load more** provides a
keyboard-accessible fallback. Pending searches, additional pages and interest
reads show a small animated loading ring beside their existing status text.
The ring stays static when reduced motion is preferred; loaded cards remain
visible during pagination. The count shows loaded results, not a remote total.
Transient gateway, availability, rate-limit and timeout failures receive one
automatic retry after a short backoff, using the same criteria and page.
Authorization failures and errors without a recognized transient status are
not automatically retried. The host maps some upstream failures to 502; these
also receive the single bounded retry. If a next page
still fails, previous results remain available and **Retry** requests the same
page. Safe messages distinguish authorization and timeout problems; raw upstream
errors and credentials are not shown. New searches reset pagination and ignore late responses from older searches.
Loading stops when SECOP has no next page or returns no new IDs. Values absent
from SECOP are shown as unavailable.

**View in SECOP** opens the supplied process URL in a new browser tab through
Savia's host-mediated external-link bridge. Search cards and saved interests use
the same behavior; the plugin iframe retains its sandbox. An unavailable or
refused link shows recovery guidance rather than silently doing nothing.

## Tender documents and PDF analysis

Choose **Documents** on a search result or saved interest. The tender detail has
**Overview** and **Documents** tabs; returning preserves the current search.
Document lookup uses the tender's exact `id_del_portafolio` to match the public
file dataset's `proceso`, and never associates files by entity or filename alone.
The `documentos_licitacion` read-only MCP tool must be available before installing
version 1.4.0. Missing or ambiguous portfolio associations produce a lookup error
with retry and a link to the official process. Documents load in pages of 20 with explicit
retry and load-more controls. The public file catalog covers documents since 2025;
an empty catalog does not prove that the SECOP process has no attachments.

**Analyze this PDF** downloads the official document on the server, verifies its
PDF signature and 5 MiB limit, attaches it to the saved interest, and runs the
configured AI analysis without a manual download or upload. The installed plugin declares `community.secop.gov.co` as its permitted download host. Public HTTPS URLs
and every redirect are checked against that policy before fetching; credentials and browser cookies
are never forwarded. The downloaded bytes, not the title or URL, are analyzed.
Download errors remain distinct from AI provider errors.

If the source returns a CAPTCHA or recognizable access challenge, Savia stops
before attaching a file or invoking AI. The document stays selected and the UI
shows the official link, **Retry automatic download**, and the existing manual
PDF selection. Completing the challenge in the browser may not authorize the
server's separate connection; if retry remains blocked, download on SECOP and
attach the file. Savia does not solve or bypass CAPTCHAs. **Analyze a downloaded
PDF** remains available for manually obtained files. Non-PDF attachments remain
available through their original download links.

**Save interest and analyze PDF** runs through an explicit React click handler,
so it works without enabling native form submissions in the sandbox. It saves the tender as an interest,
attaches the PDF through the current user's collection permissions, and sends it
to the workspace's existing configured AI provider. No provider key is included in
the plugin. The shared host document-analysis capability validates the installed
extension and its declared collection, bounds the request and decoded PDF size,
and uses OpenRouter's default native-PDF/OCR processing with the configured
summary/chat model. OCR is selected by the provider when the model cannot read
PDFs natively and may incur per-page processing charges. The deprecated
`pdf-text` alias is not forced because it can lose extractable document text.
Unreadable or insufficient PDFs must be reported without drawing conclusions
from filenames. Page references
are requested only when supported by the parsed document. Users must verify the
analysis against the original file.

Completed results are saved in `procurement_documents`, linked to the interest,
source document, stored file, model and analysis time. Saved analyses reload from
the backend and provide a download of the stored PDF. Provider failures preserve
the stored file ID for an in-place retry without another attachment. If saving a
completed analysis fails, its text remains visible with **Save result**; returning
is disabled until the result is saved. The saved history shows up to 50 analyses
for the process. No document or report is persisted in browser storage.

Plugin 1.5.1 raises the analysis field limit to 100,000 characters, so detailed
reports can be saved without truncation. Installing that ZIP updates the document
collection's field configuration while preserving existing reports.

The 1.4.0 feature requires both the shared host document-analysis deployment and
the updated tenant ZIP. Later UI-only document changes can be delivered by ZIP
without a host release.

Choose **Track** on a result to save that selected row. **My interests** lists
persisted opportunities, with tracking status, priority, owner, next follow-up date
and notes. The same Socrata `:id` can be saved only once per workspace. Saving an
already followed row does not overwrite its existing follow-up information.
Updates use Savia record versions; conflicting changes are reported for review.
The sandbox preserves safe error status and code fields, so a concurrent change
reloads the current interest even when host localization services are absent.

Only selected opportunities are copied into the local collection, including a
bounded source snapshot. All durable follow-up data uses the backend collections
API. Reloading does not depend on browser storage. Removing or disabling the
plugin keeps existing opportunity records. Search does not submit offers or
change procurement data at SECOP.

## Automatic monitoring

Newly saved interests have **Automatic monitoring** enabled. The service checks
SECOP about once an hour while the plugin is installed and enabled, using the immutable
creator's own SECOP Live OAuth connection. Existing saved interests with a
creator are enrolled automatically. Each interest shows its latest SECOP status,
closing date, check time and a safe connection or check error. Change the checkbox
and select **Save tracking** to pause or resume an individual interest. Interests
whose local tracking status is **Awarded** or **Discarded** pause automatically.

Status changes and closing reminders appear in Savia's in-app notifications.
Reminders are sent at 168, 72 and 24 hours before the current deadline; only the
nearest applicable reminder is sent if a check happens late. Changing a deadline
starts a new reminder cycle. Offset-less SECOP timestamps use America/Bogota;
date-only deadlines mean the end of that date. Missing, invalid or expired
deadlines do not produce closing reminders. The local tracking status, assignee and notes remain
separate from the facts refreshed from SECOP. No email or external message is
sent. If the source connection needs authorization, the interest shows a
connection error and its creator must reconnect it in **Sources and collections**.

## Install

1. Deploy the host's read-only MCP sources and `mcp` plugin-action support, applying
   migrations `0048_mcp_collection_sources.sql` and
   `0049_plugin_record_monitors.sql` before the API. Configure the API scheduler
   with a one-minute cron; the monitor itself checks each interest hourly.
2. In the target workspace, create the **SECOP Live** MCP source with identifier
   `secop_live`, and complete OAuth for the user who will run searches. See
   [MCP collection sources](mcp-collection-sources.md). Source credentials remain
   principal-bound; other users need their own authorized source.
3. Build `pnpm store:pack packages/plugin-secop-tenders` and upload the resulting
   `procurement.secop` ZIP through **My plugins**. Install and activate it in the
   intended workspace. Uploading alone does not activate the plugin.
4. Search a live tender, save it intentionally, reload **My interests**, change its
   tracking fields, save, and reopen to verify backend persistence.

The SECOP provider must expose the annotated read-only `opciones_licitaciones`
tool before installing plugin 1.3.0. Its allowlisted `campo` values are
`departamento`, `entidad` and `modalidad`; it groups the corresponding columns
across the entire SECOP II processes dataset. It returns a single catalog record
under `/data`, with `id`, `values`, `count`, `complete` and `updated_at` fields.
The three plugin actions fix the requested field in metadata, so user input
cannot inject a query or select another endpoint.

Catalogs use the owner's OAuth source. If all filters report a catalog error,
test **SECOP Live** in **Sources and collections → External sources**. When the
test asks for authorization, choose **Authorize again**, complete the existing
read-only connection and reopen SECOP. The host coordinates concurrent token
renewal across Workers; deploy its OAuth refresh lease migration with that fix.

`provider/catalogs.mjs` contains the optional provider extension and its tests.
Bind a dedicated `CATALOG_KV` namespace for public snapshots, separate from OAuth
storage, and seed each verified complete catalog before installing the UI.
Snapshots have no storage expiration: fresh catalogs are served immediately for
six hours; older complete snapshots are served while `waitUntil` refreshes them
in the background. Refresh failures preserve the last valid complete snapshot.
Cold aggregate reads can exceed Savia's MCP time budget, so deployment verification
must include warm KV reads. Edge-cache freshness never extends the snapshot's
remaining six-hour interval; concurrent reads are coalesced. Reaching the 50,000-value safety limit or the response-size bound fails
closed rather than claiming a partial catalog is complete. No catalog is
persisted in browser storage. `provider/patch-worker.mjs` is a guarded additive
adapter for the inspected deployed provider bundle: it refuses ambiguous source
or repeat installation. For future updates, integrate the helper in the provider's
original source, or rebuild from a verified original bundle. Back up provider code
and settings, preserve bindings and secrets using Cloudflare's
[upload metadata](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/),
and verify tool discovery and all catalogs before publishing the tenant ZIP.

The plugin provisions `procurement_opportunities` with a unique `source_id` and
native record-version support. It declares fixed tender search/detail actions and three catalog read actions and does not
contain a source URL, API key, OAuth token or secret. The action's source ID and
mapping are metadata; user input cannot select a different endpoint or tool.

## Shared preview delivery

The user-facing preview is `https://savia-preview.hefesoft.com`. Host changes
reach it through a pull request into `main`, successful Savia CI, and the
**Deploy Savia preview** workflow. Preserve the current shared preview resources
and encryption keys; never replace that deployment with an older branch build.
After deployment, upload and install `procurement.secop` in the requested
workspace (for example tenant `12`). Its user must create or reconnect their own
`secop_live` OAuth source there. Installing in an isolated Platform workspace does
not deliver the plugin to an existing shared-preview workspace.

## Branch verification

Use the documented [branch-preview workflow](runbooks/preview-environments.md) for
unreleased host changes. A branch preview has isolated databases, credentials and
its own Platform workspace. Do not directly replace the shared preview gateway
from an unrelated checkout. Preview installation and live verification must be
reported separately from unit tests and ZIP packaging.
