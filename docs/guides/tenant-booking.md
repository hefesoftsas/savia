# Tenant booking

Owner: Savia core · Reviewed: 2026-10-03

Booking is a native, optional tenant capability. It starts disabled and unpublished. It does not require a separate booking service. Professionals must be active Savia users with an active membership in the same commercial tenant; platform administrators are not eligible professionals.

## Set up and publish

Open **Bookings** in the tenant navigation. Administrators use a five-step setup wizard: **Details → Team → Services → Hours → Review and publish**. Details include the public title, description and IANA time zone; expand **Booking rules** to configure advance notice, booking horizon, cancellation cutoff and reminders. Add professionals from the tenant's users, assign them to services, then configure their weekly schedules. Moving between steps preserves unsaved edits. A service specifies its duration and trailing buffer. Durations, buffers and availability boundaries use five-minute increments; offered start times use fifteen-minute increments.

Each professional has weekly availability and date exceptions. An exception replaces that day's weekly periods; an empty exception closes the day. Periods cannot overlap or cross midnight. Administrators can configure all professionals. A professional can update their own availability without changing services or other professionals.

Use **Remove service** or **Remove professional** to remove an item from the draft. Removing a professional also clears their service assignments. Changes take effect only when saved; **Discard changes** restores the saved configuration. Existing reservations retain their history. **Save settings** keeps the chosen publication state, **Save draft** saves an unpublished configuration, and **Save and publish** enables and publishes it. A draft may have no services or professionals. Validation returns to the step that needs correction.

Publish when booking is enabled and an enabled service has an enabled professional assigned. Save the configuration before opening the public page; the link is offered only for saved, enabled and published settings. The form explains missing publication requirements before submitting. If the API rejects a save, its HTTP status and reason are shown, with known booking validation messages translated. Network failures retain the connection recovery message. Open the **Booking links** tab to create **My booking link**, bound to your configured professional, or an explicit **Team agenda** link. Customers following a personal link never select a professional. A single eligible service opens availability directly; several services add a service step. The public flow is **Service, if needed → Availability → Your details**. Availability uses a visible month calendar and time buttons together, stacked on mobile. Unavailable days are disabled, month navigation respects the booking horizon, and no time is selected until the customer clicks it. The display time zone defaults to the tenant zone and can be changed; calendar dates, times, summary, and confirmation then use that zone while reservation timestamps remain UTC. Customers review their selection, provide their name and email, and complete the configured captcha before confirming. Going back preserves their details; changing a service or professional clears the previous time. Refreshed availability must still include the selected time before proceeding. Public pages bypass the authenticated app and its offline storage. Their HTML uses no-store, no-referrer and noindex headers, and booking navigation is excluded from the service worker fallback. Public catalogs contain names and opaque booking identifiers, never internal principal identifiers or customer lists.

### Personal and team public links

New links default to a 30-day expiry and 25 admitted booking submissions per UTC day. Choose 24 hours, 7 days, 30 days, or explicitly no expiry; the daily budget can be configured from 1 to 1,000. Copy the canonical URL, use the device's share action, or show a QR code. Each link also receives a Savia short URL; when Shlink is configured, the short URL action uses it and falls back to the Savia URL if the provider is unavailable. Shortening does not grant different booking permissions.

Each link has independent revocation and deletion. Delete permanently removes the public link from the panel and invalidates its canonical and short URLs, including legacy team links; it does not delete reservations or their private management links. Personal links expose only enabled services assigned to their fixed professional; optional service-scoped links expose only that service. The server enforces this scope for the catalog, challenge, availability and reservation, including caller-submitted identifiers. Disabled professionals/services, removed membership, inactive tenants, expiry and unpublishing stop new bookings. Existing tenant-wide URLs remain team links and can be revoked or deleted through the same panel; they are never silently converted into personal links.

Expiry and revocation do not delete reservations or invalidate their distinct private management links. Deleting a public link has the same preservation behavior. Management and cancellation policies below continue to apply.

Public booking admission also limits each hashed client IP to 20 submissions and each tenant to 1,000 submissions per UTC day. Failed admitted attempts consume the budget; retrying identical details with the same request key reuses admission and does not consume it twice. Changing the payload under that key conflicts. Persistent minute limits and CAPTCHA remain in force; browsing calendar days does not consume submission budgets. Public body size is limited to 32 KiB. A bounded range contains at most 31 dates and fetches each calendar's busy intervals once, rather than making a provider request for each day. Unknown calendar availability stops booking with a retryable error.

## Reservations and management

