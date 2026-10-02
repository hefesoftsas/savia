import { describe, expect, it } from "vitest";
import { createPersonalIntegrationNangoClient } from "../src/personal-integrations/nango";
import {
  reportJiraAccounts,
  resolveJiraIdentity,
} from "../src/personal-integrations/jira-privacy";

const reference = {
  provider: "jira" as const,
  nangoConnectionId: "owner-connection",
  nangoIntegrationId: "jira",
};
const now = "2026-10-02T12:00:00.000Z";
const cloudId = "1324a887-45db-1bf4-1e99-ef0ff456d421";
const accountId = "712020:abcdef-1234";

function transport(responses: Response[]) {
  const requests: Request[] = [];
  const nango = createPersonalIntegrationNangoClient(
    { baseUrl: "https://nango.test", apiKey: "backend-key" },
    async (input, init) => {
      requests.push(new Request(input, init));
      const response = responses.shift();
      if (!response) throw new Error("Unexpected request");
      return response;
    },
  );
  return { nango, requests };
}

function resources() {
  return Response.json([
    {
      id: cloudId,
      name: "Savia Jira",
      url: "https://savia.atlassian.net",
      scopes: ["read:jira-work", "read:jira-user"],
      avatarUrl: "https://example.test/avatar.png",
    },
  ]);
}

function lease(
  accounts = [{ accountId, updatedAt: "2026-09-01T00:00:00.000Z", version: 1 }],
) {
  return { token: "lease-1", integrationId: "jira", accounts };
}

describe("verified Jira identity", () => {
  it("reads the authorizing account from a fixed Jira site API", async () => {
    const { nango, requests } = transport([
      resources(),
      Response.json({ accountId, displayName: "Jira Reader", active: true }),
    ]);
    expect(await resolveJiraIdentity(nango, reference, now)).toEqual({
      accountId,
      label: "Jira Reader",
      retrievedAt: now,
    });
    expect(requests.map((request) => request.url)).toEqual([
      "https://nango.test/proxy/oauth/token/accessible-resources",
      `https://nango.test/proxy/ex/jira/${cloudId}/rest/api/3/myself`,
    ]);
    expect(
      requests.every(
        (request) =>
          request.headers.get("base-url-override") ===
          "https://api.atlassian.com",
      ),
    ).toBe(true);
  });

  it.each(["unknown", "", "bad/id", "a".repeat(129)])(
    "rejects unusable Atlassian account %s",
    async (id) => {
      const { nango } = transport([
        resources(),
        Response.json({ accountId: id, active: true }),
      ]);
      await expect(
        resolveJiraIdentity(nango, reference, now),
      ).rejects.toThrow();
    },
  );

  it("rejects inactive accounts instead of persisting their identity", async () => {
    const { nango } = transport([
      resources(),
      Response.json({ accountId, active: false }),
    ]);
    await expect(resolveJiraIdentity(nango, reference, now)).rejects.toThrow();
  });

  it.each([
    [],
    [{ id: "//attacker.test", scopes: ["read:jira-user"] }],
    [{ id: cloudId, scopes: ["read:confluence-content.all"] }],
  ])(
    "rejects a resource without a usable Jira destination",
    async (...entries) => {
      const { nango, requests } = transport([Response.json(entries)]);
      await expect(
        resolveJiraIdentity(nango, reference, now),
      ).rejects.toThrow();
      expect(requests).toHaveLength(1);
    },
  );
});

