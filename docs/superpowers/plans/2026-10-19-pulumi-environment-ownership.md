# Pulumi Environment Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage Savia's complete infrastructure lifecycle by environment through Pulumi, adopting the running resources without recreation.

**Architecture:** Retain the standard, branch and shared projects, add a protected management project, and move only backend ownership. Native Worker resources own identity; one managed runtime release per environment owns publication and attached infrastructure through Wrangler. Prove that split in an isolated fixture before adopting live runtime resources.

**Tech Stack:** Node.js 22+, TypeScript, Pulumi CLI 3.268.0, the existing locked Cloudflare/Pulumi provider versions, Wrangler 4.127.1, Node test runner, GitHub Actions.

**Spec:** [Approved environment ownership design](../specs/2026-10-19-pulumi-environment-ownership-design.md), approved by the user on October 19, 2026.

## Global Constraints

- Preserve physical resource names, cloud IDs, data, Worker versions, namespace IDs, URLs and existing output contracts during adoption.
- Keep production absent and disabled; preserve `Pulumi.production.yaml` and its release definitions. Do not delete the retained branch or any further business data.
- Preserve project names `savia-cloudflare`, `savia-branch-preview`, `savia-shared-registry`; add `savia-management/management`.
- Keep the existing physical backend URL/bucket. Transfer ownership with `pulumi state move`, never duplicate import or `state rm`.
- Shared and management resources remain protected. Application destruction retains data unless an explicit `--delete-data` choice accompanies the reviewed manifest.
- Native Workers never force deletion. No native Workflow/route/cron/consumer resource may compete with the Wrangler-owned runtime release.
- Read credentials only at execution time from existing authorized custody. No credentials, decrypted checkpoints, business data or public release artifacts containing secrets in Git.
- Adoption is read-only against Cloudflare. Any unsupported attachment, failed lifecycle proof or missing backend access blocks live migration.
- Code, documentation, tests and Conventional Commits are English. Do not change application business behavior or restore retired tooling.

## Review Focus

1. Cloudflare calls Preview's Worker environment `production`: membership must come from validated identity/bindings, never that label.
2. A current branch has six Workers while a newer template may define seven: adoption preserves its actual profile and creates nothing missing.
3. Artifact/configuration changes must update one release in place; replacement or failed recovery must never leave duplicate runtime owners.
4. API/Auth/DO references can form cycles: retirement must detach only internal references and stop on any foreign caller, using `force:false`.
5. Interrupted ownership transfers or missing credentials must preserve recoverable checkpoints and protection; application teardown must never include management/shared resources.

## File boundaries and execution order

- Tasks 1–2 establish inventory and the runtime lifecycle proof. Nothing live is adopted until both pass.
- Task 3 wires resources into existing programs. Task 4 establishes management ownership and migration helpers without running them.
- Task 5 supplies the single operational entrypoint. Task 6 integrates existing CI/release behavior and documentation.
- Task 7 is the reviewed live migration and acceptance audit, using exactly the code validated in Tasks 1–6.
- Keep at most two workers active. If delegated, inventory/validation and management helpers have separate writers; serialize root program, CLI and workflow integration.

### Task 1: Validated environment catalog and adoption manifests

**Files:** Create `infra/pulumi/environments.mjs`, `environment-inventory.mjs`, `environment-inventory.test.mjs`, `environment-manifest.mjs`, `environment-manifest.test.mjs`.

**Interfaces:**

- `resolveEnvironment(id)` returns `{environment, project, stack, projectDir, kind}`; kinds are `application`, `branch`, `shared`, `management`.
- `inventoryEnvironment({environment, cloud, stacks})` returns `{accountId, environment, resources, unknownResources, profile}`. Each resource has `{kind, name, cloudId, ownerStack, parentWorker}`; optional parent is null.
- `validateAdoptionManifest(manifest, {environment, accountId, checkpoints})` returns a frozen validated manifest; `assertAdoptionPlan(plan, manifest)` rejects any Cloudflare mutation.
- The manifest records native resource imports, actual enabled Workers, live version IDs, attachments and existing owners. It excludes credentials, variable/secret values and document/database contents.

