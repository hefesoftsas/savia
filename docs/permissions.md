# Roles and permissions

Savia stores access roles, assignments, revisions and audit events in D1. The API authorizes every scoped request using the authenticated principal and current active membership. Browser controls and replicas never grant server access.

## Administration

Open **Roles and permissions** in the administration navigation. Select the workspace, create a role, choose its page and collection permissions, and save it. Use **Members** to assign one or several custom roles and inspect the server's effective grants. Disabling a role removes its effective grants; deleting it also removes its assignments.

Platform administrators can manage platform, independent-domain and commercial-tenant roles. Agency administrators can manage business roles only in their own active tenant. Custom role assignments do not create additional tenant memberships or grant global identity administration. Built-in roles are protected and preserve existing access.

Creating a tenant accepts either a new first administrator or an existing user. Membership is unique per user, so selecting an existing user transfers them out of their current organization instead of sharing the account. The transfer is rejected for the last active member of their organization and for platform administrators; revoke the global role first through user management.

Deleting a tenant removes its built-in and custom roles, cascading to grants and assignments. Audit events and the incremented policy revision remain. Recreating the same tenant ID seeds fresh built-in roles without restoring previous assignments or reusing an old policy revision. Migration `0057_access_tenant_lifecycle.sql` also removes policies orphaned by earlier tenant deletions.

Role names use lowercase letters, numbers, underscores and hyphens, starting with a letter. Display names are free text. Saving or assigning roles requires connectivity. A concurrent policy change returns 409 rather than overwriting another administrator's changes; reopen the saved role before retrying. The editor retains an unsuccessful draft.

## Permission semantics

Roles are additive. A custom role starts with no grants and does not subtract a built-in role's access. A field is exposed only by rules whose record predicates match that record; a matching broad rule cannot borrow fields from a different nonmatching rule.

Page reads control collection-page visibility and metadata access. Collection reads independently authorize data API access. To show a collection in the workspace, grant both its page and collection read permissions.

Native collections support read, create, update, delete, restore, import and export. Import additionally requires the corresponding create access; export intersects read and export permissions. Bulk operations authorize each requested record through the same services. Unsupported routes are denied, including schema changes and extension configuration by custom business roles. Automatic follow-up rules are not executed under custom scoped CRM policies.

Conditions can match all rows, rows created by the authenticated user, or scalar field comparisons combined with AND/OR. Creator identity is assigned on the server and cannot be overwritten by input. Rows that predate the creator migration have no known creator and do not match an own-record rule. String ordering uses binary UTF-8 comparison. Unknown resources, fields, unsupported actions and oversized predicates are rejected.

Reads apply predicates before pagination and counting. Queries involving hidden fields are rejected; with multiple conditional read grants, sorting/filtering/searching requires a field shared by all read grants. Writes reject unauthorized supplied fields rather than silently discarding them. File access requires access to its parent record and, when attached to a field, that field.

Remote adapters and generated request pages do not advertise custom fine-grained grants. Existing tenant-shared HubSpot reads remain available through their existing guarded adapter. Existing operational command, assistant/MCP, request-page and integration permissions retain their protected legacy boundaries; custom CRM roles do not authorize those operations or expand global administration.

## Synchronization and offline access

The manifest is scoped to the authenticated user, workspace and policy revision. Cursors cannot be reused with another user, scope or revision. A changed revision requires a fresh projection. Mutation submissions carry the revision acquired from the current manifest; acknowledged mutation retries recheck the current record, not only its historical receipt.

The server records which IDs it offered each principal and revision. When a row stops matching, it sends a removal only to a principal previously offered that row. Hidden record IDs are not broadcast as removals.

Online policy changes clear old replicas and cursors before further submissions. Pending work is quarantined rather than replayed automatically. Row removals and field redactions override optimistic local copies; quarantined snapshots cannot be restored through acknowledgements, conflict resolution or discard operations. Quarantined work is excluded from normal recovery previews and remains unavailable for automatic replay.

Offline revocation is bounded by the existing twelve-hour authenticated lease; it is not instantaneous on a disconnected device. A server authorization rejection blocks local access instead of falling back to an offline session. Revocation cannot undo data already seen or copied outside the application.

## Storage and rollout

Apply D1 migrations before serving the new application code:

- API database: `0055_access_control.sql` creates scoped roles, grants, assignments, revisions and audit; `0056_access_sync.sql` adds creator and synchronization delivery storage.
- Standalone CRM: `0016_access_sync.sql` adds the corresponding CRM storage. Scoped authorization also requires the API policy repository; standalone legacy usage does not enable custom roles by itself.

The migration runner can resume the known partial `0055_access_control.sql` deployment. It verifies the completed 22-statement prefix before skipping it, preserving role labels, grants, assignments and revision counters without replaying bootstrap permissions. Unexpected schema differences abort recovery. The final triggers use nested `IIF` expressions to avoid the remote D1 trigger parser confusing a `CASE` terminator with the trigger terminator.

Existing memberships receive protected role assignments. Membership changes and suspension invalidate revisions. Role/grant/assignment changes, audit writes and revision increments use a guarded D1 transaction. Stale writes fail instead of partially changing a policy.

Use the standard database backup procedure before deployment. Roll back application code only with a compatible schema; do not delete policy history or fabricate creator attribution. This implementation work does not deploy or modify production data.

Administration APIs are generated from OpenAPI route schemas; consult Scalar for request/response definitions. Audit history is retained in `access_audit` and available in the **Audit** tab.

## Permission change history

Select a workspace in **Roles and permissions**, then open **Audit**. Administrators can browse successful role saves, deletions and membership role assignments within their authorized scope. This is permission history, not a history of business-record changes or rejected requests.

Filter by action, actor ID, target ID and an inclusive date range. Dates entered in the browser use the local timezone. History loads 25 summaries per page, newest first, using a cursor rather than counting the entire history. **Refresh history** returns to the newest page. Open **View changes** to load the captured before/after values for one event; missing historical values are labeled **Not recorded**.

History requires connectivity. The API rechecks administrator access for both lists and details, binds cursors to their scope and filters, and disables HTTP caching. Changing scope or receiving an authorization rejection hides the prior history. Audit data is not persisted in the offline replica.
