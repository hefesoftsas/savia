# My Day shared calendars and weekly/monthly views

Date: 2026-10-03. Status: awaiting written-spec review.

## Intent and approved scope

Let the signed-in user read calendars shared using existing standards and
plan across a day, week, or month inside My Day. The user approved iCalendar
subscriptions over HTTPS/WebCal, `.ics` file imports, Day/Week/Month navigation,
Monday-first weeks, source colors and visibility, recurrence and timezone
handling, and source-specific errors. Google Calendar and Outlook remain
available through the user's existing Savia connections.

Success means a shared calendar can be added without connecting a Google or
Microsoft account, its events appear in all three views, and navigating a busy
month does not silently omit events after the providers' first response page.

This is a platform feature. Codex connectors, industry calendars, authenticated
CalDAV, publishing calendars, and modifying subscribed/imported events are
outside this release. A file import is a persistent snapshot; a subscription is
updated from its original feed. Existing quick tasks still write only to a
connected Google Calendar or Outlook account.

## Existing foundations and boundaries

- `my-day-page.tsx` owns an agenda state passed to the widget section. The
  section also supports standalone rendering with a default agenda.
- `agenda-widget.tsx` currently hardcodes today's local range and caches by
  client/day, with independent provider loading and session invalidation.
- Personal integration operations query Google's primary calendar or Outlook's
  default calendar. They currently stop after 25 or 50 events respectively.
- Existing event payloads do not explicitly distinguish all-day events.
- The D1 personal integration repository supports one OAuth connection per
  principal/provider. Multiple feed sources belong in a separate repository;
  they must not consume or impersonate OAuth connection slots.
- Public URL/DNS validation and bounded body reads exist in
  `packages/studio-server/src/integrations.ts`. AES-GCM private-payload patterns
  exist in the API. Reuse these foundations with calendar-specific errors.

## User experience

Place Day/Week/Month controls, a period label, Previous/Next, Today, Synchronize,
and Manage calendars in the agenda widget. Day remains the initial view and
today the initial selected date. View/date state remains in memory. The page's
My Day heading and other widgets retain their existing purposes and layout
preferences; removing and restoring the agenda still works.

Day shows the selected date's chronological list. Week shows seven Monday-first
day columns with chronological events and an all-day section. Month shows a
seven-column calendar with every whole week touching the month, including muted
adjacent-month dates. Month cells show three events and a keyboard-accessible
"more" action opening that day's complete list. Selecting a date opens Day.
Week/Month give the agenda the full dashboard width. On narrow screens, Week
uses a vertical sequence of days; Month keeps the compact grid and day detail.

Previous/Next moves by the current unit; month changes clamp the selected day
to the target month's last date. Today moves to today's date without changing
the view. Local calendar arithmetic, rather than fixed 24-hour additions,
determines boundaries across daylight-saving changes. Show the display timezone
in the calendar toolbar, using the browser's IANA timezone.

Every event has a source label and source color. Color is accompanied by text
so it is never the only distinction. Multi-day events appear on each overlapping
day; an exclusive end date does not add an extra day. Events without a safe
native link open an internal detail dialog with title, source and dates.
External links use HTTPS and `noopener noreferrer`. Render feed titles as plain
text, with no remote images, attachments or HTML rendering.

Manage calendars lists connected provider calendars and added sources. Users
can toggle visibility. Added sources can also be named, assigned a palette
color, refreshed, or deleted. A subscription form accepts a name, URL and fallback
IANA timezone, defaulting to the browser timezone. A file form accepts the same
metadata and a UTF-8 `.ics` file. Show "Subscription" or "Imported copy" clearly;
copies have no upstream refresh action. Re-importing creates a separate copy,
and users can delete the old one. Source deletion does not change OAuth accounts.

Quick tasks keep today's existing date behavior and show that date explicitly;
calendar navigation must not silently change the day used to create a task.

Loading, empty, partial-error, and limit-exceeded states are distinct. Show the
last successful sync time per subscription. Failures retain the source's last
successful events with a stale notice while successful sources remain usable.
Deleting a source immediately clears its displayed events and pending reads.

