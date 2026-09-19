# Configurable access control for Savia

Status: proposed design for user review; implementation has not started.
Date: 2026-09-19.

## Intent and confirmed scope

The user requested a permissions system similar to NocoBase and confirmed that both platform administrators and agency administrators should manage roles. Agency administration must remain limited to the agency's own space. Success means an administrator can configure and assign roles without changing code, while the API enforces the same restrictions advertised by the interface.

The remaining choices below are recommendations for review, not previously approved requirements.

## Current system

- `apps/api/src/auth/access-policy.ts` defines fixed tenant/agency administrator, operator and viewer capabilities.
- `identity_tenant_membership` has a unique principal constraint and one legacy role field. Multiple roles must not introduce multiple tenant memberships.
- `identity_global_role` contains the protected platform administrator role.
- `apps/api/src/routes/data-domains.ts` currently restricts independent domains to platform administrators.
- `apps/api/src/routes/dynamic-crm.ts` gates managers and shared read-only collections before forwarding requests to the CRM.
- `apps/api/src/crm/collection-gateway.ts` supplies actor identity and extension administration checks to the CRM server.
- `apps/admin/src/auth/react-admin-auth-provider.ts` contains role-name checks and a permissive fallback for other resources.
- `docs/local-first-collections.md` describes offline replicas and a twelve-hour permission lease. Server-side revocation cannot immediately erase data from a disconnected device.

## Approaches considered

1. Extend the fixed capability map: small change, but does not deliver configurable collection, row or field permissions.
2. Add a persisted policy model and shared server evaluator: recommended; fits Savia's tenancy, dynamic collections and current authentication.
3. Reproduce NocoBase's complete ACL framework and role switching: larger surface and migration cost; unnecessary for the first release.

## Administration boundaries

Platform administrators retain their protected recovery role and manage global policy, independent domains and agency policy. Agency administrators can create, edit and assign business roles only within their current active commercial membership. They can assign roles only to active members of that agency; granting roles never changes membership or transfers users.

Agency role administration is not global identity administration: credentials, platform roles and tenant transfers remain platform-only. Agency administrators cannot grant access to independent or platform domains, global configuration, credentials belonging to another scope, or identity management. Existing last-platform-administrator and tenant membership invariants remain enforced.

Agency business roles may include approved agency-level capabilities, including local studio configuration, but cannot confer the protected agency-administrator status itself. Only platform administrators change that status in this release. This keeps delegation bounded and prevents administrators from accidentally removing the agency's administrative recovery path.

## Policy model

Add logical entities for roles, role assignments, grants, policy revisions and audit events. All are persisted in D1. Exact migration numbers must be allocated at implementation time because the worktree contains other work.

- Role: stable ID, scope kind and scope ID, unique name within scope, label, description, protected flag, enabled flag and revision.
- Assignment: principal, role and scope; unique per principal/role. Agency assignments require a matching active membership. Global assignments are platform-managed and do not bypass tenant isolation.
- Grant: role, stable resource identifier, action, row predicate and allowed field identifiers. Resources cover pages, collections and registered administrative/extension capabilities.
- Policy revision: monotonic per affected scope, incremented atomically with policy or assignment changes.
- Audit event: actor, scope, operation, target, timestamp and sanitized before/after policy. Never store credentials or business-record contents in policy audit events.

Protected roles provide migration compatibility. Custom roles default to no grants. New collections and pages receive no custom-role access until configured. Display names are not authorization identifiers.

## Evaluation semantics

First validate authentication, active principal/membership, tenant/domain boundary and resource existence. Then resolve enabled assignments in that scope. An unknown resource, action, field or unsupported predicate is rejected rather than silently allowed.

For the first release, use simultaneous additive roles with no role-switching UI and no explicit deny rules. An unchecked action means no grant from that role. A permission preview must identify other roles that still grant the action.

Keep row predicates and field grants together: the fields available on a record are the union of fields from grants whose predicates match that record. Do not independently union all rows and all fields. This is an intentional difference from NocoBase's documented union behavior.

Supported row scopes are all records within the authorized scope, records created by the current principal, and validated custom filters. Own records means creator, not owner/assignee. Assignment-based access uses an explicit custom filter. Collections without trustworthy creator metadata cannot offer the own-records shortcut. A limited typed predicate language supports AND/OR, equality, membership and ordered comparisons for compatible scalar fields, plus server-bound current-principal and current-tenant variables. No arbitrary SQL or JavaScript is accepted.

Create checks the proposed record and allowed input fields; the server supplies protected identity and tenant metadata. Update checks the existing record and requires an applicable grant to authorize the modified fields and resulting record. Delete checks the existing record. Unauthorized write fields cause a validation/authorization error rather than silent dropping. Field removal must occur before serialization, including nested relationships.

Lists, counts, search, sorting, aggregates and exports must use authorized rows and permitted fields. Hidden fields cannot be used as a query side channel. Related records require authorization against their target collection. Adapters that cannot enforce the requested policy must reject that operation.

