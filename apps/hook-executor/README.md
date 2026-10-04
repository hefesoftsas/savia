# Private QuickJS hook executor

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
