# Record read performance

Studio preserves exact record totals and existing search results while reducing
repeated scans on D1. PostgreSQL continues using its existing SQL path for
counts, searches and aggregates; D1-specific indexes and caches are not enabled
there.

## Pages and totals

D1 keeps active/trash counts and a monotonically increasing revision for each
tenant and collection. SQL triggers update these values in the same transaction
as record inserts, updates and deletes, including moves between collections or
tenants. Unfiltered whole-collection reads use these counts. Restricted row
policies and filtered queries use their actual predicates; a tenant-wide count
is never substituted for a restricted count.

Page queries select IDs before fetching JSON payloads. Numeric page jumps remain
supported. Timestamp and ID sorts additionally return `nextCursor`; supplying it
seeks from the last record instead of discarding earlier pages. Tokens are bound
to the tenant, collection, sort, filters and page size; all normal authorization
predicates still apply. Cursors convey position, not access rights. Records with
equal timestamps use ID as a stable tie-breaker; timestamp cursors use two bounded
index seeks so a large imported group with the same date is not rescanned. Concurrent edits can move rows
between pages; this is not a multi-request snapshot.

The main app uses these cursors for subsequent pages when available and falls
back to numbered pages if a token is no longer valid. Only short-lived navigation
hints are kept in memory, bounded to 128 positions per transport and cleared on
identity/session changes. Records are not persisted in browser storage.

## Repeated expensive reads

Filtered/dynamic-sort pages, pages with row-level policies and grouped summaries
use a D1-backed cache keyed by
tenant, collection, record revision and the query's SQL, bindings and policy
context. Any record mutation invalidates the old revision immediately. A read
computed concurrently with a write cannot be admitted under the newer revision.
Counts and page rows are still read in one batch on cache misses.

The cache retains at most 64 entries per collection, limits a payload to 512 KiB,
and expires entries after one minute. Expiry controls retention, not permission
to serve stale data: every hit checks the current record revision. Large results
bypass admission. Cold JSON sorts, arbitrary filters and grouped summaries can
still scan a collection; this cache primarily benefits repeated reads between
mutations and does not replace every possible domain-specific index or summary.

## Substring search

A trigger-maintained FTS5 trigram index narrows D1 search candidates. The existing
escaped `LIKE` predicate remains the final check, so token search does not replace
substring search and field-specific searches still validate the requested fields.
Short or unsupported search strings fall back to the original scan. Tenant,
collection, trash and row-permission predicates continue to constrain results.

Both migrations backfill existing data. The search projection and its index add
storage and write work; measure this tradeoff with the mixed workload before
estimating capacity. Migration time on an already large cloud database needs
its own validation against D1 execution limits.

## Verification

Use [the isolated local stress runner](d1-local-stress.md) for volume and concurrent
reads/writes. Compare first uncached requests as well as repeated requests; an
aggregate cache hit is not evidence that an arbitrary cold aggregation became
constant-time. Keep local timings separate from Cloudflare capacity estimates.
