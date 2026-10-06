# WhatsApp Virtual Employee Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let admitted WhatsApp contacts choose a task, reach its configured Savia virtual employee, and use authorized capabilities with deterministic confirmation.

**Architecture:** A server-owned task menu and staff registry resolve the selected employee and caller context before completion. Savia chat and WhatsApp share capability policies and solution handlers, while channel confirmations and durable jobs mediate writes. Insurance validates the complete path without becoming a core assumption.

**Tech Stack:** TypeScript, Hono/OpenAPI, AI SDK, Cloudflare Workers/D1/R2, PostgreSQL self-hosted runtime, React, existing Nango transport, pnpm/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-whatsapp-virtual-employee-channel-design.md`

## Global Constraints

- English code, tests, and docs; Spanish user-facing copy follows current UI conventions.
- Insurance quoting is the first end-to-end test, not the channel's architecture or its only purpose.
- The existing pilot contact allowlist determines whether a contact may receive replies; it does not determine staff membership.
- `menú` / `menu` and `inicio` are global main-menu commands; recognize complete trimmed text after case and accent normalization before completion.
- Native list titles: at most 24 characters; descriptions: 72; button label: 20; at most 10 rows, including navigation.
- Confirmation: random 128-bit button token or 10-character uppercase base32 text code, hashed storage, five-minute expiry, five failed attempts, per-contact throttling.
- Customer ownership and linked-staff permissions are enforced by handlers, not prompts. Never forward the owner's unrestricted credentials or create an administrator actor for a contact.
- Backend persistence only. Maintain SQLite/D1 and PostgreSQL schema/migration parity.
- Generic routing, staff registry, confirmation and jobs belong to core; domain validation, ownership and execution belong to optional solutions.
- Existing legacy bindings remain in legacy mode until explicit routing cutover; no automatic provider replay or uncertain-send replay.
- Generate API reference from OpenAPI. No deployment or live insurer calls in implementation tests.

## Review Focus

- Normal sentences containing “menu” or “inicio” must reach the employee; only complete reserved commands trigger navigation (Task 3).
- A menu can change between display and selection; reject obsolete choices rather than choosing a different task by position (Task 3).
- A phone number can become staff or lose its account while messages are queued; old history and approval cannot cross the new access generation (Tasks 2 and 4).
- A late result from the previous task must identify its originating employee and must not answer or mutate the new task (Tasks 6 and 8).
- A successful remote record create can lose its acknowledgement; recovery uses a stable record ID and never duplicates the master or provider dispatch (Task 7).

## File and interface map

New generic channel modules live together in `apps/api/src/whatsapp/`: `channel-contracts.ts`, `channel-repository.ts`, `contact-access.ts`, `task-menu.ts`, `employee-router.ts`, `confirmations.ts`, `action-jobs.ts`, and `channel-routes.ts`. Each owns the responsibility named by its file.

Shared assistant policies and backend operation ports live in `apps/api/src/assistant/capabilities.ts` and `operation-adapter.ts`. Keep UI streaming in `assistant/service.ts`; share policies and operations rather than importing its streaming transport into WhatsApp. The insurance orchestration extraction lives in `packages/insurance-quotes/src/assistant-operations.ts`, surfaced through `packages/release-catalog/src/assistant-operations.ts`.

Public internal contracts, all exported from `channel-contracts.ts`:

```ts
type ContactKey = { tenantId: number; connectionId: string; contact: string };
type ContactAccess = ContactKey & {
  audience: "external" | "internal";
  generation: string;
  principalId: string | null;
  profileId: string;
};
type PublishedTask = {
  id: string; employeeId: string; title: string; description: string;
  order: number; audiences: Array<"external" | "internal">;
};
type EmployeeSession = {
  access: ContactAccess; employeeId: string; selectionRevision: number;
};
type ChannelAction = {
  id: string; session: EmployeeSession; revision: number;
  domain: string; command: string; input: Record<string, unknown>;
};
type ActionOutcome =
  | { state: "completed"; result: unknown }
  | { state: "failed" | "uncertain"; message: string };
