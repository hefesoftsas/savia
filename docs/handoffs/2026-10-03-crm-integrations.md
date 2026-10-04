# CRM integrations handoff

## Local Chrome configuration continuation (October 3, 2026)

Computer Use confirmed access to the self-hosted Nango dashboard in the `prod`
environment. Its actual callback is
`https://nango.cloud.hefesoft.com/oauth/callback`. Before this continuation, prod
had ten integrations, including HubSpot with four connections, and no Salesforce,
Zoho CRM, or Pipedrive integration.

- Created the **Savia** server-based OAuth client in the Zoho API Console, with
  homepage `https://savia.app.hefesoft.com` and the callback above. Client ID:
  `1000.BR0FOST8V03L4UJKKP38KY07YT9KJT`. The authenticated account is in the US
  data center. Enabled sharing the same OAuth credentials across data centers;
  the optional additional regional clients were not enabled.
- Created Nango prod integration **`zoho-crm`** using the **Zoho CRM** provider
  template and the actual client credentials. The secret was transferred through
  the UI and is not recorded here. Configured twelve scopes: `ZohoCRM.org.READ`,
  `ZohoCRM.settings.fields.READ`, `ZohoCRM.settings.modules.READ`, plus
  `ZohoCRM.modules.{contacts,accounts,deals}.{READ,CREATE,UPDATE}` (all nine
  combinations). The saved settings page confirmed the ID, callback, client ID,
  masked secret, and all scopes.
- Activated Zoho CRM for the authenticated account. Its organization URL is
  `https://crm.zoho.com/crm/org941685251/tab/Home/begin`. Retried OAuth with
  extension `com`; Nango confirmed success and saved connection
  `60ebc477-9abb-4311-a456-59c88c07cc85`. The API domain is
  `https://www.zohoapis.com`. Manual token refresh returned **Secrets refreshed**.
- Created Salesforce **Savia** External Client App in
  `ruby-energy-36712.my.salesforce.com`, using Local distribution, the callback
  above, `api` and `refresh_token, offline_access`, authorization code flow, and
  required secrets for web and refresh flows. Salesforce mandates PKCE, refresh
  rotation, and a 30-day inactive refresh TTL in this org. Email identity
  verification passed. Local distribution limits this app to this org; packaged
  distribution for other customer orgs remains pending.
- Created Nango prod integration **`salesforce`**, with the actual app credentials
  and scopes `api` and `refresh_token`. OAuth succeeded; connection
  `ef2daa88-1c59-4eca-b80a-e623c7052f29` uses the org hostname/instance URL above.
  Manual token refresh returned **Secrets refreshed**. This is a 30-day Starter
  trial; API record access has not been tested.
- Created the free Pipedrive developer sandbox at
  `https://hefesoft-sandbox.pipedrive.com/developer-hub` using the existing signed-in
  account. Created private OAuth app **Savia**, client ID `6d83e069bcd338ce`, with
  the callback above. Enabled full Deals and Contacts access plus mandatory basic
  information. Changed the private app to live so other companies can authorize
  it through a direct installation link; it has no public Marketplace listing.
- Created Nango prod integration **`pipedrive`** with actual app credentials and
  scopes `base`, `contacts:full`, `deals:full`. OAuth installation succeeded in
  **Hefesoft - Sandbox**; connection `f4f966c9-0fb0-45ef-8bed-79e6f0631117` uses
  `https://hefesoft-sandbox.pipedrive.com`. Manual token refresh returned
  **Secrets refreshed**.

All three OAuth clients and Nango integrations are saved. Client secrets remain
in Nango and are not recorded in source. These are dashboard test connections
with end-user ID `test_unknown`; they are not organization-bound Savia
connections. Existing HubSpot integration and connections were preserved.

Runtime settings verified in Savia:

```dotenv
NANGO_BASE_URL=https://nango.cloud.hefesoft.com
NANGO_CONNECT_URL=https://nango-connect.cloud.hefesoft.com
NANGO_SALESFORCE_INTEGRATION_ID=salesforce
NANGO_ZOHO_INTEGRATION_ID=zoho-crm
NANGO_PIPEDRIVE_INTEGRATION_ID=pipedrive
```

### Cloudflare runtime continuation

