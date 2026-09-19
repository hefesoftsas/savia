# General workflows

Workflows belong to a data workspace, not to an insurance or agency package.
Open **Build → Workflows** in the sidebar, or the **Flujos de trabajo** tab in collection operations.

## Author and run

1. Create a workflow and select a trigger: manual action, native record creation,
   native record update, an incoming webhook, or a recurring interval with a UTC start time.
2. Add steps and configure their inputs. Values preserve their type: text,
   number, boolean, null, or a reference to trigger data or previous results.
3. Choose the next step explicitly. Conditions have separate true/false destinations.
   The first step is the entrypoint. Every step must be reachable and cycles are rejected.
4. Save the draft, then publish. Publication activates an immutable revision.
   Editing a draft does not change the active version or any existing execution.
5. Run manual workflows from the editor, or wait for the event/schedule. Inspect
   the execution list and expand each completed step to see its result.

Native steps: condition, transform, equality query, create, update, task, internal
notification, and durable delay. Queries return `{ records, count }`; create/update
return the record including its ID. Tasks and notifications appear in the assigned
user's workflow inbox. Task creation does **not** wait for task completion.

References include `trigger.status`, `before.status`, `system.owner`,
`system.workspace`, and `steps.step_1.id`. A step reference must be available on
every incoming path; a result from only one branch cannot be used after a merge.
There is no JavaScript execution or string interpolation.

## Incoming and outgoing webhooks

Select **Webhook recibido**, save the draft, then create its URL and secret. Copy the
secret immediately; it is displayed once and stored only as a digest. Publish and
activate the workflow before sending requests. Rotating the secret immediately
invalidates the previous one; the endpoint URL and duplicate receipts remain stable.

```sh
curl -X POST 'https://YOUR_API/api/public/workflow-webhooks/ENDPOINT_ID' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_SECRET' \
  -H 'Idempotency-Key: unique-event-id' \
  -d '{"name":"Example","amount":42}'
```

Send a JSON object up to 32 KiB. Its fields are available as `trigger.name`,
`trigger.amount`, and other typed references. Supply a printable ASCII event key
of 1–150 characters (no initial whitespace). Repeating the same key and equivalent
JSON returns the original execution ID; changing its payload returns 409. Object
key order is ignored but array order is significant. A 202 response means durably
queued, not completed. Each endpoint admits 60 new executions per UTC minute;
a duplicate does not consume quota. Hosts with a configured public-route rate
limiter additionally throttle public traffic. Disabled workflows reject new events;
authenticated retries can retrieve an existing receipt. Unknown endpoints and
invalid credentials return 404.

Add **Enviar webhook** to deliver a POST JSON object. Create/select a public HTTPS
destination, choose no authentication, Bearer, or a named API-key header, and map
fields with the existing value controls. Destinations belong to the workspace;
management requires workflow design permission. Authenticated destinations require
the host's `CRM_INTEGRATION_KEY` (standalone CRM: `INTEGRATION_KEY`), at least 32
characters. Credentials are encrypted and never returned by management reads.

A step pins the selected destination revision. Editing a URL creates a new revision
and does not redirect published workflows; explicitly select the new version and
publish to adopt it. Credential rotation applies to existing revisions with matching
authentication type/header. Changing that type/header blocks old incompatible
revisions. Disabling a destination prevents subsequent attempts.

Delivery records the exact payload before contacting the receiver. Network failures,
timeouts, HTTP 408/429 and 5xx permit up to three automatic attempts, normally after
5 and 30 seconds. A valid Retry-After overrides the delay, capped at five minutes.
Other non-2xx statuses fail immediately. Manual retry resumes the failed step with
the same body and idempotency key and a fresh three-attempt budget. The receiver
must honor that key: a crash after remote acceptance can cause a repeated delivery.
There is no guarantee of exactly-once remote effects. Cancellation cannot undo an
HTTP request already in flight but prevents its result from advancing the workflow.

The receiver gets `Idempotency-Key`, `X-Savia-Execution-Id` and `X-Savia-Node-Id`.
Step output provides `status`, `body` and `truncated`, available through references
such as `steps.send.status`. Responses are limited to 32 KiB; oversized bodies are
replaced with a truncation marker. Known credentials and sensitive JSON keys are
redacted before storage and are unavailable to subsequent steps. History includes
each attempt and uncertain outcomes after lease expiry. Retention matches existing
workflow history; duplicate receipts are not automatically removed.

Destinations require HTTPS port 443, public domain names and public DNS answers;
IP literals, internal destinations, embedded URL credentials and redirects are
rejected. DNS preflight is defense in depth and does not pin the socket's DNS
resolution in the Worker transport. Network work is bounded to ten seconds. Payloads
are limited to 32 KiB, and the existing execution-context limit still applies.

