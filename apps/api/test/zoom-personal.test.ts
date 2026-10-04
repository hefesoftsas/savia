import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createZoomMeetingService } from "../src/personal-integrations/zoom";
import { PersonalIntegrationOperations } from "../src/personal-integrations/operations";
import { createPersonalIntegrationRepository } from "../src/personal-integrations/repository";
import type { PersonalIntegrationNangoClient } from "../src/personal-integrations/contracts";

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

async function connectedZoomConnection(
  principalId: string,
  connectionId: string,
) {
  await env.DB.prepare(
    `INSERT INTO identity_principal (
      id, issuer, subject, email, display_name, is_active, created_at, updated_at
    ) VALUES (?, 'savia:test', ?, ?, 'Test User', 1, 'now', 'now')`,
  )
    .bind(principalId, principalId, `${principalId}@savia.test`)
    .run();
  await env.DB.prepare(
    `INSERT INTO personal_integration_connections (
      id, principal_id, provider, nango_connection_id, nango_integration_id,
      status, scopes, created_at, updated_at
    ) VALUES (?, ?, 'zoom', 'nango-zoom-account', 'zoom-app', 'connected', '[]', 'now', 'now')`,
  )
    .bind(connectionId, principalId)
    .run();
}

async function connectedCalendar(principalId: string, connectionId: string) {
  await env.DB.prepare(
    `INSERT INTO personal_integration_connections (
      id, principal_id, provider, nango_connection_id, nango_integration_id,
      status, scopes, created_at, updated_at
    ) VALUES (?, ?, 'google_calendar', 'nango-calendar-account', 'google-calendar-app', 'connected', '[]', 'now', 'now')`,
  )
    .bind(connectionId, principalId)
    .run();
}

function fakeNango(
  respond: (
    request: Parameters<PersonalIntegrationNangoClient["proxy"]>[0],
  ) => Response,
) {
  return {
    proxy: vi.fn(
      async (request: Parameters<PersonalIntegrationNangoClient["proxy"]>[0]) =>
        respond(request),
    ),
  } as unknown as PersonalIntegrationNangoClient;
}

