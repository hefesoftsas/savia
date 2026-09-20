# Self-hosted Docker alternative

Owner: Savia platform maintainers. Reviewed: 2026-09-19.

Cloudflare remains a supported deployment. This Compose file runs the same API, authentication, connectors, low-code runtime and frontend on Node without Workers, D1, R2, Durable Objects, Turnstile, Wrangler or a Cloudflare account at runtime.

## Start

Install Docker with Compose and Node 22.16+ for the configuration helper. From the repository root:

```sh
node scripts/configure-self-hosted.mjs --email admin@example.com
# Read the generated bootstrap password in infra/secrets/self-hosted.env.
docker compose -f docker-compose.self-hosted.yml up --build -d
docker compose -f docker-compose.self-hosted.yml ps
```

Open `http://localhost:8080`, sign in with the configured email and generated password, and enroll MFA. Keep the encryption/authentication secrets unchanged across restarts. The helper refuses to overwrite existing configuration. Alternatively copy `infra/self-hosted/env.example` to `infra/secrets/self-hosted.env` and fill every required value. Secrets must have at least 32 characters; bootstrap passwords at least 12.

The first image build downloads dependencies and checksum-verified Office WASM assets. Subsequent execution serves these assets locally. No frontend development server runs in the container. The app runs as a non-root user. Compose initialization creates authenticated S3 credentials, the bucket and browser CORS rules before starting Savia. Schema migrations run before traffic is accepted; changed or missing already-applied migration files fail startup. New files are applied once in filename order even when a merged branch introduces an earlier name.

The default ports bind to localhost. A different configuration file can be selected with `SAVIA_ENV_FILE=/absolute/path/to/config.env`. Port bindings can be changed with `SAVIA_PORT`, `SAVIA_S3_PORT`, `SAVIA_BIND` and `SAVIA_S3_BIND` in the environment of the Compose command; update the public origins to match.

## Runtime components

| Existing capability                   | Docker implementation                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| D1 application/auth/request databases | Three SQLite databases with WAL, foreign keys, transactional batches and persistent volume |
| R2 documents                          | Authenticated SeaweedFS S3 with signed URLs, conditional writes and metadata               |
| Durable Object realtime               | Native WebSockets, scoped expiring single-use tickets and bounded connections              |
| Scheduled jobs                        | Shared scheduler, one non-overlapping run per minute                                       |
| Sandboxed request hooks               | QuickJS WASM in separate Node worker threads with resource limits                          |
| Public form challenge                 | Locally verified ALTCHA proof of work with expiry and replay protection                    |
| MCP assistant tools                   | Private loopback MCP with delegated user authorization                                     |
| Frontend and Office                   | Built static assets, same local-first collection replica and Office WASM runtime           |

This release supports **one Savia application process on one host**. Do not scale the app replicas or share its SQLite volume over NFS. WebSocket tickets/connections and rate-limit windows are process-local; a restart closes connections, and clients reconnect. Scheduled durable work and data remain in SQLite. This is not a high-availability deployment.

## Public domains and TLS

Set `SAVIA_PUBLIC_ORIGIN=https://savia.example.com` and `S3_PUBLIC_ENDPOINT=https://files.example.com` before startup. Put a TLS reverse proxy in front of both services, preserve the incoming `Host`, and support WebSocket upgrades. Configure wildcard DNS/certificates for tenant hosts such as `agency.savia.example.com`. S3 CORS allows the canonical origin and its tenant subdomains. Never expose SeaweedFS master/filer/admin ports; Compose publishes only its authenticated S3 port.

Forwarded identity headers are ignored by default. If a reverse proxy is used, set `SAVIA_TRUSTED_PROXY_ADDRESSES` to a comma-separated list of its exact socket peer IP addresses. Configure that proxy to overwrite or append the actual client address in `X-Forwarded-For`; only the final valid address is used, and only from those trusted peers. Without this option, clients behind the same proxy share the public-form rate limit. Host-derived tenant routing never trusts a client-supplied tenant header.

Browser secure-context features (PWA, WebCrypto, clipboard) require HTTPS outside localhost. If adding CSP, allow local ALTCHA worker creation with `worker-src 'self' blob:`.

## Optional integrations

Core operation requires no Cloudflare connectivity. JSON:API and OpenAPI integrations use the local operating-system DNS resolver; outbound connections recheck every resolved address to reject private destinations and DNS rebinding. External business integrations still need their providers:

