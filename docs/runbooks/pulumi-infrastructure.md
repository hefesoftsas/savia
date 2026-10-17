# Savia infrastructure and disaster recovery

Owner: infrastructure. Review date: 2026-10-17.

`infra/pulumi` is the authoritative infrastructure project for standard
preview/production, temporary branch previews, the isolated plugin editor, and
the shared plugin registry. Each deployment profile has its own Pulumi project
and state; shared resources are never owned by a disposable preview stack. Pulumi owns D1, R2, optional Flows KV/Queues,
and the protected state bucket. `worker-config.mjs` and
`flows-worker-config.mjs` and `auxiliary-worker-config.mjs` declare Worker names, bindings, routes, cron,
Workflows, SQLite Durable Object migrations, limits, and private service bindings.
Wrangler is the only publisher of Worker code and these attached constructs;
do not add overlapping Pulumi WorkerScript, Workflow, consumer, or cron resources.
The old `scripts/render-cloudflare-production-config.mjs` is a compatibility
entrypoint, not a second set of declarations.

No Pulumi Cloud account is required. The CLI is Apache 2.0, and the preview
checkpoint is stored in a private R2 backend. The backend bucket is always
protected, even for preview, and is excluded from application teardown.
Secrets in checkpoint/configuration are encrypted with the stack passphrase.
Do not pass `--show-secrets`, commit checkpoints, or expose the state bucket.

## Backend setup (once per machine/CI)

```sh
cd infra/pulumi
npm ci --ignore-scripts  # standalone, outside pnpm workspace
pulumi login 's3://savia-pulumi-state-preview?endpoint=<account>.r2.cloudflarestorage.com&region=auto&s3ForcePathStyle=true'
# passphrase from infra/secrets/ (gitignored), never committed:
export PULUMI_CONFIG_PASSPHRASE="$(cat ../../infra/secrets/pulumi-passphrase)"
pulumi stack select preview   # or: production
pulumi config set --secret cloudflare:apiToken "$CLOUDFLARE_API_TOKEN"
```

CI uses environment secrets `PULUMI_BACKEND_URL`,
`PULUMI_CONFIG_PASSPHRASE`, `R2_STATE_ACCESS_KEY_ID`, and
`R2_STATE_SECRET_ACCESS_KEY`, in addition to its existing Cloudflare token.
The S3 credentials authenticate the backend; the Cloudflare token authenticates
the infrastructure provider. See `.github/actions/pulumi-infrastructure` and
`.github/workflows/pulumi.yml`. Production needs its own imported stack and
backend credentials before promotion; preview adoption does not configure it.

To bootstrap a backend, first import and apply the existing application resources.
Configure `stateBucket` as `savia-pulumi-state-preview` (or
`savia-pulumi-state` for production), inspect a plan that creates only that
protected bucket, then apply it. Migrate the checkpoint with Pulumi 3.268.0:

```sh
# Keep a private backup of the source configuration and checkpoint.
pulumi stack export --stack preview --file /private/preview-checkpoint.json
pulumi login "$PULUMI_BACKEND_URL"
pulumi stack migrate 'file://<original-backend>' preview --secrets-provider passphrase --yes
pulumi preview --stack preview --refresh  # all application resources unchanged
```

Migration keeps the source checkpoint. Never initialize an empty target stack
against existing D1/R2 resources. Keep migrated configuration backups private.

## Import existing resources (once per stack)

Import is read-only on the cloud side; it only records state. Preview stack
(account `08a0d36f8b0357684f83e4bfeb6628b6`):

```sh
pulumi import --yes cloudflare:index/d1Database:D1Database auth-db '08a0d36f8b0357684f83e4bfeb6628b6/ac2ab38e-41ef-477d-9c40-55e431f09bf0'
pulumi import --yes cloudflare:index/d1Database:D1Database domain-db '08a0d36f8b0357684f83e4bfeb6628b6/4c466412-e220-470e-b5d8-d23bf87e87a1'
pulumi import --yes cloudflare:index/r2Bucket:R2Bucket documents '08a0d36f8b0357684f83e4bfeb6628b6/savia-documents-preview/default'
pulumi preview --stack preview   # must report no resource changes
```

Notes: imports land `protect: true`; run `pulumi state unprotect <urn> --yes`
for preview resources so the stack stays destroyable (production keeps it).
D1 `readReplication` is ignored in code (provider refresh bug, would 400 on
apply). Production lives in another account and needs its own token + IDs.

