# Flows preview readiness

The user authorized completing preview preparation without further approvals, but explicitly prohibited activation. Keep all cloud resources and execution disabled throughout this work. Integrate Flows and the shared QuickJS executor with the centralized Pulumi infrastructure and existing preview pipeline.

Provisioning and execution are separate switches. `flowsEnabled` provisions resources; `flowsExecutionEnabled` admits work. Both default to false. Pausing execution must retain persisted data. Preview has no external provider bindings or credentials and must block public Internet requests at runtime, including stored workflows and code tools. Internal service bindings remain available.

Preview budgets are shared across organizations and both execution modes: 100 admissions per UTC day, 1,000 per UTC month, two concurrent runs, 50 nodes per definition and 200 runtime steps per run. Reservations must be atomic, stable execution IDs idempotent, and failed configuration closed. These limits bound activity rather than guarantee an invoice ceiling. Keep QuickJS allocator protection and serial tests.

Backups cover auth/domain/Flows D1 and documents/resources/datasets/inboxes R2, with resource validation, metadata and restore integrity checks. Persisted Durable Object databases must have explicit snapshot/restore support. Cloudflare Workflow continuations cannot be exported: recovery restores data and history with execution paused; it does not replay in-flight side effects. Secrets stay outside backup manifests and retain stable encryption keys.

The deployment pipeline remains gated by centralized outputs. It validates configuration/secrets before mutations, backs up existing data before migrations, updates the shared executor before Flows, applies Flows migrations, and verifies the resulting private bindings and disabled execution state. Preparing or testing the pipeline must not run it remotely.
