# Flows preview readiness verification

Date: 2026-10-12. Working branch: `codex/flows-preview-readiness`.
The centralized IaC worktree includes cached `origin/main` at `3d91e608`,
preserving the VS Code plugin-authoring changes. OpenAPI types were regenerated
from the combined API source.

## Release controls

- Pulumi owns Flows resources and generates Worker configuration. Provisioning
  and execution remain separate; both committed preview switches are `false`.
- Shared atomic admission limits are 100 runs per UTC day, 1,000 per UTC month,
  two concurrent runs, 50 nodes, and 200 runtime steps. Stable execution IDs,
  expired leases, tool dispatch, native waiting segments, and redelivery are
  covered by policy tests.
- Cloud configuration fails closed. A persisted generation fence prevents an
  older Worker from clearing a newer pause; pausing wins within a generation.
  The local launcher assigns a fresh generation on restart.
- Public network requests are denied in the restricted configuration, including
  stored graphs and code tools. Internal Savia and QuickJS bindings remain
  available. No Dynamic Worker, AI, Browser Rendering, container, or outbound
  email binding is provisioned for this release.
- Existing releases pause writes and execution, drain, snapshot Durable Objects,
  and back up D1/R2 before migrations. Archives use AES-256-GCM and seven-day
  artifact retention. Preflight checks stable keys before mutation; deployment
  verification checks the resulting private bindings and policy settings.

## Local checks

| Check                                                                                 | Result                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Frozen dependency installation after integration                                      | Passed; subsequent offline frozen installation passed              |
| Policy, WorkflowAgent admission, and WorkerRuntime specifications                     | 79 passed across 3 files                                           |
| Infrastructure, maintenance, encryption, pipeline, boundaries, and download contracts | 176 passed                                                         |
| SQL/KV backup regression checks, including encoded Unicode page limits                | 7 passed                                                           |
| Complete `flows:test` aggregation                                                     | 5,140 passed; 7 skipped; API and editor builds passed              |
| Flows and integration typechecks                                                      | Passed across 13 packages, sequentially                            |
| Core integration and compatibility suites                                             | 225 passed: API 94, Studio 12, Admin 60, shared 6, QuickJS 53      |
| Source provenance, formatting, public hygiene, and Git whitespace checks              | Passed; 1,897 imported files and 526 node implementations verified |

The complete Flows aggregation builds its own API and editor assets, then runs
Miniflare integration, native compatibility, API, UI, runtime, geo, and utilities
sequentially. Miniflare integration exercises all five persisted Durable Object
kinds, authenticated maintenance forwarding, page digests, empty-target restore,
foreign keys, BLOBs, AUTOINCREMENT high-water values, agent SQL, and typed KV.

Reproduce the main checks with `NODE_OPTIONS=--max-old-space-size=1536 pnpm run
flows:test` and `NODE_OPTIONS=--max-old-space-size=2048 pnpm run flows:typecheck`.
Core integration checks additionally cover collection events and current
authority, native tasks and webhooks, maintenance gating, sidebar/editor
integration, and the PostgreSQL source manifest. QuickJS checks include 50 unit
tests and three actual workerd tests, preserving the existing Requests catalog.

Host descriptor exhaustion interrupted earlier builds and Wrangler test startup.
After host pressure subsided, builds passed without changing system limits. The
editor now limits parallel file operations to eight, and package tests and
typechecks use one worker. Tests and builds passed with a 1,536 MiB Node heap
limit. The API typechecker measured approximately 1.64 GiB and passed with a
separate 2,048 MiB limit; CI assigns that budget only to its typecheck step.

The first aggregate run exposed two outdated test fixtures after stricter cloud
policy validation. The admission fixture now includes a generation; runtime
specifications explicitly select local mode. Dedicated policy tests retain
missing/malformed cloud configuration checks.

## Practical limits

The editor's main chunk is approximately 3.34 MiB (1.00 MiB gzip). The Worker
upload measured approximately 21.4 MiB (3.8 MiB gzip); source maps are additional
build output. The broad static catalog retains image, 3D, geo, and provider
dependencies even when their services are disabled. This change bounds local
test resources; it does not claim those bundles were reduced.

Runtime snapshots cover DatabaseDO, MailboxDO, WorkflowAgent, AgentRunner, and
EmailAgentRunner. They reject unsupported virtual tables, encoded pages over
512 KiB, and inventories over 1,000 entries. Cloudflare Workflow continuations,
pending Queue messages, and advisory KV namespace values are outside the archive
format. Recovery remains paused and does not replay side effects.

Quotas bound activity rather than guarantee an invoice cap. Local tests do not
establish live provider compatibility or successful deployment to Cloudflare.
No preview pipeline was dispatched, no resources were activated, no Cloudflare
secrets were uploaded, and no remote Git mutation was performed. The full
monorepo suite, live PostgreSQL/NAS recovery, and global lint were not run for
this readiness check.

See [the Flows guide](../guides/savia-flows.md) and
[backup/restore runbook](../runbooks/flows-backup-restore.md).
