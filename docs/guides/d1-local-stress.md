# Local D1 volume and concurrency probes

Run the actual Studio record routes against disposable Miniflare/workerd D1 with
synthetic records and all checked-in SQL migrations. This is a diagnostic harness,
not a production capacity certification or a load generator for remote URLs.

```sh
node scripts/d1-stress/run.mjs
```

Defaults: 10,000, 100,000, and 1,000,000 cumulative records; concurrency 1, 8,
and 32; 32 requests per scenario/concurrency cell after a warm-up. Output is
saved under `.wrangler/d1-stress/reports/<timestamp>/results.json`, along with
copies and hashes of the harness. No existing Wrangler state, credentials or
remote resources are used. The temporary Worker bundle and Miniflare state are
disposed at exit. Never deploy `scripts/d1-stress/worker.ts`.

For a small correctness smoke test:

```sh
STRESS_SIZES=1000 STRESS_CONCURRENCY=1,4 STRESS_SAMPLES=4 STRESS_MIXED=1 node scripts/d1-stress/run.mjs
```

For a larger mixed workload after seeding one million records:

```sh
STRESS_SIZES=1000000 STRESS_SCENARIOS=mixed-only STRESS_MIXED=1 STRESS_SAMPLES=128 node scripts/d1-stress/run.mjs
```

`STRESS_SCENARIOS` is a comma-separated selection of the names below; the
`mixed-only` selector skips read-only scenarios. `STRESS_OUTPUT` selects the
report directory. `STRESS_CURSOR=1` adds a deep cursor probe;
`STRESS_MIXED_SAMPLES` overrides the mixed workload sample count separately.
`STRESS_PERFORMANCE=1` configures the contacts and deals performance indexes
and grouped summary through the local object API before seeding, then adds
indexed name sorting, stage-filtered timestamp sorting, and grouped-summary
scenarios. `STRESS_COLD=1` makes the local Worker adapter return a cache miss
for each read-cache lookup while leaving cache writes enabled; the report marks
these requests as `cold-bypass` and records the number of bypassed lookups.
`STRESS_MIXED_SAME_COLLECTION=1` enables the performance configuration and runs
the 80/20 workload against contacts: reads filter `stage=open` and sort by
`updated_at`, while writes also target contacts. After each concurrency level,
the harness compares the API summary with direct SQL to check summary
maintenance after writes. It also retains the record/sync and foreign-key
integrity checks. This option can be combined with `STRESS_COLD=1`.
Each scenario also records `coldMs` for its first request before warm samples.
The read profile stops on its first request error or a p95 above
30 seconds (`STRESS_STOP_P95_MS`), saves partial results and exits nonzero.
Sizes must increase and stay between 100 and 1,000,000;
concurrency is bounded to 1–64 and samples to 2–500. Increase sample counts for
more stable percentiles; with 32 observations p99 is just the maximum.

## Coverage

- Lookup by primary key.
- First-page list with exact count.
- Deep pagination at approximately 90% of the collection.
- JSON field sorting and equality filtering.
- General substring search across JSON values.
- Grouped count/sum summaries.
- Optional indexed JSON sorting, stage-filtered sorting and configured grouped
  summaries through `STRESS_PERFORMANCE=1`.
- Object menu counts.
- Optional 80/20 list/create traffic through the real routes, checking committed
  write counts, foreign keys, and record/sync row counts afterwards.
- Optional same-collection reads and writes through
  `STRESS_MIXED_SAME_COLLECTION=1`, including a direct SQL summary comparison.

The dataset has two tenants and two collections. Tenant `900001` contains 80%
of all seeded rows in `contacts` and 10% in `deals`; tenant `900002` owns the
remaining 10% in `deals`. Each record has five JSON fields including 256 bytes
of notes. Dates and IDs are unique and deterministic. All records are active.
Original SQL triggers run during seeding and requests; one sync row is created
per record. History, workflow and notification subscriptions are not configured,
so this is not a measurement of their fanout. Synthetic direct seeding bypasses
application create validation; measured writes use the real create route.

The harness uses `createStudioApp` with a fixed local identity. The outer OAuth
and ACL middleware, browser loading, R2 operations, external integrations,
plugin catalog and relation-detail fanout are excluded. Run additional profiles
before drawing conclusions about these paths.

## Interpreting results

Each scenario records end-to-end local dispatch latency (including JSON
serialization and instrumentation), p50/p95/p99, throughput, HTTP errors and D1
rows read/written. Query plans and SQL parameters come from a separate warm-up,
not from timed `EXPLAIN` calls. Native D1 `first()` is preserved and has no public
metadata, so `rowsRead` is a lower bound excluding those lookups. Counts across
`all()` and `batch()` include all instrumented statements, not just the final
page query. Errors cause a nonzero exit after the report is saved.

Concurrency runs are closed-loop, finite request bursts without think time.
They reveal serialization and queueing, but are not sustained open-loop arrival
rate or soak tests. A local success does not guarantee Cloudflare CPU, memory,
queue, billing, network or execution-limit behavior. Local machine load and
instrumentation affect latency; compare query plans and scaling slopes as well
as elapsed milliseconds. Do not translate local requests/sec into production
capacity.

References: [D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/), and
[D1 query metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/).
