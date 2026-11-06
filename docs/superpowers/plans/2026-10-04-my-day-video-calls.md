# My Day video calls implementation plan

> **For agentic workers:** Use test-driven development and report verification.

**Goal:** Extend the approved Google Meet/Teams appointment experience to My Day.
**Architecture:** An optional `videoCall` boolean on calendar event creation requests conference data through the existing personal Nango connection. Events expose an optional conference object with provider, joinUrl and status. The calendar provider owns persistence; no browser storage. My Day selects one connected calendar for calls, retaining ordinary event behavior.
**Tech Stack:** TypeScript, Hono/OpenAPI, React, Vitest, Nango proxy.
**Spec:** User-approved flow in this conversation: Meet/Teams in Citas and My Day, one destination calendar per call. Zoom/Jitsi await an OAuth application/service.

## Constraints

- Preserve existing booking behavior, cancellation and rescheduling.
- English code/docs; localized user interface.
- Backend authorizes connection ownership and checks calendar conference capability.
- No additional credentials, migrations or fake meeting URLs.
- Preserve the created event even when conference generation remains pending.

## Review focus

- Unsupported account cannot masquerade as a ready meeting.
- Multiple connected calendars create one call only.
- Pending conference can become ready when events are reloaded.
- Unsafe or credential-bearing meeting links are never exposed.
- Plain events remain backwards compatible.

## Task 1: Calendar API

- [x] Add failing create/list conference tests in apps/api/test/personal-integrations.test.ts.
- [x] Extend apps/api/src/personal-integrations/operations.ts and routes/personal-integrations.ts with videoCall?: boolean and conference?: {provider: 'google_meet'|'teams'|null; joinUrl: string|null; status: 'ready'|'pending'|'unsupported'|'failed'}.
- [x] Detect supported Google/Graph calendar capability before create; request appropriate conference only when supported. Read conference data on list, preserving pending responses.
- [x] Verify API tests and typecheck; regenerate OpenAPI.

## Task 2: My Day

- [x] Add failing UI tests for selected destination and joining ready meetings.
- [x] Extend personal-integrations client and agenda widget with optional videoCall and conference contract.
- [x] Add call toggle, date input for future calls, and calendar selector; confirmation includes date/provider, statuses and safe join links. Keep ordinary event behavior.
- [x] Update guide and localized messages; verify UI tests and typecheck.

## Task 3: Integration

- [ ] Review combined changes, run scoped checks, create PR and deploy through existing preview process.
- [ ] Verify saved Nango scopes and explain account connection prerequisite accurately.
