# Savia Flows

Owner: Savia platform team. Reviewed: 2026-10-12.

Savia Flows brings Dafthunk's visual workflow editor and execution engine into
Savia as the separate `apps/flows` project. Its session and tenant come from
Savia, and its colors follow Savia's theme. The original Studio workflows are
now the native execution mode of Flows. Savia Request remains a separate module.

The interface uses Savia's `Avenir Next`, `Helvetica Neue`, sans-serif font
stack for body text and sans-serif utilities, without downloading external fonts.
On narrow screens, navigation opens from the header and workflow properties
use an overlay with a **Back to canvas** action. The dashboard uses local
workflow/execution statistics without a standalone billing or profile service.
The optional tour has transient view state; completing it makes no profile call.

When opening Flows from Savia, only the module's navigation is shown. The editor
uses the full available width without Savia's outer sidebar or content padding.
**Back to Savia** in the top bar opens **My day** and restores Savia's navigation.
This applies on direct entry and refresh as well. Notifications and the assistant
remain available in the top bar. Modules without their own navigation, including
Savia Request, continue using the shared sidebar.

## First edition: local Miniflare

The module runs a local Worker, Workflows, SQLite Durable Objects, D1, R2, KV,
queues and the private QuickJS executor Worker. No remote bindings, AI bindings, browser rendering,
cloud email service, container deployment, cloud cron or provider credentials
are activated. Runtime outbound fetches are denied, including calls to other
loopback services. Optional external integrations and AI authoring are disabled
in the UI; their source implementations are retained for future authorized work.

The imported inventory contains 1,897 files, 526 node implementation files in
48 categories, and 24 workflow template definitions. The configured local
catalog exposes 365 node types, including six native Savia nodes. These counts measure different things: helper
and provider implementations are part of the source inventory, while the
palette follows the runtime's configured services. Importing a provider's source
does not make that provider available locally.

The editor retains typed ports, graph connections, node settings, code editing,
upload/result widgets, templates, execution controls and realtime graph
synchronization. The runtime retains branches, joins, parallel execution,
durable steps, retries, event waits and human input forms. Local resource
screens cover workflows, executions, secrets, files, databases, schemas,
datasets and queues. HTTP, form, scheduled and queue triggers use local
services. Email and messaging integrations require an authorized external
delivery mechanism before they can receive real provider traffic.

Some templates require external providers. They remain available as source
examples but cannot be executed successfully until their requirements are
implemented and explicitly authorized. Container-backed language/video nodes
are also unavailable in this Miniflare-only edition. A missing dependency is
reported as an execution error; the module does not produce simulated results.

JavaScript nodes, JSON transforms, the calculator and agent code mode use a
fresh QuickJS guest for each call. The guest receives at most 256 KiB of source,
8 MiB of script allocation, a 256 KiB stack and 2 MiB of serialized output,
with a maximum 30-second execution deadline. The executor reserves another
8 MiB of its 16 MiB total allocation budget for temporary host bridge and FFI
strings. It has no timers, Web APIs, filesystem, imports, direct network access
or Flows bindings. `console.log`, `console.warn`
and `console.error` are captured in the node output. Agent tool calls cross the
private Worker boundary as bounded JSON and can invoke only the tools selected
for that agent run. A timeout stops later tool dispatches, while a callback
already in flight may finish its side effect.
The JavaScript and JSON nodes encode their input bindings into the source, so
their scripts and serialized inputs share the 256 KiB source limit.

## Start and build

Install the workspace dependencies, then run `pnpm dev` from the repository
root. The local stack builds Flows, checks its migrations, starts it on port
8796 and gives the core API a private service binding. Savia's sidebar opens
`/savia-flows`; choose an authorized tenant there.

The root commands are `flows:build`, `flows:dev`, `flows:test`,
`flows:typecheck` and `flows:verify`. The API build is a Wrangler dry run, with
metrics disabled. It bundles files locally and does not deploy. Admin's normal
build includes the child application's assets under `flows-ui/`. Unused upstream
marketing screenshots and sample media are excluded; templates and viewers remain
available. See [SPA build performance](spa-build-performance.md) for size budgets
and startup payload measurements.

When starting the module separately, build it first. Start the core API with
`SAVIA_FLOWS_ENABLED=1` and the same `WRANGLER_REGISTRY_PATH` used by the
Flows process. `scripts/dev-api-runtime.mjs` reads the local bridge key and adds
the service only to the generated local core configuration. Connector Workers
do not receive that key. Set `SAVIA_FLOWS_PUBLIC_ORIGIN` to the loopback Admin
origin if its port differs from 5173; `pnpm dev` supplies the selected port.
The runner rejects non-loopback public origins.
The Admin development proxy preserves its public Host header. Socket ticket
CSRF checks and returned WebSocket URLs therefore use the browser's origin,
even though the API listens on a different local port.

