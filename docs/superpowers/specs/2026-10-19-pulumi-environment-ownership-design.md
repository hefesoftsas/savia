# Savia infrastructure ownership by environment

## Intent and approved direction

The user wants to administer Savia infrastructure through Pulumi and group all
resources by environment. They approved `preview`, `production`, `branch-*`,
`shared`, and `management` as the target structure. Destroying an application
environment must preserve its versioned definition and the infrastructure needed
to recreate it. This migration must preserve the running Preview application.

This document specifies the migration for review. It does not record a completed
migration or authorize production deployment or further data deletion.

## Current evidence

On October 19, 2026, the live Savia inventory contains 17 Workers: ten standard
Preview Workers, six retained branch-preview Workers, and the shared registry.
There are five D1 databases, seven R2 buckets, one Preview KV namespace, two
Preview queues, a Preview Workflow, a Preview Vectorize index, and eight Durable
Object namespaces attached to Preview Workers. The standard Preview Custom Domain
and wildcard route remain active. Production has definitions but no deployed
application resources. The previously deleted legacy resources stay absent.

The `savia-cloudflare/preview` stack already owns standard application persistence,
Flows data/queues, and the protected `savia-pulumi-state-preview` bucket. The
`savia-shared-registry/shared` stack owns the registry bucket. Existing checkpoint
keys for those two stacks are present in that state bucket. The retained branch
preview has no checkpoint in that backend; the migration must inventory all
configured backends before treating its resources as unowned.

Worker publication, bindings, migrations, domains, schedules, Workflow attachment,
and queue-consumer configuration currently run through Wrangler. The root Pulumi
program intentionally excludes those runtime resources. Existing deployment
preflights also assume the application stack owns its state bucket.

## Stack boundaries

| Environment     | Existing project / target project | Ownership                                                                          |
| --------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| `preview`       | `savia-cloudflare`                | Standard Preview runtime, application data, Flows, search, domains and routing     |
| `production`    | `savia-cloudflare`                | Equivalent isolated production resources; definition retained, deployment disabled |
| `branch-<slug>` | `savia-branch-preview`            | Only that branch's runtime, two D1 databases and documents bucket                  |
| `shared`        | `savia-shared-registry`           | Shared plugin registry Worker and its protected bucket                             |
| `management`    | new `savia-management`            | Protected Pulumi state/backend buckets; no application data or runtime             |

Keep existing project names, resource names, URLs, database IDs, namespace IDs,
and resource URNs wherever possible. Environment grouping does not require
renaming Cloudflare resources or creating a new backend bucket. In particular,
`savia-pulumi-state-preview` can be owned by `management` without changing its
physical name or moving the checkpoints it stores.

The retained `feat-secop-tender-tracke` preview is adopted into its branch stack,
not deleted. Its disposal question remains separate from this migration.

## Ownership model and alternatives

Three approaches were considered:

1. Keep persistence-only Pulumi stacks and provide an inventory report. This
   improves visibility but leaves application retirement incomplete.
2. Adopt the environment runtime lifecycle into Pulumi while retaining the tested
   Wrangler publisher. This preserves current assets, migrations, bindings and
   rollback behavior and is the recommended approach.
3. Replace all publication with native Pulumi WorkerVersion/deployment resources.
   This provides a different publication model but also changes asset delivery,
   secrets, namespace migrations and recovery. It is outside this migration.

For approach 2, each environment has a Pulumi runtime component with two
responsibilities:

- Native `cloudflare.Worker` resources own Worker identity and lifetime. Their
  arguments declare only identity/lifecycle fields; explicit ignore rules prevent
  refresh or update from reconciling Wrangler-owned metadata. Imports do not
  publish versions.
- A Pulumi-managed `RuntimeRelease` resource invokes the existing Wrangler and
  recovery helpers for code, bindings, assets, migrations and attachments. Its
  adoption mode reads and records live versions without running a deployment.
  Release mode requires explicit immutable build/configuration digests. Its delete
  operation retires attachments and detaches internal references before the native
  Worker resources are deleted.

