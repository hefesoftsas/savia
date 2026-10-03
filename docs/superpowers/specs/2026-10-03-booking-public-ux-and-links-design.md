# Public booking availability and scoped links

Status: approved by the user and implemented; local verification complete, PR/preview rollout in progress.

## Problem and evidence

The current public wizard always asks for a professional, even when the customer follows a person's shared link. Its availability step uses a native date input and an hour select. These controls hide the actual availability and make the customer guess dates. The previous wizard work improved form organization but did not solve this interaction.

The current URL resolves tenant-wide settings, not a personal booking context. Hiding the professional select alone would therefore leave an ambiguous and insecure association. Booking already has CAPTCHA, persistent minute limits, idempotency, and atomic occupancy protection. It lacks the independently expiring/revocable links and daily submission budgets used by Savia's other public links.

Research reviewed Easy!Appointments' upstream source, not its live demo, which was inaccessible from this environment:

- [Date/time screen](https://github.com/alextselegidis/easyappointments/blob/main/application/views/components/booking_time_step.php): inline calendar and available hours alongside one another; stacked on small screens.
- [Booking controller](https://github.com/alextselegidis/easyappointments/blob/main/assets/js/pages/booking.js): month availability, inline calendar, preselected service/provider, and skipped redundant choices.
- [Availability client](https://github.com/alextselegidis/easyappointments/blob/main/assets/js/http/booking_http_client.js): available times rendered as clickable buttons.

Savia references: `docs/public-forms.md`, `apps/api/src/public-forms/service.ts`, `apps/api/src/public-forms/captcha.ts`, and `apps/api/src/pages/public-sharing.ts`.

## Customer journey

A personal link opens a page identifying the professional: for example, “Reserva con Jose Ramirez”. The professional is fixed by the server. Customers cannot choose or submit a different professional through that link.

The sequence is **Service, if needed → Availability → Details and confirmation**. One eligible service, or a service-scoped link, skips the service step. Progress numbering reflects the actual remaining steps. Several services appear as readable choices with duration and description. A separate, explicitly labeled team link can offer professional selection; even there, a single eligible professional is selected automatically.

The availability surface is always visible. It is not a popup date field or a time dropdown. This schematic describes hierarchy, not finished visual styling:

```text
Reserve with [professional name]
[service name] · [duration]                Change service

              Choose a day and time
┌─────────────────────────┬────────────────────────────┐
│ ‹  October 2026  ›      │ Thursday, October 8        │
│ Mon Tue Wed Thu Fri ... │ [09:00] [09:30] [10:00]    │
│       inline month      │ [14:00] [14:30]            │
│ available days enabled │ Time zone: Bogotá          │
└─────────────────────────┴────────────────────────────┘
[professional] · [service] · [selected day/time]
                                        Continue →
```

On mobile, the calendar comes first and time buttons immediately follow it. Avoid nested cards, horizontal page scrolling, excessive header height, and a fixed footer covering the slots. Use Savia's existing theme tokens, typography, components, and light/dark modes. Date targets may use compact calendar cells with generous hit areas; primary actions and slot buttons have at least 44px hit areas. At 360px, all seven weekday columns fit.

## Availability behavior

- Show only actual selectable days; distinguish loading, available, unavailable, and selected states through text/semantics as well as color. Past days and days beyond the configured horizon are disabled.
- Initially focus the first available day in the returned range. Selecting a time is explicit; never silently choose the first time. Continue remains disabled until a valid time is selected.
- A selected day shows a grid of time buttons. If availability disappears, explain it and offer the next available day or a refresh. For an empty month, offer navigation to the next month within the horizon. Stop at the horizon and show a useful no-availability state.
- Display the booking time zone prominently, using a human-readable location and IANA value when necessary. Default to the tenant's time zone, not a silent browser-zone conversion. A customer can change the display zone; date grouping, hours, and review must change together while submitted timestamps remain UTC. Include an offset/disambiguation for repeated local hours during a DST transition.
- Keep service, contact data, and navigation state when going back. Changing service, professional, month, or display zone invalidates incompatible selections. Abort or disregard old requests so a late response cannot replace newer availability.
- On a slot conflict, preserve customer details, return to availability with a clear explanation, and refresh choices. On network/CAPTCHA errors, keep the draft and offer the correct retry. Reuse the idempotency key for identical submission retries.
- Confirmation includes professional, service, duration, day, time, time zone, and the existing private management link. Existing cancellation and rescheduling policies remain authoritative.

## Public link scope and lifecycle

Create booking-specific public link records with tenant, creator, scope (`professional` or `team`), optional service, 32 random bytes of token entropy, expiry, revocation timestamp, daily budget, and version. Professional-scoped links bind a configured professional belonging to the active tenant. A service scope must be enabled and assigned to that professional. Public responses contain only the scoped, currently eligible catalog.

Resolve scope on every catalog, challenge, availability, and reservation request. Do not trust URL query parameters or caller-submitted professional/service identifiers to widen it. Disabled professionals/services, removed tenant membership, expiry, revocation, and unpublishing stop new bookings. Return a neutral unavailable page without exposing private configuration.

Keep legacy tenant URLs compatible as team links; never reinterpret them as personal links. Give them independent lifecycle controls during migration. The default sharing action becomes **My booking link**, bound to the current eligible professional. Owners/admins can create authorized team links or links for another eligible professional. An unconfigured user gets an actionable setup message instead of a misleading personal link.

The sharing panel follows Savia's existing public-link patterns: scope preview, expiry presets (24 hours, 7 days, 30 days, or none), copy, mobile share, QR, and revoke. New links default to 30 days and a daily budget of 25 submissions. Choosing no expiry is explicit. Short-link redirects, if configured, must still resolve through the same booking policy. Do not make shortening a prerequisite for sharing.

Revoking or expiring a sharing link does not delete bookings or invalidate the distinct private links that manage existing reservations. Keep reservation history and current cancellation rules.

## Protection and server contract

- Preserve shared Turnstile/ALTCHA validation, production fail-closed behavior, origin/action/link binding, CAPTCHA proof replay prevention, persistent minute limits, and trusted client-IP handling. Challenge verification is required on submission, not on every calendar click.
- Match public-form daily submission budgets: default 25 per link, 20 per hashed IP, and 1,000 per tenant per UTC day. These are booking submission budgets, not calendar-click counters. Reserve them atomically using a durable request receipt before external availability calls or reservation side effects. Failed admitted attempts consume their admission budget; identical retries reuse admission and do not consume it twice. Different data with the same request key conflicts. Concurrent requests cannot exceed budgets.
- Keep public request bodies capped at 32 KiB; keep authenticated configuration limits separate. Do not persist raw IP addresses, CAPTCHA proofs, or tokens in logs. Retain receipt cleanup and current no-store, noindex, and no-referrer behavior.
- Add one bounded availability endpoint: up to 31 display-zone dates per request. Fetch native busy intervals and external calendar busy intervals once for the professional and encompassing UTC window, then reuse the existing domain rules to generate each day's slots. Do not implement a month by issuing 31 calendar-provider requests. Preserve existing per-minute read limiting. A calendar-provider outage is a retryable unavailable state, never an all-free calendar.
- Public availability returns date buckets and UTC slot intervals only; it reveals no busy-event titles, customer details, internal principal identifiers, or calendar credentials. Booking submission revalidates the selected slot and uses existing atomic occupancy, outbox, and idempotency mechanisms.
- Anonymous booking remains usable without login, private application bootstrap, offline synchronization, or IndexedDB prerequisites.

## Appointment email

When the tenant has configured outbound email, or global SMTP/transactional mail is enabled, send the customer an appointment confirmation. Reuse the current tenant email service and its sender precedence: tenant configuration first, otherwise the configured global transport. A contact email address alone is not an outbound transport; do not invent credentials or impersonate it.

The existing booking outbox already sends confirmation, change, cancellation, and reminder messages through the auth email bridge. Extend and verify that path rather than introducing a second sender. Include customer name, service, professional, date, start/end time, duration, time zone, and the private reservation-management link. Store the customer's supported locale (`en`, `es`, or `pt`) with the booking for consistent notifications; existing bookings default to English.

Without an available configured transport, the reservation remains confirmed and the UI offers its details/management link without claiming an email was sent. A configuration-read error or SMTP outage is different from intentionally unconfigured mail: retry delivery through the existing outbox and show safe status to authorized staff. Reservation retries must not create duplicate confirmation jobs. Preserve the documented at-least-once SMTP crash-recovery limitation.

Verify tenant-specific sending and the global fallback, recipient isolation, full message contents, actual captured SMTP delivery, and the no-transport path. Do not send customer bearer management links to unrelated tenant contacts.

## Acceptance and delivery

Deliver the scoped links/security/sharing and availability/email increments in one coordinated PR so the new API/UI contract rolls out together. Both increments have focused tests and behavior-guide updates. Preserve the existing tenant-owned scheduling model and optional calendar integration; do not replace the scheduling engine or redesign the entire admin wizard.

Before implementation, create a representative public-page prototype using illustrative data and review it with Impeccable's UX guidance. Before merging the interface, exercise the actual React page on mobile and desktop, in both themes, with keyboard navigation and Spanish/English/Portuguese copy. Save screenshots and record task outcomes, not only a visual verdict.

The release is acceptable when a customer following a personal link can choose a visible available day and click a visible time without selecting a professional, opening a date popup, or using a time select. With one service, availability is the first meaningful screen. Also verify an unavailable month, a stale slot, a revoked link, a slow response, and a long service/professional name.

In preview, test a real configured tenant's personal link anonymously and create one authorized test reservation, including CAPTCHA, the private management link, and receipt of the appointment email when mail is configured. Verify expiry/revocation on disposable links and document evidence. Deployment health and fixture screenshots alone do not prove that customer journey.

## Implementation evidence (2026-10-03)

- Scoped resolver and admission regression tests cover lifecycle, authorization, tampering, CAPTCHA replay, quotas and exact retries. SQLite/D1 admission writes and PostgreSQL serializable admission writes preserve concurrent limits.
- PostgreSQL booking/migration lane passed 17 tests after integrating current main and renumbering the forward migration to `0026_booking_public_links.sql`. It includes concurrent admission and bounded seven-day receipt cleanup parity.
- Focused API booking suites passed 60 tests before the cleanup regression; the cleanup job suite then passed all eight tests. The full API suite passed 1,207 tests before the final review fixes.
- Admin booking suites passed 31 tests. Actual React browser tasks passed for the personal one-service journey, explicit time selection, Spanish submission, multi-service/empty-month/long-name states, 360px/390px/1440px layouts and both themes without horizontal overflow. English and Portuguese keyboard selection, step-heading focus and localized details also passed. Screens used clearly illustrative fixture data.
- Actual local PostgreSQL and SMTP capture passed reservation, identical replay without a duplicate reservation, Spanish full-summary delivery and normal cancellation. Auth mail tests passed 10 tests. This is local end-to-end evidence, separate from mocked transport tests.
- Fresh-context final review found no remaining Critical/Important blockers after adding bounded indexed receipt cleanup and accurate stale-slot guidance.
- This managed environment denies direct preview access and has no authenticated tenant credentials or bound sending identity. A real preview tenant reservation/CAPTCHA/customer inbox check remains unperformed; deployment health alone will not be presented as that customer task.
