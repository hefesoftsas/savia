# Public Booking UX and Scoped Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let customers book from a person's Savia link through a visible availability calendar and time buttons, with the same lifecycle and abuse protections as existing public links.

**Architecture:** Resolve a server-owned booking link context before every public operation. Keep scheduling, CAPTCHA, occupancy, and calendar integration in the existing booking domain; add bounded month availability and a focused React availability surface. Keep legacy tenant URLs compatible and private reservation-management links independent.

**Tech Stack:** TypeScript, Hono/OpenAPI, D1/SQLite and PostgreSQL, React 19, Savia UI/theme tokens, Vitest, existing CAPTCHA and Nango adapters. Use React DayPicker 9 as the keyboard-accessible inline calendar primitive, styled within Savia; it must not introduce a popup/date-input interaction.

**Spec:** `docs/superpowers/specs/2026-10-03-booking-public-ux-and-links-design.md` (proposed design; implementation has not started).

## Global Constraints

- Code, tests, and docs in English; customer copy localized in Spanish, English, and Portuguese.
- Personal links never ask customers to select a professional. A single eligible service skips service selection.
- Availability is an inline calendar with time buttons, not a native date input or hour select.
- Existing tenant-owned scheduling, reservation history, private management links, CAPTCHA, atomic occupancy, outbox, and idempotent retries remain authoritative.
- New links: 32 random bytes of token entropy, default expiry 30 days, default daily budget 25; daily hashed-IP budget 20 and tenant budget 1,000, resetting in UTC.
- Public body cap 32 KiB. Availability range at most 31 display-zone dates. Default display zone is the tenant's IANA zone.
- Shared public-link policy applies on catalog, challenge, availability, and reservation routes. Anonymous responses remain no-store/noindex/no-referrer and requests omit credentials.
- Begin execution from current `origin/main` in an isolated worktree; do not build on the already merged wizard branch. Recheck migration numbering: `0024` is now used on main, so `0025` is proposed here.
- Deliver scoped links/security/sharing first; deliver bounded availability, public UI, and email verification second. Each increment updates `docs/guides/tenant-booking.md` and is independently reviewable.

## Review Focus

1. A forwarded personal link with tampered query/body IDs must never reach another professional or tenant (Task 1).
2. Midnight and repeated DST hours must show the same date/time in availability and confirmation, with unambiguous UTC submission (Tasks 3–4).
3. Slow or reordered responses must not restore an obsolete month/service/time selection (Task 4).
4. Simultaneous submissions and lost-response retries must neither exceed quotas nor duplicate reservations (Task 1).
5. Empty calendars, long labels, and expired links must remain understandable on a 360px phone and with keyboard navigation (Tasks 2, 4, 6).

---

## Shared interfaces and file boundaries

Add optional `customerLocale: "en" | "es" | "pt"` to public submission and persist it as `customer_locale` (default `en` for existing rows) in Task 1's forward migration, for Task 5 email rendering.

Add public contracts in `apps/api/src/bookings/contracts.ts` and matching UI shapes in `apps/admin/src/features/bookings/booking-types.ts`; regenerate OpenAPI types rather than hand-editing generated files.

- `BookingLinkScope = { kind: "team" } | { kind: "professional"; professionalId: string }`.
- `BookingPublicLink`: `id`, `tenantId`, `createdBy`, `scope`, `serviceId: string | null`, `expiresAt: string | null`, `revokedAt: string | null`, `dailyLimit`, `version`. Authenticated creation/list views additionally contain `publicUrl`; anonymous views never expose creator/tenant internals.
- `ResolvedBookingLink`: `id`, `tenantId`, `scope`, `serviceId`, `dailyLimit`, `settings`, `legacy: boolean`. This is an internal type, not a public payload.
- `PublicBookingCatalog`: existing safe catalog plus `linkScope`, `fixedProfessionalId: string | null`, `fixedServiceId: string | null`, `horizonDays`, and `leadMinutes`; project only eligible scoped services/professionals.
- `PublicBookingSlot = { startsAt: string; endsAt: string }` (UTC ISO timestamps).
- `AvailabilityRangeQuery = { serviceId: string; professionalId?: string; from: string; to: string; displayTimeZone?: string }`; dates are inclusive `YYYY-MM-DD` in the display zone.
- `AvailabilityRange = { displayTimeZone: string; businessTimeZone: string; days: Array<{ date: string; slots: PublicBookingSlot[] }> }`.
- `BookingSelection = { professionalId: string; serviceId: string; slot: PublicBookingSlot; displayTimeZone: string }`.

