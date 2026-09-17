# 03 — Local setup (1–2 h)

Everything runs on your machine with `pnpm dev` (see `scripts/dev-local.sh`).
No Docker unless you need the legacy Postgres source.

## Prerequisites

- Node 22 (CI uses 22) and `pnpm@11.24.0` (`packageManager` in `package.json`).
- `pnpm install` at the root.

## Secrets (all optional, in `infra/secrets/*.dev.env`, ignored by Git)

| File                                          | For                            | Without it                                                   |
| --------------------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| `auth.dev.env` (`BETTER_AUTH_SECRET=...`)     | local sessions                 | falls back to the local secret in `apps/auth/wrangler.jsonc` |
| `assistant-api.dev.env`                       | assistant's OpenRouter + Nango | assistant disabled                                           |
| `mcp.dev.env` (`SAVIA_MCP_SHARED_SECRET=...`) | MCP worker on `:8789`          | MCP does not start                                           |

## Start

```sh
pnpm dev
```

This applies local D1 migrations, starts auth (`:8788`), savia-request
(`:8797`, after `setup:local` + `migrate:local`), API (`:8787`), legacy
(`:8790`), the CRM scheduler, and admin Vite (`:5173`).

## Verify

```sh
curl http://127.0.0.1:8787/health            # {"status":"ok","database":"ok"}
curl http://127.0.0.1:8788/_internal/session # {"user":null} when logged out
curl -i http://127.0.0.1:8797/api/health     # 403 "Acceso privado.": correct,
                                             # savia-request only answers over
                                             # service binding or authed API
```

Open `http://127.0.0.1:5173/` and log in with the bootstrap admin
(`BETTER_AUTH_BOOTSTRAP_*` in `apps/auth/wrangler.jsonc`; see
`ensureBootstrapAdministrator` in `apps/auth/src/index.ts`). The interactive
API reference lives at `http://127.0.0.1:8787/docs` (Scalar).

## Typical issues

- **Port taken**: admin bumps its own port; pin it with `SAVIA_ADMIN_PORT`.
- **Two Wrangers on the same state**: a single runtime owns
  `apps/api/.wrangler/state`; do not start another one over it.
- **Postgres**: only a source for legacy imports (`pnpm legacy:postgres`).
- **`pnpm dev` won't exit**: `trap` kills child processes on close; if
  orphans remain, kill by port (`lsof -tiTCP:8787 | xargs kill`).

Next: [04-workflow.md](04-workflow.md).