- [ ] **Step 1: Write failing tests for exact boundaries.**
      Assert `resolveEnvironment('preview')` selects `savia-cloudflare/preview`, `branch-feat-secop-tender-tracke` selects the branch project, and missing/unknown environments throw. A Preview domain whose API label is `production` belongs to Preview by its validated service identity. A six-Worker branch produces exactly six imports and no new connector Worker. A resource owned by another checkpoint, a foreign account, an unexplained attachment, or an import/name mismatch throws. `assertAdoptionPlan` accepts native imports plus known read-only bookkeeping registrations, but rejects cloud create/update/delete/replace.

```js
test("environment selection never defaults a mutation to production", () => {
  assert.throws(() => resolveEnvironment(undefined));
  assert.equal(resolveEnvironment("preview").stack, "preview");
  assert.equal(
    resolveEnvironment("branch-feat-secop-tender-tracke").project,
    "savia-branch-preview",
  );
});
```

- [ ] **Step 2: Run `node --test infra/pulumi/environment-inventory.test.mjs infra/pulumi/environment-manifest.test.mjs`; confirm the missing implementation causes failure.**
- [ ] **Step 3: Implement the catalog, pagination-aware read adapters and validators.** Reuse `naming.mjs`, `previewNames`, existing output validators and exact Cloudflare IDs. An absent production stack reports `defined-not-deployed`; inventory does not initialize it. Inspect every configured checkpoint location before adopting a resource as unowned.
- [ ] **Step 4: Run the new tests and `node --test infra/pulumi/naming.test.mjs infra/pulumi/outputs.test.mjs infra/pulumi/branch-preview-resources.test.mjs`.**
- [ ] **Step 5: Commit `feat(infra): validate environment inventories and adoption manifests`.**

### Task 2: Managed runtime release and disposable lifecycle proof

**Files:** Create `infra/pulumi/runtime-release.mjs`, `runtime-release.test.mjs`, `runtime-publisher.mjs`, `runtime-publisher.test.mjs`, `runtime-publisher-standard.mjs`, `runtime-publisher-branch.mjs`, `runtime-publisher-registry.mjs`, `runtime-retirement.mjs`, `runtime-retirement.test.mjs`, `runtime-resource.ts`; create `infra/pulumi/fixtures/runtime/{Pulumi.yaml,package.json,tsconfig.json,index.ts,worker.mjs}` and `infra/pulumi/verify-runtime-lifecycle.mjs`.

**Interfaces:**

- `RuntimeInputs` contains `{accountId, environment, workers, mode, artifactDigest, configDigest, artifactDirectory, adoptionManifest}`. `mode` is `adopt` or `release`; release requires both digests and a prepared immutable artifact directory. No credential values are inputs.
- `workers` is an ordered array of `{name, cloudId}` descriptors. `diffRuntimeInputs` returns `{changes:boolean, replaces:[]}` for a valid unchanged identity; artifact staging paths are not release triggers.
- `RuntimeState` contains `{runtimeId, workerVersions, namespaceIds, attachments, releaseDigest, status}`. `status` is `adopted`, `ready` or `maintenance`.
- Pure/provider operations: `adoptRuntime(inputs, deps)`, `readRuntime(inputs, previous, deps)`, `diffRuntimeInputs(previous, next)`, `releaseRuntime(previous, inputs, deps)`, `retireRuntime(state, {manifest, deleteData}, deps)`.
- `RuntimeRelease` in `runtime-resource.ts` adapts those operations to `pulumi.dynamic.Resource`. Production dependencies obtain credentials inside operations, not serialized closures. Native Worker resources are dependencies of this release, so runtime retirement finishes before Worker deletion.
- `prepareRuntimeArtifact({environment, outputs, release, destination})` freezes the existing generated manifests/build outputs and returns the two digests. Persist generation-dependent values once; provider read/diff must not regenerate timestamp-varying manifests.

- [ ] **Step 1: Write failing provider/publisher/retirement tests.**
      Adoption and refresh invoke only read operations and preserve versions/namespace IDs. A changed artifact/config digest returns `{changes:true}` without replacements; identity/account/environment changes throw. Identical immutable artifacts do not redeploy. Failed publication restores the recorded code versions through existing recovery helpers, preserves maintenance policy, and throws if recovery is incomplete. Retirement stops schedules/producers and ingress, removes orphan-prone Workflows, detaches internal service/DO references, and refuses foreign callers before deleting anything. Assert no `force:true`, duplicate native attachment resources or secret-bearing outputs.