Setting `SAVIA_FLOWS_ENABLED=0` skips Flows in the full local stack. No cloud
deployment pipeline or production service binding is enabled by this change.

## Persistence and recovery

`apps/flows/.wrangler/state/` stores the module's isolated local resources.
`apps/flows/.wrangler/local-secrets.json` stores generated bridge, encryption
and form-signing keys with file mode 0600. Both are ignored by Git. Back up
the state and keys together: replacing the encryption key makes previously
saved secrets unreadable, and replacing the form key invalidates old links.

The runner applies 69 versioned migrations before accepting normal use. Its
bootstrap endpoint is on an internal hostname, protected by a per-process
random secret and absent from the host's proxy allowlist. It records completed
migrations and safely skips them on restart.

Definitions, files and execution data are backend-owned. The browser holds
only transient view state. Local D1 execution history replaces the original
remote Analytics Engine query path and includes durable progress while a run
waits for input. Results, files and database records survive restarting the
local runtime with the same state directory. The local scheduler checks cron
expressions in UTC once per minute while the process is running.

Local D1 keeps terminal execution history for 30 days. Scheduled maintenance
removes at most 500 old completed, failed, cancelled, or exhausted records per
UTC day; idle, submitted, executing, and paused records are retained. This pass
can run while executions are paused and is skipped during maintenance mode. It
does not delete R2 execution objects.

## Native collections and triggers

Choose **Savia Collection Event** as the workflow trigger and add its matching
node. Select the node to configure its local collection, created/updated/deleted/
restored events, optional watched fields, and equality conditions against the
before or after record. Save the graph, save and enable the subscription, and
enable the workflow. The canvas shows a compact summary; the inspector contains
the complete configuration. A condition preserves the field's number, boolean,
date or select type.

The **Savia** node category includes **List Records**, **Read Record**,
**Create Record**, **Update Record** and **Delete Record**. Their collection
selectors and field forms use the current accessible Studio schema. Connect
the event output to JSON extraction/template nodes to build the data for a
native action. Connected values are read-only in the field form. Update and
delete require the record's current `_version`; an obsolete version fails
instead of overwriting another edit. Deletion uses Studio's recoverable deletion.

For example: watch `status` changes in a Requests collection, require its after
value to equal `ready`, extract `event.after`, construct the target record with
a JSON Template, and send it to Create Record in a Results collection.

Only local collections participate in this edition. Linked provider/database
collections, schema changes, notification delivery and file actions are outside
this increment. A tenant manager configures each subscription. Automatic runs
use that configuring user's current Savia access; manual actions use the
current executor. Every call reloads membership and collection/row/field
permissions. Events expose only permission-projected snapshots and changed fields.

SQLite captures lifecycle events in the same transaction as record history,
including CRUD, bundles, imports, bulk changes and local sync. System bootstrap,
schema migration and no-op writes do not start flows. Deferred delivery and
scheduled maintenance drain the durable outbox; the local controller also
checks every ten seconds. Set `SAVIA_FLOWS_CORE_ORIGIN` when the local core API
port differs from 8787. The controller accepts only uncredentialed HTTP
loopback origins and refuses redirects.

Delivery uses leases, retries with backoff, and a durable failed state after
20 attempts. Delivered events expire after 30 days; failed events remain for
diagnosis. The private event notification contains a wake-up envelope; the
host retrieves and authorizes the snapshots before the workflow sees them.
Stable execution IDs deduplicate admissions, and native mutation receipts are
committed with the record so a retry cannot repeat the write. Ancestry skips a
flow's own changes and stops chains at eight levels.

Disabling a workflow deactivates its subscription. Enabling the workflow alone
does not re-subscribe it: explicitly save and enable the subscription again.
Configuration changes establish a new cutoff, so earlier queued events do not
run retroactively. Disable stops new admissions; an already admitted run can
finish. A terminal Worker execution is recovered without rerunning nodes.
A crash during an unfinished Worker run can replay imported arbitrary side
effects; native Savia writes retain their receipt protection. Durable executions
reuse their existing workflow instance.

## Replacement for Studio workflows