## Deploy

```sh
node deploy-stack.mjs --stack preview --apply   # refreshed, saved, non-destructive plan
node render-from-outputs.mjs --stack preview    # wrangler.*.jsonc from outputs
# then upload secrets, apply migrations, and publish Worker code with Wrangler
```

The normal deployment workflows load the imported stack first, verify preview
isolation, apply a saved plan that refuses deletion/replacement, and render again
from the applied outputs. Migrations, Office uploads, plugin releases, and health
verification consume those exported IDs rather than GitHub resource-ID variables.
A missing backend or stack fails closed; there is no fallback to manual IDs.
The exported `cloudflareAccountId` must match `CLOUDFLARE_ACCOUNT_ID` before
Pulumi apply, rendering, publishing, and restore; infrastructure and Wrangler
cannot silently target different accounts. Disabled Flows/search flags are
explicitly cleared so inherited process variables cannot activate services.

## Other deployment profiles

- `branch-preview/` owns each temporary branch's two D1 databases and R2 bucket.
  Its validated `branch-<slug>` stack adopts existing exact names before applying;
  `branch-preview-worker-config.mjs` declares its Workers. The existing
  `scripts/preview-deploy.mjs` / `preview-destroy.mjs` entrypoints use this state.
  They never provision or delete databases/buckets directly with Wrangler.
  The preview CI environment supplies the same remote backend credentials.
- `shared-registry/` owns the protected existing `savia-plugin-registry` bucket
  in the independent `shared` stack. Existing bucket policies remain intact.
  First adoption requires explicit operator bootstrap in that project:

  ```sh
  cd infra/pulumi/shared-registry
  pulumi login "$PULUMI_BACKEND_URL"
  pulumi stack init shared --secrets-provider passphrase
  pulumi config set accountId "$CLOUDFLARE_ACCOUNT_ID"
  pulumi config set adoptExisting true
  pulumi preview --refresh  # inspect the import; no bucket replacement
  pulumi up                # adopt the existing protected bucket
  node render.mjs
  ```

  The registry workflow only selects an existing shared stack; it does not
  bootstrap one or create a replacement bucket. Provision its backend secrets in
  the production GitHub environment before using the workflow. The generated
  `apps/plugin-registry/wrangler.production.jsonc` preserves the public
  authenticated workers.dev service; the checked-in manifest is local-only.

- The plugin editor preview manifest is generated by the standard renderer;
  its checked-in `wrangler.jsonc` is local-only. It has no data storage bindings.
- `vectorize.mjs` declares and explicitly bootstraps the existing isolated Pages
  search index through Cloudflare's API because the installed provider has no
  Vectorize resource. The legacy script is only a compatibility wrapper. This
  operation is not called by normal deployments and needs separate entitlement
  and token scope; it never activates during Flows adoption.

`pnpm setup` now bootstraps application secrets, migrations and code from an
already adopted production stack. It validates the planned origin/bucket before
applying IaC and refuses a missing stack or disagreement; it no longer creates
D1/R2 resources independently. Local Miniflare manifests remain under each app
and do not provision cloud resources.

## Production readiness

`Pulumi.production.yaml` records the production account and existing D1 names
verified on 2026-10-17. Production and preview share the same Cloudflare account;
their resource names and separate stacks provide isolation. Explicit production
D1 names preserve the existing canonical databases instead of planning replacements.
The protected `savia-pulumi-state` bucket is configured but does not yet exist.
Both Flows flags remain false. Supply `CLOUDFLARE_API_TOKEN` through the environment
or encrypted Pulumi config. See the [dated readiness evidence](production-readiness-2026-10-17.md)
for the local adoption, refreshed remote plan, and remaining promotion gates.

Before promotion, the infrastructure owner must:

1. Preserve the local adoption of the existing auth/domain D1 databases and
   documents bucket. After reviewing the create-only plan, provision the protected
   state bucket and migrate the checkpoint to it. Re-run a refreshed preview;
   do not initialize an empty remote stack against existing resources.
2. Configure the production GitHub environment's backend URL, passphrase,
   R2 state credentials, and Cloudflare credentials. Back up the passphrase
   separately; losing it prevents checkpoint decryption.