describe("Jira privacy reporting transport", () => {
  it("submits only the captured accounts using the dedicated owner connection", async () => {
    const { nango, requests } = transport([
      new Response(null, { status: 204 }),
    ]);
    expect(await reportJiraAccounts(nango, reference, lease(), now)).toEqual({
      cycleMs: 604800000,
      erasures: [],
    });
    const request = requests[0];
    expect(request.url).toBe("https://nango.test/proxy/app/report-accounts/");
    expect(request.method).toBe("POST");
    expect(request.headers.get("connection-id")).toBe("owner-connection");
    expect(request.headers.get("provider-config-key")).toBe("jira");
    expect(request.headers.get("base-url-override")).toBe(
      "https://api.atlassian.com",
    );
    expect(await request.json()).toEqual({
      accounts: [{ accountId, updatedAt: "2026-09-01T00:00:00.000Z" }],
    });
  });

  it("returns validated closed and updated actions from an accepted report", async () => {
    const { nango } = transport([
      Response.json({ accounts: [{ accountId, status: "updated" }] }),
    ]);
    expect(await reportJiraAccounts(nango, reference, lease(), now)).toEqual({
      cycleMs: 604800000,
      erasures: [{ accountId, status: "updated" }],
    });
  });

  it("retains accepted erasures while blocking an unsupported cycle header", async () => {
    const { nango } = transport([
      Response.json(
        { accounts: [{ accountId, status: "closed" }] },
        { headers: { "Cycle-Period": "unverified-duration" } },
      ),
    ]);
    expect(await reportJiraAccounts(nango, reference, lease(), now)).toEqual({
      cycleMs: null,
      erasures: [{ accountId, status: "closed" }],
    });
  });

  it.each([
    { accounts: [{ accountId: "foreign-account", status: "closed" }] },
    { accounts: [{ accountId, status: "deleted" }] },
    {
      accounts: [
        { accountId, status: "closed" },
        { accountId, status: "updated" },
      ],
    },
    { error: "unusable response" },
  ])(
    "rejects an entire malformed report response before returning actions",
    async (body) => {
      const { nango } = transport([Response.json(body)]);
      await expect(
        reportJiraAccounts(nango, reference, lease(), now),
      ).rejects.toMatchObject({ code: "JIRA_PRIVACY_REPORT_FAILED" });
    },
  );

  it.each([401, 403])(
    "surfaces owner authorization failure for HTTP %s without the upstream body",
    async (status) => {
      const { nango } = transport([
        new Response("private-token-details", { status }),
      ]);
      const error = await reportJiraAccounts(
        nango,
        reference,
        lease(),
        now,
      ).catch((value: unknown) => value);
      expect(error).toMatchObject({
        code: "JIRA_PRIVACY_REPORT_AUTH_REQUIRED",
      });
      expect(String(error)).not.toContain("private-token-details");
    },
  );

  it("preserves provider rate-limit retry timing", async () => {
    const { nango } = transport([
      new Response(null, { status: 429, headers: { "Retry-After": "600" } }),
    ]);
    await expect(
      reportJiraAccounts(nango, reference, lease(), now),
    ).rejects.toMatchObject({
      code: "JIRA_PRIVACY_REPORT_RATE_LIMITED",
      retryAt: "2026-10-02T12:10:00.000Z",
    });
  });

  it.each([500, 503])(
    "retries transient HTTP %s after five minutes",
    async (status) => {
      const { nango } = transport([new Response(null, { status })]);
      await expect(
        reportJiraAccounts(nango, reference, lease(), now),
      ).rejects.toMatchObject({ retryAt: "2026-10-02T12:05:00.000Z" });
    },
  );

  it.each([
    Array.from({ length: 91 }, (_, index) => ({
      accountId: `account-${index}`,
      updatedAt: now,
      version: 1,
    })),
    [
      { accountId, updatedAt: now, version: 1 },
      { accountId, updatedAt: now, version: 2 },
    ],
    [{ accountId: "unknown", updatedAt: now, version: 1 }],
    [{ accountId, updatedAt: "yesterday", version: 1 }],
  ])(
    "rejects invalid batches without a network request",
    async (...accounts) => {
      const { nango, requests } = transport([]);
      await expect(
        reportJiraAccounts(nango, reference, lease(accounts), now),
      ).rejects.toThrow();
      expect(requests).toHaveLength(0);
    },
  );
});