The Flows catalog also lists the existing native workflows from Core. Open one
to edit its nodes and true/false/next connections, with typed properties in the
inspector. Positions, drafts and published versions live in the backend. Save
the draft and publish when ready; changing a draft preserves the active revision
and existing runs. The Studio operations entry opens this catalog with the same
tenant, so authoring has one module entry point.

Native workflows support every implemented Studio workflow capability:

- Manual, interval schedule, incoming webhook and collection created/updated/
  deleted triggers, including combined creation/update, watched fields and all/any
  filters with equality, numeric, contains and empty operators.
- Condition, transform, query, create, update, assigned task, internal
  notification, relative/absolute durable wait and outgoing JSON webhook steps.
- Typed references, bounded text concatenation and calendar-day offsets; unique
  matched creation returns an existing record without overwriting it.
- Immutable published versions, current owner authorization, transactional
  side-effect checkpoints, lease recovery, same-step manual retry and cancellation.
- Personal task inbox and notification resolution, execution outputs and delivery
  history, enabled extension bundles and schema preparation.
- Per-endpoint incoming secrets, rotation, duplicate receipt/conflict detection,
  quotas, encrypted outgoing credentials and pinned destination revisions.

The transactional runtime is `@savia/flows-native` in `apps/flows/packages/native`.
Core hosts it so record writes, receipts, tasks and notifications can commit in
one database transaction. It reads the canonical existing workflow tables in
place. There is one native scheduler; catalog adoption creates no duplicate
definition or execution. Compatibility API paths, SQL triggers, public webhook
URLs and notification dependencies use this relocated implementation.

The native mode retains Studio's workflow-manager policy. Flows' broader member
access to custom graphs does not grant access to native workflow administration.
Every private host operation checks a ten-second body-bound service token and
fresh principal/tenant access; browser input cannot select the execution identity.
Compiled and tenant-installed extension bundle availability uses the host registry.

Graph and native writes carry shared ancestry through Core, preserving the
existing native depth-five admission cap and graph depth-eight cap across mixed
chains. Core migration 0058 carries this ancestry through transaction-local
write context while keeping record-history `cause_id` equal to the native
execution ID. Previously queued runs with opaque legacy causes retain their
depth limit, but cannot recover the prior workflow identities for own-change
filtering. New writes carry the complete structured ancestry.

In the local edition the native scheduler also denies outbound delivery,
including loopback. Outgoing protocol behavior is tested with an injected local
transport. No public exposure, provider or cloud deployment is enabled.

See [General workflows](../workflows.md) for the preserved native contracts and
[replacement verification](../verification/2026-10-12-savia-flows-replacement.md)
for integration evidence and limits.

## Identity and permissions

The parent application keeps Savia access tokens. Its iframe transport
validates message origin, source, channel, request identifiers, paths and body
size. Tenant changes dispose the old channel and create a fresh frame. API
requests receive a backend-signed context with issuer/audience checks and a
maximum 60-second age. The backend mirrors the verified identity and membership;
standalone private login and organization administration are unavailable.

Active tenant members can read and execute workflows. Platform administrators
can also use the protected platform workspace (`tenant:0`). Tenant administrators,
owners and platform administrators can manage resources and edit graphs.
Savia personal API keys have no Flows scope and cannot use the private module
gateway. Flows' own local API keys protect public HTTP and queue triggers;
only administrators can manage those keys.

Editor sockets use single-use tickets that expire after 30 seconds. Upgrade
rechecks current Savia membership and workflow ownership. The backend scopes
the socket to the selected tenant and verifies management access again on
editor commands. Every command also checks the current principal, tenant and
role through a private local binding back to Savia; a revoked host role blocks
the next command. Missing or unavailable authorization fails closed. Its
verified identity lease expires within 60 seconds, also closing idle sockets;
reconnect obtains a new ticket from Savia.

Inbound Authorization, Cookie and bridge headers are removed before they
become workflow inputs or history. Uploaded HTML/PDF previews are sandboxed,
and authenticated media uses revocable Blob URLs. The module's CSP permits
same-origin resources and WebSockets plus local Blob media.

## Public forms and triggers

Public entrypoints pass through a narrowly scoped Savia proxy. HTTP and queue
requests retain only their own API-key authentication. Forms and feedback
links use the upstream signature/capability checks; the proxy never supplies
Savia session cookies or signed host identity. Private routes cannot be reached
through this public surface.

