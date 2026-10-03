# My Day loading and refresh behavior

My Day reads its widget layout and calendar events from the backend. The admin
keeps a short-lived, in-memory copy for the current signed-in session so that
returning to the page can show the last result while it refreshes from the
server. This copy is discarded when the session is cleared or the authenticated
identity changes; it is never written to browser storage.

Calendar providers load independently after the connected calendars are known.
As each provider responds, its events appear without waiting for slower
providers. A failed provider is reported as a partial synchronization failure;
events already shown for that provider remain visible during refresh. An
explicit refresh checks connections and events again, and events created from
the quick task form are added immediately so a later provider response cannot
hide a newly created task.

The server remains authoritative for both widget layout and calendar data. The
in-memory copy is only a display aid between route mounts, and older in-flight
responses are discarded after a newer refresh or an identity change.

The optional Office documents widget reads recent Savia and connected-drive
documents only while Office suite is enabled for the active tenant. It shows at
most five links ordered by their most recent update or creation time. It does
not cache document details in browser storage, and it refreshes when the
identity, active tenant, Office settings, or connected integrations change.

The agenda now reads selected day/week/month ranges. OAuth caches are keyed by
the requested range; shared-source display caches also include the display
timezone and keep at most sixteen ranges per client. Switching ranges cannot
display a previous range's rows while the new range loads. Removing or modifying
a source invalidates cached source ranges. Session/identity events clear private
state and obsolete responses cannot restore it.

Added iCalendar sources use an independent caller-owned D1 repository. Feed
bodies and URL tokens are encrypted; imported files are persisted snapshots.
Subscriptions use a five-minute freshness window, conditional HTTP validators,
and bounded server fetch/parsing. Ordinary range reads reuse fresh bodies and
expand only the requested occurrences. Manual Synchronize bypasses freshness.
Revision checks stop old upstream responses from replacing edited/deleted rows.

Visible online pages refresh calendars every five minutes and refresh on focus
or connectivity recovery. Timers pause reads while hidden/offline and are removed
on unmount. There is no background job or provider push subscription. Pending
source reads share a request, and successes publish without waiting for slower
sources. Transient failures retain last successful rows with a stale/error notice;
denied access clears private rows. Google/Outlook follow bounded continuation
pages so a busy month does not stop after the first 25/50 events. Source/page/
occurrence limits fail explicitly rather than reporting a truncated success.
