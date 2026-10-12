# Preview environments (temporary, one-click)

Spin up an isolated copy of the stack for a branch, test it, then destroy it.
Nothing is shared with production: fresh D1 databases (migrated), a fresh R2
bucket, ephemeral secrets, and `*.workers.dev` URLs (no custom domain).

Infrastructure declarations live in `infra/pulumi/branch-preview/` and
`infra/pulumi/branch-preview-worker-config.mjs`. Each branch uses a separate
`branch-<slug>` Pulumi stack in the configured remote R2 backend. Existing exact
branch D1/R2 resources are adopted before applying; deployments never silently
replace them with a fresh state. Install the pinned Pulumi CLI and run
`npm ci --prefix infra/pulumi --ignore-scripts` locally. Set `PULUMI_BACKEND_URL`,
`PULUMI_CONFIG_PASSPHRASE`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` in
addition to Cloudflare credentials. GitHub uses the preview environment secrets
described in [the infrastructure runbook](pulumi-infrastructure.md). Dry runs
stay credential-free and never create a stack.

## One-click deploy

GitHub Actions → **Preview environment** → Run workflow:

- `branch`: the branch to deploy (never `main`)
- `action`: `deploy`

After a few minutes the job prints the gateway URL plus per-worker status.
Log in with `savia.admin@example.test`; the bootstrap password is printed in
the deploy summary (ephemeral per preview, like all its secrets).

## One-click destroy

Same workflow, `action: destroy`, `confirm:` set to the exact branch name.
Without a matching confirm the job refuses. Destroy deletes the 5 workers,
both D1 databases, and empties + deletes the R2 bucket through the branch Pulumi
stack. A missing/mismatched stack or deletion failure stops the job; the shared
state bucket and plugin registry are never targets.

Local equivalents:

```sh
node scripts/preview-deploy.mjs --branch feat-x [--dry-run] [--skip-admin]
node scripts/preview-destroy.mjs --branch feat-x --dry-run
node scripts/preview-destroy.mjs --branch feat-x --force
```

## What a preview is (and is not)

| Aspect                | Preview                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Workers               | `savia-{auth,request,mcp,agencies}-preview-<slug>`, `savia-preview-<slug>`, on `workers.dev` |
| Data                  | fresh D1s with all migrations applied; empty R2 bucket                                       |
| Secrets               | random per preview (MCP secret shared between api+mcp)                                       |
| Cron                  | none (the prod every-minute tick is not installed)                                           |
| Provider live keys    | not configured (Nango/OAuth flows fail gracefully)                                           |
| savia-request sandbox | needs the account's Workers for Platforms entitlement, like prod                             |
| D1 budget             | 2 databases per preview (free tier allows 10 total)                                          |

## Safety rails

- `main`/`production`/`staging` (and case variants) are refused by the
  scripts; destroy only touches names containing `-preview-<slug>` and
  requires `--force` (CLI) or matching `confirm` (workflow).
- Previews never read or write production databases, buckets, or secrets.
- No TTL automation: whoever creates a preview destroys it. Stale previews
  are visible as `*-preview-*` workers/databases in the dashboard.
