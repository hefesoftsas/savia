# Flows QuickJS verification

Date: 2026-10-12. All checks ran locally. No preview/production activation,
deployment, external provider calls, or Cloudflare resource changes occurred.

## Result

Flows uses the `CODE_EXECUTOR` private service binding to the existing ordinary
`savia-hook-executor` Worker's named `FlowsExecutor` entrypoint. JavaScript, JSON,
calculator, playground, and agent code mode retain the injected executor
interface. No Flows runnable manifest has a WorkerLoader binding or fallback.
The centralized IaC manifest selects the matching preview/production executor.

Fresh guests enforce an 8 MiB script allocator limit with 8 MiB reserved within
the 16 MiB total budget for controlled bridge/FFI work and cleanup. Source and
stack are bounded to 256 KiB, output to 2 MiB, tool calls to 128 total/16 pending.
The guest sees only serialized tool data and console capture, with no direct
network, filesystem, timers, application bindings, or host objects. Tool dispatch
accepts only the caller's own function-map entries; host exceptions are sanitized.

Large results initially exposed a QuickJS cleanup abort when the executor kept
them in nested async envelopes. A separate retained guest serializer after the
script promise settles fixes that lifecycle. A subsequent near-full-heap case
exposed insufficient allocation headroom during host exchange/cleanup. Controlled
bridge operations borrow the reserved headroom synchronously and restore the
script limit before guest jobs run. Cleanup closes callbacks before disposing
the guest; late completions never access dead handles.

## Checks

| Command                                                                                                | Result                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @savia/hook-executor test`                                                              | 50 unit tests and 3 real workerd tests passed; includes all 51 Request catalog hooks                                                         |
| `pnpm --filter @savia/hook-executor typecheck`                                                         | Passed                                                                                                                                       |
| `pnpm --filter @savia/flows-api test`                                                                  | 65 files, 873 tests passed with one worker/serial files                                                                                      |
| `pnpm --filter @savia/flows-runtime test`                                                              | 383 files, 3,758 passed, 7 skipped with one worker/serial files                                                                              |
| `pnpm --filter @savia/flows typecheck`                                                                 | API and app passed                                                                                                                           |
| `pnpm --filter @savia/flows-runtime typecheck`                                                         | Passed                                                                                                                                       |
| `node --test --test-concurrency=1 scripts/*.test.mjs` in `apps/flows`                                  | 15 tests passed after a fresh bundle; real local graph save/run/restart, both runtimes, collections, deduplication/cycles, HTTP and webhooks |
| `pnpm --filter @savia/flows-api exec vitest run src/runtime/code-mode-executor.test.ts`                | 8 real named-entrypoint binding tests passed again after the headroom fix                                                                    |
| `pnpm --filter @savia/flows verify:source`                                                             | 1,897 imports, 526 node implementations, 48 categories verified                                                                              |
| `node apps/flows/scripts/build-api.mjs`                                                                | Wrangler dry-run passed; named service binding and shared QuickJS Wasm emitted                                                               |
| `node --test infra/pulumi/*.test.mjs` in the infrastructure worktree                                   | 106 tests passed                                                                                                                             |
| `node --test infra/pulumi/worker-config.test.mjs scripts/render-cloudflare-production-config.test.mjs` | 18 config contracts passed                                                                                                                   |
| Scoped formatting and `git diff --check`                                                               | Passed                                                                                                                                       |

The final independent code review and memory-headroom re-review found no blockers.
Original imported hashes are preserved; five node metadata/comment adaptations
have explicit digests and reasons. The verifier still rejects unexpected edits.

## Evidence limits

This is local Miniflare/workerd evidence. No remote CPU enforcement or billed
CPU measurement was performed. Guest allocator limits are not a physical-memory
cap for the entire Worker/process; cached Wasm memory retains its high-water
allocation. Test scripts and Flows API/runtime configs default to serial files
and one worker to reduce local memory use. The monorepo-wide `pnpm test` was not
rerun; checks cover the changed executor, its consumers, local runtime and IaC.

Requests keep their original HTTP hook contract and allocator limit. Flows'
script limit is stricter to reserve bridge headroom. JavaScript/JSON node inputs
are encoded into generated source and share its 256 KiB limit. Existing remote
provider/container restrictions remain in place. Updating the shared executor
before Flows consumes its named entrypoint is required for a later authorized
deployment.