## Enforcement architecture

Introduce a pure evaluator/compiler with no UI dependency, a D1 policy repository and a request authorization context derived from the authenticated actor. Client-supplied principal IDs, tenant keys or permission snapshots never authorize operations.

Apply policy at the collection service/gateway boundary and the CRM mutation/query implementations, not only in HTTP navigation guards. Inventory and cover records, published aliases, managed collections, external adapters, relationships, file access, import/export, bulk actions, extension actions, API commands and local-sync endpoints. Interactive integrations act with the initiating principal's current permissions; asynchronous executions revalidate at execution time. Existing privileged system jobs require an explicit server-only scope and must never infer privilege from missing actor context.

Existing anonymous public-form authorization stays a separate explicit capability path. It cannot inherit agency or platform administrator permissions. Work on public forms already present in this worktree must not be overwritten.

Protected platform administrators retain existing legitimate access; internal safety constraints and supported-operation checks still apply. Replace legacy role checks in each migrated path rather than layering an allow fallback behind the new engine. Regenerate OpenAPI/Scalar contracts from route schemas.

## Administration interface

Provide Roles and permissions within the active administration scope. The role editor contains General, Pages, Data, Administration and Members sections. Data shows a collection/action matrix with row-scope and field editors. The user view supports multiple business-role assignments in the existing membership.

A server-calculated effective-permissions preview explains which role grants an operation; it does not impersonate the selected user or execute business actions. Saves use optimistic concurrency and explain conflicts. Protected roles and forbidden administrative capabilities are visibly read-only. Role/assignment editing requires connectivity.

## Offline and revocation

Policy definitions and decisions remain backend-authoritative. Reuse the existing offline mechanism rather than introducing a second browser policy store. Bind permission snapshots, sync cursors and leases to the principal, membership, domain and policy revision. An online operation resolves current server permissions, not merely a twelve-hour-old snapshot.

On revision mismatch, stop sync, hide stale replicas, reacquire permissions and reset affected records/fields before resuming. Queued writes are reauthorized with current rules; denied work cannot be replayed through an older endpoint or client version. Pending work may be retained in inaccessible recovery storage under the existing session protections, but revoked data must not remain visible or exportable through the app.

Row-predicate membership can change without a policy edit. Replication must emit removals or force a reset when a previously visible row no longer matches; omission from a delta response is insufficient. Field reductions also require replacement/redaction, not a merge that leaves old values behind.

Disconnected devices keep the existing bounded lease limitation: revocation is enforced when connectivity returns or the lease expires. This release does not claim immediate offline revocation.

## Compatibility and migration

Create additive schema migrations and seed protected compatibility roles from existing effective access. Preserve membership uniqueness and global administrator records. Before activation, capture representative authorization decisions for every existing role/path, including shared CRM collections; compare them with the new evaluator. Do not infer parity from the fixed capability map alone.

Activate enforcement only after API paths, adapters and sync behavior are covered. Unsupported fine-grained adapter actions remain unavailable in the role editor. Do not expose a selectable capability that the backend cannot enforce. Policy and assignment writes use atomic D1 batches, scoped constraints and revision checks. Concurrent cross-scope assignments and stale edits must fail.

Once custom policies are active, rolling back to a permissive legacy authorization implementation is unsafe. Keep the enforcing backend during UI rollback; database backups alone are not an authorization rollback strategy.

## Verification and acceptance

- Existing roles retain their documented access in migration parity tests.
- An agency administrator creates a role and assigns it to a member without editing code.
- Cross-agency role edits, assignments and data access fail even with manually crafted requests.
- Platform administration cannot be granted by an agency business role.
- A user with multiple roles receives only applicable row/field grants, without cross-product expansion.
- Read, create, update, delete, relationships, file access, counts, exports and bulk operations enforce the same policy through every supported entry point.
- A revoked assignment blocks the next online operation; stale cursors reset and revoked rows/fields disappear from the application.
- Concurrent saves reject stale revisions; policy audit records commit with the changes.
- Direct API tests exercise denial independently of hidden UI elements; editor tests cover persistence and effective-permissions explanations.
- Run focused API/admin/CRM package tests, contract generation checks and repository typecheck. Report pre-existing failures separately. Update the permissions guide, domain-studio guide and offline guide in English.

## Implementation sequence after design approval

1. Inventory entry points and capture legacy parity cases; define shared policy contracts and evaluator.
2. Add persistence, migration, scoped policy administration APIs and auditing.
3. Enforce at API/CRM boundaries and adapters, including replication and queued mutations.
4. Build the administration UI and effective-permissions view; migrate frontend checks.
5. Verify end-to-end denial, compatibility and revocation; document rollout.

This is a design sequence, not the detailed implementation plan. No deployment is requested by this document.

## References

- https://docs.nocobase.com/users-permissions/acl/permissions
- https://docs.nocobase.com/users-permissions/acl/union
- https://docs.nocobase.com/security/guide
- https://docs.nocobase.com/users-permissions/acl/ui
