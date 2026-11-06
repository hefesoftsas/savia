# Booking integrations task

Worktree `/workspace/savia-booking`. Read AGENTS.md and the booking design. Own
`apps/api/src/bookings/calendar.ts`, `apps/api/test/booking-calendar.test.ts`,
`apps/auth/src/account-email.ts`, and `apps/auth/test/account-email.test.ts`.
You may extend the method union of PersonalIntegrationNangoClient.proxy in
`apps/api/src/personal-integrations/contracts.ts` with PATCH/DELETE. Do not modify
runtime/app/bookings routes/repository/jobs, UI, migrations, or dependencies.
No further agents, commits, pushes, or external messages. User authorized delivery.

Create and export `createBookingCalendarAdapter(db:D1Database,nango:PersonalIntegrationNangoClient)`.
Its return has:
- `busy(input:{principalId:string,provider:'google_calendar'|'outlook',connectionId:string,from:string,to:string}):Promise<{start:string,end:string}[]>`.
- `sync(input:{principalId:string,provider:'google_calendar'|'outlook',connectionId:string,id:string,title:string,startsAt:string,endsAt:string,externalId:string|null,cancelled:boolean}):Promise<string|null>`.

Read the existing personal integration repository. `connectionId` is the local
connection row ID pinned by the professional's grant; require the active connection
belongs to the principal/provider and matches that exact ID. Fail with a safe
generic error on unavailable/revoked/reconnected connection or provider responses;
never surface provider bodies/tokens. Busy uses Google /calendar/v3/freeBusy with
primary calendar, handles per-calendar errors; Outlook UTC calendarView with full
pagination and showAs/isCancelled, ignores free/cancelled events and handles all-day
events. Treat malformed or partial busy data as unavailable, not free.

Sync Google primary events with a deterministic provider-valid event ID derived
from booking `id` (hex SHA256 is suitable). Create by POST; if duplicate ID, update
the existing event via PUT. Updates use persisted ID. Cancel via DELETE, 404/410
are already cancelled. Outlook create uses stable transactionId based on booking ID;
update by PATCH with persisted ID; cancel DELETE with 404 treated as success.
No attendee lists or automatic invitation emails (durable mail job owns notices).
Provider title contains the service only; preserve UTC dates. Stable IDs must survive
retries when a successful create response was lost before persistence.

Extend accountEmailSettingsResponse's internal endpoint matching to accept
`POST /_internal/tenant-email/{tenantId}/send`, still requiring bridgeAuthorized.
Payload `{to:string,subject:string,text:string}`: one valid address, subject plain
text 1..200 without CR/LF, text 1..16000 without NUL. Bound JSON request bytes to
20 KiB; reject malformed/non-object/extra properties. Use sendAccountEmail with the
trusted path tenant ID, return `{sent:true}`, and return a safe generic unavailable
error without SMTP details. Existing GET/PUT/DELETE/test endpoint behavior must stay
unchanged. Root will use durable job leases to coordinate sending. SMTP has no
exactly-once guarantee after a crash; do not claim otherwise.

Write tests first and observe RED, then implement and verify. Cover pinned
connection mismatch, Google errors, Outlook next page/free/cancelled semantics,
Google stable IDs/create-conflict recovery, both cancellations, and SMTP bridge
authorization/payload limits/tenant transport selection. Run focused tests and
type checks. Write report `/tmp/tenant-booking-integrations-report.md` with files,
RED/GREEN evidence and concerns; return status + summary + path only.
