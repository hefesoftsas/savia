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

Runtime settings to save in Savia:

```dotenv
NANGO_BASE_URL=https://nango.cloud.hefesoft.com
NANGO_CONNECT_URL=https://nango-connect.cloud.hefesoft.com
NANGO_SALESFORCE_INTEGRATION_ID=salesforce
NANGO_ZOHO_INTEGRATION_ID=zoho-crm
NANGO_PIPEDRIVE_INTEGRATION_ID=pipedrive
```

Keep the existing Nango prod API key in runtime secret storage, or configure the
actual prod key if missing. Coolify at `https://coolify.hefesoft.com/login` requires
login; the user was asked to sign in directly. Runtime settings, migration
preflight, deployment, and Savia identity/discovery/read/write verification remain
pending. Nango's dashboard Playground only offered deployed functions and showed
**No functions found** for Pipedrive; no API record calls were performed.

PR #162 remains open and draft. Its remote checks at the earlier inspection
included failures in admin unit shards 2/6 and 3/6, coverage admin-2/admin-3, and
the coverage merge. These failures were inventoried, not diagnosed or fixed during
external setup. No new local application tests were run for these UI changes.

## Goal and current status

The user wants working Salesforce, Zoho CRM, and Pipedrive integrations alongside
HubSpot, including the OAuth applications on the provider platforms, Nango
configuration, and real account verification. The user explicitly authorized
creating those applications. This task is **not complete**: the external OAuth apps and Nango integrations are configured and their OAuth
and token refresh flows passed as recorded above. Savia runtime configuration,
deployment, and real record verification remain pending. Nothing has been deployed
or merged.

The original cloud session was asked to open a PR and leave this handoff. The
local continuation was then authorized to configure the open platforms and email.
Continue on branch `codex/multi-crm-organization-policy` in `hefesoftsas/savia`;
the PR targets `main`: https://github.com/hefesoftsas/savia/pull/162 (draft).
Preserve its implementation instead of starting over. The branch incorporates
`main` through `da0d381`; the CRM migration was renumbered to `0028` because
`0027_booking_public_link_short_urls.sql` landed meanwhile.

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

Apply both dialects' `0028_crm_organization_connection.sql` before deploying the
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
- `packages/db/{migrations,postgres}/0028_crm_organization_connection.sql`.
- `docs/runbooks/connected-crm-workspace.md`: authoritative setup/runbook.
- `docs/superpowers/specs/2026-10-03-multi-crm-workspace-design.md` and matching plan.

Follow repository `AGENTS.md`: English code/docs/tests, targeted checks, at most
two workers with disjoint ownership, and preserve unrelated changes.
