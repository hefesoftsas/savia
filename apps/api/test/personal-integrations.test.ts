import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { PendingActionRepository } from "../src/assistant/pending-actions";
import { PersonalActionPayloadCipher } from "../src/assistant/personal-action-payload";
import { PersonalIntegrationOperations } from "../src/personal-integrations/operations";
import { createPersonalIntegrationProviderRegistry } from "../src/personal-integrations/providers";
import { createPersonalIntegrationRepository } from "../src/personal-integrations/repository";
import { agencyMemberAuthenticator } from "./auth-fixtures";

const migrationSqls = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, sql]) => sql);

async function applyMigrations() {
  for (const migration of migrationSqls) {
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((value) =>
        value
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)) {
      await env.DB.exec(statement);
    }
  }
}

async function seedPrincipal() {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_principal (
      id, issuer, subject, email, display_name, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      "test-agency-member",
      "savia:better-auth",
      "test-agency-member",
      "member@savia.test",
      "Savia Test Member",
      1,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    )
    .run();
}

const configuredProviders = createPersonalIntegrationProviderRegistry({
  googleDriveIntegrationId: "google-drive-savia",
  gmailIntegrationId: "gmail-savia",
  googleCalendarIntegrationId: "google-calendar-savia",
  outlookIntegrationId: "outlook-savia",
  oneDrivePersonalIntegrationId: "onedrive-personal-savia",
  oneDriveBusinessIntegrationId: "onedrive-business-savia",
  jiraIntegrationId: "jira-savia",
  linearIntegrationId: "linear-savia",
  githubIntegrationId: "github-savia",
});
const payloadCipher = new PersonalActionPayloadCipher("test-mcp-shared-secret");

function configuredApp(nango = fakeNango()) {
  return createApp(
    env.DB,
    undefined,
    undefined,
    agencyMemberAuthenticator(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      providers: configuredProviders,
      nango,
      personalActionPayloadCipher: payloadCipher,
    } as never,
  );
}

