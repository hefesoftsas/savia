# Personal pages

Owner: Savia API and Admin. Reviewed: 2026-10-04.

## Save a shared link

On Android, open your workspace's HTTPS address and install Savia from Chrome
using **Install app** or the installation option under **Add to Home screen**.
A browser shortcut alone is not enough. If Savia does not appear in another app's share menu, update the
installed app from Chrome or remove it and install it again. Then choose
**Share**, select Savia, review the link, title, note and destination folder,
and explicitly save it to Pages. The share intake needs an internet connection
and keeps its draft in this browser tab for up to one hour. It stores the link,
an optional title, and shared text as a note; Savia does not fetch or scrape the
linked article. A pending save and its selected folder resume after signing in
or refreshing; while a save is pending, keep its details unchanged until Savia
confirms the result. If the browser blocks session storage, keep the tab open
while reviewing and saving the draft because a reload or sign-in cannot restore
it.

The default destination is your private **Saved links** folder (**Guardados** in
Spanish). If that folder has been shared with members or through an active public
link, Savia creates a private destination instead. Choosing another folder applies
that folder's existing permissions, including public links. The review shows the
current account and workspace before saving. The page, its link and note, and its
first revision are saved atomically; retrying the same pending capture does not
create another page. This feature uses the existing Pages schema and needs no new
database migration.

Safari and Firefox do not offer this installed-app share target. Open **Work →
Pages → Save link** to enter a link manually there.

**Work → Pages** expands directly in the main sidebar. It contains your page and folder tree; there is no second navigation panel. Select Pages itself to search the workspace, create a root page or folder, or browse its contents. The document breadcrumb returns to a parent or the workspace. Create a page, edit its title and body, and wait for **Saved** before navigating away. One search box offers up to nine accessible title and content matches as you type. When tenant semantic search is enabled and available, semantic matches are added after text matches, with duplicates removed. Suggestions show a short excerpt, highlight the literal search phrase, and include the last update date. Use the arrow keys and Enter to open a suggestion, or Escape to close the list. Searching does not filter the root folder listing. Pages are private until their owner grants member access or explicitly creates a public link. Subpages inherit the root's reader/editor permissions for member access. Administrators do not automatically receive private document access.

## Folders and navigation

Use the **+** beside Pages or a tree item to create a page or folder inside it. Expand/collapse folders and pages with children using their chevrons. Opening a folder shows its contents, with controls to add a page or subfolder. Rename it using the title field; folders have no editable document body or record binding. A folder and all its descendants inherit the existing root sharing policy. A folder must be empty before deletion. Moving existing pages between roots is not included in this release.

Owners can use the trash button that appears on a page or folder row on hover or keyboard focus. A confirmation dialog names the item before deletion. Cancel leaves it in place; deleting a page with subpages requires removing those subpages first.

The **…** menu holds subpage creation, history, Markdown export and deletion. **Export as Markdown** is available to anyone who can read the page and downloads the saved title and supported document blocks as a `.md` file. Issue cards export their original link, collections export a reference, and attachments export their filename; fetched issue preview details, collection rows and private attachment identifiers are not included. Share and the current save status stay visible. A privacy icon beside Share exposes the team access label on hover or keyboard focus; it does not occupy a row above the title. The same tree is available through the main navigation drawer on mobile.

## Writing and linked work

The Plate editor supports paragraphs, headings, quotes, bullet lists, bold and italic text. Select text to show contextual formatting controls. Use the **+** beside the current block or type `/` in an empty block to open a searchable block menu. It includes paragraphs, three heading levels, quotes, bulleted and numbered lists, tasks, code, dividers, callouts, toggles, simple tables, collection views and attachments, and supports arrow keys, Enter and Escape. Pasting a single HTTP, HTTPS or mailto URL makes a clickable link. Links open in a new tab.