### Task 0: Pin the customer interaction before implementation

**Files:** Read `apps/admin/PRODUCT.md`, the spec, existing booking page/messages, and Impeccable guidance. Create prototype artifacts under `/tmp/tenant-booking-work/public-availability/`; do not ship a disconnected mock as the product.

**Deliverable:** A prototype showing a one-service personal link, a multi-service personal link, and an empty month, at 360px and 1440px in both themes.

- [ ] Sketch the inline calendar/time-button layout and actual two/three-step progress, keeping the professional name visible.
- [ ] Render representative React screens with explicitly illustrative data; inspect hierarchy, seven-column fit, readable slot labels, keyboard focus, and long translated labels.
- [ ] Record the changes needed to pass the spec's personal-link booking task. Carry those decisions into Task 4 without adding decorative global redesigns.

### Task 1: Resolve scoped links and enforce lifecycle/admission

**Files:** Create `apps/api/src/bookings/public-links.ts`, `apps/api/src/bookings/public-policy.ts`, and `0026_booking_public_links.sql` in both `packages/db/migrations/` and `packages/db/postgres/`; modify `packages/db/postgres/manifest.json`, `apps/api/src/bookings/{contracts,repository,routes}.ts`. Test `apps/api/test/bookings.test.ts`, `apps/self-hosted/test/booking-postgres.test.ts`, and `apps/self-hosted/test/postgres-migrations.test.ts`.

**Interfaces:** Produce `resolveBookingLink(db, token, now): Promise<ResolvedBookingLink>`; `assertBookingLinkSelection(link, serviceId, professionalId?): { serviceId: string; professionalId: string }`; `admitBookingRequest(db, { link, requestKey, requestHash, ipHash, captchaIdentityHash, now }): Promise<{ receiptId: string; replay: boolean }>`. Use existing DB adapter/types and injected clock. Produce authenticated `GET/POST /v1/tenants/{tenantId}/booking/public-links` and version-checked revocation at `POST .../public-links/{linkId}/revoke`.

- [ ] Add failing `personal_link_rejects_other_professionals`, `link_scope_is_checked_on_every_public_route`, `revocation_preserves_existing_management_link`, and `legacy_link_remains_team_scoped` tests. Assert neutral unavailable responses for expiry/revocation, active membership checks, authorized tenant ownership, and no leaked internal IDs.
- [ ] Run `pnpm --filter @savia/api test test/bookings.test.ts`; confirm the new assertions fail for current tenant-wide behavior.
- [ ] Implement persisted links, secure token creation, scoped catalog projection, authenticated lifecycle endpoints, and legacy-token migration. Reject disabled/unassigned service and professional scopes server-side. Require fixed scope even when IDs are omitted or maliciously supplied.
- [ ] Add failing `daily_booking_admission_is_atomic`, `identical_retry_reuses_admission`, `changed_payload_reuses_key_conflicts`, and `captcha_receipt_cannot_be_replayed` tests. Assert exactly 25 link, 20 hashed-IP, and 1,000 tenant daily admissions; UTC rollover; concurrent final-budget attempts; production CAPTCHA enforcement; and 32 KiB body rejection.
- [ ] Run the booking tests to confirm those new protection assertions fail before implementing admission.
- [ ] Implement durable atomic receipts and quota checks using the public-form policy pattern, with SQLite/PostgreSQL parity. Bind CAPTCHA consumption to admission, reuse valid receipts on identical retries, and keep unique occupancy/booking request constraints authoritative. Recheck link validity before new reservation creation. Preserve cancellation history and management tokens.
- [ ] Run the API booking tests plus `pnpm --filter @savia/self-hosted test:postgres test/booking-postgres.test.ts test/postgres-migrations.test.ts` against configured PostgreSQL. Expected: PASS, no skipped required database lane. Update booking documentation with link scope, lifecycle, budgets, and legacy behavior.
- [ ] Commit: `feat: add scoped public booking links and admission limits`.

