# Tenant booking

Owner: Savia core · Reviewed: 2026-10-03

Booking is a native, optional tenant capability. It starts disabled and unpublished. It does not require a separate booking service. Professionals must be active Savia users with an active membership in the same commercial tenant; platform administrators are not eligible professionals.

## Set up and publish

Open **Bookings** in the tenant navigation. A tenant administrator can enable booking, configure its title and description, select an IANA time zone, and set advance notice, booking horizon, cancellation cutoff and reminder timing. Add professionals from the tenant's users and assign them to services. A service specifies its duration and trailing buffer. Durations, buffers and availability boundaries use five-minute increments; offered start times use fifteen-minute increments.

Each professional has weekly availability and date exceptions. An exception replaces that day's weekly periods; an empty exception closes the day. Periods cannot overlap or cross midnight. Administrators can configure all professionals. A professional can update their own availability without changing services or other professionals.

Publish when an enabled service has an enabled professional. Copy the generated public link. Customers choose a service, professional, date and time, then provide their name and email and complete the configured captcha. Public pages bypass the authenticated app and its offline storage. Their HTML uses no-store, no-referrer and noindex headers, and booking navigation is excluded from the service worker fallback. Public catalogs contain names and opaque booking identifiers, never internal principal identifiers or customer lists.

## Reservations and management

Administrators see the tenant's reservations; other tenant members see only reservations assigned to themselves. Concurrent native bookings claim the professional's occupied intervals atomically, including the trailing buffer. Conflicting requests return a recoverable conflict and create no partial reservation. Request keys prevent duplicate reservations when a customer retries a submission.

The confirmation contains a private management link. Anyone possessing this link can view, cancel or reschedule that single reservation, so treat it as private. Customers can change a confirmed reservation before the tenant's cutoff. Cancelled reservations release their intervals. Rescheduling replaces the old occupancy atomically and keeps the old time if the new time conflicts. Changing a service's duration or buffer requires contacting the business before rescheduling an existing reservation. Administrators and assigned professionals can cancel through their authenticated agenda without the customer cutoff.

Unpublishing stops new public bookings. Existing management links continue to support viewing and cancellation; rescheduling requires published booking settings. Removing or disabling a professional does not erase historical reservations. Deactivated tenants retain existing private management links and authorized reservation history and cancellation; public booking and rescheduling stay blocked. Delivery jobs stop while the tenant is inactive.

## Optional calendars through Nango

Connect a personal Google Calendar or Outlook integration first. Each professional then explicitly grants booking access to their own connected calendar. Administrators cannot grant access to someone else's personal integration. Grants are scoped to the tenant and pinned to the connection; reconnecting requires a fresh grant.

Availability checks the Google primary calendar or the user's Outlook calendar. Google uses its complete free/busy response; Outlook follows pagination. Malformed responses, disconnected grants and provider failures stop new bookings instead of treating unknown availability as free. A professional may revoke the booking grant and use only the native agenda.

Calendar jobs create, update or cancel a corresponding event. Google events use a deterministic identifier; Outlook events use a transaction identifier and a persistent booking marker to recover an event when a creation response is lost. Revoked grants do not authorize further external writes. A connected calendar's existing reservation event may restrict moves that overlap that event; choose a free time. External calendar providers do not participate in Savia's database transaction, so simultaneous changes made outside Savia can still conflict and require review.

## Email and delivery status

Confirmation, rescheduling, cancellation and optional reminder messages use the tenant's existing SMTP configuration. Configure account email before enabling booking. Delivery and calendar status appear separately from reservation status: a reservation remains confirmed while delivery is pending or failed.

The scheduler processes a durable outbox, leases work and retries transient errors up to five times. A per-reservation lock orders delivery across concurrent schedulers. Reservation changes return a retryable conflict while an active delivery lease is held. Reminder jobs for an old revision or a cancelled appointment are skipped. SMTP delivery is at least once: a crash after SMTP acceptance but before persistence can produce a duplicate message. Terminal failures remain visible and require correcting the provider configuration and operational intervention.

## Deployment and verification

Both SQLite/D1 and PostgreSQL have forward migration `0022_tenant_bookings.sql`. Preview deployment applies the D1 migration before the API is deployed. Existing tenants remain disabled until configured. API reference is generated from the Booking OpenAPI routes.

Public requests enforce body limits, per-link request throttling, no-cache and no-referrer headers, and captcha verification. ALTCHA proofs are consumed once; retrying the same confirmed request key returns the existing reservation. Captcha bypass is limited to local development origins.
