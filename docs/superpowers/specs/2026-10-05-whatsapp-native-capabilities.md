# Native WhatsApp capabilities

## Authorized outcome

Extend the direct WhatsApp assistant with native multiple-choice replies, lists,
Flows, media, location, catalog messages, approved templates and read/typing
indicators. Reuse the existing optional insurance solution for future light
vehicle quoting; never embed insurer integrations in platform core.

## Architecture

Tenant-owned native settings describe enabled features and approved resources.
The assistant may produce validated structured replies; resource references are
resolved by the server against that tenant configuration. Free text remains the
fallback. Button/list replies, Flow submissions, locations, orders and media
enter the same durable inbox as text. The processor stores structured input and
output, preserves per-contact history, rechecks access and the reply window,
and keeps uncertain outbound requests terminal.

All Graph operations use the existing tenant Nango connection. Credentials stay
in Nango. Media downloads use only Meta attachment hosts, no redirects, bounded
streams and hashes; private R2 storage never uses public customer URLs. Optional
image/document/audio understanding uses the tenant's AI configuration, preserving
model policies and avoiding administrative tools. Read/typing indicators are
best effort after authorized inbox claim.

Static published Flows collect form data and return completion through the
signed messages webhook. Published Flow IDs and initial screens are tenant
resources; interactive submissions remain untrusted input. Dynamic encrypted
Flow data exchange is a separate future integration, unnecessary for static
forms and not claimed by this change.

## Native resource configuration

Explicit tenant settings enable buttons/lists, incoming media understanding,
read receipts and typing. Resource catalogs contain named published Flows,
linked Meta catalog products, approved template names/languages, media references
and locations. The agent chooses resource keys; it cannot invent IDs, URLs or
operations. Admin APIs discover Meta Flows/templates and send native messages,
including approved template follow-ups when a free-form window is closed.
Configured resources require the appropriate Meta account assets/approvals;
missing resources are reported as unconfigured rather than silently mocked.

## Insurance boundary

Locate the trusted insurance quoting plugin and publish its WhatsApp intake
contribution through the release catalog. Include a reusable light-vehicle Flow
form and structured input validation. Receiving a questionnaire is not a quote:
real quote execution remains governed by the existing plugin's tenant installation,
provider credentials, settings and validated submission contracts. No live
insurer calls or policy issuance are performed during development.

## Verification

Test Graph payloads and bounds, allowlisted resource resolution, signed native
webhook ingestion, durable structured replies, tenant/contact isolation, media
host/size/hash handling, disabled features, stale configuration, and no blind
outbound retries. Use fake Graph/provider calls for delivery tests. Verify
TypeScript, migrations and public source safety; report live account artifacts
and deployment checks separately from code support.