```js
test("a new immutable artifact updates the existing runtime without replacement", () => {
  const before = {
    accountId: "a".repeat(32),
    environment: "preview",
    workers: [{ name: "savia-preview", cloudId: "b".repeat(32) }],
    mode: "release",
    artifactDigest: "c".repeat(64),
    configDigest: "d".repeat(64),
    artifactDirectory: "/private/test-artifact",
    adoptionManifest: null,
  };
  assert.deepEqual(
    diffRuntimeInputs(before, { ...before, artifactDigest: "e".repeat(64) }),
    { changes: true, replaces: [] },
  );
  assert.deepEqual(
    diffRuntimeInputs(before, {
      ...before,
      artifactDirectory: "/private/new-staging-path",
    }),
    { changes: false, replaces: [] },
  );
});
```

- [ ] **Step 2: Run the three new test files and confirm meaningful failures before implementing their modules.**
- [ ] **Step 3: Implement the provider and publisher adapter.** Reuse the current renderer, secret uploader, D1 migration, maintenance, backup and recovery helpers; do not implement a second migration engine. Adopt mode records live versions with no desired publication. Release mode consumes immutable artifacts and updates in place. Record all runtime attachments for audit and complete retirement. Extract the
      branch publisher from `scripts/preview-deploy.mjs` into the branch adapter; preserve
      its pure config helpers/re-exports and avoid calling a delegating CLI recursively.
      Standard/registry adapters extract the current ordered workflow operations. Refresh
      never reads the old build directory; only explicit release verifies artifact
      contents against their digests.
- [ ] **Step 4: Run unit tests and provider serialization checks.** Scan serialized provider/state fixtures with unique synthetic credential canaries and assert they are absent. Verify read reflects partial recovery rather than falsely reporting the prior version as live.
- [ ] **Step 5: Implement and run the isolated integration fixture.** Use a unique `savia-iac-fixture-<run>` allowlist, a private local state backend, synthetic data and no existing Savia domains. Exercise four small Workers (gateway, API, Auth, coordinator), service-binding cycles, one DO namespace, static assets, a Workflow, cron and queue consumption, plus isolated D1/R2/KV/queues. Publish a baseline, adopt it, compare IDs/versions, release an update, inject a failed update and verify recovery, refresh without changes, then retire attachments and Workers with `force:false`. Include a recreate-with-retained-data cycle and verify synthetic data survives. The fixture must prove whether metadata-only Workers need placeholder publication before binding callers.
- [ ] **Step 6: Verify cleanup against the fixture allowlist.** Cleanup failure is a failure, not a skipped check; record remaining exact resources privately. Never use a global `savia-*` delete or reuse the real branch preview as a fixture. If lifecycle/attachment detachment cannot be proved with the pinned APIs, stop the plan and revise the design before live work.
- [ ] **Step 7: Commit `feat(infra): manage runtime releases through Pulumi`.**

### Task 3: Complete resource registration for application, branch and shared stacks

**Files:** Create `infra/pulumi/runtime-resources.ts`, `runtime-resources.mjs`, `runtime-resources.test.mjs`, `vectorize-resource.ts`, `vectorize-resource.mjs`, `vectorize-resource.test.mjs`; modify `infra/pulumi/{index.ts,outputs.mjs,outputs.test.mjs,tsconfig.json}`, `branch-preview/{index.ts,tsconfig.json}`, `shared-registry/{index.ts,tsconfig.json}`, and existing branch/shared validators and tests.

**Interfaces:**

- `workerIdentityArgs({accountId, name})` returns only `{accountId, name, force:false}`; metadata ignore options are separate and tested. `registerRuntime({accountId, environment, manifest, profile, dataDependencies})` returns `{workers, release, inventory}`. Worker arguments declare identity/lifetime only and ignore Wrangler-owned metadata; imported IDs come from the validated manifest.
- Export additive `environmentInventory` and `runtimeStatus` outputs; preserve all existing render/backup/destroy output names and types.
- The Vectorize provider implements validated read/adopt/create/delete for `savia-pages-search-preview`, with 1024 dimensions and cosine metric. Credentials are read at execution time; immutable configuration changes are rejected rather than silently replacing indexed data.

