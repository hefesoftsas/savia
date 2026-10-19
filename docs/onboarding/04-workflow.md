# 04 — Workflow (30 min)

## Layout

- `apps/`: deployable workers (`api`, `auth`, `mcp`, `savia-request`,
  `legacy-api`, `admin`) + `legacy-exporter`.
- `packages/`: `db` (Drizzle migrations, source of truth for the schema),
  `studio-shared`, `studio-server`, `provider-contracts`,
  `insurance-portfolio-dashboard`.
- `scripts/`: Node tooling (`dev-local.sh`, imports, CI checks).
- `infra/`: Cloudflare; redirect to `infra/cloudflare`.
- `solutions/insurance/`: installable solution package.

## Commands (root, pnpm)

| Command                                            | What it does                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm dev`                                         | full local stack                                                              |
| `pnpm test`                                        | unit + contracts                                                              |
| `pnpm run test:unit:admin` / `:api` / `:workspace` | lanes per area                                                                |
| `pnpm run test:contracts`                          | `node --test` without heavy deps                                              |
| `pnpm run typecheck`                               | `tsc --noEmit` per package                                                    |
| `pnpm run lint`                                    | `prettier --check` (currently red on main from old files; don't add new ones) |
| `pnpm --filter @savia/api test`                    | tests for one package                                                         |

## CI (`.github/workflows/ci.yml`, push + PR)

Trusted base-revision classification selects compatible plugin checks or the
platform checks. Existing required check names remain present, and Contract tests
also require successful plugin validation when selected. Flows validation runs
for affected or uncertain changes. See [Preview release lanes](../guides/preview-release-lanes.md).

Five parallel lanes with cancellation run on ephemeral GitHub-hosted Ubuntu
runners: `admin`, `api`, `workspace`, `contracts`, `typecheck`. CI has read-only
permissions and no production credentials. Fork pull requests never use private
runners.

Every successful CI run for a push to `main` deploys the exact tested commit to
preview. Preview has independent Workers, authentication and domain databases,
and object storage. Pull requests never deploy.

The hosted Savia application production deployment has been retired. Preview is
the only hosted application environment available for releases. Historical
production operating notes are retained in
[preview and production operations](../runbooks/preview-production.md); do not
use their production steps as deployment instructions.

## Conventions

- Conventional commits in English: `feat|fix|docs|chore|ci|refactor|test: ...`.
- Code, tests, and docs in English.
- One worktree per task under `.worktrees/`, PRs against `main`.
- Don't resurrect retired workers or tooling: when in doubt,
  [06-glossary.md](06-glossary.md).
- A PR that changes behavior updates its guide in `docs/` (rule 4 of the
  [hub](../README.md)).

Next: [05-domains.md](05-domains.md).
