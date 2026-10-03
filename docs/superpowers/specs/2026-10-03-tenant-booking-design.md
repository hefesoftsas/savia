# Tenant booking

## Intent and authorization

Goal #126: ship native, tenant-owned appointment booking and merge its PR through
`main` into the existing preview deployment. The user approved the tenant model,
required professionals to be Savia users, and explicitly requested uninterrupted
implementation through PR creation and merge. No production promotion is authorized.

## Ownership and access

An optional booking module belongs to one active commercial tenant. Every setting,
booking, occupancy claim, calendar grant, and delivery job carries that tenant ID.
Only active Savia principals with active membership in that same tenant can be
professionals. Administrators configure the module and see its bookings;
professionals see their own bookings and change their own availability. Platform
administrators may configure commercial tenants but are not booking professionals.
Anonymous visitors see published services, professional display names, and slots,
never identities, customer lists, private events, or integration credentials.

## First release

Tenant settings include enabled/published switches, public title and description,
IANA time zone, lead time, booking horizon, cancellation cutoff, reminder offset,
services, and professionals. Services have an ID, name, description, duration,
trailing buffer, enabled switch, and assigned principal IDs. Each professional has
an enabled switch, weekly periods, and date-specific replacement periods (empty
periods mean a day off). Five-minute occupancy units and fifteen-minute offered
start times make cross-database unique claims exact; durations and buffers must
be multiples of five minutes. Services are individual appointments, at most 480
minutes, with buffers at most 120 minutes. Schedules do not cross midnight.

The public booking page offers a service, professional, day, and available time,
then collects customer name/email. Customers receive an unguessable management
link for viewing, cancelling, or rescheduling their own reservation without an
account. Public writes are bounded, rate limited, and CAPTCHA-verified using the
existing public-form verification configuration. Settings updates use revisions.
All instants are stored as UTC; slots are generated in the tenant's IANA zone and
ambiguous or nonexistent DST local times are skipped.

Reservations acquire unique `(tenant, professional, five-minute instant)` claims
in the same database batch as the booking and durable jobs. A conflicting claim
rolls back the batch. Reschedules release old claims and acquire new ones in one
batch with a revision guard; cancellations release claims and retain history.
Idempotency keys are scoped to the public page and payload hash; changed payloads
with a reused key conflict. Disabled users and tenants cannot receive new bookings;
existing reservations remain available for cancellation and administration.

## External calendars and delivery

Nango is optional. A professional explicitly grants one caller-owned Google Calendar
or Outlook connection to this tenant's booking module. Administrators cannot grant
someone else's calendar. Only primary-calendar busy periods are read; private event
titles and descriptions are not published. Provider failure fails availability closed
for that professional. The existing limited event listing is not an availability API.

Durable, leased jobs create/update/cancel external events and deliver confirmations,
change notices, and reminders. Calendar writes use stable provider identifiers or
transaction identifiers and persisted external IDs. Retries are bounded and visible
to administrators. Emails use the existing tenant/global SMTP transport through an
authenticated internal auth-service bridge. No credentials enter the browser.
External changes can still race a native reservation; that limitation is documented.

## API and screens

- `/v1/tenants/{tenantId}/booking`: GET bootstrap and PUT full admin settings.
- `/v1/tenants/{tenantId}/booking/availability`: PUT caller's weekly periods/exceptions.
- `/v1/tenants/{tenantId}/booking/calendar`: PUT caller's provider grant or null.
- `/v1/tenants/{tenantId}/booking/reservations`: GET scoped bookings.
- `/v1/tenants/{tenantId}/booking/reservations/{id}/cancel`: POST admin/owner cancellation.
- `/api/public/bookings/{token}`: GET published catalog.
- `/api/public/bookings/{token}/slots`: GET bounded daily slots.
- `/api/public/bookings/{token}/reservations`: POST idempotent reservation.
- `/api/public/bookings/manage/{token}`: GET reservation, POST cancel/reschedule suffixes.
- Admin `/bookings`; anonymous `/public/bookings/{token}` and management route.

The module is generic, unrelated to insurance packages. It follows existing tenant
selection, UI components, responsive behavior, and Spanish/English/Portuguese locale
patterns. Public routes do not initialize authenticated services or offline replicas.
Backend schemas generate API documentation and types.

## Verification

Tests must cover cross-tenant access, foreign/disabled professionals, published
catalog privacy, DST and buffers, concurrent overlapping reservations, replayed and
conflicting idempotency keys, reschedule rollback, cutoff enforcement, calendar
failure, durable delivery retries, and SMTP bridge authorization. Run affected suites,
type checks, builds, repository tests, and CI before merge. Verify the preview job for
the actual merged SHA. Include equivalent SQLite/D1 and PostgreSQL migrations.
