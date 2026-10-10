# Pulumi infrastructure (D1 + R2) and disaster recovery

Owner: infrastructure. Review date: 2027-04-10.

Pulumi owns stateful resources (2 D1 databases + R2 bucket per stack).
Worker code, bindings, migrations, and secrets stay on Wrangler and the
existing deploy workflows. No Pulumi Cloud account is required: the CLI is
Apache 2.0 and state lives in a self-managed backend.

## Backend setup (once per machine/CI)

```sh
cd infra/pulumi && npm install --no-save  # standalone, outside pnpm workspace
pulumi login s3://savia-pulumi-state?endpoint=https://<account>.r2.cloudflarestorage.com
# passphrase from infra/secrets/ (gitignored), never committed:
export PULUMI_CONFIG_PASSPHRASE="$(cat ../../infra/secrets/pulumi-passphrase)"
pulumi stack select preview   # or: production
pulumi config set --secret cloudflare:apiToken "$CLOUDFLARE_API_TOKEN"
```

CI uses `PULUMI_BACKEND_URL` + `PULUMI_CONFIG_PASSPHRASE` secrets and the
`preview`/`production` GitHub environments (see `.github/workflows/pulumi.yml`).

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
pulumi up --stack preview                        # stateful layer + plan
node render-from-outputs.mjs --stack preview     # wrangler.*.jsonc from outputs
# then the existing flow: upload secrets, apply migrations, wrangler deploy
```

## Destroy an environment

```sh
node destroy.mjs --stack preview --dry-run
node destroy.mjs --stack preview --apply
# production refuses without both flags:
node destroy.mjs --stack production --apply --i-understand-destroy-production
```

Production resources are created with `protect: true`; `pulumi destroy`
fails on them until protection is lifted. Preview stacks are unprotected
and cheap to tear down. Worker code is deleted by `wrangler delete` only
via `scripts/preview-destroy.mjs`, not by these scripts.

## Backups (data, not just infra)

Pulumi recreates empty containers; backups capture the data. Schedule
before every production deploy and at least daily:

```sh
node backup.mjs --stack production --apply            # D1 exports + R2 sync
node backup.mjs --stack production --apply --skip-r2  # metadata-only
```

Manifests land in `infra/pulumi/backups/<stack>/<timestamp>/` (gitignored).
R2 sync needs `CLOUDFLARE_ACCOUNT_ID` plus S3-compatible R2 credentials and
AWS CLI. Suggested targets: RPO 24h, RTO 4h; verify with a quarterly
preview restore drill.

## Restore (disaster)

```sh
node restore.mjs --manifest infra/pulumi/backups/production/<ts>/manifest.json --dry-run
node restore.mjs --manifest <...> --apply --confirm-restore production
node ../../scripts/apply-d1-migrations.mjs   # catch up past the backup
# then redeploy workers via the production workflow
```

The manifest stack must match `--confirm-restore`; mismatches refuse.
