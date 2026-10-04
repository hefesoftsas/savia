# CRM integrations handoff

## Goal and current status

The user wants working Salesforce, Zoho CRM, and Pipedrive integrations alongside
HubSpot, including the OAuth applications on the provider platforms, Nango
configuration, and real account verification. The user explicitly authorized
creating those applications. This task is **not complete**: code and local tests
are ready, but no external OAuth application or Nango integration has been
created or verified in this session. Nothing has been deployed or merged.

The latest instruction was to open a PR and leave this handoff for another chat.
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

## External access blocker (verified)

User-supplied Nango dashboard:
`https://nango.cloud.hefesoft.com/prod/integrations`

The API origin is `https://nango.cloud.hefesoft.com`, without the dashboard path.
The managed cloud environment reported restricted outbound networking, only the
package-manager preset, no custom allowed hosts, and no configured secrets or
runtime variables. An HTTP HEAD request failed at the outbound proxy with
`CONNECT tunnel failed, response 403`; this was not an authenticated Nango response.

The user says a Chrome plugin has access to Nango. This chat's available tools
contained no Chrome/browser automation connection. Plugin discovery did not find
that Chrome plugin; it must be made available in the next chat. The pending
question is its exact name. Do not assume another browser service can access the
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
