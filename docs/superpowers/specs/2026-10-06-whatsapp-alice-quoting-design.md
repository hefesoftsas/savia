# WhatsApp assistant quoting for customers and advisers

Status: proposed specification, awaiting written-spec review.
Date: 2026-10-06.

## Intent and agreed scope

WhatsApp should let Alice quote light vehicles through the same configured
insurance services as the Savia chat. A contact supplies a plate, Alice looks
up verified vehicle data, collects missing information conversationally,
requests confirmation, and returns actual saved insurer results.

The user approved this direction and selected both audiences: customers see
their own quotes; advisers use their Savia permissions. The scope is quoting,
quote history, and comparisons. Personal integrations, arbitrary CRM changes,
policy purchase, and policy issuance are outside this change. Insurance remains
an optional solution package, not a platform-core assumption.

Success means a conversation beginning with a plate can reach a persisted real
quote without requiring a user to leave WhatsApp or supply technical codes.
Vehicle lookup depends on the tenant's enabled, supported lookup configuration;
Alice asks for unavailable fields if lookup fails and never invents results.

## Current behavior and reusable components

- `apps/api/src/whatsapp/assistant.ts` uses the tenant assistant configuration,
  employee prompt, knowledge retrieval, and contact history. Its completion has
  no tools and explicitly prohibits claiming completed actions.
- `apps/api/src/whatsapp/runtime.ts` connects that completion to the signed,
  durable inbox and Nango outbound transport.
- Savia chat in `apps/api/src/assistant/service.ts` exposes vehicle/city lookup,
  quote requirements, summary reads, and preparation of a confirmed command.
  It executes the command only after an authenticated principal confirms it.
- `apps/mcp/src/savia-api.ts` currently orchestrates assistant quotes: canonical
  validation, configured products, master/detail persistence, extension action
  execution, and result summarization. Its authenticated HTTP client cannot be
  handed unchanged to an external WhatsApp customer.
- `packages/insurance-quotes/src/assistant-contract.ts` defines canonical
  requirements and validation. The package's WhatsApp contribution currently
  validates consented intake only and disables provider execution.

The native WhatsApp questionnaire remains an optional input method. Receiving
its completion does not authorize a quote or bypass confirmation.

## Selected approach and alternatives

Use a limited channel capability interface and a trusted server quote service.
Share quote orchestration and canonical contracts with the existing Savia flow,
while keeping WhatsApp identity, ownership, and confirmation explicit.

Copying only the prompt would preserve the missing-tool problem. Passing the
connection owner's unrestricted MCP identity to every contact would grant
unrelated access. A separate WhatsApp-only cotizador would duplicate validation,
provider settings, and persistence. The selected approach reuses the working
quote lifecycle and enforces channel-specific access before it runs.

## Identity and authorization

Retain signed webhooks, registered sender/WABA resolution, the explicit contact
allowlist, active employee binding, and existing owner membership checks.
Quoting is a separate opt-in tenant capability, disabled by default; enabling
ordinary text replies must not enable business actions automatically.

Each allowed contact has a server-owned access assignment scoped by tenant,
connection, and normalized phone number:

- Customer: may prepare new quotes and read quotes created through that contact
  assignment. A document number, plate, name, or quoted reference does not prove
  ownership. Existing Savia quotes are not automatically linked by matching PII.
- Adviser: a tenant administrator explicitly links the number to an active Savia
  principal in that tenant. Every lookup, history read, preparation, and execution
  reloads that principal's membership and applicable quote permissions. A contact
  cannot select a principal or promote itself by chat message.

Use the tenant's registered channel authority for customer operations, narrowed
to quote capabilities and explicit contact ownership. This is a server-side
delegation, not a customer user session. Reuse existing extension/record access
checks under that restricted execution context; do not synthesize an unrestricted
administrator actor or store a user's bearer token in the channel settings.
Adviser capabilities are the intersection of channel, employee, and principal
permissions. Removal of any required permission revokes pending confirmations.

When a contact assignment changes, rotate its access generation and retire
old drafts and confirmations. Retain audit records, but do not replay history
from a previous access generation into the new conversation. Customer result
reads require the durable contact-to-quote ownership association before loading
master or detail records. Adviser reads use the existing authorized record scope.

## Components and execution boundary

