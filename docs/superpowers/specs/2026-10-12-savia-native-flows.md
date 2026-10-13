# Native Savia collections in Flows

The user approved implementing the proposed first increment: local collection
record lifecycle triggers and five native collection CRUD/query nodes. Existing
authorization without approval pauses and the local Miniflare-only constraint
continue to apply. Schema-change triggers, external collection change capture,
notifications and file nodes are subsequent increments.

## Product behavior

The Savia node category contains a Collection Event trigger and List, Read,
Create, Update and Delete Record nodes. Select collections from a permission
filtered catalogue; write inputs use the collection's field metadata. Trigger
configuration chooses created/updated/deleted/restored events, optional watched
fields and equality conditions against before/after values. Only enabled,
explicitly configured subscriptions run. Trigger outputs include projected
before/after records, changed fields, record identity/version, actor and time.

Local record mutations produce an outbox event in their database transaction.
Capture must cover ordinary CRUD, bulk/import, local sync, integration saves,
record bundles and relation-clearing updates. SQLite record triggers capture
these without relying on lossy UI invalidation callbacks. System/bootstrap and
schema migration writes are excluded by requiring an authenticated mutation
history context. An outbox has leases, retry/backoff, durable failure status and
bounded retention; it never calls Flows before the mutation commits.

## Protocol and authorization

`packages/studio-shared/src/savia-flows.ts` owns the wire types. Collection
events use id, tenant, collection, operation, recordId, recordVersion,
timestamp, before/after, changedFields, actor and optional cause ancestry.
The outbox dispatcher sends signed body-bound events to
`/internal/savia/collection-events` on the private Flows binding, issuer savia,
audience savia-flows-collection-events, max age 30 seconds.

Flows calls its private SAVIA_HOST binding at
`/api/public/savia-flows/collections`. Requests are signed with issuer
savia-flows, audience savia-flows-collections-host, sub principalId, tenant,
optional workflowId/executionId/nodeId, bodyDigest (SHA-256 lowercase hex),
iat/exp and a maximum 10-second age. No Savia bearer token is sent to the child
app or persisted in executions. Catalogue calls use the current authenticated
user; runtime calls use the runtime's backend-established userId and execution.
Automatic runs use the principal who configured the subscription, reauthorized
against current Savia state. The host rechecks tenant, principal, membership,
collection, row and field permissions and applies existing Studio validation.
Only local collections are available. Missing binding/authority fails closed.

Mutation nodes require workflowId/executionId/nodeId and persist idempotency
receipts atomically with the record write. Fingerprint mismatches return 409;
cached responses still require current access checks and field projection.
Updates/deletes require a record version. Native deletions remain recoverable.
Event projection rechecks access to before/after snapshots before exposing data.
Deduplicate event/workflow admissions, including restart/retry. Ancestry skips
workflows already in the causal chain and stops chains after depth 8.

## Local execution and verification

The dispatcher runs after supported API mutations via deferred work and from
scheduled maintenance. The local developer runner periodically drains through
a private authenticated call, since local Wrangler does not invoke cloud cron.
All resources remain local Miniflare D1/R2/DO/Workflows/queues. No external
provider or billable binding is activated.

Tests must cover transaction rollback, all lifecycle events, idempotent sync,
bundle writes, no-op updates, tenant separation, revoked permission, projected
fields, duplicate admission, recovery while Flows is unavailable, mutation
retry, stale versions and causal cycle prevention. Verify a real local event
starting a graph whose native node writes a second collection, then inspect
history and persistence; build and inspect the new editor controls.