function fakeNango() {
  return {
    createConnectSession: vi.fn().mockResolvedValue({
      token: "short-lived-connect-token",
      expiresAt: "2026-01-01T01:00:00.000Z",
      connectUrl: "https://connect.nango.example.test",
      apiUrl: "https://nango.example.test",
    }),
    getConnection: vi.fn().mockResolvedValue({
      connectionId: "nango-gmail-connection",
      providerConfigKey: "gmail-savia",
      tags: {
        end_user_id: "test-agency-member",
        end_user_email: "member@savia.test",
        end_user_display_name: "Savia Test Member",
      },
      metadata: {
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        account_name: "member@savia.test",
      },
    }),
    createReconnectSession: vi.fn().mockResolvedValue({
      token: "short-lived-reconnect-token",
      expiresAt: "2026-01-01T01:00:00.000Z",
      connectUrl: "https://connect.nango.example.test",
      apiUrl: "https://nango.example.test",
    }),
    deleteConnection: vi.fn().mockResolvedValue(undefined),
    proxy: vi.fn().mockResolvedValue(
      Response.json({
        files: [
          {
            id: "drive-file-1",
            name: "Renovación póliza.pdf",
            mimeType: "application/pdf",
            modifiedTime: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    ),
  };
}

async function seedGoogleBooking(
  connectionId: string,
  input: { id: string; externalId?: string },
) {
  const tenantId = Date.now() * 10 + Math.floor(Math.random() * 10);
  const uniqueId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?, 'Calendar delete test',1,'now','now')",
  )
    .bind(tenantId, `calendar-delete-${uniqueId}`)
    .run();
  await env.DB.prepare(
    `INSERT INTO tenant_bookings (
      id, tenant_id, professional_id, principal_id, service_id, service_name,
      professional_name, starts_at, ends_at, buffer_minutes, customer_name,
      customer_email, manage_token, request_key, request_hash, status, version,
      calendar_provider, calendar_connection_id, external_id, created_at
    ) VALUES (?, ?, 'professional-1', ?, 'service-1', 'Consultation', 'Professional',
      '2026-01-01T10:00:00.000Z', '2026-01-01T10:30:00.000Z', 0, 'Customer',
      'customer@example.test', ?, ?, 'request-hash', 'confirmed', 1,
      'google_calendar', ?, ?, '2026-01-01T00:00:00.000Z')`,
  )
    .bind(
      input.id,
      tenantId,
      "test-agency-member",
      `manage-${uniqueId}`,
      `request-${uniqueId}`,
      connectionId,
      input.externalId ?? null,
    )
    .run();
}

describe("personal integration providers", () => {
  beforeAll(applyMigrations);
  beforeEach(async () => {
    await env.DB.exec(`
      DELETE FROM jira_privacy_connections;
      DELETE FROM jira_privacy_accounts;
      DELETE FROM personal_integration_audit_events;
      DELETE FROM personal_integration_connections;
      DELETE FROM identity_principal WHERE id = 'test-agency-member';
    `);
    await seedPrincipal();
  });

  it("lists all nine personal providers for an authenticated user", async () => {
    const app = createApp(
      env.DB,
      undefined,
      undefined,
      agencyMemberAuthenticator(),
    );

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/providers",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: expect.arrayContaining([
        expect.objectContaining({ id: "google_drive" }),
        expect.objectContaining({ id: "gmail" }),
        expect.objectContaining({
          id: "google_calendar",
          attributes: expect.objectContaining({
            capabilities: ["events:read", "events:create", "events:delete"],
          }),
        }),
        expect.objectContaining({
          id: "outlook",
          attributes: expect.objectContaining({
            capabilities: expect.arrayContaining(["events:delete"]),
          }),
        }),
        expect.objectContaining({ id: "onedrive_personal" }),
        expect.objectContaining({ id: "onedrive_business" }),
        expect.objectContaining({
          id: "jira",
          attributes: expect.objectContaining({
            capabilities: ["issues:read"],
          }),
        }),
        expect.objectContaining({
          id: "linear",
          attributes: expect.objectContaining({
            capabilities: ["issues:read"],
          }),
        }),
        expect.objectContaining({
          id: "github",
          attributes: expect.objectContaining({
            capabilities: ["issues:read"],
          }),
        }),
      ]),
    });
  });

  it.each([
    ["google_drive", "google-drive-savia"],
    ["gmail", "gmail-savia"],
    ["google_calendar", "google-calendar-savia"],
    ["outlook", "outlook-savia"],
    ["onedrive_personal", "onedrive-personal-savia"],
    ["onedrive_business", "onedrive-business-savia"],
    ["jira", "jira-savia"],
    ["linear", "linear-savia"],
    ["github", "github-savia"],
  ] as const)(
    "creates a scoped Nango session for %s",
    async (provider, integrationId) => {
      const nango = fakeNango();
      const app = configuredApp(nango);

      const response = await app.request(
        `https://savia.test/v1/personal-integrations/connections/${provider}/connect-session`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      expect(nango.createConnectSession).toHaveBeenCalledWith(
        expect.objectContaining({ provider, integrationId }),
      );
    },
  );

  it("verifies Jira identity before persisting its report inventory", async () => {
    const nango = fakeNango();
    nango.getConnection.mockResolvedValue({
      connectionId: "jira-member",
      providerConfigKey: "jira-savia",
      tags: {
        end_user_id: "test-agency-member",
        end_user_email: "member@savia.test",
        end_user_display_name: "Member",
      },
      metadata: {
        scopes: ["read:jira-user"],
        account_name: "Untrusted name",
        account_id: "Untrusted-id",
      },
    });
    nango.proxy
      .mockResolvedValueOnce(
        Response.json([
          {
            id: "12345678-1234-1234-1234-123456789abc",
            scopes: ["read:jira-user"],
          },
        ]),
      )
      .mockResolvedValueOnce(
        Response.json({
          accountId: "verified:123",
          displayName: "Verified Member",
          active: true,
        }),
      );
    const app = configuredApp(nango);
    const response = await app.request(
      "https://savia.test/v1/personal-integrations/connections/jira/complete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "jira-member" }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { attributes: { externalAccountLabel: "Verified Member" } },
    });
    const account = await env.DB.prepare(
      "SELECT account_id FROM jira_privacy_accounts",
    ).first();
    expect(account).toEqual({ account_id: "verified:123" });
    const connection = await createPersonalIntegrationRepository(
      env.DB,
    ).findActiveConnection("test-agency-member", "jira");
    expect(connection?.externalAccountId).toBe("verified:123");
    expect(connection?.jiraPrivacyGeneration).toBeTruthy();
    const listed = await app.request(
      "https://savia.test/v1/personal-integrations/connections",
    );
    const body = JSON.stringify(await listed.json());
    expect(body).not.toContain("verified:123");
    expect(body).not.toContain(connection!.jiraPrivacyGeneration!);
    expect(
      (
        await app.request(
          "https://savia.test/v1/personal-integrations/connections/jira",
          { method: "DELETE" },
        )
      ).status,
    ).toBe(204);
    expect(
      await env.DB.prepare(
        "SELECT account_id FROM jira_privacy_accounts",
      ).first(),
    ).toBeNull();
    expect(
      await createPersonalIntegrationRepository(env.DB).findActiveConnection(
        "test-agency-member",
        "jira",
      ),
    ).toBeUndefined();
  });

  it("rejects Jira completion if Atlassian identity cannot be verified", async () => {
    const nango = fakeNango();
    nango.getConnection.mockResolvedValue({
      connectionId: "jira-member",
      providerConfigKey: "jira-savia",
      tags: {
        end_user_id: "test-agency-member",
        end_user_email: "member@savia.test",
        end_user_display_name: "Member",
      },
      metadata: { scopes: [], account_name: "Untrusted" },
    });
    nango.proxy.mockResolvedValue(Response.json([]));
    const response = await configuredApp(nango).request(
      "https://savia.test/v1/personal-integrations/connections/jira/complete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "jira-member" }),
      },
    );
    expect(response.status).toBe(502);
    expect(
      await env.DB.prepare(
        "SELECT id FROM personal_integration_connections",
      ).first(),
    ).toBeNull();
  });

  it("connects and lists only safe metadata for the authenticated user", async () => {
    const nango = fakeNango();
    const app = configuredApp(nango);

    const session = await app.request(
      "https://savia.test/v1/personal-integrations/connections/gmail/connect-session",
      { method: "POST" },
    );
    expect(session.status).toBe(200);
    expect(nango.createConnectSession).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "gmail",
        integrationId: "gmail-savia",
      }),
    );

    const completion = await app.request(
      "https://savia.test/v1/personal-integrations/connections/gmail/complete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: "nango-gmail-connection" }),
      },
    );
    expect(completion.status).toBe(200);

    const listed = await app.request(
      "https://savia.test/v1/personal-integrations/connections",
    );
    expect(await listed.json()).toEqual({
      data: [
        {
          id: expect.any(String),
          kind: "personal-integration-connection",
          attributes: {
            provider: "gmail",
            status: "connected",
            externalAccountLabel: "member@savia.test",
            scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
            lastValidatedAt: expect.any(String),
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
          },
        },
      ],
    });
  });

  it("reconnects and disconnects only the caller's saved connection", async () => {
    const nango = fakeNango();
    const app = configuredApp(nango);
    const complete = () =>
      app.request(
        "https://savia.test/v1/personal-integrations/connections/gmail/complete",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ connectionId: "nango-gmail-connection" }),
        },
      );
    expect((await complete()).status).toBe(200);

    const reconnect = await app.request(
      "https://savia.test/v1/personal-integrations/connections/gmail/reconnect-session",
      { method: "POST" },
    );
    expect(reconnect.status).toBe(200);
    expect(nango.createReconnectSession).toHaveBeenCalledWith({
      connectionId: "nango-gmail-connection",
      integrationId: "gmail-savia",
    });

    const disconnected = await app.request(
      "https://savia.test/v1/personal-integrations/connections/gmail",
      { method: "DELETE" },
    );
    expect(disconnected.status).toBe(204);
    expect(nango.deleteConnection).toHaveBeenCalledWith(
      "nango-gmail-connection",
      "gmail-savia",
    );
    await expect(
      app.request("https://savia.test/v1/personal-integrations/connections"),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      app
        .request("https://savia.test/v1/personal-integrations/connections")
        .then((response) => response.json()),
    ).resolves.toEqual({ data: [] });
  });

  it("searches a caller-owned Drive connection through a fixed Nango operation", async () => {
    const nango = fakeNango();
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-drive-connection",
        "test-agency-member",
        "google_drive",
        "nango-drive-connection",
        "google-drive-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/files?provider=google_drive&query=Renovacion",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: "drive-file-1",
          name: "Renovación póliza.pdf",
          mimeType: "application/pdf",
          modifiedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: expect.stringContaining("/drive/v3/files?"),
        connection: expect.objectContaining({
          nangoConnectionId: "nango-drive-connection",
        }),
      }),
    );
  });

  it("previews a Jira issue only after matching the connected account's site", async () => {
    const nango = fakeNango();
    nango.proxy
      .mockResolvedValueOnce(
        Response.json([{ id: "cloud-1", url: "https://acme.atlassian.net" }]),
      )
      .mockResolvedValueOnce(
        Response.json({
          key: "OPS-42",
          fields: {
            summary: "Review the renewal",
            status: { name: "In Progress" },
            assignee: { displayName: "Alex Rivera" },
          },
        }),
      );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-jira-connection",
        "test-agency-member",
        "jira",
        "nango-jira-connection",
        "jira-savia",
        "connected",
        '["read:jira-work"]',
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/issue-preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://acme.atlassian.net/browse/OPS-42",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: {
        provider: "jira",
        url: "https://acme.atlassian.net/browse/OPS-42",
        identifier: "OPS-42",
        title: "Review the renewal",
        status: "In Progress",
        assignee: "Alex Rivera",
      },
    });
    expect(nango.proxy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "GET",
        path: "/oauth/token/accessible-resources",
      }),
    );
    expect(nango.proxy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "GET",
        path: "/ex/jira/cloud-1/rest/api/3/issue/OPS-42?fields=summary%2Cstatus%2Cassignee%2Ckey",
      }),
    );
  });

  it("previews a Linear issue with a fixed GraphQL operation", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        data: {
          issue: {
            identifier: "ENG-7",
            url: "https://linear.app/acme/issue/ENG-7/fix-the-dashboard",
            title: "Fix the dashboard",
            state: { name: "Todo" },
            assignee: null,
          },
        },
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-linear-connection",
        "test-agency-member",
        "linear",
        "nango-linear-connection",
        "linear-savia",
        "connected",
        '["read"]',
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/issue-preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://linear.app/acme/issue/ENG-7/fix-the-dashboard",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        provider: "linear",
        url: "https://linear.app/acme/issue/ENG-7/fix-the-dashboard",
        identifier: "ENG-7",
        title: "Fix the dashboard",
        status: "Todo",
        assignee: null,
      },
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: "/graphql" }),
    );
  });

  it("previews a GitHub issue through the caller's connection and fixed API path", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        number: 42,
        html_url: "https://github.com/acme/widgets/issues/42",
        title: "Handle renewal",
        state: "open",
        assignee: { login: "alex" },
        repository: { full_name: "acme/widgets" },
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-github-issue",
        "test-agency-member",
        "github",
        "nango-github-connection",
        "github-savia",
        "connected",
        '["repo"]',
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();

    const response = await configuredApp(nango).request(
      "https://savia.test/v1/personal-integrations/issue-preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://github.com/acme/widgets/issues/42",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: {
        provider: "github",
        url: "https://github.com/acme/widgets/issues/42",
        identifier: "acme/widgets#42",
        title: "Handle renewal",
        status: "open",
        assignee: "alex",
        repository: "acme/widgets",
        kind: "issue",
      },
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/repos/acme/widgets/issues/42",
        upstreamHeaders: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
        connection: expect.objectContaining({
          provider: "github",
          nangoConnectionId: "nango-github-connection",
          nangoIntegrationId: "github-savia",
        }),
      }),
    );
  });

  it("previews a GitHub pull request and reports merged state", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        number: 42,
        html_url: "https://github.com/acme/widgets/pull/42",
        title: "Ship renewal handling",
        state: "closed",
        merged_at: "2026-01-03T00:00:00Z",
        assignee: null,
        base: { repo: { full_name: "acme/widgets" } },
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-github-pull",
        "test-agency-member",
        "github",
        "nango-github-connection",
        "github-savia",
        "connected",
        '["repo"]',
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();

    const response = await configuredApp(nango).request(
      "https://savia.test/v1/personal-integrations/issue-preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://github.com/acme/widgets/pull/42",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        provider: "github",
        url: "https://github.com/acme/widgets/pull/42",
        identifier: "acme/widgets#42",
        title: "Ship renewal handling",
        status: "merged",
        assignee: null,
        repository: "acme/widgets",
        kind: "pull_request",
      },
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/repos/acme/widgets/pulls/42",
      }),
    );
  });

  it("rejects GitHub preview metadata that resolves to a different issue", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        number: 43,
        html_url: "https://github.com/acme/widgets/issues/43",
        title: "Unrelated issue",
        state: "open",
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-github-mismatch",
        "test-agency-member",
        "github",
        "nango-github-connection",
        "github-savia",
        "connected",
        '["repo"]',
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();

    const response = await configuredApp(nango).request(
      "https://savia.test/v1/personal-integrations/issue-preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://github.com/acme/widgets/issues/42",
        }),
      },
    );

    expect(response.status).toBe(502);
  });

  it("rejects a GitHub pull request returned for an issue link", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        number: 42,
        html_url: "https://github.com/acme/widgets/pull/42",
        title: "Not the linked issue",
        state: "open",
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-github-kind-mismatch",
        "test-agency-member",
        "github",
        "nango-github-connection",
        "github-savia",
        "connected",
        '["repo"]',
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();

    const response = await configuredApp(nango).request(
      "https://savia.test/v1/personal-integrations/issue-preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://github.com/acme/widgets/issues/42",
        }),
      },
    );

    expect(response.status).toBe(502);
  });

  it("returns a controlled GitHub access error for a forbidden upstream response", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-github-forbidden",
        "test-agency-member",
        "github",
        "nango-github-connection",
        "github-savia",
        "connected",
        '["repo"]',
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();

    const response = await configuredApp(nango).request(
      "https://savia.test/v1/personal-integrations/issue-preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://github.com/acme/widgets/issues/42",
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(nango.proxy).toHaveBeenCalledTimes(1);
  });

  it("does not preview a GitHub link without the caller's own connection", async () => {
    const nango = fakeNango();
    const response = await configuredApp(nango).request(
      "https://savia.test/v1/personal-integrations/issue-preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://github.com/acme/widgets/issues/42",
        }),
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("rejects a Linear issue resolved from a different workspace", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        data: {
          issue: {
            identifier: "ENG-7",
            url: "https://linear.app/another-team/issue/ENG-7/fix-the-dashboard",
            title: "A different team's issue",
            state: { name: "Todo" },
            assignee: null,
          },
        },
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-linear-workspace-mismatch",
        "test-agency-member",
        "linear",
        "nango-linear-connection",
        "linear-savia",
        "connected",
        '["read"]',
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/issue-preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://linear.app/acme/issue/ENG-7/fix-the-dashboard",
        }),
      },
    );

    expect(response.status).toBe(502);
  });

  it("rejects issue links outside the allow-listed hosts without contacting Nango", async () => {
    const nango = fakeNango();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/issue-preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://linear.app.attacker.test/acme/issue/ENG-7",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("returns a controlled access error when the connected Jira account lacks the linked site", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json([
        { id: "other-cloud", url: "https://other.atlassian.net" },
      ]),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-jira-site-mismatch",
        "test-agency-member",
        "jira",
        "nango-jira-connection",
        "jira-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/issue-preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://acme.atlassian.net/browse/OPS-42",
        }),
      },
    );

    expect(response.status, await response.clone().text()).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "PERSONAL_INTEGRATION_ACCESS_DENIED",
        message: "The personal integration does not belong to this user",
      },
    });
    expect(nango.proxy).toHaveBeenCalledTimes(1);
  });

  it("returns a controlled unavailable response when the caller has no issue connection", async () => {
    const nango = fakeNango();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/issue-preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://linear.app/acme/issue/ENG-7" }),
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("searches a caller-owned OneDrive connection through its fixed Graph operation", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        value: [
          {
            id: "onedrive-file-1",
            name: "Renovacion.docx",
            file: {
              mimeType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            },
            lastModifiedDateTime: "2026-01-02T00:00:00.000Z",
          },
        ],
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-onedrive-connection",
        "test-agency-member",
        "onedrive_business",
        "nango-onedrive-connection",
        "onedrive-business-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/files?provider=onedrive_business&query=Renovacion",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: "onedrive-file-1",
          name: "Renovacion.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          modifiedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("/v1.0/me/drive/root/search"),
        connection: expect.objectContaining({
          nangoConnectionId: "nango-onedrive-connection",
        }),
      }),
    );
  });

  it("lists Gmail message metadata through a fixed personal operation", async () => {
    const nango = fakeNango();
    nango.proxy
      .mockResolvedValueOnce(
        Response.json({
          messages: [
            {
              id: "ab12",
              threadId: "cd34",
            },
          ],
          nextPageToken: "gmail-page-2",
        }),
      )
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(
        Response.json({ emailAddress: "actual@savia.test" }),
      );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, external_account_label, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-gmail-read-connection",
        "test-agency-member",
        "gmail",
        "nango-gmail-read-connection",
        "gmail-savia",
        "connected",
        "wrong-account@savia.test",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/messages?provider=gmail&query=renovacion",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: "ab12",
          subject: null,
          sender: null,
          receivedAt: null,
          webLink:
            "https://mail.google.com/mail/?authuser=actual%40savia.test#all/cd34",
        },
      ],
      pagination: { nextCursor: expect.any(String) },
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("/gmail/v1/users/me/messages?"),
      }),
    );
  });

  it("keeps listMessages as an array-returning first-page compatibility wrapper", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        messages: [{ id: "gmail-compat-message", threadId: "thread-compat" }],
        nextPageToken: "ignored-by-array-wrapper",
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-gmail-compat-connection",
        "test-agency-member",
        "gmail",
        "nango-gmail-compat-connection",
        "gmail-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const operations = new PersonalIntegrationOperations(
      createPersonalIntegrationRepository(env.DB),
      nango,
    );

    await expect(
      operations.listMessages({
        principalId: "test-agency-member",
        provider: "gmail",
      }),
    ).resolves.toEqual([
      {
        id: "gmail-compat-message",
        subject: null,
        sender: null,
        receivedAt: null,
        webLink: null,
      },
    ]);
  });

  it("uses a Gmail continuation token for the next page while preserving the fixed query", async () => {
    const nango = fakeNango();
    nango.proxy
      .mockResolvedValueOnce(
        Response.json({ messages: [], nextPageToken: "gmail-page-2" }),
      )
      .mockResolvedValueOnce(Response.json({ messages: [] }));
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-gmail-page-connection",
        "test-agency-member",
        "gmail",
        "nango-gmail-page-connection",
        "gmail-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const first = await app.request(
      "https://savia.test/v1/personal-integrations/messages?provider=gmail&query=renewal",
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      pagination: { nextCursor: string };
    };
    expect(first.status).toBe(200);
    expect(firstBody.pagination.nextCursor).toEqual(expect.any(String));

    const second = await app.request(
      `https://savia.test/v1/personal-integrations/messages?provider=gmail&query=renewal&cursor=${encodeURIComponent(firstBody.pagination.nextCursor)}`,
    );

    expect(second.status).toBe(200);
    expect(nango.proxy).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        path: expect.stringContaining("/gmail/v1/users/me/messages?"),
      }),
    );
    const continuationPath = nango.proxy.mock.calls[2]?.[0]?.path as string;
    expect(
      new URL(
        continuationPath,
        "https://gmail.googleapis.com",
      ).searchParams.get("pageToken"),
    ).toBe("gmail-page-2");
    expect(
      new URL(
        continuationPath,
        "https://gmail.googleapis.com",
      ).searchParams.get("q"),
    ).toBe("renewal");
  });

  it("rejects malformed and provider-mismatched mail cursors", async () => {
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-gmail-invalid-cursor-connection",
        "test-agency-member",
        "gmail",
        "nango-gmail-invalid-cursor-connection",
        "gmail-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-outlook-invalid-cursor-connection",
        "test-agency-member",
        "outlook",
        "nango-outlook-invalid-cursor-connection",
        "outlook-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({ messages: [], nextPageToken: "gmail-only-next-page" }),
    );
    const app = configuredApp(nango);

    const malformed = await app.request(
      "https://savia.test/v1/personal-integrations/messages?provider=gmail&cursor=not-a-cursor",
    );
    expect(malformed.status).toBe(400);

    const gmailFirstPage = await app.request(
      "https://savia.test/v1/personal-integrations/messages?provider=gmail",
    );
    const gmailPage = (await gmailFirstPage.json()) as {
      pagination: { nextCursor: string };
    };
    const mismatched = await app.request(
      `https://savia.test/v1/personal-integrations/messages?provider=outlook&cursor=${encodeURIComponent(gmailPage.pagination.nextCursor)}`,
    );
    expect(mismatched.status).toBe(400);
    expect(nango.proxy).toHaveBeenCalledTimes(2);
    expect(nango.proxy.mock.calls[1]?.[0]?.path).toBe(
      "/gmail/v1/users/me/profile",
    );
  });

  it.each([
    "/v1.0/me/mailFolders/inbox/messages",
    "/v1.0/me/mailFolders('inbox')/messages",
  ])(
    "follows scoped Graph continuation at %s and rejects unsafe links",
    async (nextPath) => {
      const nango = fakeNango();
      nango.proxy
        .mockResolvedValueOnce(
          Response.json({
            value: [],
            "@odata.nextLink": `https://graph.microsoft.com${nextPath}?$top=25&$select=id%2Csubject%2Cfrom%2CreceivedDateTime%2CwebLink&$orderby=receivedDateTime%20desc&$skiptoken=opaque-page-2`,
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            value: [],
            "@odata.nextLink": `https://graph.microsoft.com${nextPath}?$top=25&$select=id%2Csubject%2Cfrom%2CreceivedDateTime%2CwebLink&$orderby=receivedDateTime%20desc&$skip=50`,
          }),
        )
        .mockResolvedValueOnce(Response.json({ value: [] }));
      await env.DB.prepare(
        `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          "personal-outlook-page-connection",
          "test-agency-member",
          "outlook",
          "nango-outlook-page-connection",
          "outlook-savia",
          "connected",
          "[]",
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T00:00:00.000Z",
        )
        .run();
      const app = configuredApp(nango);

      const first = await app.request(
        "https://savia.test/v1/personal-integrations/messages?provider=outlook",
      );
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as {
        pagination: { nextCursor: string };
      };
      expect(firstBody.pagination.nextCursor).toEqual(expect.any(String));
      const second = await app.request(
        `https://savia.test/v1/personal-integrations/messages?provider=outlook&cursor=${encodeURIComponent(firstBody.pagination.nextCursor)}`,
      );
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as {
        pagination: { nextCursor: string };
      };
      expect(secondBody.pagination.nextCursor).toEqual(expect.any(String));
      const continuationPath = nango.proxy.mock.calls[1]?.[0]?.path as string;
      const params = new URL(continuationPath, "https://graph.microsoft.com")
        .searchParams;
      expect(params.get("$top")).toBe("25");
      expect(params.get("$select")).toBe(
        "id,subject,from,receivedDateTime,webLink",
      );
      expect(params.get("$orderby")).toBe("receivedDateTime desc");
      expect(params.get("$skiptoken")).toBe("opaque-page-2");
      const third = await app.request(
        `https://savia.test/v1/personal-integrations/messages?provider=outlook&cursor=${encodeURIComponent(secondBody.pagination.nextCursor)}`,
      );
      expect(third.status).toBe(200);
      const thirdPath = nango.proxy.mock.calls[2]?.[0]?.path as string;
      expect(
        new URL(thirdPath, "https://graph.microsoft.com").searchParams.get(
          "$skip",
        ),
      ).toBe("50");

      for (const unsafeNextLink of [
        "https://attacker.example/v1.0/me/mailFolders/inbox/messages?$skiptoken=stolen",
        "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=stolen",
        "https://graph.microsoft.com/v1.0/me/mailFolders('sentitems')/messages?$skiptoken=stolen",
        "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=10&$skiptoken=stolen",
      ]) {
        nango.proxy.mockResolvedValueOnce(
          Response.json({ value: [], "@odata.nextLink": unsafeNextLink }),
        );
        const unsafe = await app.request(
          "https://savia.test/v1/personal-integrations/messages?provider=outlook",
        );
        expect(unsafe.status).toBe(502);
      }
    },
  );

  it("lists Google Calendar events through a fixed personal operation", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        items: [
          {
            id: "calendar-event-1",
            summary: "Renovación Acme",
            start: { dateTime: "2026-01-03T09:00:00-05:00" },
            end: { dateTime: "2026-01-03T09:30:00-05:00" },
          },
        ],
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-calendar-read-connection",
        "test-agency-member",
        "google_calendar",
        "nango-calendar-read-connection",
        "google-calendar-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events?provider=google_calendar",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: "calendar-event-1",
          title: "Renovación Acme",
          startsAt: "2026-01-03T09:00:00-05:00",
          endsAt: "2026-01-03T09:30:00-05:00",
          webLink: null,
          allDay: false,
          timeZone: null,
        },
      ],
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("/calendar/v3/calendars/primary/events?"),
      }),
    );
  });

  it("deletes a confirmed caller-owned event using an encoded provider event id", async () => {
    const nango = fakeNango();
    nango.proxy
      .mockResolvedValueOnce(Response.json({ id: "event?part&other" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-calendar-delete-connection",
        "test-agency-member",
        "google_calendar",
        "nango-calendar-delete-connection",
        "google-calendar-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events/google_calendar/event%3Fpart%26other",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          connectionId: "personal-calendar-delete-connection",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(nango.proxy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "GET",
        path: "/calendar/v3/calendars/primary/events/event%3Fpart%26other",
      }),
    );
    expect(nango.proxy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "DELETE",
        path: "/calendar/v3/calendars/primary/events/event%3Fpart%26other",
      }),
    );
  });

  it("deletes one Outlook occurrence without putting projection parameters on DELETE", async () => {
    const nango = fakeNango();
    const connectionId = "personal-outlook-delete-connection";
    nango.proxy
      .mockResolvedValueOnce(
        Response.json({ id: "event?part&other", type: "occurrence" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        connectionId,
        "test-agency-member",
        "outlook",
        "nango-outlook-delete-connection",
        "outlook-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events/outlook/event%3Fpart%26other",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: true, connectionId }),
      },
    );

    expect(response.status).toBe(200);
    expect(nango.proxy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "GET",
        path: expect.stringContaining("/v1.0/me/events/event%3Fpart%26other?"),
      }),
    );
    expect(nango.proxy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "DELETE",
        path: "/v1.0/me/events/event%3Fpart%26other",
      }),
    );
  });

  it("protects Outlook events marked as Savia bookings", async () => {
    const nango = fakeNango();
    const connectionId = "personal-outlook-booking-connection";
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        id: "outlook-booking-event",
        type: "singleInstance",
        singleValueExtendedProperties: [
          {
            id: "String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ab} Name SaviaBookingId",
            value: "booking-1",
          },
        ],
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        connectionId,
        "test-agency-member",
        "outlook",
        "nango-outlook-booking-connection",
        "outlook-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events/outlook/outlook-booking-event",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: true, connectionId }),
      },
    );

    expect(response.status).toBe(400);
    expect(nango.proxy).toHaveBeenCalledTimes(1);
  });

  it("requires explicit confirmation before making a provider request", async () => {
    const nango = fakeNango();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events/google_calendar/event-1",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmed: false,
          connectionId: "calendar-connection-1",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("refuses to delete a recurring Google series master", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        id: "series-1",
        recurrence: ["RRULE:FREQ=WEEKLY"],
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-calendar-series-connection",
        "test-agency-member",
        "google_calendar",
        "nango-calendar-series-connection",
        "google-calendar-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events/google_calendar/series-1",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          connectionId: "personal-calendar-series-connection",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(nango.proxy).toHaveBeenCalledTimes(1);
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("protects a Google booking event whose provider create response was lost", async () => {
    const nango = fakeNango();
    const connectionId = "personal-calendar-booking-connection";
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        connectionId,
        "test-agency-member",
        "google_calendar",
        "nango-calendar-booking-connection",
        "google-calendar-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    await seedGoogleBooking(connectionId, { id: "booking-lost-response-1" });
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events/google_calendar/2df149eddfa7678774dcfe541ddd62bc67efcbcfd91ec34ec43483b0ebf74921",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: true, connectionId }),
      },
    );

    expect(response.status).toBe(400);
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "saved provider event id",
      bookingId: "booking-old-connection-external",
      externalId: "reservation-event-old",
      eventId: "reservation-event-old",
    },
    {
      label: "hash recovery marker",
      bookingId: "booking-lost-response-old",
      eventId:
        "8369cef5d95633fa6e1a2dd32adf776720632c88da6d7ba57f6793492f3c50f2",
    },
  ])(
    "protects a booking on the same account after reconnect using its $label",
    async ({ bookingId, externalId, eventId }) => {
      const nango = fakeNango();
      const oldConnectionId = `old-${crypto.randomUUID()}`;
      const currentConnectionId = `current-${crypto.randomUUID()}`;
      await env.DB.prepare(
        `INSERT INTO personal_integration_connections (
          id, principal_id, provider, nango_connection_id, nango_integration_id,
          status, scopes, disconnected_at, created_at, updated_at
        ) VALUES (?, ?, 'google_calendar', ?, 'google-calendar-savia', ?, '[]', '2026-10-01T00:00:00.000Z', 'now', 'now')`,
      )
        .bind(
          oldConnectionId,
          "test-agency-member",
          `nango-${oldConnectionId}`,
          "disconnected",
        )
        .run();
      await env.DB.prepare(
        `INSERT INTO personal_integration_connections (
          id, principal_id, provider, nango_connection_id, nango_integration_id,
          status, scopes, created_at, updated_at
        ) VALUES (?, ?, 'google_calendar', ?, 'google-calendar-savia', 'connected', '[]', 'now', 'now')`,
      )
        .bind(
          currentConnectionId,
          "test-agency-member",
          `nango-${currentConnectionId}`,
        )
        .run();
      await seedGoogleBooking(oldConnectionId, {
        id: bookingId,
        ...(externalId ? { externalId } : {}),
      });
      nango.proxy.mockResolvedValueOnce(Response.json({ id: eventId }));
      const app = configuredApp(nango);

      const response = await app.request(
        `https://savia.test/v1/personal-integrations/events/google_calendar/${eventId}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            confirmed: true,
            connectionId: currentConnectionId,
          }),
        },
      );

      expect(response.status).toBe(400);
      expect(nango.proxy).not.toHaveBeenCalled();
    },
  );

  it("rejects deletion when the calendar connection changed after the event was loaded", async () => {
    const nango = fakeNango();
    const connectionId = "personal-calendar-reconnect-connection";
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        connectionId,
        "test-agency-member",
        "google_calendar",
        "nango-calendar-reconnect-connection",
        "google-calendar-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events/google_calendar/event-1",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          connectionId: "old-connection",
        }),
      },
    );

    expect(response.status).toBe(503);
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("reports provider deletion failures instead of returning success", async () => {
    const nango = fakeNango();
    nango.proxy
      .mockResolvedValueOnce(Response.json({ id: "event-1" }))
      .mockResolvedValueOnce(new Response("rejected", { status: 403 }));
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-calendar-failed-delete-connection",
        "test-agency-member",
        "google_calendar",
        "nango-calendar-failed-delete-connection",
        "google-calendar-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events/google_calendar/event-1",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          connectionId: "personal-calendar-failed-delete-connection",
        }),
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PERSONAL_INTEGRATION_REQUEST_FAILED" },
    });
  });

  it("lists the caller's Outlook day with links that open only in Outlook", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        value: [
          {
            id: "outlook-event-1",
            subject: "Llamar a Acme",
            start: {
              dateTime: "2026-01-03T09:00:00.0000000",
              timeZone: "UTC",
            },
            end: {
              dateTime: "2026-01-03T09:30:00.0000000",
              timeZone: "UTC",
            },
            webLink: "https://outlook.office.com/calendar/item/outlook-event-1",
          },
        ],
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-outlook-day-connection",
        "test-agency-member",
        "outlook",
        "nango-outlook-day-connection",
        "outlook-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events?provider=outlook&from=2026-01-03T05%3A00%3A00.000Z&to=2026-01-04T05%3A00%3A00.000Z",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: "outlook-event-1",
          title: "Llamar a Acme",
          startsAt: "2026-01-03T09:00:00.0000000Z",
          endsAt: "2026-01-03T09:30:00.0000000Z",
          webLink: "https://outlook.office.com/calendar/item/outlook-event-1",
          allDay: false,
          timeZone: "UTC",
        },
      ],
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: expect.stringContaining("/v1.0/me/calendarView?"),
        upstreamHeaders: { prefer: 'outlook.timezone="UTC"' },
      }),
    );
  });

  it("creates a confirmed My Day task in the caller's Outlook calendar", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        id: "outlook-event-2",
        subject: "Preparar propuesta",
        start: {
          dateTime: "2026-01-03T10:00:00.0000000",
          timeZone: "UTC",
        },
        end: {
          dateTime: "2026-01-03T10:30:00.0000000",
          timeZone: "UTC",
        },
        webLink: "https://outlook.office.com/calendar/item/outlook-event-2",
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-outlook-create-connection",
        "test-agency-member",
        "outlook",
        "nango-outlook-create-connection",
        "outlook-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "outlook",
          title: "Preparar propuesta",
          startsAt: "2026-01-03T15:00:00.000Z",
          endsAt: "2026-01-03T15:30:00.000Z",
        }),
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: {
        id: "outlook-event-2",
        connectionId: "personal-outlook-create-connection",
        title: "Preparar propuesta",
        startsAt: "2026-01-03T10:00:00.0000000Z",
        endsAt: "2026-01-03T10:30:00.0000000Z",
        webLink: "https://outlook.office.com/calendar/item/outlook-event-2",
      },
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/v1.0/me/events",
        upstreamHeaders: { prefer: 'outlook.timezone="UTC"' },
        body: {
          subject: "Preparar propuesta",
          start: { dateTime: "2026-01-03T15:00:00", timeZone: "UTC" },
          end: { dateTime: "2026-01-03T15:30:00", timeZone: "UTC" },
        },
      }),
    );
  });

  it("creates a confirmed My Day task in the caller's Google calendar", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        id: "google-event-2",
        summary: "Preparar propuesta",
        start: { dateTime: "2026-01-03T15:00:00.000Z" },
        end: { dateTime: "2026-01-03T15:30:00.000Z" },
        htmlLink:
          "https://calendar.google.com/calendar/event?eid=google-event-2",
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-google-calendar-create-connection",
        "test-agency-member",
        "google_calendar",
        "nango-google-calendar-create-connection",
        "google-calendar-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google_calendar",
          title: "Preparar propuesta",
          startsAt: "2026-01-03T15:00:00.000Z",
          endsAt: "2026-01-03T15:30:00.000Z",
        }),
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: {
        id: "google-event-2",
        connectionId: "personal-google-calendar-create-connection",
        title: "Preparar propuesta",
        startsAt: "2026-01-03T15:00:00.000Z",
        endsAt: "2026-01-03T15:30:00.000Z",
        webLink:
          "https://calendar.google.com/calendar/event?eid=google-event-2",
      },
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/calendar/v3/calendars/primary/events",
        body: {
          summary: "Preparar propuesta",
          start: { dateTime: "2026-01-03T15:00:00.000Z" },
          end: { dateTime: "2026-01-03T15:30:00.000Z" },
        },
      }),
    );
  });

  it("creates a Google Calendar event with Meet when the calendar supports it", async () => {
    const nango = fakeNango();
    nango.proxy
      .mockResolvedValueOnce(
        Response.json({
          conferenceProperties: {
            allowedConferenceSolutionTypes: ["hangoutsMeet"],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "google-meet-event",
          summary: "Meet Acme",
          start: { dateTime: "2026-01-03T15:00:00.000Z" },
          end: { dateTime: "2026-01-03T15:30:00.000Z" },
          conferenceData: {
            createRequest: { status: { statusCode: "success" } },
            conferenceSolution: { key: { type: "hangoutsMeet" } },
            entryPoints: [
              {
                entryPointType: "video",
                uri: "https://meet.google.com/abc-defg-hij",
              },
            ],
          },
        }),
      );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-google-meet-create-connection",
        "test-agency-member",
        "google_calendar",
        "nango-google-meet-create-connection",
        "google-calendar-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google_calendar",
          title: "Meet Acme",
          startsAt: "2026-01-03T15:00:00.000Z",
          endsAt: "2026-01-03T15:30:00.000Z",
          videoCall: true,
        }),
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: "google-meet-event",
        connectionId: "personal-google-meet-create-connection",
        conference: {
          provider: "google_meet",
          joinUrl: "https://meet.google.com/abc-defg-hij",
          status: "ready",
        },
      },
    });
    expect(nango.proxy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "GET",
        path: "/calendar/v3/calendars/primary",
      }),
    );
    expect(nango.proxy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "POST",
        path: "/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
        body: expect.objectContaining({
          conferenceData: expect.objectContaining({
            createRequest: expect.objectContaining({
              conferenceSolutionKey: { type: "hangoutsMeet" },
            }),
          }),
        }),
      }),
    );
  });

  it("keeps a Google event and marks conference unsupported for calendars without Meet", async () => {
    const nango = fakeNango();
    nango.proxy
      .mockResolvedValueOnce(
        Response.json({
          conferenceProperties: { allowedConferenceSolutionTypes: [] },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "google-no-meet-event",
          summary: "Meet Acme",
          start: { dateTime: "2026-01-03T15:00:00.000Z" },
          end: { dateTime: "2026-01-03T15:30:00.000Z" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [
            {
              id: "google-no-meet-event",
              summary: "Meet Acme",
              start: { dateTime: "2026-01-03T15:00:00.000Z" },
              end: { dateTime: "2026-01-03T15:30:00.000Z" },
              extendedProperties: {
                private: { saviaVideoCall: "unsupported" },
              },
            },
          ],
        }),
      );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-google-no-meet-connection",
        "test-agency-member",
        "google_calendar",
        "nango-google-no-meet-connection",
        "google-calendar-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google_calendar",
          title: "Meet Acme",
          startsAt: "2026-01-03T15:00:00.000Z",
          endsAt: "2026-01-03T15:30:00.000Z",
          videoCall: true,
        }),
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: "google-no-meet-event",
        conference: {
          provider: null,
          joinUrl: null,
          status: "unsupported",
        },
      },
    });
    expect(nango.proxy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "POST",
        path: "/calendar/v3/calendars/primary/events",
        body: expect.objectContaining({
          extendedProperties: {
            private: { saviaVideoCall: "unsupported" },
          },
        }),
      }),
    );
    const listed = await app.request(
      "https://savia.test/v1/personal-integrations/events?provider=google_calendar",
    );
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      data: [
        {
          id: "google-no-meet-event",
          conference: { provider: null, joinUrl: null, status: "unsupported" },
        },
      ],
    });
  });

  it("lists pending Google Meet requests so a later reload can resolve them", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        items: [
          {
            id: "google-pending-meet",
            summary: "Meet Acme",
            start: { dateTime: "2026-01-03T09:00:00-05:00" },
            end: { dateTime: "2026-01-03T09:30:00-05:00" },
            conferenceData: {
              createRequest: {
                conferenceSolutionKey: { type: "hangoutsMeet" },
                status: { statusCode: "pending" },
              },
            },
          },
          {
            id: "google-pending-marker-only",
            summary: "Meet Acme 2",
            start: { dateTime: "2026-01-03T10:00:00-05:00" },
            end: { dateTime: "2026-01-03T10:30:00-05:00" },
            extendedProperties: {
              private: { saviaVideoCall: "requested" },
            },
          },
          {
            id: "google-failed-marker-only",
            summary: "Meet Acme failed",
            start: { dateTime: "2026-01-03T10:30:00-05:00" },
            end: { dateTime: "2026-01-03T11:00:00-05:00" },
            extendedProperties: {
              private: { saviaVideoCall: "requested" },
            },
            conferenceData: {
              createRequest: { status: { statusCode: "failure" } },
            },
          },
          {
            id: "google-meet-hangout-link",
            summary: "Meet Acme with link",
            start: { dateTime: "2026-01-03T11:00:00-05:00" },
            end: { dateTime: "2026-01-03T11:30:00-05:00" },
            hangoutLink: "https://meet.google.com/abc-defg-hij",
          },
          {
            id: "google-classic-hangout",
            summary: "Classic hangout",
            start: { dateTime: "2026-01-03T11:00:00-05:00" },
            end: { dateTime: "2026-01-03T11:30:00-05:00" },
            conferenceData: {
              createRequest: { status: { statusCode: "failure" } },
              conferenceSolution: { key: { type: "eventHangout" } },
            },
          },
        ],
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-google-pending-list-connection",
        "test-agency-member",
        "google_calendar",
        "nango-google-pending-list-connection",
        "google-calendar-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events?provider=google_calendar",
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ id: string; conference?: unknown }>;
    };
    expect(body.data).toEqual(
      expect.arrayContaining([
        {
          id: "google-pending-meet",
          title: "Meet Acme",
          startsAt: "2026-01-03T09:00:00-05:00",
          endsAt: "2026-01-03T09:30:00-05:00",
          webLink: null,
          allDay: false,
          timeZone: null,
          conference: {
            provider: "google_meet",
            joinUrl: null,
            status: "pending",
          },
        },
        expect.objectContaining({
          id: "google-pending-marker-only",
          conference: {
            provider: "google_meet",
            joinUrl: null,
            status: "pending",
          },
        }),
        expect.objectContaining({
          id: "google-failed-marker-only",
          conference: {
            provider: "google_meet",
            joinUrl: null,
            status: "failed",
          },
        }),
        expect.objectContaining({
          id: "google-meet-hangout-link",
          conference: {
            provider: "google_meet",
            joinUrl: "https://meet.google.com/abc-defg-hij",
            status: "ready",
          },
        }),
      ]),
    );
    expect(
      body.data.find((event) => event.id === "google-classic-hangout"),
    ).not.toHaveProperty("conference");
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("conferenceDataVersion"),
      }),
    );
  });

  it("creates an Outlook event with Teams only when the calendar supports it", async () => {
    const nango = fakeNango();
    nango.proxy
      .mockResolvedValueOnce(
        Response.json({ allowedOnlineMeetingProviders: ["teamsForBusiness"] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "outlook-teams-event",
          subject: "Meet Acme",
          start: { dateTime: "2026-01-03T15:00:00Z", timeZone: "UTC" },
          end: { dateTime: "2026-01-03T15:30:00Z", timeZone: "UTC" },
          isOnlineMeeting: true,
          onlineMeetingProvider: "teamsForBusiness",
          onlineMeeting: {
            joinUrl: "https://teams.microsoft.com/l/meetup-join/abc",
          },
        }),
      );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-outlook-teams-create-connection",
        "test-agency-member",
        "outlook",
        "nango-outlook-teams-create-connection",
        "outlook-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "outlook",
          title: "Meet Acme",
          startsAt: "2026-01-03T15:00:00.000Z",
          endsAt: "2026-01-03T15:30:00.000Z",
          videoCall: true,
        }),
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: "outlook-teams-event",
        conference: {
          provider: "teams",
          joinUrl: "https://teams.microsoft.com/l/meetup-join/abc",
          status: "ready",
        },
      },
    });
    expect(nango.proxy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "GET",
        path: "/v1.0/me/calendar?$select=allowedOnlineMeetingProviders",
      }),
    );
    expect(nango.proxy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "POST",
        path: "/v1.0/me/events",
        body: expect.objectContaining({
          isOnlineMeeting: true,
          onlineMeetingProvider: "teamsForBusiness",
        }),
      }),
    );
  });

  it("retains the unsupported video call marker on Outlook events", async () => {
    const nango = fakeNango();
    nango.proxy
      .mockResolvedValueOnce(
        Response.json({ allowedOnlineMeetingProviders: ["skypeForBusiness"] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "outlook-no-teams-event",
          subject: "Meet Acme",
          start: { dateTime: "2026-01-03T15:00:00Z", timeZone: "UTC" },
          end: { dateTime: "2026-01-03T15:30:00Z", timeZone: "UTC" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          value: [
            {
              id: "outlook-no-teams-event",
              subject: "Meet Acme",
              start: { dateTime: "2026-01-03T15:00:00Z", timeZone: "UTC" },
              end: { dateTime: "2026-01-03T15:30:00Z", timeZone: "UTC" },
              singleValueExtendedProperties: [
                {
                  id: "String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ac} Name SaviaVideoCall",
                  value: "unsupported",
                },
              ],
            },
          ],
        }),
      );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-outlook-no-teams-create-connection",
        "test-agency-member",
        "outlook",
        "nango-outlook-no-teams-create-connection",
        "outlook-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const created = await app.request(
      "https://savia.test/v1/personal-integrations/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "outlook",
          title: "Meet Acme",
          startsAt: "2026-01-03T15:00:00.000Z",
          endsAt: "2026-01-03T15:30:00.000Z",
          videoCall: true,
        }),
      },
    );

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      data: {
        id: "outlook-no-teams-event",
        conference: { provider: null, joinUrl: null, status: "unsupported" },
      },
    });
    expect(nango.proxy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          singleValueExtendedProperties: [
            {
              id: "String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ac} Name SaviaVideoCall",
              value: "unsupported",
            },
          ],
        }),
      }),
    );

    const listed = await app.request(
      "https://savia.test/v1/personal-integrations/events?provider=outlook",
    );
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      data: [
        {
          id: "outlook-no-teams-event",
          conference: { provider: null, joinUrl: null, status: "unsupported" },
        },
      ],
    });
  });

  it("does not create an event when the conference capability check fails", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({ error: "consent required" }, { status: 403 }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-google-meet-capability-error-connection",
        "test-agency-member",
        "google_calendar",
        "nango-google-meet-capability-error-connection",
        "google-calendar-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "google_calendar",
          title: "Meet Acme",
          startsAt: "2026-01-03T15:00:00.000Z",
          endsAt: "2026-01-03T15:30:00.000Z",
          videoCall: true,
        }),
      },
    );

    expect(response.status).toBe(502);
    expect(nango.proxy).toHaveBeenCalledTimes(1);
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/calendar/v3/calendars/primary",
      }),
    );
  });

  it("lists pending Outlook Teams meetings without exposing an unsafe join URL", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        value: [
          {
            id: "outlook-pending-teams",
            subject: "Meet Acme",
            start: { dateTime: "2026-01-03T15:00:00Z", timeZone: "UTC" },
            end: { dateTime: "2026-01-03T15:30:00Z", timeZone: "UTC" },
            isOnlineMeeting: true,
            onlineMeetingProvider: "teamsForBusiness",
            onlineMeeting: { joinUrl: "https://attacker.example/join" },
          },
          {
            id: "outlook-pending-marker-only",
            subject: "Meet Acme 2",
            start: { dateTime: "2026-01-03T16:00:00Z", timeZone: "UTC" },
            end: { dateTime: "2026-01-03T16:30:00Z", timeZone: "UTC" },
            singleValueExtendedProperties: [
              {
                id: "String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ac} Name SaviaVideoCall",
                value: "requested",
              },
            ],
          },
          {
            id: "outlook-skype-event",
            subject: "Skype call",
            start: { dateTime: "2026-01-03T17:00:00Z", timeZone: "UTC" },
            end: { dateTime: "2026-01-03T17:30:00Z", timeZone: "UTC" },
            isOnlineMeeting: true,
            onlineMeetingProvider: "skypeForBusiness",
            onlineMeeting: { joinUrl: "https://teams.microsoft.com/legacy" },
          },
        ],
      }),
    );
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-outlook-pending-teams-list-connection",
        "test-agency-member",
        "outlook",
        "nango-outlook-pending-teams-list-connection",
        "outlook-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/events?provider=outlook&from=2026-01-03T15%3A00%3A00Z&to=2026-01-03T16%3A00%3A00Z",
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ id: string; conference?: unknown }>;
    };
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "outlook-pending-teams",
          conference: { provider: "teams", joinUrl: null, status: "pending" },
        }),
        expect.objectContaining({
          id: "outlook-pending-marker-only",
          conference: { provider: "teams", joinUrl: null, status: "pending" },
        }),
      ]),
    );
    expect(
      body.data.find((event) => event.id === "outlook-skype-event"),
    ).not.toHaveProperty("conference");
    const path = nango.proxy.mock.calls[0]?.[0]?.path as string;
    expect(
      new URL(path, "https://graph.microsoft.com").searchParams.get("$select"),
    ).toContain("onlineMeeting");
    expect(
      new URL(path, "https://graph.microsoft.com").searchParams.get("$expand"),
    ).toContain("SaviaVideoCall");
  });

  it("sends composer mail only from a caller-owned connected account", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValue(Response.json({ id: "sent" }));
    const app = configuredApp(nango);
    const payload = {
      provider: "outlook",
      to: ["recipient@example.com"],
      subject: "Update",
      body: "Please review.",
    };
    const send = () =>
      app.request("https://savia.test/v1/personal-integrations/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    expect((await send()).status).toBe(503);
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (id,principal_id,provider,nango_connection_id,nango_integration_id,status,scopes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        "composer-outlook",
        "test-agency-member",
        "outlook",
        "outlook-owned",
        "outlook-savia",
        "connected",
        "[]",
        "2026-01-01",
        "2026-01-01",
      )
      .run();
    const response = await send();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { provider: "outlook", action: "send-email" },
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/v1.0/me/sendMail",
        connection: expect.objectContaining({
          nangoConnectionId: "outlook-owned",
        }),
      }),
    );
    const denied = await app.request(
      "https://savia.test/v1/personal-integrations/messages",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...payload,
          context: [
            {
              apiBasePath: "/v1/studio/99999",
              collection: "contacts",
              recordId: "missing",
              fields: ["name"],
            },
          ],
        }),
      },
    );
    expect(denied.status).not.toBe(200);
    expect(nango.proxy).toHaveBeenCalledTimes(1);
  });

  it("executes a Gmail send only from an already-confirmed caller action", async () => {
    const nango = fakeNango();
    nango.proxy.mockResolvedValueOnce(Response.json({ id: "sent-message-1" }));
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
        id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "personal-gmail-send-connection",
        "test-agency-member",
        "gmail",
        "nango-gmail-send-connection",
        "gmail-savia",
        "connected",
        "[]",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      )
      .run();
    const actions = new PendingActionRepository(env.DB);
    const payload = {
      provider: "gmail",
      to: ["recipient@example.com"],
      subject: "Renewal update",
      body: "Please review the renewal.",
    };
    await actions.issue({
      id: "approved-personal-send",
      principalId: "test-agency-member",
      domain: "personal-integrations",
      command: "send-email",
      input: {
        sealedPayload: await payloadCipher.seal({
          actionId: "approved-personal-send",
          principalId: "test-agency-member",
          payload,
        }),
      },
    });
    const storedAction = await env.DB.prepare(
      "SELECT input_json FROM assistant_pending_actions WHERE id = ?",
    )
      .bind("approved-personal-send")
      .first<{ input_json: string }>();
    expect(storedAction?.input_json).not.toContain(payload.body);
    await actions.consume("approved-personal-send", "test-agency-member");
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/actions/approved-personal-send/execute",
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { provider: "gmail", action: "send-email" },
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/gmail/v1/users/me/messages/send",
        connection: expect.objectContaining({
          nangoConnectionId: "nango-gmail-send-connection",
        }),
        body: {
          raw: expect.any(String),
        },
      }),
    );
  });

  it("cannot execute a personal action until the owner has confirmed it", async () => {
    const nango = fakeNango();
    const actions = new PendingActionRepository(env.DB);
    await actions.issue({
      id: "unconfirmed-personal-send",
      principalId: "test-agency-member",
      domain: "personal-integrations",
      command: "send-email",
      input: {
        provider: "gmail",
        to: ["recipient@example.com"],
        subject: "Renewal update",
        body: "Please review the renewal.",
      },
    });
    const app = configuredApp(nango);

    const response = await app.request(
      "https://savia.test/v1/personal-integrations/actions/unconfirmed-personal-send/execute",
      { method: "POST" },
    );

    expect(response.status).toBe(409);
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it.each([
    {
      provider: "google_drive",
      integrationId: "google-drive-savia",
      request: {
        method: "POST",
        path: "/upload/drive/v3/files?uploadType=multipart",
        contentType: "multipart/related; boundary=savia-upload",
      },
    },
    {
      provider: "onedrive_personal",
      integrationId: "onedrive-personal-savia",
      request: {
        method: "PUT",
        path: "/v1.0/me/drive/root:/renewal.txt:/content?%40microsoft.graph.conflictBehavior=fail",
        contentType: "text/plain; charset=utf-8",
        upstreamHeaders: { "if-match": "0" },
      },
    },
    {
      provider: "onedrive_business",
      integrationId: "onedrive-business-savia",
      request: {
        method: "PUT",
        path: "/v1.0/me/drive/root:/renewal.txt:/content?%40microsoft.graph.conflictBehavior=fail",
        contentType: "text/plain; charset=utf-8",
        upstreamHeaders: { "if-match": "0" },
      },
    },
  ] as const)(
    "uploads a new text file to %s only after confirmation",
    async ({ provider, integrationId, request }) => {
      const nango = fakeNango();
      nango.proxy.mockResolvedValueOnce(Response.json({ id: "file-1" }));
      await env.DB.prepare(
        `INSERT INTO personal_integration_connections (
          id, principal_id, provider, nango_connection_id, nango_integration_id,
          status, scopes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          `personal-${provider}-upload-connection`,
          "test-agency-member",
          provider,
          `nango-${provider}-upload-connection`,
          integrationId,
          "connected",
          "[]",
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T00:00:00.000Z",
        )
        .run();
      const actionId = `approved-${provider}-upload`;
      const actions = new PendingActionRepository(env.DB);
      await actions.issue({
        id: actionId,
        principalId: "test-agency-member",
        domain: "personal-integrations",
        command: "upload-file",
        input: {
          sealedPayload: await payloadCipher.seal({
            actionId,
            principalId: "test-agency-member",
            payload: {
              provider,
              name: "renewal.txt",
              content: "Renewal details.",
              mimeType: "text/plain",
            },
          }),
        },
      });
      await actions.consume(actionId, "test-agency-member");
      const app = configuredApp(nango);

      const response = await app.request(
        `https://savia.test/v1/personal-integrations/actions/${actionId}/execute`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: { provider, action: "upload-file" },
      });
      expect(nango.proxy).toHaveBeenCalledWith(
        expect.objectContaining({
          ...request,
          rawBody: expect.stringContaining("Renewal details."),
          connection: expect.objectContaining({
            nangoConnectionId: `nango-${provider}-upload-connection`,
          }),
        }),
      );
    },
  );
});
