# Central Savia infrastructure

Owner: Savia platform team. Reviewed: 2026-10-12.

The user wants PR #277 integrated and deployed before Savia Flows, with all
Cloudflare infrastructure declarations maintained in the infrastructure project.
The existing Pulumi preview stack already imports the two D1 databases and the
documents bucket. A fresh remote preview reports four unchanged resources and
no creates, updates, replacements, or deletes. The Flows implementation remains
in its separate, active local worktree and must be preserved.

## Ownership and rollout

Use one infrastructure directory under `infra/pulumi`, with isolated Pulumi
projects for standard deployments, temporary branch environments and the shared
registry. Pulumi owns independently
provisioned D1, R2, KV, and Queues resources; the same project's renderer owns
Worker names, bindings, routes, cron, SQLite Durable Object migrations,
Workflows bindings, resource limits, and optional WorkerLoader. Wrangler remains
the only publisher of Worker code and attached constructs. Do not register the
same script, workflow, queue consumer, or cron with both providers.

Move the current Worker configuration renderer into the infrastructure project,
preserving its existing public wrapper and tests. Deploy manifests consume
validated Pulumi outputs. Refuse stack/environment mismatches. Existing secrets
continue using the dedicated secret uploader and are never emitted in manifests
or plaintext in logs/state exports. Existing preview and production resources
must keep their identities and their current settings.

First update PR #277 against main and verify its disaster recovery contracts.
Apply the adopted existing preview stack first without application-resource changes.
Then bootstrap one dedicated private, protected R2 bucket for shared encrypted
Pulumi state, using the already-active R2 service and the existing token
permissions. Migrate the imported checkpoint rather than initializing empty
state. Configure CI with the same passphrase and derived existing S3 credentials;
no new token or access grant is created. Preserve the current production
stack and do not deploy new Flows resources, AI, browser, containers, email, or
other billable integrations in this phase. An explicitly disabled Flows feature
flag must produce no Flows resources or host bindings in cloud configurations.

## Savia Flows declarations

Declare isolated Flows names for preview and production: one D1 database, one KV
namespace, three R2 buckets, one Queue, and a private Worker. Its generated
manifest contains the resilient Workflows binding, five SQLite Durable Object
classes and migration, Queue producer/consumer, a one-minute cron, WorkerLoader,
rate limits, and reciprocal `SAVIA_HOST` / `SAVIA_FLOWS` service bindings. The
Flows Worker is published against the existing API before enabling the host's
binding. This future activation is explicit; a default rollout adopts only
existing infrastructure. Preserve the restricted node catalog and D1 execution
history for the first preview, without Analytics Engine or provider credentials.

## Recovery and verification

Before integration, verify existing PR review findings against source. Recovery
must reject mismatched environments, restore complete backups from relocated
directories, initialize schema without duplicating seed/migration rows, use
D1-compatible import SQL with deferred foreign keys, and refuse an inconsistent
fallback table dump while writes are active. R2 enumeration must use supported,
paginated APIs and preserve object metadata.

Tests cover disabled Flows, environment isolation, required resource outputs,
generated bindings/paths, recovery failures, and deployment ordering. Run the
Pulumi helper suite, program typecheck, existing renderer/deployment contracts,
and a refreshed remote preview before applying the existing stack. Capture the
no-resource-change apply and describe any unavailable CI state backend honestly;
never silently fall back to manual resource IDs when IaC is required.

## Auxiliary deployment coverage

Temporary previews adopt their exact existing resources into separate
`branch-<slug>` stacks, use saved non-destructive plans, and never delete the
shared state bucket. The registry has a protected independent `shared` stack;
cloud deployment selects adopted state and never silently creates replacement
state. Its public authenticated workers.dev endpoint and current bucket policies
stay intact. The editor preview manifest is generated centrally; checked-in
auxiliary app manifests are local-only. The explicit Vectorize bootstrap is
maintained in the infrastructure project and never runs implicitly. Application
setup consumes adopted production outputs and does not provision D1/R2 directly.