3. Configure `SAVIA_BACKUP_KEY` as a stable 256-bit hex key in the external
   secret store and production environment. Preserve it independently of GitHub
   artifacts. Flows additionally requires all four runtime secrets and
   `SAVIA_FLOWS_BACKUP_KEY` before any pause or rollout.
4. Run `node infra/pulumi/production-preflight.mjs` with those credentials.
   It checks selected config and outputs, exact account/backend/origin,
   imported resources and deletion protection, stable recovery keys, and
   current/planned Flows policy. It does not apply IaC or publish code.
5. Review a refreshed non-destructive Pulumi plan, confirm a successful encrypted
   recovery artifact and rehearsal, and verify the exact commit's preview proof.
   These live checks are operator prerequisites, not evidence supplied by unit tests.

The production deployment validates readiness before mutation and retains a
verified encrypted persistence backup before IaC apply or schema migrations.
Existing Flows is paused and snapshotted first. The conditional rollout publishes
the hook executor, then Flows, then the API, with migrations, secrets, health
verification, and failure recovery. Failure recovery preserves the execution pause even when prior Worker versions
are restored. Resume deliberately after inspection; never bypass migration checks or assume code rollback undoes schema changes.

## Savia Flows (explicit environment policy)

`flowsEnabled` defaults to false. The checked-in preview configuration now has
`flowsEnabled: true` and `flowsExecutionEnabled: true`; production explicitly has
both false. These are desired settings, not proof of live deployment.
To pause an existing environment, keep resources provisioned and set execution
false; turning provisioning off would request resource deletion and is rejected
by the non-destructive deployment path. When provisioning is false, Pulumi
creates no Flows resources, the renderer adds no `SAVIA_FLOWS` host binding,
and stale generated Flows manifests are removed.

The optional resources are one D1, one KV namespace, three R2 buckets, and two
Queues (execution and dead-letter) with isolated environment names. Their actual outputs feed the private
Flows Worker manifest: resilient Workflows, five SQLite Durable Object classes,
Queue producer/consumer, cron, reciprocal host services, and a private
`CODE_EXECUTOR` service binding to the environment-matching
`savia-hook-executor` service's `FlowsExecutor` entrypoint. It has no WorkerLoader
binding. Publish or update the shared hook executor before publishing Flows so
the named entrypoint is available.

Production activation remains an explicit later rollout: import any existing resources first, explicitly
review `flowsEnabled: true`, apply the resource plan, migrate the Flows D1 schema,
configure the required bridge/signing/encryption secrets, publish or update the
shared hook executor, publish Flows against the existing API, then publish the
API with its Flows binding. The default production configuration does not activate Flows, AI, browser,
containers, external email, or Analytics Engine. Preview keeps its restricted
node catalog, quotas, and private executor.

## Destroy an environment

```sh
node destroy.mjs --stack preview --dry-run
node destroy.mjs --stack preview --apply
# production refuses without both flags:
node destroy.mjs --stack production --apply --i-understand-destroy-production
```

Production resources are created with `protect: true`; `pulumi destroy`
fails on them until protection is lifted. Preview application resources are unprotected
and cheap to tear down; the protected state bucket is retained. Worker code is deleted by `wrangler delete` only
via `scripts/preview-destroy.mjs`, not by these scripts.

## Backups (data, not just infra)

Pulumi recreates empty containers; backups capture the data. Production deploys
now require a successful encrypted backup before IaC apply and migrations.
`.github/workflows/backup-production.yml` also declares a daily capture at
08:23 UTC (03:23 America/Bogota) and supports manual dispatch. It shares the
`savia-production` concurrency lock with deployment, retains only encrypted
GitHub artifacts for 30 days, and removes plaintext files even on failure.
The schedule takes effect when the workflow reaches the default branch; no
schedule or cloud deployment is created by editing these files locally.

The daily workflow uses the dedicated `production-backup` GitHub environment,
separate from the reviewer-protected deployment environment. Configure its main
branch restriction and backup/backend credentials before activation; do not remove
production deployment approvals. The local workflow does not create or configure
that environment. Preserve the stable `SAVIA_BACKUP_KEY` and Pulumi passphrase in
independent durable custody.