In an empty paragraph, `#`, `##` or `###` followed by Space creates a heading; `>`, `-`, `*`, `1.` or `[]` followed by Space creates a quote, list item or task. Typing three backticks at the start of an empty paragraph immediately creates a code block through Plate’s native input rules; choose its language in the toolbar. Existing plain-text fences with a language still convert on Enter or Space; `js`, `ts`, `py` and `sh` are accepted aliases. Pasting a complete Markdown fenced code snippet into an empty paragraph creates a code block and preserves its indentation. Inside code, Enter inserts a newline, Tab inserts two spaces, and Cmd/Ctrl+Enter exits the block. Cmd/Ctrl+E and the selection toolbar toggle inline code. Use the block toolbar to insert a paragraph below a block.

Jira, Linear, and GitHub block commands appear only when that provider is enabled on the server and the current reader has a connected account. Configure the personal account from **Integrations → Accounts & Connections → Issue management**. An unavailable, disconnected, pending, failed or expired connection is not offered in the editor. Each reader uses their own connection, so sharing a page never grants access to the author's issue tracker. Existing issue blocks render as regular clickable links when the reader has no active connection; they do not request a preview or show connection prompts inside the document. Ordinary pasted links remain clickable without an integration. See [Jira, Linear, and GitHub issue links](issue-links.md) for Nango setup.

### Personal ticket summaries

With a personal Jira connection, type `/mis-tickets` (or search **My tickets** / `/my-tickets`) in an empty paragraph. The command inserts a summary of tickets assigned to the current viewer. Opening the page retrieves the viewer's saved summary from the backend. The first load for a set of filters and connections generates and saves it; subsequent openings reuse it without contacting Jira or GitHub. **Refresh** explicitly reads current provider data and replaces that summary without changing the document.

Default status names are **To Do**, **In Code Review**, **Code Review**, **Ready for QA**, **QA**, and **QA / Acceptance**. Configure a project key and custom status names in the block when a Jira workflow uses different labels. Configuration changes follow the page's edit permissions; readers can refresh their own results but cannot change the saved filters.

Tickets are grouped by status and include Jira comment counts and the latest comment excerpt, author, date, and source link. Connected GitHub accounts add discovered pull requests, open/draft/closed/merged state, review decisions, unresolved review-thread counts when complete, and discussion excerpts. A missing connection, inaccessible PR, or partial provider result is explicitly marked; it does not mean that no comments or PRs exist.

The live summary itself is not editable text: it is a void block that renders the viewer's private provider data. Move, duplicate, or delete it with the normal block toolbar, and keep writing in the paragraph below it. After inserting it with `/`, the caret lands in that trailing paragraph so typing continues instead of getting trapped inside the live card.

Only the block configuration is stored in Page content, autosave, history, and exports. The backend encrypts saved provider results separately for each viewer, filter configuration and connection identity. It checks the viewer's active connections before returning a cached summary. Disconnecting or changing a source account removes its cached snapshots. Sharing a Page does not share the author's Jira or GitHub results. Anonymous public pages show a private-content placeholder. No scheduled background refresh is created by inserting this block, and the browser does not persist ticket data.

When an editable copy is needed, use **Insert snapshot as editable blocks** inside the live block. It inserts the currently loaded tickets below as ordinary headings, bullets, and links that can be edited, moved, and deleted. That copy becomes part of the shared page content (history, exports, search) and follows page permissions, unlike the live block. It is a one-time snapshot and does not refresh with Jira or GitHub.

The displayed update time belongs to the saved summary, so returning to the page does not make old data appear freshly fetched. Tickets stay visible while refreshing. If the update fails, the previous summary and its timestamp remain visible with an explicit warning; a failed initial load still reports that tickets are unavailable.

### Rich blocks

