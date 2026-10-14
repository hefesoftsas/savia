# Application refresh stability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for shared infrastructure and integration; use superpowers:subagent-driven-development for independent domain batches after shared interfaces pass. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate unnecessary application-wide reload cascades and background-refresh flicker while preserving freshness, authorization and unsaved work.

**Architecture:** Reuse TanStack Query and React Admin for scoped server read models, separate initial loading from background updates, and invalidate affected models precisely. Separate profile updates from session replacement, deduplicate current-tenant reads, and distinguish realtime subscription changes from transport recovery. Preserve specialized Studio/offline synchronization and editor draft guards.

**Tech Stack:** Existing React 19, TypeScript, TanStack Query 5, React Admin, Vitest/Testing Library, Cloudflare realtime hints; existing native/Flutter entry points are audited separately. No new runtime dependency is required.

**Spec:** `docs/superpowers/specs/2026-10-08-app-refresh-stability-design.md`.

## Global constraints

- Backend remains the source of truth. Add only memory-scoped read caching and transient UI state; do not introduce browser persistence for records, secrets, tokens or drafts.
- Initial loading may show a skeleton only when the current scope has no successful data. Empty successful results count as loaded data.
- Scope changes never reuse previous-scope placeholder data. Logout, expired authorization and revoked access remove protected content promptly.
- Preserve admin defaults: 30-second freshness, five-minute unused-query lifetime, no window-focus refetch, at most one automatic read retry, no mutation retry. Preserve justified Studio/domain overrides.
- Preserve the 200 ms realtime burst window and legitimate recovery refreshes. No global polling or expanded backend topic authorization.
- Realtime refresh never performs provider sends, authorization, publishing or other mutations.
- Code, tests and documentation are English. Product messages use existing ES/EN/PT localization. Conventional English commits.
- This planning turn changes documentation only. Implementation starts from updated `main`, including merged PR #267 (`79956c25f2b9571c92a3fc89542a4ee99a74795a`) or a later descendant.

## Review focus

1. A profile/avatar change must not behave like replacing the authenticated principal; actual logout or access loss must still revoke protected views. Task 2 owns these tests.
2. An empty loaded dataset and a transient refresh failure must preserve mounted content; an initial error and a 401/403 must remain distinct. Tasks 3 and 6 own these tests.
3. A hint during an in-flight read must produce a bounded authoritative follow-up, while a topic change must not create an unrelated refresh cascade. Task 4 owns these tests.
4. Dirty/submitting forms, selected panels and embedded editors must survive clean read-model refresh, without hiding record deletion or stale-save conflicts. Tasks 6–9 own these tests.
5. Principal/tenant/resource switches with requests still running must never show previous-scope results; a late background error must not hide a newer action result. Tasks 2, 3 and 6–9 own these tests.

## Delivery structure

Treat this as one coordinated program with one final app-wide acceptance gate. Use reviewable dependent PRs rather than a single unreviewable patch. Shared infrastructure lands before migrations; do not call the program complete when only high-risk screens are fixed.

| Batch | Deliverable                                                        | Dependencies     |
| ----- | ------------------------------------------------------------------ | ---------------- |
| A     | Inventory, session lifecycle, shared query/read-state contracts    | Tasks 1–3        |
| B     | Realtime semantics and stable app shell                            | A; Tasks 4–5     |
| C     | Integrations, account and settings migrations                      | A+B; Task 6      |
| D     | My Day, notifications and collaboration views                      | A+B; Task 7      |
| E     | Studio, records, workflows and plugins                             | A+B; Task 8      |
| F     | Public/native surfaces and remaining feature closure               | A+B; Task 9      |
| G     | Cross-app browser evidence, documentation and preview verification | C+D+E+F; Task 10 |

Astra owns architecture, shared-file edits, integration and final review. At most two Luna workers may handle independent domain batches with disjoint file ownership. Workers report checks and blockers; they do not delegate further. C/D/E/F can run concurrently only within those limits and after contracts are fixed.

## Execution record (2026-10-09)

The original task checklists below preserve the planned scenarios. The implementation inventory is the authoritative evidence ledger: [app refresh inventory](../../guides/app-refresh-inventory.md).

