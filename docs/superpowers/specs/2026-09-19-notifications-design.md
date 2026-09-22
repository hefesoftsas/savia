# Personal notifications and actionable inbox

Date: 2026-09-19
Status: Proposed specification; scope approved, written specification awaiting review.

## Intent and success criteria

Build a general-purpose Savia notification system that tells a user when another
person changes a collection they follow, when they have assigned work, and when an
administrator or authentication flow requires their attention. Users need a durable
personal inbox with useful actions; administrators need controlled delivery and
visible failures. The system must isolate workspaces, survive worker restarts, and
process large audiences without unbounded requests. Industry packages are consumers,
not dependencies of the platform feature.

Approved scope: in-app delivery first, with extension points for email and push.
Read state, task completion, and authentication verification are distinct operations.
The following concrete defaults are design choices proposed for review.

## Existing foundations

- `packages/crm-server/src/workflows/runtime.ts` commits task/notification creation
  with the step receipt and checkpoint in one transaction.
- `workflow_tasks` is unique by workspace, execution, and node. Assigned items are
  stored with an assignee, open/done status, and optional due date.
- `packages/crm-server/src/workflows/repository.ts` exposes an assignee-filtered
  inbox capped at 200 items. Resolution checks the assignee.
- The current inbox routes use the workflow resolve policy. The host currently maps
  that policy to workspace administrators, so ordinary users need a separate inbox
  access policy without receiving workflow design or execution permissions.
- Native collection writes already have transactionally captured workflow events.
  Collection notification capture must work independently of published workflows.
- The API already has a scheduled workflow runner. A separate bounded notification
  dispatcher can share its scheduler entrypoint without sharing its job receipts.

## Architecture decision

Use a durable database event outbox and recipient delivery records. Keep the initial
in-app dispatcher on the existing scheduled runtime; do not require a new queue
service for the first release. An optional future queue can wake the same dispatcher,
while persisted events and idempotent receipts remain the source of truth.

A synchronous-only implementation is simpler but ties mutation latency to audience
size and makes partial delivery harder to recover. A queue-first multichannel
implementation adds infrastructure and provider configuration before it improves
the approved in-app experience. The database-backed dispatcher provides recoverable
batch processing and a clear path to queue workers. It does not promise unlimited
throughput from one database; measured backlog determines future partitioning needs.

Separate modules own producer validation, persistence, audience resolution,
dispatch, inbox access, and administrative operations. Use host adapters for
principal/workspace authorization and authentication events so the shared CRM
runtime does not depend on API-specific identity code.

## Sources and audience rules

### Collection activity

Users explicitly follow a native collection. Following requires current access;
existing owners are not silently subscribed. The UI provides a follow control and
explains that it watches record creation, updates, and deletion in that collection.
Schema changes are outside this initial event contract.

Capture accepted backend changes in the same transaction as the record mutation,
including imports, bulk operations, and accepted local synchronization writes.
Unchanged data does not generate an update notification. Capture the authenticated
actor from trusted mutation context; never infer the actor from a workflow publisher
or a client-supplied user ID. System writes carry an explicit system actor. Suppress
self-notifications only when the recipient equals a known actor.

Fan-out includes subscriptions created before the event and still active when
processed. Every recipient must still be active and authorized. Unfollowing stops
undelivered activity notices; it does not delete the existing inbox. Generic titles
identify the collection and action without copying record contents. Links recheck
record permissions; deleted records have an informational notice rather than a
broken action.

### Tasks and workflows

New workflow task/notification creation appends the notification event in the same
transaction as the existing task and workflow checkpoint. Event identity derives
from workspace, execution, and node so retries cannot create duplicate notices.

The new inbox links to the existing task as its source of truth. Reading or archiving
a notice does not complete a task. Completing a task validates current membership
and assignee ownership and updates the source task transactionally. Both old and
new interfaces must show the same completion state. Task creation continues to be
non-blocking; this feature does not introduce workflow pause/resume approvals.

### Administrator messages