Administrators see the tenant's reservations; other tenant members see only reservations assigned to themselves. Concurrent native bookings claim the professional's occupied intervals atomically, including the trailing buffer. Conflicting requests return a recoverable conflict and create no partial reservation. Request keys prevent duplicate reservations when a customer retries a submission.

Confirmed appointments also appear in the assigned professional's **My Day**
agenda, in day, week and month views, even without Google Calendar or Outlook.
My Day shows only the signed-in user's assignments across their current commercial
workspace memberships; administrators use **Bookings → Reservations** for team
history. Appointment details link to authenticated workspace reservations where
tenant hostnames are supported, opening the appointment date directly.
**Show upcoming reservations** clears that date. Details never expose the customer's private
management token. Rescheduling and cancellation are reflected when My Day
refreshes, including **Synchronize**, focus/connectivity recovery and visible
five-minute polling. See [My Day widgets](../my-day-widgets.md).

The confirmation contains a private management link. Anyone possessing this link can view, cancel or reschedule that single reservation, so treat it as private. Customers can change a confirmed reservation before the tenant's cutoff. Cancelled reservations release their intervals. Rescheduling replaces the old occupancy atomically and keeps the old time if the new time conflicts. Changing a service's duration or buffer requires contacting the business before rescheduling an existing reservation. Administrators and assigned professionals can cancel through their authenticated agenda without the customer cutoff.

Choose **Reschedule** from the private management page to use the same inline calendar, time buttons and display time zone as a new booking. The service and professional remain fixed to the reservation. Choose a different time, review the existing and proposed appointment, then confirm the change; navigating back or leaving the editor does not change the appointment. Successful changes refresh the reservation's revision and retain its private management link. A stale slot returns to refreshed availability; an identical retry after a lost success response checks the current appointment before claiming success.

Private calendar availability is scoped to the reservation's token and is independent of public sharing-link expiry or revocation. It excludes that reservation's native occupied intervals while retaining all other appointments and external calendar busy periods. Rescheduling is unavailable after the cutoff or when the tenant, professional, service or original duration/buffer no longer permits it; the page explains how to contact the business. Viewing and eligible cancellation remain available under their existing rules. The link to book another appointment appears only when the tenant-wide public link remains available.

Unpublishing stops new public bookings. Existing management links continue to support viewing and cancellation; rescheduling requires published booking settings. Removing or disabling a professional does not erase historical reservations. Deactivated tenants retain existing private management links and authorized reservation history and cancellation; public booking and rescheduling stay blocked. Delivery jobs stop while the tenant is inactive.

## Optional calendars through Nango

To avoid conflicts with the rest of your My Day agenda, use **Bookings → Availability → My Day availability → Use My Day to block busy times**. Each professional grants access to their own current Google and Outlook connections and imported or subscribed calendars. Only occupied time intervals influence public availability; meeting names, attendees, links and calendar credentials remain private. Hidden calendars remain conflict sources: hiding a calendar is a display preference, not a release of its occupied time. Events explicitly marked free and cancelled events do not block slots. All-day events use the source time zone and exclusive end date; recurring events retain their exceptions.

Authorization is tenant-scoped and snapshots source identities. Use **Update calendar access** after adding a calendar or reconnecting an account, or **Stop using My Day** to revoke this additional access. Administrators cannot authorize another professional's agenda. The separate calendar choice below still controls where appointment events are created.

Availability and confirmation/rescheduling share the same conflict check, including appointment duration and trailing buffer. Subscriptions are refreshed again when confirming or rescheduling. A failed or stale authorized source stops booking instead of presenting unknown time as free. When another meeting or appointment occupies the requested interval, the form explains the conflict and reloads available times while preserving customer details. Reprogramming excludes only the appointment's saved event in the same connected account; another overlapping meeting still blocks the move. External providers cannot participate in the booking transaction, so changes made outside Savia after its final check can still require review.

Connect a personal Google Calendar or Outlook integration first. Each professional then explicitly grants booking access to their own connected calendar. Administrators cannot grant access to someone else's personal integration. Grants are scoped to the tenant and pinned to the connection; reconnecting requires a fresh grant.

Availability checks the Google primary calendar or the user's Outlook calendar. Google uses its complete free/busy response; Outlook follows pagination. Malformed responses, disconnected grants and provider failures stop new bookings instead of treating unknown availability as free. A professional may revoke the booking grant and use only the native agenda.

Calendar jobs create, update or cancel a corresponding event. Google events use a deterministic identifier; Outlook events use a transaction identifier and a persistent booking marker to recover an event when a creation response is lost. Revoked grants do not authorize further external writes. Rescheduling ignores only this appointment's saved event in the same connected account; other meetings still block the requested interval. External calendar providers do not participate in Savia's database transaction, so simultaneous changes made outside Savia can still conflict and require review.

