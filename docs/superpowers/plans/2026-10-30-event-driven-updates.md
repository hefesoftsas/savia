# Event-driven Updates Implementation Plan

**Goal:** Reduce repeated polling in Savia while preserving execution reliability and tenant authorization.

**Architecture:** Reuse the existing authenticated realtime hub for change hints where supported. Move background wakeups toward durable, event-triggered delivery, retaining bounded recovery for lost wakeups. Preserve existing scheduled workflow semantics until a durable scheduler has a safe bootstrap and retry path.

**Tech stack:** TypeScript, Cloudflare Workers, Durable Objects, Queues, D1, Vitest.

**Original constraints (October 30):** Keep preview and production paused; do not deploy. Preserve tenant boundaries, durable delivery, existing OpenRouter settings, and existing users' changes.

**Superseding instruction (November 5):** The operator authorized preview and
production reactivation with recurring pings, polling and scheduled tasks disabled.
The incomplete recovery and operating protections are explicitly deferred as
[technical debt](../../runbooks/event-only-reactivation.md). Do not interpret the
original pause instruction as a current deployment prohibition, or enable the
durable capability while scheduled outbox repair remains disabled.

1. Inventory the existing flow status, assistant thread and page action update paths, including authorization and reconnection behavior.
2. Write behavioral tests before replacing a polling path. Deliver change notifications through authorized existing event channels and refresh persisted state on reconnect.
3. Examine collection outbox and scheduled triggers for a durable wakeup mechanism; implement only when lost notifications, idempotency, bootstrap and recovery remain covered by tests.
4. Update operational documentation and run focused tests and appropriate typechecks. Report any paths that cannot safely migrate without further prerequisites.

## Scheduled trigger migration still required

The Flows cron also performs retention and collection-batch recovery, so it cannot
be removed as a single scheduler switch. Replacing its scheduled-trigger scan
requires an idempotent cutover: persist the next occurrence and schedule generation,
claim each `(workflow_id, scheduled_time)` atomically in D1, use the same stable
execution ID in both runtimes, and schedule the next occurrence durably through
the existing WorkflowAgent. Update every trigger create, edit, enable, disable and
delete path, then bootstrap existing triggers and test missed callbacks, concurrent
cron/alarm delivery, retries, pauses and recovery. Keep the existing cron scan as
the source of truth until bootstrap and recovery are verified; afterwards retain a
bounded repair sweep as well as the independent maintenance jobs. No runtime cutover
or cloud resources are changed in this implementation.

## Durable delivery and operating limits

Persist principal-scoped change hints in the same database transaction as the
source mutation. Attempt bounded delivery when a write commits and retry failed
or unsent hints through a repair path; never mark an event delivered before the
hub accepts it. On socket reconnection, reload the authoritative screen state;
a heartbeat must detect half-open sockets. Keep fallback reads when the realtime
service is unavailable, with exponential backoff and no requests while hidden.
A replay endpoint must enforce principal ownership and cursor expiry, and event
retention must never delete pending deliveries. PostgreSQL and SQLite hosts need
matching semantics. Remove live reconciliation only after the delivery and repair
paths are covered by tests, including the commit-to-notification failure window.

The current realtime hub caps each room at 1,000 connections. This is an
application limit, not proof of 10,000 concurrent connections in a single tenant.
Load-test and shard tenant broadcasts before claiming that capacity.