- **Code** preserves indentation and multiline source. Choose a language, copy the source, use Enter for a newline and Tab for indentation, or Ctrl/Cmd+Enter to continue in a paragraph. Pasted source remains plain text instead of becoming links or separate blocks. Source is displayed, never executed. Inline code is also available in contextual formatting.
- **Tasks** have checkboxes that save with the page. **Numbered lists** number consecutive items. Enter continues a list or task; Enter on an empty item returns to a paragraph. Shift+Enter adds a line within the item.
- **Divider** inserts a horizontal separator followed by a place to continue writing. **Callout** highlights a note using the current theme.
- **Toggle** has an editable summary and body. Expanding or collapsing is temporary viewing state; the body stays in the saved document. Readers may expand it without editing the document.
- **Simple table** supports editable cells and row/column controls, bounded to 20 rows and 10 columns. Tab and Shift+Tab move between cells; Tab in the last cell adds a row while below the limit. Cells contain text and inline formatting. These tables live in the document; use a collection view for records, filters and other database features.

Page permissions, autosave, conflict protection and revision history apply to these blocks as they do to ordinary text. Reader mode disables document mutations.

**Collection view** embeds an existing authorized collection as a table or board, optionally using a saved view's filters and columns. Records remain in their collection. The embed displays 20 records per page; board groups describe only the current page. Open the collection for its full editing capabilities. **Record page** opens or creates a private page bound to the selected record; its properties load from the viewer's collection API, independently of page sharing. The server resolves the binding independently of the page-list limit and enforces one bound page per tenant, domain, collection and record, including concurrent requests. Existing page permissions still apply. The uniqueness migration preserves duplicate notes and their content, retaining the oldest binding and detaching the others.

**Image or file** uploads PNG, JPEG, GIF, WebP, PDF or plain text, up to 10 MB, through the authenticated API into the configured document bucket. Access to attachments follows the page permissions. Browser object URLs are temporary and revoked when unmounted.

## Saving, sharing and history

### Transfer pages to another Savia instance

Open **Work → Pages** and use **Export all my pages** to download a
`.savia-pages.json` archive. In the destination instance, sign in, open Pages,
choose **Import pages**, select the archive and confirm the import.

The archive contains the current saved content of your own pages and folders in
the current tenant, their parent/child structure, rich formatting and referenced
image/file attachments. Export is independent of search and the 200-result page
list limit. Pages shared with you by another owner are not included. Save any
pending edits before exporting.

Import creates new private copies owned by the importing user. It preserves
the hierarchy and rewrites attachment references to newly stored files; existing
pages are not overwritten. Importing the same archive again creates another
copy. Historical revisions, member permissions and public links are not
transferred. Imported pages start with a new revision history.

Collection records, saved collection views and record bindings belong to the
source instance and are not transferred. Collection blocks become explanatory
text, and record bindings are removed, so matching identifiers in the destination
cannot accidentally connect imported pages to unrelated records. Ordinary
external links remain links; issue previews still depend on the reader's own
integration access.

Archives use a versioned JSON format with embedded attachment data and are
limited to 50 MiB, including the encoded files. The existing 10 MB attachment
limit and supported file types still apply. An export exceeding the archive
limit fails explicitly rather than silently omitting pages or files. Keep the
downloaded archive private: it contains the exported document and file content.
Import validates the archive, page hierarchy, document blocks and file
references before writing pages; a failed database import does not leave a
partial page tree.

Deployment CPU, memory, database and storage quotas also apply, so a large
archive can fail below the file-size limit on a constrained instance. The
database import stays atomic instead of exposing a partially imported tree;
uploaded blobs are cleaned up on a handled failure. See the deployment's
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/) when running
on Cloudflare. Process termination or storage-cleanup failures may leave
unreferenced blobs for operational cleanup.

Autosave waits briefly after an edit and sends sequential versioned updates. A stale version produces a conflict instead of overwriting another user's update. The editor preserves the current draft and offers **Download draft** and **Reopen**. A downloaded draft is an explicit user export; Savia introduces no localStorage or IndexedDB document cache. A failed draft must be exported before closing the browser or reopening the page.