## Standards and event model

Parse RFC 5545 iCalendar using `ical.js` in a small server adapter, validated in
the Workers runtime. Do not implement a custom line/recurrence parser. Support
folded lines, escaped text, `VEVENT`, `UID`, `DTSTART`, `DTEND`, `DURATION`,
`RRULE`, `RDATE`, `EXDATE`, and detached `RECURRENCE-ID` exceptions. Ignore
cancelled instances and select the newest duplicate component by sequence and
revision date. Unsupported `RANGE=THISANDFUTURE` exceptions or unresolvable time
definitions produce an explicit source error rather than incorrect occurrences.

Handle UTC, embedded `VTIMEZONE`, IANA TZID values, floating local dates/times,
and date-only all-day events. Resolve floating times in the saved source fallback
timezone. Keep all-day values as date strings with an exclusive end date rather
than converting them to UTC midnights. Missing ends use RFC defaults: one day for
date-only starts and zero duration for timed starts. Recurring instances retain
stable identities based on source, UID and original recurrence start, including
moved exceptions. Scope deduplication to one source, never just matching titles.

Introduce a shared calendar event contract with source ID, instance ID, nullable
title, start/end, `allDay`, and nullable native link. Timed bounds are ISO instants;
all-day bounds are ISO dates. Preserve a source timezone for details. Normalize
Google's `start.date` and Outlook's `isAllDay` into this model. Extend existing
provider event responses additively and preserve the list response's `data` array.
Existing event creation and Assistant actions retain their contracts.

Expand only the requested range, including events that begin before it and
overlap it. Bounds are half-open `[from, to)`. Limit visible queries to 62 days,
feed content to 1 MiB, sources to 20 per principal, and expanded output to 2,000
events per source/range. Bound recurrence iteration to 100,000 steps per query.
An exceeded limit is an explicit error; no successful response may silently
truncate. Persisting a feed validates its structure; range reads validate bounded
expansion. Empty valid calendars are accepted; malformed components fail clearly.

## Persistence and API

Add a D1 table and shared schema for caller-owned calendar sources: ID,
principal ID, kind (`subscription` or `import`), name, palette color, visibility,
fallback timezone, encrypted payload, encrypted upstream validators, last
successful sync timestamp, revision, and created/updated timestamps. The private
payload stores the feed URL and latest valid ICS body for subscriptions, or
the imported body for copies. Avoid materializing recurrence instances in D1.
Foreign-principal IDs return not found before any decryption or network access.

Use a calendar-specific AES-GCM cipher derived with a separate context from
`SAVIA_MCP_SHARED_SECRET`, binding principal and source IDs as additional data.
Never fall back to plaintext if the key is unavailable. Raw subscription URLs,
feed bodies and validators are absent from list responses, logs and realtime
events. URL tokens may grant access to private calendars. The manager identifies
the subscription by name and hostname, not by exposing its full saved URL.

Provide generated OpenAPI routes under `/v1/personal-integrations/calendars`:
list sources, create a subscription/import, update name/color/visibility, delete
a source, list source events for a range/timezone, and refresh a subscription.
Import content travels in a bounded validated request; the browser does not read
remote subscription URLs. Server code resolves the principal from the session
and applies existing API read/write scopes and CSRF/session protections.
Source methods work without Nango configuration; existing OAuth provider methods
keep their connection checks. Generate the admin API types from route schemas.

Provider visibility preferences persist per principal through
`GET/PUT /v1/user-preferences/calendar`, using the existing user preferences
boundary and a new `user_calendar_preferences` table (principal ID, validated
settings JSON, updated timestamp). Settings contain Google/Outlook visibility
booleans, defaulting to true when no preference exists; toggles are not OAuth
disconnects. Subscription/import visibility lives with its source. No calendar
data or preferences are written to browser storage. Source and preference
mutations emit the existing principal-scoped personal-integrations refresh hint.

## Refresh, fetching, and provider completeness