### Task 2: Make personal sharing the default, with explicit team sharing

**Files:** Create `apps/admin/src/features/bookings/booking-public-links-panel.tsx` and its `.test.tsx`; modify `booking-page.tsx`, `booking-types.ts`, and `booking-messages.ts` in that directory. Refer to existing public-form link manager/page share panel for reusable copy/share/QR patterns.

**Interfaces:** Consume Task 1's authenticated endpoints and `BookingPublicLink`. Produce `BookingPublicLinksPanel({ tenantId, currentProfessionalId, canManageTeamLinks }: { tenantId: string; currentProfessionalId: string | null; canManageTeamLinks: boolean })`.

- [ ] Add failing `personal_sharing_uses_current_professional`, `team_sharing_is_explicit`, `unconfigured_user_gets_setup_guidance`, and `revoke_only_affects_selected_link` tests. Assert scope preview, 30-day/25 defaults, explicit no-expiry option, and authorization-aware team controls.
- [ ] Run `pnpm --filter @savia/admin test src/features/bookings/booking-public-links-panel.test.tsx`; expect failures before implementation.
- [ ] Implement My booking link and Team agenda actions, expiry/budget controls, canonical copy, mobile share, QR, and revocation states. Reuse established short-link behavior only where configured; copying remains available when shortening fails. Do not silently present the existing tenant-wide link as personal.
- [ ] Run panel and `booking-page.test.tsx` tests; inspect mobile expiry/revoke interactions, long names, expired labels, and translated messages. Update the guide with where to find each sharing option.
- [ ] Commit: `feat: add personal booking link sharing controls`.

### Task 3: Return actual availability for a bounded calendar range

**Files:** Create `apps/api/src/bookings/public-availability.ts` and `apps/api/test/booking-public-availability.test.ts`; modify `apps/api/src/bookings/{contracts,routes,repository}.ts`. Consume existing `domain.ts` slot generation and `calendar.ts` busy adapter without replacing them.

**Interfaces:** Consume Task 1's link resolver and scope assertion. Produce `getPublicAvailability(link: ResolvedBookingLink, query: AvailabilityRangeQuery, dependencies): Promise<AvailabilityRange>` and `GET /api/public/bookings/{token}/availability`. Define typed dependencies for the existing DB, calendar adapter, and clock when implementing; do not add a second provider integration.

- [ ] Add failing `range_returns_only_bookable_days`, `range_is_bounded_to_31_dates`, `external_busy_is_fetched_once`, `display_zone_groups_cross_midnight_slots`, `repeated_dst_hours_keep_distinct_utc_slots`, and `provider_outage_never_returns_free_slots` tests. Include lead time, horizon, buffers, weekly hours, exceptions, and occupied times.
- [ ] Run `pnpm --filter @savia/api test test/booking-public-availability.test.ts`; expect FAIL before the endpoint exists.
- [ ] Implement range validation and IANA display-zone validation. Build the UTC window with zone-aware day boundaries and duration/buffer padding, fetch busy intervals once, generate business-zone candidate dates, and regroup UTC slots into requested display-zone dates. Return bounded date buckets, including empty days; preserve read limits and safe error projection.
- [ ] Run range tests and existing `bookings.test.ts`, `booking-domain.test.ts`, and `booking-calendar.test.ts`. Assert calendar adapter call counts and unchanged reservation-time revalidation.
- [ ] Regenerate OpenAPI types using `pnpm --filter @savia/admin generate:api`; document availability behavior in the booking guide.
- [ ] Commit: `feat: expose bounded public booking availability`.

### Task 4: Build the inline availability journey

