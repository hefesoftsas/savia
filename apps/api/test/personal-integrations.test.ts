import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { PendingActionRepository } from "../src/assistant/pending-actions";
import { PersonalActionPayloadCipher } from "../src/assistant/personal-action-payload";
import { createPersonalIntegrationProviderRegistry } from "../src/personal-integrations/providers";
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

describe("personal integration providers", () => {
  beforeAll(applyMigrations);
  beforeEach(async () => {
    await env.DB.exec(`
      DELETE FROM personal_integration_audit_events;
      DELETE FROM personal_integration_connections;
      DELETE FROM identity_principal WHERE id = 'test-agency-member';
    `);
    await seedPrincipal();
  });

  it("lists the six personal providers for an authenticated user", async () => {
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
        expect.objectContaining({ id: "google_calendar" }),
        expect.objectContaining({ id: "outlook" }),
        expect.objectContaining({ id: "onedrive_personal" }),
        expect.objectContaining({ id: "onedrive_business" }),
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
    nango.proxy.mockResolvedValueOnce(
      Response.json({
        messages: [
          {
            id: "gmail-message-1",
            threadId: "gmail-thread-1",
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
        "personal-gmail-read-connection",
        "test-agency-member",
        "gmail",
        "nango-gmail-read-connection",
        "gmail-savia",
        "connected",
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
          id: "gmail-message-1",
          subject: null,
          sender: null,
          receivedAt: null,
        },
      ],
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("/gmail/v1/users/me/messages?"),
      }),
    );
  });

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
        },
      ],
    });
    expect(nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("/calendar/v3/calendars/primary/events?"),
      }),
    );
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
