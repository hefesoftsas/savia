# General-purpose workflows

Status: proposed implementation specification. No runtime implementation yet.

## Product intent

Savia is a general-purpose low-code platform. Workflows belong to the platform
and operate on user-defined collections and domains. No insurance package,
agency profile, customer schema, or industry-specific role is required.

## Architecture

Separate authoring, event capture, durable execution, and application adapters.
A workflow has a stable identity, editable drafts, immutable published versions,
one trigger, and a validated graph of typed nodes. Each execution pins its
definition version and event input. Each node invocation records its input,
output, status, attempt, and timestamps. Iterations receive distinct invocation
identities. Publishing a successor never changes an existing execution.

Use platform names: workflows, workflow_versions, workflow_executions,
workflow_jobs, workflow_events, workflow_tasks. Every record is scoped to its
workspace. Collection references include domain and collection identity.
Backend persistence is authoritative for definitions and execution state.

The initial runtime decision requires a small executable comparison of a
Cloudflare Workflows interpreter and a D1-backed executor. Evaluate restart
recovery, a delayed step, duplicate delivery, human response, local testing,
version pinning, deployment compatibility, and operational limits. Do not
introduce arbitrary uploaded JavaScript as a prerequisite for visual workflows.
Keep the node executor contract independent of the scheduling provider.

## Events and consistency

Persist native mutation events atomically with the business write. Use immutable
event IDs and preserve transitions rather than coalescing to the latest record.
The existing replication journal is not an event history and cannot substitute
for this outbox. Specify coverage for CRUD, imports, bulk writes, restores, and
sync pushes. Offline edits trigger workflows only after server acceptance.

Dispatch outbox events with deterministic execution IDs and deduplicate retries.
Select and pin the published version according to the event's activation epoch.
Suppress recursive retriggering with recorded causation and a bounded depth.
External adapters declare their supported events; changes outside Savia require
an explicit webhook, change feed, or polling integration.

## Authorization and lifecycle

Separate design, publish, execute, view-history, and resolve-task permissions.
Record the initiator and execution identity. Resolve current permissions before
each protected operation and after resumption. Never accept a client-supplied
workspace as authority. A workflow is not a permission bypass.

Drafts are inactive. Activation applies to new events. Deactivation prevents new
starts while existing executions retain their version and remain inspectable.
Cancellation is a distinct operation. Credentials are backend connection
references; execution history must redact secrets and minimize personal data.

## First delivery

Provide a workflow list, visual step editor, configuration panel, variable
selector, draft validation, activation, execution list, and per-step inspection.
Use existing collection metadata for field types and selectable variables.
Variables reference trigger data, completed upstream nodes, and system values.
Reject missing references, unreachable nodes, and unsupported graph cycles.

Initial triggers: record created, record updated, explicit button, and schedule.
Initial nodes: condition with true/false branches, query records, create record,
update record, transform values, create task, and in-app notification. Expose
only adapters that actually support the requested operation. Bound query size,
step count, runtime, and payload size.

Short synchronous validations and asynchronous durable flows have different
contracts. Waiting nodes are not valid in synchronous validation flows. The
initial general workflow engine is asynchronous; pre-action interception is a
later capability requiring its own transaction and response contract.

## Human work and advanced delivery

Creating a task does not suspend a flow. A human-input node creates a task with
an explicit resume contract. Approval is a separate process with decisions,
assignees, comments, authorization, and auditable transitions. Duplicate or
late responses cannot resume a completed node twice. Timeouts have explicit
business outcomes.

Subsequent delivery adds webhooks, connector actions, durable waits, human forms,
approvals, subflows, bounded loops, parallel branches, and extension nodes.
Extension contributions include configuration schema, input/output schema,
variable metadata, execution handler, and effect/retry policy. They use Savia's
reviewed extension catalog and scoped services.

## Recovery

Distinguish transient failures, validation failures, revoked permissions, and
unknown remote outcomes. Successful steps are not intentionally repeated.
Native writes use deterministic operation IDs and transactional receipts.
External writes require provider idempotency or reconciliation; an interrupted
request is not evidence that its side effect failed. Neither a durable runtime
nor a local job receipt guarantees exactly-once external effects.

## Verification and rollout

Test without installing any industry solution. Cover workspace isolation,
permission revocation, publication races, pinned versions, duplicate events,
restart between write and acknowledgement, branching variables, timer recovery,
and duplicate human responses. Verify editor keyboard operation, invalid-field
feedback, empty states, and execution inspection in the browser.

Preserve existing automation definitions and history until an explicit,
idempotent migration has converted each supported rule. Release migrations
before the runtime and UI. Update product onboarding to describe Savia as a
general platform and document specialized solutions as optional packages.

## References

- https://docs.nocobase.com/workflow/triggers/collection
- https://docs.nocobase.com/workflow/advanced/variables
- https://docs.nocobase.com/workflow/advanced/revisions
- https://docs.nocobase.com/workflow/development/node
- https://docs.nocobase.com/workflow/nodes/approval
- https://developers.cloudflare.com/workflows/build/events-and-parameters/