- [ ] **Step 1: Add failing registration and output tests using pure argument builders and a mocked compiled Pulumi program. The test harness compiles the program with the existing TypeScript compiler into an ignored build directory before loading it; do not depend on native TypeScript support in Node.js 22.0.0 or add a new runtime transpiler.** Assert the existing ten-Worker Preview profile, actual six-Worker branch profile and one protected shared Worker are registered with correct account/stack dependencies and no separate native Workflow/routes/cron resources. Missing optional branch services do not appear during adoption. Verify root/branch/shared output compatibility and strict Vectorize config validation.

```js
test("native worker arguments cannot take over publication or force deletion", () => {
  assert.deepEqual(
    workerIdentityArgs({ accountId: "a".repeat(32), name: "savia-preview" }),
    {
      accountId: "a".repeat(32),
      name: "savia-preview",
      force: false,
    },
  );
});
```

- [ ] **Step 2: Run new tests plus existing output, shared-registry, branch and worker-render tests; establish the new assertions fail.**
- [ ] **Step 3: Implement runtime registration and Vectorize ownership.** Keep existing data resource logical names/parents/URNs unchanged. New runtime resources may use a component parent; do not reparent existing persistence. Use import metadata only during adoption and clear one-time IDs afterward so a later runtime rebuild can create fresh identities.
- [ ] **Step 4: Type-check every modified Pulumi project and run `node --test infra/pulumi/*.test.mjs`.** Confirm a normal refresh does not reconcile Wrangler-owned fields or generate a new release.
- [ ] **Step 5: Commit `feat(infra): register complete environment resource inventories`.**

### Task 4: Management stack and recoverable backend ownership transfer

**Files:** Create `infra/pulumi/management/{Pulumi.yaml,package.json,tsconfig.json,index.ts}`, `management-resources.mjs`, `management-resources.test.mjs`, `move-backend-ownership.mjs`, `move-backend-ownership.test.mjs`; modify `index.ts`, `production-preflight.mjs`, `production-preflight.test.mjs`, `destroy.mjs`, `destroy.test.mjs`, `package.json` and `outputs` tests.

**Interfaces:**

- `validateManagementOutputs(value, {accountId, backendUrl})` returns `{accountId, backendBuckets, protected:true}` after validating physical identity and the management checkpoint's resource protection.
- `planBackendOwnershipMove({source, destination, backendUrn, checkpoints})` returns exact qualified stacks, one bucket URN and expected before/after fingerprints.
- `moveBackendOwnership(plan, {run, journalDir, env})` exports both checkpoints/configuration privately, records each completed stage and executes the one verified `pulumi state move`. The CLI may copy required provider metadata, but no other cloud resource may move. Default operation is preview; mutation requires `--apply` and a frozen-workflow journal.

- [ ] **Step 1: Write failing tests.** Management declares only the existing protected backend bucket, never application resources. Root outputs remain compatible after backend ownership is removed. Reject another account/bucket/URN, unreadable checkpoints, pending state operations, duplicate ownership and loss of protection. On simulated interruption, preserve the private exports and report the last completed stage without issuing additional mutation. Assert no `state rm`, bucket creation/deletion, or management target in application destruction.

```js
test("unverified management state cannot protect an application backend", () => {
  assert.throws(() =>
    validateManagementOutputs(
      {},
      { accountId: "a".repeat(32), backendUrl: "s3://wrong" },
    ),
  );
});
```

- [ ] **Step 2: Run management/move/preflight/destroy tests; confirm the new cases fail first.**
- [ ] **Step 3: Implement management and transfer helpers without running the live transfer.** Declare `state-backend` under management and remove its declaration from application programs. Preserve backend-name/URL outputs as references validated against management state. Production preflight must check independent management protection instead of requiring the backend bucket in production's checkpoint. Do not initialize production or rename the physical backend.
- [ ] **Step 4: Add management type-checking to the infrastructure package and run its checks plus the focused tests.** Document that source/state ownership must switch while automation is frozen; the new source must not run against old ownership unattended.
- [ ] **Step 5: Commit `feat(infra): isolate protected backend ownership in management`.**

