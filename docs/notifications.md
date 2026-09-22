# Notifications

Durable, permission-aware personal inbox for collection activity, assigned work,
administrator messages, and supported authentication events.

## Sources

- **Collection activity** (`created`/`updated`/`deleted`, restore, purge): native
  database triggers in `0061_notification_collection_triggers.sql` /
  `0021_notification_collection_triggers.sql` /
  `0004_notification_collection_triggers.sql` capture writes and fan out to
  collection followers, excluding the acting user. Actor attribution reuses
  `crm_record_history_context`.
- **Workflow tasks**: `processWorkflows` appends a notice alongside each task
  insertion in the same checkpoint transaction, so a failed checkpoint rolls
  back both. `backfillWorkflowNotices` covers items created before capture.
- **Administrator messages**: `sendAdminNotice` with idempotency keys, 10/min
  per actor/workspace quota (429), audit rows, and delivery status.
- **Authentication**: `apps/auth` persists `email-verified` and
  `two-factor-enabled` transitions as source events; `apps/api` imports them
  across the service boundary (`importAuthNoticeEvents`) with an explicit
  bridge key (`SAVIA_INTERNAL_BRIDGE_KEY`) and idempotent acknowledgement.

## Delivery

Events are captured transactionally; a bounded, leased dispatcher
(`processNotifications`, 60s leases, fencing tokens) fans out recipient rows.
Retry schedule after a failed attempt: ~1, 5, 15, 60, 240 minutes with jitter;
five failures persist. Budgets per tick: 50 events, 100 recipients,
1,000 recipient attempts, 20s soft budget. `runScheduledNotifications` runs on
both the workflow-only and full scheduler paths; CRM sync stays disabled in
workflow-only mode.

## Inbox

- `GET /api/notifications?filter=all|unread|pending&cursor&limit` (default 30,
  max 100), opaque `(createdAt,id)` cursors, `GET /count`, read/archive/read-all
  (bulk reads are idempotent, capped at 100 with resumable cursors).
- Actions resolve only assigned workflow tasks and administrator
  acknowledgements; security notices return navigation, never completion.
- UI: bell with 30s polling in the header, `/notifications` route with
  all/unread/pending filters, follow controls on collection pages, and an
  administrator message screen with delivery status.
- Failed deliveries: inspect `GET /api/notifications/admin/:eventId/status`,
  retry with `POST .../retry`. Retention: read/archived 90 days, unread
  180 days (configurable per workspace, unresolved tasks and pending security
  requests are protected). Disabling dispatch pauses delivery without deleting
  committed events.

## Migration order

Apply host/standalone/auth schema changes before deploying producers
(`0060`/`0020`/`0003`, then `0061`/`0021`/`0004`). Deploy consumer APIs and
the dispatcher, then producers and UI; run the workflow backfill after capture
is active. Rollback preserves new tables and source events until compatible
consumers resume.

Latency is roughly one scheduler interval plus up to 30s of UI polling.
Database capacity: recipient fan-out is bounded per tick; large audiences drain
over successive ticks (see dispatch report backlog).
