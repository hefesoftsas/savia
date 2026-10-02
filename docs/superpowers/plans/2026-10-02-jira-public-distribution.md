# Jira Public Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable personal Jira authorization for every Savia user after implementing and verifying Atlassian personal data reporting and erasure.

**Architecture:** Add an internal privacy repository and service beside the existing personal integrations. Use the existing scheduler, D1-compatible persistence, PostgreSQL migrations, and Nango proxy. Keep external activation separate from code delivery until production reporting credentials, erasure, and OAuth sharing are verified.

**Tech Stack:** TypeScript, Cloudflare Workers/D1, SQLite, PostgreSQL, Vitest, existing Nango and GitHub deployment workflows. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-02-jira-public-distribution-design.md`

## Global Constraints

- Preserve the existing read-only issue integration and viewer-scoped previews.
- Send at most 90 distinct accounts per request to `POST https://api.atlassian.com/app/report-accounts/`.
- Default reporting period is seven days; leases and transient-error retry delays are five minutes.
- Account IDs are 1–128 alphanumeric, `-`, or `:` characters; reject `unknown`.
- Tokens and client secrets stay in Nango; reporting IDs and inventories remain backend-only.
- Support SQLite/D1 and PostgreSQL and both Worker scheduling modes plus self-hosted scheduling.
- Erase stale identity data from historical rows and Nango; keep durable cleanup references until deletion is confirmed.
- Production activation follows migration, reporting, cleanup, and credential verification.
- Code, tests, and docs use English. Never attest that reporting or public distribution works without evidence.

## Review Focus

1. A reconnection while reporting is in flight must not lose a newer connection to another account.
2. Partial Nango cleanup must survive a restart without falsely claiming erasure.
3. Legacy connections with no verified account ID must be backfilled or remain pending, never silently skipped.
4. A provider timing header with an unverified representation must not cause premature repeated reports.
5. Erasing the reporting owner's data must stop reporting and request fresh owner authorization rather than preserve stale credentials.

## Execution and file ownership

Recommended execution: native implementation in this chat, followed by a fresh Luna review of the combined diff. The route, repository, and scheduler depend on the same identity and cleanup contracts; implement those steps sequentially. Review findings go back to the implementer. Do not create sidebar chats or touch unrelated contributors' files.

The existing managed worktree and branch `codex/jira-public-distribution` provide isolation. Recheck repository status before each task. If migration number 0015 has been taken by a newer change, allocate the next number and update all references before writing migrations; never rewrite an applied migration.

---

### Task 1: Durable privacy inventory and cleanup repository

**Files:**

- Create `apps/api/src/personal-integrations/jira-privacy-contracts.ts`.
- Create `apps/api/src/personal-integrations/jira-privacy-repository.ts`.
- Create `packages/db/migrations/0015_jira_privacy_reporting.sql` and `packages/db/postgres/0015_jira_privacy_reporting.sql`.
- Modify `packages/db/src/core-schema.ts`, `packages/db/postgres/manifest.json`, and the private connection contract in `apps/api/src/personal-integrations/contracts.ts`.
- Create `apps/api/test/jira-privacy-repository.test.ts` and `apps/self-hosted/test/jira-privacy-migration.test.ts`.

**Interfaces:**