| Tasks | Implementation disposition                                                                                                                                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | All 30 admin feature groups and shell/public/native/standalone boundaries inventoried; baseline HAR counts recorded without payloads.                                                                                                         |
| 2–5   | Session generation, profile/principal separation, protected cache revocation, current-tenant deduplication/gating, retained read primitives and exact coalesced realtime invalidation implemented with regressions.                           |
| 6–7   | Integrations/account/settings and collaboration migrations completed; specialized draft, document and pagination engines retained with scoped safeguards.                                                                                     |
| 8–9   | Studio/records/ACL/workflows/plugins and public/Companion/Savia Request boundaries audited; confirmed transient-error, late-completion and denial gaps fixed. Native source/test audit only: Flutter and OS capture were unavailable locally. |
| 10    | Controlled desktop/mobile-width/two-tab scheduler acceptance completed. Final repository checks, PR-head CI, merge and exact preview verification are delivery gates recorded in the PR.                                                      |

The controlled fixture verifies shared read budgets and retained DOM/draft, not real cross-tab schema writes. Domain concurrency/realtime/editor tests provide the corresponding source-level evidence. A comparable production HAR and native device acceptance remain follow-up measurements; neither is claimed passed.

## Task 1: Establish the full coverage and measurement baseline

**Files:** Create `docs/guides/app-refresh-inventory.md`; inspect `apps/admin/src/app.tsx`, `main.tsx`, `components/admin/`, every `features/` directory, `apps/companion/src/`, `apps/companion-mobile/lib/`, and `apps/savia-request/`. Inspect `pwa/deployment-recovery.ts`, `deployment-recovery-ui.tsx` and their existing tests.

**Produces:** A coverage ledger with columns: surface/route, loader and key owner, refresh triggers, scope, draft policy, destructive render/reset, existing tests, batch owner, disposition, verification evidence. Every feature group below must have a row; a compliant row needs evidence, not an assumption.

- [ ] Record source baseline and complete the ledger for account, assistant, assistant-configuration, access-control, bookings, companion, CRM, My Day widgets, notifications, Office, Office settings/suite, Pages, personal integrations, public forms/quotes, Savia Request, service credentials, Studio/Studio engine, tenant API keys/branding/email/page search/registration/social/SSO, tenants, users and WhatsApp.
- [ ] Trace representative navigation in a controlled authenticated environment: My Day → account → personal integrations → CRM → WhatsApp → Studio. Capture one desktop and one mobile-width trace. Record document requests, read counts by sanitized path, ticket/socket counts, component mount counts, focus and selected-panel changes. Keep raw HARs out of Git.
- [ ] Attribute actual reloads separately from read refetches and React remounts. Verify deployment recovery tests still enforce bounded recovery; do not suppress valid auth redirects or deployment recovery to satisfy a visual metric.
- [ ] Mark confirmed defects versus audit candidates. The initial confirmed set is current-tenant duplicate reads, account/identity fan-out, CRM wrapper dependencies, and destructive loaders in personal integrations/CRM/assistant configuration/virtual employees/account.
- [ ] Commit: `docs: inventory application refresh behavior`.

## Task 2: Separate profile refresh from session replacement

**Files:** Create `apps/admin/src/auth/session-scope.ts` and `.test.ts`; modify `auth/better-auth-oauth-session.ts`, `auth/react-admin-auth-provider.ts`, `app-services.ts`, `components/admin/user-menu.tsx` and their existing tests. Migrate every identity-reset listener listed by `rg -n 'savia:identity-changed' apps/admin/src` in its owning domain batch.

**Interfaces:** Export `getSessionGeneration(): number` and `rotateSessionScope(reason: 'logout' | 'principal-change'): void`. Rotation synchronously increments the memory-only generation and dispatches `savia:principal-changed`; existing `savia:session-cleared` continues to signify logout cleanup. `savia:identity-changed` refreshes identity display for the same principal; `savia:account-changed` updates account preferences. Do not rotate on token renewal or profile refresh. Actual principal changes are determined from authenticated identity IDs, not event names or avatar changes.

