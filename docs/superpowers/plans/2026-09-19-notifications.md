# Personal Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution method awaits user selection.

**Goal:** Deliver a durable, permission-aware personal inbox for collection activity, assigned work, administrator messages, and supported authentication events.

**Architecture:** Capture events transactionally and deliver recipient rows through a bounded, leased database dispatcher. Reuse workflow tasks as the authoritative action state and record-history context for actor attribution. Bridge the separate authentication database with durable source events and idempotent acceptance.

**Tech Stack:** TypeScript, Hono, Zod, React, TanStack Query, Cloudflare Workers/D1, existing SQLite/PostgreSQL adapters, Vitest and in-app browser verification against isolated local fixtures. No new message broker or delivery provider.

**Spec:** `docs/superpowers/specs/2026-09-19-notifications-design.md` (approved in conversation).

## Global Constraints

- Industry packages are consumers, not dependencies of the platform feature.
- Read state, task completion, and authentication verification are distinct operations.
- Approved scope: in-app delivery first, with extension points for email and push.
- No notification persistence in browser storage; the backend is authoritative.
- Default page size is 30 and maximum 100.
- Proposed send limits: title 200 characters, body 4,000, total payload 16 KiB, and 100 explicit recipients per request.
- At most 50 events and 100 recipients per batch; overall 1,000 recipient-attempt budget and 20-second soft budget per invocation; 60-second leases.
- Five retries after an initial failed attempt: approximately 1, 5, 15, 60, and 240 minutes plus bounded jitter.
- Retain read/archived notices 90 days and ordinary unread notices 180 days; protect unresolved tasks and pending security requests.
- Administrative idempotency keys remain valid for 30 days.
- Code, tests, and documentation are English; UI uses existing localization conventions with Spanish copy.
- Update behavior guides, generate API reference from schemas, and use English conventional commits.
- Work only in this existing isolated worktree. Do not deploy to production or modify real user data for tests.

## Review Focus

1. Same timestamp on multiple events: cursor pagination must neither drop nor repeat rows (Tasks 2 and 5).
2. A user loses membership or collection access between delivery and opening: no resource detail or action leaks (Tasks 3 and 5).
3. An archived task remains unfinished: pending-action filtering must still find it (Tasks 5 and 9).
4. Authentication commits but cross-service transfer fails: eventual delivery without duplicating or weakening authentication (Task 7).
5. A worker loses its lease while awaiting authorization: its stale batch must not commit (Task 3).

## File and dependency map

Shared contracts live in `packages/crm-shared/src/notifications.ts`.
Persistence and routing live in a new `packages/crm-server/src/notifications/` directory:
`repository.ts`, `dispatcher.ts`, `audience.ts`, `routes.ts`, `actions.ts`,
`collection-events.ts`, `admin.ts`, `maintenance.ts`, and `types.ts`.
The host adapter lives in `apps/api/src/notifications.ts`; authentication bridging
lives in `apps/api/src/auth/notification-events.ts` and
`apps/auth/src/notification-events.ts`. UI lives in
`apps/admin/src/features/notifications/` and uses the existing shell.

Tasks 1–3 establish the event and delivery contracts. Tasks 4, 6, and 7 produce
events. Task 5 supplies personal APIs used by Tasks 8–9. Task 10 closes migration,
operations, and end-to-end verification. Execute serially by default because these
tasks share persistence and authorization interfaces.

Migration names below are the next available numbers at planning time. Before
creating them, check for new migrations and select a collision-free number; update
all references together. Do not edit already-applied baseline migrations.

## Interface contracts used across tasks

