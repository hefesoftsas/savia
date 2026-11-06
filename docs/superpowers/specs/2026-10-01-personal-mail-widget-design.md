# Personal mail widget and collection-context composer

Date: 2026-10-01. Status: awaiting written-spec review.

## Intent and approved scope

Users should be able to read their connected personal mailboxes from My Day
and prepare an email using a record they are authorized to access. The approved
design provides one inbox widget for Gmail, Outlook, or both, links that open
messages in a new browser tab, and an editable composer with an explicit Send
action. This is a platform feature, independent of industry packages.

Connections mean the signed-in user's personal integrations in Savia, not
connectors installed in Codex. Only active, connected mail integrations qualify.
The current repository supports one active connection per user and provider;
this feature preserves that model.

## Existing foundations

- My Day already has system and collection widgets, personal layout storage,
  an add-widget dialog, and accessible ordering/removal controls.
- `GET /v1/personal-integrations/messages` currently requires a nonempty search
  and returns message metadata. Gmail's current adapter returns IDs with null
  metadata; it needs bounded metadata hydration for a useful inbox.
- Personal integration operations already send Gmail and Outlook messages,
  validate recipients and content, and record integration writes.
- The existing action-execution route requires an Assistant-confirmed pending
  action. The standalone composer must not weaken or bypass that route's checks.
- Widget helpers discover accessible workspaces, collections, schemas, and
  records through tenant APIs. Server authorization remains authoritative.

## User experience

### Inbox

Introduce the system widget kind `mail`. Include it in the default layout and
make it available in the add-widget dialog. Render it only while at least one
mail provider is connected. Existing saved layouts without the widget receive
a visible Add inbox shortcut when mail is connected; do not silently rewrite
their preferences. Users can remove, restore, and reorder it like other system
widgets. The existing 12-widget limit applies, including hidden mail widgets.

The widget shows the latest ten inbox messages, merged by received time with
newest first. Each row shows subject, sender, date, and provider/account label.
Provider plus message ID identifies a row; matching IDs across providers must
not collapse distinct emails. Null dates sort last, with deterministic ties.
Missing subjects and senders have readable fallback labels.

When both providers are connected, show All, Gmail, and Outlook filters.
Provide Refresh and New email actions. Fetch each connected provider
independently, so one failed provider leaves the other provider's messages
visible with a retryable notice. Distinguish loading, empty inbox, failed
requests, and reconnection-required states. Never interpret failure as empty.

Message links open the provider's native mail interface in a new browser tab
with `noopener noreferrer`. Outlook uses its returned `webLink`; Gmail uses an
account-aware native link derived from provider identifiers, verified against
official provider documentation during implementation. Use only supported
HTTPS provider destinations. If a direct link cannot be established, show an
unavailable open action instead of inventing a URL or opening another account.
Render metadata as text; do not render email HTML inside Savia.

### Composer

New email opens an accessible dialog using existing UI components. Select the
connected sending account, defaulting to the sole account when only one exists.
Show recipients, subject, and a plain-text body. Changing sending accounts does
not erase the draft. Send is a deliberate user action after reviewing editable
content, with a pending state that prevents double submission.

Context is optional. Let the user choose an accessible workspace, collection,
and record using paginated record selection. Show a preview and let the user
choose readable fields to insert as labeled plain text into the body. Insertion
is explicit and does not replace manually written content. Selecting a record
alone never sends data or automatically fills recipients. No AI service is
required to prepare the draft.

Hide unauthorized collections and fields, and handle permission denial from
the server. Changing workspace, collection, or record clears dependent context
selections. Ignore stale async responses. Clear drafts and loaded mailbox or
record data when the signed-in identity changes or the session ends.

On successful send, show confirmation and close/reset the composer. On failure,
keep the editable draft and show an actionable error. Do not automatically retry
a write whose outcome is unknown; warn that the user should check Sent mail
before trying again.

## API and authorization