Coolify login succeeded, but its Savia project contains only the landing and
Shlink. The Savia API runs on Cloudflare. Signed into the existing Cloudflare
account and verified **savia-agencies** (production) and
**savia-agencies-preview** (preview application). Both already had the correct
Nango base/connect URLs, encrypted `NANGO_API_KEY`, and independent HubSpot ID.
Preserved those values and all other settings.

Added the three exact CRM integration IDs above to each API Worker's Production
runtime through **Add 3 variables and deploy**. The saved variable tables confirmed
all three names and values in both Workers. This deployed configuration changes
on their existing code; it did not deploy the CRM branch or apply migrations.
The deployment config renderer uses `keep_vars: true`, retaining dashboard vars
on subsequent Wrangler deployments unless explicitly overridden.

Opened a separate Savia preview tab to preserve the user's existing booking draft.
The authenticated CRM tab still shows Salesforce, Zoho CRM, and Pipedrive as
**Disponible próximamente**, with disabled connect buttons. Therefore no Savia
organization-bound OAuth connection, identity/discovery/record read, or test write
has been verified. Nango's Playground only offered deployed functions and showed
**No functions found** for Pipedrive; no API record calls were performed.

PR #162 remains open and draft. GitHub now reports `mergeStateStatus: DIRTY`
(conflicts with current main); the latest documentation head has no check results.
The earlier head had failures in admin unit shards 2/6 and 3/6 and related coverage.
Resolve conflicts and CI, run migration preflight, then deploy/promote the tested
code before verifying the new CRM flows from Savia. No application code was
changed, merged, or deployed in this UI configuration continuation. No new local
application tests were run; `git diff --check` passed for the handoff update.

## Conflict resolution and rollout preflight (2026-10-04)

Merged current main (`efa2ff99`) into the CRM branch. The only Git conflict was
in the PostgreSQL manifest. Booking migrations `0028` and `0029` are retained;
the CRM uniqueness migration is now `0030` in both dialects. The manifest retains
its CRM index inventory and matching unique-key metadata.

Local verification: 98 CRM API tests, 16 CRM admin tests, 22 personal-integration
and calendar tests, and 88 self-hosted tests passed. Self-hosted skipped 54 tests
requiring optional/live services. API, admin, MCP and self-hosted type checks
passed. The prior CI personal-integrations failure was a stale mock expectation:
CRM requests now pass an optional tenant argument; the test now checks
`undefined` in the unscoped fixture. The previous calendar failure no longer
reproduces after merging current main.

The preview D1 duplicate preflight found one affected tenant (`0`): two connected
HubSpot rows created on September 17. There are no shared Nango references.
The owner must choose which connection to retain before applying `0030`:

- Nango `af1cce6a-b96f-41fd-8747-19706effb59a`, Savia row
  `d33eb745-1823-46da-93b8-7e4b9ca79222`, created `05:21:11.187Z`.
- Nango `47f3daf5-cdc3-4312-9b68-2f5c752d949a`, Savia row
  `85cbd113-82c6-4bee-8668-43c38f587226`, created `23:34:42.792Z`.

No CRM row or provider credential has been deleted, disconnected, or selected
automatically. Production preflight and deployment remain pending.

## Live rollout continuation (2026-10-04)

PR #162 was squash-merged as `ac8a9278` after CI and coverage passed. Preview
was deployed successfully, including migration `0030`. The owner selected the
latest tenant-0 HubSpot connection; the older preview row was soft-disconnected
and audited. Duplicate preflight is now clear in preview and production. The
older Nango credential remains because production still references it.

The existing Nango prod key named **Savia production backend** was verified with
successful Connect Session requests for all three new providers and saved as the
GitHub `NANGO_API_KEY` environment secret in both preview and production. The
previous runtime key belonged to an environment without the new integrations.
Preview OAuth dialogs now open for Salesforce, Zoho CRM, and Pipedrive.

The owner connected Zoho and subsequently Pipedrive in preview tenant 7. Live
metadata and record reads exposed three application defects, addressed in the rollout follow-up:

- Optional native picklists above 200 active choices aborted the entire catalog.
  Zoho countries have 248 choices and states have 3,937; Salesforce state
  picklists also exceed the limit. These fields remain visible as read-only text
  without truncated choices, while supported fields remain editable. Required
  oversized picklists still reject unsupported screen installation.
- OAuth completion discarded Nango's granted scopes before native account
  validation. Pipedrive therefore saved an empty scope list, making all three
  catalog entries unavailable. Completion now passes the newly granted scopes
  into validation, including replacement of stale grants on reconnection.