- [ ] Add failing tests: `profile refresh retains workspace and query scope`; `principal replacement rotates scope and rejects old completion`; `logout clears protected caches`; `permission loss revokes access without clearing unrelated profile state`. Verify the affected auth/app-services/user-menu tests fail for the existing conflation.
- [ ] Implement the explicit scope lifecycle. Cancel scoped reads and clear protected caches on actual rotation/logout before exposing the new principal. Keep identity, permissions and session renewal compatible with existing auth contracts.
- [ ] Update `UserMenu` so an account hint does not indiscriminately reset session-owned state. Audit profile-save producers and preserve identity/avatar freshness.
- [ ] Run the changed auth tests plus `app-services.test.ts` and shell tests. Assert that profile refresh does not dispose plugin/editor sessions; assert a real principal change does.
- [ ] Commit: `fix: separate account refresh from principal changes`.

## Task 3: Define shared scope keys and read-state policy

**Files:** Create `apps/admin/src/queries/query-keys.ts`, `query-policy.ts`, `read-state.ts` and their `.test.ts` files; create `components/admin/read-refresh-status.tsx` and `.test.tsx`; modify `app-services.ts` and `app.tsx` to use one policy factory. Keep `features/studio-engine/studio-query-cache.ts` partitioning intact.

**Interfaces:**

- `type ReadScope = { sessionGeneration: number; kind: 'principal' | 'tenant' | 'platform' | 'public'; id: string }`.
- `readKey(scope: ReadScope, resource: string, params?: Readonly<Record<string, unknown>>): readonly unknown[]` returns `['savia-read', scope.sessionGeneration, scope.kind, scope.id, resource, params ?? {}]`.
- `createAdminQueryClient(): QueryClient` centralizes existing admin defaults; React Admin native key shapes remain unchanged.
- `deriveReadState({ scopeReady, hasData, fetching, error, accessDenied }): 'initial' | 'ready' | 'refreshing' | 'refresh-error' | 'initial-error' | 'blocked'` treats successful empty data as `hasData=true`; blocked includes unresolved scope and denied access.
- `ReadRefreshStatus({ refreshing: boolean, error?: string, onRetry?: () => void }): ReactNode` renders localized nonblocking activity/error/retry beside retained content. It does not wrap/remount children or own draft state.

- [ ] Add failing tests for scope/key separation, stable parameter hashing, empty success, background pending/error retaining content, initial error, and 401/403 blocked state. Run only the new tests to establish failure.
- [ ] Implement the pure contracts and shared status component. Keep tokens, secrets and raw public share links out of diagnostic labels. Public scopes use an opaque per-route identifier.
- [ ] Test two concurrent identical query consumers: one underlying read. Test a new scope: no previous-scope placeholder. Test old in-flight completion after scope disposal: no current-view commit.
- [ ] Use AbortSignal through existing `ApiClient` RequestInit where clients support it; add optional read options only to clients migrated by later tasks. Retain generation guards where cancellation is not available. Do not modify mutation retry semantics.
- [ ] Run query/read-state/component tests, `app-services.test.ts` and `pnpm --filter @savia/admin exec tsc --noEmit`.
- [ ] Commit: `refactor: standardize scoped read states and query policy`.

## Task 4: Make realtime refresh selective and bounded

**Files:** Modify `realtime/use-realtime.ts`, `use-realtime-refresh.tsx` and their tests; create `realtime/use-realtime-query.ts` and `.test.tsx`; inspect `realtime/realtime-list.ts`, `resource-realtime.tsx`, `use-access-realtime.ts` and `features/studio-engine/studio-realtime.tsx` for compatibility.

**Interfaces:** Add `type RealtimeConnectionReason = 'initial' | 'subscription-change' | 'recovered'` as callback metadata. Update internal connection callbacks and consumers together; preserve existing event filtering. Export `useRealtimeQuery({ topics, tenantId?, enabled?, queryKeys, blocked? }): { changed: boolean; reload: () => Promise<void>; status: RealtimeStatus }`, using existing `useRealtimeRefresh` deferred-draft behavior and scoped query invalidation. The shared invalidation scheduler is per QueryClient/key so multiple listeners cannot create duplicate reads.