**Files:** Create `apps/admin/src/features/bookings/public-booking-availability.tsx`, `public-booking-summary.tsx`, and `public-booking-availability.test.tsx`; modify `public-booking-page.tsx`, its `.test.tsx`, `public-booking-wizard-messages.ts`, and `booking-types.ts`. Add the calendar dependency in `apps/admin/package.json` and `pnpm-lock.yaml`.

**Interfaces:** Consume `PublicBookingCatalog`, `AvailabilityRange`, and `BookingSelection`. Produce `PublicBookingAvailability({ token, catalog, serviceId, professionalId, displayTimeZone, onTimeZoneChange, value, onChange })` with typed props and `PublicBookingSummary({ catalog, selection })`. The page owns step/draft/submission state; the availability component owns visible range, loading, and range requests.

- [ ] Add failing `personal_link_skips_professional_choice`, `single_service_starts_at_availability`, `days_and_time_buttons_are_visible_together`, and `only_explicit_slot_choice_enables_continue` tests. Assert absence of public native date inputs/hour selects and correct two/three-step labels.
- [ ] Run `pnpm --filter @savia/admin test src/features/bookings/public-booking-page.test.tsx src/features/bookings/public-booking-availability.test.tsx`; confirm the new journey assertions fail.
- [ ] Implement the inline calendar from Task 0 with accessible keyboard movement, disabled days, explicit slot buttons, human-readable zone control, duration, clear summary, and localized messages. Keep team-only professional choice conditional. Match inherited themes and existing UI primitives.
- [ ] Add failing `old_range_response_cannot_replace_new_selection`, `zone_change_preserves_utc_identity_and_relabels_date`, `empty_month_offers_next_month`, `horizon_stops_navigation`, and `slot_conflict_preserves_contact_details` tests. Include disambiguated repeated DST hours and date crossing between business/display zones.
- [ ] Run those focused tests and verify their failures before implementing request cancellation, zone changes, selection invalidation, empty/error recovery, and conflict handling.
- [ ] Implement those recovery paths; preserve draft/back behavior and exact-retry idempotency. Present final confirmation with the same professional, service, date/time/zone, and existing private management URL.
- [ ] Run all public booking/admin booking tests; run `pnpm --filter @savia/admin typecheck` and `pnpm --filter @savia/admin build:assets`. Update the guide with the new public steps and time-zone behavior.
- [ ] Commit: `feat: replace public booking selectors with visible availability`.

### Task 5: Verify conditional email delivery and complete appointment messages

**Files:** Create `apps/api/src/bookings/email.ts` and `apps/api/test/booking-email.test.ts`; modify `apps/api/src/bookings/jobs.ts`, `apps/api/src/runtime.ts`, `apps/api/test/booking-jobs.test.ts`, `apps/auth/src/account-email.ts`, and `apps/auth/test/account-email.test.ts`. Modify the public booking page/messages to submit `customerLocale` and accurately describe queued mail. Update `docs/guides/tenant-booking.md` and `docs/guides/account-email.md`.

**Interfaces:** Consume Task 1's persisted `customer_locale` and existing `BookingJobsOptions.sendMail`. Add `BookingJobsOptions.mailAvailability?: (tenantId: number) => Promise<boolean>` for distinguishing unconfigured mail from delivery failures. Produce `formatBookingEmail({ booking, kind, timeZone, managementUrl }): { subject: string; text: string }`, using the booking's locale and only supported locales. Add bridge-key protected `GET /_internal/tenant-email/{tenantId}/availability` returning `{ available: boolean }`, backed by existing `accountEmailAvailable`; expose no SMTP credentials or settings publicly.

