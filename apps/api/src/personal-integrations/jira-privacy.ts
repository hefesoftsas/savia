import type { PersonalIntegrationNangoClient } from "./contracts";
import { PersonalIntegrationUpstreamError } from "./contracts";
import type { JiraIdentity, JiraReportLease } from "./jira-privacy-contracts";

export type JiraConnectionRef = {
  provider: "jira";
  nangoConnectionId: string;
  nangoIntegrationId: string;
};

const defaultCycleMs = 7 * 24 * 60 * 60 * 1000;
const retryDelayMs = 5 * 60 * 1000;

function accountIdValid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "unknown" &&
    /^[A-Za-z0-9:-]{1,128}$/.test(value)
  );
}

function timestampValid(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) && Number.isFinite(Date.parse(value))
  );
}

export class JiraIdentityAuthorizationError extends PersonalIntegrationUpstreamError {}

function requireIdentityResponse(response: Response): void {
  if (response.status === 401 || response.status === 403)
    throw new JiraIdentityAuthorizationError();
  if (!response.ok) throw new PersonalIntegrationUpstreamError();
}

export async function resolveJiraIdentity(
  nango: PersonalIntegrationNangoClient,
  connection: JiraConnectionRef,
  retrievedAt: string,
): Promise<JiraIdentity> {
  if (!timestampValid(retrievedAt))
    throw new PersonalIntegrationUpstreamError();
  const resourcesResponse = await nango.proxy({
    method: "GET",
    path: "/oauth/token/accessible-resources",
    connection,
  });
  requireIdentityResponse(resourcesResponse);
  const resources: unknown = await resourcesResponse
    .json()
    .catch(() => undefined);
  const resource = Array.isArray(resources)
    ? (resources.find((entry: unknown) => {
        if (!entry || typeof entry !== "object") return false;
        const item = entry as Record<string, unknown>;
        return (
          typeof item.id === "string" &&
          /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(item.id) &&
          Array.isArray(item.scopes) &&
          item.scopes.includes("read:jira-user")
        );
      }) as Record<string, unknown> | undefined)
    : undefined;
  if (!resource) throw new PersonalIntegrationUpstreamError();
  const response = await nango.proxy({
    method: "GET",
    path: `/ex/jira/${encodeURIComponent(resource.id as string)}/rest/api/3/myself`,
    connection,
  });
  requireIdentityResponse(response);
  const identity: unknown = await response.json().catch(() => undefined);
  if (!identity || typeof identity !== "object" || Array.isArray(identity))
    throw new PersonalIntegrationUpstreamError();
  const user = identity as Record<string, unknown>;
  if (!accountIdValid(user.accountId) || user.active !== true)
    throw new PersonalIntegrationUpstreamError();
  return {
    accountId: user.accountId,
    label:
      typeof user.displayName === "string" &&
      user.displayName.trim() &&
      user.displayName.length <= 255
        ? user.displayName
        : null,
    retrievedAt,
  };
}

export class JiraPrivacyReportingError extends Error {
  constructor(
    readonly code:
      | "JIRA_PRIVACY_REPORT_FAILED"
      | "JIRA_PRIVACY_REPORT_AUTH_REQUIRED"
      | "JIRA_PRIVACY_REPORT_RATE_LIMITED"
      | "JIRA_PRIVACY_CYCLE_PERIOD_UNSUPPORTED",
    readonly retryAt?: string,
  ) {
    super("Jira privacy maintenance could not be completed");
    this.name = "JiraPrivacyReportingError";
  }
}

export async function reportJiraAccounts(
  nango: PersonalIntegrationNangoClient,
  reporter: JiraConnectionRef,
  lease: JiraReportLease,
  now: string,
): Promise<{
  cycleMs: number | null;
  erasures: Array<{ accountId: string; status: "closed" | "updated" }>;
}> {
  if (!timestampValid(now))
    throw new JiraPrivacyReportingError("JIRA_PRIVACY_REPORT_FAILED");
  const retryAt = new Date(Date.parse(now) + retryDelayMs).toISOString();
  const submitted = new Set<string>();
  if (
    lease.integrationId !== reporter.nangoIntegrationId ||
    lease.accounts.length > 90
  )
    throw new JiraPrivacyReportingError("JIRA_PRIVACY_REPORT_FAILED", retryAt);
  for (const account of lease.accounts) {
    if (
      !accountIdValid(account.accountId) ||
      !timestampValid(account.updatedAt) ||
      submitted.has(account.accountId)
    )
      throw new JiraPrivacyReportingError(
        "JIRA_PRIVACY_REPORT_FAILED",
        retryAt,
      );
    submitted.add(account.accountId);
  }
  if (!lease.accounts.length) return { cycleMs: defaultCycleMs, erasures: [] };
  const response = await nango
    .proxy({
      method: "POST",
      path: "/app/report-accounts/",
      connection: reporter,
      body: {
        accounts: lease.accounts.map(({ accountId, updatedAt }) => ({
          accountId,
          updatedAt,
        })),
      },
    })
    .catch(() => undefined);
  if (response?.status === 401 || response?.status === 403)
    throw new JiraPrivacyReportingError(
      "JIRA_PRIVACY_REPORT_AUTH_REQUIRED",
      retryAt,
    );
  if (response?.status === 429) {
    const header = response.headers.get("Retry-After") ?? "";
    const seconds = /^\d+$/.test(header) ? Number(header) : NaN;
    const timestamp = Date.parse(now) + seconds * 1000;
    const limitedRetry =
      Number.isSafeInteger(seconds) &&
      seconds >= 0 &&
      Number.isFinite(timestamp) &&
      timestamp <= 8640000000000000
        ? new Date(timestamp).toISOString()
        : retryAt;
    throw new JiraPrivacyReportingError(
      "JIRA_PRIVACY_REPORT_RATE_LIMITED",
      limitedRetry,
    );
  }
  if (response?.status !== 200 && response?.status !== 204)
    throw new JiraPrivacyReportingError("JIRA_PRIVACY_REPORT_FAILED", retryAt);
  const erasures: Array<{ accountId: string; status: "closed" | "updated" }> =
    [];
  if (response.status === 200) {
    const payload: unknown = await response.json().catch(() => undefined);
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      !Array.isArray((payload as Record<string, unknown>).accounts)
    )
      throw new JiraPrivacyReportingError(
        "JIRA_PRIVACY_REPORT_FAILED",
        retryAt,
      );
    const seen = new Set<string>();
    for (const entry of (payload as { accounts: unknown[] }).accounts) {
      const item =
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? (entry as Record<string, unknown>)
          : {};
      if (
        !accountIdValid(item.accountId) ||
        !submitted.has(item.accountId) ||
        seen.has(item.accountId) ||
        (item.status !== "closed" && item.status !== "updated")
      )
        throw new JiraPrivacyReportingError(
          "JIRA_PRIVACY_REPORT_FAILED",
          retryAt,
        );
      seen.add(item.accountId);
      erasures.push({ accountId: item.accountId, status: item.status });
    }
  }
  // The provider guide defines the default but does not specify a wire format
  // for Cycle-Period. Preserve accepted erasures and block another report until
  // a nonempty header's representation is verified, rather than guess its units.
  return {
    cycleMs: response.headers.has("Cycle-Period") ? null : defaultCycleMs,
    erasures,
  };
}