Authorized workspace administrators can send plain-text notices to selected active
members or all active members of their workspace. Validate audience and permission
server-side. Persist the message and event before returning an accepted result;
deliver broad audiences in batches. Record author, request identity, accepted time,
delivery progress, and failure summary. Repeating the same idempotency key with a
different payload is a conflict. An optional verification request creates an
assigned action whose allowed completion is defined by a registered handler.

### Authentication and verification

Provide a typed internal producer for authenticated account/security events and
integrate it with supported existing authentication lifecycle hooks. Account-scoped
notices belong only to their principal and must not expose workspace data. Such
notices are available independently of the selected workspace.

Actions navigate to existing trusted verification or reauthentication flows. Tokens,
OTP values, recovery codes, and credentials never enter notification payloads or
logs. Only the authentication service can report that verification completed; a
notification click, read, dismissal, or general task-resolution endpoint cannot do
so. Expired requests display an expired state. Creating a new MFA or approval engine
is outside scope; unsupported authentication actions must not be presented as
working features.

## Persistence and consistency

Add dedicated migrations for the host and standalone runtime, following the
repository database abstraction and supported dialects.

- Events: scope, stable event key, type, trusted actor, source reference, bounded
  payload, audience descriptor, created time, expiry, processing state, next retry,
  attempt count, lease owner/token, lease expiry, and fan-out cursor.
- Deliveries: event, scope, recipient, channel, created time, read time, archived
  time, and delivery state. Unique event/recipient/channel constraint prevents
  duplicate inbox entries. Action status is derived from its authoritative source.
- Subscriptions: workspace, principal, collection, creation time, with a unique
  workspace/principal/collection constraint.
- Administrative audit: message acceptance and privileged retry actions, with
  actor and scope. Avoid duplicating sensitive payloads in operational logs.

Use explicit scope identifiers, including an account scope for security events;
nullable workspace uniqueness must not accidentally weaken deduplication. Index
recipient/scope/created-time/ID for cursor pagination, recipient unread queries,
dispatch state/next-retry/ID, and collection subscriptions. Do not scan all inbox
rows to compute each user's counter.

Persist each delivered batch and cursor advancement atomically. Claim work with an
expiring lease and fencing token; stale workers cannot advance or commit a claimed
batch. Recipient insertion is idempotent. Worker termination before commit leaves
the batch recoverable; termination after commit resumes from the stored cursor.
Audience paging uses a stable principal cursor and event-time eligibility cutoff.
Recheck membership and permissions while dispatching and when accessing actions.

## Delivery limits, retries, and observability

Proposed defaults: at most 50 events and 100 recipients per batch, with an overall
1,000 recipient-attempt budget and 20-second soft budget per dispatcher invocation.
Stop claiming new work when either budget is exhausted. Use 60-second leases and
fenced renewal when required. Defaults must be configurable within validated bounds.

Retry transient failures at most five times with increasing delays of approximately
1, 5, 15, 60, and 240 minutes plus bounded jitter. Permanent validation failures
become failed immediately. A failed recipient must not starve the remaining audience;
track deferred recipients separately and preserve their unique delivery identity.
Exhausted retries become inspectable failed deliveries. Privileged retry records an
audit event and reuses original event/recipient identity. Unauthorized or inactive
recipients are skipped, not repeatedly retried.

Expose backlog count, oldest due event age, processing duration, delivered/skipped/
failed counts, retry count, and expired lease recoveries through existing operational
logging/metrics conventions. Show an administrator the actual accepted, processing,
completed, or failed state rather than claiming that accepted means delivered.

## Permissions and API contract

Inbox reads and updates always derive the recipient from the authenticated session.
An arbitrary recipient parameter cannot grant access. Workspace membership is
required for workspace notices; account notices require principal ownership.
Read-only notification access does not grant workflow history, publishing, or design
permissions. Revoked collection access hides protected resource details and disables
its action; revoked workspace membership excludes that workspace's notices.