Routes, domains, cron triggers, queue consumers and Workflows remain exclusively
published by that runtime resource through the existing Wrangler manifests; do
not add a second set of native attachment resources while those declarations
remain present. The runtime resource records every attachment identity in its
inventory and explicitly removes orphan-prone Workflows during retirement.
Durable Object classes and migrations stay in the existing publisher. Their
namespace identities are recorded, not independently recreated.

Artifact/configuration digest changes update the existing `RuntimeRelease` in
place. Its provider's `diff` must not request replacement for a normal release;
`update` keeps the same resource identity and never runs retirement as part of
successful publication. Environment/account/Worker-identity changes are rejected
and require a separate reviewed migration, rather than default create-before-delete
replacement. Only explicit environment retirement invokes its delete operation.

A failed update uses the existing recovery mechanism to restore previous code
versions while preserving required maintenance/pause policy. Verify the actual
restored versions and attached resources; if recovery is incomplete, fail closed,
keep the environment paused and report the live mismatch. Do not mark the release
successful or start a second owner. The integration fixture must exercise both a
successful in-place update and a failed update with rollback.

This makes Wrangler an implementation tool beneath the Pulumi release lifecycle,
not a second independent deployment path. Release, maintenance, migration, secret
upload and recovery steps must use that lifecycle entrypoint. Do not simply add
Worker imports and claim the existing parallel deployment scripts are now managed.

The native Workers and data exist before the runtime resource releases code. For
a future empty environment, bootstrap private unavailable placeholders to break
service-binding cycles, then deploy the coordinator and applications in the
existing dependency order. Attach public ingress last. The integration fixture
must establish whether native Worker creation alone provides a bindable target;
otherwise placeholder publication is mandatory before binding callers.

A disposable integration fixture must prove read-only adoption, first deployment,
normal release, refresh, rollback, namespace preservation and complete retirement
with the pinned provider. Runtime deletion first stops schedules/producers and
removes ingress, verifies no outside-environment references, then detaches internal
service and cross-script bindings in stages. Native Worker deletion remains
`force:false`; do not bypass cycles with forced deletion. The runtime resource
must not capture or emit credential values in serialized provider code or state.

If this fixture fails, stop before moving live runtime ownership and revise the
design. Do not publish a persistence-only or identity-only implementation as full
environment lifecycle management.

## Environment operations

Provide one repository entrypoint with explicit environment selection for
inventory, adoption, plan, apply and destroy. It resolves the existing project,
stack and backend; callers cannot provide arbitrary resource names to destruction.
There is no implicit production target or missing-stack fallback in deployment.

Inventory reports declared environment, owning stack, cloud identity and whether
a resource is managed, unattached or missing. Classify by validated names and
bindings, not Cloudflare's Worker-version label `production`, which Preview also
uses. Do not infer ownership from a `savia` prefix alone.

Adoption validates exact live IDs against an allowlisted manifest. Its plan may
import existing resources and register stack/provider metadata and the runtime's
adoption bookkeeping, whose create handler is verified read-only. It may not
create, replace, update or delete a cloud resource. The manifest contains resource
metadata only; credentials and business data remain outside the repository.
Existing resources owned by another checkpoint must be moved, never imported into
two stacks. One-time import inputs must not prevent a future clean rebuild. Record the actual
enabled runtime profile: adopting the retained six-Worker branch must not create
a seventh Worker merely because a newer renderer has an additional service.

Apply preserves the current saved-plan checks against destructive updates.
Production operations continue to require the explicit enable flag, `main`,
Preview evidence and the protected environment. This migration does not initialize
or apply production application infrastructure.

Destroy requires the explicit target environment and a reviewed resource manifest.
It rejects outside-environment callers and references before retiring Workers,
removes ingress and scheduled producers first, and removes runtime dependencies
before data. Data deletion requires a distinct explicit choice. `shared` and
`management` are protected and excluded from ordinary application destruction.
All code/configuration and the state backend survive an application teardown.
When data is retained, its resources remain in the environment stack and only the
runtime is retired; do not remove a nonempty stack. A subsequent release must
recreate runtime identities without stale one-time imports and bind the same data
resources.

Existing release backup, quiescence, rollback and migration checks remain in
force. Maintenance deployments are releases of the same managed Worker identity,
not additional owners of that resource. CI must call the environment entrypoint
rather than keep a parallel direct destruction path.