### Automatic video calls

When a professional has granted calendar access, new appointments request a
video call if that calendar advertises support: Google Meet for Google Calendar,
or Teams for Outlook. Savia checks the actual calendar capabilities; connecting
an account alone does not guarantee conferencing support. A calendar without the
capability still receives an ordinary appointment. Zoom and Jitsi are not part of
this booking integration.

The Nango Google connection must allow calendar metadata reads in addition to
event writes and free/busy reads (for example, `calendar.readonly` plus
`calendar.events`, or the broader `calendar` scope). Outlook uses delegated
`Calendars.ReadWrite` for calendar metadata and event operations. Existing
connections with narrower scopes may need reauthorization before provisioning
can succeed; Savia does not expand consent automatically.

Provisioning runs through the existing background calendar jobs after the native
reservation is confirmed. The reservation stores the external event identifier,
meeting provider, link, and provisioning state. Pending links reuse the same event
on bounded retries (up to five job attempts); a provider failure never cancels the
native reservation. Unknown calendar capabilities are retried instead of being
silently treated as unsupported. A final failure is shown as unavailable rather
than leaving a permanent pending indicator.

Open the appointment in **Bookings → Reservations**, or use its private management
link, to view the call status and join a ready meeting. Refresh the appointment
after pending provisioning. Customer confirmation screens can show the returned
status; the management page contains the latest saved result. Emails include a
ready call link when it has already been saved; an earlier confirmation email
still includes the private management link. No video link is exposed in public
catalogs or availability results.

Rescheduling updates the existing calendar event and preserves its call. Cancelling
hides the join action immediately and queues deletion of the same provider event.
Links are accepted only as HTTPS participant URLs. The existing tenant grant,
professional membership and pinned Nango connection checks apply to every job.
Teams link validation includes the documented [sovereign cloud client hosts](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/sovereign-cloud)
as well as commercial Teams hosts; the connection must still be configured for
the correct cloud. Refreshing a pending link cannot overwrite a later appointment
cancellation or reschedule.

Deploy the forward migrations `0028_booking_conferences.sql` for D1 and PostgreSQL
before the updated API. No live provider calls are required by the automated
fixtures; live account, policy and license compatibility still needs verification
in the target environment.

## Email and delivery status

Confirmation, rescheduling, cancellation and optional reminder messages use the tenant's configured outbound mail first, or the existing global SMTP/transactional fallback when tenant mail is unconfigured. Mail setup is optional for booking: without a transport, the reservation is confirmed and delivery is marked skipped with `BOOKING_EMAIL_NOT_CONFIGURED`. A configuration-read or delivery failure remains retryable and does not undo the reservation. Configure mail under the existing tenant email settings; a contact address alone is not a sending transport. Messages include the customer, service, professional, start/end, duration, time zone and private management link. The customer locale is saved as English, Spanish or Portuguese at creation; older reservations default to English. Delivery and calendar status appear separately from reservation status: a reservation remains confirmed while delivery is pending or failed.

The scheduler processes a durable outbox, leases work and retries transient errors up to five times. A per-reservation lock orders delivery across concurrent schedulers. Reservation changes return a retryable conflict while an active delivery lease is held. Reminder jobs for an old revision or a cancelled appointment are skipped. SMTP delivery is at least once: a crash after SMTP acceptance but before persistence can produce a duplicate message. Terminal failures remain visible and require correcting the provider configuration and operational intervention.

## Deployment and verification

Both SQLite/D1 and PostgreSQL have forward migrations `0022_tenant_bookings.sql`, `0026_booking_public_links.sql`, `0027_booking_public_link_short_urls.sql` and `0029_booking_agenda_grants.sql`. Migration `0026` adds scoped links, daily admission receipts and stored customer locale, and preserves existing tenant URLs as independently revocable team links. Migration `0027` adds short URL storage and deletion tombstones. Migration `0029` stores each professional's tenant-scoped My Day availability grant. Apply the D1 migration before deploying the updated API. Existing tenants remain disabled until configured. API reference is generated from the Booking OpenAPI routes.

Public requests enforce body limits, per-link request throttling, no-cache and no-referrer headers, and captcha verification. ALTCHA proofs are consumed once; retrying the same confirmed request key returns the existing reservation. Captcha bypass is limited to local development origins.

Admission hashes are retained for seven days so failed requests can be retried without consuming another daily admission. The scheduled booking worker removes up to 500 older receipts per pass. Confirmed reservations retain their own idempotency record and private management link.
