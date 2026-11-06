# Savia hook execution: QuickJS feasibility experiment

Measured on 2026-10-04 against repository commit
`0204bc979479593c9ff33b5e2d16fa4ddebece90`.

**Experimental, throwaway harness; not a production executor or migration.**
The subsequent implementation lives in [apps/hook-executor](../../../apps/hook-executor/README.md)
and uses the user-requested 30-second platform CPU ceiling. This report preserves
the original measurements, not a claim that remote CPU enforcement has passed.
`baseline-hooks.ts` freezes the pre-migration Dynamic Worker implementation so
the comparison remains reproducible after Savia Request changes executors.

No application files, production configuration, credentials, provider endpoints,
or database state were changed. The question approved for this experiment was
whether Savia could retain editable hooks using QuickJS in ordinary Cloudflare
Workers, at lower cost than Dynamic Workers.

## Decision

QuickJS **runs in an ordinary Worker** and matches all 51 nonempty hook
occurrences in the tracked catalog with synthetic fixtures. However, putting this
prototype inside the main Savia Request Worker is **not ready for production**:
guest instruction and memory limits do not reliably bound expensive native
operations. A malicious regular expression exceeded an external five-second
watchdog; allocation pressure took about 13.9 seconds to reject.

The immediate cost issue is more specific than “Dynamic Workers are expensive”:
`apps/savia-request/src/server/hooks.ts` calls `LOADER.load()` for every nonempty
hook. Cloudflare explicitly counts this as a new Dynamic Worker per invocation.
The same API provides `get(stableId, callback)` to reduce creation counts to
unique ID/code pairs active each day. This was also the fastest local variant.

Recommended order:

1. Evaluate tenant-scoped, versioned `get()` reuse first if retaining state within
   a tenant/hook is acceptable. This is the smallest potential cost reduction.
   Do **not** ship the experiment's global code-only hash: the probe demonstrates
   that it shares guest globals between requests. Include the full security
   boundary (tenant/catalog scope, any required actor boundary), exact generated
   module/configuration identity and policy version; define and test reuse
   semantics. Tenant scoping prevents cross-tenant reuse but does not restore
   fresh globals within a tenant. Scripts may retain memory or poison globals;
   this needs explicit handling or a decision not to cache those scripts.
2. If zero Dynamic Worker creation fees and fresh guest state are required, pursue
   QuickJS in a **separate ordinary Worker** with a platform-enforced CPU limit
   and one hook per invocation, invoked privately from Savia Request. Keep guest
   memory/input/output budgets. A timer in the same isolate cannot preempt
   synchronous Wasm. Validate CPU cancellation, recovery, concurrent requests and
   actual billed CPU in a deployed canary before migration. The probe's separate
   Wrangler config now sets `cpu_ms: 30000` (30 seconds), as requested for
   Workers Paid after the initial experiment. This is the outer CPU ceiling;
   the prototype's independent instruction, pending-job and memory budgets still
   apply and may reject a script earlier. Existing benchmark results describe the
   original experiment and have not been relabeled as 30-second-limit tests.
   Platform enforcement was **not tested on
   Cloudflare**; local measurements do not establish it.
3. Retain the current production path until those checks pass. Neither alternative
   is an unconditional drop-in replacement as implemented in this experiment.

## Reproduce

From the repository root after the normal `pnpm install`, on Linux with Node 24:

```sh
node docs/experiments/savia-hooks-quickjs/verify.mjs
node docs/experiments/savia-hooks-quickjs/watchdog.mjs
node docs/experiments/savia-hooks-quickjs/benchmark.mjs
CLOUDFLARE_SEND_METRICS=false node apps/savia-request/node_modules/wrangler/bin/wrangler.js deploy --dry-run \
  --config docs/experiments/savia-hooks-quickjs/wrangler.jsonc \
  --outdir docs/experiments/savia-hooks-quickjs/.build/cloudflare
```

`runtime.mjs` resolves the already locked QuickJS dependencies from self-hosted
and esbuild/Miniflare from Wrangler; it does not install or update dependencies.
It builds the sync release Wasm variant using Cloudflare's precompiled Wasm module
import. The ordinary Worker has **no LOADER, unsafe eval binding, Node compatibility
flag or application bindings**. Generated bundles go into ignored `.build/`.
The last command is packaging only, not deployment. The probe endpoint is a
measurement harness, not a production API; never expose it publicly.
Wrangler 4.127.1 completed that dry run successfully: **583.05 KiB total upload,
255.27 KiB gzip, no bindings**. This verifies ordinary-Worker packaging, not
remote execution or CPU-limit enforcement. The direct Node command avoids this
environment's pnpm auto-install/version mismatch; no dependency reinstall was
performed.