- `JiraIdentity`: `{ accountId: string; label: string | null; retrievedAt: string }`.
- `JiraPrivacyAccount`: `{ integrationId: string; accountId: string; oldestDataAt: string; version: number; lastReportedAt: string | null; nextReportAt: string; retryAt: string | null; leaseToken: string | null; leaseUntil: string | null; pendingErasure: "closed" | "updated" | null; blockedReason: "unsupported-cycle" | "owner-auth-required" | null }`.
- `JiraPrivacySnapshot`: `{ generation: string; connectionId: string | null; principalId: string | null; integrationId: string; nangoConnectionId: string; accountId: string; retrievedAt: string; cleanupReason: "closed" | "updated" | "disconnect" | "replace" | null; cleanupRetryAt: string | null }`. Null connection/principal IDs identify the operational owner connection; user connections always have both IDs.
- `JiraReportLease`: `{ token: string; integrationId: string; accounts: Array<{ accountId: string; updatedAt: string; version: number }> }`.
- `createJiraPrivacyRepository(database: D1Database)` returns methods `saveVerifiedConnection(completion: PersonalIntegrationCompletion, identity: JiraIdentity)`, `claimDueReports(integrationId: string, now: string): Promise<JiraReportLease>`, `acceptReport(lease: JiraReportLease, now: string, cycleMs: number | null, erasures: Array<{ accountId: string; status: "closed" | "updated" }>)`, `retryReport(lease: JiraReportLease, retryAt: string)`, `queueDisconnect(connection: ActivePersonalIntegrationConnection, reason: "disconnect" | "replace", now: string)`, `listCleanup(now: string, limit: number): Promise<JiraPrivacySnapshot[]>`, `finishCleanup(snapshot: JiraPrivacySnapshot, now: string)`, and `retryCleanup(snapshot: JiraPrivacySnapshot, retryAt: string)`.
- `saveVerifiedConnection` returns `Promise<ActivePersonalIntegrationConnection>` and owns an atomic database batch that saves the existing connection, account inventory, and versioned snapshot.
- A null cycle in `acceptReport` records the provider-accepted report and any erasure actions, sets `blockedReason="unsupported-cycle"`, and excludes those accounts from further reporting until the protocol is verified. It does not discard an accepted erasure or retry that accepted report after five minutes.

- [ ] Write failing repository tests using real migrated D1 state. Assert an account shared by two principals produces one report item with the older `updatedAt`; 91 distinct due accounts produce one lease of 90; a second concurrent claim excludes the first lease; reclaiming works after exactly five minutes.
- [ ] Add tests that queue cleanup, reopen the repository, and still find pending snapshots. Assert clearing one snapshot preserves the ledger while another stored copy exists. Assert replacing a Nango connection retains the old reference for cleanup and does not apply its cleanup to the new generation.
- [ ] Run `pnpm --filter @savia/api exec vitest run test/jira-privacy-repository.test.ts`; confirm the intended failures before implementation.
- [ ] Implement the repository and migrations. Use two tables: `jira_privacy_accounts` keyed by `(integration_id, account_id)`, and `jira_privacy_connections` keyed by `generation`, with an index on `(integration_id, account_id)` and unique `(integration_id, nango_connection_id)`. Keep timestamps as RFC 3339 text, use portable integer versions, and claim rows with conditional updates on eligibility and lease expiry.
- [ ] Add a private connection-generation field to the existing connection schema so cleanup can compare the exact version. Use atomic D1 batches for connection/inventory changes; preserve equivalent transactional behavior in the PostgreSQL adapter. Recompute oldest retained data on finalizing cleanup; do not delete inventory while a snapshot remains.
- [ ] Add upgrade tests that retain live connections, erase disconnected legacy identity fields, and preserve other providers. Add the source migration checksum and table definitions to the manifest using the existing schema conventions.
- [ ] Run the new API tests and `pnpm --filter @savia/self-hosted exec vitest run test/jira-privacy-migration.test.ts test/postgres-migrations.test.ts`. Run native PostgreSQL tests only with a configured test database; record missing live database verification explicitly.
- [ ] Commit `feat: track Jira privacy reports and pending cleanup`.

### Task 2: Verified identity and fixed reporting transport

**Files:**

- Create `apps/api/src/personal-integrations/jira-privacy.ts`.
- Modify `apps/api/src/personal-integrations/contracts.ts` and `apps/api/src/personal-integrations/nango.ts`.
- Create `apps/api/test/jira-privacy.test.ts`; extend `apps/api/test/personal-nango.test.ts`.

**Interfaces:**

