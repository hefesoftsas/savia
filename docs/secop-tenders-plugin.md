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

## Private tender dossier and company assistant

The plugin opens a dossier with Summary, Documents, Requirements, Company and
Assistant views from the existing Documents action. It preserves the previous
per-PDF document workflow behind **Documents and previous PDF analyses**.

Each tender and dossier tab has a shareable URL. Opening Documents records the
process ID and tab through the host's generic `savia.route` bridge. Refreshing,
opening a copied link, and browser Back/Forward restore that tender directly
through the fixed read-only detail action, even when no search results are loaded.
Only public view identifiers enter the URL; documents, company evidence and chat
history remain in the backend. A failed lookup offers Retry without discarding the
link, and a missing tender shows a return action. Links still require normal
workspace access and the workspace's SECOP connection.

All new processing runs in the private secop-live-worker service. No
SECOP-specific server/API/schema change is added to Savia. The plugin uses a
fixed, secret-backed HTTP connector (secop-dossier) and one declared dispatch
action, staying within the 20-action package limit. Public search continues to use
the existing read-only MCP source. A private credential belongs to one workspace;
never copy it to another workspace. Configure it through the dossier connection
form or existing plugin connection management; it is not persisted in browser
storage or packaged into the ZIP.

**Save and prepare dossier** saves the interest and starts durable background
processing. The service enumerates every available document page, records partial
coverage, downloads permitted official files and keeps failed/CAPTCHA/unsupported
items visible. Scanned PDFs require the configured OCR provider or a replacement PDF with selectable text; the basic Cloudflare converter does not supply complete OCR. The report and requirements cite immutable source versions and
parser pages or sections. Source changes mark reports stale. Protected one-use
upload links provide recovery for blocked originals and private company evidence.

Select/create a company, upload its evidence and review any extracted numeric
facts against their cited originals. Choose lot identifiers when relevant, then
**Evaluate compliance**. Findings distinguish meets, does not meet, insufficient
evidence and not applicable; missing evidence becomes preparation tasks. Expired
or changed evidence invalidates old evaluations. User review notes stay separate
from model findings. Readiness means ready for the team's review, not a submitted
or officially approved bid.

The **Assistant** tab opens Savia's native chat panel through the generic plugin
assistant bridge. The title and selected company remain visible, and the existing
conversation stays in the private SECOP service. There is no second chat composer
inside the dossier. **Prepare complete checklist** prefills a question; it does not
send it until the user presses Send. The same private workspace connection is used.
Ordinary workspace members use that configured connection without listing or
managing credentials; an administrator provisions or repairs it. Dossier controls
follow the selected Spanish, English or Portuguese locale. Active durable jobs can
be canceled after returning to the dossier, including after a reload.

Explicit questions asking for all requirements use every saved requirement record
in the current report. Items preserve original wording and link to exact source
quotes, with OCR/source-review and missing company-evidence notices shown first.
This covers the saved extraction, not a certification that every obligation in the
original documents was recognized. Focused questions retain bounded hybrid search.
Source classification and automatic analysis do not certify company compliance.
A finished joint analysis can still have source extractions awaiting human review.

The native panel uses Savia's shared Markdown renderer, source disclosures and
keyboard-accessible composer. Users can copy one answer or the full conversation,
including history pages from the same tender, company and principal scope. The
provider reports an error when the history exceeds export limits instead of
silently truncating it. Changing tender, company or principal changes the context;
it never reuses a conversation from another scope. Jobs and conversations survive
navigation and reload. See [plugin assistant integration](guides/plugin-assistant.md).

When the assistant identifies a missing requirement, **Create task** opens a
review step for its title, responsible person and due date. Confirming creates a
record in the plugin-owned `secop_application_tasks` collection through Savia's
tenant-authenticated records API. The record keeps the tender and requirement
references so the team can review the source later. Users can edit a task or set
its status to **Done** in the native **SECOP preparation tasks** records screen.
The responsible person is stored as the name selected by the user. A task tracks
preparation work and does not decide or imply company compliance. The collection
and its behavior belong to this optional SECOP plugin; Savia core gains no
SECOP-specific task logic.

Service setup, contracts, storage migrations and release checks are documented in
`chibchombiano26/secop-live-worker/docs/operations.md`. Install this plugin only
after the compatible service is deployed and the workspace credential provisioned.

## Tender documents and PDF analysis

Version 1.7.9 uses compact icon-only controls for contextual document, source,
tracking and dossier actions. Each control keeps a localized accessible name and
tooltip; the search/interests navigation and document tabs retain visible text.
The plugin's `store.json` declares one contributed screen for
`procurement_opportunities`. Studio also exposes native collection records as
sidebar screens, which is why the plugin previously surfaced three entries:
opportunities, saved PDF analyses and preparation tasks. PDF analyses are
backend records used by the dossier's saved-analysis history, so their collection
is retained but its `studio.screen.hidden` metadata hides only that sidebar
entry. `secop_application_tasks` stays visible as a native records screen for
editing and completing tasks created from the dossier assistant. Neither backing
collection is removed, and tasks do not get an extension screen renderer.

Version 1.5.3 adds decorative Lucide icons to the result actions while retaining
visible labels and keyboard-accessible controls. Followed tenders use a checked
bookmark to reinforce their saved state.