`verify.mjs` checks functional rejection and recovery; it intentionally does not
assert that rejection was fast enough. Read the elapsed times and the separate
watchdog failure before concluding anything about resource isolation.
`watchdog.mjs` reproduces a **known failure** and kills its child process group
after five seconds of execution. Its exit code zero means the observation was
recorded, not that QuickJS passed. Run it separately from timing benchmarks.
`PROBE_SAMPLES` and `PROBE_ROUNDS` override the benchmark's defaults of 200 and 3.

Artifacts:

- [verification.json](verification.json): compatibility and adversarial observations.
- [regexp-result.json](regexp-result.json): independent hard-watchdog failure.
- [benchmark.json](benchmark.json): raw samples, per-round CPU deltas, environment,
  bundle sizes, first calls and aggregate results.

## Coverage and isolation findings

The tracked catalog has 22 flows, 45 steps, 51 nonempty hook occurrences and 41
distinct script strings. Hook code and body templates come directly from the
catalog; input and response values are generated synthetic fixtures. No stored
secrets, live provider calls, tenant database scripts or production traffic are
used. This establishes compatibility with those fixtures, not every possible
input or user-authored script.

| Check                             | Observation                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Catalog success cases             | 51/51 identical results for load, get and QuickJS                                                      |
| Invalid-input cases               | 51/51 rejected by current load and QuickJS                                                             |
| Host globals, network, imports    | No host globals exposed; network/import attempts rejected                                              |
| Simple infinite loop              | Interrupted and next request recovered, about 56 ms local wall time                                    |
| Infinite promise jobs             | Rejected, about 10 ms                                                                                  |
| Pending promise, stack exhaustion | Rejected and recovered                                                                                 |
| Input/output > 1 MiB              | Rejected                                                                                               |
| Hostile serialization getter loop | Interrupted, about 90 ms                                                                               |
| Allocation pressure               | Eventually rejected, **13.9 seconds**, too slow for the existing hook budget                           |
| Catastrophic regex                | **Still running at five seconds**, killed externally; initial exploratory run also exceeded 45 seconds |
| Fresh QuickJS guests              | No cross-request global/prototype carryover in tested cases                                            |
| 20 concurrent requests            | Correct, distinct returned payloads; not a throughput load test                                        |
| Stable get ID                     | **Globals retained across calls**, unlike current load path                                            |

QuickJS uses a 16 MiB guest allocator cap, 256 KiB stack, 1,000 interrupt callbacks
and 1,000 pending jobs. These counts are **not milliseconds**. Workers clocks do
not advance during synchronous execution, so copying the self-hosted Node
`Date.now()` deadline is insufficient. The tests disprove the assumption that
instruction callbacks alone enforce the existing 100 ms CPU / five-second wall
budget against all scripts. The 16 MiB cap is not a total Wasm/V8/process memory cap.

## Measurements

Nine thousand measured local calls: five cases × three engines × three rounds ×
200 calls, with 20 warmups per case per round. Engine order rotates across rounds.
Each engine/round starts its own workerd process. Linux x64, AMD EPYC 9V74,
Node 24.19.0, workerd 1.20260828.1, QuickJS Emscripten 0.31.0.

Median end-to-end loopback latency, milliseconds:

| Case                        | Current load | Stable get | QuickJS in ordinary Worker |
| --------------------------- | -----------: | ---------: | -------------------------: |
| Empty hook (control)        |         0.98 |       0.91 |                       0.93 |
| Token JSON extraction       |         4.00 |       1.06 |                       1.53 |
| SBS request XML preparation |         4.54 |       1.20 |                       2.88 |
| SBS response XML extraction |         4.44 |       1.10 |                       2.02 |
| Synthetic JSON ~100 KB      |         5.12 |       2.04 |                       6.16 |

Mean local **workerd process** CPU per call, milliseconds:

| Case                        | Current load | Stable get | QuickJS |
| --------------------------- | -----------: | ---------: | ------: |
| Empty hook (control)        |         0.45 |       0.45 |    0.47 |
| Token JSON extraction       |         3.58 |       0.63 |    1.25 |
| SBS request XML preparation |         4.10 |       0.73 |    2.53 |
| SBS response XML extraction |         3.97 |       0.67 |    1.60 |
| Synthetic JSON ~100 KB      |         4.57 |       1.30 |    5.40 |

