import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import {
  CollaborationConflictError,
  listCollaborationChannels,
  shareRecord,
} from "../src/personal-integrations/collaboration";
import type {
  ActivePersonalIntegrationConnection,
  PersonalIntegrationNangoClient,
  PersonalIntegrationRepository,
} from "../src/personal-integrations/contracts";
import { createPersonalIntegrationProviderRegistry } from "../src/personal-integrations/providers";
import { createPersonalIntegrationRepository } from "../src/personal-integrations/repository";
import { agencyMemberAuthenticator } from "./auth-fixtures";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([left], [right]) => left.localeCompare(right))
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

const context = {
  apiBasePath: "/v1/studio/0",
  collection: "contacts",
  recordId: "contact-1",
  fields: ["name"],
} as const;
const payload = {
  provider: "slack" as const,
  channelId: "C123",
  title: "A record",
  summary: "A useful summary",
  url: "https://jose.savia-preview.hefesoft.com/#/studio?tenantId=0&object=contacts&view=records&record=contact-1",
  context,
  requestId: "share-1",
};

const providers = createPersonalIntegrationProviderRegistry({
  slackIntegrationId: "slack-savia",
  microsoftTeamsIntegrationId: "teams-savia",
});

async function seedConnection(provider: "slack" | "microsoft_teams" = "slack") {
  return createPersonalIntegrationRepository(env.DB).saveConnection({
    principalId: "test-agency-member",
    provider,
    nangoConnectionId: `nango-${provider}`,
    nangoIntegrationId: provider === "slack" ? "slack-savia" : "teams-savia",
    status: "connected",
    scopes: [],
  });
}

function appWith(nango: PersonalIntegrationNangoClient) {
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
    { providers, nango } as never,
  );
}

function appWithAuthorizedContext(nango: PersonalIntegrationNangoClient) {
  const app = appWith(nango);
  const request = app.request.bind(app);
  (app as unknown as { request: typeof app.request }).request = ((
    input: Parameters<typeof app.request>[0],
    ...rest: Parameters<typeof app.request> extends [unknown, ...infer Tail]
      ? Tail
      : never[]
  ) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith("/api/objects"))
      return Promise.resolve(
        Response.json({
          data: [
            {
              name: "contacts",
              config: { fields: { name: { type: "Text" } } },
            },
          ],
        }),
      );
    if (url.pathname.endsWith("/api/records/contacts/contact-1"))
      return Promise.resolve(
        Response.json({ data: { id: "contact-1", name: "Ana" } }),
      );
    return request(input, ...rest);
  }) as typeof app.request;
  return app;
}

