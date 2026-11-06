# General Workflows Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver general-purpose, versioned workflows for native collections, with a visual editor, durable execution, and inspectable history.

**Architecture:** Shared validated graph contracts; D1 definitions, events and job checkpoints; scoped platform authorization; native collection adapters; existing admin components. Compare the managed runtime through an isolated local probe before selecting the production executor. Do not couple workflow availability to an industry package.

**Tech Stack:** TypeScript, Zod, Hono, D1, Cloudflare Workers, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-general-workflows-design.md`

## Global Constraints

- Backend persistence is authoritative for definitions and execution state.
- Every record is scoped to its workspace.
- Publishing a successor never changes an existing execution.
- A workflow is not a permission bypass.
- Preserve existing automation definitions and history.
- Advanced connector, approval, subflow and loop capabilities remain the subsequent delivery described in the spec.

## Review Focus

- Publication concurrent with a record write: capture the version at the write boundary.
- Worker interruption after a native write: replay must not duplicate the side effect.
- Permission revocation during a wait: recheck execution identity before resuming.
- Branch-dependent variable references: reject references unavailable on another path.
- Independent domains with equal collection names: prevent cross-domain access.

### Task 1: Contracts and runtime probe

Files: `packages/crm-shared/src/workflows.ts`, `packages/crm-shared/test/workflows.test.ts`, isolated local probe under `packages/crm-server/test/fixtures/`.

Produces: `workflowDefinitionSchema`, `WorkflowDefinition`, `WorkflowNode`, `resolveWorkflowValue`.

- [x] Test graph reachability, cycles, duplicate IDs, reference validity, bounds, and type-preserving substitutions.
- [x] Implement shared node schemas and graph validation.
- [x] Probe persistent step replay and event resumption with a local managed runtime; compare with transactional D1 checkpoints and record the selected approach.
- [x] Run `pnpm --filter @savia/crm-shared exec vitest run test/workflows.test.ts`.

### Task 2: Durable persistence and native execution

Files: `packages/crm-server/src/workflows/{repository,runtime}.ts`, migrations in both migration trees, `packages/crm-server/src/services.ts`, `packages/crm-server/test/workflows.test.ts`.

Consumes shared graph contracts. Produces `processWorkflows(db, authorize, options)` with bounded event processing; immutable published versions and compare-and-swap draft editing.

- [x] Write real D1 tests for workspace isolation, version pinning, transactional event capture, branch decisions, duplicate event delivery, and atomic side effects.
- [x] Implement migration triggers to capture each native record transition and pin eligible published workflows at commit.
- [x] Add lease-guarded per-node checkpoints; integrate native record writes with checkpoint transactions.
- [x] Add schedules, bounded retries, cancellation, task and notification persistence, and recovery from expired leases.
- [x] Run focused real D1 tests, including two independent processors competing for an execution.

### Task 3: Authorized routes and scheduling

Files: `packages/crm-server/src/workflows/routes.ts`, `packages/crm-server/src/index.ts`, `apps/api/src/crm/collection-gateway.ts`, `apps/api/src/workflows.ts`, `apps/api/src/index.ts`, OpenAPI generator, scheduler configuration.

Consumes repository and runtime. Produces scoped workflow CRUD, publication, manual start, cancellation, history, inbox, and background execution.

- [x] Test unauthenticated/direct access, cross-domain IDs, permissions revoked after publication, and disabled owners.
- [x] Map distinct workflow permissions to the host's existing administrator boundary; revalidate current identity in scheduled execution.
- [x] Register generated API contracts and add a scheduler tick without changing existing CRM sync behavior.
- [x] Verify API and scheduler tests.

### Task 4: Visual authoring and execution inspection

Files: `apps/admin/src/features/crm-engine/workflows.tsx`, workflow editor components/tests, `operations.tsx`.

Consumes scoped workflow routes and shared schemas. Produces an accessible list/editor/history surface using existing components and collection metadata.

- [x] Test draft save, invalid configuration, variable selection, publication, manual start, and history inspection.
- [x] Add a step canvas, node configuration forms, field/value mapping, explicit branch destinations, and persistent draft/version controls.
- [x] Add per-step results, failures, retry/cancel controls, tasks and notifications.
- [x] Verify desktop/mobile layout and keyboard operation with browser inspection.

### Task 5: Documentation, integration and final verification

Files: product onboarding, `AGENTS.md`, workflow user guide, plan progress.

- [x] Correct general-purpose product positioning; explain optional industry solutions.
- [x] Document activation, version behavior, source capability boundaries, events, retries, local setup, and migrations.
- [x] Run focused package suites, typechecks and formatting; distinguish unrelated baseline failures.
- [x] Review the full change against every Review Focus condition and document limitations.

## Execution ledger

- Initial state: existing isolated worktree; only the approved specification is untracked.
- Execution: inline in the current session, following the user's instruction to implement and subsequent specification approval.
- Shared interfaces: graph contract → repository/runtime → scoped routes → editor; scheduler consumes the same runtime with a fresh authorization callback.
- Task 1 evidence: shared workflow tests 6/6 pass. Managed runtime replay/event probe 1/1 passes using the installed Miniflare v5 compatibility converter.
- Ruling: use transactional D1 checkpoints for this native-only delivery. The executable managed probe commits a write, throws before the receipt, and observes two writes on retry; managed orchestration still needs native idempotency. Cost if wrong: migrate the executor behind the same version/job contracts.
- Task 2 evidence: eight real-D1 cases pass, including concurrent processors, active-version capture, event rollback, delayed resumption, permission revocation, tasks and scheduling. Server typecheck passes.
- Task 3 evidence: additional explicit-host-authorization route test passes (9/9 server workflow cases). Distinct actions currently map to the existing workspace administrator boundary; finer roles remain host policy, not an engine bypass.
- Task 4 evidence: draft save and invalid-draft UI tests pass 2/2. Browser verification in progress against isolated local D1, not shared user data.
- Ruling: preserve legacy commercial operations while adding a general-purpose workflow tab. Cost if wrong: later navigation cleanup; no existing automation is migrated or removed.
- Validation note: initial D1 setup exceeded the default 30-second hook timeout under host load; rerun with 120-second setup timeout passed. No production timeout changed.
- Final verification: full shared package 99/99, full server package 125/125, focused host API/scheduler 13/13, focused admin/operations 7/7. Shared/server/API/admin TypeScript checks pass. Changed production sources pass Prettier; `git diff --check` is clean.
- Browser evidence: isolated real D1 fixture saved and published a manual workflow, executed it, and displayed the persisted completed-step output. Reload recovered the saved draft. Desktop 1280px and mobile 390px inspected; mobile scroll width equals viewport width; keyboard Tab reached the next enabled control. Preview runtime required a restart after a Wrangler proxy error; the saved data survived.
- Final review: self-review (no subagent tool). Reviewed the transaction/lease boundary, pinned publication, revoked owners, branch-dominated references, and equal collection names across domains. No independent review was performed.
- Final fixes verified: idempotent repeat publication; cross-domain editor/cache isolation; native-write cancellation fencing; causal-depth limit; bounded retries; independent scheduler failures; manual delivery-key reuse after uncertain network errors.
- Visual review: Impeccable preserved the existing component system. Detector advisories on typography/radii were aligned to the incumbent ramp; no new visual identity or persistent browser storage was introduced.
- Deferred delivery scope: external adapters/connectors, blocking approvals, loops/parallel/subflows, record-screen action embedding, granular non-admin workflow roles, retention tooling and paginated history are documented in `docs/workflows.md`. The current editor is a selectable step sequence, not a free-positioned graph.
- Initial implementation handoff retained the workspace with uncommitted changes and without production migration, push, merge or deployment. Local preview generated assets were moved to the isolated temporary directory, not deleted.
- User subsequently requested integration into main and push. Integration with main's scoped permissions and Office features preserves both route contracts and record ownership in workflow checkpoints. Post-integration verification: shared 113/113, server 140/140, focused API/access control 26/26, admin 7/7; workflow ownership regression rerun 14/14. Shared/server/API/admin TypeScript checks pass. Production deployment and migration execution remain outside this Git integration.
