# 03 — Local setup (1–2 h)

Choose the container environment below, or run `pnpm dev` directly on your
machine. Both use `scripts/dev-local.sh` and the same local Worker topology.

## One-command container environment

Install Docker Desktop, or Docker Engine with the Compose plugin, and start
Docker. Recommended: allocate 8 GB of memory to Docker for the parallel Worker
runtimes and Vite dependency optimization. A 4 GB Docker VM showed a transient
Wrangler exit during the initial smoke test; a runtime retry restored the API. From a fresh checkout, run:

```sh
docker compose up --build
```

The first start downloads Node 22 and pnpm 11.24.0, installs dependencies with
the frozen lockfile, applies local migrations, and starts Admin, API, Auth,
Savia Request, the connector gateway, and the CRM scheduler. Subsequent starts
reuse the dependency cache. External integrations and MCP require the optional
secrets documented below; the core app starts without them.

Open **http://127.0.0.1:5173/** (use this exact hostname for local OAuth).
The API and Scalar reference are at **http://127.0.0.1:8787/docs**.
Only ports 5173 and 8787 are published, bound to the host loopback interface.
Auth, MCP, Savia Request, and inspector ports remain private to the container.
PostgreSQL remains opt-in for legacy imports.

The initial local administrator is `savia.admin@example.test`, with password
`TestUser321!`, as configured by `BETTER_AUTH_BOOTSTRAP_*` in the local Auth
configuration. Complete the authentication setup requested by the app. These
are local development credentials only.

### Editor and daily workflow

In VS Code with the Dev Containers extension, choose **Dev Containers: Reopen
in Container**. The checked-in `devcontainer.json` starts the same Compose
service automatically, with the editor and terminal running as the `node` user.
Do not run a second `pnpm dev` inside that terminal.

Source files are bind-mounted, so edits reload immediately. Dependencies for
all workspace packages and the pnpm store live in Docker volumes, separate from
host dependencies. API/Auth/Request `.wrangler` state also lives in volumes and
survives container recreation. Request's generated `.dev.vars` stays in the
checkout (gitignored); retain it to decrypt existing local Request data.
Existing host Miniflare data is not imported into the container.

```sh
docker compose logs -f dev                 # startup and runtime output
docker compose exec dev pnpm test          # tests with container dependencies
docker compose exec dev pnpm typecheck
docker compose restart dev                 # reinstall after dependency changes
docker compose down                        # stop; retain dependencies and data
```

Avoid `docker compose down -v` unless you intend to delete this Compose
project's volumes, including local databases and any legacy PostgreSQL volume.
Optional files in `infra/secrets/` are read through the source mount; the image
build context contains only `.devcontainer`, so it does not copy those secrets.

### Container troubleshooting

- Stop an existing native `pnpm dev` before starting Compose: both use ports
  5173 and 8787. Fixed ports preserve the local OAuth configuration.
- If Wrangler exits during the first Vite optimization, inspect the container
  logs, check Docker resources, then retry with `docker compose restart dev`.
- A cold dependency install can take several minutes. Inspect logs if the
  container is still starting; `docker compose ps` reports its health.
- If dependency installation fails, check registry/network access and lockfile
  consistency, then run `docker compose up --build` again.
- On Linux, the image uses UID/GID 1000 (`node`). If your checkout belongs to a
  different UID, use Dev Containers' UID adjustment or a local Compose override
  with your UID/GID and matching writable volume permissions. Do not recursively
  change ownership of the host checkout from inside the container.
- When adding a workspace package, add its `node_modules` volume to Compose and
  its writable directory to `.devcontainer/Dockerfile`.

## Native development

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
(`:8797`, after `setup:local` + `migrate:local`), API and the private connector gateway (`:8787`), the CRM scheduler, and admin
Vite (`:5173`).

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
