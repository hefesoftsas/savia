# My Day widgets

Owner: Platform UI team. Reviewed: 2026-10-03.

My Day combines personal calendar events, personal mail, and quick views of
collections. Each collection widget links to its full screen. Layout changes
save automatically to the backend and support drag, keyboard, and menu ordering.

## Widget types

| Kind                      | Content                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `agenda`                  | Day, week and month views of Google Calendar, Outlook and shared iCalendar sources.                      |
| `quick_task`              | Create a time block in a connected calendar.                                                             |
| `mail`                    | Recent inbox messages from connected Gmail and Outlook accounts, with an editable mail composer.         |
| `office_documents`        | Up to five recent private Savia and connected-drive documents, shown only while Office suite is enabled. |
| `summary`                 | Record total, counts by status, and optional amount sum.                                                 |
| `items`                   | Recent records with title, status, and date.                                                             |
| `chart`                   | Counts and optional sums grouped by status.                                                              |
| `actions`                 | Overdue records and records due today or in the next seven days.                                         |
| `plugin:<extension>:<id>` | An enabled extension's collection widget.                                                                |

New layouts include agenda, quick task, and mail. Mail is visible only when a
personal Gmail or Outlook connection is connected. Existing saved layouts are
preserved; use **Show mail** or **Add widget → Personal → Mail inbox** to restore
mail when connected. Removing or disconnecting a provider does not rewrite the
saved layout. Hidden mail still counts toward the twelve-widget limit.

Office documents can be added from **Add widget → Personal → Office documents**.
The widget merges private Savia files and connected-drive links by their update
or creation time, opens each document in a new tab, and links to the Office
suite to create a document. It reads no document lists while Office suite is
disabled for the active tenant, and stores no document data in browser storage.
If one document source fails, documents from the available source remain
visible with a notice that the list is incomplete and a retry action.

Plugin widgets are offered only when their collection matches and their
extension is enabled. If an extension becomes unavailable, its card explains
how to restore it.

## Add and arrange widgets

Use **My Day → My dashboard → Add widget**. Choose a workspace and an authorized,
visible collection, then a summary, items, chart, or actions view. Hidden screens
and request pages are excluded. Status, amount, and date fields are detected
from the collection schema and can be adjusted where applicable.

The Personal tab restores system widgets. At most twelve widgets can be saved.
Collection widgets show at most ten items. Drag handles support keyboard
ordering; the card menu also offers Move before, Move after, and Remove. Hidden
mail entries retain their saved positions when visible cards are reordered.

## Calendar views and shared sources

Use **Day / Week / Month** in the agenda. Weeks begin on Monday; months include
the full weeks touching their boundary. Previous/Next moves by the selected unit
and **Today** returns to today without changing the view. The display timezone
comes from the browser. Week/month use the full dashboard width. On mobile,
weeks stack vertically and month cells show event counts; select a date/count
to open its complete day list. Narrow cards keep the view selector and calendar
settings in one row; settings retain their accessible name while showing only
the icon. Mobile cards use compact spacing, a short date and touch-sized
navigation. A failed day read offers a retry directly in the agenda. Desktop
month cells show three events and a
**more** action for additional events. Multi-day events appear on every
overlapping date, with exclusive ends handled internally.

**Manage calendars** accepts public HTTPS and `webcal://` iCalendar subscriptions
or UTF-8 `.ics` files. A subscription updates from its feed; an imported copy
persists the file's events and does not receive later upstream changes. Re-import
creates another copy, which can replace the old one by deleting the old source.
No OAuth connection is required to read these sources. Authenticated CalDAV and
publishing or editing feed events are not provided. Existing OAuth integrations
still read Google's primary calendar and Outlook's default calendar.

