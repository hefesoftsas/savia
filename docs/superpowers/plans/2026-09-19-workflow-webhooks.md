# Workflow Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let external systems start workflows and let workflow steps deliver authenticated JSON webhooks, configured and inspected in the existing editor.

**Architecture:** Incoming requests authenticate a workflow endpoint and atomically create a receipt plus execution. Outgoing steps persist their payload before network delivery and checkpoint results with the execution lease; immutable destination revisions prevent silent URL changes. Reuse existing D1 scheduling, authorization, encryption and public-destination validation.

**Tech Stack:** TypeScript, Zod, Hono/OpenAPIHono, Cloudflare Workers/D1, React/TanStack Query, Vitest, Wrangler local D1.

**Spec:** `docs/superpowers/specs/2026-09-19-workflow-webhooks-design.md` (approved by the user).

## Global Constraints

- The first release accepts and sends JSON over POST.
- Accept a JSON object with a maximum UTF-8 body size of 32 KiB, enforced while reading even without Content-Length.
- Require `Authorization: Bearer <secret>` and `Idempotency-Key` (1–150 printable ASCII characters).
- Generate a cryptographically random 256-bit secret, reveal it only on creation or rotation, and persist only its SHA-256 digest.
- Add per-endpoint durable admission limits of 60 new executions per minute, checked atomically with acceptance.
- Bound the encoded request to 32 KiB, response read to 32 KiB, and total network operation to 10 seconds, below the execution lease.
- Retry network errors, timeouts, 408, 429, and 5xx up to three automatic attempts with durable backoff (5 and 30 seconds; honor a valid Retry-After up to 5 minutes).
- External delivery cannot be committed atomically with D1: a crash after the receiver accepts may cause redelivery.
- No browser persistence is introduced.
- Code, tests, and docs are English; editor copy follows existing Spanish UI. No new dependencies are necessary. Generate API documentation from registered schemas.

## Review Focus

1. UTF-8 multibyte input with no Content-Length must be bounded by bytes, not JavaScript string length (task 2).
2. Nested object key reordering must deduplicate without treating reordered arrays as identical (task 2).
3. Destination URL edits after publication must not redirect queued work; credential rotation must still apply (tasks 3–4).
4. A lost response followed by lease recovery must preserve exact bytes/key and exhaust the automatic attempt budget (task 4).
5. Changing workspace or closing the secret panel must clear transient credential state and cached mutation output (task 6).

## File and interface map

Existing shared definitions stay in `packages/crm-shared/src/workflows.ts`. Add `workflow-webhooks.ts` alongside it for destination schemas and safe DTOs. Server modules live under `packages/crm-server/src/workflows/`: `webhook-endpoints.ts` owns incoming credentials/receipts; `webhook-destinations.ts` owns destination revisions/credentials; `webhook-transport.ts` owns bounded HTTP and redaction; `webhook-delivery.ts` owns durable external attempts. Keep existing native execution in `runtime.ts`.

The shared module exports these contracts (schema-inferred types can implement them):

```ts
type WebhookDestinationInput = {
  name: string; url: string; authType: "none" | "bearer" | "api-key";
  authHeader?: string; secret?: string;
};
type WebhookDestinationSummary = {
  id: string; name: string; revision: number; url: string;
  authType: "none" | "bearer" | "api-key";
  authHeader?: string; hasSecret: boolean; enabled: boolean;
};
type WebhookAccepted = { executionId: string; duplicate: boolean };
```

New server interfaces:

```ts
type WebhookDependencies = {
  encryptionKey?: string; fetcher?: typeof fetch; now?: () => number;
};
// WebhookEndpointRepository(db: D1Database, workspace: string)
// ensure(workflowId: string): Promise<{ id: string; secret?: string }>
// rotate(workflowId: string): Promise<{ id: string; secret: string }>
// metadata(workflowId: string): Promise<{ id: string } | null>
// acceptWorkflowWebhook(db, { endpointId, secret, key, data }, authorize)
//   -> Promise<WebhookAccepted>
// WebhookDestinationRepository(db, workspace, dependencies)
// create(input), update(id, expectedRevision, input) -> destination summary
// list() -> destination summaries
// rotate(id, secret: string) -> destination summary
// setEnabled(id, enabled: boolean) -> destination summary
// resolve(id, revision) -> internal URL/auth config; never API-serialized
```

