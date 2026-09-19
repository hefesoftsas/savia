# PostgreSQL for self-hosted Docker

PostgreSQL is an optional application database. Cloudflare continues to use D1; SQLite remains the default Docker option. An external SQL collection is a separate integration and does not change Savia's application database.

This topology supports **one application instance**. PostgreSQL does not distribute WebSocket connections, rate-limit windows or the scheduler between application replicas.

## Fresh installation

Generate a new private configuration file; the helper never overwrites an existing one:

```sh
node scripts/configure-self-hosted.mjs --email admin@example.com --database postgres
docker compose --env-file infra/secrets/self-hosted.env -f docker-compose.self-hosted.yml -f docker-compose.self-hosted.postgres.yml up --build -d
```

Open `http://localhost:8080`, use the generated bootstrap password and enroll MFA. The override runs a pinned PostgreSQL 17 image with a persistent named volume and no published database port. The application uses separate `savia_core`, `savia_auth` and `savia_request` schemas in one database. Initialization is coordinated by an advisory lock; a failed migration prevents startup.

The `--env-file` flag is necessary for Compose to supply the database password to PostgreSQL. `SAVIA_ENV_FILE` selects a different application env file; when using it, pass the same file to `--env-file`.

## External PostgreSQL

Set `SAVIA_DATABASE_DRIVER=postgres` and `SAVIA_POSTGRES_URL` to a database owned by the Savia runtime user. Use the base Compose file without the PostgreSQL service override. External hosts require `sslmode=verify-full`; an optional `sslrootcert` points to a CA file mounted read-only in the application container. Certificate verification is mandatory.

`SAVIA_POSTGRES_POOL_SIZE` defaults to five connections per schema, plus short-lived migration connections. Values from one through twenty are accepted. Account for all three pools when configuring server connection limits. The application role needs ownership of its schemas and tables for migrations and imports, but does not need superuser privileges.

Keep authentication, encryption, CAPTCHA and S3 secrets unchanged across restarts, upgrades and database migration. Never publish credentials in a connection URL in logs or support tickets.

## Compatibility boundary

Collection query and access-control behavior is tested against both SQLite and PostgreSQL. PostgreSQL does not support U+0000 in text or decoded JSON strings. The importer rejects incompatible JSON before copying data and identifies the source location; remove that character from the source data before retrying. JSON with invalid Unicode is not a portable data interchange format for this deployment.

## Backup and recovery

Stop Savia before a coordinated backup so PostgreSQL and S3 represent the same application state. Preserve the private configuration file, the S3 object volume and its storage configuration together with the database backup. A live database-only dump is not a coordinated application recovery point.

Use the same Compose arguments as installation:

```sh
docker compose --env-file infra/secrets/self-hosted.env -f docker-compose.self-hosted.yml -f docker-compose.self-hosted.postgres.yml stop savia
docker compose --env-file infra/secrets/self-hosted.env -f docker-compose.self-hosted.yml -f docker-compose.self-hosted.postgres.yml exec -T postgres pg_dump -U savia -d savia --format=custom > savia.dump
```

Stop the bundled `storage` service before copying its object and storage-configuration volumes; copying a running SeaweedFS data directory is not a consistent filesystem backup. For external S3, use the storage provider’s supported snapshot or backup procedure while application writes remain stopped. Store backups privately. Start storage and Savia again after completing the coordinated backup.

Restore into a separate, empty PostgreSQL database owned by the same application role, with Savia stopped:

```sh
docker compose --env-file infra/secrets/self-hosted.env -f docker-compose.self-hosted.yml -f docker-compose.self-hosted.postgres.yml exec -T postgres pg_restore -U savia -d savia --no-owner --exit-on-error --single-transaction < savia.dump
```

Restore the matching S3 volumes and secrets before starting Savia. Restore into empty volumes before creating the storage container, since the storage image can populate a new configuration volume with defaults. Verify login/MFA, records, attachments and synchronization in the restored installation before switching traffic. Do not restore a dump over an active installation. `docker compose down` keeps named volumes; `down -v` deletes them.

## Offline migration from SQLite

Stop the source application, back up all three SQLite files and the matching S3
volumes, and keep the existing authentication and encryption secrets. Work from a
copy of the stopped data directory. Upgrade the SQLite installation to the same Savia release before taking this copy; mismatched migration histories or checksums are refused. The importer opens the source read-only and
never switches the running application automatically.

Create an empty PostgreSQL database owned by the destination role. Supply its URL
privately through `SAVIA_POSTGRES_URL`, then run from the repository:

```sh
pnpm --filter @savia/self-hosted import:sqlite /absolute/path/to/stopped-data
```

In the application image, invoke the same command with the source directory
mounted read-only:

```sh
node --import ./apps/self-hosted/node_modules/tsx/dist/loader.mjs apps/self-hosted/src/postgres/import-cli.ts /source
```

The importer checks schema compatibility, copies all three stores in one
transaction, verifies mapped values and row counts, and advances generated ID
sequences. It refuses a destination containing any existing tables. A failed import can leave
empty initialized schemas, but cannot commit a partial copy of application data. Retry against another empty database, or explicitly recreate only the disposable failed destination after verifying it contains no user data.

After success, point a stopped application at PostgreSQL and restore its matching
S3 volumes and original secrets. Verify MFA login, records, attachments and sync
before directing traffic to it. Roll back by stopping the new application and
restarting the original SQLite installation with its original storage snapshot;
writes made after cutover are not automatically copied back.

## Native database verification

Use a disposable PostgreSQL server. The test role must be able to create and drop
fixture databases. Set `SAVIA_TEST_POSTGRES_URL` privately and run:

```sh
pnpm --filter @savia/self-hosted test:postgres
```

The required lane fails when its connection setting is missing, instead of
silently skipping native tests. Tests create uniquely named databases and remove
only their own fixtures.

The [SQL compatibility inventory](postgres-sql-compatibility.md) describes the native query and migration boundaries.
