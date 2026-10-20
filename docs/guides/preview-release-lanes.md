# Preview release lanes

Shared Preview remains `https://savia-preview.hefesoft.com`. Successful CI for a
push to `main` triggers the existing release workflow. The workflow checks out
the exact tested commit and rejects superseded or foreign-repository runs.

## Compatible plugin updates

The fast lane accepts existing `packages/plugin-*` or `store-ports/*` packages
whose frontend files change with a strictly increased extension version. The
manifest must be identical apart from its version, and store declarations,
dependencies, build settings, permissions and schema must remain unchanged.
Unknown paths or metadata select a complete platform release. Tests-only changes
are checked without publishing another artifact; documentation does not change
the running platform.

CI executes the classifier from the trusted base revision, not the proposed PR
code. Missing trusted code falls back to full checks. The existing **Contract
tests** required check also guards classification and plugin validation failures,
so skipped platform jobs cannot hide an invalid plugin build. Shared code,
dependencies and uncertain changes still run Flows source checks. Pure Pulumi
changes use the infrastructure CI scope described below.

Publication compares the tested commit with the last successful Preview release
ancestor, rather than only its parent commit. Therefore an earlier failed
platform deployment cannot be skipped by a later plugin-only commit. Missing
history selects the full lane. A successful workflow without an unexpired
`preview-release` artifact for its exact main commit does not advance the baseline.

The publisher packages only changed plugins and updates their existing enabled
installations. It does not install optional plugins in new workspaces, reactivate
disabled installations, apply migrations, upload secrets, replace Workers, or
copy unrelated R2 state. Before any mutation it verifies live manifest/store
compatibility and writes a durable checkpoint with prior installation and
artifact data. Plugin ZIPs use fixed timestamps and modes so the same source produces the
same digest on retry. It publishes and verifies exact versions and digests. Partial
failure triggers rollback; a concurrent manual disable/version change is not
overwritten. Recovery checkpoints are retained as GitHub Actions artifacts under the
repository’s artifact access policy. They contain plugin source and installation
metadata, but no connector credentials or business documents.

Prior plugin artifacts remain available for recovery. The publisher fails
explicitly when the store quota is full; it never deletes history automatically.
The existing store limit remains ten versions per plugin. Review and archive
inactive versions through the normal management process when needed.

## Full platform updates

The complete lane preserves the established write pause, drain, Durable Object
snapshot, coherent D1/R2 backup, encrypted archive, infrastructure, migration,
Worker publication and recovery sequence. Production promotion remains separate.
The existing production gate still requires the full **Deploy preview** job; a
plugin-only Preview publication alone does not authorize production promotion.

API-based R2 downloads use four concurrent workers by default. Set
`--r2-concurrency 1` through `--r2-concurrency 8` on `infra/pulumi/backup.mjs` to
adjust the bound. Each object retains its expected size and content encoding.
An error stops new downloads and waits for in-flight downloads before failing;
no successful backup manifest is produced. Partial files may remain in a failed
backup directory and are not evidence of a restorable snapshot.

## Infrastructure CI scope

CI uses an opt-in classifier separately from publication planning. Changes only
under `infra/pulumi/`, with optional files under `docs/` or `documentation/`, skip
application unit/typecheck jobs and Flows source verification/unit/typecheck jobs.
Pulumi's PR workflow still runs every infrastructure helper test, all four program
typechecks, and the real CLI preflight. The existing **Contract tests** required
check retains the full repository contract suite and adds the Flows offline
maintenance/recovery tests for this scope. Public source security checks remain
active.

Flows unit tests run in two Actions jobs: the API suite runs alongside the root,
native, app, runtime, geo, and utilities suites. Source verification stays with
the core tests. Flows and hook-executor
typechecks plus offline infrastructure/recovery tests run in a third independent
job, alongside both test jobs. The existing **Flows runtime and preview readiness**
check waits for all three jobs and fails if any does not succeed.
Infrastructure-only runs keep all three jobs and this aggregate check skipped.

Mixed application/infrastructure changes, shared code, dependencies, workflow or
classifier changes, unknown paths, and unreadable revision ranges select full CI.
The workflow executes the classifier from the trusted base. An older classifier
without the CI option also selects full CI, allowing the first upgrade PR to be
validated normally. A shorter CI selection does not change the release kind:
infrastructure changes still require a platform publication through existing gates.

Before submitting infrastructure changes, run `pnpm infra:preflight` with the
repository-pinned Pulumi CLI and installed `infra/pulumi` dependencies. See the
[ownership runbook](../runbooks/pulumi-environment-ownership.md#local-cli-preflight)
for its isolation guarantees and the separate live read-only audit.

## Operations and measurements

Use one Actions watcher and verify the final tested commit, release kind,
artifact digest and enabled installation. Measure CI, publication and feature
development separately. A two-to-five-minute artifact publication is an
optimization target, not a guarantee for every feature or a replacement for
complete platform checks.

For coherent backup and failed-release recovery details, see
[Preview and production operations](../runbooks/preview-production.md).

## Preview code updates

Existing application source changes can publish only the affected API, Auth,
Request, Connector Gateway or admin gateway Worker. The frozen artifact retains
all configurations and resource identities; its digest also covers the exact
base, head and selected targets in `release-source.json`. Planning uses the last
successful evidence-backed deployed ancestor, so a failed release cannot hide
pending changes. Missing history, new/deleted files, schema statements, entrypoints,
configuration, dependencies, migrations and unknown paths select the full release.
Production always uses the complete publication sequence.

This preview-only path requires an active runtime. It skips write pauses, Flows
snapshot/drain, data backups, migrations and secret publication. Auth publication
still completes deployment initialization before dependent Workers. Existing
health checks and Worker version recovery remain mandatory; code-only recovery
never restores databases. Build preparation still freezes the complete artifact.

Isolated Auth and API changes use their focused CI profiles. Shared backup-gate
changes test all four consumers. Mixed and uncertain changes retain full checks.
Office assets and workspace store plugins publish only when their cumulative
paths changed; a missing baseline enables both conservatively.

Full releases stage secrets with `wrangler versions secret bulk` before publishing
code, allowing retries after rollback leaves a newer inactive Worker version.
The Auth helper records bounded subprocess diagnostics in the private encrypted
failure artifact; CI displays only preparation stages and HTTP status numbers.