- [ ] Add failing tests: principal listener mount/removal keeps one socket; tenant/platform topic reconstruction does not announce transport recovery to unrelated listeners; actual recovery refreshes subscribed models; ten hints in 200 ms produce one read per key; a hint arriving during a read schedules at most one authoritative follow-up.
- [ ] Distinguish deliberate subscription changes from recovery without subscribing to unauthorized extra topics. Newly added topics still receive their own opening/catch-up reads. Preserve the already fixed principal topic set.
- [ ] Implement query-scoped invalidation and in-flight dirty tracking. Cancellation/disposal clears queued follow-ups; blocked editors retain a remote-change notice.
- [ ] Keep initial catch-up explicit. Cover an event between opening read and initial acknowledgement with a targeted catch-up where required; do not reintroduce a global account/identity burst. Record any intentionally retained extra catch-up request in the inventory.
- [ ] Run all `src/realtime` tests and Studio realtime tests; verify notification polling still stops only when live and resumes on failure.
- [ ] Commit: `fix: scope realtime recovery and coalesce read invalidation`.

## Task 5: Deduplicate tenant resolution and stabilize the shell

**Files:** Modify `features/tenants/use-current-tenant.ts` and `.test.ts`, `components/admin/user-menu.tsx`, `app-sidebar.tsx`, `appearance-preferences-sync.tsx`, `features/assistant/active-tenant-selector.tsx`, `features/studio/use-studio-sidebar-navigation.ts` and corresponding tests. Create `features/tenants/current-tenant-query.ts`.

**Consumes:** Tasks 2–4. **Produces:** `currentTenantQueryOptions({ apiClient: ApiClient, sessionGeneration: number, hostname: string })` with key resource `current-tenant`, host parameter, and the existing `/v1/tenants/current` response type. `useCurrentTenant` keeps its public `CurrentTenantInfo` contract and standalone-test behavior; app consumers share one read per host/session scope.

- [ ] Add failing tests: multiple simultaneous tenant consumers issue one read; same-scope shell rerender issues no read; hostname/principal switch rejects previous result; unavailable tenant identity keeps tenant reads disabled. Preserve platform tenant semantics and branded names.
- [ ] Replace per-consumer effect reads with the scoped shared query. Update standalone tests to provide the required query/service context or existing fallback explicitly; avoid conditional hook invocation.
- [ ] Narrow effect dependencies to actual clients. Keep sidebar, theme and identity visible while refreshed. Do not apply unchanged appearance preferences or replace navigation arrays unnecessarily.
- [ ] Test a profile update refreshes visible identity but retains selected route, sidebar state, focus and active editor. Test authorization change removes forbidden navigation. Verify no global cache invalidation for an ordinary cosmetic preference change.
- [ ] Run tenant, shell, appearance and Studio sidebar tests; commit `fix: deduplicate tenant reads and preserve the app shell`.

## Task 6: Migrate integrations, account and settings

**Files:** `features/personal-integrations/personal-integrations-page.tsx`, `virtual-employees-management.tsx`; `features/crm/crm-connections-page.tsx`; `features/whatsapp/*.tsx`; `features/account/account-page.tsx`; `features/assistant-configuration/assistant-configuration-page.tsx`; `features/tenant-branding/tenant-branding-page.tsx`; `features/service-credentials/studio-tenant-credentials-section.tsx`; tenant API-key/email/social/SSO/page-search panels and `features/office-settings/office-settings-panel.tsx`. Modify colocated tests and create small domain `queries.ts` modules only where manual loaders are migrated.

**Consumes:** Tasks 2–5. Domain keys use resource names `personal-integrations`, `crm-connections`, `whatsapp-connections`, `account`, `assistant-settings`, `virtual-employees`, and the actual settings resource name for each panel; parameters distinguish providers, collections and selected tenant. Do not collapse personal/global/tenant settings into one key.

- [ ] Reproduce the CRM-tab wrapper bug in the parent test: rerender or personal hint while CRM is open must not trigger CRM reads or replace its panel. Add background pending/success/error/empty-result and overlapping-read tests for integrations, CRM, clean assistant configuration and employee lists.
- [ ] Migrate manual read models to scoped queries; depend on concrete stable clients. Replace destructive `loading` branches with initial-only skeletons and retained background content. Distinguish unavailable initial provider catalog from a transient error after successful load.
- [ ] Preserve the merged WhatsApp regressions and behavior. Standardize its read policy without weakening edited-number retention, selected sections, action-feedback ordering or stale-tenant guards. No actual test message is sent.
- [ ] Preserve draft blockers in assistant configuration, branding and credential/settings editors. Clean forms adopt fresh values; dirty forms defer resets. Two simultaneous global/tenant assistant hints must not let older completion replace newer configuration.
- [ ] Add one common scenario to each migrated loader's tests: successful load → edit/select → pending refresh → transient error → retry → scope switch with old request pending. Assert DOM identity, draft value, current feedback and scope isolation. For secret-bearing panels assert no server secret becomes draft/cached diagnostic data.
- [ ] Run each affected feature suite; update ledger rows with evidence. Commit by domain (`fix: preserve integration views during refresh`, then settings/account equivalent).