describe("Zoom personal meeting service", () => {
  beforeAll(applyMigrations);

  it("creates once, then updates the same meeting for a stable resource key", async () => {
    const principalId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    await connectedZoomConnection(principalId, connectionId);
    const requests: { method: string; path: string; body?: unknown }[] = [];
    const nango = fakeNango((request) => {
      requests.push(request);
      return request.method === "POST"
        ? Response.json({
            id: 456,
            join_url: "https://us02web.zoom.us/j/456?pwd=guest",
            start_url: "https://zoom.us/s/host-secret",
          })
        : new Response(null, { status: 204 });
    });
    const service = createZoomMeetingService(env.DB, nango);

    const first = await service.sync({
      principalId,
      connectionId,
      resourceKey: "event:stable-request-id",
      title: "Planning",
      startsAt: "2026-11-02T10:00:00.000Z",
      endsAt: "2026-11-02T10:30:00.000Z",
      cancelled: false,
    });
    const updated = await service.sync({
      principalId,
      connectionId,
      resourceKey: "event:stable-request-id",
      title: "Planning updated",
      startsAt: "2026-11-02T11:00:00.000Z",
      endsAt: "2026-11-02T11:30:00.000Z",
      cancelled: false,
    });

    expect(first).toEqual({
      meetingId: "456",
      joinUrl: "https://us02web.zoom.us/j/456?pwd=guest",
    });
    expect(updated).toEqual(first);
    expect(requests.map(({ method, path }) => [method, path])).toEqual([
      ["POST", "/v2/users/me/meetings"],
      ["PATCH", "/v2/meetings/456"],
    ]);
    expect(requests[1]?.body).toEqual({
      topic: "Planning updated",
      start_time: "2026-11-02T11:00:00.000Z",
      duration: 30,
    });
    expect(JSON.stringify(first)).not.toContain("host-secret");
  });

  it("never retries an uncertain Zoom create with a duplicate POST", async () => {
    const principalId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    await connectedZoomConnection(principalId, connectionId);
    const nango = fakeNango(() => {
      throw new Error("network timed out after sending");
    });
    const service = createZoomMeetingService(env.DB, nango);
    const input = {
      principalId,
      connectionId,
      resourceKey: "event:uncertain-request-id",
      title: "Planning",
      startsAt: "2026-11-02T10:00:00.000Z",
      endsAt: "2026-11-02T10:30:00.000Z",
      cancelled: false,
    };

    await expect(service.sync(input)).rejects.toThrow();
    await expect(service.sync(input)).rejects.toThrow();
    expect(nango.proxy).toHaveBeenCalledTimes(1);
  });

  it("rejects Zoom topics over 200 characters and meetings over 24 hours", async () => {
    const principalId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    await connectedZoomConnection(principalId, connectionId);
    const nango = fakeNango(() =>
      Response.json({ id: "1", join_url: "https://zoom.us/j/1" }),
    );
    const service = createZoomMeetingService(env.DB, nango);
    const input = {
      principalId,
      connectionId,
      resourceKey: "event:bounded-input",
      title: "a".repeat(201),
      startsAt: "2026-11-02T10:00:00.000Z",
      endsAt: "2026-11-02T10:30:00.000Z",
      cancelled: false,
    };

    await expect(service.sync(input)).rejects.toThrow(
      "The Zoom meeting details are invalid",
    );
    await expect(
      service.sync({
        ...input,
        title: "Planning",
        endsAt: "2026-11-03T10:00:01.000Z",
      }),
    ).rejects.toThrow("The Zoom meeting time is invalid");
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("rejects a changed My Day request before updating its Zoom meeting", async () => {
    const principalId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    await connectedZoomConnection(principalId, connectionId);
    const nango = fakeNango(() =>
      Response.json({ id: "12", join_url: "https://zoom.us/j/12" }),
    );
    const service = createZoomMeetingService(env.DB, nango);
    const input = {
      principalId,
      connectionId,
      resourceKey: "my-day:immutable-request",
      title: "Planning",
      startsAt: "2026-11-02T10:00:00.000Z",
      endsAt: "2026-11-02T10:30:00.000Z",
      cancelled: false,
      immutableRequest: JSON.stringify({
        title: "Planning",
        provider: "google_calendar",
      }),
    };
    await service.sync(input);

    await expect(
      service.sync({
        ...input,
        title: "Different event",
        immutableRequest: JSON.stringify({
          title: "Different event",
          provider: "google_calendar",
        }),
      }),
    ).rejects.toThrow(
      "This request id was already used for a different calendar event",
    );
    expect(nango.proxy).toHaveBeenCalledTimes(1);
  });

  it("refuses to update a meeting through a reconnected Zoom account", async () => {
    const principalId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    await connectedZoomConnection(principalId, connectionId);
    const nango = fakeNango(() =>
      Response.json({ id: "789", join_url: "https://us02web.zoom.us/j/789" }),
    );
    const service = createZoomMeetingService(env.DB, nango);
    const input = {
      principalId,
      connectionId,
      resourceKey: "event:reconnect-request-id",
      title: "Planning",
      startsAt: "2026-11-02T10:00:00.000Z",
      endsAt: "2026-11-02T10:30:00.000Z",
      cancelled: false,
    };
    await service.sync(input);
    await env.DB.prepare(
      "UPDATE personal_integration_connections SET nango_connection_id = 'new-nango-account' WHERE id = ?",
    )
      .bind(connectionId)
      .run();

    await expect(
      service.sync({ ...input, title: "Changed" }),
    ).rejects.toThrow();
    expect(nango.proxy).toHaveBeenCalledTimes(1);
  });

  it("rotates the personal Zoom connection id when Nango switches accounts", async () => {
    const principalId = crypto.randomUUID();
    const oldConnectionId = crypto.randomUUID();
    await connectedZoomConnection(principalId, oldConnectionId);
    const repository = createPersonalIntegrationRepository(env.DB);
    const service = createZoomMeetingService(
      env.DB,
      fakeNango(() =>
        Response.json({
          id: "meeting-before-reconnect",
          join_url: "https://zoom.us/j/81",
        }),
      ),
    );
    await service.sync({
      principalId,
      connectionId: oldConnectionId,
      resourceKey: "booking:grant-snapshot",
      title: "Planning",
      startsAt: "2026-11-02T10:00:00.000Z",
      endsAt: "2026-11-02T10:30:00.000Z",
      cancelled: false,
    });

    const updated = await repository.saveConnection({
      principalId,
      provider: "zoom",
      nangoConnectionId: "replacement-nango-zoom-account",
      nangoIntegrationId: "zoom-app",
      status: "connected",
      externalAccountId: "replacement-account-id",
      scopes: ["meeting:write:meeting"],
    });
    const oldRow = await env.DB.prepare(
      "SELECT status, disconnected_at FROM personal_integration_connections WHERE id = ?",
    )
      .bind(oldConnectionId)
      .first<{ status: string; disconnected_at: string | null }>();
    const savedMeeting = await env.DB.prepare(
      "SELECT connection_id FROM zoom_personal_meetings WHERE principal_id = ? AND resource_key = 'booking:grant-snapshot'",
    )
      .bind(principalId)
      .first<{ connection_id: string }>();

    expect(updated.id).not.toBe(oldConnectionId);
    expect(updated.nangoConnectionId).toBe("replacement-nango-zoom-account");
    expect(oldRow?.status).toBe("disconnected");
    expect(oldRow?.disconnected_at).toBeTruthy();
    expect(savedMeeting?.connection_id).toBe(oldConnectionId);
  });

  it("does not create the calendar event when no personal Zoom account is connected", async () => {
    const principalId = crypto.randomUUID();
    const calendarConnectionId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO identity_principal (
        id, issuer, subject, email, display_name, is_active, created_at, updated_at
      ) VALUES (?, 'savia:test', ?, ?, 'Test User', 1, 'now', 'now')`,
    )
      .bind(principalId, principalId, `${principalId}@savia.test`)
      .run();
    await connectedCalendar(principalId, calendarConnectionId);
    const nango = fakeNango(() => Response.json({}));
    const operations = new PersonalIntegrationOperations(
      createPersonalIntegrationRepository(env.DB),
      nango,
      env.DB,
    );

    await expect(
      operations.createCalendarEvent({
        principalId,
        provider: "google_calendar",
        title: "Planning",
        startsAt: "2026-11-02T10:00:00.000Z",
        endsAt: "2026-11-02T10:30:00.000Z",
        videoCall: true,
        conferenceProvider: "zoom",
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("The personal integration connection is not ready");
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("requires a stable request id before starting a Zoom calendar action", async () => {
    const principalId = crypto.randomUUID();
    const calendarConnectionId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO identity_principal (
        id, issuer, subject, email, display_name, is_active, created_at, updated_at
      ) VALUES (?, 'savia:test', ?, ?, 'Test User', 1, 'now', 'now')`,
    )
      .bind(principalId, principalId, `${principalId}@savia.test`)
      .run();
    await connectedCalendar(principalId, calendarConnectionId);
    const nango = fakeNango(() => Response.json({}));
    const operations = new PersonalIntegrationOperations(
      createPersonalIntegrationRepository(env.DB),
      nango,
      env.DB,
    );

    await expect(
      operations.createCalendarEvent({
        principalId,
        provider: "google_calendar",
        title: "Planning",
        startsAt: "2026-11-02T10:00:00.000Z",
        endsAt: "2026-11-02T10:30:00.000Z",
        videoCall: true,
        conferenceProvider: "zoom",
      }),
    ).rejects.toThrow("A requestId is required for Zoom video calls");
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("creates and associates a Zoom meeting with a stable calendar event", async () => {
    const principalId = crypto.randomUUID();
    const zoomConnectionId = crypto.randomUUID();
    const calendarConnectionId = crypto.randomUUID();
    await connectedZoomConnection(principalId, zoomConnectionId);
    await connectedCalendar(principalId, calendarConnectionId);
    const requests: { method: string; path: string; body?: unknown }[] = [];
    const nango = fakeNango((request) => {
      requests.push(request);
      if (request.path === "/v2/users/me/meetings")
        return Response.json({
          id: "9001",
          join_url: "https://us02web.zoom.us/j/9001?pwd=attendee",
          start_url: "https://zoom.us/s/host-secret",
        });
      if (request.method === "DELETE")
        return new Response(null, { status: 204 });
      if (
        request.method === "GET" &&
        request.path.includes("/events/saviabcbb")
      )
        return Response.json({ id: "saviabcbb5234889742a2a0b8732a0c6b8f42" });
      if (request.method === "GET")
        return Response.json({
          items: [
            {
              id: "saviabcbb5234889742a2a0b8732a0c6b8f42",
              summary: "Planning",
              start: { dateTime: "2026-11-02T10:00:00.000Z" },
              end: { dateTime: "2026-11-02T10:30:00.000Z" },
            },
          ],
        });
      return Response.json({
        id:
          request.body && typeof request.body === "object"
            ? (request.body as Record<string, unknown>).id
            : "calendar-event",
        summary: "Planning",
        start: { dateTime: "2026-11-02T10:00:00.000Z" },
        end: { dateTime: "2026-11-02T10:30:00.000Z" },
      });
    });
    const operations = new PersonalIntegrationOperations(
      createPersonalIntegrationRepository(env.DB),
      nango,
      env.DB,
    );
    const requestId = "bcbb5234-8897-42a2-a0b8-732a0c6b8f42";

    const event = await operations.createCalendarEvent({
      principalId,
      provider: "google_calendar",
      title: "Planning",
      startsAt: "2026-11-02T10:00:00.000Z",
      endsAt: "2026-11-02T10:30:00.000Z",
      videoCall: true,
      conferenceProvider: "zoom",
      requestId,
    });

    expect(event.conference).toEqual({
      provider: "zoom",
      joinUrl: "https://us02web.zoom.us/j/9001?pwd=attendee",
      status: "ready",
    });
    expect(requests.map(({ method, path }) => [method, path])).toEqual([
      ["POST", "/v2/users/me/meetings"],
      ["POST", "/calendar/v3/calendars/primary/events"],
    ]);
    expect(requests[1]?.body).toMatchObject({
      id: "saviabcbb5234889742a2a0b8732a0c6b8f42",
      location: "https://us02web.zoom.us/j/9001?pwd=attendee",
      description:
        "Join Zoom meeting: https://us02web.zoom.us/j/9001?pwd=attendee",
    });
    expect(JSON.stringify(event)).not.toContain("host-secret");

    await expect(
      operations.listEvents({ principalId, provider: "google_calendar" }),
    ).resolves.toMatchObject([
      {
        id: "saviabcbb5234889742a2a0b8732a0c6b8f42",
        conference: {
          provider: "zoom",
          joinUrl: "https://us02web.zoom.us/j/9001?pwd=attendee",
          status: "ready",
        },
      },
    ]);
    await env.DB.prepare(
      "UPDATE personal_integration_connections SET nango_connection_id = 'replacement-zoom-account' WHERE id = ?",
    )
      .bind(zoomConnectionId)
      .run();
    await expect(
      operations.deleteCalendarEvent({
        principalId,
        provider: "google_calendar",
        eventId: "saviabcbb5234889742a2a0b8732a0c6b8f42",
        expectedConnectionId: calendarConnectionId,
      }),
    ).rejects.toThrow("Reconnect the original Zoom account");
    expect(
      requests.some(
        ({ method, path }) =>
          method === "DELETE" && path.startsWith("/calendar/"),
      ),
    ).toBe(false);
    await env.DB.prepare(
      "UPDATE personal_integration_connections SET nango_connection_id = 'nango-zoom-account' WHERE id = ?",
    )
      .bind(zoomConnectionId)
      .run();
    await env.DB.prepare(
      "UPDATE personal_integration_connections SET nango_connection_id = 'replacement-calendar-account' WHERE id = ?",
    )
      .bind(calendarConnectionId)
      .run();
    await expect(
      operations.deleteCalendarEvent({
        principalId,
        provider: "google_calendar",
        eventId: "saviabcbb5234889742a2a0b8732a0c6b8f42",
        expectedConnectionId: calendarConnectionId,
      }),
    ).rejects.toThrow("The calendar account used for this event has changed");
    expect(
      requests.some(
        ({ method, path }) =>
          method === "DELETE" && path.startsWith("/calendar/"),
      ),
    ).toBe(false);
    await env.DB.prepare(
      "UPDATE personal_integration_connections SET nango_connection_id = 'nango-calendar-account' WHERE id = ?",
    )
      .bind(calendarConnectionId)
      .run();
    await operations.deleteCalendarEvent({
      principalId,
      provider: "google_calendar",
      eventId: "saviabcbb5234889742a2a0b8732a0c6b8f42",
      expectedConnectionId: calendarConnectionId,
    });
    expect(
      requests.slice(-3).map(({ method, path }) => [method, path]),
    ).toEqual([
      [
        "GET",
        "/calendar/v3/calendars/primary/events/saviabcbb5234889742a2a0b8732a0c6b8f42",
      ],
      ["DELETE", "/v2/meetings/9001"],
      [
        "DELETE",
        "/calendar/v3/calendars/primary/events/saviabcbb5234889742a2a0b8732a0c6b8f42",
      ],
    ]);
  });
});