On initial display and range changes, read sources independently. A subscription
younger than five minutes uses its cached valid body; older sources refresh on
read. Manual Synchronize bypasses the freshness window. While visible and online,
refresh every five minutes, also checking freshness on focus/online recovery.
Hidden/offline pages pause refreshes. There is no background scheduler or live
provider push subscription in this release. File copies only re-expand their
stored content. Concurrent reads share pending work within a session.

Use ETag/Last-Modified validators where available. A 304 keeps the prior body;
a valid 200 atomically replaces it. Invalid responses and transport failures
keep the prior body and report a stale source. Repository writes check source
revision so a stale refresh cannot overwrite edits or recreate a deleted source.
UI caches key by source set, timezone and range, discard out-of-order responses,
and clear private state on identity/session changes.

Normalize `webcal://` to HTTPS; accept public HTTPS port 443 destinations. Reject
embedded credentials, fragments, IP literals and private/reserved destinations.
Reuse existing public-DNS checks before every fetch and manually validated
redirect, with at most three redirects, ten seconds total timeout and streaming
body limits. Do not forward Savia authorization, cookies or source-specific
headers across redirects. Do not assume a `.ics` suffix or trust MIME type alone:
parse a valid VCALENDAR body. No feed instructions can trigger writes or fetch
attachments. Respect deployment network policy; denied destinations surface as
source errors. DNS preflight follows existing protection and is not a guarantee
of DNS pinning; use the runtime's network isolation as the second boundary.

For Google's primary calendar, follow `nextPageToken` using fixed provider paths
and bounded tokens. For Outlook, use `calendarView` and validate continuation
links against the fixed Graph host, caller mailbox route and original range.
Include `isAllDay` and exclude cancelled events. Follow at most 20 pages and
2,000 events per requested range; report a source error if more remain. Tests
must include months exceeding 25 Google and 50 Outlook events. Preserve one
active account per provider and current default-calendar scope; calendars shared
as ICS sources are supported without expanding OAuth calendar selection.

## Implementation boundaries

- Shared schemas: source metadata, event semantics and calendar preferences.
- API: source repository/cipher, public feed transport, iCalendar parser/expander,
  caller-owned OpenAPI routes, runtime wiring and D1 migration.
- Provider adapter: bounded complete range reads and explicit all-day metadata.
- Admin: typed source client, range-aware agenda lifecycle, date helpers,
  Day/Week/Month views and source manager built with existing UI primitives.
- Documentation: update `docs/my-day-widgets.md` and
  `docs/guides/my-day-performance.md`; document required key and network access.

Keep parsing, network transport, persistence and UI concerns in focused files.
Avoid adding the entire subsystem to the existing large operations or widget
files. No unrelated refactoring or new layout widget kind is required.

## Acceptance and verification

1. Add multiple HTTPS/WebCal subscriptions and a file copy without OAuth;
   reload and verify caller-owned source metadata and imported events persist.
2. Validate folded text, all-day/multi-day values, embedded/IANA timezones, DST,
   floating times, recurring exclusions/additions, moved/cancelled exceptions,
   and stable IDs with controlled RFC fixtures.
3. Navigate days, Monday-first weeks, month ends and year boundaries. Verify
   boundary overlaps and complete "more" day lists on desktop and mobile.
4. Verify provider pagination beyond current limits, unsafe continuations,
   request/expansion limits and partial failures without false empty states.
5. Test owner isolation for every read/mutation, ciphertext principal binding,
   URL/redirect/DNS checks, bounded fetch/import, conditional requests, stale
   revisions and source deletion during a pending refresh.
6. Verify source names/colors/visibility persistence, subscription refresh vs
   copy behavior, stale-state recovery, identity invalidation and obsolete ranges.
7. Preserve widget restore/order/save, inbox behavior, today's quick-task writes
   and existing provider event/action contracts. Test keyboard focus, labeled
   controls, non-color distinctions, narrow layouts and dark mode.
8. Run affected shared/admin/API tests, migration checks, generated API types,
   relevant type checks and changed-file formatting. Perform local browser
   verification when the stack is available; report checks that cannot run.

Use controlled feeds and provider responses for verification; do not write to
real calendars. Arbitrary live feed access may be restricted by this workspace's
network policy, so fixture tests do not establish live provider connectivity.