Version 1.5.2 groups each search result's Documents, SECOP link and Follow actions
with matching control heights and spacing. On narrow screens, Documents and the
SECOP link share the first row and Follow spans the second row. Keyboard order
continues to match the visual order.

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

Plugin 1.5.1 declares a 100,000-character analysis field limit, so detailed
reports can be saved without truncation. Existing collections preserve their
workspace field settings during upgrades. For an existing installation, also set
the **AI analysis** field's maximum length to 100,000 in **Fields and form**;
new installations receive that limit from the plugin declaration.

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

The active provider source is maintained in the private
`chibchombiano26/secop-live-worker` repository, including its public catalog and
document adapters. The local `provider/` files are historical migration references.
Bind a dedicated `CATALOG_KV` namespace for public snapshots, separate from OAuth
storage, and seed each verified complete catalog before installing the UI.
Snapshots have no storage expiration: fresh catalogs are served immediately for
six hours; older complete snapshots are served while `waitUntil` refreshes them
in the background. Refresh failures preserve the last valid complete snapshot.
Cold aggregate reads can exceed Savia's MCP time budget, so deployment verification
must include warm KV reads. Edge-cache freshness never extends the snapshot's
remaining six-hour interval; concurrent reads are coalesced. Reaching the 50,000-value safety limit or the response-size bound fails
closed rather than claiming a partial catalog is complete. No catalog is
persisted in browser storage. The former `provider/patch-worker.mjs` bundle-patch
workflow is obsolete for this provider. Deploy from the maintained service source,
preserve existing OAuth/catalog namespaces and secrets, and verify public tool
compatibility before updating the tenant ZIP.

The plugin provisions `procurement_opportunities` with a unique `source_id` and
native record-version support. It declares fixed tender search/detail actions and three catalog read actions and does not
contain an API key, OAuth token or secret. Public actions reference their configured
MCP source; private actions use a fixed service URL and declared connector. User
input cannot select a different endpoint or tool.

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

## Personal MCP authorization

Installing the SECOP plugin in a workspace does not authorize its MCP source for
all accounts. Each signed-in user must create and authorize their own MCP source
named `secop_live` in **Data sources**, within the same workspace. A platform
administrator viewing another workspace does not inherit another user's OAuth
tokens. Switching accounts can therefore leave the plugin installed while its
search and catalogs have no authorized source.

When that source is missing, the plugin displays one account-specific connection
notice instead of three catalog failures. Connect the current account or sign in
with the account that already authorized SECOP, then select **Check the connection
again**. Genuine provider/catalog failures keep their normal retry controls.
Existing interests and their original monitoring credentials remain unchanged.

After saving, **View tasks** opens the SECOP task collection in a separate tab,
keeping the tender's connected chat and its conversation open in the original tab.
**Open source** opens the service's PDF viewer at the cited page, with page
navigation and a download of the original PDF. Source links expire after ten
minutes; return to the citation and open it again to issue a new link.

The task collection deliberately has no custom plugin screen contribution. Savia
therefore uses its standard records table and editor for tasks instead of
mounting the tender search interface for that collection.

## Active search and readable closing dates

Version 1.8.0 defaults to **Open with a future deadline**. The SECOP service
filters closing dates and terminal procedure states before pagination, ordering
active results by the nearest closing date. Records without a usable deadline
are excluded from this scope; a future date alone does not prove eligibility.
Choose **All, including closed** to inspect historical, cancelled or undated
records. Saved interests remain accessible regardless of their deadline.

Closing dates use the interface language and Colombia time (America/Bogota),
including Socrata floating timestamps. Historical deadlines display a closed
label. Missing or invalid dates never appear as usable deadlines.

## Multiple filter values and resilient catalogs

Version 1.8.1 supports multiple values for status, entity, modality and
department. Values within one field are alternatives (OR); different fields
are combined (AND). Select options without closing the list, remove individual
chips, or add a typed value with Enter. Pagination keeps the full selection.
Availability remains a single scope choice.

Complete catalogs are cached independently from searches. Renewal runs in the
SECOP service background; a compact retry icon appears beside an unavailable
catalog. Existing selections and previously loaded options survive refresh
failures. No catalog is silently replaced with the currently loaded results.

## Compact filter layout

Version 1.8.2 keeps multi-select fields at a stable height. Closed controls show
the selected values in one truncated line and a count for multiple selections;
opening the control exposes searchable options and removable selection chips.
Keyword and availability fields share a row when space permits. Search actions
are grouped at the start of the form, clear of the floating assistant.

Version 1.8.3 dismisses filter popups on an outside pointer, click or focus
change, when focus leaves the plugin window, with Escape, or on a second toggle
press. Opening another field closes the previous popup; selections are retained.

## Removing saved interests

Version 1.8.4 groups Documents, SECOP and Remove icons in one horizontal row
for every saved interest. Remove first asks for confirmation, then deletes only
the local tracking record and its notes through the native collection API with
its current version. It does not delete the official tender or the SECOP dossier.
Conflicts keep the record visible and require reviewing the latest version.
The saved count and bookmark state update after success. Saving tracking remains
available as a labelled Save icon at the start of each record footer.

### Compact dossier navigation

The dossier header uses labeled icon actions for preparation and status refresh, preserving the full tender title. Tabs stay in a single horizontally scrollable row on narrow screens. The Documents tab distinguishes an empty inventory from blocked document extraction; extraction assistance appears only when a document is actually blocked. Public documents remain available through the folder action beside the section heading.
