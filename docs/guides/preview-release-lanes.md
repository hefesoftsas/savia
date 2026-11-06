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
durable and legacy evidence selects the full lane. A workflow conclusion alone
does not advance the baseline: publication needs a verified component receipt.

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

### Retrying a failed Preview deployment

The workflow retains the frozen Preview runtime bundle as a seven-day encrypted
Actions artifact. A rerun can reuse it only from the same workflow run, tested
main SHA, Preview environment and Cloudflare account. The workflow requires one
unexpired artifact with matching run provenance, decrypts it with the existing
backup key, rejects unsafe paths and links, and verifies the release manifest,
source revision, Worker identities, artifact digest and config digest. It also
rerenders the current Preview Worker configuration and checks its fingerprint,
including the plugin-editor URL. If configuration has changed, the workflow
rebuilds and replaces the same-run bundle; a missing or expired bundle also
causes a rebuild. Corrupt, ambiguous or identity-mismatched artifacts fail
closed. Older runs made before this retention step have no bundle to reuse.

Every retry still checks the current main SHA, infrastructure outputs, Flows
preflight and isolated Preview resources, then creates a fresh Pulumi preview
and saved plan against the current checkpoint before applying. Runtime secrets
come from the current protected Preview environment. The previous attempt's
saved plan, Pulumi state and checkpoint are never restored or replayed.

D1 table dumps start with bounded row pages and halve a page only when Cloudflare
returns its explicit 50 MB response-size error, retrying the same offset until
the page succeeds or reaches one row. A dump that still fails is discarded and
cannot be treated as a successful backup; the release stops before data
migrations and Worker publication. The write pause and drain may already have
started, so the existing failed-release recovery sequence remains necessary.
Public command errors report only a safe diagnostic category, remediation code,
operation and exit code. Raw command diagnostics remain encrypted for seven days
and are not printed to the workflow log.
The command journal preserves these codes through the lifecycle wrapper.
`DNS_RESOLUTION_FAILED` identifies an explicit DNS lookup failure; verify the
public hostname resolves before retrying a release that failed its health check.

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

Auth-only changes may also use a focused profile when they touch Auth source or
tests, the explicitly listed Auth deployment helpers and their tests, and the
preview Auth workflow; documentation may accompany them. This profile runs Auth
tests, all three deployment-helper test files, and Auth typechecking. Shared code,
dependencies, other workflows, unknown paths, or mixed scopes restore full CI and
Flows checks.

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
Request or Connector Gateway Worker. Admin source uses the full lane because it
can also feed the isolated plugin-editor bundle. Scope is resolved before build
preparation: a verified source-only release bundles only the selected Workers
and skips unrelated Admin and plugin-editor builds. The frozen artifact digest
also covers the exact base, head and selected targets in `release-source.json`.
The artifact's configurations must match those targets exactly. Pulumi retains
the complete existing managed Worker inventory; an omitted unchanged Worker
is not a deletion. Each selected binding is still checked against that full
inventory and its reviewed data identities. Planning uses the last
successful evidence-backed deployed ancestor, so a failed release cannot hide
pending changes. Missing history, new/deleted files, schema statements, entrypoints,
configuration, dependencies, migrations and unknown paths select the full release.
Production always uses the complete publication sequence.

This preview-only path requires an active runtime. It skips write pauses, Flows
snapshot/drain, data backups, migrations and secret publication. Auth publication
still completes deployment initialization before dependent Workers. Existing
health checks and Worker version recovery remain mandatory; code-only recovery
never restores databases. Missing or inconsistent scope metadata fails closed;
a partial artifact cannot be used as a full release. Entrypoint and schema
changes still require the full lane, including Auth's `src/index.ts`.

Full Preview publication overlaps at most two independent Worker deployments.
Auth publication and initialization finish first. Hook Executor precedes Request
and Flows, Request precedes Connectors, and the API follows its providers.
The public gateway is published last. A failed publication waits for all
in-flight sibling commands to settle before rollback begins. Production and
unrecognized publication steps retain serial execution. Backup, migration,
namespace preservation and health-check boundaries remain unchanged.

