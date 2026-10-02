# Jira and Linear issue links

Owner: Savia API and Studio. Reviewed: 2026-10-01.

Savia can show a transient preview for Jira Cloud and Linear issue links on Pages. Each preview uses the viewing user's personal connection. Savia never fetches a pasted URL, stores issue metadata in shared page content, or writes to an issue.

## Configure Nango

Register Jira Cloud and Linear as separate Nango integrations, with read access only. Configure these server environment variables with each integration's Nango integration ID:

- `NANGO_JIRA_INTEGRATION_ID`
- `NANGO_LINEAR_INTEGRATION_ID`

Both integrations also use the existing `NANGO_BASE_URL`, `NANGO_CONNECT_URL`, and `NANGO_API_KEY` settings. When an integration ID is absent, its provider is marked **Requires setup** in Integrations, without deployment instructions in the personal connections screen. Deployment-level Nango credentials remain server settings; the personal connections screen does not edit or expose secrets. No user token or Nango credential is sent to the browser.

The Jira connection needs permission to read issues and user display names (`read:jira-work` and `read:jira-user`). The Linear connection needs its read scope. Savia requests only issue previews, and its server routes only issue reads.

### Hosted environment configuration

Nango has separate `jira` and `linear` integrations in `dev` and `prod`, backed by separate **Savia Dev** and **Savia Prod** OAuth applications. Jira also requests `offline_access` for token renewal. Both environments use the registered callback `https://nango.cloud.hefesoft.com/oauth/callback`; the application homepage is `https://savia.app.hefesoft.com/`. Local, preview, and tenant subdomains open Nango Connect from their current origin and do not need their own provider callback entries.

Use the development Nango API key for local and preview backends, and the production key only for production. Keys remain backend secrets. The Cloudflare configuration renderer enables `NANGO_LINEAR_INTEGRATION_ID=linear`; the GitHub environment must supply its matching `NANGO_API_KEY` before deployment.

Jira OAuth applications currently remain private. Atlassian requires a Personal Data Reporting API implementation before an application that stores personal account references can be shared. Savia persists external account identifiers and labels, and this reporting implementation is not yet present. Do not attest that it is implemented or enable Jira for general users until this requirement is resolved. The supplied privacy notice is `https://landing-savia.cloud.hefesoft.com/#aviso-de-privacidad`. The Jira integration ID is intentionally absent from the deployment renderer until public distribution is ready. The local preview uses the private development Jira application for owner-only testing; other users cannot authorize it yet. Local development also needs each existing Google and Microsoft integration ID to be passed to the backend; creating an integration in Nango alone does not enable its Savia card. Provider logos reuse the installed `@thesvg/react` brand assets.

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

### Issue card presentation

Issue previews display the provider logo, issue identifier, linked title, original
provider status, and assignee name with initials. An unassigned issue explicitly
shows “Unassigned”; a missing status shows “Unavailable”. Custom workflow status
names are preserved, including “In Progress” and “En curso”. Metadata remains
viewer-scoped and is fetched from the integration rather than stored in the page.

Cards use compact spacing and a single wrapping metadata row. Status and assignee
labels remain available to assistive technology without adding visible rows.