Apply `packages/db/migrations/0058_workflow_webhooks.sql` (host) or
`packages/crm-server/migrations/0018_workflow_webhooks.sql` (standalone) before using
webhooks. Existing definitions require no rewrite. Preview deployments with cron
disabled accept events into the queue but need an intentional scheduler tick to run.

## Persistence, recovery and authorization

- Definitions, published versions, events, executions, jobs and inbox items live in D1.
  Browser state is only an unsaved editor/session cache. Reload discards unsaved edits.
- SQL triggers capture native writes in the same transaction. CRUD, imports, bulk
  writes and accepted local-sync writes therefore use the same event boundary.
  Offline edits trigger a flow only after the backend accepts them.
- The event captures the active published version immediately. Deactivating a flow
  prevents future starts; it does not cancel accepted executions. Use **Cancel** for those.
- Each native write, task or notification commits atomically with its job receipt and
  next-step checkpoint. Leases prevent two workers from committing the same step.
  An expired lease is recoverable by a later tick without replaying completed steps.
- Current execution-owner permissions are checked before every step and delayed resume.
  The owner is the publisher of the pinned version. Manual starts also record the initiator.
  Revoked owners produce a blocked execution; retry rechecks permissions.
- API actions distinguish view, design, publish, execute, history and resolve. This
  delivery maps them to the host's existing workspace-administrator policy. Platform
  administrators can operate general data domains. Non-admin delegated authoring and
  inbox access need a future host permission policy; the engine does not bypass it.
- Only the assigned principal can resolve an inbox item, even within a workspace.
- Unexpected errors retry at most three attempts with bounded backoff. Validation and
  version conflicts fail visibly. Manual retry resumes the failed step, never prior jobs.
- Workflows caused by workflow writes stop dispatching at depth five. Delays are stored
  as due timestamps, not in-memory timers. Scheduling coalesces missed occurrences into
  one run and advances the next due time; it does not backfill an unbounded backlog.

## Runtime decision and verification

The executor is a bounded D1 scheduler (up to 100 steps and 50 due schedules per tick).
It runs with the API scheduled handler alongside existing CRM synchronization. Production
configuration already schedules one tick per minute. Preview configurations disable cron;
enable an intentional scheduler before expecting executions there. Local `pnpm dev` uses
the existing development scheduled-event runner. Delays have scheduler-granularity timing,
not second-accurate delivery.

`packages/crm-server/test/managed-workflow.test.ts` probes the installed Cloudflare managed
runtime: committing a D1 write and failing before the managed step receipt causes a second
write on retry; event-based resumption also passes. Managed orchestration does not make an
arbitrary native side effect atomic. For this native-only delivery, D1 checkpoints keep the
write and receipt together. This is not a claim that managed Workflows lacks durability;
it would still require adapter idempotency if adopted later.

Apply `packages/db/migrations/0054_workflows.sql` before deploying the API. The standalone
CRM test/local stack uses `packages/crm-server/migrations/0016_workflows.sql`. Existing
automations are untouched. Neither migration dispatches historical records.

Focused verification:

```sh
pnpm --filter @savia/crm-shared exec vitest run test/workflows.test.ts
pnpm --filter @savia/crm-server exec vitest run test/workflows.test.ts test/managed-workflow.test.ts --hookTimeout=120000
pnpm --filter @savia/admin exec vitest run src/features/crm-engine/test/workflows.test.tsx --maxWorkers=1
```

The loopback-only `test/fixtures/workflow-preview.ts` worker and admin
`test/fixtures/workflows-preview.html` are browser-test entrypoints, not deployment
entrypoints. Use a separate temporary D1 persistence directory; they intentionally use
a fixed test identity and must never be deployed or pointed at user data.

## Current boundaries

- Native collections only; external/domain/SQL/API adapters are rejected at publication
  and execution. Outgoing JSON webhooks are supported as a dedicated step; general HTTP/email connectors are not.
- At most 50 acyclic steps, 50 mappings per step, 100 query results, 64 KB definitions,
  32 KB manual input and 256 KB execution context. Lists show the latest 200 definitions
  or inbox items and 100 executions. Retention/archival tooling is not yet included.
- Approvals, blocking human tasks, arbitrary cron expressions, parallel branches,
  loops, subflows and connector nodes remain future capabilities.
- The visual editor is a selectable step sequence with explicit branch destinations,
  not a free-positioned drag-and-drop graph. Manual action is currently in that editor,
  not yet an action embedded in every record screen.

## References

- [NocoBase workflow concepts](https://docs.nocobase.com/handbook/workflow)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
