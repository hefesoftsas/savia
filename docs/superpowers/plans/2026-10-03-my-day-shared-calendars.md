# My Day Shared Calendars Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for integration and superpowers:test-driven-development for implementation. Steps use checkboxes for tracking.

**Goal:** Read shared iCalendar subscriptions/imports in My Day and provide usable day, week and month views.

**Architecture:** Shared Zod contracts define source metadata and occurrences. A private D1-backed source service fetches and expands feeds independently of Nango. The admin uses range-aware reads and preserves today's quick-task behavior; existing OAuth adapters gain complete bounded pagination.

**Tech Stack:** TypeScript, React, shadcn, Hono/OpenAPI, D1, Web Crypto, ical.js, Vitest/Workers.

**Spec:** `docs/superpowers/specs/2026-10-03-my-day-shared-calendars-design.md`

## Global Constraints

- Code/tests/docs in English; visible My Day UI in its current Spanish language.
- HTTPS/WebCal subscriptions and UTF-8 `.ics` copies; no CalDAV or upstream writes to feeds.
- Sources private per principal; AES-GCM using calendar-specific context from `SAVIA_MCP_SHARED_SECRET`.
- Bounds half-open, queries at most 62 days; sources at most 20; feeds at most 1 MiB.
- At most 2,000 occurrences/source/range, 100,000 recurrence steps, 20 provider pages, three redirects, ten seconds fetch deadline.
- Automatic refresh while visible/online every five minutes; no background scheduler or browser storage.
- Work in the existing task checkout on `work`; user explicitly authorized continued execution without confirmations.
- Independent workers own disjoint files; coordinator owns shared contracts, frontend, docs and generated types. No worker commits or additional agents.

## Review Focus

- Moved recurring exceptions retain original instance identity and appear even when the original date lies outside the requested range.
- All-day events preserve date boundaries across DST and negative UTC offsets.
- Changing ranges cannot display a previous range or another principal's cached events.
- Deleting a source during refresh cannot recreate its persisted or displayed events.
- A busy provider calendar either loads complete bounded results or explicitly reports a limit; unsafe continuation URLs never execute.

## Task 1: Shared contracts and date boundaries

**Files:** Create `packages/studio-shared/src/calendar-contracts.ts`, `packages/studio-shared/test/calendar-contracts.test.ts`, `apps/admin/src/features/my-day-widgets/calendar-dates.ts`, `apps/admin/src/features/my-day-widgets/calendar-dates.test.ts`.

**Interfaces:** `CalendarSource` contains `id`, `kind: "subscription" | "import"`, `name`, `color`, `visible`, `timeZone`, nullable `hostname`/`lastSyncedAt`, `createdAt`, `updatedAt`. `CalendarOccurrence` contains `id`, `sourceId`, nullable `title`, `startsAt`, `endsAt`, `allDay`, nullable `webLink`, `timeZone`. `CalendarSourceEvents` contains `data: CalendarOccurrence[]`, `stale: boolean`, `error: string | null`, `lastSyncedAt: string | null`. `CalendarPreferences = { google_calendar: boolean; outlook: boolean }`. Colors: blue, emerald, violet, amber, rose, slate. `CreateCalendarSourceInput` is a discriminated subscription/import union with name/color/timeZone and url/content. `UpdateCalendarSourceInput` permits name/color/visible/timeZone. Export matching schemas, constants and limits.

- [x] Write tests rejecting invalid zones, source input and ranges; assert default provider visibility and exact limits.
- [x] Run shared Vitest and observe missing-contract failure; implement schemas; rerun green.
- [x] Write date tests for Monday start, year/month boundaries, Jan 31 clamping, exclusive all-day ends and overlapping timed events. Observe failure, implement `calendarRange(date, view)`, `moveCalendarDate(date, view, direction)`, `calendarDays(from,to)` and `eventsForDay(events, day)`; rerun green.

