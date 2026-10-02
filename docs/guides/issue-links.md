# Jira and Linear issue links

Owner: Savia API and Studio. Reviewed: 2026-10-02.

Savia can show a transient preview for Jira Cloud and Linear issue links on Pages. Each preview uses the viewing user's personal connection. Savia never fetches a pasted URL, stores issue metadata in shared page content, or writes to an issue.

## Configure Nango

Register Jira Cloud and Linear as separate Nango integrations, with read access only. Configure these server environment variables with each integration's Nango integration ID:

- `NANGO_JIRA_INTEGRATION_ID`
- `NANGO_LINEAR_INTEGRATION_ID`

Both integrations also use the existing `NANGO_BASE_URL`, `NANGO_CONNECT_URL`, and `NANGO_API_KEY` settings. When an integration ID is absent, its provider is marked **Requires setup** in Integrations, without deployment instructions in the personal connections screen. Deployment-level Nango credentials remain server settings; the personal connections screen does not edit or expose secrets. No user token or Nango credential is sent to the browser.

The Jira connection needs permission to read issues and user display names (`read:jira-work` and `read:jira-user`). The Linear connection needs its read scope. Savia requests only issue previews, and its server routes only issue reads.

### Hosted environment configuration

Nango has separate `jira` and `linear` integrations in `dev` and `prod`, backed by separate **Savia Dev** and **Savia Prod** OAuth applications. Jira also requests `offline_access` for token renewal. Both environments use the registered callback `https://nango.cloud.hefesoft.com/oauth/callback`; the application homepage is `https://savia.app.hefesoft.com/`. Local, preview, and tenant subdomains open Nango Connect from their current origin and do not need their own provider callback entries.

Use the development Nango API key for local and preview backends, and the production key only for production. Keys remain backend secrets. The Cloudflare configuration renderer enables `NANGO_LINEAR_INTEGRATION_ID=linear`; the GitHub environment must supply its matching `NANGO_API_KEY` before deployment. Jira remains disabled by default: set that environment's `NANGO_JIRA_INTEGRATION_ID` variable to `jira` only when its OAuth app and reporting setup are ready.

Savia's API now tracks verified Jira account identity and retained-data age, reports due account records through a dedicated owner-authorized Nango connection, and durably resumes retries and erasure work. The scheduler sends no more than 90 distinct accounts per report. Accepted `closed` or `updated` results trigger removal of the affected external identity data and Nango connection; users can connect again after an updated account is erased. A malformed or unsupported reporting cycle stops further reports until the provider timing is verified. Report transport and deletion failures stay pending for retry. A deletion retry completes when Nango returns either HTTP 404 or HTTP 400 with the exact `unknown_connection` error code; other errors remain pending. Logs contain aggregate counts and controlled error codes rather than account IDs or report payloads.

For each enabled hosted environment, set `NANGO_JIRA_INTEGRATION_ID=jira` as an environment variable and set `NANGO_JIRA_REPORTING_CONNECTION_ID` as an environment secret. The reporting connection must be authorized by the owner with the same Atlassian OAuth application used for user connections. The deployment rejects an enabled Jira integration without its reporting connection secret. The reporting connection ID is uploaded only to that environment's API Worker; it is never placed in frontend assets or rendered Worker configuration. For self-hosted deployments, provide the same two backend environment variables. Local development can provide them through the backend environment; never expose the reporter ID as a browser setting.

Jira OAuth applications remain private until live privacy and cleanup checks pass. Code and automated tests do not prove that the deployed Nango installation removes identity metadata, proxy response logs, and sync records. Before sharing an Atlassian app, verify the owner reporting connection, reports and controlled test-account erasure, Nango retention and deletion behavior, and the production credentials. Keep `NANGO_JIRA_INTEGRATION_ID` unset until those checks are recorded; do not infer public activation from a successful deployment. The supplied privacy notice is `https://landing-savia.cloud.hefesoft.com/#aviso-de-privacidad`. The development and production Jira applications are now shared, and Jira is enabled in hosted preview and production. Each user must authorize their own Atlassian account. Local development also needs each existing Google and Microsoft integration ID to be passed to the backend; creating an integration in Nango alone does not enable its Savia card. Provider logos reuse the installed `@thesvg/react` brand assets.

