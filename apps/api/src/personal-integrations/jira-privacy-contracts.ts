import type {
  ActivePersonalIntegrationConnection,
  PersonalIntegrationCompletion,
} from "./contracts";

export type JiraIdentity = {
  accountId: string;
  label: string | null;
  retrievedAt: string;
};

export type JiraPrivacyAccount = {
  integrationId: string;
  accountId: string;
  oldestDataAt: string;
  version: number;
  lastReportedAt: string | null;
  nextReportAt: string;
  retryAt: string | null;
  leaseToken: string | null;
  leaseUntil: string | null;
  pendingErasure: "closed" | "updated" | null;
  blockedReason: "unsupported-cycle" | "owner-auth-required" | null;
};

export type JiraPrivacySnapshot = {
  generation: string;
  connectionId: string | null;
  principalId: string | null;
  integrationId: string;
  nangoConnectionId: string;
  accountId: string | null;
  retrievedAt: string;
  cleanupReason: "closed" | "updated" | "disconnect" | "replace" | null;
  cleanupRetryAt: string | null;
};

export type JiraReportLease = {
  token: string;
  integrationId: string;
  accounts: Array<{ accountId: string; updatedAt: string; version: number }>;
};

export type JiraPrivacyOperationalState = {
  pendingCleanup: number;
  pendingBackfill: number;
  blockedReports: number;
  cycleBlocked: boolean;
  ownerAuthorizationRequired: boolean;
  revokedReportingConnectionId: string | null;
  reporterRetryAt: string | null;
};

export type JiraPrivacyRepository = {
  saveVerifiedConnection(
    completion: PersonalIntegrationCompletion,
    identity: JiraIdentity,
  ): Promise<ActivePersonalIntegrationConnection>;
  claimDueReports(integrationId: string, now: string): Promise<JiraReportLease>;
  acceptReport(
    lease: JiraReportLease,
    now: string,
    cycleMs: number | null,
    erasures: Array<{ accountId: string; status: "closed" | "updated" }>,
  ): Promise<void>;
  retryReport(lease: JiraReportLease, retryAt: string): Promise<void>;
  queueDisconnect(
    connection: ActivePersonalIntegrationConnection,
    reason: "disconnect" | "replace",
    now: string,
  ): Promise<void>;
  listCleanup(
    now: string,
    limit: number,
    integrationId?: string,
  ): Promise<JiraPrivacySnapshot[]>;
  finishCleanup(snapshot: JiraPrivacySnapshot, now: string): Promise<void>;
  retryCleanup(snapshot: JiraPrivacySnapshot, retryAt: string): Promise<void>;
  listUnverifiedJiraConnections(
    integrationId: string,
    limit: number,
  ): Promise<ActivePersonalIntegrationConnection[]>;
  recordLegacyIdentity(
    connection: ActivePersonalIntegrationConnection,
    identity: JiraIdentity,
  ): Promise<void>;
  recordOperationalIdentity(
    connection: JiraOperationalConnection,
    identity: JiraIdentity,
  ): Promise<void>;
  getOperationalState(
    integrationId: string,
  ): Promise<JiraPrivacyOperationalState>;
  clearUnsupportedCycle(integrationId: string): Promise<void>;
  retryReporter(
    integrationId: string,
    retryAt: string,
    authorizationRequired?: boolean,
  ): Promise<void>;
};

export type JiraOperationalConnection = {
  provider: "jira";
  nangoConnectionId: string;
  nangoIntegrationId: string;
};