- Pipedrive empty list responses use `success: true`, `data: null`, and terminal
  pagination. Savia must accept that explicit empty-page envelope while rejecting
  missing data or null data with nonterminal pagination.

Read-only verification of the updated native adapters passed all nine catalog
and record-list combinations against real Nango connections. Each sandbox list
was empty; no records were created or modified.

Production promotion remains pending until the follow-up passes CI and preview
verification. Previously created dashboard test connections can verify native
metadata through read-only Nango proxy requests without altering tenant bindings.

## Goal and current status

The OAuth applications and Nango integrations are configured. The CRM branch is
merged, migration preflight conflicts are resolved, and preview has the new CRM
code and corrected Nango runtime key. Live catalog defects are being fixed before
production promotion. Final verification must cover the connected account's
catalog after deployment; an existing Pipedrive row saved by the earlier build
needs reconnection to persist its granted scopes. No CRM business records have
been written during this continuation.

The original continuation branch and PR #162 are historical references. Continue
follow-up fixes from current `main`, preserving the one-CRM-per-organization policy
and provider credentials already configured above.

## Confirmed product rule

Only **one active CRM connection per organization**, across providers and owners.
An existing connection must be explicitly disconnected before switching CRM.
Pending, failed, and reconnect-required connections continue to reserve the slot.
Different organizations remain independent. Existing connection ownership and
permissions are preserved; this rule does not grant other members authority to
revoke the owner's OAuth connection.

## Implemented

- Independent Nango configuration and native adapters for Salesforce
  Contact/Account/Opportunity, Zoho Contacts/Accounts/Deals, and Pipedrive
  Persons/Organizations/Deals.
- Provider-aware workspace discovery, installation, record reads/search/create/
  update, supported relationships, origin links, and field metadata mapping.
- HubSpot compatibility, tenant/account-bound collection access, safe errors,
  permission checks, and MCP coverage through the existing generic Studio tools.
- Tenant-scoped CRM screens and API calls, provider blocking explanations,
  explicit disconnect for recovery/pending states, and protection against stale
  responses or OAuth completion after the selected organization changes.
- API conflict checks and database uniqueness across owners/providers, plus
  protection against reusing one Nango credential reference across organizations.
- Deployment configuration, migration preflight, and limitations in
  `docs/runbooks/connected-crm-workspace.md`.

## Migration and operational cautions

Apply both dialects' `0030_crm_organization_connection.sql` before deploying the
new application. It adds partial unique indexes for the organization and the
Nango integration/connection pair where `disconnected_at IS NULL`. It intentionally
fails on existing duplicates without deleting rows or choosing an account. Run
both preflight queries in the connected-workspace runbook and have the owners
explicitly resolve conflicts before rollout. Check for migration-number collisions
if `main` has advanced; update the PostgreSQL manifest/checksum if renumbering.

No new-provider remote deletion, bulk import/export, or schema editing is enabled.
Zoho screens include up to 50 fields, retaining title and required fields and
reporting omitted optional fields. Pipedrive metadata spanning multiple pages is
explicitly rejected; search hits require extra requests to hydrate full records.
These limitations are documented and must not be presented as unlimited support.

## Historical cloud access blocker (resolved by local Chrome)

User-supplied Nango dashboard:
`https://nango.cloud.hefesoft.com/prod/integrations`

The API origin is `https://nango.cloud.hefesoft.com`, without the dashboard path.
The managed cloud environment reported restricted outbound networking, only the
package-manager preset, no custom allowed hosts, and no configured secrets or
runtime variables. An HTTP HEAD request failed at the outbound proxy with
`CONNECT tunnel failed, response 403`; this was not an authenticated Nango response.

During the original cloud session, the user said a Chrome plugin had access to
Nango. That session's available tools
contained no Chrome/browser automation connection. Plugin discovery did not find
that Chrome plugin. This local continuation has Computer Use and successfully
used the authenticated Chrome sessions; that blocker no longer applies. Do not assume another browser service can access the
user's existing authenticated Chrome session. Do not bypass the network policy,
extract browser cookies, or ask for passwords/client secrets in chat.

## Next actions in the continuation chat

1. Read this handoff and the linked runbook; inspect the PR and its CI status.
2. Discover the user's Chrome/browser plugin tools and confirm access to the
   intended Nango production environment and provider developer/admin consoles.
   The user has already authorized application creation; ask only for missing
   access, required account choices, or interactive authentication/MFA steps.
