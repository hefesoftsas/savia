# Booking UI task

Work in `/workspace/savia-booking`. Read AGENTS.md and the booking design first.
Own only `apps/admin/src/features/bookings/*`, private app route wiring, public
bootstrap wiring, sidebar navigation and its locale keys/tests. Do not edit API,
auth, DB, generated API files, or dependencies. No further agents or commits.

Build `/bookings` using AppServices apiClient, existing tenant selection conventions
and current components. Private configuration includes enable/publish, title,
description, IANA zone, lead/horizon/cancellation/reminder, services, and professional
weekly periods/exceptions. The eligible member picker must use server candidates;
never allow arbitrary principal IDs. Show public URL, own calendar consent and
connection status, reservation status, customer, times, cancellation, and delivery
failure. Non-admin professionals can change only their own schedule and calendar.
Use pending, empty, failure, version-conflict, and recovery states. Schedule editors
must be usable controls, not raw JSON. Preserve current tenant when refreshing.

The server contract (all JSON responses use `{ data: ... }`):

`GET /v1/tenants/{id}/booking` =>
`{settings: Settings, candidates: {principalId,displayName}[],canManage:boolean,
principalId:string,publicUrl:string|null,calendar:{provider:null|'google_calendar'|'outlook',status:string}}`.

`Settings={version:number,enabled:boolean,published:boolean,title:string,
description:string,timeZone:string,leadMinutes:number,horizonDays:number,
cancellationMinutes:number,reminderMinutes:number,services:Service[],professionals:Professional[]}`.
`Service={id:string,name:string,description:string,durationMinutes:number,
bufferMinutes:number,enabled:boolean,professionalIds:string[]}` (professional IDs
are configuration IDs, not principal IDs).
`Professional={id:string,principalId:string,enabled:boolean,weekly:Period[],exceptions:Exception[]}`.
`Period={day:number,start:string,end:string}` uses JS weekdays 0=Sunday..6=Saturday.
`Exception={date:string,periods:{start:string,end:string}[]}` replaces that day's plan.
Durations 5..480 and buffers 0..120 are multiples of five; times HH:mm multiples of
five. Full `PUT /v1/tenants/{id}/booking` body Settings returns new bootstrap.
Caller own `PUT .../booking/availability` body `{weekly,exceptions,version}` returns
bootstrap. `PUT .../booking/calendar` body `{provider:null|'google_calendar'|'outlook'}`
returns bootstrap; use explicit opt-in copy, links to existing personal integrations.

`GET .../booking/reservations?from=ISO&to=ISO` => `Reservation[]`; bounded date range.
`POST .../booking/reservations/{id}/cancel` body `{version}` => Reservation.
`Reservation={id,serviceId,professionalId,serviceName,professionalName,startsAt,
endsAt,customerName,customerEmail,status:'confirmed'|'cancelled',version:number,
deliveryStatus:string,calendarStatus:string}`.

Public routes must be lazy, bypass private App/services/offline/PWA initialization:
`/public/bookings/{token}` and `/public/bookings/manage/{token}`.
`GET /api/public/bookings/{token}` =>
`{title,description,timeZone,cancellationMinutes,services:{id,name,description,
durationMinutes,professionalIds:string[]}[],professionals:{id,name}[],captcha:object}`.
Use existing public CAPTCHA adapter (PublicForms captchaProvider/site key contract);
ask coordinator if exact captcha config differs before embedding a widget.
`GET .../{token}/slots?serviceId=X&professionalId=X&date=YYYY-MM-DD` =>
`{slots:{startsAt,endsAt}[],timeZone}`.
`POST .../{token}/reservations` body `{serviceId,professionalId,startsAt,customerName,
customerEmail,captchaToken}` with stable `Idempotency-Key` header per unchanged form
=> `{reservation:Reservation,managementUrl:string}`. Keep key on retry; reset when
payload changes. Never call private services from public screens.
`GET /api/public/bookings/manage/{token}` =>
`{reservation:Reservation,publicUrl:string,timeZone:string,cancellationMinutes:number}`.
`POST .../manage/{token}/cancel` body `{version}` => Reservation.
`POST .../manage/{token}/reschedule` body `{version,startsAt}` => Reservation; load slots
using publicUrl's page token and reservation's serviceId/professionalId, retain token.
Display times in tenant IANA zone, never silently browser-local.

Use Spanish/English/Portuguese via existing localized feature dictionaries; all
new raw dictionary keys/source documentation must be English. Follow impeccable
Operate guidance and existing styles. If the launcher is unavailable, report it,
read project context and skill refs directly; do not invent missing design files.
Write behavior tests first, observe failure, implement, run focused tests. Include
public bootstrap coverage proving no private initialization, tenant switch stale
response handling, conflict feedback, and stable submission key retries.

Write a detailed report to `/tmp/tenant-booking-ui-report.md`, including changed
files, commands/results and concerns. Return only status, concise test summary,
and report path. Do not spawn agents, push, merge, or send external messages.
