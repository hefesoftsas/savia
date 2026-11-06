# Flows QuickJS execution

## Intent and authorization

Replace Flows' per-call Dynamic Workers with the private QuickJS Worker already
used by Savia Request. The user approved this approach and instructed autonomous
completion without additional approvals. All validation stays local; no cloud
services, deployments, external providers, or billing changes are authorized.

## Architecture

The existing `savia-hook-executor` keeps its Request hook HTTP contract. Add a
named `FlowsExecutor` WorkerEntrypoint, reached by the `CODE_EXECUTOR` service
binding. Its `execute(code, dispatcher, options)` RPC accepts source code, a
capability-scoped dispatcher exposing only `call(name, argsJson): Promise<string>`,
and `{timeoutMs?: number}`. It returns `{result?: unknown, error?: string, logs?:
string[]}`. Tool requests and responses cross the guest boundary as JSON strings;
the guest never receives a Worker binding or a host object.

The Wasm engine is cached, but each invocation creates and disposes a fresh
QuickJS runtime and context. Keep a 16 MiB total allocator budget, divided into
8 MiB for script execution and 8 MiB of headroom for controlled bridge/FFI
allocation and disposal. Restore the script limit before executing guest jobs.
Reuse the Request limits for 256 KiB stack, 256 KiB UTF-8 source, 2 MiB serialized output, bounded promise jobs
and interrupt callbacks. Enforce a maximum 30-second execution deadline alongside
the ordinary Worker's 30,000 ms Cloudflare CPU ceiling. Timers, Web APIs, filesystem,
imports, direct network access, and application bindings are unavailable to guest
code. Supplementary guest interrupts are not a substitute for remote CPU limits.

The guest console captures `log`, `warn`, and `error` with the existing warning
and error prefixes. `codemode.<tool>(args)` creates guest promises resolved by the
host dispatcher, including concurrent and sequential calls. Unknown tools fail,
prototype properties never resolve as tools, and timeouts stop new dispatches.
Tools already dispatched may have side effects and cannot be rolled back by a
guest timeout; no restart or retry of the script is performed by this adapter.

## Integration

Keep the injected `CodeModeExecutor` interface for JavaScript, JSON transforms,
calculator, playground, and agent tools. Replace the Cloudflare implementation
with the private RPC service and fail closed when it is missing. Remove Flows'
WorkerLoader bindings from all runnable configurations. Local Miniflare builds
and registers the shared executor with its Wasm module and named entrypoint.
The centralized IaC manifest binds to the environment-matching existing executor
and must not enable Flows or create infrastructure during this change.

## Acceptance

- Request hook behavior remains unchanged, including all 51 catalog fixtures.
- Real QuickJS tests cover result/log semantics, isolated heaps, async tools,
  rejected/unknown tools, bounded input/output, infinite loops, pending promises,
  timeouts, and recovery without late callbacks accessing disposed guests.
- Cached-engine reuse under allocation pressure rejects scripts that consume
  bridge headroom and still disposes the runtime without an abort.
- Real local service-binding tests exercise the Flows adapter and nodes without
  WorkerLoader, including an authorized synthetic tool callback.
- Existing Flows and relevant infrastructure contracts pass, and bundles contain
  the QuickJS Wasm asset. No cloud activation or remote CPU enforcement is claimed.