**Share → Members** assigns reader or editor access to active teammates. Changing member sharing on a subpage changes its root's sharing. Removed memberships stop granting access. An empty member list means there are no other active teammates available; a failed request offers a retry instead of presenting an unusable save action.

**Share → Public link** creates a separate, read-only link for the selected page or folder and its descendants. Publishing a child does not publish its parent or siblings. Only the owner can create or revoke links. An optional expiration limits their lifetime; revoking a link immediately stops new page and file requests through it. Public links show the current saved content, so later edits are visible. Links are not created automatically when opening the sharing dialog.

Anyone holding an active public URL can read its scope without signing in. The public view has no editing, member management, revision history, or bound-record properties. Collections remain private placeholders and issue cards become ordinary external links; the public view never uses the owner's Studio permissions or Jira/Linear/GitHub connections. Referenced attachments are served through the same scoped link, and removing an attachment from the document removes its public download access. Public routes bypass the administrative service worker. New private-app workers activate in the background and the deployment notice offers a user-controlled reload after saving. Public HTML, API responses, and downloads use no-store and no-referrer headers; public documents request no indexing. Expired or revoked links do not expose document titles or contents.

**History** opens a side panel with saved dates and versions. Selecting a version loads
its read-only document in the main area, with loading/error states and protection
against out-of-order preview responses. **Back to note** returns to the live
editor without modifying it. On small screens the version selector sits above
the document. Restoring a selected snapshot creates a new version.

Owners can choose **Clear history**, then confirm permanent deletion of all
previous versions of that note. The current document and its current snapshot
are preserved; editors and readers cannot clear history. A concurrent edit
rejects the deletion rather than deleting versions against a stale page version.
Public links never expose history. Linked issue previews and collection data
remain live references; revision snapshots preserve the note's blocks, not a
historical copy of external provider data. This release does not merge simultaneous edits. Delete subpages before deleting their parent.

## Operations and limits

Apply migrations `0008_pages.sql`, `0009_issue_connections.sql`, `0010_pages_folders.sql`, `0011_page_public_links.sql`, `0012_page_public_short_links.sql` and `0013_pages_record_binding_uniqueness.sql` using the existing deployment migration process; PostgreSQL equivalents are registered in its migration manifest. This feature does not deploy or apply production migrations automatically. Existing document storage and authenticated API configuration are reused. The API reference is generated from the Pages OpenAPI route declarations.

Search examines titles and the first 10,000 normalized content characters. Search/list returns the 200 most recently updated matching pages. Search excerpts are bounded to 360 plain-text characters and are returned only for authorized results; ordinary browsing does not fetch excerpts. The member picker returns up to 50 members. Documents and revisions are bounded by server validation. There is no CRDT collaboration, inline comment system, external guest editing, or remote issue mutation. Deleting a page removes its attachment metadata and attempts to delete every stored attachment blob from the document bucket. It is not a retention mechanism: preserve any required copies before deleting the page. Failed bucket deletions may leave orphaned blobs for deployment cleanup. Revision retention is unbounded unless the owner explicitly clears prior versions.

### Loading and connection loss

The sidebar and workspace share a bounded, in-memory read cache per API client
and session (up to 64 index/search/document entries). Concurrent reads share one
request; online snapshots are reused for 60 seconds. Browsing has no search
debounce, and successful saves update the index and retained document directly
instead of downloading the index again. Explicit reload bypasses cached values.

Previously read snapshots remain available while the browser reports offline,
including after navigating away and returning during the same session. This is
session-only reuse, not a persistent offline replica: refreshing the browser
clears these snapshots, and saving, uncached documents, attachments, history and
uncached search still require a connection. Logout or identity changes clear the
cache. Authorization failures evict cached reads. Page reads time out after 15
seconds (including authentication lookup), allowing the existing Reload action
to recover instead of displaying loading indefinitely.

### Cloudflare semantic search

