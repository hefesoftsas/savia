# Tenant Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver goal #126 through a tested PR merged and deployed to preview.

**Architecture:** Native tenant settings, atomic occupancy claims, and reservations
in the API. Optional Nango calendar adapters and leased delivery jobs use existing
personal connections and the auth service SMTP transport. New public and private
screens use the existing app shell.

**Tech Stack:** TypeScript, Hono/OpenAPI, D1/SQLite/PostgreSQL, React, Vitest, Nango.

**Spec:** `docs/superpowers/specs/2026-10-03-tenant-booking-design.md`

## Global Constraints

- Active commercial tenants own every booking artifact.
- Professionals must be active Savia members of their own tenant.
- No new product dependencies; preserve existing Cloudflare and native deployment.
- Code and documentation are English; UI supports Spanish, English, and Portuguese.
- Durations and buffers are multiples of five minutes; start slots every fifteen minutes.
- Provider credentials and private calendar content never reach public responses.
- User authorized implementation, issue/PR creation, and merge without further prompts.
- `main` CI publishes preview; do not promote production.

## Review Focus

- Membership disabled after a slot read must prevent the reservation.
- Calendar outage must not advertise that professional as available.
- A stale reschedule must not release existing occupancy or emit notices.
- Public management capabilities must remain scoped to one reservation.
- Concurrent schedulers and retries must not duplicate calendar events or reminders.

### Task 1: Native booking domain and API

**Files:** `apps/api/src/bookings/{contracts,domain,repository,routes,jobs}.ts`,
`apps/api/test/bookings.test.ts`, D1/PostgreSQL `0022_tenant_bookings.sql`,
`apps/api/src/app.ts`, `apps/api/src/runtime.ts`.

**Interfaces:** Produces API in the spec; settings and response types are defined
in `apps/api/src/bookings/contracts.ts`. Calendar adapter and email sender are
dependency-injected. Full settings updates require current `version`.

- [ ] Write route tests proving absent API, then run and observe failures.
- [ ] Add schemas, availability generation, migrations, and atomic repository.
- [ ] Add scoped admin/public routes, CAPTCHA and public admission limits.
- [ ] Add leased delivery jobs and runtime scheduling on both scheduler paths.
- [ ] Verify route, concurrency, idempotency, time zone, and retry tests; commit.

### Task 2: Booking screens

**Files:** `apps/admin/src/features/bookings/*`, `apps/admin/src/app.tsx`,
`apps/admin/src/bootstrap.tsx`, sidebar navigation and locale files.

**Interfaces:** Consumes the Task 1 contract and the UI task brief at
`docs/superpowers/plans/tenant-booking-ui-brief.md`.

- [ ] Write failing UI behavior tests before implementation.
- [ ] Build private configuration/agenda and anonymous booking/management flows.
- [ ] Integrate navigation, lazy public bootstrap, localization, and responsive UI.
- [ ] Run UI tests and type checks; report files/checks to coordinator.

### Task 3: Nango calendar and SMTP adapters

**Files:** `apps/api/src/bookings/calendar.ts`, `apps/api/test/booking-calendar.test.ts`,
`apps/auth/src/account-email.ts`, `apps/auth/test/account-email.test.ts`.

**Interfaces:** Calendar adapter consumes existing principal-owned connections.
SMTP bridge extends the existing tenant email internal handler; root owns job wiring.

- [ ] Write failing tests for busy queries, idempotent event writes, and bridge auth.
- [ ] Implement provider adapters and bounded internal transactional email delivery.
- [ ] Run focused API/auth tests and report the exact integration interfaces.

### Task 4: Review, contracts, documentation, and merge

**Files:** `docs/guides/tenant-booking.md`, `docs/README.md`, generated API contracts.

- [ ] Generate API contracts and add the user/admin operations guide.
- [ ] Run focused suites, type checks, builds, and `pnpm test` with captured evidence.
- [ ] Review combined branch, fix material findings, and verify amended checks.
- [ ] Push feature branch, open PR referencing #126, wait for CI, and merge.
- [ ] Verify main CI and preview deployment for merged SHA; close the goal issue.
