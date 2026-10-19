# Rebuilding the stopped production environment

Production was destroyed through Pulumi on October 18, 2026, including its
application data, archives, Durable Object storage, and production state backend.
Its versioned definitions are retained for a future deployment. Restoring these
files does not create cloud resources or recover deleted data. Preview and the
independent shared plugin registry remain online.

## Definitions and operation gates

`infra/pulumi/Pulumi.production.yaml` describes the desired production D1/R2
resources and canonical origin, `https://savia.hefesoft.com`. The resource names
are retained; database IDs must come from a new applied stack. The generated
Worker manifests and deployment workflows remain available. Production Flows
remains disabled by the checked-in policy.

Production application deployment, backup, freshness checking, variable import,
and production Pulumi dispatch require the repository variable
`PRODUCTION_OPERATIONS_ENABLED` to equal `true`. Keep it unset or false while
production is stopped. The previously disabled GitHub workflows also remain
disabled; restoring source is not an instruction to enable them. Preview dispatch
does not require this production flag. Production Pulumi dispatch additionally
requires `main`; enabling the flag does not allow branch-controlled production
infrastructure updates.

## Future rebuild sequence

This is an operator checklist for a separately authorized rebuild, not an
automatic operation performed by this change.

1. Inventory Cloudflare again and confirm the desired production resource names
   are absent. If any exist, inspect ownership and import only those verified
   resources. Never treat the old deleted checkpoint as a current inventory.
2. Verify the independent protected management checkpoint and existing readable
   backend. Production must use that custody without creating or owning a state
   bucket. Review the exact production persistence plan using
   `environment.mjs plan --environment production --provision`; apply it only
   under separately authorized production gates and reviewed `main`.
3. Verify the empty persistence checkpoint, account, data IDs and create-only
   bootstrap proof before preparing an immutable release. Do not reuse the
   deleted production checkpoint or bootstrap through an application-owned
   backend. Keep Preview and shared-registry state unchanged.
4. Rehydrate the production application secrets from authorized private custody.
   Application secret copies were removed from GitHub and
   `production-backup` was deleted. Recreate the backup environment and its
   protections and configure its credentials before using it. Do not print or
   commit secret values. The seven secrets retained in the GitHub `production`
   environment serve the shared plugin registry; do not overwrite its backend
   settings or break that deployment when configuring the application. Separate
   the application environment or migrate registry credentials in a reviewed
   change before enabling application deployment.
5. Prepare one immutable production artifact and reviewed lifecycle plan. The
   standard first-install path verifies fresh empty persistence and starts
   paused maintenance endpoints before capturing its mandatory encrypted backup.
   Retained environments instead back up existing data before schema migration.
   Partial initialization fails closed and requires explicit reconciliation.
   Apply the saved plan through `environment.mjs`; do not deploy independent
   Worker versions or the historical domain-transition redirect bridge.
6. Verify the initialized environment, capture and restore-test a new encrypted
   backup, and run production preflight with the new outputs and credentials.
   Confirm successful Preview evidence for the intended release commit. Only
   then enable production operations and run the reviewed release. Attach the
   canonical production domain without old-host redirect routes and verify
   health, login, storage, tenant routing, and scheduled backups.

The cloud teardown is recorded in the
[dated operation audit](production-retirement-2026-10-18.md). The earlier
readiness/adoption records describe resources that no longer exist and are not
proof that a future deployment is ready.