### Task 5: One environment lifecycle entrypoint with safe adoption and retirement

**Files:** Create `infra/pulumi/environment.mjs`, `environment.test.mjs`; modify `deploy-stack.mjs`, `deploy-stack.test.mjs`, `destroy.mjs`, `destroy.test.mjs`, `branch-preview-resources.mjs`, `branch-preview-resources.test.mjs`, `scripts/{preview-deploy,preview-destroy}.mjs` and existing tests in
`scripts/{preview-deploy,preview-environment}.test.mjs`.

**CLI:** `node infra/pulumi/environment.mjs <inventory|adopt|plan|apply|destroy> --environment <id>`. Inventory may use `--all`; mutations never do. Adoption requires `--manifest <private-path>`; apply requires an immutable release artifact; destroy requires `--manifest` and `--apply`, retaining data unless `--delete-data` is explicitly supplied.

**Interfaces:** `parseEnvironmentArgs(argv)` returns the explicit action/target/options; `runEnvironmentOperation(args, deps)` resolves the catalog and uses the validated saved plan. Existing CLI files become delegates, not independent implementations. Historical
`preview-destroy --force` maps to explicit apply while retaining data; callers
must add `--delete-data` to empty/delete persistence. Document that safety change
and expose a default-false `delete_data` input on manual branch destruction.

- [ ] **Step 1: Write failing orchestration tests.** Unknown/omitted targets, wildcard mutations, production disabled/not-main, destructive adoption, wrong saved-plan identity and missing management protection throw before mutation. Adoption's second run does not import or publish again. `destroy` rejects shared/management/foreign callers, retires runtime before data, retains data by default, and never removes a nonempty stack. A later release against retained data recreates runtime without old import IDs. Missing production reports absent instead of bootstrapping it.

```js
test("wildcard destruction fails before environment resolution", () => {
  assert.throws(() => parseEnvironmentArgs(["destroy", "--all", "--apply"]));
});
```

- [ ] **Step 2: Run the new CLI tests and affected existing deploy/destroy/branch tests to establish failures.**
- [ ] **Step 3: Implement the orchestration and delegate wrappers.** Use current backend/account/output validation and saved-plan semantics. Runtime's explicit retirement precedes native Worker/data destruction; data emptying uses existing helpers restricted to the reviewed manifest. Do not bypass the disposable-fixture findings.
- [ ] **Step 4: Run the complete infrastructure tests and wrapper contract tests.** Exercise fake multi-backend/duplicate-owner inputs and compare the exact recorded mutation sequence.
- [ ] **Step 5: Commit `feat(infra): operate environments through one Pulumi lifecycle`.**

### Task 6: Release workflows, compatibility and operator guides

**Files:** Modify `.github/actions/pulumi-infrastructure/action.yml`, `.github/workflows/{pulumi,deploy-preview,deploy-cloudflare,preview-environment,preview-quickjs,deploy-plugin-registry}.yml`, `infra/pulumi/shared-registry/render.mjs`, `scripts/github-workflows.test.mjs`, `infra/pulumi/{deploy-workflow,backup-workflow}.test.mjs`, and `docs/runbooks/{pulumi-infrastructure,preview-production,production-rebuild}.md`.

- [ ] **Step 1: Write failing workflow contracts.** Platform, branch and registry runtime publication/recovery go through the lifecycle entrypoint; independent `wrangler delete`/deploy paths disappear for managed runtime. Retain Preview's trusted-main restrictions, exact commit evidence, production's false-by-default/main gates, quiescence/backups, paused failure recovery and protected environments. Plugin-content-only publishing keeps its existing lane because it does not create infrastructure or publish Worker versions.

```js
test("preview has one managed runtime publisher", async () => {
  const source = await readFile(
    new URL("../../.github/workflows/deploy-preview.yml", import.meta.url),
    "utf8",
  );
  assert.match(source, /environment\.mjs apply --environment preview/);
  assert.doesNotMatch(
    source,
    /command: deploy --config wrangler\.preview\.jsonc/,
  );
});
```

