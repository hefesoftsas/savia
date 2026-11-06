# Record read performance

Studio preserves exact record totals and existing search results while reducing
repeated scans on D1 and PostgreSQL. Both backends maintain whole-collection
counts and configured summaries transactionally and support configured JSON
indexes. The revision cache and FTS5 candidate index remain SQLite/D1-specific.

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

## Opt-in cold-read acceleration

A local collection can declare `config.performance` with up to four indexes
and four maintained summaries. These settings are explicit: the engine does
not create indexes for every field or infer them on the request path.

```json
{
  "indexes": [
    { "fields": ["name"], "order": "ASC" },
    { "fields": ["stage", "updated_at"], "order": "DESC" }
  ],
  "summaries": [{ "group": "stage", "amountField": "amount" }]
}
```

The first index supports name ordering. The second supports an exact stage
filter followed by newest-first ordering. Indexes are scoped to the tenant,
collection and active rows; they do not duplicate index entries for unrelated
collections. Index names are deterministic hashes, and field expressions match
the query dialect. Publishing creates or retires indexes within the metadata
transaction. Collection deletion removes its indexes and summaries.

Administrators can change performance settings independently of the schema
through the generated OpenAPI operation `configure_record_performance`.
It requires the current collection version and updates metadata, selected
indexes and summary backfills atomically without rewriting record payloads.
Building an index or initial summary still reads existing records: configure a
large remote collection separately and validate D1 execution limits before
rollout. Regular reads never perform schema changes or backfills.

Configured indexed sorts support typed cursors, including numeric values,
nulls, and repeated values. The ID breaks ties. Unconfigured sorts and random
page jumps retain the existing behavior. Indexes can accelerate matching
filters, but an exact count over an arbitrary combination can still require
scanning the matching index range.

A maintained summary stores active count and optional numeric sum for each
group. Inserts, updates, trash, restore, moves and deletes change only the
impacted groups in the same database transaction. A single exact equality
filter on a configured grouping field can reuse its count in the page batch.
The summary endpoint uses the maintained result only for its configured group
and amount field without extra filters/search/trash, and only when the row
policy grants the whole collection. Restricted row policies always execute
their own predicates. Field permissions still apply to all queries.

Choose low-cardinality grouping fields such as status. High-cardinality fields
create more summary rows. Sums retain SQLite REAL arithmetic, including its
floating-point precision limits; this is not an exact-decimal accounting
ledger. Repeated reads do not depend on the revision cache for the accelerated
page/count/summary paths. Arbitrary filters, unsupported orders, and restricted
row summaries can still use the existing cache and query fallback.

PostgreSQL uses native btree expression indexes with separate type-rank, numeric
and text keys, preserving mixed JSON ordering and stable cursor ties. PostgreSQL
triggers maintain counts and summaries in the same transaction as writes.
Configuration/backfill locks record writes while publishing the new definitions;
normal reads never build indexes or summaries. Configuration on a large table
therefore needs a maintenance window. Whole-collection counters serialize writes
to the same collection; measure concurrent writes as well as read improvements.

PostgreSQL initialization installs configured indexes that were previously
inactive. Its SQLite importer skips source derived tables, rebuilds native counts
and summaries from imported records/metadata, and creates configured indexes
before committing. Authentication and record payloads are not rewritten for this
acceleration. PostgreSQL still executes unconfigured or permission-restricted
queries directly, without the D1 revision cache or FTS5 index.

Validate with `STRESS_PERFORMANCE=1 STRESS_COLD=1` in the local stress runner.
Add `STRESS_MIXED=1 STRESS_MIXED_SAME_COLLECTION=1` to interleave matching reads
and real writes on the same collection, then compare maintained summaries
against direct SQL. Report uncached latency, rows read, writes, and database
size rather than treating a warm cache hit as evidence of a faster query.