```ts
export type NoticeScope =
  | { kind: 'workspace'; id: string }
  | { kind: 'account'; id: string };
export type NoticeActor = { kind: 'user' | 'workflow' | 'public-form' | 'system'; id: string | null };
export type NoticeSource =
  | { kind: 'record'; collection: string; id: string; operation: 'created' | 'updated' | 'deleted' }
  | { kind: 'workflow-task'; id: string }
  | { kind: 'admin-message'; id: string }
  | { kind: 'security-request'; id: string };
export type NoticeAudience =
  | { kind: 'explicit'; principals: string[] }
  | { kind: 'workspace-members' }
  | { kind: 'collection-followers'; collection: string };
export type NoticeEventInput = {
  scope: NoticeScope; key: string; actor: NoticeActor; source: NoticeSource;
  title: string; body: string; audience: NoticeAudience;
  createdAt: number; expiresAt: number | null;
};
export type NoticeActionState = 'none' | 'pending' | 'done' | 'expired' | 'unavailable';
export type NoticeView = {
  id: string; scope: NoticeScope; title: string; body: string;
  createdAt: number; readAt: number | null; archivedAt: number | null;
  source: NoticeSource; actionState: NoticeActionState;
};
export type InboxQuery = { cursor?: string; limit?: number; filter?: 'all' | 'unread' | 'pending' };
export type InboxPage = { items: NoticeView[]; nextCursor: string | null; cutoff: string };
export type DispatchOptions = {
  now: () => number; random: () => number; workerId: string;
  maxEvents?: number; maxRecipients?: number; maxRecipientAttempts?: number;
  softBudgetMs?: number; leaseMs?: number;
};
export type DispatchReport = { claimed: number; delivered: number; skipped: number; failed: number; retried: number; recoveredLeases: number };
export interface NotificationPolicy {
  canReadScope(principal: string, scope: NoticeScope): Promise<boolean>;
  canReadSource(principal: string, scope: NoticeScope, source: NoticeSource): Promise<boolean>;
  canSend(principal: string, scope: NoticeScope): Promise<boolean>;
  recipients(event: NoticeEventInput, after: string | null, limit: number): Promise<{ ids: string[]; nextCursor: string | null }>;
}
```

Account scopes permit only the matching principal as an explicit recipient.
Workspace-wide and collection audiences are invalid for account events. Policy
checks never accept a caller-selected authenticated principal.

### Task 1: Validated contracts and database migrations

**Files:** Create `packages/crm-shared/src/notifications.ts`,
`packages/crm-shared/test/notifications.test.ts`,
`packages/db/migrations/0060_notifications.sql`,
`packages/crm-server/migrations/0020_notifications.sql`,
`packages/db/postgres/0003_notifications.sql`,
`packages/crm-server/test/notifications-schema.test.ts`.
Modify `packages/db/postgres/manifest.json` and the schema exports in
`packages/db/src/core-schema.ts` / `packages/db/src/schema.ts` where used by the host.

**Interfaces:** Produces the contracts above, `noticeEventSchema`, `inboxQuerySchema`,
`adminNoticeSchema`, and `notificationDefaults`. All runtime inputs use strict Zod
objects and bounded strings; internal event titles allow the existing workflow
500-character limit, while administrator input remains limited to 200.

- [ ] Write a failing schema test rejecting account broadcasts, unknown action types,
  empty recipients, 101 explicit recipients, oversized UTF-8 payloads, and forged fields.

```ts
expect(noticeEventSchema.safeParse({
  scope: { kind: 'account', id: 'alice' },
  audience: { kind: 'workspace-members' },
}).success).toBe(false);
expect(inboxQuerySchema.parse({}).limit).toBe(30);
expect(inboxQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
```

- [ ] Run `pnpm --filter @savia/crm-shared exec vitest run test/notifications.test.ts`;
  confirm failure comes from the missing contract rather than test setup.
- [ ] Implement the contracts and migration tables: `notification_events`,
  `notification_deliveries`, `notification_recipient_retries`,
  `notification_subscriptions`, `notification_admin_audit`,
  `notification_send_limits`, `notification_scope_settings`, and
  `notification_maintenance_checkpoints`.
  Events have a unique `(scope_kind,scope_id,event_key)` key and fenced leases.
  Deliveries have a unique `(event_id,recipient_id,channel)` key. Scope columns are
  non-null. Retry rows are unique by event and recipient. Subscriptions store both
  creation time and stable principal identity. Settings validate 7–365 days for read
  retention and 30–730 days for unread retention, with unread >= read retention.
- [ ] Define recipient/scope/time/ID, unread, due-work, and subscription indexes.
  Store epoch milliseconds consistently. Use portable integer booleans and explicit
  PostgreSQL trigger implementations; do not assume SQLite SQL executes on Postgres.
- [ ] Test migration application and uniqueness on the existing real D1 fixture,
  then the repository PostgreSQL test harness. Use `getPlatformProxy` and migration
  loading patterns from `packages/crm-server/test/workflows.test.ts`.