The hosted Nango 0.71.6 deployment uses `CRON_DELETE_OLD_CONNECTIONS_MAX_DAYS=0` in its persisted Coolify configuration. API deletion first marks a connection deleted; the supported cleanup cron physically removes deleted records on its ten-minute schedule. This setting applies to every Nango integration. Live verification confirmed removal of all 17 previously deleted connections while preserving both active Jira reporting connections. Nango proxy logs are disabled and no Jira sync functions are deployed; recheck data retention before enabling either.

Provider references: [Jira Cloud OAuth scopes and accessible resources](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/), [Jira Cloud issue API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/), [Linear OAuth scopes](https://linear.app/developers/oauth-2-0-authentication), and [Linear GraphQL issue queries](https://linear.app/developers/graphql).

## Connect your account

Open **Integrations → Accounts & Connections → Issue management**. Jira and Linear explain their read-only Pages previews. An enabled provider offers **Connect** and opens the existing Nango authorization flow. Connected accounts can be disconnected, and expired/failed connections can be reauthorized. Providers awaiting server setup display their availability and administrator prerequisite. Deployment variables are documented here rather than in the personal connections screen.

The editor offers only the provider commands that are enabled and connected for the current reader. It rechecks on entry, after connection changes, and on returning to the browser. Unknown/error states hide provider commands. Existing issue blocks retain a normal clickable link when disconnected, and ordinary pasted links never require OAuth.

Pasting a recognized issue URL into an empty paragraph creates an issue card when that provider is enabled and connected. Pasting into existing prose, a code block, or without a connected provider preserves the normal text/link behavior. Only the URL is saved; title, status, and assignee are fetched for the current reader.

## Preview behavior

Savia accepts HTTPS links in these forms:

- Jira Cloud: `https://<site>.atlassian.net/browse/<KEY>`
- Linear: `https://linear.app/<workspace>/issue/<KEY>` with an optional single slug segment

Credentials, ports, query strings, fragments, malformed paths, and other hosts are rejected. Jira site names are matched against the current connection's Atlassian accessible resources before using the cloud ID. The Jira API destination and Linear GraphQL endpoint are fixed in server code; a pasted host cannot choose an upstream destination.

The authenticated `POST /v1/personal-integrations/issue-preview` endpoint returns the provider, canonical link, issue identifier, title, status, and assignee. For Linear, Savia verifies that the resolved issue URL has the same workspace and identifier as the pasted link before showing metadata. Responses use `Cache-Control: no-store`. A missing connection returns an unavailable response, and provider access failures return a controlled access error without forwarding upstream bodies.

If an issue cannot be previewed, its HTTPS link remains available as a regular link. Reconnect Jira or Linear from **Accounts & Connections** to restore previews.

## Verification

The shared parser tests accepted link forms, deceptive hosts, credentials, ports, query strings, fragments, and malformed paths. API tests cover Jira site identity verification, fixed Linear GraphQL previews, transient response headers, and rejection before any upstream request. These tests use mocked Nango responses and do not access real issue trackers.

### Local live verification (2026-10-01)

Chrome verification completed with the development OAuth applications: Linear previews returned HEF-1 and HEF-3, and Jira on `aihefesoft.atlassian.net` returned KAN-1 (`Task 1`, `Por hacer`). Jira initially failed at the token exchange with `401 Unauthorized` because Nango had received a redacted placeholder instead of the actual OAuth client secret. After the actual development secret was saved in Nango, authorization and the authenticated preview both succeeded. Never copy a redacted browser-tool value into a credential field. This verification does not establish that the production Jira secret was corrected or that public distribution is enabled.

### Hosted activation verification (2026-10-02)

Preview and production deployed commit `893ebc3e5527342b5368f2830d45f7326e7e36f2` with separate backend credentials and reporting connections. Both Atlassian applications saved distribution status **Sharing**, with the published privacy notice and personal-data declaration. Live reporting returned HTTP 200 in both environments; controlled deletion and subsequent physical cleanup passed. Preview completed a user OAuth flow through Savia and showed Jira **Connected**. Read-only issue search and detail requests through that user connection returned HTTP 200 with the preview fields. Production offered **Connect** and opened the Jira authorization flow. Authorization by a separate non-owner Atlassian account has not been tested.

### Issue card presentation

Issue previews display the provider logo, issue identifier, linked title, original
provider status, and assignee name with initials. An unassigned issue explicitly
shows “Unassigned”; a missing status shows “Unavailable”. Custom workflow status
names are preserved, including “In Progress” and “En curso”. Metadata remains
viewer-scoped and is fetched from the integration rather than stored in the page.

Cards use compact spacing and a single wrapping metadata row. Status and assignee
labels remain available to assistive technology without adding visible rows.