## Task 2: Private feed sources, parsing and authenticated routes

**Files:** Create focused `apps/api/src/personal-calendars/{cipher,repository,ical,transport,service,routes}.ts` and API tests. Modify `apps/api/src/app.ts`, `apps/api/src/runtime.ts`, `packages/db/src/core-schema.ts`, add next available D1 migration, `apps/api/package.json`, `pnpm-lock.yaml`, realtime mutation hints if needed.

**Interfaces:** Consume Task 1 schemas. Register `registerPersonalCalendarRoutes(app, database, { secret?, fetcher? })` from app using optional `calendarSecret` on personal integration dependencies. API paths: `GET/POST /v1/personal-integrations/calendars`, `PATCH/DELETE /v1/personal-integrations/calendars/{id}`, `GET /v1/personal-integrations/calendars/{id}/events?from&to&timeZone`, `POST /v1/personal-integrations/calendars/{id}/refresh`, `GET/PUT /v1/user-preferences/calendar`. List/create/update/refresh return `{data: CalendarSource...}`; events return `CalendarSourceEvents` directly; preferences return `{data: CalendarPreferences}`. Event reads refresh stale feeds; refresh always bypasses freshness. Mutations preserve revision checks and owner scoping. Source events can additionally accept `refresh=true` for manual synchronization.

- [x] Test ICS recurrence/exceptions/folding, UTC/floating/TZID/all-day, range overlaps and exact limits; run red before parser implementation.
- [x] Add ical.js and implement bounded expansion using the shared occurrence model; run Workers tests green.
- [x] Test encrypted ownership, CRUD/source caps, refresh race/deletion, 304/stale fallback, URL/DNS/redirect/body limits; run red before implementation.
- [x] Implement repository/cipher/fetch/service and migration with bounded schemas; run tests green.
- [x] Test authenticated routes, foreign-source denial, key unavailable, operation without Nango and visibility preferences; implement wiring and verify migrations/API tests/typecheck.

## Task 3: Complete OAuth calendar range reads

**Files:** Modify `apps/api/src/personal-integrations/operations.ts`, `apps/api/src/routes/personal-integrations.ts`, and `apps/api/test/personal-integrations.test.ts`; add focused provider pagination tests if helpful.

**Interfaces:** Retain existing `listEvents` input and `{data: events}` route envelope. Add optional `allDay` and `timeZone` fields to `PersonalEvent` and OpenAPI read schema; event writes stay backward compatible. Dependency type may gain `calendarSecret` for Task 2 runtime wiring; serialize that small addition with coordinator.

- [x] Add red tests exceeding 25 Google/50 Outlook events, unsafe/repeated continuations, page/event limits, all-day values and cancellations.
- [x] Implement fixed Google paths and validated Outlook calendarView continuations, at most 20 pages/2,000 rows; throw explicit errors if results remain.
- [x] Run existing personal integrations tests and focused pagination tests; verify preserved write/action contracts and typecheck.

## Task 4: Admin API and range-aware calendar lifecycle

**Files:** Modify `apps/admin/src/api/personal-integrations-client.ts`, add source client tests, create `apps/admin/src/features/my-day-widgets/use-calendar-sources.ts` and lifecycle tests; modify `agenda-widget.tsx` and agenda tests.

**Interfaces:** Client methods `listCalendarSources(): Promise<CalendarSource[]>`, `createCalendarSource(input): Promise<CalendarSource>`, `updateCalendarSource(id,input): Promise<CalendarSource>`, `deleteCalendarSource(id): Promise<void>`, `listCalendarSourceEvents(id,{from,to,timeZone,refresh?}): Promise<CalendarSourceEvents>`, `refreshCalendarSource(id): Promise<CalendarSource>`, `getCalendarPreferences(): Promise<CalendarPreferences>`, `saveCalendarPreferences(input): Promise<CalendarPreferences>`. `useMyDayAgenda(client?, options?: {from:string;to:string})` preserves today's default and range-keys caches. Feed lifecycle takes an optional capable client and range, returns sources/occurrences/errors/loading, refresh and CRUD actions. Missing source capabilities preserve old fixtures/consumers; production client implements them.