The platform channel owns identity resolution, durable conversations, capability
dispatch, action confirmation, processing leases, and delivery. The insurance
solution supplies form requirements, lookup adapters, canonical validation,
quote orchestration, and normalized result summaries through the release catalog.
Do not add insurer names, quote fields, or provider logic to the platform's
general assistant implementation.

Contact identity assignments and single-use channel confirmations are generic
channel primitives. Quote drafts, product selection, quote jobs, ownership
associations, and quoting settings are insurance-solution contributions. If that
solution is absent or disabled, do not register its capabilities or settings;
existing text replies remain available and undispatched insurance jobs are blocked.

Extract shared orchestration from the existing MCP client into an insurance
service with injected, authorized record/settings/action ports. Preserve current
Savia behavior through its authenticated adapter. The WhatsApp adapter supplies
the restricted channel context and authorized contact ownership. Keep actual
provider calls in the installed extension and Savia Request bundle.

The model receives only permitted capabilities for requirements, vehicle lookup,
city resolution, updating a validated draft, preparing confirmation, and reading
authorized results. It receives no generic MCP client, personal tools, arbitrary
collection CRUD, provider credential access, or direct quote-execution tool.
Backend handlers validate every capability input and authorize it independently
of the model's prompt. Denied capabilities are not advertised by Alice.

## Conversation and durable drafts

1. Resolve access and capabilities, then load a tenant/contact/access-generation
   scoped draft. Maintain structured values with source provenance separately
   from the bounded text history so truncation does not lose verified data.
2. Once a valid plate arrives, perform one lookup for that plate in the draft.
   Save verified Fasecolda, year, value, and accessories when returned. Ask only
   for unavailable fields after a failure; repeat on an explicit retry or change.
3. Resolve city names using the DANE lookup. Ask for the department when results
   are ambiguous. Collect at most three missing items per turn. Apply the same
   natural-language normalization rules as Savia; do not infer personal data.
4. Validate the canonical vehicle/applicant input. Record explicit data-processing
   consent bound to the contact and draft; a Flow's consent must be revalidated.
5. Prepare a server-issued summary and confirmation tied to the immutable draft
   revision, enabled-product snapshot, access generation, and five-minute expiry.
   Include the applicable products, insured value, and applicant identity in the
   preview. Editing data or changing enabled products invalidates the preview.
6. Send native buttons `Confirmar y cotizar` and `Cancelar`. Tenants without
   buttons receive an explicit confirmation code and cancel instruction.
   Validate button reply context/token or the exact text code on the server;
   the model cannot interpret a generic yes as authorization. Declining or
   expiring a preview leaves the draft editable without contacting insurers.
   Use a cryptographically random 128-bit opaque button token; for text fallback
   use a random 10-character uppercase base32 code. Store only credential hashes
   and their server-side binding. Never include codes in model context or logs.
   Allow at most five failed confirmation attempts per preview, then invalidate
   it; rate-limit attempts per contact. Tokens are single-use and cannot be used
   after expiry, cancellation, revision change, or access revocation.
7. Atomically consume a valid confirmation once, recheck access and configuration,
   and enqueue durable quote execution. Reply with progress; the inbox's normal
   generation timeout must not terminate or restart the quote job.
8. Return saved offers, failures, and pending statuses from authorized summaries.
   Compare price and reported coverage only; missing deductibles or coverage do
   not justify an overall winner. Continue using the same ownership rules for
   subsequent quote-status questions.

Never hard-code the example plate's year or insured value. Those are evidence
from the original chat, not fixture values the assistant may reuse in production.

## Persistence, concurrency, and recovery

Add backend persistence for contact access assignments, versioned quote drafts,
channel confirmations, contact-to-quote associations, and quote jobs. Store
tenant/connection/contact/access generation, acting authority, employee, draft
revision, product snapshot, confirmation expiry, and audit timestamps. Maintain
SQLite/D1 and PostgreSQL migration/schema parity. Do not persist channel state
or sensitive form data in browser storage.

Use atomic transitions and uniqueness constraints for one execution per consumed
confirmation, with per-product dispatch records created before any provider call.
Persist quote ownership with the master before dispatch so a successful quote
can never exist without its access association. Existing per-contact inbox leases
remain responsible for message ordering, not provider idempotency.