CPU is the delta of `/proc/<workerd-pid>/stat` user+system CPU over each batch,
including runtime, garbage collection, IPC and other process threads. Linux clock
ticks have 10 ms granularity here. It is **not Cloudflare billable CPU**, and the
empty case shows substantial fixed harness overhead. Wall time comes from Node
outside the Worker, not the frozen Worker clock. Neither table measures provider
latency, production concurrency, geographic placement or end-to-end quote flows.

First nonempty calls after a fresh local process took 19–40 ms with QuickJS,
6.8–7.9 ms with load, and 6.6–7.5 ms with get. These are only three observations
per variant, include local initialization/IPC, and are not production cold-start
statistics. The get benchmark pays SHA-256 identity calculation on each request.

QuickJS adds 518,880 bytes of Wasm and 56,822 bytes of bundled JavaScript; their
gzip sizes sum to 258,753 bytes (~253 KiB). The dynamic comparison wrapper is
1,912 bytes (1,049 gzip). Sizes are for these minimal harnesses, not the complete
Savia Request application. RSS snapshots are in raw results and are neither guest
heap usage nor peak memory measurements.

## Cost evaluation

Verified against official Cloudflare documentation source at commit
`e43015cd6cddad3ee1c0fa087c4d5022e65e7c98` on 2026-10-04:

- [Dynamic Workers pricing](https://developers.cloudflare.com/dynamic-workers/pricing/)
- [Pinned pricing source](https://github.com/cloudflare/cloudflare-docs/blob/e43015cd6cddad3ee1c0fa087c4d5022e65e7c98/src/content/docs/dynamic-workers/pricing.mdx)
- [Ordinary Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)

The key rule is explicit: “No ID provided or `.load(code)` used” counts as
“1 Dynamic Worker per invocation”. Creation overage is **$0.002 per Dynamic Worker
per day**. Repeated same-ID/same-code calls count once per day; changing ID or code
counts another creation. Creation billing has applied since May 26, 2026.

Gross creation-charge scenarios, **before included allowances**, excluding request,
CPU, other infrastructure and taxes:

| Scenario                                                   |                                                  Gross creation charge |
| ---------------------------------------------------------- | ---------------------------------------------------------------------: |
| 10,000 nonempty hook executions using load                 |                                                                    $20 |
| 100,000 using load                                         |                                                                   $200 |
| 1,000,000 using load                                       |                                                                 $2,000 |
| get: 41 stable ID/code pairs active on each of 30 days     |                                                                  $2.46 |
| get: same scenario across 10 isolated tenant namespaces    |                                                                 $24.60 |
| get: same scenario across 100 isolated tenant namespaces   |                                                                   $246 |
| QuickJS in ordinary Workers, any of those execution counts | $0 Dynamic Worker creation charge; ordinary Worker usage still applies |

The get scenarios assume all 41 scripts execute every day, one identity per script
and tenant, no changed versions/policies and no additional security boundaries.
They are illustrations, **not Savia's production usage**. Empty hooks return early
and do not create a Dynamic Worker; count actual nonempty pre/post hooks, not
business flows or quotes. A flow can execute multiple hooks.

The docs list 1,000 unique Dynamic Workers/month included but describe the charged
counter by day. Confirm the account's `distinctDynamicWorkerCount` and invoice
before subtracting that allowance or projecting net charges; the table above
deliberately does not claim a net invoice. Dynamic requests and CPU share the
ordinary Workers allowance; they are not a separate included pool.

Workers Paid is $5/month **per account/plan, not per Worker**, including 10 million
requests and 30 million CPU-ms; overage is $0.30/million requests and
$0.02/million CPU-ms. Each dynamic child fetch is a request. Dynamic CPU includes
isolate startup/code parsing in addition to execution. An in-process QuickJS
executor eliminates the dynamic-child request and creation charges but contributes
CPU to the parent; a separate ordinary Worker needs its invocation path and
actual accounting validated as well.

For sensitivity, if deployed QuickJS averages 5 billed CPU-ms/hook, one million
hooks consume 5 million CPU-ms: **$0.10 gross CPU overage**, or no incremental CPU
charge if they fit inside the remaining allowance. At 100 ms/hook this becomes
$2.00 gross per million before the included CPU allowance ($1.40 in incremental
overage if the full 30 million CPU-ms allowance remains). These are assumed CPU
scenarios, **not conversions of the local
CPU table**. The significant saving target is creation fees, not small CPU
differences. Shared plan usage elsewhere in Savia affects remaining allowances.

No Cloudflare account credentials/usage export were available in this environment,
so this experiment did not deploy, measure billed `cpuTime`, inspect the current
invoice or establish actual monthly savings. Those are the remaining checks for
an infrastructure decision; the local evidence already rules out shipping this
in-process QuickJS prototype unchanged.