## Backend ownership migration

1. Resolve actual backend locations from authorized private configuration and
   validate account, stack identity, encryption and readable checkpoints. Do not
   infer effective CI secret values from checked-in YAML.
2. Export encrypted checkpoints and matching stack configuration to private local
   files. Preserve the existing passphrase and credentials in their current
   custody; do not rotate or disclose them as part of this migration.
3. Suspend state-mutating workflows and wait for in-flight operations. Existing
   per-environment concurrency locks do not serialize a cross-stack move.
4. Initialize `savia-management/management` on the existing readable backend and
   move only the protected backend-bucket resource with `pulumi state move`.
   Coordinate the source/program change so Preview no longer declares that
   resource. Do not use `state rm` or duplicate import to simulate the transfer.
5. Preserve `stateBackendBucketName` and `stateBackendUrl` output compatibility as
   validated references, not application-stack ownership. Update preflight and
   destroy checks to verify the independently protected management stack.
6. Preview both affected stacks with refresh. Expect no bucket creation,
   replacement or deletion. Verify Preview and shared checkpoints and operations
   remain accessible before re-enabling workflows with their original settings.

The initial migration keeps the physical backend URL. A backend rename, a new
physical bucket or migration to Pulumi Cloud is not needed. If discovered
credentials cannot read an existing backend, stop that transfer and report the
specific missing access; never create replacement application resources.

## Implementation surfaces

- Add the protected `infra/pulumi/management/` project and its tests.
- Add environment inventory/manifest validation and lifecycle orchestration under
  `infra/pulumi/`, sharing existing naming and output validators.
- Extend standard, branch and shared programs with native Worker identities and
  the managed runtime release resource; preserve output compatibility and expose
  a complete inventory of the runtime's attached resources.
- Implement adoption/read/diff/release/delete behavior for the runtime resource
  with immutable artifact inputs and the existing rollback/maintenance helpers.
- Adopt Vectorize through a dedicated validated Pulumi resource/provider rather
  than leaving its standalone provisioning script outside the lifecycle.
- Move backend ownership out of the root application program and update production
  preflight, destroy guards and infrastructure actions accordingly.
- Adapt preview, production, branch and registry deployment flows to the chosen
  ownership contract while retaining release ordering and recovery checks.
- Update the infrastructure, Preview/production and rebuild guides; do not remove
  production definitions or enable its deployment.

## Acceptance and rollback

Tests must reject cross-environment identities, duplicate ownership, missing or
wrong backends, inconsistent imports, destructive adoption plans, foreign callers,
and shared/management resources in an application destroy set. Also test
adoption of the existing six-Worker branch profile without creating optional
resources, and ensure adoption mode never invokes Wrangler deployment. Release digest changes must
produce an update, not a replacement, and a failed update must not leave duplicate
owners or attachments. Include the case
where Preview's domain API reports Cloudflare environment `production`.

Before live adoption, run the disposable lifecycle integration fixture and focused
contract/type checks. During migration, record refreshed plans and compare live
identities, Worker versions, bindings, namespace IDs, routes and data-resource
inventories before/after. All retained identities remain unchanged; Preview health,
login and authenticated registry access continue working. Production stays absent.

A repeated adoption must be idempotent and yield no cloud mutations. After final
adoption, every retained Savia resource has one environment and one lifecycle
owner, including Vectorize and attached runtime resources. Report any unsupported
resource explicitly instead of silently marking it managed.

On validation failure, keep state-mutating automation paused, retain private
checkpoint exports and restore ownership through the reverse verified state move
or matching checkpoint recovery. Do not roll back cloud data, recreate resources,
or remove resource protection. Re-enable workflows only after both checkpoints
and the corresponding source revision agree.

## References

- [Pulumi stacks](https://www.pulumi.com/docs/iac/concepts/stacks/)
- [Moving resources between stacks](https://www.pulumi.com/docs/iac/operations/stack-management/moving-resources-between-stacks/)
- [Cloudflare Pulumi and Wrangler integration](https://developers.cloudflare.com/pulumi/tutorial/dynamic-provider-and-wrangler/)