- [ ] Rerun contracts and schema tests; commit `feat: add notification contracts and persistence`.

### Task 2: Transactional event repository and recipient state

**Files:** Create `packages/crm-server/src/notifications/types.ts`,
`packages/crm-server/src/notifications/repository.ts`,
`packages/crm-server/test/notifications-repository.test.ts`.

**Interfaces:** `NotificationRepository(db: D1Database)` produces
`eventStatements(input: NoticeEventInput): D1PreparedStatement[]`,
`accept(input: NoticeEventInput): Promise<{ id: string; duplicate: boolean }>`,
`list(principal: string, scopes: NoticeScope[], query: InboxQuery): Promise<InboxPage>`,
`markRead(principal: string, scope: NoticeScope, id: string, read: boolean): Promise<void>`,
`archive(principal: string, scope: NoticeScope, id: string): Promise<void>`.
Raw repository operations are internal; Task 5 performs current authorization.

- [ ] Write real-database tests for rollback of business write plus event statements,
  stable event IDs, duplicate acceptance, and 409 for a reused key with changed content.
  Test equal timestamps with two pages and repeat read/archive operations.

```ts
const input: NoticeEventInput = {
  scope: { kind: 'workspace', id: 'domain:general' }, key: 'message:one',
  actor: { kind: 'user', id: 'admin' }, source: { kind: 'admin-message', id: 'one' },
  title: 'Please review', body: '', audience: { kind: 'explicit', principals: ['alice'] },
  createdAt: 1000, expiresAt: null,
};
const first = await repository.accept(input);
expect((await repository.accept(input)).id).toBe(first.id);
await expect(repository.accept({ ...input, title: 'Changed' })).rejects.toMatchObject({ status: 409 });
```

- [ ] Run `pnpm --filter @savia/crm-server exec vitest run test/notifications-repository.test.ts` and observe failure.
- [ ] Implement canonical payload comparison, stable scope/key identity, prepared
  statements usable inside existing `transaction(db, statements)`, and recipient-
  constrained mutations. Conflicting event payloads fail, never overwrite history.
  Implement opaque validated cursor tuples `(createdAt,id)` and scope/filter binding.
  Avoid SQL string interpolation for IDs and filters.
- [ ] Verify rollback and concurrency on the real database, rerun tests, and commit
  `feat: persist notification events and personal delivery state`.

### Task 3: Fenced dispatcher and audience policy

**Files:** Create `packages/crm-server/src/notifications/dispatcher.ts`,
`packages/crm-server/src/notifications/audience.ts`,
`packages/crm-server/test/notifications-dispatcher.test.ts`,
`apps/api/src/notifications.ts`, `apps/api/test/notifications-policy.test.ts`.
Modify `apps/api/src/runtime.ts` and `apps/api/src/crm/runtime.ts`.

**Interfaces:** `processNotifications(db: D1Database, policy: NotificationPolicy, options: DispatchOptions): Promise<DispatchReport>`;
`options` has `now: () => number`, `random: () => number`, `workerId: string`,
`maxEvents`, `maxRecipients`, `maxRecipientAttempts`, `softBudgetMs`, `leaseMs`.
`createNotificationPolicy(db: D1Database): NotificationPolicy` uses the existing
identity/access repositories; standalone hosts inject an explicit policy.

- [ ] Add a test that accepts Task 2's explicit-recipient event and runs two workers:

```ts
await Promise.all([
  processNotifications(db, policy, { ...options, workerId: 'a' }),
  processNotifications(db, policy, { ...options, workerId: 'b' }),
]);
expect((await repository.list('alice', [input.scope], {})).items).toHaveLength(1);
```

- [ ] Add tests for stale lease during awaited permission checks, crash before/after
  cursor commit, inactive member, removed follower, self-change, 1,001 recipients,
  and one transiently failing recipient among successful recipients.
- [ ] Run dispatcher and policy tests before implementing.
- [ ] Claim by atomic conditional lease update; retain a random fencing token. Commit
  deliveries and fan-out cursor in the same transaction guarded by that token and
  unexpired lease. Never hold a database transaction across authorization awaits.
  Create a recipient retry row for transient policy/delivery errors and continue
  scanning. On permanent denial, count a skip. After five retries, persist failure.