- [ ] Add failing `confirmation_uses_tenant_sender`, `global_smtp_is_used_without_tenant_settings`, `unconfigured_email_does_not_fail_reservation`, and `mail_availability_requires_internal_bridge` tests. Reuse current `sendAccountEmail` precedence; a broken configured tenant sender must not silently switch identities to global SMTP.
- [ ] Run `pnpm --filter @savia/auth test test/account-email.test.ts` and `pnpm --filter @savia/api test test/booking-jobs.test.ts`; confirm the new availability/no-transport assertions fail.
- [ ] Wire the existing booking mail bridge to configuration readiness. If no transport is configured, skip email delivery with an explicit safe reason; keep the reservation confirmed. Treat bridge errors and transient SMTP failures as retryable failures, not proof that mail is unconfigured. Keep tenant settings and global SMTP selection in the existing auth mail service.
- [ ] Add failing `appointment_email_contains_full_summary`, `email_uses_saved_customer_locale`, and `identical_submission_does_not_enqueue_duplicate_confirmation` tests. Assert customer name, professional, service, start/end, duration, time zone, and private management link; cover confirmation/change/cancellation/reminder kinds and concurrent schedulers.
- [ ] Run the new email/job tests and confirm those content assertions fail before changing the formatter.
- [ ] Implement localized plain-text templates and stored-locale selection. Send confirmation to the booking customer through the existing outbox. Update the public confirmation copy to distinguish booked, queued, and unavailable email; never claim that SMTP delivery already happened during reservation creation. Preserve bounded retries, stale-revision suppression, and deduplication of booking/job creation. Document that SMTP crash recovery remains at least once; do not promise exactly-once delivery.
- [ ] Run the auth mail, API booking/job/email, and PostgreSQL booking tests. Capture an authorized booking message with local Mailpit, then verify preview email using configured tenant mail or approved test SMTP. Check sender, recipient, appointment details, and management URL; keep this evidence separate from mock delivery tests.
- [ ] Commit: `feat: complete booking emails using configured tenant transport`.

### Task 6: Verify customer tasks and deliver to preview

**Files:** Update `docs/guides/tenant-booking.md` and `docs/superpowers/specs/2026-10-03-booking-public-ux-and-links-design.md` with actual acceptance evidence. Add regression assertions to `apps/admin/src/edge-gateway.test.ts` only if new forwarding behavior requires them. Store screenshots/test-reservation identifiers in the established review artifacts, avoiding bearer tokens and customer information in logs/PR text.

**Interfaces:** Exercise Tasks 1–5 through actual public URLs and authorized tenant settings. Preserve the repository's existing PR/preview workflow.

- [ ] Inspect actual React screens at 360px, 390px, and 1440px, light/dark, with long labels and Spanish/English/Portuguese copy. Check keyboard-only selection, focus after step changes, loading announcements, touch areas, and horizontal overflow.
- [ ] Complete personal one-service and multi-service tasks; verify no provider choice, no date popup, and no hour dropdown. Exercise empty month, stale slot, slow/reordered responses, expired/revoked link, and CAPTCHA/network retry. Record observed behavior and fix failures in their owning task.
- [ ] Run focused API/admin suites, required PostgreSQL parity, changed-file Prettier checks, type checks, and the admin production build. Confirm anonymous HTML/API headers, gateway routing, safe catalog projection, and trusted-IP quota behavior; report unperformed checks explicitly.
- [ ] Create reviewable PRs for the two delivery increments. Descriptions identify customer behavior, security scope, compatibility, validation, and material limitations. Merge only after required checks and code review pass.
- [ ] Confirm preview deploys the merged commit. Using a real configured tenant and an authorized test customer, anonymously follow a newly created personal link, complete CAPTCHA, book an available slot, and open its private management link, and verify the appointment email arrives when tenant/global mail is configured. Verify disposable-link revocation/expiry and clean up the authorized test booking through normal cancellation.
- [ ] Record the preview evidence, remove illustrative-data ambiguity, and report the concrete sharing location and working test path to the user. Do not substitute a health check for the public booking journey.

## Self-review

The five review conditions map to explicit tests and customer tasks. Scoped-link types are shared consistently; availability dates are in the declared display zone and slot identities stay UTC. New public policy supplements existing booking protections rather than replacing CAPTCHA or scheduling. The older wizard design's always-required professional and native date/hour controls are superseded for the public flow only. Execution requires current-main migration numbering and a real preview tenant; neither source research nor this plan claims those runtime checks have already passed.
