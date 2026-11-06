# QuickJS hook execution and preview

The user approved replacing Dynamic Workers with a private ordinary Worker,
raising its CPU ceiling to 30 seconds, creating a PR and deploying a preview.
The feasibility findings are in `docs/experiments/savia-hooks-quickjs/README.md`.

## Constraints and interfaces

- New app `apps/hook-executor` (`@savia/hook-executor`), Worker
  `savia-hook-executor`; no public route, application bindings or Node compatibility.
- `HOOK_SERVICE.fetch(POST /execute, {code,payload})` returns the existing
  `{body,variables}` hook result. Keep the self-hosted `HOOK_EXECUTOR` seam.
- 30,000 ms platform CPU ceiling, 35-second caller wall timeout. A fresh QuickJS
  runtime/context per invocation; no host capabilities. Platform CPU termination
  is authoritative; local instruction/job caps are supplementary and documented.
- 16 MiB guest memory, 256 KiB guest stack, 256 KiB source, 16 MiB serialized
  input envelope (including JSON escaping of existing 2M-character responses),
  2 MiB serialized result. Validate input and output without leaking guest errors.
- Preserve authentication, tenant routing, provider calls and secret filtering in
  Savia Request. Do not merge or deploy production.

## Tasks

1. Write service-client and executor tests first: current contract, empty hooks,
   malformed input/output, missing service, timeout, host API isolation, fresh
   state, and representative catalog hooks. Verify RED against missing service.
2. Implement the private Worker, pinned QuickJS Wasm loading and service client.
   Typecheck, run targeted tests, and package both workers with Wrangler.
3. Integrate local, production-rendered and preview configurations, deploy order,
   branch preview cleanup and contract tests. A deployment subtask owns scripts
   and workflows; the parent owns app/runtime files and dependency lockfile.
4. Review, commit and create the PR. Deploy a same-repository branch preview using
   existing GitHub environment secrets; never expose an arbitrary-code endpoint.
5. Exercise hooks through authenticated preview or a temporary private smoke
   caller. Verify actual CPU cancellation and recovery where remote access allows.
   Record exact deployment/verification evidence and any blocked step.

## Review focus

- Serialized payload expansion must not reject existing 2M-character responses.
- A timed-out service call must not silently fall back to billable Dynamic Workers.
- Guest results/getters and prototype mutation must not execute in the host or
  carry state to another request.
- Worker service bindings do not automatically prove per-hop platform CPU limits;
  the deployed canary must establish the effective limit.
- Preview must not expose the hook worker or access production databases/secrets.

## Progress

- Branch based on origin/main `29e82e3`; previous experiment retained.
- Baseline command initially blocked by pnpm auto-reinstall; use the pinned local
  pnpm with `--config.verify-deps-before-run=false` for existing dependencies.

- Private QuickJS worker, service client, deployment ordering and labeled preview workflow implemented.
- Local verification: 23 interpreter/handler tests, three workerd integration tests (all 51 catalog hooks), 56 request tests, eight self-hosted hook tests and 11 API route tests passed. Both worker typechecks and Wrangler bundles passed.
- Repository contract suite passed after adding the new workspace dependency volume and seed directory to the development container.
- Remote CPU enforcement and preview deployment remain to be verified on GitHub Actions.

- PR: https://github.com/hefesoftsas/savia/pull/172. Preview run 37184133963 was rejected before runner startup: `refs/pull/172/merge` is not allowed by the `preview` environment protection rules. No remote deployment or CPU smoke executed. An environment administrator must permit this reviewed PR ref before retrying.
- CI hygiene caught a synthetic registration-shaped fixture value after it became tracked. Replaced it with an explicit synthetic placeholder; no real vehicle data was used.