- [ ] Page recipients with stable principal order and creation-time cutoff. Check
  active membership, current collection access, and self-notification exclusion.
  Account events only resolve their principal. Fail closed on unavailable policy.
- [ ] Add scheduled dispatch independently to both workflow-only and full runtime
  paths; include notification failure in the existing aggregate error handling.
  Keep scheduled CRM synchronization disabled in workflow-only mode. Log structured
  report, duration, oldest due event age, and backlog; never log message body.
- [ ] Rerun real-database concurrency tests and existing scheduler tests; commit
  `feat: dispatch notifications with bounded retries and fenced leases`.

### Task 4: Native record and workflow event capture

**Files:** Create `packages/crm-server/src/notifications/collection-events.ts`,
`packages/crm-server/test/notifications-producers.test.ts`.
Modify the Task 1 migrations, `packages/crm-server/src/workflows/runtime.ts`,
`packages/crm-server/src/record-history-storage.ts` only if needed,
`packages/crm-server/src/local-sync.ts`, and `packages/crm-server/src/index.ts` only
where actor propagation is missing. Inspect `apps/api/src/crm/record-bundles.ts`
and import paths for wrapper coverage before changing them.

**Interfaces:** `workflowNoticeStatements(db, input: NoticeEventInput)` delegates to
`eventStatements`; native SQL triggers produce the same persisted event shape.
`workflow_tasks` remains authoritative and existing workflow output IDs do not change.

- [ ] Add tests that update one record as Alice while Alice and Bob follow it; after
  dispatch, Bob gets one notice and Alice gets none. Include type-sensitive data
  changes, unchanged data, soft deletion, purge, restore, import, bulk, and local sync.
- [ ] Add a task-step rollback test asserting neither `workflow_tasks` nor its notice
  event survives a failed checkpoint. Add a retry test asserting one task/notice.
- [ ] Run `pnpm --filter @savia/crm-server exec vitest run test/notifications-producers.test.ts` and confirm failure.
- [ ] Capture native writes with dedicated triggers independent of active workflows.
  Read trusted actor from `crm_record_history_context`; default missing context to
  system. Reuse existing trigger semantics for actual data change, deletion, and
  restore, but do not append entire row snapshots to notification payloads.
- [ ] Append workflow notice statements alongside task insertion in `effects`, before
  the existing checkpoint transaction. Preserve old published workflow title limits.

```ts
const event: NoticeEventInput = {
  scope: { kind: 'workspace', id: run.workspace_id },
  key: `workflow:${run.id}:${node.id}`,
  actor: { kind: 'workflow', id: run.id }, source: { kind: 'workflow-task', id },
  title, body: '', audience: { kind: 'explicit', principals: [assignee] },
  createdAt: now, expiresAt: null,
};
effects.push(...new NotificationRepository(db).eventStatements(event));
```

- [ ] Verify both dialects and run workflow, record-history, local-sync, and producer
  tests; commit `feat: notify collection followers and workflow assignees`.

### Task 5: Personal inbox APIs and authoritative action resolution

**Files:** Create `packages/crm-server/src/notifications/routes.ts`,
`packages/crm-server/src/notifications/actions.ts`,
`packages/crm-server/test/notifications-routes.test.ts`.
Modify `packages/crm-server/src/index.ts`, `packages/crm-server/src/workflows/routes.ts`,
`packages/crm-server/src/workflows/repository.ts`,
`apps/api/src/crm/dynamic-openapi.ts`, and host route registration in `apps/api/src/app.ts`.

**Interfaces:** `registerNotifications(app, options)` accepts an injected policy and
session-derived principal. `resolveNoticeAction(db, policy, principal, scope, id)`
resolves only assigned workflow tasks and registered administrator acknowledgements;
security requests return navigation/state, never generic completion.
Export `notificationRequests` for generated API schemas.

- [ ] Write route tests for an ordinary member's own inbox, cross-principal mutation,
  cross-workspace IDs, revoked collection access, pending archived tasks, account
  notices in different workspace selections, and same-timestamp mark-all cutoff.

```ts
const response = await app.request('/api/notifications/foreign-id/read', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ read: true }),
});
expect(response.status).toBe(404);
```