The current Studio HTTP writes are separate operations, so use a recoverable
prepare/link sequence rather than assuming a transaction across stores. Persist
the job's intended master ID and execution key first; create the master using that
stable ID, persist its contact ownership association, then transition the job to
dispatch-ready. Recovery reads the same master ID and completes the missing link
without creating another master. Provider dispatch requires dispatch-ready state
and the association. If record creation cannot accept a stable server ID, add that
internal capability before enabling the channel; never substitute name matching.
A master created before its link remains undispatched and invisible to customers.

Duplicate webhooks, duplicate confirmation replies, expired worker leases, or an
outbound send failure must not create another quote. Mark dispatch as started
before calling a provider. A crash or timeout after dispatch has an uncertain
outcome; recover known results or flag review, never replay the provider call
automatically. Pre-dispatch failures may be retried under a fenced lease. Retrying
a dispatched product requires a fresh explicit action and records the new attempt.

The existing minute scheduler also recovers quote jobs. Long-running provider
work must use the repository's supported durable execution mechanism, with bounded
per-product calls; do not rely solely on an untracked `waitUntil` task. Final
delivery rechecks channel access and Meta's reply window. If delivery is no longer
allowed, retain the saved result for the next authorized inbound status request.
An uncertain outbound send is recorded without automatically resending it.

## Settings, privacy, and rollout

Extend WhatsApp settings with the quoting switch and contact access assignments.
Only existing tenant/platform administrators may manage them. Linking an adviser
requires selecting a tenant member explicitly; display whether that principal is
currently eligible. Keep the existing allowlist and sender connection controls.

Quote data remains in the existing tenant quote collections, with restricted
ownership metadata. Keep credentials and raw provider payloads out of replies,
model context, and logs. Persist only necessary intake and normalized results;
apply the existing tenant data retention/deletion policy to drafts and ownership
records as well as quotes. Mask personal details in operational logs.

Update `docs/insurance-quoting.md` and `docs/runbooks/nango-whatsapp.md` to explain
the opt-in execution capability, access assignments, confirmation, and recovery.
Generate API documentation through the existing OpenAPI tooling.

Roll out disabled by default with an explicit tenant/contact pilot. First verify
the new flow with mocked provider execution, then perform an explicitly authorized
real pilot. This specification does not authorize live insurer calls or deployment.
Disabling quoting revokes pending confirmations and blocks undispatched jobs;
already-dispatched outcomes remain recorded without automatic replay.

## Acceptance and verification

- A plate-only message performs an enabled lookup, persists returned fields, and
  asks at most three missing questions. City ambiguity and lookup failures are
  handled without invented values or repeated automatic lookups.
- A complete consented draft produces a preview. Model output, Flow submission,
  a generic yes, expired tokens, or another contact's token cannot execute it.
  Wrong-code attempts are bounded, and credentials cannot replay after consumption
  or expiry. Recovery between master creation and ownership linking creates no
  duplicate master and makes no premature provider call.
- A valid confirmation creates one master with ownership, authorized details,
  and actual configured product calls; results survive restart and are summarized.
- Duplicate/concurrent webhook and confirmation processing, stale leases, changed
  draft revisions, and uncertain provider outcomes cannot replay insurer requests.
- Customer A cannot read customer B's quote by reference or guessed record ID.
  An adviser sees only records permitted by the currently linked Savia account.
  Revoked membership, disabled employee, changed assignment, and cross-tenant
  sender/employee/principal combinations block reads and execution.
- Existing Savia chat quoting and text-only WhatsApp bindings retain their
  behavior. Tenants without the solution, enabled products, or supported lookup
  receive accurate capability limitations.
- Run focused unit/contract tests for capabilities, ownership, confirmation and
  job transitions, integration tests for signed inbox-to-quote processing,
  PostgreSQL dialect/schema checks, and relevant package typechecks. Validate
  real Meta delivery and provider behavior separately during the authorized pilot.

## Review outcome

The design reuses existing canonical inputs and provider execution, explicitly
separates customer ownership from adviser permissions, and adds deterministic
confirmation and durable execution instead of granting unrestricted tools.
No application code, migrations, deployment, or real quotes are part of this
specification-only milestone. Written-spec approval precedes the implementation
plan and its execution-method selection.