The deployment's **Publish sanitized runtime operation timings** step reports each release
phase and supported command with elapsed milliseconds and success/failure,
including failed releases. Phase times include their nested commands and must
not be added to command durations. Parallel command durations can overlap.
Only fixed operation labels, durations and outcomes are published; command
arguments, subprocess output, environment variables and error contents remain
private. Records are best-effort and unavailable records do not block recovery.
The summary runs only during a deployment; it adds no scheduled monitoring.

Isolated Auth and API changes use their focused CI profiles. API changes also
regenerate and typecheck Admin API clients to validate frontend consumers. Shared backup-gate
changes test all four consumers. Mixed and uncertain changes retain full checks.
Office assets and workspace store plugins publish only when their cumulative
paths changed; a missing baseline enables both conservatively.

Cloudflare API reads retry transient 500, 502, 503 and 504 responses up to three
times with 1, 2 and 4 second backoff. Failed response bodies are canceled before
waiting. Mutations are not retried for these server errors; existing 429 handling
continues to honor `Retry-After`. Network errors are returned without retry.

Full releases stage secrets with `wrangler versions secret bulk` before publishing
code, allowing retries after rollback leaves a newer inactive Worker version.
The Auth helper records bounded subprocess diagnostics in the private encrypted
failure artifact; CI displays only preparation stages and HTTP status numbers.

## Independent Preview component retries

Preview records runtime, Office and complete store-catalog publication separately.
Each receipt is bound to an exact trusted main workflow run and a successful
component job. A later asset failure cannot invalidate successful runtime work.
The aggregate `preview-release` receipt is emitted only when every required job
succeeds; partial releases never qualify as full promotion evidence.

Use GitHub Actions **Re-run failed jobs** to retry a failed component. Successful
runtime and Office jobs are retained, so retrying store publication does not run
Pulumi, pause the application, export databases or copy R2 objects again. Store
publication waits for selective plugin publication to avoid concurrent catalog
writes. Pending asset changes are compared with their own last successful
component baseline, even when runtime has advanced since the failure.

The planner can adopt a previous combined release's successful runtime operation
only with exact-run immutable artifact evidence, successful resource isolation
and supersession guards, and a successful managed apply. Successful Office upload
can be adopted independently. A failed or incomplete apply is never a baseline.
Unknown history still fails closed to the full release lane.

For verified compatible code changes, the existing Preview-only code lane skips
maintenance, backups, migrations and secret updates. Schema/configuration or
unknown changes retain the full recovery path. Known orchestration-only and
asset-only changes do not republish unchanged Workers.

The Preview store job opts into preserving newer optional catalog versions. It
preflights all workspace catalogs before uploading: a newer optional version is
left untouched and is never installed automatically; a newer required version
blocks publication. Same-version packages still undergo the server's exact-content
check, and a conflicting HTTP 409 remains a failure. Production does not enable
this policy. No scheduled jobs, pings or background polling are introduced.

Verified code-only artifacts retain only the configuration dependencies of their
selected Workers. In particular, retaining or restoring an Auth-only artifact
does not query or export the plugin-editor URL. Full releases still fingerprint
that URL and reject reuse when it changes. Known Preview planning/custody tooling
changes can accompany a compatible code update without forcing a data backup;
unknown infrastructure, Worker configuration and schema changes still select
the full path. Changes limited to infrastructure plus the named Preview planning
helpers run the infrastructure contract profile, including offline recovery tests.

## Evidence independent of Actions retention

Preview also stores successful component receipts in GitHub Deployments, using
the existing `preview` environment and dedicated `savia:preview:component:*`
tasks. Each receipt includes the exact main SHA, repository, component and
workflow-run identity. A successful status is written only after publication;
the complete-release receipt requires all applicable jobs to succeed. It can
represent unchanged component equivalence without claiming a new Worker version.

