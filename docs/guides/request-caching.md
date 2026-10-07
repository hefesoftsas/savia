# Request caching

Savia Request has an opt-in server response cache for reference reads. The same
engine handles every configured step; provider IDs do not select cache behavior.
Assistants, forms and flows that use these operations share the server cache.
Other API reads are not automatically cached. Browser responses remain `no-store`.

Configure a GET or HEAD step in its saved flow definition:

```json
{
  "cache": {
    "enabled": true,
    "ttlSeconds": 86400,
    "scope": "public"
  }
}
```

TTL must be a positive integer no greater than seven days. Omit `cache` or set
`enabled` to false to disable it. Public scope is for declared public reference
data; tenant scope isolates reads by tenant. Public requests containing credential
headers or parameters bypass the cache. The reusable helper also supports
connection scope when its caller supplies an explicit connection ID. Saved flows
currently have no execution connection identity, so authoring rejects enabled
connection scope instead of silently accepting a policy that cannot work.

Live writes, mock runs and authentication flows bypass caching. Only successful
bounded responses are stored; errors, cookies, cache-forbidden responses and
failed response validation are excluded. The generic helper accepts an optional
response validator so existing domain contracts are checked before persistence.

Keys hash the request method, URL, headers, scope and configuration revision.
Changing a step, policy, credential header or URL selects a different entry.
Requests with repeated query parameters preserve their value order. Cache hits
do not skip gateway authorization, flow access checks, or per-run hooks.

`savia_request_cache` in the backend DB stores expiring responses and short loading
leases. Requests in the same server instance share in-flight reads; other instances
wait for the persisted result within the caller's deadline and a bounded lease.
A failed cache falls back to the read operation; an active loading lease does
not trigger a duplicate upstream read. This is read deduplication, not a guarantee
that an upstream read executes exactly once. A successful fetch is not repeated
merely because its cache write failed. Aborting a waiting caller does not cancel
another caller's fetch. Expired entries are removed in bounded batches.

Step traces report `cacheStatus` (`hit`, `miss`, `coalesced`, `bypass`) and
`cacheAgeMs` when available. Internal helper response headers expose the same
information without request URLs, credentials or customer input in cache logs.

DANE is the first configured operation: its public DIVIPOLA catalog has a default
24-hour policy. Cities are resolved from that catalog, and the response retains
the catalog retrieval time. Invalid catalog payloads are not cached. A flow's
policy can change its TTL or disable the cache; there is no DANE-specific cache
implementation or cache kept in a module variable.

Cloudflare deployments use core migration `0052_request_cache.sql` because the
private Request Worker shares the domain D1 database. Standalone Request and
self-hosted deployments use `apps/savia-request/migrations/0002_request_cache.sql`
or its PostgreSQL equivalent. Apply migrations before enabling the new runtime.