async function seedPrincipal() {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_principal
      (id, issuer, subject, email, display_name, is_active, created_at, updated_at)
     VALUES ('test-agency-member','savia:better-auth','test-agency-member',
       'member@savia.test','Savia Test Member',1,'2026-01-01','2026-01-01')`,
  ).run();
}

const connection: ActivePersonalIntegrationConnection = {
  id: "connection-slack-test",
  principalId: "test-agency-member",
  provider: "slack",
  status: "connected",
  externalAccountLabel: null,
  externalAccountId: null,
  scopes: [],
  lastValidatedAt: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  nangoConnectionId: "nango-slack",
  nangoIntegrationId: "slack-savia",
};

function fakeRepository(): PersonalIntegrationRepository {
  return {
    listConnections: vi.fn(),
    findActiveConnection: vi.fn(),
    saveConnection: vi.fn(),
    markDisconnected: vi.fn(),
    markReconnectRequired: vi.fn().mockResolvedValue(true),
    appendAuditEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as PersonalIntegrationRepository;
}

function serviceNango(
  post: () => Promise<Response> = async () =>
    Response.json({ ok: true, ts: "1700000000.000001" }),
) {
  const proxy = vi.fn(
    async ({ path, method }: { path: string; method: string }) => {
      if (method === "POST") return post();
      if (path.startsWith("/conversations.info"))
        return Response.json({ ok: true, channel: { is_member: true } });
      return Response.json({ ok: true });
    },
  );
  return { proxy } as unknown as PersonalIntegrationNangoClient & {
    proxy: ReturnType<typeof vi.fn>;
  };
}

describe("personal collaboration routes and sends", () => {
  beforeAll(applyMigrations);
  beforeEach(async () => {
    await env.DB.exec(`
      DELETE FROM personal_collaboration_messages;
      DELETE FROM personal_integration_audit_events;
      DELETE FROM personal_integration_connections;
      DELETE FROM identity_principal WHERE id = 'test-agency-member';
    `);
    await seedPrincipal();
  });

  it("returns a Slack cursor and only bot-joined, active channels", async () => {
    await seedConnection();
    const nango = serviceNango();
    nango.proxy = vi.fn().mockResolvedValue(
      Response.json({
        ok: true,
        channels: [
          { id: "C1", name: "general", is_member: true, is_archived: false },
          {
            id: "C2",
            name: "not-joined",
            is_member: false,
            is_archived: false,
          },
          { id: "C3", name: "archived", is_member: true, is_archived: true },
        ],
        response_metadata: { next_cursor: "cursor-next" },
      }),
    ) as never;
    const response = await appWith(nango).request(
      "https://savia.test/v1/personal-integrations/collaboration/channels?provider=slack",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [{ id: "C1", name: "general" }],
      pagination: { nextCursor: "cursor-next" },
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("/conversations.list?"),
      }),
    );
  });

  it("rejects forged Teams cursors that target a different Graph resource", async () => {
    const nango = serviceNango();
    const cursor = encodeURIComponent(
      JSON.stringify({
        teamsPagePath: "/v1.0/users",
        teamIndex: 0,
        currentTeam: null,
        teamsNext: null,
        channelsNext: null,
      }),
    );
    await expect(
      listCollaborationChannels({
        provider: "microsoft_teams",
        connection: { ...connection, provider: "microsoft_teams" },
        nango,
        repository: fakeRepository(),
        cursor,
      }),
    ).rejects.toMatchObject({ code: "PERSONAL_INTEGRATION_ACTION_INVALID" });
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("rejects a Teams cursor that claims membership in an unjoined team", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValue(
        Response.json({ value: [{ id: "team-one", displayName: "Product" }] }),
      );
    const nango = { proxy } as unknown as PersonalIntegrationNangoClient;
    const cursor = encodeURIComponent(
      JSON.stringify({
        teamsPagePath: "/v1.0/me/joinedTeams",
        teamIndex: 0,
        currentTeam: { id: "attacker-team", displayName: "Attacker" },
        teamsNext: null,
        channelsNext: "/v1.0/teams/attacker-team/channels?$skiptoken=forged",
      }),
    );
    await expect(
      listCollaborationChannels({
        provider: "microsoft_teams",
        connection: { ...connection, provider: "microsoft_teams" },
        nango,
        repository: fakeRepository(),
        cursor,
      }),
    ).rejects.toMatchObject({ code: "PERSONAL_INTEGRATION_ACTION_INVALID" });
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0]?.[0].path).toBe("/v1.0/me/joinedTeams");
  });

  it("validates access to the selected record before any provider request", async () => {
    await seedConnection();
    const nango = serviceNango();
    const response = await appWith(nango).request(
      "https://savia.test/v1/personal-integrations/collaboration/messages",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    expect(response.status).toBe(403);
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("sends a record from the route after its context has been revalidated", async () => {
    await seedConnection();
    const nango = serviceNango();
    const response = await appWithAuthorizedContext(nango).request(
      "https://savia.test/v1/personal-integrations/collaboration/messages",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { provider: "slack", messageId: "1700000000.000001" },
    });
    expect(nango.proxy).toHaveBeenCalledTimes(2);
  });

  it("rejects a connection whose provider installation no longer matches configuration", async () => {
    await createPersonalIntegrationRepository(env.DB).saveConnection({
      principalId: "test-agency-member",
      provider: "slack",
      nangoConnectionId: "old-nango-slack",
      nangoIntegrationId: "old-slack-installation",
      status: "connected",
      scopes: [],
    });
    const nango = serviceNango();
    const response = await appWith(nango).request(
      "https://savia.test/v1/personal-integrations/collaboration/channels?provider=slack",
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "PERSONAL_INTEGRATION_RECONNECT_REQUIRED" },
    });
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("documents the reconnect-required conflict for channel listing", async () => {
    const response = await appWith(serviceNango()).request(
      "https://savia.test/openapi.json",
    );
    const document = await response.json<any>();
    const conflict =
      document.paths["/v1/personal-integrations/collaboration/channels"].get
        .responses["409"];
    expect(conflict.description).toContain("reconnection");
    expect(
      conflict.content["application/json"].schema.properties.error.properties
        .code.enum,
    ).toContain("PERSONAL_INTEGRATION_RECONNECT_REQUIRED");
  });

  it("does not use a connection owned by another principal", async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO identity_principal
        (id,issuer,subject,email,display_name,is_active,created_at,updated_at)
       VALUES ('other-member','savia:better-auth','other-member','other@savia.test',
        'Other Member',1,'2026-01-01','2026-01-01')`,
    ).run();
    await createPersonalIntegrationRepository(env.DB).saveConnection({
      principalId: "other-member",
      provider: "slack",
      nangoConnectionId: "other-nango-slack",
      nangoIntegrationId: "slack-savia",
      status: "connected",
      scopes: [],
    });
    const nango = serviceNango();
    const response = await appWith(nango).request(
      "https://savia.test/v1/personal-integrations/collaboration/channels?provider=slack",
    );
    expect(response.status).toBe(404);
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("persists sends and replays the original result without posting twice", async () => {
    const nango = serviceNango();
    const serviceInput = {
      database: env.DB,
      principalId: "test-agency-member",
      payload,
      connection,
      repository: fakeRepository(),
      nango,
      validateContext: vi.fn().mockResolvedValue(undefined),
      isAllowedOrigin: (origin: string) =>
        origin.endsWith(".savia-preview.hefesoft.com"),
    };
    const first = await shareRecord(serviceInput);
    const replay = await shareRecord(serviceInput);
    expect(first).toEqual({
      provider: "slack",
      messageId: "1700000000.000001",
    });
    expect(replay).toEqual(first);
    expect(nango.proxy).toHaveBeenCalledTimes(3); // two preflights and one post
  });

  it("keeps confirmed delivery sent if the success audit write fails", async () => {
    const nango = serviceNango();
    const repository = fakeRepository();
    vi.mocked(repository.appendAuditEvent).mockRejectedValue(
      new Error("audit database unavailable"),
    );
    const input = {
      database: env.DB,
      principalId: "test-agency-member",
      payload: { ...payload, requestId: "share-audit-failure" },
      connection,
      repository,
      nango,
      validateContext: vi.fn().mockResolvedValue(undefined),
      isAllowedOrigin: (origin: string) =>
        origin.endsWith(".savia-preview.hefesoft.com"),
    };

    await expect(shareRecord(input)).rejects.toThrow(
      "audit database unavailable",
    );
    await expect(shareRecord(input)).resolves.toEqual({
      provider: "slack",
      messageId: "1700000000.000001",
    });

    expect(
      nango.proxy.mock.calls.filter(([request]) => request.method === "POST"),
    ).toHaveLength(1);
    expect(repository.appendAuditEvent).toHaveBeenCalledTimes(1);
    expect(repository.appendAuditEvent).toHaveBeenCalledWith({
      connection,
      eventType: "share-record",
      outcome: "succeeded",
    });
  });

  it("rejects a requestId reused with different content", async () => {
    const nango = serviceNango();
    const input = {
      database: env.DB,
      principalId: "test-agency-member",
      payload,
      connection,
      repository: fakeRepository(),
      nango,
      validateContext: vi.fn().mockResolvedValue(undefined),
      isAllowedOrigin: (origin: string) =>
        origin.endsWith(".savia-preview.hefesoft.com"),
    };
    await shareRecord(input);
    await expect(
      shareRecord({
        ...input,
        payload: { ...payload, title: "Changed title" },
      }),
    ).rejects.toMatchObject({
      code: "PERSONAL_COLLABORATION_REQUEST_ID_REUSED",
    });
  });

  it("leaves ambiguous sends reserved and prevents an automatic second post", async () => {
    const nango = serviceNango(async () => {
      throw new TypeError("socket closed after write");
    });
    const repository = fakeRepository();
    vi.mocked(repository.appendAuditEvent).mockRejectedValue(
      new Error("audit database unavailable"),
    );
    const input = {
      database: env.DB,
      principalId: "test-agency-member",
      payload,
      connection,
      repository,
      nango,
      validateContext: vi.fn().mockResolvedValue(undefined),
      isAllowedOrigin: (origin: string) =>
        origin.endsWith(".savia-preview.hefesoft.com"),
    };
    await expect(shareRecord(input)).rejects.toMatchObject({
      code: "PERSONAL_INTEGRATION_REQUEST_FAILED",
    });
    await expect(shareRecord(input)).rejects.toBeInstanceOf(
      CollaborationConflictError,
    );
    expect(nango.proxy).toHaveBeenCalledTimes(3); // two reads, one attempted post
    expect(repository.appendAuditEvent).toHaveBeenCalledWith({
      connection,
      eventType: "share-record",
      outcome: "failed",
      errorCode: "PERSONAL_INTEGRATION_REQUEST_FAILED",
    });
  });

  it("sends Teams HTML with escaped title and summary", async () => {
    const teamsConnection = {
      ...connection,
      id: "connection-teams-test",
      provider: "microsoft_teams" as const,
      nangoIntegrationId: "teams-savia",
    };
    const proxy = vi.fn(async ({ method }: { method: string }) =>
      method === "POST"
        ? Response.json({ id: "teams-message-1" })
        : Response.json({ id: "channel", displayName: "General" }),
    );
    const nango = { proxy } as unknown as PersonalIntegrationNangoClient & {
      proxy: ReturnType<typeof vi.fn>;
    };
    const teamsPayload = {
      ...payload,
      provider: "microsoft_teams" as const,
      teamId: "team-1",
      title: "<script>alert(1)</script>",
      summary: "@everyone <b>unsafe</b>",
      requestId: "teams-share-1",
    };
    const result = await shareRecord({
      database: env.DB,
      principalId: "test-agency-member",
      payload: teamsPayload,
      connection: teamsConnection,
      repository: fakeRepository(),
      nango,
      validateContext: vi.fn().mockResolvedValue(undefined),
      isAllowedOrigin: (origin: string) =>
        origin.endsWith(".savia-preview.hefesoft.com"),
    });
    expect(result).toEqual({
      provider: "microsoft_teams",
      messageId: "teams-message-1",
    });
    const send = proxy.mock.calls.find(
      ([request]) => request.method === "POST",
    )?.[0];
    expect(send?.path).toBe("/v1.0/teams/team-1/channels/C123/messages");
    expect(send?.body).toMatchObject({
      body: {
        contentType: "html",
        content: expect.stringContaining(
          "&lt;script&gt;alert(1)&lt;/script&gt;",
        ),
      },
    });
    expect(JSON.stringify(send?.body)).not.toContain("<script>");
    expect(JSON.stringify(send?.body)).not.toContain("@everyone");
  });

  it("allows the same request ID independently for different callers", async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO identity_principal
        (id,issuer,subject,email,display_name,is_active,created_at,updated_at)
       VALUES ('other-member','savia:better-auth','other-member','other@savia.test',
        'Other Member',1,'2026-01-01','2026-01-01')`,
    ).run();
    const nango = serviceNango();
    const input = {
      database: env.DB,
      payload,
      connection,
      repository: fakeRepository(),
      nango,
      validateContext: vi.fn().mockResolvedValue(undefined),
      isAllowedOrigin: (origin: string) =>
        origin.endsWith(".savia-preview.hefesoft.com"),
    };
    const first = await shareRecord({
      ...input,
      principalId: "test-agency-member",
    });
    const second = await shareRecord({ ...input, principalId: "other-member" });
    expect(second).toEqual(first);
    expect(nango.proxy).toHaveBeenCalledTimes(4);
  });

  it("claims one send for concurrent submissions with the same request ID", async () => {
    const nango = serviceNango(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return Response.json({ ok: true, ts: "1700000000.000001" });
    });
    const input = {
      database: env.DB,
      principalId: "test-agency-member",
      payload,
      connection,
      repository: fakeRepository(),
      nango,
      validateContext: vi.fn().mockResolvedValue(undefined),
      isAllowedOrigin: (origin: string) =>
        origin.endsWith(".savia-preview.hefesoft.com"),
    };
    const outcomes = await Promise.allSettled([
      shareRecord(input),
      shareRecord(input),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    expect(nango.proxy).toHaveBeenCalledTimes(3);
  });
});