## Task 7: Migrate My Day and collaboration views

**Files:** `features/my-day-widgets/` loaders/layout/widgets, `features/personal-integrations/my-day-page.tsx`, `features/notifications/queries.ts`, `admin-notice-status.tsx`, `features/bookings/booking-page.tsx`, `features/pages/use-pages-index.ts`, `client-cache.ts`, `pages-page.tsx`, `editor.tsx`, `features/office-suite/office-suite-page.tsx` and colocated tests.

- [ ] Add regression tests before edits: profile change preserves widget/editor state; principal replacement clears it; background refresh retains loaded widgets, Pages editor and Office document instance. Include an unavailable external provider and read failure without replacing last successful content.
- [ ] Migrate destructive loaders and reset listeners. Replace same-principal identity cache clearing with targeted refresh; move actual owner replacement cleanup to the Task 2 lifecycle. Preserve collection filters, pagination, calendar/mail selection and document dirty state.
- [ ] Retain existing layout guards while dragging, saving or configuring widgets. Preserve notification polling fallbacks and authorized recipient-only invalidation. Do not merge provider caches with different owners/tenants.
- [ ] Verify event scope: a calendar update does not reload unrelated mail/Office widgets; a Pages update refreshes its index/read model without resetting the open dirty editor; a deleted/revoked document stops protected editing visibly.
- [ ] Run domain suites, including mail refresh, calendar sources, Pages client-cache/editor, Office suite and notifications tests; update ledger and commit by domain.

## Task 8: Close Studio, records, ACL, workflows and plugin coverage

**Files:** `features/studio/studio-page.tsx`; `features/studio-engine/studio-realtime.tsx`, `studio-query-cache.ts`, `local-query-sync.ts`, `designer.tsx`, `record-history.tsx`, `record-history-settings.tsx`, `extension-connections.tsx`, `extension-manager.tsx`, `plugin-store.tsx`, `custom-plugin-frame.tsx`, `plugin-project-workspace.tsx`, `api.ts`, workflow and record views; `features/users/user-pages.tsx`, `features/tenants/index.tsx`, `features/access-control/`; their existing tests under `features/studio-engine/test/` and feature folders.

- [ ] Exercise existing safeguards before changing them: dirty designer/record/role/workflow inputs retain values; clean lists update in place; profile refresh does not dispose plugin sessions or reset record navigation cursors; logout/revocation does.
- [ ] Adapt realtime callback metadata and identity-reset listeners to Tasks 2/4. Preserve separate Studio QueryClients, schema revisions, offline synchronization and authoritative save/conflict handling. Do not rekey generated Studio/React Admin queries without migrating all consumers.
- [ ] Fix destructive clean-read presentation found in the Task 1 ledger. Preserve dirty editor instances and signal remote changes. Verify record deletion is represented as deletion rather than indefinitely retained stale data; permissions changes re-evaluate access.
- [ ] Test two tabs: update a temporary record/schema in one; verify the other updates clean read models, retains a dirty edit, and surfaces the conflict/reload path. Repeat after reconnect and tenant switch. Host plugin instance remains mounted for unrelated hints; its own internals remain an external boundary.
- [ ] Run Studio realtime/cache/local-query-sync/designer/workflow/plugin/record suites plus users/tenants/ACL suites; update ledger and commit reviewable domain changes.

## Task 9: Audit public routes, Companion and remaining boundaries

**Files:** `features/public-forms/`, `public-quotes/`, public Pages/Bookings routes, `tenant-registration/`, `features/companion/recordings-page.tsx`, `features/savia-request/savia-request-workspace.tsx`, `savia-request-provider.tsx`, `features/office/`; inspect `apps/companion/src/main.tsx`, `apps/companion-mobile/lib/`, and the UI/runtime entry points actually present in `apps/savia-request/`. Colocated tests remain owners of behavior.

