# Salesforce, Zoho CRM, and Pipedrive connected workspaces

Status: implemented and locally verified; live account activation pending Nango access and credentials.

## Outcome and scope

The user requested the missing CRM integrations and confirmed full integration,
including connected workspace screens alongside HubSpot. Add Salesforce, Zoho
CRM, and Pipedrive account connections and contact, company, and deal screens.
Users can browse, search, create, update, and navigate supported relationships
subject to the provider's effective permissions. Records remain in the CRM.

This scope does not imply copying HubSpot's twelve-object catalog to other
providers. Additional modules, bidirectional replication, scheduled sync, and
cross-provider deduplication are separate features. Existing HubSpot objects and
their behavior remain supported.

## Pre-implementation evidence

- `apps/api/src/external-crm/providers.ts` lists the three providers as
  `coming_soon` with no capabilities.
- `runtime.ts` creates only the HubSpot adapter. `nango.ts` requires a HubSpot
  integration ID for shared Nango operations and restricts proxy paths to HubSpot.
- `hubspot-workspace.ts` implements discovery, installation, schemas, remote
  operations, bindings, and authorization around HubSpot's APIs.
- `apps/api/src/routes/studio.ts` and `studio/collection-gateway.ts` restrict
  shared collection access to bindings with provider `hubspot`.
- `apps/api/src/auth/access-compatibility.ts` also has a HubSpot-only shared
  access query; it must use the same supported-provider and binding checks.
- Database provider constraints already include all four IDs and collection
  bindings are generic; adding these providers does not require enum expansion.
- Studio screen installation, origin links, relationship messages, and deletion
  labels contain HubSpot-specific assumptions.

## Alternatives and decision

1. **Recommended: provider adapters behind a common workspace contract.** Share
   authorization, installation, binding validation, auditing, and HTTP routing;
   isolate provider metadata, record operations, and relationship semantics.
   This requires deliberate contract changes but avoids three copies of the
   existing workspace and allows consistent security checks.
2. Clone the HubSpot workspace per provider. Faster initially, but duplicates
   access checks and creates four implementations to maintain.
3. Enable OAuth connections only. Smaller change, but does not deliver the
   confirmed requirement for usable CRM screens.

## Provider model

| Workspace resource | Salesforce  | Zoho CRM | Pipedrive     |
| ------------------ | ----------- | -------- | ------------- |
| Contacts           | Contact     | Contacts | Persons       |
| Companies          | Account     | Accounts | Organizations |
| Deals              | Opportunity | Deals    | Deals         |

Use a registered adapter per provider for account validation, resource discovery,
field metadata, list/search/get/create/update, permitted deletion, relation
discovery and changes, and validated origin links. Use native field identifiers
in remote record payloads and translate them to Studio field definitions.

Required fields, writable fields, enums, stages, owners, and relation targets
must reflect provider metadata. Account-specific requirements must be rendered
or return an explicit unsupported-configuration error before an invalid write.
Do not infer write permission merely from a successful list request or OAuth
scope: use provider permission metadata where available and retain upstream
authorization as the final check. Unknown capabilities remain disabled.

Deletion and relationship edits are exposed only when supported and verified.
The UI distinguishes archive from deletion using adapter metadata; it must never
call a destructive deletion an archive. Pagination uses provider cursors with
bounded traversal and explicit partial-result/limit errors where needed.

## Nango connections

Keep Nango as credential owner. Add independent integration configuration for
each provider and make base Nango operations independent of HubSpot configuration.
Create sessions restricted to the requested integration. Completion validates
the integration, connection ownership, provider account identity, and permissions.
Never accept a client-selected account URL or provider credential for proxying.

Each adapter owns an explicit method/path allowlist. Reject absolute URLs,
cross-provider paths, and malformed identifiers. Salesforce instance selection
and Zoho regional routing must follow trusted connection configuration supported
by Nango; verify those contracts against provider documentation before coding.
Handle token expiry, authorization failure, rate limits, and upstream errors
without leaking payloads or credentials. Do not blindly retry record creation.