These records survive deleting workflow runs and artifacts. Planning reads them
before legacy Actions evidence, checks identity and git ancestry, and retains
independent runtime, Office and store baselines. Automatic environment
inactivation does not erase an earlier successful publication; a failed or
incomplete receipt cannot establish a baseline. An unavailable receipt API stops
planning rather than forcing a full deployment and backup. Explicitly deleting
the deployment records still removes this evidence; keep them when cleaning CI.

Receipts contain only release metadata. They add no storage service, secret,
scheduled workflow, ping or polling task. Only publication jobs have deployment
write permission. The initial completed release was recovered from preserved
local job evidence cross-checked against the surviving successful environment
deployment; normal runs write receipts automatically. Existing encrypted retry
artifacts retain their previous expiration and are not replaced by receipts.

## Concurrent contract validation

The **Contract suite** job starts after successful change classification, in
parallel with plugin validation and focused Auth/API/runtime checks. The existing
required **Contract tests** check remains the final gate. It requires the suite
and classification to succeed, plus each applicable plugin or runtime lane;
failed, cancelled and unexpectedly skipped prerequisites cannot pass the gate.
This changes scheduling, not the required validation coverage.

## Bounded Preview infrastructure reads

Preview snapshots read at most four independent Worker chains concurrently. Each
chain still verifies the native identity, fully serving deployment, version
bindings, execution policy and schedules in order. Results retain input order;
a failure stops new reads and settles in-flight requests before returning an
error. Production and other environments retain serial Worker reads.

Preview account inventory reuses service and foreign Durable Object dependency
names from those same serving-version bindings, avoiding a second script-settings
request for every deployed Worker. It returns only validated dependency names;
secrets and variable values stay inside the client. Every plan and apply still
reads a fresh inventory and checkpoint catalog; nothing is cached across them.

Preview release preparation batches its public managed configuration into one
`pulumi config set-all --json` command after hydration and preparation. The final
value of a repeated key wins, matching sequential writes. Applied configuration
refresh, secret rejection, bootstrap-proof removal, unrelated config keys and
production's individual writes are retained. A failed batch stops before preview.
The pinned CLI was checked against individual writes in an isolated file backend,
including empty values, JSON strings, newlines, equals signs and an existing
unrelated encrypted secret.

Sanitized timing summaries now separate environment inventory, configuration,
stack catalog/export, Pulumi preview and apply. Only fixed labels, durations and
outcomes are recorded. CLI arguments, credentials and subprocess output are never
included. Inventory and command durations may be nested within workflow step
measurements and must not be added to those parent step durations.

The existing Pulumi `--refresh --run-program --parallel 1` policy, complete
ownership checks, saved-plan digest and checkpoint fingerprint checks remain in
force. Deployment-only inventory/configuration helpers can accompany a compatible
Auth code update without forcing backups; Worker configuration and schema changes
continue to select the full release path.

## Security analysis and optional coverage

**CodeQL security** runs on pull requests targeting `main` and manual dispatch.
It replaces GitHub's default setup: there is no automatic scan on a main push
and no weekly scan. The selector uses all changed PR paths, including the old
path of a renamed file, to select Actions, JavaScript/TypeScript, Python and Rust.
Each selected language still analyzes the complete repository. Documentation
and image changes alone skip analysis; unknown files and changes to the scanner
controls select all languages. A newer run cancels the superseded run for that PR.

Selection runs trusted base-branch code and checks the PR revisions before and
after reading the paginated file list. API errors, changed revisions and file
lists beyond the supported limit fail selection instead of silently skipping a
scan. No deployment secrets are used.

Use **CodeQL security → Run workflow → language: all** for a complete baseline,
including after direct pushes to `main` that bypass PR analysis. A single
language can be selected for a focused manual check. This removes duplicate
scans; it does not promise a shorter analysis of a given language. CodeQL is
separate from the Preview deployment gate.

**Coverage** is manual only. Required CI tests remain automatic. Changes limited
to these security/coverage workflows and their selector do not publish Preview
runtime or assets. Neither workflow adds Cloudflare schedules, pings or polling.