- [ ] Complete every remaining ledger row. Search all frontend entry points for polling, effect-driven loading, navigation reloads and identity/lifecycle resets. Record no-UI server packages as boundaries rather than inventing React migrations.
- [ ] Test public share-token/resource changes: previous resource data is hidden; expired/revoked links stop access; background status updates retain form inputs where supported. Never cache/print raw share tokens in diagnostics.
- [ ] Verify Savia Request dirty/busy/submitting guards and collection-specific hints remain intact; read refresh cannot repeat request execution. Office/native capture/upload state survives unrelated app updates.
- [ ] Apply only evidenced fixes in Companion/mobile using their existing lifecycle/state tools. A recording or upload is never restarted by a refresh. Native/Flutter behavior gets its own test/browser/device evidence; React query helpers are not imposed on it.
- [ ] Run affected public, Savia Request and Companion tests; if a native device/platform is unavailable, mark its verification explicitly outstanding and keep that scope out of the completion claim.
- [ ] Commit domain changes or evidence-only compliant dispositions; no feature group remains unclassified.

## Task 10: Whole-app acceptance, documentation and delivery

**Files:** Update `docs/guides/app-refresh-inventory.md`, `docs/guides/realtime-coverage.md`, `docs/guides/authentication-loading.md`, `docs/README.md`; create `docs/guides/background-refresh.md`. Add cross-surface regressions to `apps/admin/src/app.test.tsx` and existing domain tests; keep browser fixtures temporary unless the repository has a suitable committed harness.

- [ ] Verify every spec requirement maps to a passing test or recorded browser check. Audit the final source for destructive background loading and broad reset/dependency patterns; classify every match instead of banning legitimate initial loading.
- [ ] Run targeted suites during each batch. At integration run `pnpm test`, `pnpm run typecheck`, changed-file Prettier checks and `git diff --check`. Run lint and distinguish documented pre-existing main failures from new failures. All required PR CI lanes must pass on the final head.
- [ ] Repeat Task 1 traces with the same routes and operations on desktop/mobile width. Confirm stable DOM/editor instances, focus/scroll/drafts and targeted read counts. Simulate slow reads, transient 500, offline/reconnect, two-tab updates, profile changes, real scope replacement and access denial using disposable fixtures.
- [ ] Assert controlled budgets: one in-flight request for identical consumers; no new request from five same-scope rerenders; one read per affected key for ten hints in 200 ms, with at most one follow-up when a hint overlaps an in-flight read. Exclude and document legitimate initial catch-up, explicit user retry, recovery and domain polling rather than requiring zero network traffic.
- [ ] Remove temporary diagnostics/fixtures or keep diagnostics development-only and payload-free. Update the guide with key/scope rules, initial versus background states, draft behavior, authorization exceptions and an example for new features. Link it from `docs/README.md`.
- [ ] Review combined changes. Create/attach PRs with exact validation and remaining platform limitations. Merge only the verified head after CI; confirm the exact `main` SHA is published by `deploy-preview.yml`, then run the preview navigation smoke before claiming preview is fixed.
- [ ] Commit: `docs: document stable background refresh and app-wide verification`.

## Completion checklist

- [ ] Shared causes fixed: session event semantics, current-tenant deduplication, realtime replacement/recovery distinction and precise invalidation.
- [ ] Every first-party feature group has a tested migration or evidence-backed compliant/boundary disposition.
- [ ] No protected data crosses principal/tenant/share/resource boundaries; no mutation is repeated by refresh.
- [ ] Loaded content and dirty inputs survive pending/success/temporary-failure refresh; true initial loads and authorization failures remain visible.
- [ ] Full CI and controlled desktop/mobile/two-tab acceptance pass; native evidence limitations are explicitly recorded.
- [ ] Documentation reflects final behavior and the deployed preview commit is verified.

## Execution recommendation

Implement shared Tasks 1–5 sequentially under Astra. Then delegate bounded, independent domain batches with at most two Luna workers and disjoint files while Astra handles integration. Keep this as one program until the completion checklist passes; landing shared infrastructure or CRM alone is not completion.
