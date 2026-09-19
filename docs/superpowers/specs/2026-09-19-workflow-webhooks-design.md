# Workflow webhooks

Status: proposed specification; conversational design approved, written review pending.

## Intent and scope

Support both directions requested by the user: external systems start a Savia workflow, and a workflow sends data to an external system. Configuration belongs in the existing workflow editor. Reuse published versions, workspace isolation, permission checks, durable execution history, and the D1 scheduler.

The first release accepts and sends JSON over POST. It does not implement provider-specific signature protocols, synchronous workflow responses, arbitrary HTTP methods, or a general API connector builder. Existing workflows remain compatible.

## Incoming contract

- Add a `webhook` trigger. A managed endpoint belongs to one workspace and workflow, with an opaque globally unique endpoint ID. The public route is `POST /api/public/workflow-webhooks/{endpointId}`; callers cannot select a tenant or owner.
- Require `Authorization: Bearer <secret>` and `Idempotency-Key` (1–150 printable ASCII characters). Generate a cryptographically random 256-bit secret, reveal it only on creation or rotation, and persist only its SHA-256 digest. Compare digests without early-exit byte comparisons. Never accept credentials in URLs.
- Accept a JSON object with a maximum UTF-8 body size of 32 KiB, enforced while reading even without Content-Length. Store its fields as `trigger`, preserving the current variable model. Do not copy request headers into workflow context.
- Authentication, active published webhook version, endpoint state, and current owner authorization must pass before acceptance. Return a generic 404 for unknown endpoints or invalid credentials, 409 for inactive workflows or conflicting duplicate input, 413 for oversized input, and 422 for invalid JSON or key. Responses use no-store.
- Within one transaction, pin the active published version and insert the durable execution and receipt. Return 202 with execution ID and whether it was previously accepted. A repeated endpoint/key with equivalent JSON returns the same execution; different JSON returns 409. Object key order does not change equivalence; array order does. Concurrent deliveries create one execution. Receipts survive credential rotation and publishing changes.
- Disabling prevents new starts; authenticated retries of already accepted keys may retrieve the existing receipt even while disabled. Rotation invalidates the old secret immediately. Accepted executions continue under the existing runtime permission rules.
- Add per-endpoint durable admission limits of 60 new executions per minute, checked atomically with acceptance. Duplicates do not consume this allowance. Use the host's public-route rate limiter for unauthenticated traffic where configured; do not silently represent it as universally deployed.

## Outgoing contract

- Add a `webhook` step referencing a workspace-scoped destination. The step defines a JSON object through the existing typed value/reference mapping controls. A destination owns a fixed HTTPS URL and optional bearer or named API-key authentication; URLs cannot come from event data.
- Store credentials encrypted using the existing integration encryption helpers and host key. Management responses expose only credential presence. Destination configuration is versioned: published workflows pin a destination revision so later URL edits cannot silently redirect accepted executions. Credential rotation applies to that destination without changing its URL revision; disabling a destination blocks future attempts, including queued executions.
- Only workspace administrators with workflow design permission manage destinations; publication validates ownership and configuration. Before every delivery, recheck the workflow owner's permission and destination state.
- Reuse the existing public URL and public DNS validators. Require public HTTPS on port 443, reject embedded credentials, IP literals and internal destinations, and disable redirects. DNS preflight is defense in depth, not an assertion of socket-level DNS pinning; document that limitation of the existing Worker transport.
- Send JSON with a stable `Idempotency-Key` derived from workspace, execution, and node, plus execution/node identifiers. Reserve authentication, transport, and idempotency headers; do not permit arbitrary secret-bearing headers in definitions. Bound the encoded request to 32 KiB, response read to 32 KiB, and total network operation to 10 seconds, below the execution lease.
- Treat 2xx as success. Persist a sanitized bounded JSON response (or bounded text) and HTTP status for subsequent step references. Redact credential values and sensitive response keys before storage. Document that redacted fields cannot be used downstream. Oversized responses are marked truncated and never buffered without bounds.
- Retry network errors, timeouts, 408, 429, and 5xx up to three automatic attempts with durable backoff (5 and 30 seconds; honor a valid Retry-After up to 5 minutes). Other HTTP statuses fail without automatic retry. Persist each attempt's safe status, timing, and outcome. Manual retry uses the same idempotency key.
- Persist the resolved payload and delivery identity before the first request; every retry uses identical bytes. External delivery cannot be committed atomically with D1: a crash after the receiver accepts may cause redelivery. Guarantee durable attempts and a stable key, not exactly-once remote effects. The receiving system must implement idempotency. Expired-lease recovery counts toward the automatic attempt bound and never changes payload or identity.

## Storage and execution integration

Add mirrored migrations in packages/db and packages/crm-server for endpoints, incoming receipts/rate counters, destination revisions and encrypted credentials, and outgoing deliveries/attempts. All relations and lookups include workspace identity; only the opaque incoming endpoint lookup is global. Unique constraints enforce receipt and delivery identity.

Keep native step effects on the existing atomic path. Introduce a separate external-delivery path with durable preparation, network execution outside transactions, and lease-fenced result/checkpoint updates. A stale worker cannot advance a cancelled execution or overwrite a newer receipt. Cancellation prevents subsequent steps but cannot undo a request already in flight.

Host API wiring exposes only the incoming route without user-session authentication; its endpoint secret remains mandatory. Management routes retain existing workflow action authorization. Scheduler wiring supplies encryption and transport dependencies explicitly. No browser persistence is introduced.

## Editor and documentation

Add “Webhook recibido” to triggers and “Enviar webhook” to steps. Incoming configuration shows the endpoint URL, credential creation/rotation, and a copyable request example. Secret reveal is transient; warn that rotation invalidates the previous credential. Publishing/activation requirements are visible.

Outgoing configuration selects or manages a destination and maps payload fields using existing variable inputs. Execution history shows attempts, status, retry time, and useful sanitized errors. Explain duplicate delivery semantics beside retry configuration/help.

Update docs/workflows.md and onboarding references as needed. Register route schemas in generated OpenAPI; do not maintain a separate handwritten API reference. Add request examples to the workflow usage guide.

## Verification and acceptance

- Shared schema tests cover new trigger/step types, invalid configuration, references, and backward compatibility.
- Database-backed tests cover authentication, rotation, workspace isolation, concurrent duplicates, equivalent/different payloads, admission limits, publication/disable races, and atomic receipt/execution creation.
- Runtime tests cover stable payload/key across retries and crashes, permission revocation, destination disablement, cancellation, stale leases, success/error classification, Retry-After bounds, body limits, and credential redaction.
- Transport tests reject unsafe URLs/DNS and redirects and verify timeout/response bounds using an injected fake transport. Never send tests to arbitrary real destinations.
- UI tests cover incoming setup, outgoing mappings/destinations, secret reveal, and delivery history. Run shared, server, API scheduler/route, and affected admin tests plus typechecking.
- Demonstrate a controlled local incoming request running a workflow with an outgoing step against an explicitly injected test receiver; verify one incoming execution under duplicate requests and the same outgoing identity under retry.

## Rollout boundaries

Apply migrations before publishing webhook workflows. Existing definitions need no migration. Hosts without an encryption key cannot configure authenticated destinations and must receive a clear configuration error. Preview cron remains disabled unless deliberately enabled; receipt acceptance means queued, not completed. Delivery/receipt retention follows current workflow history retention until a separate retention feature is implemented; do not delete deduplication receipts implicitly.
