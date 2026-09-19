# Optional Docker runtime

## Approved intent

Keep Cloudflare deployments supported and add an independently runnable Docker installation. Share the existing API, authorization, data model, sync protocol, auth UI and business modules. Cloudflare remains a first-class runtime, not a migration target to delete.

## Design

Add `apps/self-hosted` as the Node runtime composition root. It reuses existing Fetch handlers with local adapters implementing the database/object-store/service contracts already consumed by the core. Keep Worker entrypoints as thin Cloudflare composition roots. SQLite compatibility must preserve transactions, migrations, triggers and mutation receipt semantics; each database has a single local owner. This first Docker topology is single-host, not a horizontally writable SQLite cluster.

Docker runs the built frontend and Node gateway/API/auth/connectors/request handlers, a persistent S3 service, an isolated JavaScript hook executor, and optional MCP/database-bridge services. Public forms use a configurable CAPTCHA provider: existing Turnstile stays the Cloudflare default, self-hosted proof-of-work is available without Cloudflare requests. WebSockets keep scoped authorization and one-use expiring tickets. Scheduled operations run through the same core routines with non-overlap and durable application state.

Secrets and public origin are explicit. Do not expose internal service routes, trust arbitrary forwarding/tenant headers, embed bootstrap credentials, or disable authorization to make Docker boot. Store files/databases in persistent volumes. Serve Office assets and production frontend from the installation. Preserve local-first behavior and public-form write-only capabilities.

## Acceptance

- Existing Cloudflare tests and configuration remain valid.
- Compose boot, login/bootstrap, authorized CRUD/local-sync, files, public forms/CAPTCHA, hook isolation, realtime and scheduled paths are exercised with local persistent services.
- Restart does not lose records or files. Failures roll back atomic batches. No Cloudflare account/token is required by the Docker runtime.
- External business integrations and configured external AI remain optional network integrations, not silently removed features.
- Document capabilities, setup, backup/restore, single-host constraints and optional providers honestly.
