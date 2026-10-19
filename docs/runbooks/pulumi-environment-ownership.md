# Environment ownership and controlled migration

Savia groups Cloudflare resources through Pulumi projects/stacks and a validated
inventory. Cloudflare does not provide folders covering all resource types.

| Environment | Pulumi project/stack                 | Lifetime                             |
| ----------- | ------------------------------------ | ------------------------------------ |
| Preview     | `savia-cloudflare/preview`           | Current application and persistence  |
| Production  | `savia-cloudflare/production`        | Defined, absent, operations disabled |
| Branch      | `savia-branch-preview/branch-<slug>` | Isolated runtime and persistence     |
| Shared      | `savia-shared-registry/shared`       | Protected registry Worker and bucket |
| Management  | `savia-management/management`        | Protected existing state backend     |

Native Worker resources own identity/lifetime with `force:false`. One dynamic
`RuntimeRelease` per environment owns code, bindings, Workflow declarations,
routes, domains, schedules and consumers through the existing Wrangler helpers.
There are no competing native attachment resources. D1/R2/KV/queues/Vectorize
remain separately owned persistence resources. Secrets come from existing
operation-time custody and never enter artifacts or dynamic provider inputs.

## Ordinary operations

Run from the repository root using the matching existing backend credentials:

```sh
node infra/pulumi/environment.mjs inventory --all
node infra/pulumi/environment.mjs inventory --environment preview --out /secure/preview.json
node infra/pulumi/environment.mjs adopt --environment preview --manifest /secure/preview.json
node infra/pulumi/environment.mjs adopt --environment preview --manifest /secure/preview.json --apply
node infra/pulumi/prepare-release.mjs --environment preview --out /secure/release
node infra/pulumi/environment.mjs plan --environment preview --artifact /secure/release --plan /secure/release-plan.json
node infra/pulumi/environment.mjs apply --environment preview --artifact /secure/release --plan /secure/release-plan.json --apply
node infra/pulumi/environment.mjs destroy --environment preview --manifest /secure/preview.json --apply
```

The last command retires ingress/producers/runtime while retaining data. DO
hosts and opaque-secret hosts remain inert because deleting them would destroy
namespace data or unrecoverable keys. `--delete-data` is a separate permanent
deletion request. It is never implied by `--force` on the legacy branch wrapper.
Shared and management cannot be destroyed through application operations.
Production requires both the existing explicit operations flag and reviewed
`main`; this migration does not enable either production deployment or deletion.
Preview inventory accepts checkpoint-exported database names only when they
exactly match its isolated `savia-auth-preview` and `savia-agencies-preview`
names. These outputs are observations, not production-only naming overrides;
foreign or swapped names stop inventory before adoption.
Cron expressions are identified within their owning Worker: API and Flows may
use the same schedule, while repeated names on one Worker or repeated physical
identities are rejected.

For a separately authorized new environment, `plan --environment <id>
--provision --apply` creates persistence first. Prepare the frozen release only
after actual binding IDs exist. Exact create-only custody and physical empty
storage checks gate first-install schema initialization. A retained environment
never takes that initialization path. See the detailed
[infrastructure runbook](pulumi-infrastructure.md) for maintenance and backups.

A release freezes code, Wasm modules, assets, both SQL migration histories and
its exact source commit. Compilation happens once. A saved plan binds account,
environment, artifacts, source revision and checkpoint fingerprint. Standard
publication pauses writers, captures encrypted persistence recovery, migrates,
uploads secrets through stdin, publishes in dependency order and verifies health.
Provider recovery handles publication failures; CI never starts a competing
restore. Flows policy refresh observes persisted pauses after recovery. An
intentionally execution-disabled profile remains valid.

Standard Preview/production deployment jobs defer normal GitHub cancellation
once their exact runtime plan has succeeded: the guarded apply step finishes
publication or provider recovery before stopping. Cancellation before or during
planning skips application. This uses GitHub's documented
[job and step cancellation conditions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation),
with all production, trigger and dependency gates preserved. Force cancellation,
runner loss and job timeout can still interrupt a transaction; retain private
recovery evidence and reconcile the checkpoint and live versions before retrying.
An interrupted transaction must not be treated as a verified release.

