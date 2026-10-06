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
   WhatsApp** panel. The completion API can also accept this metadata when
   it is already available.
5. Savia verifies the Nango connection belongs to `user:<principal-id>` and
   its `agency_id` tag matches the explicitly selected tenant. Missing or
   mismatched tenant tags are rejected; dashboard diagnostic connections
   cannot substitute for tenant Connect sessions. Savia then validates the
   phone number live against the WhatsApp Cloud API through
   the proxy, and persists only safe metadata with status `connected`.
6. **Probar envío** sends a short free-form text through
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
4. Open **My integrations → WhatsApp → Asistente de WhatsApp**. Select the
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
Unsupported event types are ignored. Incoming
message IDs deduplicate retries. The existing minute scheduler recovers pending
work. Managed preview and production deployments set
`WHATSAPP_PROCESSING_MODE=scheduled`: generation runs from the minute scheduler,
not HTTP `waitUntil`, whose post-response lifetime can interrupt multi-step AI
work. Allow up to one minute before processing starts. Local runtimes may omit
this setting to start background processing immediately. Each scheduled invocation
drains multiple small batches within a five-minute scan budget and a bounded
batch count, rather than imposing a fixed five-message global quota per minute.
Individual batches retain the bounded media and model timeouts, leaving room
inside the scheduled Worker lifetime. Overlapping ticks retain atomic message
claims and per-contact leases. Leases serialize each
contact's conversation and fence stale processors. A four-minute processing
lease accommodates media transcription followed by AI completion. Generation retries are
bounded; after the final generation failure, a safe recovery message follows the
same access checks and durable send path. Replies use a natural, concise tone,
avoid repeated greetings and generic service lists, and stay transparent about
the virtual assistant identity. Failed consultations or operations explain the
problem and ask the user to contact an advisor directly, without inventing contact
details or claiming a handoff occurred. Tool failures never expose provider
credentials. City reference lookups use the authenticated `/api/lookups/dane`
route, including for tenant administrators without platform roles. The quote
assistant uses verified enabled products and prepares the validated draft before
requesting data-processing consent. Sending is recorded before calling Meta, and an uncertain send is
terminal rather than automatically repeated.

`whatsapp_inbox` stores contact-specific history, saved replies, outbound message
IDs, processing failures and delivery status. `whatsapp_delivery_receipts`
preserves receipts arriving before the send response, and monotonic updates
prevent delayed events from downgrading delivered/read messages. Check these
records using tenant-scoped operational queries; do not export private message
content or credentials to logs or public handoffs.

Disable **Responder con IA** to stop the pilot without disconnecting Nango.
Automatic free-form replies require a recent inbound message; expired pending
messages do not trigger a send. Native capabilities are configured separately
for each tenant; the existing text behavior remains available with all flags off.

### Native messages and account resources

Use the native WhatsApp panel after assigning an assistant and enabling the
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

The minute scheduler executes confirmed jobs outside the AI completion request.
Atomic claims and per-product dispatch evidence prevent automatic replay after
an uncertain outcome. Operators must reconcile **uncertain** results against
saved records and provider evidence before asking for a fresh action. Results
are sent only while the Meta 24-hour reply window and current access permit it;
a later menu selection does not change their originating identity.

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
