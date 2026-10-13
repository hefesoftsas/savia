# Private QuickJS hook executor

The same private ordinary Worker also serves Savia Flows through the named
`FlowsExecutor` RPC entrypoint and its `CODE_EXECUTOR` service binding. No Dynamic
Worker or WorkerLoader is used. The default Request hook HTTP contract remains
unchanged.

## Flows contract

`FlowsExecutor.execute(code, dispatcher, {timeoutMs?})` returns
`{result?, error?, logs?}`. Scripts run once as the body of an async function.
The Flows adapter binds JavaScript arguments/JSON input and preserves last-expression
semantics; console log, warning, and error messages retain the existing prefixes.

Each call uses a fresh guest with a 16 MiB total allocator budget: 8 MiB for
script execution and 8 MiB reserved for temporary bridge/FFI strings and cleanup.
The stack and source budgets match Request hooks. The bridge borrows headroom
only during controlled host operations and restores the script limit before
executing guest jobs. Serialized output (including logs) is limited to 2 MiB. Console
capture allows 1,024 lines and 1,048,576 UTF-16 code units; the exact UTF-8
output budget still applies. The deadline is at most 30 seconds and never exceeds
the configured 30,000 ms platform CPU ceiling. Synchronous Wasm cannot be reliably
preempted by a timer locally; interrupt and promise-job counts are supplementary
limits, and remote CPU enforcement still needs an authorized cloud canary.

`codemode.<tool>(args)` crosses an RPC capability that the caller creates for
that execution. Only the caller's own callable tool-map properties are allowed.
Arguments and results cross the guest boundary as bounded JSON strings, with at
most 128 calls and 16 outstanding calls per script. Flows limits tool arguments
to 256 KiB and results to 2 MiB. Guest code has no direct network, filesystem,
timers, module loader, secrets, application bindings, or host objects.

Timeout closes and disposes the guest. Late tool completions are ignored without
accessing disposed Wasm handles; operations already dispatched can still finish
and their side effects are not rolled back or retried by the executor. Scripts
that need delays should use Flows' durable wait/delay nodes.

The Flows result is serialized after its script promise settles, rather than
retaining large results in nested async envelopes. Regression tests cover large
results, rejected oversize/UTF-8 output, repeated rejection and recovery, unawaited
and late tool callbacks, near-limit allocation pressure, and isolated guest heaps.
Wasm linear memory retains its
high-water allocation; disposing guests releases live objects, not physical
memory pages already allocated by the cached engine.

Deploy/update this shared Worker before Flows consumes its named entrypoint.
Local Miniflare loads its Wrangler dry-run bundle and emitted Wasm asset, with
one instance shared by the local Flows service. No cloud deployment is needed
for the local service-binding tests. The executor test script and the Flows API
and runtime test configs default to one worker and serial files to keep local
verification memory bounded.

Savia Request calls this ordinary Cloudflare Worker through the `HOOK_SERVICE`
service binding. It replaces per-hook Dynamic Worker creation. There is no public
route, `workers.dev` endpoint, application binding or Node compatibility flag.
The gateway/API continues to authenticate users and select tenant data before
the request engine sends a hook's code and serialized payload to this service.

Each call receives a fresh QuickJS runtime and context. Only the Wasm engine is
cached; guest globals, prototypes and variables are not reused. The guest receives
the existing `req`, `res` and `bru` compatibility surface, but no host functions,
module loader, network, filesystem, timers, databases or application bindings.
Saved secret variables are still filtered by Savia Request before hook execution;
provider responses may contain tokens that post-hooks need to extract.

## Contract and budgets

`POST /execute` accepts `{code, payload: {body, values, response?}}` and returns
`{body, variables}`. Bodies and variable values are strings. The service validates
types and sizes, serializes guest results inside QuickJS and returns generic
errors rather than script errors, data or stack traces. There is no dynamic-loader
fallback. Self-hosted Savia retains its existing Node `HOOK_EXECUTOR` adapter.

| Budget                            | Value         |
| --------------------------------- | ------------- |
| Configured Cloudflare CPU ceiling | 30,000 ms     |
| Caller wall timeout               | 35,000 ms     |
| Guest allocation limit            | 16 MiB        |
| Guest stack                       | 256 KiB       |
| Script source                     | 256 KiB UTF-8 |
| Serialized HTTP input envelope    | 16 MiB        |
| Serialized result                 | 2 MiB         |
| Supplementary interrupt callbacks | 1,000,000     |
| Pending promise jobs              | 1,000,000     |

The input envelope allows JSON escaping of the request engine's existing maximum
two-million-character response. A payload can still exceed guest memory depending
on its content and the script's transformations. The guest allocator limit is
not a cap on total Worker memory.

Counters are not milliseconds. Platform CPU enforcement is necessary because
native interpreter operations (notably regex backtracking and allocation pressure)
may not call the guest interrupt handler promptly. A JS timer cannot reliably
preempt synchronous Wasm. The configured CPU ceiling does not guarantee 30 seconds
of useful script work: memory, source, output and supplementary guest budgets may
reject earlier. Local workerd tests do not establish remote CPU enforcement.
Service-binding CPU is billed across the request chain; do not infer independent
per-hop enforcement from the billing rule.

## Development and deployment

`pnpm dev` starts the private executor on local port 8798 before Savia Request
(8797). `pnpm --filter @savia/hook-executor test` checks the real interpreter and
then the actual bundled Worker/service-binding path, including 51 tracked catalog
hooks with synthetic inputs. `typecheck` checks TypeScript. A Wrangler dry run
verifies the compiled Wasm asset is uploaded; it is not a deployment.

The production/preview config renderer adds the Worker and the request service
binding. Workflows deploy the executor before the request engine. Branch previews
use matching isolated names and the standard preview cleanup script includes the
executor. No database migration or provider credentials are required for this
change. Do not expose the executor as a public arbitrary-code API.

The QuickJS PR preview workflow deploys a reviewed same-repository PR head when
the `quickjs-preview` label is explicitly added, using the `preview` environment's
credentials. New commits do not automatically redeploy: remove and re-add the
label after reviewing the new head. Remote smoke tests use an ephemeral authenticated
Wrangler session with fixed synthetic fixtures, not a published code-execution
endpoint. The CPU canary uses a higher caller ceiling to distinguish a target
cutoff from a caller cutoff, then verifies recovery with a benign request.
Any failed or unavailable CPU canary must remain explicit in preview results;
passing local tests alone is not evidence to promote this change to production.

Ordinary service-binding calls have no additional request charge and no Dynamic
Worker creation fee; CPU still contributes to the account's Workers usage.
See the [feasibility report](../../docs/experiments/savia-hooks-quickjs/README.md)
for the historical comparison and measured limits of the initial prototype.
