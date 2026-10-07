# Operations: Nango + WhatsApp messaging per tenant

Owner: platform administrator. Review date: 2026-11-05.

## Scope and ownership

- One WhatsApp connection belongs to one tenant and one user. Savia stores
  the tenant binding, the opaque Nango connection id, and phone metadata
  (`phone_number_id`, `display_phone_number`, `waba_id`) in
  `tenant_whatsapp_connections`. Nango stores the Meta system-user token;
  Savia never receives the token. It is entered directly in Nango's hosted
  Connect form and never appears in Savia responses or logs.
- WhatsApp messaging is independent of CRM connections: a tenant can hold
  both a CRM connection and a WhatsApp connection at the same time.
- Outbound calls go through the Nango proxy allowlist only
  (`apps/api/src/whatsapp/nango.ts`): `GET /v21.0/...` reads and
  `POST /v21.0/<phone_number_id>/messages` sends and
  `POST /v21.0/<phone_number_id>/media` uploads. Verified media downloads
  allow only the Meta attachment host `lookaside.fbsbx.com`, without redirects. Any other provider path
  is rejected with `WHATSAPP_UNAVAILABLE`.
- Incoming text, native interactions, attachments and delivery receipts can arrive directly from Meta at
  `/webhooks/whatsapp`. Nango remains the outbound credential transport;
  Chatwoot is optional and is not part of the direct assistant flow.
- The gateway's Wrangler asset configuration routes the exact
  `/webhooks/whatsapp` path through the Worker before the SPA fallback in local,
  preview and production deployments. Keep this entry in both the checked-in
  `apps/admin/wrangler.jsonc` and generated deployment configs; otherwise Meta
  verification requests and webhook events can receive the admin app instead
  of reaching the API.

## Nango preparation (browser handoff)