Use the existing `WorkflowAuthorization` signature for acceptance and execution. The acceptance input `data` is `Record<string, unknown>`; its route validates bytes before parsing. Each new repository follows existing `fail`/transaction/guard conventions.

### Task 1: Shared contracts and persistent storage

**Files:** modify `packages/crm-shared/src/workflows.ts`, `packages/crm-shared/test/workflows.test.ts`; create `packages/crm-shared/src/workflow-webhooks.ts`, `packages/db/migrations/0058_workflow_webhooks.sql`, `packages/crm-server/migrations/0018_workflow_webhooks.sql`, `packages/crm-server/test/workflow-webhooks.test.ts`.

**Interfaces:** consumes existing workflow value/mapping validators; produces `{type:"webhook"}` trigger and `{id,type:"webhook",destinationId,destinationRevision,values,next?}` node. Destination IDs use UUID validation, revisions are positive integers; drafts explicitly choose a revision. Shared body mappings retain the existing maximum of 50 fields and reference-dominance validation.

- [ ] Add schema regression cases using a real definition:

```ts
expect(workflowDefinitionSchema.safeParse({
  trigger: { type: "webhook" },
  nodes: [{ id: "send", type: "webhook",
    destinationId: "a12aa1d0-5393-4a7f-a807-80ad8a7abcde",
    destinationRevision: 1, values: { name: { ref: "trigger.name" } } }],
}).success).toBe(true);
```

- [ ] Run `pnpm --filter @savia/crm-shared exec vitest run test/workflows.test.ts`; confirm the new case fails before extending schemas.
- [ ] Extend schemas and include webhook payload refs in graph validation. Bound destination names to 100 characters, URLs to 2048, secrets to 8192; reject auth-header names reserved by existing integration rules. Reject authHeader when authType is not api-key.
- [ ] Add mirrored SQL tables: `workflow_webhook_endpoints` (global unique id; unique workspace/workflow; secret_hash), `workflow_webhook_receipts` (workspace/endpoint/key PK, payload_hash, execution_id), `workflow_webhook_admissions` (endpoint/minute PK, count), `workflow_webhook_destinations` (workspace/id PK, name, current_revision, enabled, encrypted_secret), `workflow_webhook_destination_versions` (workspace/id/revision PK, url, auth_type, auth_header), `workflow_webhook_deliveries` (workspace/execution/node PK, destination id/revision, payload, stable_key, attempt_count, retry_generation, state), and `workflow_webhook_attempts` (workspace/execution/node/sequence PK, lease token, started/finished timestamps, status, safe error/response). Use composite workspace foreign keys. No raw incoming secrets or outgoing auth headers are persisted in deliveries.
- [ ] Add real-D1 migration tests following the setup in `test/workflows.test.ts`: duplicate receipts violate uniqueness, cross-workspace foreign references fail. Check migration numbering is still free before creation; use the next free number if necessary.
- [ ] Run shared tests and new server tests with `--hookTimeout=120000`, then commit `feat: define workflow webhook contracts and storage` with explicit file staging.

### Task 2: Incoming authentication and atomic acceptance

**Files:** create `packages/crm-server/src/workflows/webhook-endpoints.ts`; extend `packages/crm-server/test/workflow-webhooks.test.ts`.

**Interfaces:** implements `WebhookEndpointRepository` and `acceptWorkflowWebhook` above. Export `readWebhookJson(request: Request): Promise<Record<string, unknown>>` and `canonicalWebhookJson(data: Record<string, unknown>): string` from this module for route use. Acceptance uses the published definition's owner; caller-controlled workspace/owner is never accepted.

- [ ] Write failure-first tests for secret generation/rotation, invalid credentials, inactive workflow, revoked owner, body limits, and simultaneous equal keys. Assert the central invariant:

```ts
const results = await Promise.all([accept(), accept()]);
expect(new Set(results.map(r => r.executionId)).size).toBe(1);
expect(results.filter(r => !r.duplicate)).toHaveLength(1);
```

