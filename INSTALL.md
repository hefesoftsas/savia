# Install Savia on your Cloudflare account

Savia is AGPL-3.0-or-later (see `LICENSE`). You run it on **your own**
Cloudflare account and pay Cloudflare directly — nothing is billed through us.

- **Try first, zero accounts**: `pnpm install && pnpm dev` runs the whole
  stack locally (admin `http://127.0.0.1:5173`). External features stay
  disabled until you add keys.
- **Full install cost**: ~$30/mo (Workers Paid ~$5 + Workers for Platforms
  ~$25) + your domain. Why: [ADR-001](docs/adr/0001-cloudflare-paid-tier-requirement.md).
- **What you get**: 5 workers, 2 D1 databases, 1 R2 bucket behind your domain.

## Recommended: guided setup

```sh
git clone <repo> savia && cd savia
pnpm install
pnpm setup
```

The wizard checks prerequisites, asks for your domain, an admin email, your
Cloudflare API token + account ID, and optional Nango/OpenRouter keys — then
provisions D1/R2, renders configs, stores generated secrets, migrates,
deploys in order, seeds the bootstrap admin, and optionally loads demo data.
It prints the URL and login when done. `--dry-run` prints the plan without
touching anything.

Without optional keys the install still completes: provider live paths fail
gracefully, the assistant stays disabled, and password reset needs SMTP
(see `apps/auth` email settings). Connect them later from the admin UI.

## Advanced: manual steps

## Prerequisites

- Cloudflare account with Workers Paid and Workers for Platforms, and a
  domain managed by Cloudflare DNS.
- Node 22, `pnpm@11.24.0`, `wrangler login` completed.

## 1. Clone and install

```sh
git clone <repo> savia && cd savia
pnpm install
```

## 2. Create data resources

```sh
wrangler d1 create savia-auth        # save the database_id
wrangler d1 create savia-agencies    # save the database_id
wrangler r2 bucket create savia-documents
```

## 3. Render worker configs

Production configs are generated, never hand-edited (they are gitignored):

```sh
SAVIA_AUTH_D1_ID=<auth-id> \
SAVIA_DOMAIN_D1_ID=<agencies-id> \
SAVIA_PUBLIC_ORIGIN=https://yourdomain.com \
node scripts/render-cloudflare-production-config.mjs
```

`SAVIA_PUBLIC_ORIGIN` must be `https://` and match the domain on Cloudflare:
the gateway attaches it as a custom domain on deploy.

## 4. Set secrets

Generate random values (`openssl rand -base64 32`) for the internal ones:

| Worker (dir)         | Secrets                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/auth`          | `BETTER_AUTH_SECRET`                                                                                                                                                                   |
| `apps/mcp`           | `SAVIA_MCP_SHARED_SECRET`                                                                                                                                                              |
| `apps/savia-request` | `ENCRYPTION_KEY` (exactly 32 bytes base64)                                                                                                                                             |
| `apps/api`           | `ASSISTANT_SETTINGS_ENCRYPTION_KEY`, `CRM_INTEGRATION_KEY`, `SAVIA_MCP_SHARED_SECRET` (same value as mcp), `NANGO_API_KEY` (optional — provider live paths fail gracefully without it) |

```sh
cd apps/auth && printf '%s' '<BETTER_AUTH_SECRET>' | wrangler secret put BETTER_AUTH_SECRET --config wrangler.production.jsonc && cd ../..
# repeat per worker/key
```

## 5. Migrate the domain database

```sh
CLOUDFLARE_ACCOUNT_ID=<account> CLOUDFLARE_DATABASE_ID=<agencies-id> \
CLOUDFLARE_API_TOKEN=<token> node scripts/apply-d1-migrations.mjs
```

The auth database is managed by Better Auth itself at runtime; nothing to run.

## 6. Deploy in order

```sh
pnpm --filter @savia/auth exec wrangler deploy --config wrangler.production.jsonc
pnpm --filter @savia/mcp exec wrangler deploy --config wrangler.production.jsonc
pnpm --filter @savia/request exec wrangler deploy --config wrangler.production.jsonc
pnpm --filter @savia/api exec wrangler deploy --config wrangler.production.jsonc
pnpm --filter @savia/admin run build
pnpm --filter @savia/admin exec wrangler deploy --config wrangler.production.jsonc
```

(The gateway config lives in `apps/admin/` and proxies `/api/*`, `/v1/*` to
the API on the same origin, so the UI needs no API URL configuration.)

## 7. Verify and create the first admin

```sh
curl https://yourdomain.com/health   # {"status":"ok","database":"ok"}
```

Open `https://yourdomain.com/docs` for the interactive API reference. Public
sign-up is disabled, so seed the first admin with a temporary bootstrap
password, open the login page once, then redeploy auth without it:

```sh
pnpm --filter @savia/auth exec wrangler deploy --config wrangler.production.jsonc \
  --var 'BETTER_AUTH_BOOTSTRAP_EMAIL:you@example.com' \
  --var 'BETTER_AUTH_BOOTSTRAP_PASSWORD:<min-12-chars>'
# open https://yourdomain.com/auth/callback login page once, then:
pnpm --filter @savia/auth exec wrangler deploy --config wrangler.production.jsonc
```

## Optional: external accounts

- **Nango** (HubSpot, Google/Microsoft): create the account, set
  `NANGO_API_KEY` + integration IDs as vars, reconnect per agency in the UI.
  Everything else works without it.
- **OpenRouter**: key for the assistant model (`assistant-api` env); without
  it the assistant stays disabled.

## Troubleshooting

- `SAVIA_PUBLIC_ORIGIN must use HTTPS`: the render script enforces it.
- `wrangler secret put` adds a trailing newline with `echo`; use `printf`.
- Migrations are idempotent (tracked in `_savia_migrations`); re-running is safe.
- `wrangler deploy` needs the same account/zone access as `wrangler login`.
