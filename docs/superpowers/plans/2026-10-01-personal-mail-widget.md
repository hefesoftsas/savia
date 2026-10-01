# Personal Mail Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show connected Gmail/Outlook inboxes in My Day and send editable emails with authorized record context.

**Architecture:** Extend the existing personal integration API and system-widget contract. Keep provider normalization, mailbox state, context selection, and composition separate. Validate context again through the authorized tenant read routes before a provider write; retain the Assistant confirmation flow.

**Tech Stack:** TypeScript, React, Hono/Zod OpenAPI, existing Nango integration, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-01-personal-mail-widget-design.md`.

## Global Constraints

- Only active, connected mail integrations qualify.
- Fetch at most 25 messages per provider. The widget shows the latest ten inbox messages.
- The existing 12-widget limit applies, including hidden mail widgets.
- Retain existing limits: up to 20 recipients, 2,000 subject characters, and 10,000 body characters.
- Server authorization remains authoritative. Never accept an arbitrary user, external connection ID, access token, or upstream URL from the client.
- Only widget layout persists through the existing backend user preferences.
- Mailbox messages and composer content are transient in-memory UI state.
- No AI service is required to prepare the draft.
- Do not send a real email or change a live mailbox while validating this feature.
- Code, tests, and documentation are English; follow the existing Spanish interface copy conventions.

## Review Focus

- Identity changes during mailbox/context requests must invalidate old results immediately (Tasks 4–5).
- A revoked field or deleted record between preview and send must stop the provider write (Task 2).
- Same message ID in different providers must remain two rows; missing dates must sort last (Task 4).
- Unknown send outcome must retain the draft without automatic retries or duplicated clicks (Task 5).
- A full saved dashboard must offer no shortcut that exceeds 12 widgets; absent connections must hide mail without rewriting preferences (Task 6).

## File responsibilities

Existing `operations.ts` owns caller-owned connection lookup, provider writes, and audit.
New `mail-metadata.ts` owns provider metadata normalization and link validation.
New `mail-context.ts` owns reference validation through authorized tenant reads.
New `mail-contracts.ts` defines shared mail payloads for API and admin.
The integration client owns transport; `use-my-day-mail.ts` owns mailbox lifecycle;
`mail-widget.tsx`, `mail-context-selector.tsx`, and `mail-composer.tsx` own display,
context selection, and the editing/sending workflow respectively.

### Task 1: Recent inbox metadata and links

**Files:** Create `apps/api/src/personal-integrations/mail-metadata.ts` and `apps/api/test/personal-mail-metadata.test.ts`; modify `apps/api/src/personal-integrations/operations.ts`, `apps/api/src/routes/personal-integrations.ts`, `apps/api/test/personal-integrations.test.ts`.

**Interfaces:** `PersonalMessage` retains `id`, `subject`, `sender`, `receivedAt` and adds `webLink: string | null`. `listMessages({ principalId, provider, query?: string }): Promise<PersonalMessage[]>` treats omitted query as inbox; supplied query remains search. Native URLs are normalized server-side; the admin consumes `webLink` directly.

- [ ] Verify current Gmail list/get and Outlook inbox/webLink contracts against official provider documentation. Verify an account-aware Gmail message-link strategy. If a direct link is unsupported, return null, as required by the spec.
- [ ] Add failing tests named `lists recent inbox without a query`, `hydrates Gmail headers and timestamps`, `preserves existing search semantics`, `rejects unsupported native link hosts`, and `handles failed metadata hydration`. Assert provider list limit 25, inbox selection, newest-first Outlook ordering, four-at-a-time maximum Gmail hydration, and no message-body retrieval. Use controlled Nango responses.
- [ ] Run `pnpm --filter @savia/api exec vitest run test/personal-integrations.test.ts test/personal-mail-metadata.test.ts`; confirm new behavior fails before implementation.
- [ ] Implement `normalizeGmailMessage(payload: unknown, accountLabel: string | null): PersonalMessage | null` and `normalizeOutlookMessage(payload: unknown): PersonalMessage | null` in the metadata module. Restrict native destinations to verified Google/Microsoft mail hosts. Extend list operations with inbox defaults and bounded metadata hydration; preserve existing search validation. A partial Gmail metadata failure keeps the row with null metadata and an unavailable link; a failed list fails that provider.
- [ ] Update OpenAPI list schema with optional query and nullable link; pass omitted query through without changing file search validation.
- [ ] Re-run the Task 1 command; require all tests passing. Commit `feat: expose recent personal inbox metadata` with only this task's files.

### Task 2: Explicit sending and server-side context checks

**Files:** Create `packages/studio-shared/src/mail-contracts.ts`, `apps/api/src/personal-integrations/mail-context.ts`, and `apps/api/test/personal-mail-context.test.ts`; modify `packages/studio-shared/package.json`, `apps/api/src/personal-integrations/operations.ts`, `apps/api/src/routes/personal-integrations.ts`, and `apps/api/test/personal-integrations.test.ts`.

**Interfaces:** Export `PersonalMailProvider = "gmail" | "outlook"`, `MailContextReference = { apiBasePath: string; collection: string; recordId: string; fields: string[] }`, and `SendPersonalMailInput = { provider: PersonalMailProvider; to: string[]; subject: string; body: string; context?: MailContextReference[] }` from the shared module. Export `validateMailContext(context: MailContextReference[], read: (path: string) => Promise<Response>): Promise<void>`. Produce `sendMail({ principalId, ...input }: SendPersonalMailInput & { principalId: string }): Promise<PersonalIntegrationActionResult>` and authenticated `POST /v1/personal-integrations/messages` returning `{ data: { provider, action: "send-email" } }` on success.

- [ ] Define failing tests `sends only from caller owned connected account`, `rejects invalid mail before provider write`, `rejects revoked record context before sending`, `rejects unreadable selected field`, `rejects deleted record`, and `preserves Assistant confirmation requirements`. Assert no Nango write on any failed context read and one write on success.
- [ ] Run `pnpm --filter @savia/api exec vitest run test/personal-integrations.test.ts test/personal-mail-context.test.ts`; record the expected failures.
- [ ] Implement strict shared Zod schemas. Validate tenant paths using the existing studio/dynamic-crm numeric tenant grammar, collection/field names using existing widget identifier rules, nonempty record IDs, unique selected fields, at most 50 selected fields and 10 context references. Enforce spec mail limits and reject CR/LF in recipient addresses and subject.
- [ ] Implement context validation using GET reads of the tenant's `/api/objects` and `/api/records/{collection}/{recordId}` routes. Build paths only from validated references and encoded identifiers. Require collection existence, field presence in both authorized metadata and returned record, and successful record read. Fail closed on 403/404/unavailable/malformed responses. Never retrieve an unguarded database record.
- [ ] Register the POST route with API write scope and existing authentication protections. Supply the helper a same-app request adapter using the original request's authentication headers and runtime environment/execution context; dispatch only the constructed GET tenant paths. Validate context before `sendMail`; map denials to 403, missing records to 404, malformed payloads to 400, provider unavailability to 503, and upstream failures to 502. Preserve existing confirmation-route behavior.
- [ ] Extract/reuse the existing send implementation and audit in `sendMail`; call it from both the new route and the already-confirmed Assistant action. Never retry provider writes automatically.
- [ ] Re-run Task 2 tests and shared package type checking; require passing results. Commit `feat: send personal mail with authorized record context`.

### Task 3: Mail system widget and typed client

**Files:** Modify `packages/studio-shared/src/my-day-widgets.ts`, `packages/studio-shared/test/my-day-widgets.test.ts`, `apps/admin/src/api/personal-integrations-client.ts`; create `apps/admin/src/api/personal-mail-client.test.ts`.

**Interfaces:** `mail` is a `MyDaySystemWidgetKind`, present in `defaultMyDayWidgets()`, accepted by existing schema/predicates, without collection attributes. Client adds `listMessages({ provider, query? }): Promise<PersonalMailMessage[]>` and `sendMail(input: SendPersonalMailInput): Promise<{ provider: PersonalMailProvider; action: "send-email" }>`. `PersonalMailMessage` matches Task 1 `PersonalMessage`.

- [ ] Add failing serialization/default/predicate tests for `mail` and transport tests for omitted query, search query encoding, and send payload including context references. Assert existing saved layouts parse without an automatic mail insertion and system widgets reject collection attributes.
- [ ] Run `pnpm --filter @savia/studio-shared exec vitest run test/my-day-widgets.test.ts` and `pnpm --filter @savia/admin exec vitest run src/api/personal-mail-client.test.ts`; confirm new tests fail.
- [ ] Extend widget kind/default/predicates; implement typed client methods against Tasks 1–2. Do not cache mailbox contents or drafts in browser persistence.
- [ ] Re-run Task 3 tests and affected type checks; commit `feat: add mail widget contract and client`.

### Task 4: Mailbox hook and inbox body

**Files:** Create `apps/admin/src/features/my-day-widgets/use-my-day-mail.ts`, `mail-widget.tsx`, and `mail-widget.test.tsx`.

**Interfaces:** Export `PersonalMailLike = Pick<PersonalIntegrationsClient, "listConnections" | "listMessages" | "sendMail">`; `useMyDayMail(client: PersonalMailLike | undefined): MailState`; `MailState` contains `connections`, `messages` (each includes provider and account label), `loading`, per-provider `errors`, `refresh(): Promise<void>`, and `sessionRevision`. `MailWidgetBody({ mail, onCompose }: { mail: MailState; onCompose: () => void })` renders the inbox.

- [ ] Add failing tests for Gmail-only, Outlook-only, both, neither, partial provider failure, retry, empty inbox, reconnection, same IDs across providers, null dates, filtering, ten-row cap, account labels, and new-tab links. Assert session changes clear state and stale promises cannot repopulate it.
- [ ] Run `pnpm --filter @savia/admin exec vitest run src/features/my-day-widgets/mail-widget.test.tsx`; confirm missing behavior fails.
- [ ] Implement connection discovery with only `connected` Gmail/Outlook accepted. Use independent requests with settled results. Use a monotonically increasing request/session revision to discard stale results on refresh, client change, session-cleared, identity-changed, and unmount.
- [ ] Implement newest-first deterministic merging by valid timestamp then provider/ID; use provider plus ID as row key. Render filters only for two accounts, cap filtered results to ten, expose refresh/compose actions, and handle loading/errors/empty states. Links use server `webLink`, verified native hosts, `_blank`, and `noopener noreferrer`.
- [ ] Re-run Task 4 tests; commit `feat: show unified personal mail inbox`.

### Task 5: Editable composer and authorized record selector

**Files:** Create `apps/admin/src/features/my-day-widgets/mail-context-selector.tsx`, `mail-composer.tsx`, and `mail-composer.test.tsx`; modify `apps/admin/src/features/my-day-widgets/data.ts` only for reusable paginated record/detail helpers.

**Interfaces:** `MailComposer({ open, onOpenChange, apiClient, personalIntegrations, connections, sessionRevision })`; context selector emits `{ reference: MailContextReference; text: string }` through an explicit `onInsert` callback. New `listMailContextRecords(apiClient, apiBasePath, collection, page): Promise<WidgetRecordsPage>` requests 25 records per page; `readMailContextRecord(apiClient, reference): Promise<WidgetRecord>` fetches a selected detail through the tenant API.

- [ ] Add failing tests for sole-account default, two-account choice without lost draft, authorized collections/fields, paginated selection, explicit insertion preserving existing prose, clearing dependent selections, stale requests, permission errors, edited draft submission, no automatic recipients, one pending send, failed/unknown outcome retaining draft without retry, successful reset, and identity-change clearing.
- [ ] Run `pnpm --filter @savia/admin exec vitest run src/features/my-day-widgets/mail-composer.test.tsx`; confirm new tests fail.
- [ ] Implement paginated selector using existing workspace/collection/schema discovery and new record helpers. Select only fields returned by authorized schema and detail; preview selected labeled plain-text values. Add context references only on Insert; deduplicate repeated references/fields. Render object/array values as escaped plain text with bounded length; never inject HTML.
- [ ] Implement dialog with provider selector, recipients, subject, body, optional context selection, and explicit Send. Validate shared schemas before submission. Disable send during pending writes; keep draft on failure and show the unknown-outcome check-Sent guidance. Reset on success/session change. Track session revision for pending responses so previous identity results cannot change the new UI.
- [ ] Re-run Task 5 tests; commit `feat: compose personal mail from accessible records`.

### Task 6: Dashboard integration, guide, and combined verification

**Files:** Modify `apps/admin/src/features/my-day-widgets/section.tsx`, `widgets.tsx`, `add-widget-dialog.tsx`, relevant `types.ts` if needed, `apps/admin/src/features/personal-integrations/my-day-page.tsx`, `apps/admin/src/features/my-day-widgets/widgets.test.tsx`, `use-my-day-widgets.test.ts`, `apps/admin/src/features/personal-integrations/my-day-page.test.tsx`, and `docs/my-day-widgets.md`.

**Interfaces:** Section receives the existing integration service with Task 4 mail capabilities; shares one mail hook between widget/shortcut/composer. `WidgetCard` accepts optional `mail` and `onCompose` props. Add-widget dialog receives `mailAvailable: boolean` and offers the mail system widget when connected and absent.

- [ ] Add failing integration tests for mail defaults, connected-only display, existing-layout Add inbox shortcut, remove/restore/reorder, no preference mutation on disconnect, widget-count/drag behavior when hidden, full 12-widget board rejecting additions, and unchanged calendar-only service compatibility in existing fixtures.
- [ ] Run `pnpm --filter @savia/admin exec vitest run src/features/my-day-widgets src/features/personal-integrations/my-day-page.test.tsx`; confirm the new assertions fail.
- [ ] Wire the mail hook, widget body, composer, labels, and restore action into My Day. Filter disconnected mail cards from display while retaining persisted layout; compute drag IDs and first/last controls from visible cards, with reordering preserving hidden persisted entries. Keep add limits based on all persisted widgets. Update test services intentionally rather than disabling real API behavior for older fixtures.
- [ ] Rewrite the existing widget guide in English and document inbox connection rules, restoration, context permissions, native tabs, send confirmation, transient drafts, and failure handling.
- [ ] Run affected API/shared/admin tests from previous tasks plus `pnpm --filter @savia/studio-server test` to verify authorization regressions, and run `tsc --noEmit` in API/admin/studio-shared/studio-server. Run changed-file Prettier checks and `git diff --check`. Require passing results; report any pre-existing failure with evidence.
- [ ] If the local stack is available, use the in-app browser skill to verify responsive inbox, keyboard-accessible dialog, provider filters, and new-tab behavior with controlled test data. Do not connect live providers or send live mail. Report browser/live-provider checks that were not performed.
- [ ] Review the combined diff against the spec, especially all five Review Focus conditions. Commit `feat: integrate personal mail into My Day` once the verified changes are complete.

## Execution recommendation

Use native execution in this chat because tasks share API and widget interfaces
and are best integrated in dependency order. A focused independent final review
should inspect provider ownership, context authorization, and identity lifecycle
before completion. Preserve the current worktree and contributors' edits; do not
create a sidebar task or publish a deployment for this implementation.

## Execution results

Implemented all six task areas in the current worktree. Tasks 1–2 were committed
together because they modify the same routes and operations. Final integration
includes the generated OpenAPI types and a regression for the preferences schema.
The independent review found two issues (hidden connection errors and trimmed
message whitespace); both were corrected and covered by regression tests.

Verification: 75 focused admin tests, 51 focused API tests, and 18 final preferences
tests passed. The complete shared suite passed 258 tests; studio-server passed
307 with 7 skipped. Type checking passed in admin, API, shared, and studio-server.
Changed-file formatting and diff whitespace checks passed. Broad regression runs
reported a screen-management timeout and an API contract failure while its schema
was being corrected; the affected files passed isolated reruns after the fix.

Desktop and mobile layouts were inspected with controlled provider responses.
Temporary preview files and the preview server were removed. Live Gmail/Outlook
accounts and real email sending were not tested. Gmail returns no supported native
message link, so its rows show the documented unavailable-link state; Outlook
links open in a new tab.