Here `accept` closes over a freshly created and enabled webhook workflow, its endpoint secret, the same key/data, and an allow-authorizer; create it in the test using the new repository interfaces.
- [ ] Run the new server suite and observe failures before implementing the repositories.
- [ ] Generate secrets with `crypto.getRandomValues(new Uint8Array(32))`, encode as base64url, digest with SHA-256. Compare all 32 digest bytes. Bound header values before hashing. Implement recursive canonical object-key sorting without modifying arrays or using unsafe assignment to prototype keys; reject excessive nesting (over 50 levels) with 422.
- [ ] Read the request stream with a byte counter and cancel at 32769 bytes; require application/json (optional charset), parse only a non-null non-array object. Add no-Content-Length tests using `"é".repeat(17000)`, nested object reordering tests, and array reordering conflict tests.
- [ ] Authenticate first, then retrieve an existing receipt. For a new receipt validate enabled published webhook/owner authorization; transactionally guard the same endpoint hash, publication, activation and rate counter. Insert execution, receipt and admission counter together; unique-conflict losers load the existing receipt. Preserve the existing trigger/before/steps/system context format. Recheck publication under the transaction guard. Delete only obsolete rate counters, never receipts.
- [ ] Test 61 distinct deliveries in the same minute (60 accepted; last 429), duplicate bypass of quota, invalid key, different-payload 409, retry after disable, credential rotation racing acceptance, and publisher changes. Use the authorizer callback to deterministically exercise races.
- [ ] Run the incoming suite and existing workflow suite; commit `feat: accept authenticated workflow webhook events`.

### Task 3: Versioned outgoing destinations and bounded transport

**Files:** create `packages/crm-server/src/workflows/webhook-destinations.ts`, `webhook-transport.ts`, `packages/crm-server/test/workflow-webhook-transport.test.ts`; extend `test/workflow-webhooks.test.ts` and `src/workflows/repository.ts`.

**Interfaces:** implement destination repository above. Export `sendWorkflowWebhook(input, dependencies): Promise<WebhookTransportResult>` where input contains resolved URL/auth, exact payload string and stable key. Result is `{status:number|null,retryable:boolean,retryAfterMs:number|null,output:unknown,error:string|null,truncated:boolean}`. Fetch/DNS both use the injected fetcher. Configuration/security validation errors are terminal.

- [ ] Add tests rejecting other-workspace destination resolution, stale update revisions, unauthenticated secret clearing, invalid URLs/header names, missing encryption key, private DNS results and redirects. Add tests for destination URL revisions and credential rotation. Confirm failures with the server suite.
- [ ] Implement URL revisions as immutable rows and encrypted credentials with existing `encryptSecret`/`decryptSecret`. Publication and runtime validation resolve the exact node revision in the same workspace. Credential updates never create a new URL revision; auth-type/header changes do. Explicitly changing auth type requires credentials consistent with the new type and invalidates unsupported old combinations with a clear blocked error rather than silently sending wrong auth.
- [ ] Implement public URL/DNS validation from `integrations.ts`, redirect rejection and one deadline covering DNS plus HTTP. Send only JSON content type, reserved identity/idempotency headers, and the configured credential. Do not propagate arbitrary workflow/context fields into headers.
- [ ] Read at most 32768 response bytes, cancel the remainder and set truncated. Redact known secret strings and sensitive JSON keys, including nested values. Return bounded text if the response is not JSON. Sanitize network errors without echoing URLs with queries, auth headers or response text.
- [ ] Add deterministic transport assertions:

```ts
expect(result.retryable).toBe(true); // injected HTTP 503
expect(result.retryAfterMs).toBe(300000); // Retry-After: 999999
expect(JSON.stringify(result)).not.toContain(secret);
expect(capturedRequest.redirect).toBe("error");
```

Construct `capturedRequest` from the injected fetcher after handling the A/AAAA DNS fixture requests. Cover 200/204, 301, 400, 408, 429, 500, non-JSON, response stream errors and cancellation on timeout.
- [ ] Run transport and repository suites, then commit `feat: configure secure workflow webhook destinations`.

### Task 4: Durable delivery and lease-fenced retry

**Files:** create `packages/crm-server/src/workflows/webhook-delivery.ts`, `packages/crm-server/test/workflow-webhook-delivery.test.ts`; modify `src/workflows/runtime.ts` and `repository.ts`.

**Interfaces:** extend runtime options with `webhooks?: WebhookDependencies` preserving existing callers. `executeWebhookNode(db, run, node, context, leaseToken, now, dependencies): Promise<void>` handles preparation, delivery and result checkpoint; it uses the existing `ExecutionRow`, `WorkflowContext` and the webhook member of `WorkflowNode`. Native steps keep their transaction implementation unchanged.