- [ ] **Step 2: Run workflow contracts and verify new assertions fail.**
- [ ] **Step 3: Integrate the immutable release artifact and lifecycle entrypoint.** Reuse the existing ordered release steps inside the publisher adapter rather than duplicating them in CI. Outer failure handlers verify provider recovery instead of launching a second competing restore. Production workflows stay disabled and no secrets or credential stores are renamed. Require reviewed `main` for all production infrastructure mutation.
- [ ] **Step 4: Update the guides with exact inventory/adopt/plan/apply/destroy commands, retained-data behavior, management protection, state transfer/rollback, ownership boundaries and complete rebuild order.** Explain that grouping is in Pulumi and its inventory; do not promise Cloudflare folders for every resource type. Record how existing shared-registry credential storage remains preserved.
- [ ] **Step 5: Run `pnpm test:contracts`, infrastructure type-checks, formatting on changed files and `git diff --check`.** Have a fresh reviewer inspect the combined implementation and disposable-fixture evidence. Resolve actual findings and rerun affected checks before publishing the implementation PR.
- [ ] **Step 6: Commit `ci: route environment releases through Pulumi lifecycle` and create/attach the PR.** Required CI remains enforced; do not bypass protection or enable production.

### Task 7: Freeze, migrate ownership, adopt live resources and verify

**Files/artifacts:** Create `docs/runbooks/pulumi-environment-adoption-2026-10-19.md` with sanitized completion evidence; keep encrypted checkpoints, configuration copies, allowlisted manifests, workflow-state journal, provider logs and version inventories in a private mode-0700 operation directory.

- [ ] **Step 1: Confirm the reviewed implementation revision, passing required checks and successful disposable fixture.** Refresh live inventories and actual backend credentials/locations. Compare against the design baseline; any newly created or missing resource requires reconciliation before mutation. Production stays absent; the retained branch is not deleted.
- [ ] **Step 2: Export/read-verify every preserved checkpoint and configuration, then snapshot and freeze all state-mutating workflows.** Include Preview deployment, branch/QuickJS operations, registry, infrastructure dispatch and production jobs; wait for running operations and coordinate existing local operators. Preserve each workflow's original enabled/disabled status. Do not mute CI checks or change access controls.
- [ ] **Step 3: Initialize management only in the existing readable backend and execute the reviewed one-resource state move.** Validate both resulting checkpoints and refreshed plans using the new source. Source and state must agree before any state-mutating automation resumes. Roll back ownership from the recorded exports/reverse move on failure; never recreate a bucket.
- [ ] **Step 4: Adopt existing Preview runtime/search, the shared Worker, and retained branch resources using exact manifests.** Resolve any pre-existing branch checkpoint before import; if none exists, initialize its exact branch stack and adopt its existing two D1s/bucket/six Workers. Runtime adoption is read-only; remove one-time import inputs after successful state registration.
- [ ] **Step 5: Refresh every preserved stack twice and compare before/after cloud identities, versions, namespace IDs, bindings, domains, routing and data resources.** Repeated adoption/refresh must produce no cloud mutations. Inventory must account for every retained Savia resource and show production as defined/not-deployed. Verify Preview health/login and registry using existing credentials without printing them.
- [ ] **Step 6: Merge only the reviewed implementation with required checks passing and restore workflow states after the merged source and checkpoints agree.** Keep previously disabled production workflows disabled and `PRODUCTION_OPERATIONS_ENABLED=false`. If adoption or recovery fails, leave mutating automation frozen, report the precise last successful stage and retain recovery evidence; do not claim partial runtime ownership as completion.
- [ ] **Step 7: Record and commit sanitized acceptance evidence, including the final environment inventory, management protection, fixture cleanup and any operational limitation.** Keep all production definitions, business data and the backend intact. Report source integration, live adoption and checks separately.

## Plan self-review

Coverage: stack grouping is Tasks 1/3/4; complete runtime ownership and first-install/recovery/retirement proof are Task 2; lifecycle safety is Task 5; CI compatibility is Task 6; live zero-recreation migration and rollback are Task 7. The five Review Focus inputs each have explicit failing cases in their owning task. All runtime interfaces use `adopt|release` modes and in-place digest updates. No live adoption or state ownership move is scheduled before the disposable proof and combined code review; the fixture creates and removes only its own isolated test resources. No step deploys production or deletes retained business data.