Assign a source name, color and fallback IANA timezone such as `Europe/Madrid`.
The fallback applies to floating times; explicit UTC, IANA TZID and embedded
VTIMEZONE values retain their timezone semantics. Recurrence rules, additions,
exclusions and detached moved/cancelled instances are expanded for the requested
range. Unsupported `RANGE=THISANDFUTURE` exceptions or unresolvable timezones
produce a source error. All-day dates retain their original calendar dates.
Colors are accompanied by source names; selecting a feed event opens its details.
Safe native HTTPS links open in another tab. Feed text is never rendered as HTML.

Source names/colors/visibility and imported content persist privately per
principal. Toggle Google/Outlook visibility without disconnecting the account.
Hide, rename, recolor or delete added sources from the manager; only subscriptions
offer upstream refresh. Subscriptions show their last successful update time.
The full subscription URL is not returned by the source list or displayed after
saving, because feed URL tokens may grant access to private calendars.

**Synchronize** refreshes all connected providers and visible added sources.
While visible and online, calendars refresh every five minutes; focus and online
recovery trigger reads. Hidden/offline pages pause periodic reads. Feed bodies
younger than five minutes are reused on ordinary reads; manual synchronization
bypasses freshness. Last successful rows remain visible with a source-specific
notice after transient failures. Errors do not mean that a calendar is empty.

Limits are 20 added sources per principal, 1 MiB per file/feed, 62 days per query,
2,000 occurrences per source/range and 20 upstream pages per provider read.
Exceeded limits produce errors instead of silently truncated calendars. No
background scheduler runs after My Day closes. Quick tasks continue to create
today's event in connected OAuth calendars, and show that date explicitly even
when the agenda is displaying another period.

Deployment requires D1 migration `0023_personal_calendars.sql`; self-hosted
PostgreSQL uses its matching native migration and source manifest. Both use the
existing `SAVIA_MCP_SHARED_SECRET` for calendar-specific AES-GCM payload encryption. With
the key unavailable, private feed storage fails closed. Permit the configured
public feed destinations and `cloudflare-dns.com` under the runtime's outbound
network policy for subscriptions. Local verification uses controlled feeds and
does not establish live connectivity to arbitrary calendar hosts.

## Personal inbox

Mail uses the current user's Savia personal integration connections. It does
not use Codex connectors or another user's mailbox. One active account per
provider is supported. With both providers connected, messages are merged by
received date, newest first, and can be filtered to All, Gmail, or Outlook.
The widget uses shadcn tabs for account filters and pagination controls, showing
ten messages per page. **Previous** returns to a loaded page; **Next** loads older
messages when needed using Gmail and Outlook continuation cursors. Each provider
request retrieves at most twenty-five messages. Outlook continuations accept
Microsoft Graph's canonical Inbox path while retaining the fixed mailbox, host,
and query validation. The merged inbox checks each
provider's loaded boundary before showing the next page so older messages from
one account do not hide unseen newer messages from the other. Exhausted accounts
stop requesting pages. Errors retain the current page and allow retry.

Changing the account filter starts at page one. Refresh updates the latest inbox
and announces new messages, but keeps the currently displayed historical page
stable. Return to page one to see the latest messages. Loaded pages and cursors
stay in memory for the current session; account disconnection, denied access, or
identity changes clear the relevant history. This is not full mailbox
synchronization.

While My Day is visible and online, the inbox refreshes automatically every
sixty seconds after the previous read finishes. Returning to the tab or
regaining connectivity triggers a fresh read. Hidden or offline pages pause
periodic reads. Existing Savia integration events also trigger refreshes;
direct Gmail/Outlook incoming-message push subscriptions are not configured.

Manual, timed, focus, and event-triggered reads share one pending request.
Previously loaded messages remain visible during refresh and transient failures.
Failed providers retain their last successful rows alongside a recovery notice;
the next successful read replaces them. Repeated failures increase the interval
from two to four minutes, capped at five minutes, then recovery restores sixty
seconds. A connection explicitly marked disconnected/reconnect-required removes
that account's messages; denied access and identity changes clear cached state.