The daily runner requires `SAVIA_BACKUP_CONTROL_SECRET` in the dedicated backup
GitHub environment and the same secret in the production API Worker. It is an
independent control credential, not the encryption key. The optional
`SAVIA_BACKUP_CONTROL_URL` defaults to the canonical HTTPS controller route.
Generated production/preview manifests attach `BACKUP_GATE` to every D1/R2 writer;
the private `savia-backup-coordinator` Worker owns the `BackupCoordinator` namespace
and its `v1` migration.
Release workflows publish this owner before dependent workers. The owner has no
application storage bindings or public route. Cross-script
bindings use the actual environment-specific worker name, as described in
[Cloudflare's binding configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#durable-objects).

Before capture, the controller checks the live Auth, request and connector
capabilities against its namespace. The runner closes admission, waits up to
60 seconds for in-flight storage operations, renews a three-minute lease every
30 seconds, verifies ownership after copying, and releases on success/failure.
Capture is rejected if the 15-minute maintenance budget expires. A killed runner
cannot leave a permanent pause: its lease expires. Unresolved writer permits fail
the next drain rather than being silently discarded. Storage operations,
including Auth session reads which can write, are temporarily unavailable during
the maintenance window. Preview load/latency validation is required before
activation because each D1 execution and R2 mutation uses central durable permits.
Flows is currently absent from production; unattended capture fails closed if its
independent persistence is provisioned until its pause lifecycle is integrated.

`node scripts/production-backup.mjs --artifact <absolute-output.enc>` captures,
validates all database/document targets and their hashes, compresses under a
`production-backup/` root, encrypts, decrypts privately and compares archive hashes.
It retries only typed D1/R2 consistency drift, at most three attempts with 60/120
second delays and a fresh private directory each time. Identity, schema,
credential and validation errors fail immediately. All plaintext is removed
on success or failure; only a verified ciphertext can reach artifact upload.

`.github/workflows/check-production-backups.yml` checks every six hours without
using an approval-gated environment. It fails when no nonexpired encrypted artifact
from a successful `main` backup run is at most 36 hours old. It rejects failed
runs, unrelated/empty artifacts, future timestamps and denied API reads. It reads
up to 100 recent backup runs and their artifacts through `actions: read` and
writes a GitHub step summary; configure the team's GitHub failure notifications.
It does not send external messages. Both schedules require merging to the default
branch; neither has been dispatched by preparing these files.

Daily backup never republishes main merely to pause production. With Flows
provisioned it requires an already paused, drained maintenance window and exports
the Durable Objects through the private maintenance transport. Busy stores,
missing adoption/credentials, or unavailable Time Travel bookmarks fail the job.
Investigate failures and retry in a controlled maintenance window. A configured
schedule is not a verified RPO: monitor successful artifacts and rehearse recovery.

Production captures both Auth and domain through read-only D1 queries using method
`schema-dump`; it does not call the native export endpoint, which requires D1 Write.
This includes the nine retired tables and the historical `d1_migrations` ledger.
Current migration seeds can conflict with historical production role IDs, so a
schema dump restores into a verified empty target without running current
migrations first. A local rehearsal preserves all 166 captured row multisets,
including 85 retired rows, and verifies integrity and foreign keys. See the dated
readiness report for the evidence and activation prerequisites.

Manual commands (each capture must use a new output directory):

```sh
node ../../scripts/production-backup-gate.mjs --stack production --apply # Full gated copy
node ../../scripts/production-backup-gate.mjs --stack production --apply --skip-r2 # D1-only
# Preview FTS fallback requires explicitly stopping writes:
node backup.mjs --stack preview --apply --confirm-quiescent preview
```

Databases with FTS5 virtual tables cannot use `wrangler d1 export`
([Cloudflare limitation](https://developers.cloudflare.com/d1/best-practices/import-export-data/)).
Preview can use the table dump after `--confirm-quiescent preview`.
Production captures exact database identities and current
[Time Travel bookmarks](https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/get_bookmark/)
before copying, observes every D1 bookmark every ten seconds throughout the copy,
then checks the full boundary again after all D1 and R2 capture. Observations keep
both databases active while their copies are taken sequentially. Drift or a
failed observation prevents manifest publication; pending observations settle
before manifest creation and the timer is removed on every exit. After the final
R2 inventories, stopping also performs a fresh D1 bookmark poll even when no
interval read was pending, closing the final inventory-to-manifest gap. Each production
schema dump additionally checks its own before/after bookmark. Complete R2
inventories, including metadata and ETags, must also remain unchanged across the
capture. The API download pins each object to its listed ETag and verifies its
byte size. Concurrent changes or unverifiable targets invalidate the backup;
there is no successful manifest, forced success, or consistency bypass.
Production always uses verified API downloads, not state-backend S3 credentials.
This is a fail-closed copy with write detection, not a write lock or a promise
that a busy application can be copied without maintenance.

Production `schema-dump` files contain original regular-table definitions,
rows, explicit indexes, views and triggers, and AUTOINCREMENT sequences. Derived
external-content FTS5 storage is rebuilt from preserved content after row replay;
unsupported virtual/contentless FTS tables fail closed. Platform-owned tables are
excluded. Schema objects that can affect inserted data are restored after rows.

Restore validates the production consistency proof, checks that every schema-dump
target has no application schema **before any D1 data load**, and addresses the
resolved current Pulumi UUIDs rather than potentially stale Wrangler bindings.
Existing tables, including empty application tables, cause refusal. Restore does
not delete seed rows, merge historical identities, or overwrite an existing schema.
Provision/select an isolated empty target through a separately authorized recovery
procedure. Verify recovered persistence and application compatibility before
applying newer migrations or reconnecting traffic.

Legacy/preview `table-dump` files still require migrations before replay; their
retired/ledger CREATE statements preserve historical tables absent those migrations.
Legacy Auth table-dump fallback remains refused. Production Auth schema dumps
retain the original tables, indexes and triggers and restore into an empty target.
Dumps contain no BEGIN/COMMIT statements because D1 provides the import transaction.

Manifests land in `infra/pulumi/backups/<stack>/<timestamp>/` (gitignored).
Production manifests record the verified bookmark/inventory boundary; production
table-dump and schema-dump restores reject missing or mismatched consistency evidence.
With S3-compatible R2 credentials + AWS CLI, R2 uses `aws s3 sync`;
preview without them uses bounded per-object authenticated API downloads.
Production uses the API path regardless of S3 credentials, with listed-ETag
checks and unchanged final inventories. Stale object metadata fails rather than
silently accepting an inconsistent archive. Suggested targets remain RPO 24h,
RTO 4h; they require monitored successful backups and quarterly recovery drills.

Production artifacts use AES-256-GCM with `SAVIA_BACKUP_KEY`. Download the
`production-backup-<run>-<attempt>` daily artifact (or the production release
artifact), decrypt it privately, and keep the whole extracted directory:

```sh
node scripts/encrypt-flows-backup.mjs --action decrypt \
  --input /secure/production-backup.enc --output /secure/production-backup.tar.gz
# SAVIA_BACKUP_KEY is supplied through the environment, never a CLI argument.
tar -xzf /secure/production-backup.tar.gz -C /secure/recovery
node infra/pulumi/restore.mjs --manifest /secure/recovery/production-backup/manifest.json --dry-run
```

Release archives may use `flows-release-backup/` as their root directory.
Preserve the encryption key in an independent secret store; retention expires
artifacts after 30 days. GitHub retention is not an immutable offsite vault.

## Restore (disaster)

```sh
node restore.mjs --manifest infra/pulumi/backups/production/<ts>/manifest.json --dry-run
node restore.mjs --manifest <...> --apply --confirm-restore production
# Verify recovered data and application compatibility before newer migrations.
node ../../scripts/apply-d1-migrations.mjs   # separate, reviewed schema upgrade
# then redeploy workers via the production workflow
```

The manifest stack must match `--confirm-restore`; mismatches refuse.

R2 backups require the Cloudflare token even with S3 sync, to record complete
HTTP/custom metadata. Restoring custom metadata requires S3 credentials.
SSE-C objects and backups lacking metadata sidecars are refused before writes.
Backup paths are relative to their manifest and can be moved to another host;
legacy absolute D1 paths remain readable. Restore verifies stack/environment
and database names before applying infrastructure or replaying data.

## Historical adoption evidence (2026-10-12)

The following is historical evidence, not a current remote-state assertion.

Preview adoption kept the existing two databases and documents bucket unchanged.
The only new Cloudflare resource was `savia-pulumi-state-preview`, a private
protected bucket for encrypted shared CI state. The migrated preview stack
refreshes/applies with `same: 5`, with `flowsEnabled: false`. The existing plugin
registry bucket was imported into the independent protected `shared` stack with
zero changes to cloud resources; its Worker was not republished. Production
application state and production CI backend credentials still require separate
adoption before promotion. No Flows, AI, browser, containers or email service was
activated by this rollout.
