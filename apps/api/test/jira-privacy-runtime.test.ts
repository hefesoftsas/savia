import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createJiraPrivacyRepository } from "../src/personal-integrations/jira-privacy-repository";
import { runJiraPrivacyMaintenance } from "../src/personal-integrations/jira-privacy-runtime";
import type { JiraIdentity } from "../src/personal-integrations/jira-privacy-contracts";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);

async function applyMigrations() {
  for (const migration of migrations)
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((value) =>
        value
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
}

async function seedPrincipal(id: string) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_principal
    (id,issuer,subject,email,display_name,is_active,created_at,updated_at)
    VALUES (?, 'test', ?, ?, ?, 1, ?, ?)`,
  )
    .bind(
      id,
      id,
      `${id}@example.test`,
      id,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    )
    .run();
}

function completion(principalId: string, nangoConnectionId: string) {
  return {
    principalId,
    provider: "jira" as const,
    nangoConnectionId,
    nangoIntegrationId: "jira",
    status: "connected" as const,
    externalAccountId: "untrusted-metadata-id",
    externalAccountLabel: "untrusted label",
    scopes: ["read:jira-work"],
  };
}

const identity = (accountId: string, retrievedAt: string, label = "Verified") =>
  ({ accountId, retrievedAt, label }) satisfies JiraIdentity;

describe("Jira privacy maintenance", () => {
  beforeAll(applyMigrations);
  beforeEach(async () => {
    await env.DB.exec(
      `DELETE FROM jira_privacy_connections; DELETE FROM jira_privacy_accounts; DELETE FROM jira_privacy_integrations; DELETE FROM personal_integration_connections; DELETE FROM identity_principal WHERE id LIKE 'jira-privacy-%';`,
    );
  });
  const configuration = {
    jiraIntegrationId: "jira",
    jiraReportingConnectionId: "owner",
  };
  const now = "2026-07-01T00:00:00.000Z";
  function nango() {
    return {
      proxy: vi.fn(async (input: { path: string }) => {
        if (input.path === "/oauth/token/accessible-resources")
          return Response.json([
            {
              id: "12345678-1234-1234-1234-123456789abc",
              scopes: ["read:jira-user"],
            },
          ]);
        if (input.path.endsWith("/myself"))
          return Response.json({
            accountId: "acct-owner",
            displayName: "Owner",
            active: true,
          });
        return new Response(null, { status: 204 });
      }),
      deleteConnection: vi.fn().mockResolvedValue(undefined),
      getConnection: vi.fn(),
      createConnectSession: vi.fn(),
      createReconnectSession: vi.fn(),
    };
  }
  it("uses the fixed owner connection and reports deduplicated retained accounts", async () => {
    await seedPrincipal("jira-privacy-one");
    await createJiraPrivacyRepository(env.DB).saveVerifiedConnection(
      completion("jira-privacy-one", "member"),
      identity("acct-one", "2026-01-01T00:00:00.000Z"),
    );
    await createJiraPrivacyRepository(env.DB).recordOperationalIdentity(
      {
        provider: "jira",
        nangoConnectionId: "owner",
        nangoIntegrationId: "jira",
      },
      identity("acct-owner", "2026-01-01T00:00:00.000Z"),
    );
    const client = nango();
    await runJiraPrivacyMaintenance(env.DB, configuration, client, now);
    expect(client.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/app/report-accounts/",
        connection: expect.objectContaining({ nangoConnectionId: "owner" }),
        body: {
          accounts: expect.arrayContaining([
            { accountId: "acct-one", updatedAt: "2026-01-01T00:00:00.000Z" },
            { accountId: "acct-owner", updatedAt: "2026-01-01T00:00:00.000Z" },
          ]),
        },
      }),
    );
    const rows = await env.DB.prepare(
      "SELECT last_reported_at FROM jira_privacy_accounts",
    ).all();
    expect(rows.results).toHaveLength(2);
    expect(rows.results.every((row) => row.last_reported_at === now)).toBe(
      true,
    );
  });
  it("retries durable cleanup after remote deletion fails", async () => {
    await seedPrincipal("jira-privacy-one");
    const repository = createJiraPrivacyRepository(env.DB);
    const connection = await repository.saveVerifiedConnection(
      completion("jira-privacy-one", "member"),
      identity("acct-one", "2026-01-01T00:00:00.000Z"),
    );
    await repository.queueDisconnect(connection, "disconnect", now);
    const client = nango();
    client.deleteConnection.mockRejectedValueOnce(
      new Error("secret upstream body"),
    );
    await expect(
      runJiraPrivacyMaintenance(env.DB, configuration, client, now),
    ).rejects.toThrow("Jira privacy maintenance could not be completed");
    expect(await repository.listCleanup(now, 10)).toHaveLength(0);
    await runJiraPrivacyMaintenance(
      env.DB,
      configuration,
      client,
      "2026-07-01T00:05:00.000Z",
    );
    expect(
      await repository.listCleanup("2026-07-01T00:05:00.000Z", 10),
    ).toHaveLength(0);
    expect(
      await env.DB.prepare(
        "SELECT account_id FROM jira_privacy_accounts WHERE account_id='acct-one'",
      ).first(),
    ).toBeNull();
  });
  it("persists accepted erasure before exposing an unsupported reporting cycle", async () => {
    await seedPrincipal("jira-privacy-one");
    await createJiraPrivacyRepository(env.DB).saveVerifiedConnection(
      completion("jira-privacy-one", "member"),
      identity("acct-one", "2026-01-01T00:00:00.000Z"),
    );
    await createJiraPrivacyRepository(env.DB).recordOperationalIdentity(
      {
        provider: "jira",
        nangoConnectionId: "owner",
        nangoIntegrationId: "jira",
      },
      identity("acct-owner", "2026-01-01T00:00:00.000Z"),
    );
    const client = nango();
    client.proxy.mockImplementation(async (input) =>
      input.path === "/app/report-accounts/"
        ? Response.json(
            { accounts: [{ accountId: "acct-one", status: "closed" }] },
            { headers: { "Cycle-Period": "unverified" } },
          )
        : input.path.endsWith("/myself")
          ? Response.json({ accountId: "acct-owner", active: true })
          : Response.json([
              {
                id: "12345678-1234-1234-1234-123456789abc",
                scopes: ["read:jira-user"],
              },
            ]),
    );
    await expect(
      runJiraPrivacyMaintenance(env.DB, configuration, client, now),
    ).rejects.toThrow();
    expect(client.deleteConnection).toHaveBeenCalledWith("member", "jira");
    expect(
      await env.DB.prepare(
        "SELECT account_id FROM jira_privacy_accounts WHERE account_id='acct-one'",
      ).first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT blocked_reason FROM jira_privacy_accounts WHERE account_id='acct-owner'",
      ).first(),
    ).toMatchObject({ blocked_reason: "unsupported-cycle" });
  });
  it("durably waits five minutes after a transient reporter identity failure", async () => {
    const client = nango();
    client.proxy.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(
      runJiraPrivacyMaintenance(env.DB, configuration, client, now),
    ).rejects.toMatchObject({ code: "JIRA_PRIVACY_REPORT_FAILED" });
    const attempts = client.proxy.mock.calls.length;
    await expect(
      runJiraPrivacyMaintenance(
        env.DB,
        configuration,
        client,
        "2026-07-01T00:02:00.000Z",
      ),
    ).rejects.toMatchObject({ code: "JIRA_PRIVACY_REPORT_FAILED" });
    expect(client.proxy.mock.calls.length).toBe(attempts);
    expect(
      (await createJiraPrivacyRepository(env.DB).getOperationalState("jira"))
        .reporterRetryAt,
    ).toBe("2026-07-01T00:05:00.000Z");
  });

  it("identifies actual owner authorization rejection without exposing upstream content", async () => {
    const client = nango();
    client.proxy.mockResolvedValue(
      Response.json({ secret: "upstream private body" }, { status: 401 }),
    );
    await expect(
      runJiraPrivacyMaintenance(env.DB, configuration, client, now),
    ).rejects.toMatchObject({ code: "JIRA_PRIVACY_REPORT_AUTH_REQUIRED" });
  });

  it("does no database or network work when Jira is disabled", async () => {
    const client = nango();
    await runJiraPrivacyMaintenance({} as D1Database, {}, client, now);
    expect(client.proxy).not.toHaveBeenCalled();
  });
});