Provide validated typed operations for cursor-paginated listing, unread count,
mark read/unread, archive, mark all read up to a supplied server cutoff, subscription
management, administrator send/status/retry, and source-specific action completion.
Default page size is 30 and maximum 100. Cursors include created time and ID and are
validated in the authenticated scope. Bulk read must not include newer arrivals.

Generate the API reference from route schemas using the project's OpenAPI pipeline.
Do not maintain a handwritten endpoint reference. Reuse the existing session and
request-protection mechanisms. Render text as text and accept only registered
internal action types; do not execute arbitrary URLs or action code from payloads.

Proposed send limits: title 200 characters, body 4,000, total payload 16 KiB, and
100 explicit recipients per request. All-workspace sends use an audience descriptor.
Start with 10 administrative send requests per minute per actor and workspace,
enforced in shared backend state, with a clear retry response. Tune from metrics.

## User interface

Add a keyboard-accessible notification bell to the existing application shell with
an unread badge and a panel linking to a full inbox. The inbox offers all, unread,
and pending-action filters, clear timestamps, source labels, and pagination. Provide
loading, empty, offline, forbidden, and retryable-error states with existing UI
patterns and Spanish product copy consistent with the host.

Read and archive are independent controls. Tasks have an explicit completion action;
security notices have a verification action. Pending work remains available through
the pending-action filter even if its notice was archived. Confirmation is required
only where the underlying action already requires it.

Poll while the authenticated page is visible (initial target: every 30 seconds),
refresh on focus, and invalidate cached counts after successful changes. Pause in
hidden tabs, back off on errors, and clear principal-scoped cache on identity changes.
No notification persistence in browser storage; the backend is authoritative.

## Retention and migration

Default retention is 90 days for read/archived notices and 180 days for ordinary
unread notices. Do not remove unresolved tasks or pending security actions; expired
security requests cease to be actionable according to the authentication service.
Clean up in bounded scheduled batches. Keep deduplication identity through the
supported replay window: administrative idempotency keys remain valid for 30 days,
and automatic producers must reject replay of expired historical events. Retain
source task identity and workflow checkpoint semantics independently of inbox
cleanup. Workspace administrators may select shorter or longer retention within
validated host limits; deployment documentation must explain its storage impact.

Backfill existing open workflow items through a resumable operation with stable
source-derived identities. Do not replay historical collection mutations. Preserve
old routes during migration, route resolution through the same source-task service,
and retire the old embedded inbox only once the replacement is verified. Apply
schema changes before deploying producers. Failed notification dispatch never
rolls back an already committed business operation; failed atomic event capture
must fail the original transaction rather than silently lose the event.

## Verification and release criteria

- Prove atomic capture for native CRUD, bulk/import, local sync, and workflow tasks:
  rollback produces neither change nor event; commit produces recoverable work.
- Test competing workers, lease expiry, stale fencing, restart before/after commit,
  duplicate producer requests, and bounded audience traversal.
- Test ordinary users, inactive users, cross-workspace requests, forged recipients,
  permission revocation, self-notification suppression, and actor attribution.
- Test cursor pagination under concurrent inserts, unread counts, mark-all cutoff,
  task completion consistency, archived pending actions, and expiry/retention.
- Verify authentication completion cannot be forged through inbox operations and
  that secrets are absent from payloads and logs.
- Exercise a synthetic large audience and confirm per-tick work remains bounded,
  subsequent ticks drain the backlog, and failed recipients do not stop others.
- Cover bell/inbox/admin-send UI behavior, keyboard access, account switching,
  source links, visible delivery errors, and small-screen layout in browser tests.
- Run focused package tests, relevant contract tests, typecheck, and formatting of
  touched files. Document any pre-existing unrelated repository failures.
- Update the notifications user/operations guide, workflow guide, and docs index.
  Confirm both host and standalone migrations and the supported database adapters.

## Explicit non-goals

Email/SMS/push providers, websocket infrastructure, arbitrary HTML messages, a new
authentication engine, blocking workflow approvals, external collection adapters,
and automatic historical activity replay are not part of the first implementation.
Their future adapters must preserve the same authorization and idempotency contracts.