Branch commands retain trusted lifecycle tooling and renderers from `main`.
Selected code is pinned separately. Labeled PR asset builds run in a separate
job without deployment secrets, and the deployment job uses the resulting
artifact without executing PR build scripts with credentials. Normal shared
registry publication preserves `PLUGIN_REGISTRY_CREDENTIALS` in its existing
protected GitHub environment; this migration does not rotate or relocate it.
Plugin ZIP/Office object publishing remains a content operation, outside Worker
identity ownership. The exclusive plugin-only Preview lane remains intact.

## One-time ownership transfer

The protected Preview environment currently admits only `main`. Therefore
required checks and independent review precede a controlled merge while mutating
workflows are frozen. Do not relax the environment policy to run a branch with
its credentials. The state/source switch must finish before automation resumes.

1. Record all nine mutating workflows' IDs, paths and original `active` or
   `disabled_manually` states privately. The production deployment, backup,
   freshness and import workflows must already be disabled. Keep CI active.
2. Disable the recorded mutators except `pulumi.yml`, wait for in-flight changes
   and coordinate local operators. Merge the reviewed implementation with normal
   required checks. Keep the external freeze journal for restoration/recovery.
3. Dispatch `Pulumi infrastructure` on that exact `main` with
   `operation=ownership-audit`. Its protected Preview credentials read every
   existing known backend. Inspect the metadata-only audit artifact, actual
   checkpoint identities/protection and the expected retained branch. A missing
   backend permission is a stop condition; never create broader credentials or
   bind the state bucket to a Worker as a workaround.
4. Dispatch `operation=ownership-migrate` with that successful `audit_run_id`
   and the original-workflow JSON array. The helper disables its own workflow,
   verifies all nine are frozen and no other mutating run is active, then
   compares live custody with the reviewed audit again.
5. The helper initializes an empty management checkpoint in the same existing
   backend, snapshots configuration/checkpoints privately and runs one exact
   `pulumi state move`. The physical bucket, backend URL and application data
   remain unchanged. Management's saved update must propose no cloud writes.
6. Exact manifests adopt Preview runtime/search, the shared Worker and retained
   branch data/runtime. One-time import inputs are cleared. Two refreshed plans
   and metadata fingerprints must preserve cloud identities, versions,
   namespaces, bindings, routing and data resources. Production must remain
   `defined-not-deployed`. Preview health is checked before reactivation.
7. Only after source/checkpoints agree does the helper restore originally active
   workflows. Production stays disabled. Keep metadata evidence separately from
   encrypted private checkpoints/configuration/journals. The workflow encrypts
   its private evidence using existing Preview backup custody.

On any failure, mutating automation stays frozen. Preserve the encrypted private
artifact and inspect the last recorded stage in `backend-move/journal.json`,
checkpoints and configuration copies. The exact reverse state move is available
only after verifying which checkpoint currently owns the bucket; do not import a
second owner, run `state rm`, recreate a backend, or overwrite a newer checkpoint
from an old export. Reconcile reviewed source and state before reactivation.

Source integration and live adoption are separate milestones. The existence of
these definitions, unit tests or a merged PR is not evidence that live adoption
has completed. Record actual run IDs and final inventory in a dated acceptance
record after the operation succeeds.

The migration freeze skips workflows already manually disabled: GitHub rejects
a repeated disable request with HTTP 403. It disables only currently active
mutators, then rechecks every workflow state and in-flight run before touching
Pulumi state. Unexpected workflow states stop the operation.

Pulumi 3.268 exports a newly initialized stack with a version-3 deployment
manifest and no `resources` property. This is an empty readable checkpoint,
not management protection evidence. Audits and backend transfer accept that
shape without rewriting the exported checkpoint; pending operations and
malformed resource lists still stop the operation.

Dry import plans may contain `newState.importID` before a physical `id` or
outputs are resolved. The plan reader validates its exact account and native
resource path, then compares the physical identity, kind and name with the
reviewed manifest. Foreign accounts, unexpected path segments and conflicting
resolved IDs are rejected.

Worker reads omit the delete-only `force` flag. Desired identities retain
`force: false` and `protect: true`; ignoring readback drift on that flag avoids
a follow-up Worker update after import. Adoption continues to reject all
provider updates, including updates that would only set `force: false`.
