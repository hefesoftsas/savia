# Stable background refresh

Savia distinguishes initial loading from refreshing a read model that is already visible. Use an initial skeleton only when the current authorized scope has no successful data. Successful empty results are loaded data. Retain mounted content while a same-scope read is pending or fails transiently; show localized `ReadRefreshStatus` near that content and allow retry.

## Scope and cache ownership

Admin server reads use the existing memory-only TanStack Query client. `createAdminQueryClient` preserves a 30-second freshness window, five-minute unused-query lifetime, no window-focus refetch, at most one read retry and no mutation retry. React Admin and Studio retain their established query keys and specialized lifecycle.

New domain queries use `readKey` with session generation, principal/tenant/platform/public scope, resource and parameters. Never use previous-scope data as placeholder when a tenant, authenticated principal, record or public link changes. Keep raw tokens and credentials out of keys, logs and status copy. Public routes use opaque identifiers.

`useCurrentTenant` shares one read per authenticated generation and hostname and forwards cancellation to the API. Normal app consumers share the app's QueryClient; standalone consumers have an in-memory client partitioned by API client.

A same-principal account/profile change emits `savia:identity-changed` for identity display and `savia:account-changed` for preferences. It does not dispose unrelated editors or caches. Actual principal replacement or logout rotates the session generation and emits `savia:principal-changed`. Logout retains `savia:session-cleared` cleanup. Protected queries, old sockets and previous-owner permissions cannot survive owner replacement. Offline fallbacks must never reuse a different principal's permissions.

## Realtime read policy

Connection callbacks distinguish `initial`, `subscription-change` and `recovered`. Deliberately changing a room's topic set does not require all existing read models to reload. Surviving listeners recovering after a real connection loss catch up; cached opening reads can explicitly request initial catch-up. The principal room subscribes to its authorized personal topic set once and filters events per listener.

`useRealtimeQuery` invalidates exact scope-aware keys. Its scheduler coalesces hints for 200 ms across consumers of a QueryClient/key. A hint received during an active read waits for that read to finish and makes one authoritative follow-up, rather than joining an opening read that might predate the change. Removed/inactive views do not start additional reads. Specialized manual loaders can retain `useRealtimeRefresh`, which serializes same-scope refreshes and defers dirty drafts.

Use domain-specific invalidation. Account hints invalidate permissions and identity display without invalidating every auth/session check. Realtime refresh only reads state; it must never send provider messages, authorize a connection, publish resources or repeat a mutation.

## Editing and failure handling

Keep draft state independent of server read models. Clean forms may adopt fresh values. Dirty/submitting forms defer refresh/reset and surface the existing remote-change notice. Revision conflicts, deleted records and revoked permissions retain explicit domain handling.

Transient errors preserve the last successful data. Initial errors show a load error rather than a false empty success. A 401/403 or logout removes protected content; background error retention never overrides access checks. Scope/request generation guards prevent late completions from committing into a newer scope. A later action result takes precedence over older background errors.

## Verification and rollout

For each domain verify loaded → pending → success/error → retry, empty success, draft/focus/DOM identity preservation, scope change with an old request pending, and current action feedback. Shared tests also cover duplicate consumers, hint bursts, in-flight follow-up, actual recovery and principal replacement.

The migration is tracked in [the coverage inventory](app-refresh-inventory.md) and [the implementation plan](../superpowers/plans/2026-10-08-app-refresh-stability.md). An inventoried candidate is not yet verified compliant; the final gate includes all first-party feature groups, desktop/mobile-width browser checks, full CI and the exact deployed preview commit.
