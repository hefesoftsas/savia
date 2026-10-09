# Application refresh stability design

## Outcome and scope

Keep Savia usable and visually stable while authoritative data refreshes. Opening a route, receiving a realtime hint, recovering a network connection, or updating a profile must not unnecessarily reset unrelated screens. Preserve focus, scroll position, selected panels and unsaved inputs within the same authenticated scope.

This is a coordinated application-wide program. It covers every first-party admin feature, the app shell, embedded Studio, Pages, Office, Savia Request, public routes and the Companion entry points. Audit native/mobile lifecycle separately; do not impose React abstractions on Flutter. Third-party iframe internals are outside Savia's control, but Savia's host must preserve them during unrelated refreshes. Server authorization and existing offline behavior remain intact.

The deliverable requested here is a design and implementation plan. Runtime changes, deployment and provider side effects are not part of this planning turn.

## Evidence and limits

The latest supplied HAR recorded nine WhatsApp provider/connection pairs in roughly 32 seconds, five current-tenant reads and seven realtime ticket requests. It did not record a document reload. That evidence demonstrates redundant reads; it does not prove that every route remounts or identify every remaining trigger.

PRs #264 and #267 addressed unnecessary initial principal refresh, stable principal topic subscriptions, and WhatsApp wrapper-driven reloads/background remounts. The current source still contains:

- Independent `/v1/tenants/current` reads in each `useCurrentTenant` consumer.
- A `UserMenu` account refresh that emits both account and identity events; identity listeners clear caches or invalidate plugin state in many domains.
- CRM effects depending on a services wrapper created inline by Personal Integrations.
- Account, CRM and Personal Integrations loaders that enter blocking loading state for subsequent reads.
- Separate query clients for admin and Studio, and existing local synchronization, draft guards and cache lifecycles that must be respected.

A code inventory and controlled browser traces must classify remaining cases before migration. Unnecessary network reads, React rerenders, component remounts, theme application and full document reloads are different phenomena and require different evidence.

## Selected approach

Reuse TanStack Query and React Admin's existing caches for server read models. Establish common scope keys, read-state presentation and precise invalidation. Migrate manual loaders in domain batches. Keep specialized Studio/offline synchronization and live editors, adapting their refresh presentation and boundaries instead of replacing their engines.

A spinner-only patch would hide symptoms while retaining duplicate reads and draft resets. A new global fetching/cache framework would duplicate installed infrastructure and risk breaking specialized clients. The selected approach repairs the shared causes and standardizes their consumers with one coordinated acceptance gate.

## Required behavior

1. Initial loading may show a skeleton only when the current scope has no successful data. Background refresh keeps the mounted content and uses a small local activity indicator.
2. Empty successful results count as loaded data. A same-scope transient error retains the last successful read and offers retry. Initial errors show an error state, not a false empty success.
3. A principal/session, tenant, public-share token, record or schema change is a new scope. Previous-scope data must never appear as placeholder data. Logout, expired authorization, and revoked access remove protected content promptly; transient-error preservation does not override authorization.
4. Concurrent consumers of an identical read key share one in-flight request. Keys include authenticated owner/session generation, effective scope, resource and parameters. Credentials and share tokens are never embedded in diagnostic logs or exposed key labels; public tokens use an opaque per-route scope identifier.
5. Mutations remain explicit and execute once. Background refresh never sends a message, reconnects a provider, publishes a resource or repeats a mutation.
6. Realtime events invalidate only affected read models. Preserve the 200 ms burst window. Deliberate subscription replacement must not be confused with transport recovery. Genuine recovery refreshes current authorized models; first subscription catch-up is targeted and explicitly justified by cached data/opening-read races.
7. If an event arrives during an in-flight read, preserve at most one follow-up authoritative read for that key after the request settles. Do not lose the event by merely joining an older request, and do not start a request per hint.
8. Data updates never silently replace dirty form values. Clean forms may adopt new data. Dirty or submitting editors defer refresh/reset and expose the existing remote-change action. Record deletion and permissions revocation require explicit domain handling. Save/conflict checks remain authoritative.
9. New action results cannot be hidden by older background errors or late responses. Scope changes, disposal and later requests prevent stale commits; cancellation is propagated where supported and identity/generation guards remain where it is not.
10. Normal account/profile refresh differs from authenticated-principal replacement. Profile updates refetch identity display without clearing unrelated workspaces, editors or plugin sessions. Authorization changes still invalidate permissions and revoke affected views.
11. Reuse current freshness defaults: 30 seconds for admin queries, five-minute unused-query lifetime, no window-focus refetch, at most one automatic read retry, no mutation retry. Do not alter all query clients blindly; preserve justified domain policies, polling fallbacks and Studio behavior.
12. Backend remains the source of truth. Add only memory-scoped read caching and transient UI state; do not introduce browser persistence for records, secrets, tokens or drafts. Existing offline persistence is outside this refactor and must keep its current behavior.

## Architecture boundaries

- **Scope lifecycle:** one app-owned session generation, rotated on actual logout/principal replacement. Publish a dedicated principal-change event and migrate reset listeners; retain account/profile and permission events with distinct meanings.
- **Shared query policy:** one admin QueryClient policy factory; explicit key builder for new app queries. Keep React Admin key shapes and Studio's owner/tenant cache partitioning.
- **Read presentation:** a pure adapter derives `initial`, `ready`, `refreshing`, `refresh-error` or `initial-error` from query state and explicit scope readiness. It owns no fetching, persistence or form state.
- **Realtime bridge:** scope-aware query invalidation plus existing draft-deferred refresh. Connect metadata distinguishes subscription changes from actual recovery. No global polling loop or backend topic authorization expansion.
- **Domain read models:** small colocated query modules. Forms retain independent draft state. Remove manual loading flags only after query behavior and migration tests cover the domain.
- **Diagnostics and acceptance:** development/test traces record route, non-sensitive scope labels, read key labels, cause, request counts and mount counts. No production payload/HAR logging.

## Acceptance gate

- In controlled tests, two simultaneous identical read consumers issue one request; ten hints in one 200 ms burst issue one refresh per affected key, plus at most one necessary follow-up if a hint overlaps a read.
- Five ordinary rerenders with stable client/scope do not issue another read. Principal route-listener changes preserve the shared socket; tenant/platform topic replacement does not refresh unrelated models.
- A background read pending, succeeding or transiently failing leaves the same DOM/editor instance mounted, preserves draft values, focus, selection and scroll. Empty results behave the same way.
- Actual scope changes hide old data immediately. Late results cannot cross scopes. Access revocation and logout clear protected content and pending work.
- A new action result stays visible after an older background error settles.
- Browser traces cover desktop and mobile-width navigation, two authenticated tabs, reconnect, temporary server failure and session changes. Full reloads are attributed to navigation/PWA recovery explicitly.
- Every first-party feature group has a recorded disposition: migrated, already compliant with evidence, or an explicit external/runtime boundary with a validating test or browser check. No unexamined feature group qualifies as complete.
- All required CI lanes pass, documentation matches final behavior, and the exact merged commit is confirmed deployed before claiming preview is fixed.