- Narrow the Nango proxy's connection input to the fields it actually consumes: `Pick<ActivePersonalIntegrationConnection, "provider" | "nangoConnectionId" | "nangoIntegrationId">`. Existing full connection callers remain structurally compatible.
- `resolveJiraIdentity(nango: PersonalIntegrationNangoClient, connection: JiraConnectionRef, retrievedAt: string): Promise<JiraIdentity>`, where `JiraConnectionRef` is that narrowed connection input with provider `"jira"`.
- `reportJiraAccounts(nango: PersonalIntegrationNangoClient, reporter: JiraConnectionRef, lease: JiraReportLease, now: string): Promise<{ cycleMs: number | null; erasures: Array<{ accountId: string; status: "closed" | "updated" }> }>`. Null cycle signals an accepted report with unsupported timing; the scheduler persists its actions and blocks additional reports.
- A controlled reporting error has an internal error code and optional `retryAt`, without upstream body, account inventory, or credential fields.

- [ ] Write failing identity tests asserting that accessible resources and `/ex/jira/{cloudId}/rest/api/3/myself` determine the account. Reject `unknown`, malformed IDs, empty resources, failed identity reads, and invalid bodies; do not replace an unknown account with the Savia email.
- [ ] Write transport tests asserting fixed Jira host, fixed report path, owner connection ID, and a body of at most 90 deduplicated accounts. Cover valid 204, valid 200, foreign IDs, duplicate IDs, unsupported statuses, invalid JSON, 401/403, 429 with `Retry-After`, and 5xx.
- [ ] Run `pnpm --filter @savia/api exec vitest run test/jira-privacy.test.ts test/personal-nango.test.ts`; confirm the new behaviors fail.
- [ ] Implement identity reads using the first resource advertising Jira read access and a validated UUID-like cloud ID; encode the returned ID in the fixed route. Require an active user response. Use the captured retrieval time for new data.
- [ ] Implement reporting through Nango's existing fixed Jira destination. Validate a whole 200 response before returning any erasure decisions. Use seven days when `Cycle-Period` is absent. Treat an unknown header representation as `JIRA_PRIVACY_CYCLE_PERIOD_UNSUPPORTED` and retain accepted response actions durably before stopping scheduling; never guess whether an unqualified number means days or seconds.
- [ ] Before public activation, inspect an actual provider response or an authoritative provider definition to confirm any nonempty `Cycle-Period` representation. Add exact parser examples and tests if verified. If verification is unavailable and that header occurs, report an external activation blocker rather than silently falling back. `Retry-After` follows the reporting API's documented seconds representation, and missing/invalid retry values use five minutes.
- [ ] Make Nango deletion idempotent for 404 while preserving controlled errors for other failed deletions. Assert existing other-provider behavior in its tests.
- [ ] Run the targeted transport tests and API typecheck, then commit `feat: validate Jira identities and privacy report responses`.

### Task 3: Complete, reconnect, and disconnect with privacy tracking

**Files:**

- Modify `apps/api/src/routes/personal-integrations.ts` and `apps/api/src/personal-integrations/repository.ts`.
- Extend `apps/api/test/personal-integrations.test.ts` and `apps/api/test/jira-privacy-repository.test.ts`.

**Interfaces:**

- Route dependencies can inject `jiraPrivacy?: ReturnType<typeof createJiraPrivacyRepository>`; production registration defaults to the repository backed by the route's database.
- Jira completion consumes Task 2's verified identity and Task 1's `saveVerifiedConnection`; other providers continue using the existing save path.
- Jira disconnect calls `queueDisconnect` before upstream cleanup, and `finishCleanup` only after successful or already-absent Nango deletion.

- [ ] Write failing route tests proving caller ownership checks happen before identity access; a valid Jira connection stores a verified ID and age; lookup failure never marks it connected; unknown/malicious metadata cannot supply the account ID.
- [ ] Add reconnect tests for a different Atlassian account and a new Nango connection ID. Assert the previous snapshot stays pending until cleanup, the new identity gets its own age, and old cleanup cannot erase the new row.
- [ ] Add disconnect tests asserting Jira labels and IDs disappear from historical rows, failure leaves durable cleanup work, and a repeated cleanup after a process restart succeeds. Verify other providers preserve their current disconnect contract.
- [ ] Run the route and repository tests; confirm each new assertion fails for the missing behavior.
- [ ] Implement the Jira-only route branches using the defined repository and transport interfaces. Account verification precedes persistence. Queue old connection cleanup on replacement; strip new generation and reporting fields from public connection documents alongside existing private fields.
- [ ] Run `pnpm --filter @savia/api exec vitest run test/personal-integrations.test.ts test/jira-privacy-repository.test.ts test/jira-privacy.test.ts` and API typecheck. Commit `feat: reconcile Jira account data across connection changes`.