HTTP Request and HTTP Webhook flows can use the native Savia collection nodes.
Save the graph and explicitly enable the workflow from Savia to bind its
execution access to the current tenant manager. A newly created, already-enabled
workflow does not receive implicit collection authority: disable and enable it
to assign access. The trigger's **Integrate** dialog shows the saved access state.
Re-enabling replaces the binding with the current enabling user; disabling
deactivates it. The identity and its tenant stay in backend storage across restart.

A caller still needs a Flows API key for the workflow's tenant. The API key
authenticates the incoming request; the stored Savia user authorizes its native
actions. Headers, query parameters and request data cannot select that user.
Every incoming call rechecks the enabling user's current management access in
Savia, and every collection node rechecks its current row/field permissions.
Missing, revoked or unavailable authority prevents the run. Existing HTTP flows
without Savia nodes can retain their original API-key-only behavior until an
explicit identity is assigned; an assigned identity never falls back after revocation.

HTTP Request forces synchronous Worker execution; HTTP Webhook forces durable
asynchronous execution and returns an execution identifier. In the Savia edition,
both expose the raw incoming body as a Blob port. Connect **body → Blob to JSON →
Create Record data** to create a record from a JSON webhook payload. The webhook
body adapter preserves the pinned imported implementation. Authentication headers
and cookies remain excluded from node inputs and execution history.

Repeated incoming requests start independent runs. Native receipts protect a
retry within one run; they do not deduplicate repeated webhook deliveries across
different runs. Disable blocks new requests but does not cancel a run already
admitted. This remains local Miniflare behavior: no external provider delivery,
public internet exposure or outbound service is activated.

Shared form links open the standalone child form page without requiring a
Savia login. Form triggers validate submissions against their schema. Human
input links resume the specific durable run and reject duplicate submission.
An unlisted form-trigger URL is a capability: share it only with intended
submitters. The local edition makes it reachable only through the local host.

## Verification and source maintenance

`apps/flows/UPSTREAM.json` pins Dafthunk commit
`66be3083dc6c5349e150de5c9631477942399896`, file paths and hashes.
`flows:verify` checks all imported files, unchanged node implementations,
category coverage and MIT attribution. Host/runtime adapters are deliberately
separate from those node implementations. `parity.json` records coverage and
explicit external-service limits.

The verification record is
[2026-10-12-savia-flows.md](../verification/2026-10-12-savia-flows.md).
Native collection integration is covered separately in
[2026-10-12-savia-native-flows.md](../verification/2026-10-12-savia-native-flows.md).
HTTP execution authority is covered in
[2026-10-12-savia-webhook-authority.md](../verification/2026-10-12-savia-webhook-authority.md).
Local Miniflare tests exercise actual migrations, graph save/reload, synchronous
and durable execution, history, tenant isolation, secrets, binary R2 objects,
database recovery, key-protected triggers and editor sockets. Imported suites
check the broader runtime and editor behavior; provider suites use mocks and
do not establish live provider compatibility.

All Flows test suites run one worker at a time without file parallelism; the
root command runs packages sequentially. The editor build limits parallel file
operations to eight. This bounds local memory and descriptor pressure when other
development tools share the machine.

A tracked pnpm patch corrects URL-escaped workspace paths in
`@cloudflare/vitest-pool-workers@0.19.1`. It is needed for the current directory
name containing a space. Run tests through each package's local Vitest binary
or the root Flows commands so Workers tests resolve their matching peer context.

No paid provider, cloud resource or container service was activated or tested.
Native Chrome verification exercised workflow creation, save/reload, node
selection, execution and persisted history through the actual host bridge and
local Worker, plus desktop and 390-by-844 mobile layouts and theme propagation.
The host fixture uses an isolated synthetic identity; the full authenticated
Admin shell was not verified in that browser session. Replacement verification
additionally covers native node dragging, layout persistence, published execution,
task resolution, expanded step output and the mobile inspector.

## Preview release controls

The centralized `infra/pulumi` project owns preview resources and generates all
Worker manifests. `flowsEnabled` provisions the optional module;
`flowsExecutionEnabled` independently permits execution. Preview explicitly enables both flags with the restricted catalog and pilot
quotas below; production remains disabled. Keep provisioning enabled when pausing an existing deployment so that
D1, R2, KV, Queue and Durable Object state are retained. The preview API pauses
native workflows as well when Flows execution is disabled.

