# Jira public distribution and personal data reporting

Date: 2026-10-02. Status: proposed specification awaiting written review.

## Outcome

Allow every Savia user to authorize their own Jira Cloud account from Connections
and preview authorized issues on Pages. Preserve the existing read-only issue
integration and viewer-scoped previews. Complete the privacy reporting prerequisite
before sharing the production Atlassian OAuth application or enabling its card.

The user approved completing Jira for all users and adding reporting to the existing
scheduled process. This document specifies that design for review; it does not claim
that reporting, public distribution, or production verification has been completed.

## Current evidence

- `scripts/render-cloudflare-production-config.mjs` omits
  `NANGO_JIRA_INTEGRATION_ID` intentionally. The production UI shows Jira unavailable.
- `docs/guides/issue-links.md` records private development and production OAuth apps,
  Nango integration ID `jira`, and a successful private development preview.
- The connection completion route can persist external account IDs and labels from
  Nango metadata. Disconnecting currently retains those fields in historical rows.
- The API already runs scheduled maintenance. Self-hosted installations invoke the
  same scheduling implementation, with both SQLite and PostgreSQL persistence.
- Production Nango credentials and sharing status have not been verified in this
  task. Nango's fresh browser page fails to render with an empty Stripe key error;
  the existing Chrome session cannot currently be controlled.

## Approach and boundaries

Add a small internal Jira privacy service, backed by durable database state and
invoked by the existing scheduler. Use Nango to authenticate fixed Atlassian API
requests. Do not expose reporting operations, credentials, or account inventories
through the frontend, public API, or MCP.

An alternative is to eliminate all stored Atlassian personal data, including Nango
metadata and logs. That requires auditing the deployed Nango installation first.
Reporting is the selected approach because Savia's connection model already permits
persisted account references and labels.

There are no Jira issue writes, new user-facing administration screens, or changes
to other providers. Issue titles, assignees, and statuses remain transient; reports
cover connected account identity data rather than all users visible in an issue.

## Account identity and data age

Resolve the authorizing user's real Atlassian `accountId` before saving Jira identity
data. Use accessible resources and the site's `myself` API through the existing
fixed Jira destination; do not trust an email, Savia principal ID, connection ID,
or arbitrary Nango metadata value as an Atlassian account ID.

Accept IDs of 1–128 characters containing alphanumeric characters, `-`, and `:`.
Reject `unknown`. Identity lookup or validation failure must prevent a new Jira
connection from being recorded as ready for use.

Track the oldest retrieval timestamp for retained identity data. Deduplicate reports
by OAuth integration and Atlassian account ID across Savia principals. Preserve the
oldest timestamp while any copy remains, including historical connection rows and
relevant Nango data. A changed account on reconnection must not inherit another
account's reporting history. Capture connection versions so an in-flight report
cannot erase a newer, unrelated connection.

Backfill active legacy Jira connections through authenticated identity lookup and
use their creation timestamp conservatively for existing data. Erase external
identity fields from disconnected legacy rows. Failed backfills remain visible as
pending work; they must not silently exempt stored personal data from reporting.

## Reporting and durable progress

Use a dedicated, backend-configured Nango connection authorized by the owner of the
same Atlassian OAuth app. Configure its connection ID as
`NANGO_JIRA_REPORTING_CONNECTION_ID`; tokens and client secrets stay in Nango.
Development and production use their own owner connection and app credentials.

Send at most 90 distinct accounts per request to the fixed endpoint
`POST https://api.atlassian.com/app/report-accounts/`. Each item contains `accountId`
and RFC 3339 `updatedAt` describing the oldest retained data.

Maintain durable account state: oldest data timestamp, last accepted report time,
next eligible report time, retry time, lease, and pending erasure. Default reporting
period is seven days. Honor a valid provider `Cycle-Period` when supplied according
to the provider's documented representation; malformed timing headers are an
operational error rather than permission to report more frequently.