- [ ] Run routes tests and observe failure.
- [ ] Implement list/count/read/archive/read-all routes, follow/unfollow routes, and
  action resolution. Derive principal from session; reject unknown body properties.
  Page authorized results without leaking inaccessible payloads or leaking counts.
  Pending query includes archived notices whose source task is still open.
- [ ] Issue a server cutoff containing `(createdAt,id)` for bulk-read semantics and
  constrain updates to it. Cap bulk-read work, exposing resumable continuation if
  the affected inbox exceeds the mutation budget. Read/unread and archive operations
  are idempotent. Counts use indexed predicates over currently visible rows.
- [ ] Recheck source permissions for actions. Resolve task in one conditional update
  scoped to workspace and assignee. Route old workflow resolution through this
  service; preserve workflow authoring permissions and old response shape.
- [ ] Register schemas in the existing dynamic OpenAPI generator. Run
  `pnpm --filter @savia/admin generate:api` with the local API generation prerequisites
  from its script, and existing OpenAPI contract tests; never hand-edit generated types.
- [ ] Rerun tests and commit `feat: expose permission-scoped notification inbox APIs`.

### Task 6: Administrative sending, acknowledgement, and delivery status

**Files:** Create `packages/crm-server/src/notifications/admin.ts`,
`packages/crm-server/test/notifications-admin.test.ts`.
Modify notification routes, contracts, and dynamic OpenAPI registration.

**Interfaces:** `sendAdminNotice(db, policy, principal, scope, key, payload)` returns
`{ eventId: string; status: 'accepted'; duplicate: boolean }`.
`payload` is `z.infer<typeof adminNoticeSchema>` and contains title, body, explicit/all-members audience, and optional
`requireAcknowledgement: boolean`; acknowledgement is not authentication verification.

- [ ] Test unauthorized send, inactive/foreign targets, repeated requests, changed
  payload conflict, concurrent rate limits, large all-members audiences, and retry.

```ts
const result = await sendAdminNotice(db, policy, 'admin', scope, 'request-1', payload);
expect(result.status).toBe('accepted');
expect((await sendAdminNotice(db, policy, 'admin', scope, 'request-1', payload)).duplicate).toBe(true);
```

- [ ] Run `pnpm --filter @savia/crm-server exec vitest run test/notifications-admin.test.ts` and confirm failure.
- [ ] Persist message acceptance, bounded backend rate-limit increment, event, and
  audit record atomically. Identical successful retries do not spend quota again.
  Use ten requests per minute per actor/workspace, returning 429 with retry timing.
  Return 409 for payload mismatch and 400 for invalid audience/size.
- [ ] Add administrator status and failed-recipient retry routes. Retry reuses event
  identity and records actor/time; report accepted/processing/completed/failed,
  delivered/skipped/failed counts, and sanitized failure categories.
- [ ] Store administrator acknowledgement per recipient and perform it with a
  conditional recipient-owned update; never expose a way to mark security verified.
- [ ] Rerun tests and commit `feat: send audited administrator notifications`.

### Task 7: Durable authentication events across the service boundary

**Files:** Create `apps/auth/src/notification-events.ts`,
`apps/auth/test/notification-events.test.ts`,
`apps/api/src/auth/notification-events.ts`,
`apps/api/test/auth-notification-events.test.ts`.
Modify `apps/auth/src/index.ts`, `apps/api/src/runtime.ts`,
`apps/api/src/notifications.ts`, and auth schema initialization/migrations used by
`apps/self-hosted/src/storage-init.ts` and its PostgreSQL adapter.

**Interfaces:** Auth exports `readAuthNoticeEvents(after, limit)` and
`ackAuthNoticeEvents(ids)` behind the existing private service boundary; API exports
`importAuthNoticeEvents(authService, db): Promise<{ accepted: number; acknowledged: number }>`.
Source event ID and auth subject are mapped through the existing identity repository,
never treated as interchangeable with Savia principal IDs.

- [ ] First read the installed Better Auth schema/lifecycle implementation and the
  existing auth tests. Locate persisted user email-verification and two-factor flags,
  and persisted verification-request records. Use database triggers on supported
  persisted state transitions for atomic source capture. Do not claim unsupported
  provider hooks or infer verification from a successful HTTP response alone.