Preview admissions share atomic D1 limits across every organization and both
execution modes: 100 runs per UTC day, 1,000 per UTC month, two concurrent runs,
50 nodes per definition and 200 counted runtime steps per run. Tool dispatches
count toward the step limit. Repeated stable IDs do not spend another admission;
inline duplicate execution is rejected. Native waiting segments release their
concurrency slot. Reservations renew on work and expire after 20 minutes after
a hard abort. Organization credit bypasses cannot bypass these limits.
Cloud execution requires explicit, valid settings and all five quota bounds.
The restricted catalog's `LOCAL_ONLY` flag does not relax cloud quotas.
The shared pause control is persisted in D1 and checked atomically before work.
Each rendered deployment receives `SAVIA_FLOWS_POLICY_GENERATION`; an older
generation cannot clear a newer pause, and a pause wins within the same
generation. Re-render the manifest before deliberately resuming execution.
The local launcher assigns a fresh generation on each restart.
Native jobs paused during admission or a step remain queued for resumption.

These quotas bound activity; they are not a guaranteed Cloudflare invoice cap.
CPU, durable step retries, storage and account-wide allowances still affect
billing. Preview has no AI, Browser Rendering, container, outbound email,
Analytics Engine or Dynamic Worker binding. Global public `fetch` is denied
unless explicitly enabled in a different configuration, including requests
made by stored graphs and code tools. Private Savia and QuickJS bindings remain
available. Native outbound webhooks are denied by the host runtime too.

The preview pipeline validates stable bridge, JWT, encryption and form keys
before mutation. Existing releases enter maintenance, drain work, snapshot
Durable Object databases and back up all D1/R2 persistence before migrations.
Only AES-256-GCM encrypted archives are retained as seven-day GitHub artifacts;
keep `SAVIA_FLOWS_BACKUP_KEY` in a separate secure store. The shared QuickJS
executor is published before the final Flows Worker and API binding. A failed
backup leaves maintenance in place, so an operator must deliberately recover or
resume the deployment. Preview activation is managed through the committed
Pulumi configuration and the release pipeline.

See [Flows backup and restore](../runbooks/flows-backup-restore.md). Recovery
checks the account, isolated resource names, metadata and every file hash.
Durable Object page checkpoints let an interrupted import resume without
duplicating rows. Version-2 runtime snapshots cover DatabaseDO, MailboxDO,
WorkflowAgent, AgentRunner, and EmailAgentRunner, including SQL generation/run
history and typed Durable Object KV. Logical names are registered before agent
creation so deleting a workflow definition does not hide its persisted object.
SQL blobs, foreign-key relationships and AUTOINCREMENT high-water values survive
recovery. SQL virtual tables and encoded pages larger than 512 KiB
fail backup explicitly rather than produce incomplete snapshots. Restoring
Cloudflare Workflow continuations, pending Queue messages or advisory KV cache
values is outside the archive format; running instances and queues remain in
the existing environment during a maintenance release. Queue-trigger messages
retry five times with progressive delay before Cloudflare moves them to the
environment-specific Flows dead-letter queue. The dead-letter queue and its
messages are retained for up to 14 days and are not part of the recovery
archive; operators must inspect and deliberately replay or discard them before
they expire. Recovery stays paused and does not automatically replay side
effects.

See the [preview readiness verification](../verification/2026-10-12-flows-preview-readiness.md)
for the completed local checks and compiler memory budgets.

`flows:test` builds its own child UI assets and runs Miniflare tests serially.
`flows:typecheck` also runs one workspace package at a time.
Container Node suites run separately after the Worker suites in the API test
command; they are not loaded inside Miniflare.

## Imported-code safeguards

JSON merging writes own properties without changing object prototypes. Search
snippets cannot retain HTML delimiters, generated SVG attributes are escaped,
and Discord application IDs are encoded as path/query values. Text, field-name,
color, and reply-prefix normalization scan input linearly. Parquet queries are
quoted as a complete shell argument rather than interpolated into double quotes.

If a later authorized rollout enables the FFmpeg container, configure its
`TRUSTED_MEDIA_ORIGINS` with a comma-separated list of exact HTTP(S) origins,
including any nondefault port. Entries cannot include credentials, paths, query,
or fragments. Downloads fail closed when it is unset and reject redirects.
FFmpeg and ffprobe accept local direct-media files through restricted protocol
and demuxer lists. Playlist inputs such as HLS, DASH, and concat are rejected,
so nested URLs cannot bypass the download origin policy.
Containers and external services remain disabled in this preview release.

## Cost controls

The first cloud edition retains the restricted service catalog and QuickJS
executor. Enabling the module does not enable AI providers, Browser Rendering,
containers, public network fetch, Dynamic Workers, or outbound email. Existing
preview admission limits remain 100 daily runs, 1,000 monthly runs and two
concurrent runs, shared across tenants and both execution modes. They are pilot
quotas, not capacity sized for 100 active users or an exact invoice cap.

