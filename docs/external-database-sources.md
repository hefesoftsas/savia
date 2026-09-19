# External database sources

Savia can connect PostgreSQL, MySQL, SQL Server, and MongoDB as external collections.
Records stay in the source database. The source manager discovers metadata and
binds selected fields to the existing collection screens. This follows the
separation between source management and database adapters used by
[NocoBase](https://docs.nocobase.com/data-sources/data-source-manager).

## Start the bridge

The Worker API calls the Node bridge over authenticated HTTP. Native database
drivers run only in `apps/db-bridge`. Start the bridge before enabling sources:

```sh
pnpm --filter @savia/db-bridge build
DB_BRIDGE_SHARED_SECRET=replace-with-a-private-shared-secret \
DB_BRIDGE_ALLOWED_HOSTS=database.internal \
pnpm --filter @savia/db-bridge start
```

Configure the API with `SQL_BRIDGE_URL` and the same secret in
`SQL_BRIDGE_SECRET`. Store actual secrets using the deployment's secret mechanism,
not in committed files. `DB_BRIDGE_PORT` defaults to 8791. The host defaults to
127.0.0.1; containers use `DB_BRIDGE_HOST=0.0.0.0` behind a private network/proxy.
Use HTTPS between independently deployed services. `DB_BRIDGE_ALLOWED_HOSTS`
is a comma-separated list; `*` is intended only for local development.

Deploy the new bridge first, then apply migration
`0055_collection_database_sources.sql` through the normal migration workflow,
then deploy the API/admin. Existing PostgreSQL sources retain read-only policy.
The legacy PostgreSQL bridge endpoints remain available during rollout.

## Configure and bind a source

In the collection source manager, create a source and select its engine. Enter
host, port, database, and credentials. Defaults are PostgreSQL 5432/public,
MySQL 3306, SQL Server 1433/dbo, and MongoDB 27017 with auth database admin.
MongoDB supports a directly addressed server; connect to the writable primary
when writes are required. SRV URLs and automatic topology discovery are not
supported. MongoDB credentials are optional for an unauthenticated local server.

TLS is enabled by default. SQL Server has separate encryption and server
certificate trust controls; leave certificate trust disabled for verified TLS.
Passwords are encrypted in backend storage and are never returned by source APIs.
The update-access form can replace or remove a password and change write policy.

Save the source, use **Test connection**, then choose its source type when binding
a collection. Leave the resource empty to discover available tables/collections,
or enter a resource and inspect its fields. Select the fields to expose. Include
the record identifier. A non-null single-column primary or unique key supports
individual SQL record operations. Without one, the resource supports listing only.
Members of a compound key are never treated as independently unique.

MongoDB samples at most 100 documents. Its metadata is an inference, not a schema
constraint. Empty collections accept explicit field definitions and a selected
ObjectId or string identifier type. Include `_id` in the selected fields. A
hexadecimal string remains a string when that is the identifier type. Mixed or
unsupported identifier types disable individual writes.

## Writes and permissions

Sources default to read-only. Enable **Allow creating, editing and deleting
records** to make supported operations available. Source ownership, Savia access
checks, binding permissions, current resource metadata, and database account
permissions still apply. Revoking source writes blocks subsequent requests even
if a browser has stale capabilities. Views remain read-only.

Use a database account with only the required table/collection privileges. A
read-only account needs SELECT (or MongoDB read privileges); a writable account
also needs the intended insert/update/delete privileges. Savia never grants
privileges or creates external schema objects.

Generated/computed fields cannot be submitted. Updates change only submitted
fields and cannot change the record identifier. Missing fields on creation are
omitted so database defaults apply. Optional boolean fields offer an explicit yes/no
choice; leaving the selection empty uses the database default. Big integers and decimals use exact strings;
JSON fields use JSON text in forms and structured JSON in the bridge. Unsupported
binary/special types remain read-only.

A missing record returns a not-found error; unique/reference conflicts and invalid
field values return actionable errors. Writes are not automatically retried.
After an interrupted response or timeout, refresh to determine whether the write
committed before submitting it again. Local audit/version storage and the external
database do not share a transaction. An audit failure after commit is logged as
such and never causes an automatic second mutation.

## Synchronize fields

Use **Synchronize fields** on a bound collection after its external schema changes.
Labels and display settings for unchanged fields are retained. Missing or changed
types produce schema issues and disable unsafe writes. The sync operation uses the
collection version to reject conflicting changes. An administrator can reconcile
selected fields through the sync request's `fields` selection; excluding removed
fields and accepting the current definitions clears incompatibility issues.

Schema synchronization never alters external tables, indexes, views, or documents.
Generated API documentation is available through the existing OpenAPI/Scalar
surface; database operations are adapter-owned rather than editable JSON:API
operation mappings.

## Verification

Run bridge unit tests with `pnpm --filter @savia/db-bridge test`. Run real CRUD
checks against **disposable local databases** with `scripts/verify-database-sources.sh`.
The script creates uniquely named test containers, runs the live suite, and removes
only those containers. It requires Docker, available ports 15432/13306/11433/17017,
and capacity to run SQL Server (amd64 emulation may be required on Apple Silicon).
Engines run sequentially to limit memory use; set `SAVIA_DB_ENGINES` to run a subset.
Its published test credentials are only for these loopback-bound fixtures.

To use already running fixtures, run `pnpm --filter @savia/db-bridge test:live`.
`SAVIA_DB_ENGINES=postgres,mysql,mssql,mongodb` selects engines. A selected engine
that cannot connect fails the run. The live suite creates and removes only its
own randomly named resources in the fixture databases. Never point these tests
at business databases.

## Limits

No external DDL, arbitrary SQL, aggregation pipelines, bulk mutation, compound-key
editing, distributed transactions, or external change-data capture is provided.
Refresh retrieves authoritative external state; changes made outside Savia do
not automatically emit Savia realtime events. Filters are equality predicates
combined with AND, and pages contain at most 100 records. Discovery returns at
most 500 resources. MongoDB inference is limited to top-level fields; nested
objects and arrays are edited as JSON.

### Managed preview bridge

`infra/db-bridge/compose.preview.yml` runs a dedicated bridge, Cloudflare tunnel,
and four isolated fixture databases. This stack is for preview verification;
SQL Server uses the Developer edition. Database ports are not published. The
bridge only accepts the four fixture service names, and its local health port
binds to loopback. Do not attach business databases to this fixture stack.

Build `apps/db-bridge/Dockerfile` from a clean `git archive` of the release commit.
On the host, create a private `.env` (mode 0600) alongside the Compose file with
`DB_BRIDGE_IMAGE`, a random `DB_BRIDGE_SHARED_SECRET`, a strong random
`FIXTURE_PASSWORD`, and the dedicated Cloudflare `TUNNEL_TOKEN`. Configure the
tunnel hostname to route to `http://bridge:8791`, with a final `http_status:404`
ingress rule. Create a proxied CNAME to the tunnel ID's `cfargotunnel.com` name.
Start the stack with `docker compose -f compose.preview.yml up -d`.

Set the matching `SQL_BRIDGE_URL` (HTTPS) and `SQL_BRIDGE_SECRET` in the GitHub
`preview` environment. Preview and production workflows upload this optional
pair to their respective API Workers. Both values must be present together;
invalid or partial configuration stops before any secret upload. Existing
installations without this pair continue deploying without a bridge.

Verify authenticated connection tests, discovery, metadata, and CRUD for each
fixture engine before testing source registration and bindings in the preview
UI. Keep fixture credentials outside the repository. Promote only after the
same commit passes CI and preview evidence, following the production workflow.
Production requires its own bridge secret, approved database allowlist, and
HTTPS endpoint; never reuse the preview fixture database stack as production.

### Production bridge

Use `infra/db-bridge/compose.production.yml` for the independently authenticated
production bridge and tunnel. It publishes only a loopback health port (8792)
and does not include fixture databases. Set its private `.env` values as for
preview, using a different shared secret and dedicated tunnel. An omitted or
empty `DB_BRIDGE_ALLOWED_HOSTS` explicitly denies all database hosts; add only
approved destination hostnames when real sources are ready. Configure the matching
HTTPS URL and shared secret in the GitHub `production` environment.

After source policy changes, binding, unbinding, or metadata synchronization,
the client invalidates its cached collection catalog so navigation and editing
use the current backend definitions and capabilities.
