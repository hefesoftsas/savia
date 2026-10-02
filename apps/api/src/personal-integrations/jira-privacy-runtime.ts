import type { NangoConfiguration } from "../external-crm/nango";
import type { PersonalIntegrationNangoClient } from "./contracts";
import type {
  JiraPrivacyRepository,
  JiraPrivacySnapshot,
} from "./jira-privacy-contracts";
import { createJiraPrivacyRepository } from "./jira-privacy-repository";
import { createPersonalIntegrationNangoClient } from "./nango";
import {
  JiraIdentityAuthorizationError,
  JiraPrivacyReportingError,
  reportJiraAccounts,
  resolveJiraIdentity,
  type JiraConnectionRef,
} from "./jira-privacy";

const retryDelay = 5 * 60 * 1000;

export async function cleanJiraPrivacySnapshots(
  repository: JiraPrivacyRepository,
  nango: PersonalIntegrationNangoClient,
  snapshots: JiraPrivacySnapshot[],
  now: string,
): Promise<number> {
  let failures = 0;
  for (const snapshot of snapshots) {
    try {
      await nango.deleteConnection(
        snapshot.nangoConnectionId,
        snapshot.integrationId,
      );
      await repository.finishCleanup(snapshot, now);
    } catch {
      await repository.retryCleanup(
        snapshot,
        new Date(Date.parse(now) + retryDelay).toISOString(),
      );
      failures++;
    }
  }
  return failures;
}

export async function runJiraPrivacyMaintenance(
  database: D1Database,
  configuration: NangoConfiguration,
  nango = createPersonalIntegrationNangoClient(configuration),
  now = new Date().toISOString(),
): Promise<void> {
  const integrationId = configuration.jiraIntegrationId?.trim();
  if (!integrationId) return;
  const repository = createJiraPrivacyRepository(database);
  let failures = await cleanJiraPrivacySnapshots(
    repository,
    nango,
    await repository.listCleanup(now, 90, integrationId),
    now,
  );
  // Backfill historical rows with a live Atlassian identity. Preserve their
  // original retained-data date rather than resetting account age to today.
  for (const connection of await repository.listUnverifiedJiraConnections(
    integrationId,
    90,
  )) {
    try {
      const identity = await resolveJiraIdentity(
        nango,
        {
          provider: "jira",
          nangoConnectionId: connection.nangoConnectionId,
          nangoIntegrationId: integrationId,
        },
        now,
      );
      await repository.recordLegacyIdentity(connection, {
        ...identity,
        retrievedAt: connection.createdAt,
      });
    } catch {
      failures++;
    }
  }
  const ownerConnectionId = configuration.jiraReportingConnectionId?.trim();
  const initialState = await repository.getOperationalState(integrationId);
  if (
    !ownerConnectionId ||
    (initialState.ownerAuthorizationRequired &&
      initialState.revokedReportingConnectionId === ownerConnectionId)
  )
    throw new JiraPrivacyReportingError("JIRA_PRIVACY_REPORT_AUTH_REQUIRED");
  if (initialState.cycleBlocked)
    throw new JiraPrivacyReportingError(
      "JIRA_PRIVACY_CYCLE_PERIOD_UNSUPPORTED",
    );
  if (initialState.reporterRetryAt && initialState.reporterRetryAt > now)
    throw new JiraPrivacyReportingError(
      initialState.ownerAuthorizationRequired
        ? "JIRA_PRIVACY_REPORT_AUTH_REQUIRED"
        : "JIRA_PRIVACY_REPORT_FAILED",
      initialState.reporterRetryAt,
    );
  const reporter: JiraConnectionRef = {
    provider: "jira",
    nangoConnectionId: ownerConnectionId,
    nangoIntegrationId: integrationId,
  };
  try {
    const identity = await resolveJiraIdentity(nango, reporter, now);
    await repository.recordOperationalIdentity(reporter, identity);
  } catch (error) {
    const authorizationRequired =
      error instanceof JiraIdentityAuthorizationError;
    const retryAt = new Date(Date.parse(now) + retryDelay).toISOString();
    await repository.retryReporter(
      integrationId,
      retryAt,
      authorizationRequired,
    );
    throw new JiraPrivacyReportingError(
      authorizationRequired
        ? "JIRA_PRIVACY_REPORT_AUTH_REQUIRED"
        : "JIRA_PRIVACY_REPORT_FAILED",
      retryAt,
    );
  }
  let ownerAuthorizationRequired = false;
  // A bounded run reports one atomic batch. The next cron claims another batch;
  // concurrent Workers cannot lease the same account at the same time.
  const lease = await repository.claimDueReports(integrationId, now);
  if (lease.accounts.length) {
    let accepted = false;
    try {
      const result = await reportJiraAccounts(nango, reporter, lease, now);
      await repository.acceptReport(
        lease,
        now,
        result.cycleMs,
        result.erasures,
      );
      accepted = true;
      if (result.cycleMs === null) failures++;
    } catch (error) {
      if (
        error instanceof JiraPrivacyReportingError &&
        error.code === "JIRA_PRIVACY_REPORT_AUTH_REQUIRED"
      ) {
        ownerAuthorizationRequired = true;
        await repository.retryReporter(
          integrationId,
          error.retryAt ?? new Date(Date.parse(now) + retryDelay).toISOString(),
          true,
        );
      }
      if (!accepted)
        await repository.retryReport(
          lease,
          error instanceof JiraPrivacyReportingError && error.retryAt
            ? error.retryAt
            : new Date(Date.parse(now) + retryDelay).toISOString(),
        );
      failures++;
    }
  }
  failures += await cleanJiraPrivacySnapshots(
    repository,
    nango,
    await repository.listCleanup(now, 90, integrationId),
    now,
  );
  const state = await repository.getOperationalState(integrationId);
  // Log counts only; identities, tokens, external response bodies and Nango
  // connection identifiers never enter application logs.
  console.info(
    JSON.stringify({
      event: "jira_privacy_maintenance",
      pendingCleanup: state.pendingCleanup,
      pendingBackfill: state.pendingBackfill,
      blockedReports: state.blockedReports,
      cycleBlocked: state.cycleBlocked,
      ownerAuthorizationRequired: state.ownerAuthorizationRequired,
      failures,
    }),
  );
  if (ownerAuthorizationRequired)
    throw new JiraPrivacyReportingError("JIRA_PRIVACY_REPORT_AUTH_REQUIRED");
  if (
    failures ||
    state.pendingBackfill ||
    state.pendingCleanup ||
    state.ownerAuthorizationRequired ||
    state.blockedReports ||
    state.cycleBlocked
  )
    throw new JiraPrivacyReportingError("JIRA_PRIVACY_REPORT_FAILED");
}
