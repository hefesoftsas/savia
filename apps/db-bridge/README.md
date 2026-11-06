# Database bridge

Authenticated Node bridge for PostgreSQL, MySQL, SQL Server, and MongoDB sources.
The Worker API owns source access, encrypted secrets, and binding permissions;
engine adapters validate live metadata and execute bounded parameterized reads
and individual record mutations. External schemas remain under their owner's
control. Existing PostgreSQL read endpoints remain compatible.

See [the source guide](../../docs/external-database-sources.md) for configuration,
write policies, metadata synchronization, deployment order, and limitations.

```sh
pnpm --filter @savia/db-bridge build
DB_BRIDGE_SHARED_SECRET=local-test DB_BRIDGE_ALLOWED_HOSTS=127.0.0.1 \
  pnpm --filter @savia/db-bridge start
pnpm --filter @savia/db-bridge test
pnpm --filter @savia/db-bridge typecheck
```

`DB_BRIDGE_PORT` defaults to 8791; `DB_BRIDGE_HOST` defaults to 127.0.0.1.
The Docker image binds 0.0.0.0 for private container networking. Configure the API
with `SQL_BRIDGE_URL` and matching `SQL_BRIDGE_SECRET`. All database routes require
a bearer token and honor the configured hostname allowlist. `GET /health` is public.
No database credentials are included in health responses or error messages.

`pnpm --filter @savia/db-bridge test:live` requires disposable local fixtures;
use `scripts/verify-database-sources.sh` to provision and clean them up. Default
unit tests skip the live suite. A selected but unavailable engine fails live tests.
