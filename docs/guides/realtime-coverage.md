# Automatic refresh coverage

Last reviewed: 2026-10-08.

## Contract

Savia sends authenticated WebSocket change hints and reloads data through the normal authorized APIs. Messages never contain record bodies, credentials or notification contents. Platform administration uses the platform room; tenant data uses `tenant:<id>`; personal data uses a self-only `principal:<id>` room. Tenant 0 is the platform workspace, not a bypass for another tenant's authorization.

Components share a socket per room within each browser tab. Topic changes rebuild the subscription; reconnect acknowledgements refresh the subscribed read models to recover missed events. By default, the first connection acknowledgement does not refresh generic read models: each screen loads its data when opened. Cache-first consumers can opt into initial catch-up with `refreshOnInitialConnect`. Studio sidebar navigation uses it when local metadata caching is enabled, so cached objects and pages are replaced by an authoritative read after connecting. Real change hints and later reconnect acknowledgements still refresh them. This avoids a redundant account/identity refresh burst and loading flicker after opening a page. Studio workspace synchronization retains its separate connection catch-up behavior. Bursts are coalesced for 200 ms. The permanent “En vivo” badge has been removed. Absence of that badge does not disable automatic refresh.

Editable state is preserved: administrative drafts defer refresh and offer an explicit reload/discard action. Record edit dialogs keep their own unsaved inputs while read models update. Designer sessions keep their starting schema until explicitly reloaded; workflow and role editors retain their revision guards. Clean read models refresh automatically. A change hint does not grant permissions: every subsequent read/write is authorized on the server.

## Coverage

| Surface                       | Implemented behavior                                                                                                                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users and tenants             | Lists and open administrative forms subscribe to platform hints. User-list refresh bypasses the identity client's short cache. Dirty forms retain their values.                                                                                                               |
| Roles and assignments         | Tenant-scoped role catalog, effective permissions and audit invalidate on policy/assignment changes. Assignment drafts offer explicit reload; deleted or stale roles cannot silently become new roles.                                                                        |
| Studio records                | Tables, summaries, record detail, relations, activity, tasks and attachments refresh from scoped hints. Local workspace collections request synchronization and refresh auxiliary server read models.                                                                         |
| Studio metadata               | Object/schema, views, sources, relations, audit and navigation read models invalidate by topic family. Designer drafts remain stable while remote changes are signaled.                                                                                                       |
| Applications and plugins      | Tenant installation/enable state and extension/store panels refresh. Configuration/upload drafts are retained until explicit reload. Extension connection/run panels reload their read models.                                                                                |
| Workflows                     | Definitions, execution detail/history and inbox subscribe to tenant hints, including durable asynchronous execution transitions. Existing execution polling remains a fallback.                                                                                               |
| Notifications                 | Recipient-only delivery/read/follow hints refresh inbox and unread count. Inbox/count polling is disabled while their live connection is healthy. Administrative delivery-status hints target the author, separately from recipient hints; status polling remains a fallback. |
| Connections and Savia Request | Tenant connection/rule/run state and saved request flows refresh. Aggregate CRM administration additionally uses authorized tenant-0 hints. Personal connections/calendar actions use the principal room; fresh reads bypass the short connection cache.                      |
| Settings                      | Branding, service credentials, assistant configuration and AI employees subscribe to settings hints. Secrets are never included in events.                                                                                                                                    |
| Account and My Day            | Account identity, active tenant, appearance, sidebar preferences and widget layout refresh on personal hints. Collection widgets also subscribe to their own tenant's data/schema; plugin widgets refresh installation state.                                                 |

## Boundaries

- Direct writes to external databases, calendars, CRMs or provider systems cannot generate Savia hints unless a Savia ingestion path observes and persists them. Provider-specific synchronization schedules still determine when those changes become visible.
- A platform-wide marketplace release outside the tenant installation API does not fan out to every tenant's open catalog. Reopening/refreshing the catalog fetches those releases; tenant install/enable changes do propagate.
- Third-party plugin iframe internals control their own data subscriptions. Savia refreshes their installation/catalog state; arbitrary custom plugin UI is not automatically made realtime by this transport.
- When the WebSocket service is unavailable, existing screen-specific polling/manual refresh remains available. There is no global polling loop. Offline workspace synchronization has a separate lifecycle.
- Generic read models without initial catch-up rely on their opening read until subscription is established. A change between that read and the first acknowledgement can be missed until the next hint, manual refresh or reconnection; the transport has no replay cursor.
- Change hints are not a durable event stream. Reconnection performs an authoritative refresh; this is recovery of current state, not replay of every intermediate transition.

## Implementation references

- Shared transport and deferred refresh: `apps/admin/src/realtime/use-realtime.ts`, `use-realtime-refresh.tsx`.
- Studio mapping and reconnect recovery: `apps/admin/src/features/studio-engine/studio-realtime.tsx`.
- Backend authorization: `apps/api/src/realtime/protocol.ts`, `routes.ts`.
- Successful mutation classification: `apps/api/src/realtime/mutation-hints.ts`.
- Durable workflow and notification publishers: `packages/studio-server` processors and their API runtime callbacks.
- External data behavior: `docs/external-database-sources.md`.

## Verification

Automated tests cover topic authorization, principal/tenant isolation, no publication after failed writes, durable workflow/notification callbacks, shared socket routing, reconnect, burst coalescing, scope cancellation, cache bypass and draft preservation. Local browser checks use two authenticated tabs and temporary fixtures; no real user creation, invitations or provider messages are required. See the implementation plan for the completed verification record.