- [ ] Write failing tests for supported verification/security state transitions,
  transfer failure after source commit, API commit before acknowledgement failure,
  unknown principal mapping, secret-free payload, and unauthenticated bridge access.

```ts
await importAuthNoticeEvents(authService, db);
await importAuthNoticeEvents(authService, db);
expect((await repository.list(principal, [{ kind: 'account', id: principal }], {})).items).toHaveLength(1);
```

- [ ] Run `pnpm --filter @savia/auth exec vitest run test/notification-events.test.ts`
  and `pnpm --filter @savia/api exec vitest run test/auth-notification-events.test.ts`.
- [ ] Create source event persistence during auth schema initialization, with
  dialect-specific triggers and stable keys for actual transitions. Persist only
  subject, kind, timestamp, source request identity, and expiry. Never persist
  verification values, tokens, passwords, or reset URLs in these events.
- [ ] Expose bounded event read/ack through the private service binding contract.
  Prove public ingress cannot reach it; if current private routing lacks that
  guarantee, add an explicit internal service authentication check and test it.
  Import at most 100 events per tick; commit destination events before acknowledging.
  Hold unknown identity mappings for retry with a visible operational error.
- [ ] Link to existing account verification/security pages using registered routes.
  Read completion/expiry from auth-owned state; generic resolve returns 409 for
  security actions. Unsupported email-verification request features stay absent.
- [ ] Run existing auth/session/reset/MFA tests plus bridge tests for both supported
  host adapters; commit `feat: bridge durable authentication notifications`.

### Task 8: Notification client, bell, and full inbox

**Files:** Create `apps/admin/src/features/notifications/client.ts`, `queries.ts`,
`notification-bell.tsx`, `notification-inbox.tsx`, and `notifications.test.tsx` in
that directory. Modify `apps/admin/src/components/admin/layout.tsx`,
`apps/admin/src/app.tsx`, and `apps/admin/src/i18n/locales/savia.ts`.

**Interfaces:** `useNotificationInbox(scope, filter)`, `useUnreadNotifications(scope)`,
`NotificationBell`, and `NotificationInbox` consume generated contracts.
Do not replace the existing `components/admin/notification.tsx` toast component.

- [ ] Load applicable UI and backend-only-storage skills before implementation.
  Write tests for bell count, keyboard opening/focus return, pagination, 401/403,
  network retry, empty inbox, principal switch, and hidden-tab polling pause.

```tsx
expect(screen.getByRole('button', { name: /notificaciones/i })).toBeVisible();
await user.click(screen.getByRole('button', { name: /notificaciones/i }));
expect(await screen.findByRole('dialog')).toBeVisible();
```

- [ ] Run `pnpm --filter @savia/admin exec vitest run src/features/notifications/notifications.test.tsx` and observe failure.
- [ ] Implement server-backed query keys including principal and scope, 30-second
  visible polling, focus refresh, bounded error backoff, and logout cache clearing.
  Mutations invalidate count and list; failed mutations retain visible retry controls.
- [ ] Add the bell and inbox route using existing popover/dialog, button, typography,
  and accessibility patterns. Render plain text. Show all/unread/pending filters,
  timestamps, source labels, read/unread/archive controls, and source-owned actions.
  Treat unavailable/expired resources as clear non-actionable states.
- [ ] Rerun UI and shell tests; commit `feat: add the personal notification inbox`.

### Task 9: Follow controls and administrator notification UI

**Files:** Create `apps/admin/src/features/notifications/collection-follow.tsx`,
`admin-notice-form.tsx`, `admin-notice-status.tsx`, and `notification-actions.test.tsx`.
Modify `apps/admin/src/features/crm-engine/app.tsx`, existing collection operation
integration in that feature, `apps/admin/src/features/crm-engine/workflows.tsx`,
and application routing/localization files from Task 8.

**Interfaces:** `CollectionFollow({ collection, scope })`, `AdminNoticeForm`, and
`AdminNoticeStatus({ eventId })` consume Tasks 5–6 APIs and existing permission hooks.

- [ ] Write tests for follow/unfollow failures, administrator-only form visibility,
  selected/all-member audiences, 429 retry feedback, accepted-vs-delivered status,
  acknowledgement, security navigation, and archived unresolved tasks.

```tsx
await user.click(screen.getByRole('tab', { name: /pendientes/i }));
expect(await screen.findByText('Archived unfinished task')).toBeVisible();
```