The first successful read per account establishes a baseline. Later reads with
new message IDs display **There are new emails in the inbox**, with an explicit
dismiss action. The bounded inbox window can also discover a message newly moved
into Inbox. Initial loading and account/session changes do not trigger this notice.
Notifications are shown inside My Day while open; there are no operating-system
notifications or background checks after the page closes. Automatic reads do not
reset a composer draft or send mail.

Each message shows its subject, sender, timestamp, and source account. Gmail
metadata is loaded through bounded header-only requests. A failed provider
shows a recovery notice while the other provider's messages remain available.
Reconnect unavailable accounts through Personal integrations.

Clicking anywhere in a linked message row opens its provider in another browser
tab. Outlook uses its native message link. Gmail uses a browser permalink from
the thread ID, falling back to the message ID when needed. The base `/mail/`
route preserves the message destination during account selection. A bounded profile read
verifies the Gmail address before selecting that account in the link; Savia's
identity and saved display labels are not used for account selection. If the
profile cannot be verified, the link omits account selection and the user may
need to choose the correct account in Gmail. Gmail's web URL format is not an
API contract and may change; the browser must be signed in to the mailbox.
Unsafe or missing links remain unavailable.
Savia does not render email HTML, bodies, or attachments in the widget.

## Compose with record context

Choose **New email**, select the connected sending account, and enter recipients,
subject, and a plain-text message. Switching accounts preserves the draft.
Recipients are entered manually, with commas or semicolons between addresses.
Sending requires an explicit **Send email** action; merely selecting a record
or inserting context does not send anything.

**Add record context** lets the user select an authorized workspace, collection,
and record. Record lists are paginated in groups of twenty-five. Select readable
fields and review the preview, then **Insert context** to append labeled values
without replacing existing prose. Long field values are limited in the preview.
The user can edit all inserted text. Removing context and clearing the message
removes references so a stale/deleted context can be discarded deliberately.

The server rechecks the selected collection, record, and fields before sending.
Revoked access, deleted records, and unavailable context stop the provider write.
Visibility alone never grants access. The message text remains user-authored;
context validation governs Savia's record insertion feature.

Limits: twenty recipients, 2,000 subject characters, 10,000 message characters,
ten context records, and fifty unique fields per record. Header injection is
rejected. No AI provider is required. Attachments, replies, forwarding, mailbox
mutations, saved drafts, and multiple accounts per provider are outside scope.

Failed sends preserve the draft. For an unknown provider outcome, check Sent
mail before retrying; Savia does not automatically retry a write. Pending sends
prevent duplicate submissions. Successful sends close and clear the composer.
Drafts and mailbox data are transient memory, cleared on identity/session changes;
closing and reopening a composer in the same session preserves an unsent draft.

## Data and authorization

Layout is private per principal and saved by
`PUT /v1/user-preferences/my-day-widgets`. Shared Zod schemas validate it. Mail
listing and sending use the generated personal integrations OpenAPI contracts.
Credentials and provider writes stay on the server; sends use existing audits.

Collection widgets read authorized tenant record and summary endpoints. A widget
whose collection becomes unavailable shows a recovery state. Extension widgets
receive the same limited runtime and effective permissions as extension screens;
errors are contained within their cards.

## Implementation

- Shared layout contract: `packages/studio-shared/src/my-day-widgets.ts`.
- Mail payload contract: `packages/studio-shared/src/mail-contracts.ts`.
- Layout persistence: user-preferences repository/routes and migration `0060`.
- Admin widgets, inbox, and composer: `apps/admin/src/features/my-day-widgets/`.
- Personal integration API: `apps/api/src/routes/personal-integrations.ts` and
  `apps/api/src/personal-integrations/`.
- Plugin contribution contract: `packages/release-catalog/src/index.ts`.

To contribute a plugin widget, follow
`packages/insurance-portfolio-dashboard/src/widgets.tsx`: export a React widget
and a contribution with extension ID, widget ID, collection, and localized title.
Register it through the extension's admin entry and release catalog. Use the
provided collection/service APIs and effective permissions.
