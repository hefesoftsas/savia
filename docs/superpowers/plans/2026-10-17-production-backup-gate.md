# Production backup write barrier

The existing production capture correctly rejects concurrent Auth writes. Add a shared Durable Object barrier around actual D1 execution and R2 mutations in all four storage writers, including scheduled work, background callbacks and WhatsApp alarms. A backup closes the barrier, drains durable in-flight permits, renews a bounded lease throughout capture, verifies ownership before accepting the result, and releases it on success or failure. Expired backup leases reopen traffic; unresolved writer permits never expire silently.

The authenticated controller checks live capabilities on the other three writers against the same namespace before acquisition. Deployment and infrastructure apply were initially excluded; the user subsequently authorized activation. Existing bookmark and inventory proofs remain mandatory. Flows stays disabled; unattended capture must fail closed if it is provisioned until its independent pause lifecycle is integrated.

Validation: coordinator persistence/concurrency/failure tests; binding proxy coverage; controller authorization/capability tests; runner lease loss, drain timeout and cleanup tests; generated manifests; affected worker typechecks and tests; infrastructure contracts. Activation still requires publishing guarded workers and configuring dedicated backup credentials and the remote state backend.

Implemented the coordinator, idempotent durable permits and transport retries,
all four writer boundaries and WhatsApp alarms, authenticated live capability
checks, bounded runner drain/renew/release, generated bindings and standalone coordinator namespace-first
release ordering, and pre-mutation control credential validation. A new native
D1/R2/SQLite DO test runs after the API unit lane. Local independent control
credential custody is prepared; no credential upload or deployment was performed.

Full affected application regressions passed (2,560 tests), as did application
and Pulumi typechecks, contracts and focused failure/concurrency tests. Activation
and production load/restore drills remain pending the authorized deployment and
state-backend setup. Flows-enabled unattended coordination remains explicitly
unsupported; production currently has no Flows persistence.