- SMTP: `SAVIA_SMTP_HOST`, `SAVIA_SMTP_PORT` (465 by default; TLS), `SAVIA_SMTP_FROM`, and optional username/password. Needed for password-reset and verification email delivery.
- AI: existing `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` or administrator configuration. The existing SQL text-retrieval fallback is available; Cloudflare Vectorize/Workers AI semantic embeddings are not provisioned in this Compose stack.
- Nango: existing `NANGO_API_KEY`, `NANGO_BASE_URL`, `NANGO_CONNECT_URL` and provider integration ID variables. It is optional and can point at a separately hosted Nango installation.
- External databases: enable `--profile external-databases`, set `SQL_BRIDGE_URL=http://db-bridge:8791`, and set `SQL_BRIDGE_SECRET` and `DB_BRIDGE_SHARED_SECRET` to the same generated secret. Set `DB_BRIDGE_ALLOWED_HOSTS` explicitly to your database hosts. The bridge is internal to Compose and has no published port.

ALTCHA is a proof-of-work challenge, not a human-identity guarantee. Public submissions retain the shared quota, validation, expiry, idempotency and submission-only permissions. Cloudflare deployments keep Turnstile by default.

## Backup, upgrade and recovery

Back up the **database**, **objects** and **storage-config** named volumes together with the secret configuration file. For a consistent simple backup, stop the stack first, snapshot/export all three volumes, and then restart. Do not back up only the main SQLite files while the app is running; WAL files can contain committed data. Encryption keys are required to recover stored connector/request credentials.

Before an upgrade, take and verify a backup. Rebuild and start the stack normally; migrations are recorded with checksums and applied transactionally. Downgrades require restoring the matching database/object snapshot as well as the matching image. `docker compose down` preserves named volumes; **`down -v` deletes them**.

```sh
docker compose -f docker-compose.self-hosted.yml logs --tail=100 savia
docker compose -f docker-compose.self-hosted.yml restart savia
```

Existing Cloudflare data is not automatically copied into this installation. Moving an existing tenant is a separate coordinated export/import operation; do not point the two deployments at the same writable database or assume their session/encryption secrets are interchangeable.

## Verification

### Disposable browser MCP integration

Run the MCP OAuth browser suite on macOS or Linux (including WSL) with Docker
Compose, Node 22.16+, and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm --filter @savia/self-hosted exec playwright install chromium
pnpm test:e2e:mcp
```

The runner builds the current checkout using the existing Dockerfile and Compose
services. Each run generates a unique `savia-mcp-e2e-*` project, image, credentials,
loopback ports and volumes. It does not use preview, production, existing Docker
volumes, real ChatGPT accounts, or user browser sessions. Chromium runs on the
host; Savia, its databases and object storage run in disposable containers.

Playwright exercises real browser login, administrator MFA enrollment and OAuth
consent, then exchanges the authorization code with PKCE. It verifies modern MCP
tool discovery, reads a seeded collection and record, checks missing/invalid
credentials and read-only write denial, and discovers tools after token refresh.
The suite checks Savia's protocol boundary, not ChatGPT's plugin installation UI.
The disposable client is registered as a native public client with an HTTP
loopback callback and PKCE. Real ChatGPT web clients still require their HTTPS
callback; the test does not weaken that validation or impersonate ChatGPT.

Normal completion and handled SIGINT/SIGTERM remove only the fixture project's
containers and volumes. Failed runs retain private logs and Playwright traces in
the temporary directory printed by the runner; these may contain disposable
credentials and must not be published. SIGKILL or a Docker outage can prevent
cleanup: inspect the exact printed project before removing its resources. Never
run volume cleanup against the default self-hosted project.

Run `pnpm test:e2e:mcp:runner` to check fixture isolation and process-tree
cancellation without Docker.

Run `pnpm --filter @savia/self-hosted test` and `pnpm --filter @savia/self-hosted typecheck`, plus the repository test lanes. The optional live S3 contract test uses `SAVIA_TEST_S3_ENDPOINT`, `SAVIA_TEST_S3_ACCESS_KEY`, and `SAVIA_TEST_S3_SECRET_KEY`, creates a temporary bucket, and removes its test data. Real composition tests exercise bootstrap login, MFA, CRUD, local synchronization and reopening persisted SQLite databases.

An optional HTTP smoke test targets a disposable installation: set `SAVIA_DOCKER_TEST_ORIGIN`, `TEST_EMAIL`, `TEST_PASSWORD` and a private `SAVIA_DOCKER_TEST_STATE_FILE`, then run `pnpm --filter @savia/self-hosted exec vitest run test/docker.integration.test.ts`. It enrolls MFA for the fixture administrator and creates a tenant, collection, records, an attachment and public form; use a test installation. The state file retains the MFA secret and fixture identifiers for restart verification and must stay private.

For an optional PostgreSQL application database, see [PostgreSQL for Docker](self-hosted-postgres.md).

### Authentication page verification

After starting Docker, verify that `/api/auth/login`, `/api/auth/mfa-enroll` and `/api/auth/consent` return HTML successfully. The server-rendered login surface imports React explicitly so it also works when the native loader starts from the repository root without the authentication package’s JSX configuration. The Docker integration suite covers these pages separately from JSON authentication endpoints.