Keep message search compatibility. Extend the list contract so omission of
`query` means recent inbox messages; existing nonempty searches retain their
search semantics. Fetch at most 25 messages per provider. Return existing fields
plus nullable `webLink` and any provider identifier needed to construct a
verified Gmail link. Gmail metadata requests use bounded concurrency and fetch
only headers/date/identifiers, not bodies or attachments. Outlook inbox requests
select the necessary metadata and link, ordered by received date descending.

Add a dedicated authenticated `POST /v1/personal-integrations/messages` route
for the composer, with the API write scope and normal session/CSRF protections.
Its validated payload contains provider, recipients, subject, plain-text body,
and optional context references (workspace/collection/record/selected fields).
Retain existing limits: up to 20 recipients, 2,000 subject characters, and
10,000 body characters. Reject invalid addresses and header injection. Reuse
the existing provider send implementation and write audit, keeping the
Assistant confirmation route unchanged.

Load connections by the authenticated principal on the server; never accept an
arbitrary user, external connection ID, access token, or upstream URL from the
client. Reject disconnected or unavailable providers before sending.

Context preview uses existing authorized tenant schema and record reads. At
send time, validate supplied context references again through the same server
authorization rules for workspace, collection, record, and selected fields.
Reject stale/deleted records or revoked access before calling the mail provider.
Do not treat frontend visibility or a supplied record snapshot as authorization.
The final body is user-authored editable text; context-reference validation
protects Savia's context feature, not arbitrary text manually typed by a user.

API schemas define the new route and response fields so OpenAPI/Scalar remains
generated. No handwritten API reference is introduced.

## Components and persistence

- Shared widget contract: add `mail` as a system kind and update predicates,
  default layouts, schema tests, and system-widget handling.
- Admin integration client: add typed message listing and composer sending.
- Mail hook: caller-owned connection discovery, provider loading/error states,
  merged messages, filtering, refresh, and identity lifecycle handling.
- Mail widget: compact inbox rows and actions using the existing card host.
- Composer and context selector: separate components, using authorized tenant
  APIs and existing dialog/form conventions.
- API mail operations and routes: recent inbox retrieval, metadata hydration,
  verified links, direct caller-confirmed send, and context access validation.

Only widget layout persists through the existing backend user preferences.
Mailbox messages and composer content are transient in-memory UI state. No new
browser persistence, mailbox synchronization database, or draft-storage system
is introduced. Update `docs/my-day-widgets.md` in English to describe behavior,
connection requirements, context permissions, and sending.

## Alternatives and decision

Use a unified Savia widget with native message links and server-backed sending.
Separate provider widgets would duplicate composition and make two connected
accounts harder to scan. Delegating composition entirely to provider web pages
would make record-context insertion inconsistent and harder to validate.
The selected approach reuses Savia integrations and authorization boundaries.

## Verification and acceptance

1. Gmail-only and Outlook-only connections show the inbox; neither connection
   hides it; both connections show a merged inbox with provider filtering.
2. Gmail rows have hydrated metadata. Native links open another tab, preserve
   the relevant account, and reject unsupported destinations.
3. Provider failures retain successful results, and retry/empty/loading states
   remain distinct. Ordering and keys are deterministic across providers.
4. Widget defaults, add/remove/restore, layout parsing and persistence, and
   existing agenda behavior remain valid, including the 12-widget limit.
5. Context selection is paginated, includes only permitted data, supports
   explicit field insertion, and preserves manually edited content.
6. Identity changes clear private state. Stale requests cannot replace a newer
   selection or display a previous user's mailbox or record data.
7. Sending requires an explicit click and a caller-owned connected account.
   Invalid payloads, foreign connections, revoked context access, and deleted
   records fail before an upstream write. Existing Assistant confirmation tests
   continue to pass.
8. Tests exercise Gmail/Outlook list/send contracts, permission enforcement,
   partial failures, composer transitions, and system-widget serialization.
   Run affected admin, API, studio-server, and studio-shared tests plus relevant
   type checks and changed-file formatting. Perform local browser verification
   when the development stack is available; report unavailable verification.

Provider tests use controlled responses. Do not send a real email or change a
live mailbox while validating this feature. Attachments, replies, forwarding,
read/unread changes, deletion, full message rendering, saved drafts, additional
accounts per provider, and AI-generated prose are outside this scope.