Organization managers can inspect **Execution budget** on the Flows dashboard.
It shows their organization's admitted runs and counted steps for those runs, shared
remaining daily/monthly capacity, and active runs. The panel refreshes once per
minute while visible and warns at 80% and 100% of shared quotas. These counters
are operational measurements; they do not claim to measure Cloudflare CPU,
GB-seconds, storage or dollar charges. No external notification service is used.

### Collection triggers

Use watched fields and before/after conditions to avoid unrelated runs. The
trigger inspector's **Delivery mode** defaults to one run per matching change.
**Group changes for one minute** opts into durable batches of at most 50 events;
use the trigger node's `events` array and `eventCount` output to process every record.
The existing `event` output remains the first event. A batch may split further
when projected trigger data reaches 1 MiB. Grouping is not a suppression mode:
each permitted matching event is included in a run, rather than silently being
replaced by the last record. Receipts are grouped by UTC minute. Dispatch starts after the first event has
waited sixty seconds, on the next cron tick; a backlog can delay it further.

Each cron tick dispatches at most one due group. Event receipts keep only bounded
routing metadata (16 KiB maximum), not duplicate record snapshots. The host
reprojects each event using the configuring user's current access, and Flows
rechecks the current subscription and workflow before dispatch. Child execution
IDs are frozen before submission so a crash or permission change cannot regroup
already-submitted events under a new execution ID. Recursion depth and the union
of causal workflow IDs are preserved across the batch.

The retained pending/failed backlog is bounded to 5,000 events per organization.
An admission at capacity returns backpressure to the host outbox. Transient
failures use exponential backoff and stop after five attempts; the inspector
shows stopped batches and lets managers retry them in pages of at most 250 groups.
Expected execution pauses and daily/monthly/concurrency quota exhaustion do not
spend transient retry attempts. Reconfiguring or disabling the subscription
skips its old pending groups. Host event snapshots expire after their existing
30-day retention; an event no longer available for authorization is skipped.

### Memory and payload bounds

Workflow definition, trigger and overrides together are limited to 2 MiB of JSON;
node inputs and JSON outputs each have a 2 MiB limit. Retained input/output state
is capped at 4 MiB across the execution, with overflow recorded as a node error.
Even local execution with admission quotas disabled cannot exceed 500 nodes.
Cloud preview retains the stricter 50-node definition quota.

The API rejects request bodies above 9 MiB before parsing JSON.
Stored objects are limited to 8 MiB each. Multipart requests are streamed under a
9 MiB cap before parsing. Each node can read or write at most 8 MiB of aggregate
binary data and 32 binary values; repeated parameters have at most 256 values.
Known oversized binary outputs are rejected before any storage write, and binary
conversions run sequentially to prevent parallel memory spikes. A sequential
read may allocate one additional bounded object before detecting that the
aggregate read limit is exceeded. Use file references or smaller batches instead
of copying large payloads through many nodes. Direct presigned uploads are not a
hard upstream upload-size cap; they are rejected on read through the object
store. The restricted cloud deployment does not configure public presigned R2
upload credentials.

### Retry and retention policy

Durable step retries remain three with exponential backoff; explicit runtime
resource/step limits are not retried. Cloud queue deliveries use five retries
with a 60-second exponential delay capped at one hour. A provisioned, isolated
dead-letter queue preserves failed deliveries for operator investigation under
Cloudflare's finite queue retention. Execution cannot be enabled from an old
manifest without the dead-letter queue. Queue execution IDs are stable per
message and workflow, so earlier successful work is deduplicated on redelivery.

In the restricted edition, terminal D1 history is eligible after 30 days without
updates, with a maximum of 500 deletions per UTC day. Active and waiting records
are retained. Finished event receipts are kept for at least 90 days after settlement.
Completed quota ledger rows are eligible 90 days after admission. Both are
cleaned in bounded daily passes. Cleanup runs while execution is paused and stops
during maintenance/backups. Durable Workflows retain the provider's existing
instance retention, and definition objects, datasets and user files are not
expired without an authoritative reference ledger. Encrypted recovery archives
already use seven-day GitHub artifact retention; promotion evidence uses 30 days.

Start with the pilot quotas, review a week of admitted runs, steps and the actual
Cloudflare account metrics, then size quotas to the observed workload. Increasing
quotas or activating execution remains an infrastructure change; this update
does not enable Flows in preview.