- [x] Write red client path/payload tests, implement methods, run green.
- [x] Write red range/session/partial-failure/deletion-race lifecycle tests; implement independent reads, stale snapshots, five-minute polling and session cleanup; run green.
- [x] Write red agenda range-switch tests, implement range cache keys and preserve default today's tasks, run existing agenda/MyDay tests.

## Task 5: Calendar controls, views and source management

**Files:** Create `calendar-view.tsx`, `calendar-source-manager.tsx` and corresponding tests in `apps/admin/src/features/my-day-widgets/`. Modify `agenda-widget.tsx`, `section.tsx`, `personal-integrations/my-day-page.tsx` only as needed for integration.

**Interfaces:** Calendar view gets the existing agenda/provider client and coordinates selected day/view with feed lifecycle. Calendar state is owned with the page agenda to avoid duplicate provider reads; standalone section receives the same defaults. Quick-task date remains today. Week/month span all dashboard columns; month overflow opens Day with the selected date.

- [x] Test Day/Week/Month navigation, Monday headers, three-row overflow, details, labels/source visibility and narrow-screen structure; observe red then implement existing UI primitives and theme tokens.
- [x] Test adding URL/file sources, editing labels/colors, visibility, refresh and deletion, failure preservation and explicit copy status; observe red then implement manager.
- [x] Run MyDay/widget regression tests. Generate OpenAPI admin types after API routes are integrated; run admin/API/shared/db type checks.

## Task 6: Integration verification, documentation and review

**Files:** Update `docs/my-day-widgets.md`, `docs/guides/my-day-performance.md`, spec/plan completion status; generated `apps/admin/src/api/generated/openapi.ts`.

- [x] Verify parser and route/provider suites in Workers; verify admin calendar/inbox/widget suites and shared contracts, migration checks, type checks and changed-file formatting.
- [x] Build the admin; inspect desktop/mobile calendar behavior with controlled demonstration data if browser tooling is available. Record unavailable live connectivity separately.
- [x] Review combined changes against spec and five Review Focus conditions; resolve material findings, document configuration and behavior, commit verified changes without deployment or upstream calendar writes.

## Completion Evidence

- Full API Workers suite: 125 files, 1,039 tests passed.
- Admin My Day, widgets and calendar client suites: 20 files, 136 tests passed, including the final session-isolation and forced-refresh regressions.
- Shared calendar/widget contracts: 12 tests passed. Migration/baseline scripts: nine checks passed.
- API, admin, shared and database TypeScript checks passed. Production admin build passed.
- Chromium checked desktop week/month, mobile month, dark theme, source manager and real file upload with controlled calendar data. No page errors or horizontal overflow; month overflow opens the full day. Live provider/feed connectivity was not exercised.
- Independent review found two navigation/optimistic-update races; both were reproduced, fixed and reviewed again. A late task callback after identity clearing was also reproduced and guarded.
- Dependencies missing from the initial local install were restored using the existing frozen lockfile; the only new dependency is `ical.js`.
- Changes remain on the local task branch; no deployment or external calendar publication.

## PR Integration Verification

- Rebased the feature onto the current main branch while preserving Office and Companion changes. Renumbered calendar migrations to `0023` after integrating the Office, Companion and appointment-booking additions on main.
- Updated source routes and My Day checks pass against that base: 1,111 API tests, 143 Admin widget/client tests, and nine SQLite baseline/migration checks. API, Admin and database type checks and the production Admin build pass.
- GitHub CI exposed the missing PostgreSQL source-manifest entry. Added the matching native PostgreSQL migration, source checksum and table/index inventories; the previously failing checksum test passes. Live PostgreSQL checks require a configured test database and were not run locally.
