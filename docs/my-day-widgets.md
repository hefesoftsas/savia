# My Day widgets

Owner: Platform UI team. Reviewed: 2026-10-01.

My Day combines personal calendar events, personal mail, and quick views of
collections. Each collection widget links to its full screen. Layout changes
save automatically to the backend and support drag, keyboard, and menu ordering.

## Widget types

| Kind                      | Content                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `agenda`                  | Today's Google Calendar and Outlook events with native links.                                    |
| `quick_task`              | Create a time block in a connected calendar.                                                     |
| `mail`                    | Recent inbox messages from connected Gmail and Outlook accounts, with an editable mail composer. |
| `summary`                 | Record total, counts by status, and optional amount sum.                                         |
| `items`                   | Recent records with title, status, and date.                                                     |
| `chart`                   | Counts and optional sums grouped by status.                                                      |
| `actions`                 | Overdue records and records due today or in the next seven days.                                 |
| `plugin:<extension>:<id>` | An enabled extension's collection widget.                                                        |

New layouts include agenda, quick task, and mail. Mail is visible only when a
personal Gmail or Outlook connection is connected. Existing saved layouts are
preserved; use **Show mail** or **Add widget → Personal → Mail inbox** to restore
mail when connected. Removing or disconnecting a provider does not rewrite the
saved layout. Hidden mail still counts toward the twelve-widget limit.

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

## Personal inbox

Mail uses the current user's Savia personal integration connections. It does
not use Codex connectors or another user's mailbox. One active account per
provider is supported. With both providers connected, messages are merged by
received date, newest first, and can be filtered to All, Gmail, or Outlook.
The widget shows ten messages from a bounded window of up to twenty-five per
provider. Refresh loads a new window; this is not full mailbox synchronization.

Each message shows its subject, sender, timestamp, and source account. Gmail
metadata is loaded through bounded header-only requests. A failed provider
shows a recovery notice while the other provider's messages remain available.
Reconnect unavailable accounts through Personal integrations.

Outlook's native message link opens another browser tab. Unsafe or missing
links are unavailable. Gmail's API has no supported native message web link;
Gmail messages display **Link unavailable** rather than an unverified URL.
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