Create the `whatsapp-business` integration in the intended Nango environment
and obtain a Meta system-user token with WhatsApp management and messaging
permissions for the business portfolio that owns the sender. Keep account
identifiers and rollout inventories in private deployment notes.
Select **API Key** auth: there are no credentials
to configure at integration level. Enter the Meta token in the **API Key**
field when creating each connection through Nango Connect. See the
[Nango WhatsApp Business setup guide](https://nango.dev/docs/api-integrations/whatsapp-business).
Then set the backend variables without adding
them to the repository, `wrangler.jsonc`, or `VITE_*` settings:

```text
NANGO_BASE_URL=https://<host-api-nango>
NANGO_CONNECT_URL=https://<host-connect-nango>
NANGO_WHATSAPP_INTEGRATION_ID=whatsapp-business
NANGO_API_KEY=<server-side-nango-secret>
WHATSAPP_META_APP_SECRET=<meta-app-secret-for-signature-verification>
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<random-subscription-verification-token>
```

Use `wrangler secret put NANGO_API_KEY` for the server key. Production and
preview render `NANGO_WHATSAPP_INTEGRATION_ID=whatsapp-business` by default;
self-hosted reads it from `infra/secrets` via `infra/self-hosted/env.example`.

The current renderer uses `https://nango.cloud.hefesoft.com` for the API and
`https://nango-connect.cloud.hefesoft.com` for Connect. The server API key
selects the Nango environment; verify that it belongs to the environment
containing the integration. Creating the integration in the dashboard does
not deploy the WhatsApp code or update an existing Worker's configuration.

Dashboard test connections are for diagnostics. Create actual tenant
connections through Savia so Nango records the expected end-user identity.

The `NANGO_API_KEY` stays a Worker secret and needs these environment scopes:

| Scope                                | Operation                                          |
| ------------------------------------ | -------------------------------------------------- |
| `environment:connect_sessions:write` | Create Connect and reconnect sessions              |
| `environment:connections:read`       | Verify connection ownership and tenant tags        |
| `environment:connections:delete`     | Disconnect the tenant's connection                 |
| `environment:proxy`                  | Validate the sender and send messages through Meta |

See the [Nango API key scopes reference](https://nango.dev/docs/reference/backend/http-api/api-keys).
Savia does not read Meta credentials directly, so WhatsApp does not require
`environment:connections:read_credentials`. A shared key used by other Savia
integrations may need additional scopes. Local development forwards every
`NANGO_*` variable automatically.

## Tenant connection flow

Every mutation requires an explicit `agencyId` naming the selected tenant.
Membership alone never selects a tenant implicitly, and a platform role does
not make the first active tenant a default. Keep each tenant's connection
separate; sharing a test phone does not mean sharing a Nango connection id.

1. A user with an active tenant membership opens
   `#/my-integrations?tab=whatsapp` (WhatsApp row, brand logo).
2. **Conectar** creates a short-lived Nango Connect session for that tenant.
   The browser receives only the session token and the public Nango URLs.
3. The user authorizes the `whatsapp-business` integration in Nango with the
   Meta system-user token prepared by the platform administrator.
4. Nango returns an opaque connection id. After completion, the user fills
   the phone number id, visible number, and WABA id in the **Número de
   WhatsApp** panel of the **Conexión** tab. The completion API can also accept this metadata when
   it is already available.
5. Savia verifies the Nango connection belongs to `user:<principal-id>` and
   its `agency_id` tag matches the explicitly selected tenant. Missing or
   mismatched tenant tags are rejected; dashboard diagnostic connections
   cannot substitute for tenant Connect sessions. Savia then validates the
   phone number live against the WhatsApp Cloud API through
   the proxy, and persists only safe metadata with status `connected`.
6. **Probar envío** (in the **Conexión** tab) sends a short free-form text through
   `POST /v21.0/<phone_number_id>/messages`. Destination numbers may include
   whitespace for readability; Savia removes whitespace before validating and
   sending the number. The plus sign and digits are preserved, and other
   characters are rejected. Delivery outside an open 24-hour customer-service
   window requires a pre-approved template, which this endpoint does not send.
   A successful API response confirms Meta accepted the request, not that the
   message was delivered; asynchronous delivery failures are not surfaced
   without inbound webhook handling.

**Reconectar** uses Nango's reconnect session endpoint with the existing
connection and integration IDs, preserving the tenant binding. Authentication
failures during sender validation mark that existing connection as requiring
reconnection. Invalid phone IDs, temporary upstream errors, and rejected
replacement connections do not invalidate an existing healthy connection.

## Verification after deployment

### Direct assistant pilot

1. Apply `0040_whatsapp_assistant.sql` before serving the updated API. The
   PostgreSQL source projection and core schema contain the same persistence.
2. Set `WHATSAPP_META_APP_SECRET` and `WHATSAPP_WEBHOOK_VERIFY_TOKEN` as backend
   secrets in the intended environment. The first is the app secret, not the
   Meta system-user messaging token held by Nango. Missing secrets keep the
   webhook unavailable and prevent enabling automatic replies. Repository deployment
   workflows read the same two secret names from their GitHub deployment environment
   (`preview` or `production`) and upload the pair only to the API worker. Configure
   both together; neither is required for deployments without this integration, but
   an incomplete pair is rejected. Values never belong in tracked configuration.
   Preview and production credentials are configured independently.
3. Create an active virtual employee in the intended tenant with its prompt and
   optional reference documents. Use the tenant's default model or a model
   explicitly enabled by its administrator. External contacts receive plain-text
   answers without MCP tools, user credentials or administrative actions.
4. Open **My integrations → WhatsApp**, then the **Asistente IA** tab. Select the
   employee, enter pilot contacts with country codes (one per line), enable
   **Responder con IA**, and save. An empty contact list never means everyone.
   Authenticated `GET` and `PUT /v1/whatsapp/assistant` require an explicit
   `agencyId` and a tenant administrator; personal API keys cannot manage it.
5. Verify the public endpoint's GET challenge and rejection of unsigned POSTs
   before changing Meta's callback. Set the callback to
   `https://<deployment-host>/webhooks/whatsapp` and subscribe to `messages`.
   Moving an existing callback from Chatwoot routes new events to Savia instead.
   Keep the previous URL in private deployment notes for rollback.
6. From an allowed contact, send a new text to the connected sender. Confirm
   one reply, then ask a follow-up that uses earlier conversation context.
   Replay the same event and confirm that it produces no second send. Verify
   a disallowed contact and another tenant cannot trigger this assistant.

Routing requires exactly one enabled binding for the registered phone-number
ID and WABA ID, an active tenant and connection owner membership, and an active
employee belonging to that tenant. Shared senders with ambiguous enabled
bindings fail closed. Other tenants do not inherit the pilot configuration.

Pending messages retain the employee and connection owner that accepted them.
Changing either identity before processing makes those messages fail closed;
legacy queued rows without an acceptance identity are also rejected. History is
scoped to the tenant connection, contact, phone-number ID, WABA ID, and assistant
identity so sender replacements and employee reassignment cannot reuse old
conversation context. Native manual sends also retain the sender and assistant
identity with their idempotency record; a changed identity cannot return an old
success receipt. Reply windows use only inbound events for the currently connected
phone-number ID and WABA ID. Apply `0043_whatsapp_inbox_binding_snapshot.sql`
before serving these identity fences.
Assistant controls remain visible for the selected tenant when its connection is
disconnected or requires reconnection, so administrators can disable an existing
binding before reconnecting. Sending and enabling still require a healthy sender.

The webhook checks `X-Hub-Signature-256` against the raw body and durably stores
accepted messages before acknowledging them, including validated native payloads.
Unsupported event types are ignored. Incoming message IDs deduplicate retries.
Managed preview and production deployments set `WHATSAPP_PROCESSING_MODE=events`
and bind `WHATSAPP_DISPATCHER` to the `WhatsappDispatcher` Durable Object. After
persistence, the webhook awaits a short wake request before acknowledging Meta;
it never runs AI or provider jobs in HTTP `waitUntil`. If a wake fails, it returns 503. A redelivered message resolves its existing inbox row and repairs the wake
without inserting or sending twice. Receipt-only callbacks do not wake processors.

Each connection/contact pair has a coordinator named by a SHA-256 digest of its
scope. Its storage contains only scope, wake revision, retry metadata and an
alarm; messages, encrypted drafts, actions and results remain in D1. Duplicate
wakes coalesce into the earliest alarm. One alarm delivers at most one existing result per delivery pass, then processes at most one inbound
message or one confirmed action, prioritizing already queued actions over new
inputs to prevent starvation. A confirmation acknowledgement is sent before
its queued action can run in the next alarm; settled action results are delivered
immediately afterward.
New confirmations or remaining messages schedule another alarm without waiting
for a cron tick. Separate conversations have separate coordinators.

After processing, the coordinator schedules the oldest inbound retry, active
lease expiry, queued action or pending delivery. When no unfinished work remains,
it removes the alarm. Wakes arriving during processing are fenced by a durable
revision so they cannot be erased by completion. A watchdog is stored before
external work; failures leave a durable retry with backoff. Alarms may execute
more than once, so existing atomic claims, reply fences and uncertain-send rules
remain required. Due rows that cannot currently progress back off for a minute
rather than spinning.

The shared cron still runs each minute for other platform functions. In event
mode, WhatsApp retention/media maintenance and recovery run only on five-minute
boundaries. Recovery finds unfinished conversation scopes and wakes coordinators
with bounded request concurrency; it does not execute AI itself. Apply migration
`0050_whatsapp_dispatch_indexes.sql` before enabling events. Deployment config
adds Durable Object migration `v2` while preserving `RealtimeHub` migration `v1`.
To roll back, set `WHATSAPP_PROCESSING_MODE=scheduled`: existing alarms stop
processing and the minute cron resumes inbox draining and action execution. An
events deployment without its dispatcher binding fails closed rather than
silently using short-lived HTTP processing. Self-hosted runtimes without Durable
Objects should retain scheduled mode. Legacy inline mode remains available only
when the processing-mode setting is omitted.

Latency diagnostics emit `whatsapp_inbound_claimed` with `queue_wait_ms` and
`whatsapp_inbound_timing` for preparation, indicators, generation, transport, acknowledgement persistence and
total processing. `whatsapp_action_result_timing` records result-send,
acknowledgement-persistence and history-repair duration/outcome. The
`whatsapp_quote_lifecycle_reset` event reports whether the generation reset was
applied or skipped, including after history repair. These events correlate by
action or message ID, generation and selection revision; they do not include
phone numbers, message bodies, drafts, applicant data, raw errors or credentials.
`whatsapp_assistant_timing` separates configuration,
capability setup, input preparation, knowledge retrieval and model/tool work.
`whatsapp_operation` records start and terminal outcomes for each named tool,
quote-catalog preflight, action preparation and typed backend request; failed
HTTP responses include only status codes. A per-operation `call_id` disambiguates
concurrent or repeated calls. `whatsapp_model_call` isolates each model invocation
from tool execution and reports response duration, token counts when supplied by
the provider, and bounded failure categories (including timeout/abort).
`whatsapp_action_prepared` and `whatsapp_action_confirmation` connect inbound
message IDs to the resulting action ID without logging confirmation codes.
Filter by `message_id` for intake and model/tool latency, then use `action_id` to
follow dispatch, delivery and reset. A start event without a terminal event can
indicate a process interruption; it is not evidence of successful execution.
These events carry operational IDs and durations, without phone numbers, message
bodies, drafts, raw errors or credentials. Existing action-started and action-finished events
measure confirmed-operation queue waits and execution durations. Queue wait is
measured from server acceptance; provider-to-server latency can be compared using
the inbox's `provider_timestamp` and `received_at`. Event admission removes the
normal minute-tick wait; model, media, provider and DB time still contribute to
latency. Alarm scheduling does not establish a fixed response-time SLA.

Individual batches retain the bounded media and model timeouts, leaving room
inside the alarm or scheduled Worker lifetime. Overlapping retries retain atomic message
claims and per-contact leases. Leases serialize each
contact's conversation and fence stale processors. A four-minute processing
lease accommodates media transcription followed by AI completion. Generation retries are
bounded; after the final generation failure, a safe recovery message follows the
same access checks and durable send path. Replies use a natural, concise tone,
avoid repeated greetings and generic service lists, and stay transparent about
the virtual assistant identity. Failed consultations or operations explain the
problem and ask the user to contact an advisor directly, without inventing contact
details or claiming a handoff occurred. Tenant administrators can set the optional
**Contacto de atención humana** field in WhatsApp task-menu settings to a phone
number or HTTPS support link. The backend validates and stores it in the scoped
channel configuration; leaving it empty retains the generic advisor message.
Changing only this contact preserves selected employees, open menus and pending
or queued operations. Routing and access configuration changes retain their
existing invalidation behavior.
Employees use the current contact when explaining failures, and exhausted
completion recovery uses the same configured destination before authorized
dispatch. Tool failures never expose provider
credentials. City reference lookups use the authenticated `/api/lookups/dane`
route, including for tenant administrators without platform roles. The quote
assistant uses verified enabled products and prepares the validated draft before
requesting data-processing consent. Explicit `AUTORIZO` continues from the
server-validated authorized snapshot rather than model-generated input; any
subsequent quote-field change requires renewed consent. The resulting operation
still requires the separate server-issued confirmation before insurer execution.
Quote confirmations show a concise Spanish summary with formatted COP amounts,
the applicant's contact details and the number of enabled products. Provider
codes, raw JSON and the expanded product catalog stay out of the customer message;
the complete validated payload remains encrypted in the prepared operation.
Text confirmation commands are case-insensitive. A bare `Confirmar` or
`Confirmo` returns server-authored guidance to use the issued button or code;
it does not approve an operation or invoke the model. Expired quote confirmations
require a new preview. The server adds the virtual employee identity once and
removes repeated copies of that exact leading header from assistant history
and generated replies.
Sending is recorded before calling Meta, and an uncertain send is
terminal rather than automatically repeated.

`whatsapp_inbox` stores contact-specific history, saved replies, outbound message
IDs, processing failures and delivery status. `whatsapp_delivery_receipts`
preserves receipts arriving before the send response, and monotonic updates
prevent delayed events from downgrading delivered/read messages. Check these
records using tenant-scoped operational queries; do not export private message
content or credentials to logs or public handoffs.

Disable **Responder con IA** (in the **Asistente IA** tab) to stop the pilot without disconnecting Nango.
Automatic free-form replies require a recent inbound message; expired pending
messages do not trigger a send. Native capabilities are configured separately
for each tenant; the existing text behavior remains available with all flags off.

### Native messages and account resources

Use the native WhatsApp panel in the **Avanzado** tab of
**My integrations → WhatsApp** after assigning an assistant and enabling the
connection for explicitly allowed pilot contacts. Enable reply buttons (up to
three choices), lists (up to ten options), read receipts, typing indication and
attachment understanding individually. Meta combines typing indication with a
read receipt; enabling typing also enables read receipts. Button and list selections preserve
the option ID, title and reply context in the durable inbox. Locations, static
Flow completions and catalog order requests become conversation context;
these messages never authorize transactions or administrative operations.

Register resources by a stable tenant key and label. The assistant receives
those keys, rather than permission to invent provider IDs or arbitrary URLs:

- **Flows:** create and publish a static Flow in WhatsApp Manager, then register
  its Flow ID and initial screen. Resource discovery lists published Flows for
  the connected WABA and excludes Flows configured with a data-exchange endpoint.
  Completion data returns through the signed message
  webhook. Encrypted dynamic data-exchange endpoints are not part of this path.
- **Catalog:** attach a catalog to the WABA in Commerce Manager and register
  the catalog ID and permitted product retailer IDs. Catalog messages show
  selected products; inbound orders remain requests requiring a separate
  authorized checkout implementation.
- **Templates:** create and obtain approval for a template in Meta, then
  register its name, language and body parameter count. Current sending
  supports BODY and FOOTER components with positional body parameters. Named
  placeholders and dynamic footer parameters are not supported. Administrators can send a configured
  template with confirmed recipient consent outside the 24-hour reply window;
  automatic AI replies cannot send templates.
- **Media:** upload a supported file through the native panel, then register
  its returned media ID and type. The assistant can send configured images,
  documents, audio and video. Refresh expired provider media IDs as necessary.
- **Locations:** register coordinates and optional name/address. Contacts can
  also share locations with the assistant.

Manual native sends use a unique idempotency key. Free-form native messages
require a recent inbound message from the allowed contact. A repeated key with
an uncertain send outcome never sends again automatically. Meta acceptance is
not a delivery guarantee; inspect delivery receipts before deciding to retry.

### Incoming attachments

Attachment understanding is opt-in per tenant. The server verifies metadata,
exact download host, SHA-256 checksum, MIME signature and an 8 MiB size limit.
Files remain in private tenant-scoped R2 keys under `whatsapp/inbound/`; scheduled
cleanup removes files older than seven days, including after webhook secrets
are removed. Rendered preview/production configs supply the minute schedule.
No public attachment URL is
created. Images and PDFs require a compatible configured AI model. Plain text
is included as untrusted context; audio uses the existing transcription
configuration. Unsupported analysis formats, including video and DOCX, are
acknowledged without claiming to inspect their contents. Outbound transport
can still send a configured video. The default text-only model does not gain
vision simply by enabling this setting.

### Optional vehicle insurance intake

The existing `insurance.quotes` plugin supplies a downloadable static WhatsApp
Flow for light vehicle and applicant data. Publish that JSON in Meta and register
its ID as a tenant resource. The contribution validates canonical quote inputs
and consent, but does not call insurers. Conversational quote execution uses the
installed plugin and its `insurance-auto-light` Savia Request bundle with tenant
credentials, configured products and deterministic authorization. See
[Insurance quoting](../insurance-quoting.md).

### Task menu and virtual employee channel

Apply migrations `0044` through `0047` (and their PostgreSQL equivalents) before
using the channel. In the WhatsApp integration settings, enable task routing and
publish existing active tenant employees with customer-facing labels such as
**Consultar seguros** or **Consultar clientes**. Set each task's audience to
customers, staff, or both. The menu contains task labels; replies identify the
selected employee as a virtual assistant. Lists paginate in groups of nine;
clients without native lists receive numbered text choices.

`menú`, `menu`, `inicio`, and `cambiar asistente` are exact, case-insensitive
navigation commands. They clear the current selection and pending approvals.
An exact `@handle` selects only a currently published employee visible to that
contact. A consumed action continues after navigation, and its result names the
originating employee. Task histories and encrypted drafts are isolated by
contact, access generation, and employee. A configured default task applies to
new conversations; otherwise a sole visible task is selected automatically.

The existing pilot contact allowlist controls admission only. Configure a
separate staff-number registry using international numbers with country codes.
Active registered numbers are internal; other admitted numbers are customers.
Link a staff number to an active tenant member to use that person's live tenant
permissions and personal integrations. Unlinked staff receive only explicitly
published customer-safe insurance operations; they never inherit the connection
owner's personal accounts. Revoked membership blocks access. Access changes
rotate the contact generation, invalidating earlier histories, drafts and
approvals even if an earlier configuration is restored. Task publication changes
invalidate selections and in-flight menus.

The channel exposes supported typed reads and prepared actions: scoped Studio
records, the linked member's personal files/mail/calendar, authorized domain
reads, and installed insurance operations. An employee with no collection grants
remains conversational. Arbitrary model-generated HTTP calls and unpublished
commands are unavailable. Customers cannot query arbitrary Studio collections
or personal accounts; quote summaries are limited to their own channel results.

Mutations require a server-issued preview followed by a contact-bound button or
exact `CONFIRMAR <code>` response. Codes expire after five minutes, have bounded
attempts and are stored as hashes; delivery audit payloads redact codes. Action
inputs and drafts are encrypted using the backend `SAVIA_MCP_SHARED_SECRET`.
Without that secret the channel cannot prepare writes. Keep it stable across
restarts, or existing sealed actions and drafts become unreadable.

The event dispatcher executes confirmed jobs outside the AI completion request;
scheduled mode retains the minute scheduler.
Atomic claims and per-product dispatch evidence prevent automatic replay after
an uncertain outcome. Operators must reconcile **uncertain** results against
saved records and provider evidence before asking for a fresh action. Results
are sent only while the Meta 24-hour reply window and current access permit it;
a later menu selection does not change their originating identity. Verified
priced offers remain visible in partial-result messages, alongside counts of
unverified and unpriced responses and relevant persistence warnings. A result
send acknowledged by Meta is added to the originating employee's scoped history
for follow-up questions. An uncertain send is not added as delivered history and
is not automatically retried.

An acknowledged send whose history write failed uses delivery state
`history_pending`. The next dispatcher or scheduler run repairs only its stored history;
it does not send again. The outbound message ID and exact sent text remain
recorded with the action. History repair is conditional on the unchanged result
and delivery state, so a concurrent conversation reset cannot recreate scrubbed
history. Result sends claim a 60-second lease; an interrupted or expired sending
claim is classified as uncertain and never automatically resent. Permanently
revoked deliveries become terminal. Expired deliveries remain dormant until a
valid inbound opens a new reply window, then resume through the same access checks;
neither state keeps the coordinator awake. Failures before attempting a send can retry normally.

Confirmed quotes report product results incrementally. Each provider outcome is
persisted in `whatsapp_channel_action_progress` before delivery. The channel groups
results arriving within a 300 ms window into messages of at most 4096 characters,
with one active progress sender per action. Provider calls do not wait for the
WhatsApp send. Each update identifies the quote and product, reports a verified
premium and quote number when present, and distinguishes unpriced or unverified
responses. It never declares a winning offer before the final comparison.

The progress outbox is shared channel infrastructure; insurance supplies its
typed product events and text. An `(action_id,event_key)` constraint deduplicates
events. Delivery revalidates the contact generation, selected task and reply
window. A pre-send failure retries after 30 seconds; an ambiguous send or a
15-second send timeout becomes uncertain and is not blindly replayed. Known
acknowledgements with a failed history write repair history without another send.
The coordinator also recovers unfinished progress from the DB. The final summary
and menu wait until earlier progress deliveries are resolved. Progress messages
do not clear the draft or change the selected task. Incremental delivery exposes
received results sooner; it does not fix provider responses without a premium.

After a quote-auto operation ends in a terminal completed, failed, or uncertain
result, an acknowledged result message includes the main task menu and starts a
fresh contact generation. A terminal quote preparation or catalog failure that
is acknowledged follows the same lifecycle, as does an exhausted model-generation
failure for a quote flow. The current draft, employee selection, buffered input
and reset challenge are cleared only after the acknowledgement is durable; an
uncertain outbound send does not reset the conversation. For a terminal inbound
quote failure, the prepared reset and inbox completion commit in the same database
transaction, so a later history write failure cannot leave the old draft active. Prior conversational
history remains in its original generation and is excluded from the new
conversation. A `history_pending` repair performs the same reset without sending
the message again. The quote, action, dispatch and audit records remain in their
originating generation for follow-up by an operator, while the new conversation
starts with no selected employee or prior quote context.

An explicit request for a new quote, such as `Hagamos una nueva` or
`Nueva cotización`, follows the same acknowledged reset path while a quote task
is selected. The server returns the task menu directly, without asking the model
to claim that the draft was cleared. A queued or executing action, or a terminal
result still awaiting delivery, blocks this reset. The contact must wait for that
result before starting a new cycle. Starting a new cycle preserves domain quote
and audit records; it does not erase customer records.

An unreferenced quote summary is limited to the selected employee and current
contact generation, including for staff contacts. An authorized staff contact can
request a historical quote by its explicit reference. External contacts remain
limited to their own current channel results even when supplying a reference.

WhatsApp quote execution uses a 15-second limit for each backend request and a
90-second execution budget. The confirmed product list is checked against the
current catalog inside that budget, before any quote write or provider dispatch;
there is no separate unbounded catalog preflight. A local deadline settles the operation even if the
underlying backend ignores cancellation. Available offers are retained when a
provider exceeds its deadline; a dispatched request with an unverified outcome
is classified as uncertain and is never automatically resent. Products not
dispatched before the global deadline are reported separately. Late provider
responses cannot overwrite the returned summary or trigger another dispatch.
If a dispatch-claim write commits after its deadline, its evidence is retained
even though this execution does not call the provider. Reconciliation requires
checking the saved history; the claim is not deleted or automatically replayed.
The existing six-minute action lease remains interruption recovery, rather than
the normal deadline for completing a quote. Interactive quote execution outside
WhatsApp retains its existing request behavior.

Contacts can request a fresh conversation with the exact command
`Borrar mis datos y empezar de nuevo`. The server returns a contact-bound,
five-minute confirmation code: `BORRAR <code>`. A bare `Sí` does not confirm;
`CANCELAR BORRADO` or returning to the main menu cancels the request. Five wrong
attempts invalidate the code. These controls run before the model or its tools,
and only a hash of the code is persisted.

A confirmed reset rotates the contact generation, clears all task drafts,
selections and assistant history for that contact on the connection, removes
unexecuted approvals, and scrubs earlier inbox text, payloads and routing
snapshots. Newer accepted messages survive the reset. Pending result-history
repairs are revoked and their cached conversation text is removed. Reset is
blocked while a confirmed operation is queued, dispatching, or sending a result.
Executed actions, dispatch evidence, resource ownership and domain quote records
remain stored; they are not automatically exposed in the fresh generation. This
is a conversation reset, not full erasure of customer or policy records, and it
does not delete messages from the contact's WhatsApp app.

History, resolved action records and inactive drafts use a 30-day channel
retention window. Uncertain or active dispatch evidence survives cleanup;
resource ownership survives history cleanup. Tenant/connection deletion cascades
channel data. Domain quote records follow the domain's own lifecycle.

For a local pilot, run `whatsapp-insurance.test.ts` and
`whatsapp-general-actions.test.ts`: external providers are simulated, ownership
is linked before quoting, and linked staff actions use their own identity. The
existing signed-webhook suites verify admission and transport separately.
Deployment, Meta sends, and real insurer executions require a separately
authorized live pilot with the installed solution and enabled products.

### Existing connection checks

1. With `NANGO_WHATSAPP_INTEGRATION_ID` unset, confirm the WhatsApp tab shows
   **No disponible** and `POST /v1/whatsapp/connections/connect-session`
   returns `503`.
2. Sign in as a tenant administrator, connect, link the number, and send a
   test message to a contact with an open window. Confirm the row shows
   **Conectado** with the visible number and no secret in the UI.
3. Repeat the list query with another tenant and confirm `403`; confirm a
   second tenant cannot reuse the first tenant's Nango connection (`409`).
4. Disconnect and confirm a later send returns `404`.

## Safe diagnostics

- `WHATSAPP_UNAVAILABLE`: check the four Nango variables without printing
  their values.
- `WHATSAPP_RECONNECT_REQUIRED` / `409`: the Meta token was rejected or
  revoked. Ask the tenant administrator to use **Reconectar**; never paste a
  token manually to repair the link.
- `WHATSAPP_SEND_FAILED` / `NANGO_REQUEST_FAILED`: check Nango status,
  DNS/TLS, and the redacted Nango logs. Never copy provider response bodies
  into logs or user feedback.
- `WHATSAPP_NUMBER_NOT_LINKED` / `422`: link the phone number first.

### OpenRouter generation model settings

Tenant administrators can save an image-generation model and a text-to-speech
model in the existing OpenRouter workspace settings; platform administrators can
set shared defaults. The selectors suggest inexpensive compatible catalog models
without replacing saved choices when prices change. Received audio still uses
the transcription model, and received images use the assistant/employee model
with vision support. These generation settings are preparatory configuration;
they do not enable generated image or voice replies by themselves.