- [ ] Add real-D1 tests starting published webhook-step workflows with an injected receiver; test success and failure before implementation. Store captured request body and idempotency header for assertions.
- [ ] Guard preparation by active lease/status. Resolve values once, enforce encoded request bytes, persist exact payload and a SHA-256 stable identity based on workspace/execution/node. Persist an attempt row and increment count before sending. Use the pinned destination revision and current credential after permission checks. Never send after a failed preparation guard.
- [ ] On success, atomically mark attempt/delivery successful, write sanitized job output, update context and advance the next node, all fenced by lease and running state. On retryable result use waiting/wake_at with 5s/30s or bounded Retry-After. After attempt 3 fail. Terminal errors fail immediately. Do not let generic runtime catch logic add a second automatic retry policy.
- [ ] Recover expired attempts as uncertain outcomes consuming their reserved attempt; use identical body/key on retry. Manual retry starts a new bounded retry generation while preserving lifetime attempt sequence/body/key. Update `WorkflowRepository.retry` transactionally for webhook deliveries only.
- [ ] Verify the loss-of-response case with a test transport that accepts a request but prevents checkpoint completion, advance the lease, and resume:

```ts
expect(requests[1].body).toBe(requests[0].body);
expect(requests[1].key).toBe(requests[0].key);
expect(requests).toHaveLength(3); // after repeated uncertain failures
expect((await repo.execution(run.id)).status).toBe("failed");
```

- [ ] Add races for cancellation during fetch, destination disable, revoked owner, stale lease result, URL edit after publication, secret rotation, and context size overflow. Assert an outgoing request already in flight may finish but cannot advance a cancelled run. Ensure history shows uncertain attempts even without a response.
- [ ] Run all workflow server suites including managed-workflow regression; commit `feat: execute durable workflow webhook deliveries`.

### Task 5: Host routes, generated API contracts and scheduler

**Files:** create `apps/api/src/workflow-webhooks.ts`, `apps/api/test/workflow-webhooks.test.ts`; modify `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/workflows.ts`, `apps/api/src/routes/dynamic-crm.ts`, `apps/api/src/crm/dynamic-openapi.ts`, `packages/crm-server/src/workflows/routes.ts`, `apps/api/test/workflow-scheduler.test.ts`.

**Interfaces:** public route `POST /api/public/workflow-webhooks/{endpointId}` calls task 2 service. Protected CRM routes: GET/POST `/api/workflows/:id/webhook`, POST `/api/workflows/:id/webhook/rotate`, GET/POST `/api/workflow-webhook-destinations`, PUT `/api/workflow-webhook-destinations/:id` (expected revision), POST `/:id/secret`, POST `/:id/enabled`. All management mutations require design permission; execution detail includes safe delivery attempts under history permission.

- [ ] Add host-level requests proving incoming secret authentication works without a login, protected management rejects anonymous users, and unrelated routes retain their original auth. Inspect the actual API shell authentication registration before any exemption; scope an exemption only to this exact public POST route if necessary.
- [ ] Register incoming OpenAPI schema/response codes and no-store headers, stream validation and optional host rate limiter. Register protected route schemas through existing dynamic OpenAPI generation. Error responses never return request headers or secret values.
- [ ] Pass the existing integration encryption key into CRM workflow management and scheduled runtime. Preserve `runScheduledWorkflows` authorization via current principal activity and `canManageSharedCrm`. Test hosts without keys and missing/disabled destinations.
- [ ] Extend scheduler tests with injected dependencies and verify an accepted webhook is queued before the next tick and completed after it. Wire a controlled fake receiver; do not use arbitrary live URLs.
- [ ] Run `pnpm --filter @savia/api exec vitest run test/workflow-webhooks.test.ts test/workflow-scheduler.test.ts`, relevant OpenAPI contract tests discovered from dynamic-openapi references, and API typecheck. Commit `feat: expose workflow webhook APIs and scheduler wiring`.

### Task 6: Editor, history and end-to-end verification