### Task 4: Scheduled reporting, backfill, and erasure

**Files:**

- Extend `apps/api/src/personal-integrations/jira-privacy.ts` and `jira-privacy-repository.ts`.
- Modify `apps/api/src/runtime.ts`, `apps/api/src/external-crm/runtime.ts`, `apps/api/src/external-crm/nango.ts`, and `apps/self-hosted/src/application.ts`.
- Extend `apps/api/test/workflow-scheduler.test.ts`, `apps/api/test/index.test.ts`, and `apps/api/test/jira-privacy.test.ts`.
- Create `apps/self-hosted/test/jira-privacy-runtime.test.ts`.

**Interfaces:**

- `NangoConfiguration` gains `jiraReportingConnectionId?: string`, populated from `NANGO_JIRA_REPORTING_CONNECTION_ID`.
- `runScheduledJiraPrivacy(database: D1Database, configuration: NangoConfiguration, options?: { fetcher?: typeof fetch; now?: () => Date }): Promise<{ backfilled: number; reported: number; cleaned: number; pending: number }>`.
- Add `listUnverifiedJiraConnections(integrationId: string, limit: number)`, `recordLegacyIdentity(connection: ActivePersonalIntegrationConnection, identity: JiraIdentity)`, and `recordOperationalIdentity(connection: JiraConnectionRef, identity: JiraIdentity)` to the repository. Legacy retrieval age uses connection creation time conservatively, and legacy failures remain pending.
- Runtime test overrides may inject the Jira fetch transport. The self-hosted adapter passes the reporting connection variable through to the same runtime.

- [ ] Write failing service tests for absent Jira configuration (no-op), enabled Jira without reporter (controlled error), bounded legacy backfill, persisted legacy failure, report retry after restart, and pending erasure resumed independently of a new report.
- [ ] Write a race test where a connection is replaced while a closed/updated report is in flight: erase the captured stale snapshot and keep the new unrelated account ready. Write an owner-erasure test that deletes the reporting owner's stale connection and surfaces an authorization error before another report.
- [ ] Write scheduling tests proving invocation from both normal and `SAVIA_WORKFLOW_ONLY_SCHEDULE="true"` branches and the self-hosted scheduler, without duplicating ticks.
- [ ] Run the new tests and confirm intended failures.
- [ ] Implement one batch per tick: backfill at most ten legacy connections, process at most ten pending cleanup references, and report at most 90 accounts. Use leases and persisted retry times from Task 1. Record response erasures before cleanup; do not advance a cycle on transport failure. Retry Nango deletion without retaining stale public labels.
- [ ] Backfill the dedicated reporting connection too if Nango retains an Atlassian identity not already represented by a Savia snapshot. Track that snapshot as operational rather than assign it to an arbitrary tenant or principal; when cleanup removes it, require owner reauthorization.
- [ ] Add the job to both existing scheduler arrays; include failures in the existing aggregate error. Log counts and controlled error codes only. Add the self-hosted variable and configuration mapping.
- [ ] Run targeted scheduler/service/configuration tests and typecheck API and self-hosted packages. Commit `feat: schedule Jira privacy reporting and erasure`.

### Task 5: Deployable configuration, documentation, and public activation

**Files:**

- Modify `scripts/render-cloudflare-production-config.mjs`, `scripts/upload-cloudflare-secrets.mjs`, their test files, `.github/workflows/deploy-preview.yml`, and `.github/workflows/deploy-cloudflare.yml`.
- Extend `scripts/dev-local.test.mjs` and `scripts/dev-api-runtime.test.mjs` to verify reporting-variable forwarding. The existing `scripts/dev-api-runtime.mjs` already forwards backend `NANGO_` variables; modify runtime code only if a failing test demonstrates a missing path.
- Update `docs/guides/issue-links.md` and this plan's checkboxes.