```

Import `NativeReply`, `WhatsappInboundInput`, and `VirtualEmployee` from their existing modules. Use server-derived `ContactAccess` only; none of these authority fields are accepted from contact text or model output. Persist personal action input through the existing encrypted payload mechanism, not plaintext JSON.

## Task 1: Persist roster, staff assignments, selections and action state

**Files:** Create `packages/db/migrations/0044_whatsapp_employee_channel.sql` and matching `packages/db/postgres/0044_whatsapp_employee_channel.sql`; modify `packages/db/src/core-schema.ts`, `packages/db/postgres/manifest.json`; create `apps/api/src/whatsapp/channel-contracts.ts`, `channel-repository.ts`, `apps/api/test/whatsapp-channel-repository.test.ts`; modify `apps/self-hosted/test/whatsapp-schema-manifest.test.ts`.

**Interfaces:** `WhatsappChannelRepository(db)` provides `getAccess(key): Promise<ContactAccess>`, `listTasks(access): Promise<PublishedTask[]>`, `getSession(key): Promise<EmployeeSession | null>`, `selectTask(access, taskId, menuRevision): Promise<EmployeeSession | null>`, and `returnToMenu(access): Promise<void>`. Task 2 supplies administrator updates; Task 3 consumes selections.

- [ ] Write repository tests: staff entry absence/inactivity returns external; pilot admission never implies staff; duplicate normalized staff numbers fail; task order is stable; stale menu revision cannot select; profile update rotates generation and invalidates selection/confirmations.
- [ ] Run `pnpm --filter @savia/api test test/whatsapp-channel-repository.test.ts`; confirm the new tests fail for absent implementation.
- [ ] Add tables for published tasks, staff registry/profile assignments, contact state/menu revisions, channel confirmations, action jobs, and generic resource ownership links keyed by solution/resource type/resource ID. Scope all keys by tenant/connection; add uniqueness for contact assignment and action execution identity. Add nullable access-generation/selection snapshots to inbox rows, retaining legacy fields. Confirmations use `pending/consumed/cancelled/expired`; jobs use `queued/claimed/dispatching/completed/failed/uncertain`. Store expiry, attempt counters, lease tokens and originating employee. Add CAS updates for selection revision and generation. Allow terminal cutover failure on legacy inbox rows without modifying outbound states. Generic ownership-link storage defines no insurance schema or authorization rules; solutions supply those policies.
- [ ] Run the repository tests and `pnpm --filter @savia/self-hosted test test/whatsapp-schema-manifest.test.ts`; expect all assertions and PostgreSQL table/index inventory checks to pass.
- [ ] Commit as `feat: persist WhatsApp employee channel state`.

## Task 2: Admin roster, staff registry and effective caller access

**Files:** Create `apps/api/src/whatsapp/channel-routes.ts`, `contact-access.ts`, `apps/api/test/whatsapp-channel-routes.test.ts`, `whatsapp-contact-access.test.ts`; modify `apps/api/src/app.ts`, `apps/api/src/whatsapp/assistant-routes.ts`; create `apps/admin/src/features/whatsapp/whatsapp-channel-settings.tsx` and its test; modify `apps/admin/src/features/whatsapp/whatsapp-assistant-settings.tsx`, `apps/admin/src/api/whatsapp-client.ts`, its test, and existing configuration types there.

**Interfaces:** `resolveContactAccess(key, dependencies): Promise<ContactAccess>` loads the registry and current principal membership. `channel-routes.ts` exposes authenticated `GET/PUT /v1/whatsapp/channel?agencyId=...` settings with `routingEnabled`, `defaultTaskId`, `tasks`, `staff`, and explicit internal/external capability profiles. Reuse `canManageWhatsappAssistant` authorization. `tasks` contain only existing active tenant employees. Staff principal links are optional and must be current tenant members.

- [ ] Write API tests that non-admins and cross-tenant principals cannot save; titles over 24 and descriptions over 72 fail; normalized duplicate numbers fail; a linked inactive account cannot grant capabilities. Write UI tests for publishing several employees with task labels and distinguishing staff registry from pilot contacts.
- [ ] Run `pnpm --filter @savia/api test test/whatsapp-channel-routes.test.ts test/whatsapp-contact-access.test.ts` and the new admin component test; confirm failure before implementation.
- [ ] Implement settings schemas/routes/repository updates and caller resolution. Staff entries classify internal; absent entries classify external. Unlinked internal contacts use an explicitly configured profile only. Reload `loadActor` and membership before user-scoped operations. Admin UI selects employee records and tenant accounts, requires task labels, shows audience visibility and navigation copy, and leaves legacy configuration intact until cutover. Wire OpenAPI routes, not handwritten API docs.
- [ ] Rerun focused API/admin tests and existing WhatsApp settings/client tests; expect pass, including profile-change generation invalidation.
- [ ] Commit as `feat: configure WhatsApp tasks and staff access`.

## Task 3: Deterministic task menu and global navigation

**Files:** Create `apps/api/src/whatsapp/task-menu.ts`, `employee-router.ts`, `apps/api/test/whatsapp-task-menu.test.ts`, `whatsapp-employee-router.test.ts`; modify `apps/api/src/whatsapp/native.ts` only if additional rendering hooks are needed.

**Interfaces:** `isMainMenuCommand(text: string): boolean`; `buildTaskMenu(tasks: PublishedTask[], page: number, nativeLists: boolean, revision: number): NativeReply | string`; `routeEmployeeInput(access, input, repository): Promise<{ kind: "reply"; reply: NativeReply | string } | { kind: "employee"; session: EmployeeSession; text: string }>`. Persist menu option IDs/revision and selected employee through Task 1; resolve current task visibility on selection.

- [ ] Add assertions equivalent to `isMainMenuCommand("  MENÚ  ") === true`, `isMainMenuCommand("Inicio") === true`, and `isMainMenuCommand("quiero consultar el menu de seguros") === false`. Test ten/eleven/twenty employees, native-disabled numbered paging, forged/stale choice IDs, duplicate choices, and no/one/multiple available tasks. Assert menu labels contain configured tasks and no employee names.
- [ ] Run `pnpm --filter @savia/api test test/whatsapp-task-menu.test.ts test/whatsapp-employee-router.test.ts`; expect failing new tests.
- [ ] Implement accent/case normalization for complete reserved commands. Menus use nine entries plus a navigation row when needed, with saved revision-bound opaque choices. Numbered text selections resolve against the saved menu page, never a freshly reordered index. `menú`/`inicio` clears selection and buffered initial task, invalidates pending confirmations, and emits a fresh menu even with one task; a subsequent normal message can select the sole visible default. Preserve ordinary initial input once until explicit selection. Identify the selected employee on entry using its saved greeting.
- [ ] Rerun tests; expect all navigation, list bounds, buffering and visibility assertions to pass.
- [ ] Commit as `feat: route WhatsApp task menus to virtual employees`.

## Task 4: Inbox snapshots, employee history and safe cutover

**Files:** Modify `apps/api/src/whatsapp/inbound-contracts.ts`, `inbound-repository.ts`, `inbound-processor.ts`, `runtime.ts`, `assistant.ts`; create `apps/api/test/whatsapp-channel-inbound.test.ts`; modify `apps/api/test/whatsapp-inbound.test.ts`, `whatsapp-inbound-dialect.test.ts`, `whatsapp-assistant.test.ts`.

**Interfaces:** Inbox snapshots add `accessGeneration` and `selectionRevision` for routed events. `getEmployeeHistory(session): Promise<WhatsappChatMessage[]>` excludes other employees/generations. Task 3's router executes before completion in routed mode; legacy mode continues using the existing generator. `beginRoutingCutover(connectionId): Promise<void>` pauses admission; `finishRoutingCutover(connectionId): Promise<void>` requires no live legacy lease, fails unstarted legacy rows with `routing_cutover`, and enables new-generation admission.

- [ ] Add integration tests: queued menu selection precedes the next task; switching never reads another employee's history; revoked profile cannot send generated text; owner/default changes do not silently reassign snapshots. Test cutover with queued, leased, completed and uncertain-send rows, and ensure the next request can be prompted to resend an unprocessed task.
- [ ] Run `pnpm --filter @savia/api test test/whatsapp-channel-inbound.test.ts`; confirm failure before implementation.
- [ ] Snapshot generation/selection at intake and serialize routing under existing per-contact leases. Account for a selection event's deterministic successor revision so following queued events are routed correctly, rather than stamping every event with a stale pre-selection employee. Keep typed routing events distinct from task events. Fence selection/profile changes before generation and sending. Server-render employee identity for text/native/media without exceeding Meta limits. Cutover tags legacy history for audit only and never injects it into new staff/external contexts; responding rows remain non-replayable.
- [ ] Run new tests plus `test/whatsapp-inbound.test.ts`, `test/whatsapp-inbound-dialect.test.ts`, `test/whatsapp-assistant.test.ts`; expect legacy and routed scenarios to pass.
- [ ] Commit as `feat: isolate WhatsApp employee sessions and routing cutover`.

## Task 5: Shared assistant capabilities and authorized backend adapters

**Files:** Create `apps/api/src/assistant/capabilities.ts`, `operation-adapter.ts`, `apps/api/test/assistant-capabilities.test.ts`, `whatsapp-capabilities.test.ts`; modify `apps/api/src/assistant/service.ts`, `apps/api/src/whatsapp/assistant.ts`, `runtime.ts`, and `apps/api/src/personal-integrations/operations.ts` only to extract reusable authorized operations. Reuse `apps/api/src/studio/collection-gateway.ts` and personal connection repositories; do not weaken their authorization.

**Interfaces:** `createEmployeeCapabilities(employee: VirtualEmployee, access: ContactAccess, ports: AssistantOperationPorts): ToolSet`. `AssistantOperationPorts` provides `read(name: string, input: unknown): Promise<unknown>`, `prepare(session: EmployeeSession, domain: string, command: string, input: Record<string, unknown>): Promise<ChannelAction>`, and solution capability descriptors. `createAuthorizedOperationPorts(access, dependencies): Promise<AssistantOperationPorts>` privately binds the current actor/profile; callers cannot supply actor IDs inside operation inputs. Export `readToolNames`/collection scoping and shared command validation from `capabilities.ts` for the existing Savia MCP-backed adapter as well.

- [ ] Write tests comparing same-employee tool exposure under equivalent Savia/linked-staff permissions; assert text-only remains tool-free, external contact has no generic CRM/personal tools, and staff personal reads use only their linked account. Include unlinked staff, revoked membership, tenant mismatch, and malicious model inputs attempting principal/tenant override.
- [ ] Run `pnpm --filter @savia/api test test/assistant-capabilities.test.ts test/whatsapp-capabilities.test.ts`; confirm failure for the missing common registry/adapters.
- [ ] Extract existing policies without changing Savia's MCP transport. Add in-process channel adapters that reuse actor-bound collection gateway and personal operations instead of fabricating bearer tokens. Customer adapters expose only installed capabilities with explicit ownership contracts. Enable bounded AI tool steps and evidence sanitization in WhatsApp; reuse chosen employee model/prompt/RAG. Share operation guidance while rendering channel-specific confirmation instructions instead of Savia UI card wording. Keep writes preparation-only and completion injection testable. Do not grant generic capabilities from `allowedCollections: ["*"]` without caller/profile checks.
- [ ] Run new tests and `pnpm --filter @savia/api test test/assistant-service.test.ts test/personal-integrations.test.ts test/whatsapp-assistant.test.ts`; expect no Savia chat regression.
- [ ] Commit as `refactor: share authorized employee capabilities across chat channels`.

## Task 6: Single-use confirmation and fenced generic action jobs

**Files:** Create `apps/api/src/whatsapp/confirmations.ts`, `action-jobs.ts`, `apps/api/test/whatsapp-confirmations.test.ts`, `whatsapp-action-jobs.test.ts`; modify `channel-repository.ts`, `employee-router.ts`, `apps/api/src/assistant/personal-action-payload.ts` only for shared cipher access.

**Interfaces:** `prepareChannelConfirmation(action: ChannelAction, nativeButtons: boolean): Promise<NativeReply | string>`; `consumeChannelConfirmation(session: EmployeeSession, input: WhatsappInboundInput): Promise<{ jobId: string } | null>`; `processChannelActions(dependencies, limit: number): Promise<{ completed: number; uncertain: number }>`. Action executor contract: `execute(action: ChannelAction, executionKey: string): Promise<ActionOutcome>` with a mandatory durable pre-dispatch claim for external effects. Registry maps domain/command to validated executors, not arbitrary HTTP endpoints.

- [ ] Write tests for 128-bit tokens, exact 10-character base32 fallback, five-minute expiry, fifth wrong-attempt invalidation, rate limiting, other-contact/employee/generation tokens, concurrent consume, switch cancellation, and encrypted personal payloads. Test lease expiry before/after dispatch, duplicate confirmation/webhook, progress replies, and late results labeled with originating employee.
- [ ] Run `pnpm --filter @savia/api test test/whatsapp-confirmations.test.ts test/whatsapp-action-jobs.test.ts`; confirm failures before implementation.
- [ ] Implement crypto generation/hash comparison, server-owned previews and atomic consume/enqueue. Code matching intercepts channel input before the model and does not place codes in history. Job claim/dispatch fencing prevents repeat side effects; pre-dispatch jobs can recover, post-dispatch uncertainty becomes terminal. `menú` cancels pending previews but never a consumed job. Persist result projections and current task-independent originating identity. Use existing encrypted payload cipher for personal commands and avoid persistence of plaintext message bodies in operational logs.
- [ ] Rerun tests; expect one executor invocation under duplicates/concurrency and zero under invalid approval. Run `test/personal-action-payload.test.ts` regression checks.
- [ ] Commit as `feat: confirm and recover WhatsApp actions without replay`.

## Task 7: Shared insurance operations and contact-owned quote pilot

**Files:** Create `packages/insurance-quotes/src/assistant-operations.ts`, `packages/insurance-quotes/test/assistant-operations.test.ts`; modify package exports in its `package.json`; create `packages/release-catalog/src/assistant-operations.ts` and export it in its `package.json`; modify `apps/mcp/src/savia-api.ts`; create `apps/api/src/solutions/whatsapp-insurance.ts`, `apps/api/test/whatsapp-insurance.test.ts`. Reuse Task 1's generic resource links with insurance-owned policies rather than adding insurance-specific core tables. If necessary, modify stable internal record-create support in `packages/studio-server/src/operations.ts` after tracing its existing record-create handler, with a focused regression test in `packages/studio-server/test/whatsapp-stable-record-id.test.ts`.

**Interfaces:** `createInsuranceAssistantOperations(ports: InsuranceAssistantPorts)` exposes `getForm(): Promise<unknown>`, `lookupVehicle(plate: string): Promise<Record<string, unknown>>`, `lookupCity(city: string, department?: string): Promise<unknown>`, `executeQuote(input: unknown, executionKey: string): Promise<unknown>`, and `getSummary(reference?: string): Promise<unknown>`. `InsuranceAssistantPorts`, exported from that package, contains `getSettings(): Promise<Record<string, unknown>>`, `lookupCity(city: string, department?: string): Promise<unknown>`, `listCollections(): Promise<string[]>`, `createRecord(collection: string, id: string, data: Record<string, unknown>): Promise<{ id: string; _version: number }>`, `getRecord(collection: string, id: string): Promise<Record<string, unknown> | null>`, `listRecords(collection: string, filter: Record<string, unknown>): Promise<Array<Record<string, unknown>>>`, `updateRecord(collection: string, id: string, version: number, data: Record<string, unknown>): Promise<void>`, `executeExtensionAction(input: Record<string, unknown>): Promise<unknown>`, `checkpoint(executionKey: string, step: string, value: unknown): Promise<void>`, `claimDispatch(executionKey: string, productId: string): Promise<boolean>`, and `linkOwnership(resourceId: string): Promise<void>`. Context and authorization are closed over by each adapter; the package imports no API-app types. Channel-only `prepareInsuranceDraft(session: EmployeeSession, patch: Record<string, unknown>): Promise<ChannelAction | { missing: string[] }>` lives in `solutions/whatsapp-insurance.ts`, using the canonical package validator and generic job draft checkpoints. Ownership-sensitive summaries are constrained by injected record ports before any data is returned. Authenticated MCP ports preserve their principal record scope and use stable-ID/CAS persisted record checkpoints for replay control; channel ports use the channel job repository as well.

- [ ] Write tests for canonical validation and configured product selection; plate lookup once per unchanged draft, lookup failure/ambiguity, at most three missing-data prompts, consent, and no calls before confirmation. Test lost master-create acknowledgement, recovery between create/link, duplicate action/product claims, no exposure without ownership, customer A guessing B's reference, and permission-scoped adviser results.
- [ ] Run `pnpm --filter @savia/insurance-quotes test test/assistant-operations.test.ts` and `pnpm --filter @savia/api test test/whatsapp-insurance.test.ts`; confirm the new adapter assertions fail initially.
- [ ] Extract orchestration from MCP client into the solution package without changing authenticated quote behavior. Keep canonical contracts and enabled products as source of truth. Use stable intended master ID, durable prepare/link/dispatch-ready checkpoints, and per-product persisted dispatch identity. Add internal stable-ID record create only under trusted validated server operations if necessary; do not let public contact choose record IDs. Store contact-to-quote association before provider dispatch and preserve actual snapshots/history. Preserve uncertain outcomes, explicit retry behavior and accurate partial failures.
- [ ] Run new suites, `pnpm --filter @savia/mcp test test/insurance-quoting.test.ts`, and `node --test scripts/insurance-boundary.test.mjs`; expect shared Savia/WhatsApp behavior and optional-solution boundary assertions to pass.
- [ ] Commit as `feat: validate WhatsApp insurance quoting through shared operations`.

## Task 8: Existing Studio/personal actions and runtime integration

**Files:** Modify `apps/api/src/assistant/operation-adapter.ts`, `apps/api/src/whatsapp/runtime.ts`, `apps/api/src/runtime.ts`, `apps/self-hosted/src/application.ts` only where dependency wiring is required; create `apps/api/test/whatsapp-general-actions.test.ts`, `whatsapp-channel-runtime.test.ts`; update existing inbound direct-flow tests.

**Interfaces:** Register the existing prepared `studio/create-record`, `update-record`, `delete-record` and `personal-integrations/send-email`, `create-event`, `upload-file` operations against Task 6's executor registry. Reuse each operation's exact existing schema/authorized handler rather than deriving commands from arbitrary strings. `whatsappInboundFromEnvironment` supplies router/capability dependencies and exposes `processActions()` for the existing minute scheduler in both hosts.

- [ ] Write tests for linked-staff authorized CRM read/change and personal actions using their own connection; unavailable personal account has no owner fallback. Test deleted/disabled solution, employee removal, profile revocation while queued, expired Meta reply window, delayed job result after `menú`, and all legacy text-only behavior.
- [ ] Run `pnpm --filter @savia/api test test/whatsapp-general-actions.test.ts test/whatsapp-channel-runtime.test.ts`; confirm failures before wiring.
- [ ] Bind operation executor authorization immediately before dispatch. Reuse existing CRUD/version checks and personal action payload validation. The model only prepares previews. Wire scheduler-driven job processing with bounded calls, per-job checkpoints and claimed dispatch transitions, respecting both host shutdown and Worker scheduled lifetime. Do not run insurer jobs in the 60-second completion call. Register solution contributions through the release catalog and keep the platform usable without insurance. Recheck reply window/access before result delivery; retain undeliverable results for later authorized reads. Integrate channel draft/confirmation/history cleanup with existing tenant retention/deletion mechanisms, retaining dispatch evidence while uncertain jobs require review; add deletion/cleanup tests that cannot erase ownership mid-execution.
- [ ] Rerun new tests and `pnpm --filter @savia/api test test/whatsapp-direct-flow.test.ts test/whatsapp-webhook.test.ts test/whatsapp-inbound.test.ts`; expect both hosts' wiring and legacy paths to remain valid.
- [ ] Commit as `feat: connect general employee actions to WhatsApp runtime`.

## Task 9: End-to-end verification, guides and final review

**Files:** Create `apps/api/test/whatsapp-employee-channel.test.ts`; modify `docs/runbooks/nango-whatsapp.md`, `docs/guides/virtual-employees.md`, `docs/insurance-quoting.md`; update generated API artifacts only through the repository's OpenAPI generation command if committed artifacts change.

**Interfaces:** No new public runtime interfaces. Exercise Tasks 1–8 through the real signed webhook, configured backend dependencies, and mocked external providers.

- [ ] Write integrated scenarios: external contact selects “Consultar seguros”, reaches Alice, supplies a plate, completes consented data and confirms one saved quote; linked staff selects a different employee and performs one authorized Studio action; `MENÚ` then a new task works at every draft/confirmation state. Assert task labels hide employee names in the menu while replies identify the responder, and unrelated employees remain usable without insurance.
- [ ] Run `pnpm --filter @savia/api test test/whatsapp-employee-channel.test.ts`; investigate any failures before adding other changes.
- [ ] Update guides with settings, staff-number classification, linked-account limits, task labels, `menú`/`inicio`, single-employee migration, confirmation and uncertain-dispatch recovery. Add explicit pilot procedures for mocked verification and separately authorized real calls. Document any capabilities intentionally unavailable because ownership/identity cannot be resolved.
- [ ] Run focused new suites, affected existing WhatsApp/assistant/admin/MCP suites, PostgreSQL schema checks, `pnpm run typecheck`, `pnpm run test:contracts`, and `git diff --check`. Format changed files with the repository's Prettier configuration; report pre-existing full-lint failures separately. After focused checks pass, do not repeat them absent new changes.
- [ ] Review the combined diff against every spec acceptance item; resolve substantive review findings and rerun only affected checks. Commit as `docs: explain WhatsApp employee menus and action access`.

## Execution and review gates

Tasks 1–4 produce usable multi-employee task routing without enabling new tools.
Tasks 5–6 establish common capabilities and confirmations. Tasks 7–8 integrate
solution and general actions; Task 9 validates the whole behavior. This sequencing
keeps one shared architecture and permits independently testable commits without
splitting the same security/routing interfaces into competing subsystem plans.

Use the existing attached checkout after checking status; preserve unrelated
changes. Implement interface-dependent tasks sequentially. If delegation is
chosen, give workers disjoint files and at most two active workers, use GPT-6 Luna
with high reasoning and fresh focused context, and keep architecture/integration
and final review with the coordinator. Never create sidebar chats for subtasks.

Recommended execution: native implementation in this session, with a focused
independent final review. Routing snapshots, effective access, confirmation and
operation adapters share interfaces, so sequential integration avoids competing
edits; delegate bounded tests/reviews only when it improves isolation.

Before implementation, obtain written-plan review and execution-method selection.
No deployment, live Meta configuration change, or insurer request follows from
this plan's approval alone.
