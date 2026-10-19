# Production application retirement — October 18, 2026

The user requested removal of the production deployment and explicitly confirmed
permanent deletion of its data. Preview is now the only hosted Savia application
environment. The independent shared plugin registry remains available to Preview.

## Scope correction

The user subsequently clarified that the intent was to destroy the deployed
environment through Pulumi while retaining its infrastructure definitions for a
future deployment. Removing those definitions in PR #350 exceeded that intent.
The definitions and workflows are restored with production operations disabled;
Preview remains the only running application environment. See
[production rebuild](production-rebuild.md). This correction does not undo the
cloud destruction or recover the production data and backups that were deleted
with explicit confirmation. The repository changes below record the original
retirement operation, not the final desired repository state.

## Infrastructure operations

The original production Pulumi stack managed data resources, while Wrangler had
published application Workers and host attachments. A bounded, local Pulumi
retirement stack adopted the exact live production runtime graph without
republishing code. Its reviewed destroy removed nine Workers, three custom
domains, and two routes. Worker deletion included their production-only Durable
Object namespaces; Preview's namespace IDs were independently checked to differ.

The retired Worker names were `savia`, `savia-agencies`, `savia-auth`,
`savia-backup-coordinator`, `savia-connectors`, `savia-domain-transition`,
`savia-hook-executor`, `savia-mcp`, and `savia-request`. The domains were
`savia.hefesoft.com`, `savia.app.hefesoft.com`, and
`savia-team.savia.app.hefesoft.com`; the root/wildcard bridge routes were removed.

The production data checkpoint was exported to a private local backend before
teardown so its own remote state bucket could be deleted last. Deletion
protection was removed only from this retired production checkpoint. The two
production D1 databases were deleted, as were:

- `savia-documents` after removing its 23 objects.
- `savia-production-backups` after removing its 22 objects and retiring its
  lifecycle and disabled public-domain resources.
- `savia-pulumi-state` after removing its 18 metadata objects.

The backend inventory established that `savia-pulumi-state` contained only the
production checkpoint. Preview and shared-registry checkpoints reside in
`savia-pulumi-state-preview`, which was preserved. No restore or migration of
production business data into Preview was performed.

The backup-reader token could inventory but not delete Workers/routes. The
successful Pulumi destruction used the existing authenticated Wrangler session;
no token was created and no account permission was expanded. Native Worker
adoption does not retain the delete-only `force` argument, so it was set in the
private retirement checkpoint for the exact nine approved Workers before destroy.
The `force` consequence (owned Durable Object data deletion) was explicitly in
scope. Private checkpoints and provider logs are operational evidence, not
recreation instructions.

## Repository and automation

The production application deployment, daily backup, freshness check, and Request
variable-import workflows were removed. Pulumi dispatch is fixed to Preview;
`Pulumi.production.yaml` was removed. The checked-in Admin gateway also targets
Preview's hostname, API service, and document bucket. Historical runbooks remain
marked as retired evidence; generic environment-aware helpers and production-mode
runtime checks are not deployment authorization.

The shared registry is a separate service. Its existing protected GitHub
`production` environment is retained solely as the registry's credential store;
this name does not denote a surviving Savia production application. Application
secret copies were removed from that environment, retaining only the registry's
seven required secrets. The production-backup environment was removed. Moving
the registry's credential store to a differently named environment would require
a separately controlled secret migration, not deleting Preview's dependency.

Unrelated legacy Workers and zone-level email configuration are outside the
confirmed production deployment graph and were not deleted. The application
hostname wildcard DNS record was removed; managed hostname certificates entered
Cloudflare's deletion process when their custom domains were removed. The
Preview certificate and universal zone certificates were preserved.

## Validation

- Independent review matched every runtime deletion target to the approved live
  manifest and found no Preview/shared-registry binding into the deletion graph.
- The runtime Pulumi destroy reported 15 deletions (14 cloud resources and its
  local stack); the data destroy removed six data resources, then its backend.
- Focused infrastructure, workflow and domain contracts passed: 251 tests.
- The full `pnpm test:contracts` suite passed: 512 tests, no failures or skips.
  Formatting and `git diff --check` also passed. Application unit/type-check
  lanes are delegated to the required pull-request CI checks.
- Live resource inventory and Preview health/login checks are the final
  acceptance evidence. DNS and certificate removal may propagate asynchronously;
  a stale resolver response must not be mistaken for a surviving application.
