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

- Run the workflow from `main`. Other workflow refs are rejected.
- `branch`: a non-production branch whose tip is already an ancestor of the
  workflow commit on `main`. Unmerged or squash-merged branch tips are rejected.
- `action`: `deploy`

Before installing dependencies, the workflow validates the branch name, fetches
its exact head, and checks that the commit belongs to the approved `main` history.
It then checks out that immutable commit. Unreviewed branch scripts, package
hooks, build configuration, and local actions never run with deployment secrets.
Branch previews for unmerged code need a separate build pipeline without
infrastructure credentials; the privileged workflow does not provide that mode.

After a few minutes the job prints the gateway URL plus per-worker status.
Log in with `savia.admin@example.test`; the bootstrap password is printed in
the deploy summary (ephemeral per preview, like all its secrets).

## One-click destroy

Same workflow, `action: destroy`, `confirm:` set to the exact branch name.
Without a matching confirm the job refuses. Destroy runs the scripts from the
trusted workflow commit on `main`; the target branch may already be deleted.
The branch name identifies resources and is never inserted into shell source.

Destroy deletes the 5 workers,
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

### Opt-in scheduled background jobs

Local branch previews keep cron disabled by default. For an isolated preview that
must run scheduled workflows, plugin monitors and notifications while browsers
are closed, pass `--enable-schedules` to `scripts/preview-deploy.mjs`. The API
worker then receives a one-minute trigger; each monitor enforces its own due time
(e.g. hourly). Only enable this on the intended isolated preview. Preserve its
existing encryption secrets and OAuth grants when updating an already configured
API Worker; rerunning a complete ephemeral bootstrap rotates its secrets.