## Workspace API and compatibility

Add provider-qualified discovery and installation routes under
`/api/crm-workspace/:provider` and `/api/crm-workspace/:provider/install`.
Keep existing unqualified routes and response shape as HubSpot compatibility
aliases. Existing collection record and relationship routes resolve the provider
from the server-owned binding, never from a client override.

Store new collections with distinct provider prefixes, such as
`salesforce_contacts`, `zoho_companies`, and `pipedrive_deals`.
Preserve `hubspot_*` names, existing bindings, customized labels, and personal
versus tenant sharing semantics. Reinstallation is idempotent and cannot replace
another account's collection. Uninstallation removes local screens and bindings,
not remote records. No blanket migration of personal bindings to tenant sharing.

Bindings retain provider, native resource, owner, connection ID, account ID, and
access scope. Every operation verifies active membership and the bound active
connection/account; tenant members can read shared collections and administrators
can manage them subject to provider permissions. A viewer's personal connection
must never redirect a shared collection. Audit the caller and operation without
recording credentials, searches, or remote record contents.

## User interface and MCP

Show each configured provider in Integrations, with clear missing-configuration,
connected, and reconnect-required states. Sources shows installable resources
per connected provider. Cache keys include provider identity. Screen actions,
relation messages, and origin links display the actual provider and capabilities.
Origin URLs use validated provider-specific hosts and account context.

Existing generic CRM MCP tools should resolve installed collection bindings and
use the same gateway checks. Extend provider assumptions wherever present;
do not add a parallel credential or authorization path. Regenerate API clients
from the API definition if their contract changes.

`apps/mcp/src/server.ts` already exposes provider-neutral Studio collection tools
with legacy CRM aliases. Keep those names and aliases. Discovery and installation
are workspace actions, not new MCP credential flows. Update generated workspace
operations in `apps/api/src/studio/dynamic-openapi.ts`, which currently advertises
`discover_hubspot_screens` and `install_hubspot_screens`, to describe the new
provider-qualified routes while retaining the legacy operations.

## Verification and acceptance

- Adapter contract tests cover field mapping, required values, search escaping,
  pagination, permission restrictions, relationships, account identity, and
  provider errors using representative provider responses.
- Nango tests cover independent provider configuration, allowed integration
  sessions, ownership checks, path/method restrictions, and rejected cross-provider
  requests. Include regression coverage for personal integrations sharing Nango.
- Workspace tests cover installation and reinstall, account changes, disconnection,
  tenant isolation, personal/shared bindings, read-only members, and schema guards.
- Admin tests cover resource selection per provider, provider-specific cache keys,
  installation status, reconnect states, correct deletion labels, and origin links.
- MCP tests exercise installed collections for all four providers through existing
  tools and verify rejection of unauthorized or uninstalled collections.
- Run relevant API, admin, MCP, and contract suites plus type checking. Existing
  HubSpot workspace/publication tests must continue to pass.
- Update the connected CRM workspace guide and configuration instructions in
  English. Generate API references rather than hand-writing them.

## Activation and evidence limits

The current managed environment reports no configured secrets or runtime
variables. Account connectivity cannot be verified from repository code alone.
Implementation can be validated locally with contract fixtures, but activation
requires Nango integrations and user OAuth grants for each actual account.

Before declaring a provider connected, verify discovery and reads against that
account. Live write checks use designated test records and require authorization
for that test account. Report code verification and live verification separately.
Do not mark providers connected, or claim live tests passed, based on mocks.

## Approved follow-up: organization exclusivity

The user clarified that only one CRM connection may be active per organization,
across all providers and users. A non-disconnected connection reserves the slot
until its owner explicitly disconnects it; there is no automatic provider switch.
Enforce this with organization-scoped API checks, a database unique index for
concurrent completions, scoped workspace lookups, and provider policy in the UI.
Independent organizations may use different CRMs or the same provider. Existing
multiple connections must be explicitly resolved before the migration can apply.
