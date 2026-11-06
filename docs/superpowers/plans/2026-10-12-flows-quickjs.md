# Flows QuickJS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Execute all Flows JavaScript through the existing private QuickJS Worker without Dynamic Workers.

**Architecture:** A named private RPC entrypoint provides fresh bounded QuickJS guests and a JSON-only tool bridge. Flows injects that entrypoint through its existing executor interface; local and centralized infrastructure configs bind the shared Worker.

**Tech Stack:** TypeScript, QuickJS 0.31.0, Workers RPC, Miniflare, Vitest, Wrangler dry-run bundling.

**Spec:** `docs/superpowers/specs/2026-10-12-flows-quickjs-design.md`

## Global Constraints

- No cloud activation, deployments, external providers, or billing changes.
- Preserve the existing Request hook endpoint and all 51 catalog fixtures.
- Fresh guest per call; 16 MiB total allocation (8 MiB script + 8 MiB bridge headroom), 256 KiB stack/source, 2 MiB output.
- JSON-only tool boundaries; preserve the existing Flows executor interface.
- Preserve all pre-existing uncommitted changes in the active Flows worktree.

## Review Focus

- Concurrent tool completions after timeout must not access a disposed runtime.
- Prototype tool names must not invoke functions outside the approved tool map.
- Source, output, console logs, and tool traffic must stay bounded.
- Non-settling promises and synchronous loops must reject and permit recovery.
- Preview and production service bindings must refer to matching environments.

### Task 1: Shared private guest service (coordinator)

**Files:** `apps/hook-executor/src/{index,executor,guest,flow-executor}.ts`, `apps/hook-executor/test/flow-executor.test.ts`, `apps/hook-executor/README.md`.
**Produces:** named `FlowsExecutor.execute(code, dispatcher, {timeoutMs?})`, result `{result?,error?,logs?}`; dispatcher `call(name,argsJson): Promise<string>`.

- [x] Write failing real-interpreter tests for values, console capture, tools, isolation, and rejection/recovery.
- [x] Implement shared fresh-guest setup and the flow execution pump with bounded async callbacks.
- [x] Export the named ordinary Worker entrypoint without changing the hook HTTP handler.
- [x] Run hook-executor tests and typecheck, including existing catalog fixtures.

### Task 2: Flows adapter and local wiring (worker)

**Files:** `apps/flows/api/src/runtime/code-mode-executor{,.test}.ts`, Flows bindings/configs/scripts, runtime node copy, `docs/guides/savia-flows.md`, `apps/flows/README.md`.
**Consumes:** Task 1 RPC contract and `CODE_EXECUTOR` named service binding.

- [x] Write failing tests for the real private service and scoped tool bridge.
- [x] Replace DynamicWorkerExecutor; remove WorkerLoader bindings and stale messages.
- [x] Bundle/register the shared executor in local Miniflare and test Workers with its Wasm module.
- [x] Run API/runtime/script tests and typechecks; update the guide with guest API limits.

### Task 3: Centralized infrastructure binding (worker, separate existing worktree)

**Files:** `infra/pulumi/flows-worker-config.mjs`, related config tests and infrastructure guide in `code-as-infratructure` worktree.
**Consumes:** named service `savia-hook-executor[-preview]`, entrypoint `FlowsExecutor`.

- [x] Add failing generated-manifest tests for environment-matching binding and no WorkerLoader.
- [x] Replace the loader with `CODE_EXECUTOR`; document executor-before-Flows ordering.
- [x] Run infrastructure/config contracts without changing live flags or resources.

### Task 4: Combined verification and review (coordinator)

- [x] Review all changed files, run real service-binding smoke with JavaScript/JSON/calculator and async tools.
- [x] Run Flows suites, relevant infrastructure contracts, package typechecks, and bundle dry runs.
- [x] Request a bounded independent final review; fix material findings and reverify.
- [x] Record checks and any remote-only limits; report completion without activating preview.

## Execution ledger

- Existing externally managed linked worktree verified; no new checkout needed.
- User's no-approval instruction governs the design and plan approval stages.
- File ownership: coordinator owns `apps/hook-executor/**` and this spec/plan; adapter worker owns `apps/flows/**` plus its guide; IaC worker owns the separate infrastructure tree. Root dependency files are serialized by the coordinator if needed.
- Shared contract reviewed: Task 1 produces the exact named RPC entrypoint consumed by Tasks 2 and 3. No feature flags change.
- Memory ruling: reserve 8 MiB of the existing 16 MiB budget for bridge/FFI allocations and cleanup. A saturated script heap previously caused cached-engine cleanup to abort; scripts now run under an 8 MiB limit, and only controlled host operations borrow headroom. The tradeoff is a stricter per-script allocation limit.
- Verification: hook executor 50 unit tests and 3 real Worker tests (51 catalog hooks); Flows API 873 passed; runtime 3,758 passed and 7 skipped; local scripts 15 passed; IaC 106 passed. After the headroom fix, the 8 real-binding tests and all 15 local smoke tests passed again against a freshly rebuilt service.
- Final independent review and scoped memory-headroom re-review found no blocking issues. See `docs/verification/2026-10-12-flows-quickjs.md` for commands and limits of the evidence.
