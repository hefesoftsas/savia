# Jitsi meetings implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement the assigned tasks. The user approved the in-chat design and requested implementation.

**Goal:** Schedule Jitsi meetings from My Day and Bookings and deliver the same room link to attendees.

**Architecture:** Retain the existing calendar integrations and conference model. Add Jitsi as a conference provider independent of Google/Outlook. Use HTTPS links on meet.jit.si with random room identifiers, persisted before booking delivery and stored in calendar private metadata for personal events. Existing automatic Meet/Teams remains the default for backward compatibility.

**Tech Stack:** TypeScript, React, Hono, Zod, D1/Postgres, Vitest.

**Spec:** Approved conversation: unique meeting links in invitations, appointments and My Day; rescheduling preserves the room; joins open a new tab. Public Jitsi hosting for this first version, no deployment or server setup.

## Global constraints

- Personal create-event accepts optional conferenceProvider: 'jitsi' and attendees: string[] (email addresses, maximum 50); videoCall remains backward compatible.
- Booking settings accept conferenceProvider: 'automatic' | 'jitsi', defaulting to 'automatic' when absent. Store the selected conference with each booking so later settings changes do not change its room.
- Conference responses accept provider 'jitsi'. Use only HTTPS meet.jit.si room links for this implementation.
- Do not claim cancelling a public meeting revokes its URL. Hide joining after cancellation and cancel calendar invitations using existing delivery.
- Existing external calendar connections are still required to create personal events. Booking Jitsi links must survive absent/revoked calendar grants.
- English code/docs; localized UI text. No real invitations sent during development.

## Review focus

- A calendar refresh must preserve the Jitsi provider and URL; Google/Outlook native conferencing must not replace it.
- Retried booking jobs and reschedules must reuse the original link.
- Google sends attendee updates and Outlook receives required attendees; invalid addresses fail validation.
- Ready Jitsi links remain usable when calendar synchronization fails or is unavailable.
- Unsafe conference URLs and cancelled reservations must not expose join actions.

## Tasks

- [x] Personal API: extend create-event validation, attendees delivery, conference metadata serialization/readback, focused Google/Outlook tests.
- [x] Booking API/database: extend settings and conference contracts; persist one room at reservation; retain it through jobs/email/reschedule; migration and focused lifecycle tests.
- [x] Admin UI: extend client types; conference provider selector and attendee input in My Day; booking default provider selector; Jitsi join labels/validation; interaction tests.
- [x] Integration: run focused suites and affected typechecks, inspect migrations and API schema impacts, update user guides and review final diff.


## Verification and delivery

- Combined personal/calendar/booking API suites: 10 files, 163 tests passed; subsequent Outlook and strict-link additions passed their affected suites.
- Admin creation, join, booking settings and localization suites: 6 files, 55 tests passed. Calendar and public booking page regression suites also passed.
- SQLite baseline and D1 migration runner contracts: 9 tests passed. D1 migration preservation covers populated bookings, occupancy, jobs, delivery locks, indexes and foreign keys.
- API and admin TypeScript checks passed. OpenAPI types regenerated and formatted. Fresh independent code review found no correctness issues; generated formatting churn was corrected.
- No live invitations, audio/video sessions, PostgreSQL migration execution, or production deployment were performed. Apply migration 0033 before deploying the updated API/admin.