**Interfaces:**

- `renderProductionConfigs` gains optional `jiraIntegrationId?: string`; when supplied it renders `NANGO_JIRA_INTEGRATION_ID`, otherwise preserves the disabled card. CLI input and both workflow environments supply `NANGO_JIRA_INTEGRATION_ID` from their own GitHub environment variables.
- `buildSecretUploads` accepts optional `NANGO_JIRA_REPORTING_CONNECTION_ID` and uploads it only to that environment's API worker. Never render it into frontend assets or print it.
- Preview and production workflows pass their respective environment secret to the uploader. Runtime validation from Task 4 catches incomplete enabled installations.

- [ ] Write failing configuration tests for default disabled Jira, explicit integration enabling, separate preview/production reporter upload, and rejection of an enabled Jira configuration lacking its operational prerequisite during verification. Assert the reporter never reaches admin assets or other workers.
- [ ] Run `node --test scripts/render-cloudflare-production-config.test.mjs scripts/upload-cloudflare-secrets.test.mjs scripts/dev-local.test.mjs scripts/dev-api-runtime.test.mjs`; confirm the intended failures.
- [ ] Implement the optional integration input, reporting secret forwarding, and workflow variables. Keep hosted Jira disabled by default until the external checks below pass; do not equate the renderer option with completed public activation.
- [ ] Update the guide with reporter authorization, cycle/error behavior, reconnection after erasure, historical cleanup, and operation-specific live evidence. Mark the old "reporting implementation is not present" statement obsolete only after code verification passes.
- [ ] Run all targeted Jira/integration/scheduling/configuration tests, then `pnpm test`, `pnpm run typecheck`, formatting checks on changed files, and `git diff --check`. Record every unresolved failure and every live check that was not performed.
- [ ] Request a fresh Luna review with the spec, plan, combined diff, test output, and file ownership. Resolve findings and rerun affected checks. Commit `feat: prepare verified Jira public distribution`.
- [ ] Recover access to Nango and the Atlassian developer console using the available supported tools. Audit Nango identity metadata, proxy response logs, sync records, and deletion retention. Correct production credentials without copying redacted placeholders; do not regenerate credentials or accept legal statements silently.
- [ ] Authorize the owner reporting connection for each enabled environment with the same OAuth app. Verify reporting using Atlassian's active/closed test accounts within the permitted cycle, and verify deletion of controlled test data. Save only sanitized evidence.
- [ ] Create and attach a PR with exact validation and external activation status. Follow preview CI, migration, and deployment requirements. Keep the public integration disabled if reporting or Nango cleanup is unverified.
- [ ] After verified reporting/erasure and any required browser confirmation, enable sharing in the Savia Prod OAuth app and set the production environment's integration variable to `jira`. Promote the validated commit through the existing production workflow.
- [ ] Verify production's Connect button, public OAuth authorization by a non-owner account when available, and a caller-authorized issue preview. If a non-owner account or external access is unavailable, report the precise incomplete check; do not claim the task is finished merely because the code merged.

## Self-review

Each specification section maps to a task: storage and age to Task 1; identity and provider protocol to Task 2; connection lifecycle to Task 3; durable scheduled work and legacy records to Task 4; configuration, documentation, review, and live acceptance to Task 5. Every Review Focus condition has an explicit test step. No new UI or issue-write capability is introduced. External header representation and administrative access are explicit activation checkpoints with a safe failure path rather than assumed completed work.

## Current status

Specification approved. Implementation plan prepared for user review. Product implementation and external activation have not started.

Baseline checks on this worktree: the existing personal integration, Nango proxy, and index test files passed (44 tests), and API TypeScript checking passed. No live PostgreSQL test URL is configured. The existing Nango console remains inaccessible through browser control; external verification is still pending.