- [ ] Run `pnpm --filter @savia/admin exec vitest run src/features/notifications/notification-actions.test.tsx` and confirm failure.
- [ ] Add collection follow controls and an administrator message screen with title,
  body, recipient selection, optional acknowledgement, and delivery progress. Persist
  no browser state beyond unsaved form/query state; reuse request idempotency keys
  for uncertain retries. A successful response shows accepted until dispatch finishes.
- [ ] Link the existing workflow inbox to the new inbox while preserving current
  task state and direct resolution semantics. Do not delete legacy APIs in this release.
- [ ] Verify small-screen layouts and keyboard navigation, rerun tests, and commit
  `feat: add collection subscriptions and administrator messaging UI`.

### Task 10: Retention, migration backfill, and release verification

**Files:** Create `packages/crm-server/src/notifications/maintenance.ts`,
`packages/crm-server/test/notifications-maintenance.test.ts`,
`docs/notifications.md`, `packages/crm-server/test/fixtures/notifications-preview.ts`,
and `apps/admin/notifications-preview.html` as loopback-only browser fixtures. Modify `apps/api/src/runtime.ts`, `docs/workflows.md`, and `docs/README.md`.

**Interfaces:** `maintainNotifications(db, now, limit = 100)` and
`backfillWorkflowNotices(db, after, limit = 100)` return counts and continuation
cursors. Settings routes expose the retention limits from Task 1 to administrators.

- [ ] Write tests for interrupted/resumed backfill, replayed batch, unresolved task
  retention, expired security requests, read/unread retention, 30-day send key replay,
  rejected expired automatic events, and bounded cleanup.

```ts
await maintainNotifications(db, now, 100);
expect((await repository.list('alice', [scope], { filter: 'pending' })).items)
  .toEqual(expect.arrayContaining([expect.objectContaining({ actionState: 'pending' })]));
```

- [ ] Run maintenance tests and observe failure.
- [ ] Implement resumable open-workflow-item backfill using the same source event
  keys as live production. Store checkpoint only with committed batch. Capture live
  producers before backfill; uniqueness prevents overlap duplicates. Do not replay
  historical collection activity. Keep compact dedup receipts for the allowed replay
  window; source task receipts survive inbox retention.
- [ ] Add bounded retention and settings, protecting source-owned pending actions.
  Use separate checkpoints for cleanup/backfill. Add maintenance to the scheduler
  with isolated error reporting. Do not clean active leases or pending retry rows.
- [ ] Start the isolated fixture and use the browser skill for recorded browser
  scenarios: ordinary user receives another user's edit; admin sends
  an acknowledgement; workflow task resolves in both views; account switch clears
  inbox; denied resource cannot be opened; offline delivery recovers. Exercise a
  synthetic large audience and record tick budgets and backlog drain evidence.
- [ ] Update guides with migration order, supported sources, latency of roughly one
  scheduler interval plus polling, retry/retention settings, failed-delivery recovery,
  database capacity limits, backfill instructions, and authentication capabilities.
- [ ] Run focused notification suites and impacted existing workflow/auth/history/
  local-sync suites, then `pnpm run typecheck`, `pnpm run test:contracts`, touched-file
  formatting, and `git diff --check`. Run the self-hosted notification integration
  suite for SQLite and PostgreSQL. Record exact outcomes; do not claim a suite passed
  if its infrastructure prevented execution.
- [ ] Request the selected execution method's final review, fix verified findings,
  rerun affected tests, and commit `feat: complete notification lifecycle and operations`.

## Rollout and review handoff

Apply host/standalone/auth schema changes before deploying producers. Deploy
consumer APIs and dispatcher, then producers and UI; run the resumable workflow
backfill after capture is active. Test on isolated fixtures before any live rollout.
Disabling dispatch pauses delivery without deleting committed events. A rollback
must preserve new tables and source events until compatible consumers can resume.

No implementation or live deployment is performed by this plan-writing task.
Recommended execution is native in this session: shared schema, authorization, and
source-state contracts make serial implementation easier to keep coherent. The
alternative is subagent-driven execution with a separate implementer and reviewer
per task, at higher coordination/context cost. User review and method selection
precede implementation according to the writing-plans workflow.