**Files:** create `apps/admin/src/features/crm-engine/workflow-webhooks.tsx`; modify `workflow-editor.tsx`, `workflows.tsx`, `workflows.css`, `test/workflows.test.tsx` in that directory; modify `docs/workflows.md`; extend `packages/crm-server/test/fixtures/workflow-preview.ts` and the admin workflow preview fixture as needed.

**Interfaces:** keep normal CRM API/runtime access and workspace-scoped React Query keys. `WorkflowWebhookSettings({workflowId})` manages incoming metadata/reveal; `WorkflowDestinationPicker({value,onChange})` returns `{destinationId,destinationRevision}` for the current draft. Outgoing step uses existing ValueInput mapping controls. Do not store mutation responses containing secrets in long-lived query caches.

- [ ] Add UI tests for selecting “Webhook recibido”, saving before endpoint creation, endpoint display and one-time reveal, and outgoing destination selection plus trigger-variable mapping. Run the admin workflow test to confirm failure.
- [ ] Implement trigger and step labels/defaults without invalid empty destination submissions. Show destination revision and inactive status. Add creation/edit/credential rotation dialogs with explicit progress/errors and accessible labels. Clearing/closing the reveal unmounts secret state and resets mutation state; workspace changes remount it.
- [ ] Add tests that close the panel and switch workspace, then assert:

```ts
expect(screen.queryByDisplayValue(revealedSecret)).not.toBeInTheDocument();
expect(screen.queryByText(otherWorkspaceDestination)).not.toBeInTheDocument();
```

- [ ] Show safe attempt history (HTTP status, count, uncertain outcome, retry time), and duplicate-delivery help. Incoming example uses a placeholder token after reveal closes. Build URLs from configured public API origin, not blindly from the admin origin. Explain preview scheduler requirements.
- [ ] Update workflow usage documentation, existing boundaries, configuration/migration instructions and POST examples. Document receipt retention, response redaction, DNS-preflight limits and lack of exactly-once remote effects. Keep API reference generated from task 5 schemas.
- [ ] Run `pnpm --filter @savia/admin exec vitest run src/features/crm-engine/test/workflows.test.tsx --maxWorkers=1`; run all new and existing focused workflow suites and `pnpm run typecheck`. Run `git diff --check` and format only changed files. Do not broaden tests after clean results without a concrete reason.
- [ ] Exercise the controlled local fixture: send the same authenticated incoming event twice, tick scheduler with injected receiver returning 503 then 200, assert one execution and two identical outgoing bodies/keys. Inspect editor and history in the browser at desktop and narrow widths using the browser skill. No production writes or cron changes.
- [ ] Commit `feat: configure and inspect webhooks in workflow editor`. Mark the spec implemented only after this verification. Request whole-change review using the code-review skill, resolve findings and rerun affected tests. Report checks and any remaining deployment prerequisites; merging/pushing this feature requires the applicable current user authorization.

## Implementation outcome

Implemented in `codex/workflow-webhooks`. Focused verification: 7 shared schema tests, 39 real-D1/runtime/transport tests, 2 host API/scheduler tests, and 8 editor tests passed. Full monorepo typecheck passed; affected packages were rechecked after review fixes. Desktop and mobile browser checks and a local incoming-to-outgoing smoke test passed. Independent review findings were reproduced and corrected: concurrent credential rotation, response-key redaction, transient DNS handling, and final uncertain-attempt closure.

The shared database fixture exercises multiple tasks together, so implementation is committed as one integrated change. No deployment or production migration was performed. Detailed acceptance and operation instructions are in `docs/workflows.md`.

## Execution handoff

Tasks run in dependency order; do not split repository/runtime interface edits between concurrent implementers. Recommended execution is native in this session followed by an independent whole-change review, because incoming receipts, publication, destination versions and delivery leases share invariants. The current checkout is already a managed worktree; preserve its existing navigation commits and untracked `.impeccable/` artifact. Use a dedicated `codex/workflow-webhooks` branch from the current commit when execution begins, after verifying no conflicting branch or user edits.

## Plan self-review

Coverage: incoming contract/storage/rate limits (1–2), outgoing credentials/transport (3), retries/leases/history (4), API/permissions/scheduler/OpenAPI (5), editor/documentation/local demonstration (6). All five Review Focus cases have explicit owning tests. Type names and producer/consumer boundaries are declared above; test-only receivers never weaken production URL validation. No implementation has started at plan review time.