3. Inventory existing applications and integrations to avoid duplicates. Establish
   the intended provider accounts, actual Nango callback URI, integration keys,
   Zoho data-center region, Salesforce environment, and app metadata. Use the
   callback displayed by this Nango deployment, not a guessed callback URL.
4. Create/configure the Salesforce OAuth app, Zoho server-based OAuth client,
   and Pipedrive developer app using each platform's supported current flow.
   Verify the minimum scopes needed by the implemented reads/writes, metadata,
   identity validation, and refresh access. Record actual IDs/scopes, never secrets.
5. Store each client ID/secret in Nango securely, using the correct provider
   template and routing configuration. Configure the API/self-hosted runtime:
   `NANGO_BASE_URL`, `NANGO_API_KEY`, and exact
   `NANGO_SALESFORCE_INTEGRATION_ID`, `NANGO_ZOHO_INTEGRATION_ID`,
   `NANGO_PIPEDRIVE_INTEGRATION_ID`; retain independent HubSpot configuration.
   `NANGO_CONNECT_URL` is optional. Keep secrets out of source, PRs, and chat.
6. Resolve migration preflight conflicts, deploy, and perform live OAuth,
   identity, discovery, and read checks. Exercise writes only against designated
   authorized test records. Use different test organizations for each provider,
   or disconnect between providers: do not violate the one-CRM-per-org rule and
   do not disconnect an existing production CRM just to run these checks.
7. Record separately what was created, configured, deployed, and verified for
   each provider. Report any provider approval/verification requirement as pending.
   Do not equate a passing fixture test with a connected production account.

## Verification evidence

All checks below ran locally before the PR; they do not verify real OAuth grants.

- Initial multi-CRM implementation: 107 API tests, 63 admin workspace tests,
  16 MCP tests, and 1 self-hosted application test passed.
- Final organization-policy integration: 92 API tests passed across 9 suites,
  including real D1 uniqueness, concurrent completion, existing-duplicate
  migration failure without deletion, cross-tenant bindings, and HubSpot regressions.
- Final admin CRM page/client: 16 tests passed, including delayed responses and
  OAuth completion across a tenant switch.
- Self-hosted/application/migration-manifest: 3 tests passed; 11 live PostgreSQL
  tests skipped because no test PostgreSQL database was available.
- `tsc --noEmit` passed for API, admin, MCP, and self-hosted. Changed-file
  Prettier and `git diff --check` passed. The full monorepo suite was not run.
- Independent reviews found issues in native mappings, privacy, concurrency,
  Nango credential reuse, and stale UI state; these were fixed with regressions.

The earlier 107-test and final 92-test API selections overlap; do not add them
as distinct test counts. Temporary logs in `/tmp` may not survive a new workspace.

## PR preparation checks after merging current main

The three merge conflicts were resolved while preserving responsive action
styling, self-hosted search settings, and both migration manifest entries.
Post-merge checks passed: 51 affected API tests, 16 admin CRM tests, and 3
self-hosted/manifest tests. Twelve live PostgreSQL/search-dependent tests were
skipped in this environment. Type checks passed for API, admin, MCP, and
self-hosted. These selections overlap with the earlier verification counts.

## Key files

- `apps/api/src/external-crm/workspace-adapter.ts`: native provider API behavior.
- `apps/api/src/external-crm/remote-workspace.ts`: new-provider workspace routing.
- `apps/api/src/external-crm/studio-workspace-adapter.ts`: native field aliases.
- `apps/api/src/external-crm/{nango,runtime,providers,repository}.ts`.
- `apps/api/src/routes/crm.ts`: tenant-scoped connection lifecycle and conflicts.
- `apps/admin/src/features/crm/crm-connections-page.tsx`: connection UI.
- `apps/api/test/crm-organization-policy.test.ts`: persistence and route regressions.
- `packages/db/{migrations,postgres}/0030_crm_organization_connection.sql`.
- `docs/runbooks/connected-crm-workspace.md`: authoritative setup/runbook.
- `docs/superpowers/specs/2026-10-03-multi-crm-workspace-design.md` and matching plan.

Follow repository `AGENTS.md`: English code/docs/tests, targeted checks, at most
two workers with disjoint ownership, and preserve unrelated changes.
