# Reusable plugin editors and local-first records

Status: implemented and verified locally on October 1, 2026. Preview rollout is
pending. See the implementation plan for local acceptance evidence.

## Outcome

Opening New should display the prepared editor without downloading and starting
another plugin frame each time. Eligible record edits should complete after a
durable local transaction, then synchronize through Savia's existing outbox.
The UI must distinguish local acceptance from server confirmation.

The previous drawer refinement remains: a 640 px desktop drawer, full width on
mobile, fixed actions, accessible focus and unsaved-change confirmation.

## Current evidence

- `CustomPluginFrame` creates and removes a second iframe for every panel.
- The shell is authenticated and uncached; its entry has an expiring grant and
  is revalidated against the enabled installation. These checks remain intact.
- `studio-page.tsx` supplies local transport to native screens, but gives plugins
  the network transport. The workspace sync badge does not describe plugin writes.
- `createLocalTransport` already handles eligible records, durable local writes,
  hydration, schema validation and read-only/remote collection capabilities.
- Local storage is scoped by environment, identity, tenant/domain and permissions.
  Pending writes, conflicts and authorization failures already have a sync UI.
- Plugin collection helpers currently strip response metadata and return only
  the record, so they cannot distinguish local acceptance from a server receipt.
- Initial panel state uses `busy: true`, preventing cancellation during startup.

## Scope and implementation boundaries

### 1. Opt-in reusable editor lifecycle

The Workbench explicitly requests preparation of its record editor after the
owning list frame is ready. Preparation creates at most one standby editor iframe
per mounted plugin screen. It loads executable code and negotiates the bridge,
but does not render the list, execute record actions, load a record, or focus
anything while inactive. Preparation does not block the list.

The host keeps that iframe mounted in a stable container. Opening the drawer
reveals it and sends a validated activation context containing a fresh panel ID
and the existing record-editor request. Closing deactivates the editor and
unmounts its React subtree, while retaining the iframe and imported module.
The next activation mounts a fresh editor with fresh defaults or a fresh record.
No form values, pending operations or previous result may survive deactivation.

Reusable ports provide an explicit render cleanup contract. The shell invokes
cleanup exactly once before replacing the editor. Old ports without the
capability keep the current fresh-frame path. Generic plugins must not become
reusable merely because they happen to render a form.

The handshake, activation, ready, state and completion messages are validated by
source window, host session and activation ID. Pending API replies belong to the
activation that issued them. A reply from a cancelled activation cannot reach its
replacement. Nested panels and arbitrary frame URLs remain unsupported.

Parent navigation, identity/session changes, permission changes and installation
replacement dispose both frames and their channels. A prepared iframe exists
only in the current authorized page session; this is not persistent executable
storage and does not enable reopening the app offline before initial preparation.
A failed prewarm is recoverable when opening, with a bounded timeout and retry.

### 2. Cancel loading separately from cancelling a write

Represent startup separately from mutation busy state. Close and Escape may
cancel loading, immediately removing the visible panel and invalidating that
activation. Late ready messages or API replies are ignored. A save or remote
operation already in flight retains the existing busy protection. Dirty forms
retain discard confirmation.

The loading UI identifies preparation of the form and offers cancellation;
a timeout offers Retry. Focus moves into the editor only after activation and
returns to the opener on close. Standby frames are hidden from keyboard and
assistive technology. Reduced-motion preferences remain respected.

### 3. Explicit local-first record capability

Opt in the upgraded Workbench record API to local-first reads and eligible
create/update/delete operations. Do not replace the generic plugin network
transport globally: old plugins may interpret success as a backend commit.

The host validates the requested mode and route and delegates eligible work to
the selected workspace's existing local transport. Collection capability and
hydration are determined by the host and backend manifest, never by the plugin.
Read-only local collections remain read-only; remote collections retain network
semantics. An unhydrated collection offline reports unavailable preparation,
not an empty collection. No fallback may turn a server authorization rejection
into local access.

Use existing schema validation, stable record IDs, record versions, outbox
transactions, idempotent synchronization and conflict resolution. Do not add
Jotai, a second outbox, ad hoc localStorage, or new persistent database stores.
The explicit user request for offline-first authorizes the existing replica;
the server remains authoritative for accepted writes and permissions.

Files, credentials, integrations, bulk operations and provider actions remain
remote. Payment/financial actions that require a server-confirmed state retain
that behavior; supporting local record editing must not silently turn an
external or business action into an optimistic success.

### 4. Honest save results and reconciliation

Extend the opt-in record response contract to preserve persistence metadata:
local versus server, plus a stable mutation identity where available. Existing
collection methods remain compatible with older ports.

After a local transaction commits, show localized copy equivalent to
"Saved locally · Pending synchronization". The list refreshes from the local
replica immediately. Server acknowledgement, rejection and conflicts remain
visible through the existing synchronization UI; pending/error status must also
be discoverable from the plugin surface without implying server confirmation.

A local transaction failure keeps the editor open with its draft. A remote
write does not report success until confirmed. Reopening pending records uses
the local version and the established version/conflict semantics. A stale or
conflicting server response cannot erase newer local edits. Later synchronized
record changes refresh the mounted plugin list through a scoped notification,
without resetting its filters or scroll.

## Local acceptance tests (before preview deployment)

1. Opening, closing and reopening use the same prepared iframe and entry import;
   each activation has a new ID and a fresh editor. Measure first versus warm
   opening separately and report actual timings without promising a threshold.
2. The standby frame performs no record writes, list backfills or focus changes.
3. New followed by edit, and record A followed by record B, never reuse a draft.
4. Cancel startup while the shell or a record read is delayed. Late messages do
   not reopen the drawer or alter the next editor; retry remains usable.
5. Desktop and 390 x 844 checks: visible footer, drawer width, scrolling, focus,
   Escape, discard confirmation and reduced-motion behavior.
6. With a real local IndexedDB workspace and hydrated eligible collection,
   create/edit while transport is offline. Read the saved record and durable
   outbox, and confirm honest pending status. Reload retains the pending write.
7. Reconnect, synchronize once with the same receipt identity, verify the server
   record, cleared pending status and mounted-list refresh.
8. Force quota/local transaction failure, validation rejection, version conflict
   and delayed acknowledgement. Drafts and pending edits remain recoverable.
9. Switch tenant/account, revoke authorization, replace/disable an installation,
   and send stale or foreign-frame messages. No cross-scope data or active editor
   survives invalidation.
10. Old hosts/ports, remote collections, read-only collections, uploads and
    business actions retain their established behavior.

## Delivery

Implement and verify locally first, as requested. Document any test that cannot
be exercised. Do not claim a faster opening based only on fewer requests or a
changed loading message. Release versioned ZIPs and update active installations
only after local acceptance; preserve disabled and uninstalled optional plugins.
