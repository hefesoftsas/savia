# Tenant user capacity

Tenant administrators can create and manage users in their own commercial
tenant. They cannot grant platform administration or move users to another
tenant. Operators and viewers cannot administer users.

Tenants have no active-user limit by default. A platform administrator can set
or clear the limit from the tenant edit page. A blank value means unlimited;
zero prevents additional activations. The users page displays current usage
to tenant administrators without allowing them to change the limit.

An active user has both an active identity principal and an active membership
in the tenant. Tenant administrators count toward the limit. Suspended users
do not count. Creating, transferring, or reactivating a user must leave the
tenant within its configured capacity. Reducing the limit does not suspend
existing users; admissions remain blocked until capacity becomes available or
the platform administrator raises or clears the limit.

The API checks capacity before account provisioning. Database triggers provide
the final atomic check, including concurrent requests for the last available
seat. SQLite/D1 and native PostgreSQL implement the same policy. Rejected
admissions return HTTP 409 with `TENANT_ACTIVE_USER_LIMIT_REACHED`.

Capacity is stored in `tenant_user_limits`. An absent row or a null
`max_active_users` means unlimited. Apply the core migrations before deploying
the API. API operations and payloads are documented in the generated
OpenAPI/Scalar reference.

## Verification

- API: `pnpm --filter @savia/api exec vitest run test/tenant-user-capacity.test.ts test/identity.test.ts`
- Native PostgreSQL: set `SAVIA_TEST_POSTGRES_URL` to a disposable server with
  database creation rights, then run
  `pnpm --filter @savia/self-hosted exec vitest run test/tenant-user-capacity.test.ts test/postgres-migrations.test.ts --maxWorkers=1`.
  Tests create and remove isolated databases.