Claim due work atomically with expiring five-minute leases. Each scheduled run
processes one bounded batch. Concurrent invocations must not claim the same account.
Restarting resumes unfinished work from the database. Never store timestamps or
inventories in browser storage. Add portable SQLite/D1 and PostgreSQL migrations
and maintain the PostgreSQL migration manifest.

For HTTP 204, advance the accepted batch's schedule. For HTTP 200, validate the
entire response: returned account IDs must belong to that batch and statuses must
be `closed` or `updated`. Persist erasure work before advancing the schedule.
Reject malformed bodies, foreign accounts, and ambiguous duplicate results.

For HTTP 429, persist retry timing using `Retry-After`. For transport and server
failures, retry after five minutes without advancing the reporting cycle. For
authentication failures, retain work and surface a controlled operational error
requiring reauthorization of the reporting connection. Do not forward upstream
bodies or log account IDs, labels, tokens, or report payloads.

## Erasure, disconnection, and races

For both `closed` and `updated`, erase stale Atlassian identity data in Savia and
delete the corresponding Nango connections. Mark affected Jira connections
disconnected; an updated account can authorize again through the existing Connect
flow. This favors complete erasure over keeping an old account label or token.

Keep durable cleanup references until Nango deletion is confirmed; treat an
already-absent connection as successfully deleted. Retry partial failures. Apply
cleanup only to the captured account/integration/connection version, leaving a
newer connection to another account untouched. Ordinary user disconnection must
also erase Jira identity fields and remove reporting state once its final stored
copy and Nango cleanup references have gone.

If erasure affects the owner reporting connection, stop further reports and surface
the need to authorize a fresh owner connection. Do not retain that user's stale
data merely to keep the reporting job running.

Audit the deployed Nango installation for identity metadata, proxy response logs,
sync records, and retention. Configure the integration to avoid retaining issue
preview payloads. Public activation requires evidence that Nango's relevant stored
identity data can be erased too; a passing Savia unit test alone is insufficient.

## Runtime and deployment

Run privacy maintenance in every scheduling mode that can host Jira connections,
including the workflow-only branch and the self-hosted scheduler. No extra cron
service or dependency is required. Missing Jira configuration is a no-op; an enabled
public integration without its reporting connection is a deployment error.

Production activation is a separate final step after migration, reporting, cleanup,
and credential verification. Only then add `NANGO_JIRA_INTEGRATION_ID=jira` to the
hosted configuration and enable sharing for Savia Prod in the Atlassian console.
Retain `read:jira-work`, `read:jira-user`, and `offline_access`; do not request issue
write permissions. Keep the registered Nango callback and privacy notice recorded
in `docs/guides/issue-links.md`.

Deploy through the repository's preview and production workflow. Do not attest
that privacy reporting is implemented until it has actually passed verification.
Browser-required legal acceptance or access confirmation remains a user action.

## Validation and acceptance

Automated checks must cover verified identity persistence, oldest timestamps,
account changes, deduplication, 90-account limits, cycle timing, concurrent claims,
expired leases, 200/204 responses, malformed responses, rate limits, and auth errors.
Database tests must prove erasure of historical rows, retry after partial Nango
deletion, reconnection races, and migration parity. Runtime tests must cover both
schedule branches and the self-hosted adapter. Existing integration and issue
preview tests must keep passing.

Run targeted tests first, then `pnpm test` and `pnpm run typecheck`. Report any
pre-existing failures separately. Update `docs/guides/issue-links.md` with operator
configuration, scheduling behavior, account erasure, and observed live evidence.

Live acceptance requires the production owner reporting token to authenticate,
successful reporting against Atlassian's documented test accounts without repeated
calls outside the permitted cycle, confirmed Nango cleanup, public sharing enabled,
and Jira's Connect button in production. Verify authorization and an issue preview
with a non-owner account when available; owner-only testing does not prove public
distribution. Record any missing external verification explicitly.

## References

- [Atlassian user privacy guide and reporting API](https://developer.atlassian.com/cloud/jira/platform/user-privacy-developer-guide/)
- [Atlassian OAuth configuration and distribution](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/)
- Existing guide: `docs/guides/issue-links.md`.
