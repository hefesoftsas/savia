# Savia infrastructure and disaster recovery

Owner: infrastructure. Review date: 2026-10-12.

`infra/pulumi` is the authoritative infrastructure project for standard
preview/production, temporary branch previews, the isolated plugin editor, and
the shared plugin registry. Each deployment profile has its own Pulumi project
and state; shared resources are never owned by a disposable preview stack. Pulumi owns D1, R2, optional Flows KV/Queue,
and the protected state bucket. `worker-config.mjs` and
`flows-worker-config.mjs` and `auxiliary-worker-config.mjs` declare Worker names, bindings, routes, cron,
Workflows, SQLite Durable Object migrations, limits, and WorkerLoader.
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

## Savia Flows (declared, disabled)

`flowsEnabled` defaults to false and is not set in either environment config.
At that setting Pulumi creates no Flows resources, the renderer adds no
`SAVIA_FLOWS` host binding, and any stale generated Flows manifest is removed.
The optional resources are one D1, one KV namespace, three R2 buckets, and one
Queue with isolated environment names. Their actual outputs feed the private
Flows Worker manifest: resilient Workflows, five SQLite Durable Object classes,
Queue producer/consumer, cron, WorkerLoader, and reciprocal host services.

Activation is a later rollout: import any existing resources first, explicitly
review `flowsEnabled: true`, apply the resource plan, migrate the Flows D1 schema,
configure the required bridge/signing/encryption secrets, publish Flows against
the existing API, then publish the API with its Flows binding. The current PR
prepares the infrastructure declarations; it does not publish Flows code or
activate AI, browser, containers, external email, or Analytics Engine.

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

Pulumi recreates empty containers; backups capture the data. Schedule
before every production deploy and at least daily:

```sh
node backup.mjs --stack production --apply            # D1 exports + R2 sync
node backup.mjs --stack production --apply --skip-r2  # D1-only
# FTS fallback is allowed only after stopping writes to preview:
node backup.mjs --stack preview --apply --confirm-quiescent preview
```

Databases with FTS5 virtual tables cannot use `wrangler d1 export`
(Cloudflare refuses); preview backup may fall back to a table-by-table
D1-compatible dump after `--confirm-quiescent preview` and records skipped objects (FTS5 index + shadows, platform
`_cf_KV`) in the manifest. Production fallback is refused because paginated REST queries
are not a consistent snapshot under concurrent writes. On restore, replay migrations first (schema,
triggers, FTS5 definition), then load the dump with deferred foreign keys and in-place seed-row upserts (without cascading deletes) — the
FTS5 index rebuilds via triggers. After infrastructure recreation, restore
validates the live outputs and uses the new domain D1 UUID for migrations;
`--skip-infra` retains the manifest ID for the operator-managed existing database. Dumps contain no BEGIN/COMMIT statements. `d1-table-dump.mjs` holds the dump logic and its tests.

Manifests land in `infra/pulumi/backups/<stack>/<timestamp>/` (gitignored).
With S3-compatible R2 credentials + AWS CLI, R2 uses `aws s3 sync`;
without them it falls back to per-object `wrangler r2 object get` (only
needs `CLOUDFLARE_API_TOKEN`). Verify downloads by MD5-vs-etag, and by
direct API byte-compare when R2 list metadata is stale (seen on
overwritten office-runtime objects). Suggested targets: RPO 24h, RTO 4h;
verify with a quarterly preview restore drill.

## Restore (disaster)

```sh
node restore.mjs --manifest infra/pulumi/backups/production/<ts>/manifest.json --dry-run
node restore.mjs --manifest <...> --apply --confirm-restore production
node ../../scripts/apply-d1-migrations.mjs   # catch up past the backup
# then redeploy workers via the production workflow
```

The manifest stack must match `--confirm-restore`; mismatches refuse.

R2 backups require the Cloudflare token even with S3 sync, to record complete
HTTP/custom metadata. Restoring custom metadata requires S3 credentials.
SSE-C objects and backups lacking metadata sidecars are refused before writes.
Backup paths are relative to their manifest and can be moved to another host;
legacy absolute D1 paths remain readable. Restore verifies stack/environment
and database names before applying infrastructure or replaying data.

## Adoption verified on 2026-10-12

Preview adoption kept the existing two databases and documents bucket unchanged.
The only new Cloudflare resource was `savia-pulumi-state-preview`, a private
protected bucket for encrypted shared CI state. The migrated preview stack
refreshes/applies with `same: 5`, with `flowsEnabled: false`. The existing plugin
registry bucket was imported into the independent protected `shared` stack with
zero changes to cloud resources; its Worker was not republished. Production
application state and production CI backend credentials still require separate
adoption before promotion. No Flows, AI, browser, containers or email service was
activated by this rollout.