Local FlexSearch search has been removed. Existing derived browser indexes are
removed on a best-effort basis when Pages opens; page content remains canonical
in the backend.

Cloudflare semantic search is disabled by default for every tenant. A platform
administrator grants the capability in the tenant administration screen. The
tenant administrator can then activate or deactivate it in **Page search** in
the tenant settings. Revoking the grant also turns activation off; granting it
again does not reactivate it. Ordinary members cannot change either setting.
Both controls are enforced by the API, including indexing and querying.

When enabled and available, the Pages search box adds semantic matches backed by
Cloudflare Workers AI (`@cf/baai/bge-m3`) and a dedicated Vectorize index.
Docker installations can instead run the same authorized semantic-search flow
with local Ollama `bge-m3` embeddings and Qdrant; see
[local Pages semantic search](self-hosted-docker.md#local-pages-semantic-search)
for startup, tenant activation and backup requirements. Cloudflare bindings are
not required for that deployment. Text
search remains available when semantic search is disabled or unavailable. Pages
automatically catches up older saved versions when you open the workspace, with
visible progress and controls to pause or resume. The information icon beside the
search field opens a tooltip with indexing totals and the automatic indexing
explanation; these details stay hidden during normal browsing. New, saved and restored pages
are submitted for background indexing on a best-effort basis. Imports submit up
to five pages in the background; other pending pages catch up the next time you
open Pages. A failed catch-up batch stops until you choose **Retry indexing**; it
does not loop through the same failure. If another request is already indexing a
page, Pages waits and checks status again instead of submitting duplicate work.
The catch-up uses the first 200 accessible page summaries, skips folders, and
includes titles and saved rich-text leaves.
Attachments, embedded collection records and external provider data are excluded.
Vectorize submissions are asynchronous; new results may take a few seconds to
become searchable.

Semantic results include an excerpt from the matched content chunk when available,
or a short excerpt around the query. Excerpts are derived from the current
authorized page rather than stored vector metadata. An empty result message is
shown only after a search completes, not while stale results are cleared. Returning
to the window or changing a page refreshes the current semantic query, retaining
the search text and the normal debounce and permission checks.

Vectors use a tenant namespace. Search returns only pages that the caller can
currently read in that tenant, checks the indexed version, and reads titles from
the authorized backend document. Vector metadata contains page IDs and versions,
not document bodies. Removing access or deleting a page prevents its appearance
in results even while an older vector remains in Cloudflare. Turning search off
stops new indexing and querying; it does not erase previously submitted vectors.
A platform administrator can also activate or deactivate an already granted
capability directly in the tenant editor. Changing activation preserves the
existing grant; revocation still disables activation.

The ordinary server title and content search remains available in all cases. Deployed
semantic queries are limited to 30 per minute per tenant to bound repeated AI
requests; the browser also debounces typing.

Preview binds the isolated `savia-pages-search-preview` Vectorize index
(1024 dimensions, cosine) with Workers AI. Bootstrap this index once before the
first deployment using `node scripts/ensure-preview-pages-search.mjs` with
`CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_API_TOKEN` that has Vectorize Write
permissions, or `wrangler vectorize create savia-pages-search-preview
--dimensions=1024 --metric=cosine`. Routine deployments bind the existing index;
they do not need to provision it or broaden the Worker deployment token.
Production search remains unavailable unless
`SAVIA_PAGES_SEARCH_INDEX` is set to a separately provisioned production index
when rendering the Worker configuration. No search consumption is incurred by
tenants whose capability or activation is disabled. Cloudflare usage quotas and
charges still apply when tenants enable the feature.

The new editor dependencies (`platejs`, `@platejs/basic-nodes`, `@platejs/link`) use MIT licenses. Their attribution notice ships at `/licenses/plate.txt`. Existing Nango is an external service accepted for this integration; this implementation does not claim that Nango itself is MIT/Apache licensed.

## Verification

Portable transfer tests in `apps/api/test/pages-transfer.test.ts` cover export
beyond the page-list limit, private imports into another tenant with real local
R2 attachment bytes, nested pages/folders, new revision snapshots, repeat imports,
collection detachment, malformed archives and rollback/cleanup on failure. UI
tests cover downloading archives, file validation, progress, server errors,
same-file retries and refreshing the page navigation. Native PostgreSQL transfer
and deployed-instance transfer still require deployment-specific verification.

Automated coverage checks folder creation and containment, folder renaming in the sidebar, slash-menu selection and focus recovery, page authorization, inherited sharing, revoked membership, version conflicts, history, attachments, safe document nodes, rich-block round trips and structure limits, code whitespace, task updates, table operations, URL paste, preview fallback, serial autosave and authorized record properties. Public sharing tests cover owner-only publishing, scoped anonymous reading, expiry, revocation, current attachment references, retryable member loading, and isolated public bootstrap. Native PostgreSQL coverage is in `apps/self-hosted/test/pages-postgres.test.ts` and `apps/self-hosted/test/pages-public-postgres.test.ts`; it uses disposable databases through `SAVIA_TEST_POSTGRES_URL` and checks migrations, inherited permissions, concurrent edits, revision restores, attachment metadata and the bootstrap administrator’s platform membership. Run `pnpm --filter @savia/self-hosted test:postgres` against an isolated PostgreSQL test server. Desktop/mobile visual review also uses the real Pages UI. Live Jira/Linear OAuth and production storage are not validated by mocked provider tests.

### Moving and deleting blocks

In editable pages, hover over a top-level block to reveal its drag handle and
delete button in the left gutter. Drag the handle above or below another block;
a line marks the insertion point. Cards, tables, and other nested blocks move
as a whole. The move handle also accepts the Up and Down arrow keys. Deleting
the last block leaves an empty paragraph, and changes use the normal page
autosave and editor undo history. Read-only pages do not expose these controls.

Typing the third backtick at the start of an empty paragraph immediately creates
a code block through Plate's native `createBlockFenceInputRule` (`on: "match"`).
No Enter or space is required. Select the language in the code toolbar afterward.
The legacy Enter shortcut still accepts an existing plain-text fence with a
language, and complete fenced clipboard snippets retain their language.

Selecting text shows the formatting toolbar above the selection, including the
first line of the editor. At the top of the viewport, it appears below the
selection instead. For selections extending beyond the viewport, the toolbar
stays within the visible bottom edge. Block actions are hidden while the formatting toolbar is
visible to keep the selected text unobstructed.

The selection toolbar also offers **Ask AI** in editable pages. Choose a quick
action such as summarizing, improving writing, translating, or explaining the
selection, or enter a custom instruction. The request contains only the selected
text and instruction; the selection is treated as source material. The configured
default model is used unless you explicitly choose an active employee, in which
case that employee handles the request. Results stream into a preview. Choose
**Replace selection**, **Insert below**, or **Copy** to apply the result yourself.
Cancel stops the request, and errors leave the document unchanged. Nothing is
written until you choose an apply action; normal autosave then records an edit.
The Spanish-to-English translator returns three labeled versions: **1. Regular
translation**, **2. Professional but friendly translation**, and **3. Concise
professional but friendly translation**. Choose one with the radio controls. The
preview shows all three headings and translations; replace, insert, and copy use
only the selected translation, without its heading or extra commentary. If the
source is too ambiguous to translate reliably, the employee asks one brief
clarifying question before returning the translations. Clarifications and unrecognized
translation formats remain visible without replace, insert, or copy actions. Use
**Clarification or format correction** and **Continue** to answer or request the
required format; this retains the original selection and conversation. A failed,
cancelled, or timed-out continuation preserves the question and your reply so you
can retry. **Generate** starts a fresh conversation with the current instruction.
The panel shows the employee model when configured and the effective server-selected
model when generation starts. Expand **Assistant instructions** to inspect the
selected employee’s custom system prompt; these can be edited in AI employees.
Administrators can enable additional text models in **Credentials → OpenRouter → Available models for Ask AI**, globally
or for an organization. The organization can inherit the global choices or keep
its own list; an empty list exposes only the assistant default. Use **Save
enabled models** to save the global choices independently of the API key and
default model. **Choose model**
offers the effective enabled choices available to the configured OpenRouter
account. The assistant default still follows the employee, organization, and
global settings. Model selection applies to the panel's request and does not
change those administrative defaults. The server checks every explicit model
choice against the administrator's list. If an administrator disables a model
while the panel is open, the panel returns to the default and refreshes the
choices so you can retry without changing the document. Model-catalog failure
also leaves the default available.

Generation shows elapsed seconds and can be cancelled. After 90 seconds, a stalled
request stops with a retry message, leaving the document unchanged. An inactive existing translator must
be reactivated in AI employees.
If no employee uses the `traductor` handle, choose **Create translator** to add
the active text-only employee and select it for the request. This action creates
the employee; management's translator template instead opens a draft for review
before saving.

Block actions appear in a horizontal floating toolbar above the active block.
A continuous pointer corridor connects the block to its toolbar. A 400 ms dismissal delay allows brief pointer detours; entering the
toolbar cancels dismissal. Keyboard focus pins the toolbar to its
current block until focus leaves, preventing an action from targeting a neighbor.

Use **Write above** or **Write below** in a block's toolbar to insert a paragraph
at that position and immediately focus it. Moving a block returns focus to the
editor. Unmodified Up/Down arrows cross top-level text edges, skip non-editable
cards, and create an exit paragraph at a document-edge code block. Native arrow
movement inside text and extended selections remain untouched.

Contextual controls follow Plate's `onSelectionChange` after the editor has
synchronized native selection. They must not synchronously rerender the editor
from document `selectionchange` or key-up events: Slate can otherwise restore
its previous selection and cancel clicks or arrow-key caret movement.

Large documents keep a stable editor instance and initial value across draft and
save-status updates. Editor service context is memoized so moving contextual
controls does not invalidate every issue, attachment, or collection block.
Block hover and drag targeting use Slate's cached DOM-to-node paths rather than
scanning all top-level DOM siblings. Selection controls reuse unchanged positions
and remain scheduled after Slate selection synchronization.

Autosave snapshots are serialized lazily after the debounce (or when navigation
requires a dirty check), then cached by immutable draft identity. Rapid typing
therefore does not repeatedly serialize the entire document. The serial save
queue and protection for edits made during an in-flight save remain in place.

The active toolbar block receives a subtle theme-aware background highlight. It
stays visible while using the block actions and clears with their dismissal,
without adding document nodes or changing block dimensions.

### Short public links

In **Share → Public link**, choose **Create short link** on an active link. The
saved short URL then becomes the destination for **Copy link** and **Open link**.
Generating a short link reuses the existing public grant; it does not publish a
second copy or extend its expiry. Revoking the public link disables access
through its short URL too.

Pages reuse the configured Shlink service when it accepts the public HTTPS
destination. Local or unavailable-provider fallback links use `/s/p/{code}` on
the current Savia host and are stored on the backend. A localhost link remains
local to that machine; public sharing outside the machine requires a deployed
public origin. Shortening failure leaves the original full link usable.

Ask AI keeps model selection and employee instructions under **Options**. If no
alternative models are enabled, it shows the current model without an inactive
selector. Translator requests omit the generic task shortcuts. Translation
results use **Regular**, **Professional**, and **Brief** style choices and preview
only the chosen version; replace, insert, and copy still use that version.

The sparkle icon opens Ask AI for a text selection or for the highlighted block
from its block actions. A block request uses the whole block's text; empty blocks
do not show the action. The original text changes only after an explicit replace
or insert, and the saved range is checked before applying a response.
