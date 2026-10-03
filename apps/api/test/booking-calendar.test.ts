import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createBookingCalendarAdapter } from "../src/bookings/calendar";
import type { PersonalIntegrationNangoClient } from "../src/personal-integrations/contracts";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);

async function migrate() {
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((part) =>
        part
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
}

const principalId = "booking-calendar-integrations-test";
const localConnectionId = "booking-calendar-local-google";

async function seedConnection(
  provider = "google_calendar",
  status = "connected",
) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_principal (
      id,issuer,subject,email,display_name,is_active,created_at,updated_at
    ) VALUES (?, 'savia:better-auth', ?, ?, 'Booking Test', 1, '2026-01-01', '2026-01-01')`,
  )
    .bind(principalId, principalId, `${principalId}@savia.test`)
    .run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO personal_integration_connections (
      id,principal_id,provider,nango_connection_id,nango_integration_id,status,
      external_account_label,external_account_id,scopes,last_validated_at,
      created_at,updated_at,disconnected_at
    ) VALUES (?,?,?,?,?,?,NULL,NULL,'[]',NULL,'2026-01-01','2026-01-01',NULL)`,
  )
    .bind(
      localConnectionId,
      principalId,
      provider,
      `nango-${provider}`,
      `${provider}-integration`,
      status,
    )
    .run();
}

function fakeNango(
  proxy: (request: {
    method: string;
    path: string;
    body?: unknown;
  }) => Promise<Response>,
) {
  return {
    createConnectSession: vi.fn(),
    createReconnectSession: vi.fn(),
    getConnection: vi.fn(),
    deleteConnection: vi.fn(),
    proxy: vi.fn(proxy),
  } as unknown as PersonalIntegrationNangoClient;
}

const calendarInput = {
  principalId,
  provider: "google_calendar" as const,
  connectionId: localConnectionId,
  from: "2026-03-01T00:00:00.000Z",
  to: "2026-03-02T00:00:00.000Z",
};

beforeAll(migrate);
beforeEach(async () => {
  await env.DB.prepare(
    "DELETE FROM personal_integration_connections WHERE id=?",
  )
    .bind(localConnectionId)
    .run();
});

describe("booking calendar adapter", () => {
  it("requires the exact active connection pinned by the grant", async () => {
    await seedConnection();
    const nango = fakeNango(async () => Response.json({ calendars: {} }));
    const adapter = createBookingCalendarAdapter(env.DB, nango);
    await expect(
      adapter.busy({ ...calendarInput, connectionId: "some-other-row" }),
    ).rejects.toThrow();
    expect(nango.proxy).not.toHaveBeenCalled();
  });

  it("fails closed on Google freeBusy calendar errors and malformed data", async () => {
    await seedConnection();
    const nango = fakeNango(async () =>
      Response.json({
        calendars: {
          primary: { errors: [{ reason: "secret provider detail" }], busy: [] },
        },
      }),
    );
    const adapter = createBookingCalendarAdapter(env.DB, nango);
    await expect(adapter.busy(calendarInput)).rejects.toThrow(/unavailable/i);
    await expect(adapter.busy(calendarInput)).rejects.not.toThrow(
      /secret provider detail/,
    );
  });

  it("follows every Outlook page and ignores free and cancelled events", async () => {
    await seedConnection("outlook");
    const nango = fakeNango(async ({ path }) =>
      path.includes("skiptoken")
        ? Response.json({
            value: [
              {
                start: { dateTime: "2026-03-01T12:00:00", timeZone: "UTC" },
                end: { dateTime: "2026-03-01T13:00:00", timeZone: "UTC" },
                showAs: "busy",
                isCancelled: true,
              },
            ],
          })
        : Response.json({
            value: [
              {
                start: { dateTime: "2026-03-01T09:00:00", timeZone: "UTC" },
                end: { dateTime: "2026-03-01T10:00:00", timeZone: "UTC" },
                showAs: "free",
                isCancelled: false,
              },
              {
                start: { dateTime: "2026-03-01", timeZone: "UTC" },
                end: { dateTime: "2026-03-02", timeZone: "UTC" },
                isAllDay: true,
                showAs: "busy",
                isCancelled: false,
              },
            ],
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=next",
          }),
    );
    const adapter = createBookingCalendarAdapter(env.DB, nango);
    const busy = await adapter.busy({ ...calendarInput, provider: "outlook" });
    expect(nango.proxy).toHaveBeenCalledTimes(2);
    expect(busy).toHaveLength(1);
    expect(busy[0]).toEqual({
      start: "2026-03-01T00:00:00.000Z",
      end: "2026-03-02T00:00:00.000Z",
    });
  });

  it("treats partial Outlook busy items as unavailable", async () => {
    await seedConnection("outlook");
    const nango = fakeNango(async () =>
      Response.json({
        value: [
          {
            start: { dateTime: "2026-03-01T09:00:00", timeZone: "UTC" },
            end: { dateTime: "2026-03-01T10:00:00", timeZone: "UTC" },
          },
        ],
      }),
    );
    await expect(
      createBookingCalendarAdapter(env.DB, nango).busy({
        ...calendarInput,
        provider: "outlook",
      }),
    ).rejects.toThrow(/unavailable/i);
  });

  it("uses deterministic Google IDs and recovers create conflicts by updating", async () => {
    await seedConnection();
    const requests: Array<{ method: string; path: string; body?: unknown }> =
      [];
    const nango = fakeNango(async ({ method, path, body }) => {
      requests.push({ method, path, body });
      return method === "POST"
        ? new Response(null, { status: 409 })
        : Response.json({ id: "stable-event-id" });
    });
    const adapter = createBookingCalendarAdapter(env.DB, nango);
    const input = {
      ...calendarInput,
      id: "booking-42",
      title: "Consultation",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: null,
      cancelled: false,
    };
    await adapter.sync(input);
    await adapter.sync(input);
    expect(requests.map(({ method }) => method)).toEqual([
      "POST",
      "PUT",
      "POST",
      "PUT",
    ]);
    const expectedId = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("booking-42"),
    );
    const hexId = Array.from(new Uint8Array(expectedId), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    expect(requests[0]?.path).toBe("/calendar/v3/calendars/primary/events");
    expect((requests[0]?.body as { id?: string })?.id).toBe(hexId);
    expect(requests[1]?.path).toBe(
      `/calendar/v3/calendars/primary/events/${hexId}`,
    );
  });

  it("treats provider-specific cancellation not-found responses as success", async () => {
    await seedConnection();
    const input = {
      ...calendarInput,
      id: "booking-cancel",
      title: "Consultation",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: "persisted-google-id",
      cancelled: true,
    };
    for (const status of [404, 410]) {
      const google = fakeNango(async () => new Response(null, { status }));
      await expect(
        createBookingCalendarAdapter(env.DB, google).sync(input),
      ).resolves.toBe("persisted-google-id");
    }
    await seedConnection("outlook");
    const outlook = fakeNango(async () => new Response(null, { status: 404 }));
    await expect(
      createBookingCalendarAdapter(env.DB, outlook).sync({
        ...input,
        provider: "outlook",
      }),
    ).resolves.toBe("persisted-google-id");
  });

  it("deletes the deterministic Google event when create returned before persistence", async () => {
    await seedConnection();
    const requests: Array<{ method: string; path: string }> = [];
    const nango = fakeNango(async ({ method, path }) => {
      requests.push({ method, path });
      return new Response(null, { status: 204 });
    });
    const input = {
      ...calendarInput,
      id: "booking-google-lost-create",
      title: "Consultation",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: null,
      cancelled: true,
    };
    const externalId = await createBookingCalendarAdapter(env.DB, nango).sync(
      input,
    );
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(input.id),
    );
    const expectedId = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    expect(externalId).toBe(expectedId);
    expect(requests).toEqual([
      {
        method: "DELETE",
        path: `/calendar/v3/calendars/primary/events/${expectedId}`,
      },
    ]);
  });

  it("uses a stable Outlook transaction ID on create and the persisted ID on update", async () => {
    await seedConnection("outlook");
    const requests: Array<{ method: string; path: string; body?: unknown }> =
      [];
    const nango = fakeNango(async ({ method, path, body }) => {
      requests.push({ method, path, body });
      if (method === "GET") return Response.json({ value: [] });
      return method === "POST"
        ? Response.json({ id: "outlook-event" })
        : new Response(null, { status: 204 });
    });
    const adapter = createBookingCalendarAdapter(env.DB, nango);
    const input = {
      ...calendarInput,
      provider: "outlook" as const,
      id: "booking-outlook",
      title: "Service only",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: null,
      cancelled: false,
    };
    await expect(adapter.sync(input)).resolves.toBe("outlook-event");
    await adapter.sync({ ...input, externalId: "persisted-outlook-id" });
    expect(requests.map(({ method }) => method)).toEqual([
      "GET",
      "POST",
      "PATCH",
    ]);
    expect(
      (requests[1]?.body as { transactionId?: string })?.transactionId,
    ).toBeTruthy();
    expect(requests[1]?.body).toHaveProperty("singleValueExtendedProperties", [
      {
        id: "String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ab} Name SaviaBookingId",
        value: input.id,
      },
    ]);
    expect(requests[2]).toMatchObject({
      method: "PATCH",
      path: "/v1.0/me/events/persisted-outlook-id",
    });
    expect(requests[1]?.body).not.toHaveProperty("attendees");
  });

  it("recovers an Outlook create whose response was lost by finding its booking marker", async () => {
    await seedConnection("outlook");
    const requests: Array<{ method: string; path: string; body?: unknown }> =
      [];
    let lookupCount = 0;
    const nango = fakeNango(async ({ method, path, body }) => {
      requests.push({ method, path, body });
      if (method === "POST") throw new Error("simulated lost create response");
      if (method === "GET" && lookupCount++ === 0)
        return Response.json({ value: [] });
      if (method === "GET")
        return Response.json({
          value: [
            {
              id: "recovered-outlook-event",
              singleValueExtendedProperties: [
                {
                  id: "String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ab} Name SaviaBookingId",
                  value: "booking-outlook-retry",
                },
              ],
            },
          ],
        });
      return new Response(null, { status: 204 });
    });
    const adapter = createBookingCalendarAdapter(env.DB, nango);
    const input = {
      ...calendarInput,
      provider: "outlook" as const,
      id: "booking-outlook-retry",
      title: "Service only",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: null,
      cancelled: false,
    };
    await expect(adapter.sync(input)).rejects.toThrow(/unavailable/i);
    await expect(adapter.sync(input)).resolves.toBe("recovered-outlook-event");
    expect(requests.map(({ method }) => method)).toEqual([
      "GET",
      "POST",
      "GET",
      "PATCH",
    ]);
    expect(requests[3]?.path).toBe("/v1.0/me/events/recovered-outlook-event");
    expect(decodeURIComponent(requests[0]?.path ?? "")).toContain(input.id);
  });

  it("fails closed when Outlook booking marker lookup is malformed or ambiguous", async () => {
    await seedConnection("outlook");
    for (const payload of [
      { value: [{ id: "one" }, { id: "two" }] },
      { value: [{ id: 42 }] },
      { value: [{ id: "missing-marker" }] },
      { value: "not-an-event-list" },
    ]) {
      const nango = fakeNango(async () => Response.json(payload));
      await expect(
        createBookingCalendarAdapter(env.DB, nango).sync({
          ...calendarInput,
          provider: "outlook",
          id: "booking-ambiguous",
          title: "Service",
          startsAt: "2026-03-01T09:00:00Z",
          endsAt: "2026-03-01T10:00:00Z",
          externalId: null,
          cancelled: true,
        }),
      ).rejects.toThrow(/unavailable/i);
    }
  });

  it("cancels an Outlook event recovered by its marker when its ID was not persisted", async () => {
    await seedConnection("outlook");
    const requests: Array<{ method: string; path: string }> = [];
    const nango = fakeNango(async ({ method, path }) => {
      requests.push({ method, path });
      if (method === "GET")
        return Response.json({
          value: [
            {
              id: "lost-outlook-event",
              singleValueExtendedProperties: [
                {
                  id: "String {6f8d1c44-1ab2-4e1e-9e8f-0123456789ab} Name SaviaBookingId",
                  value: "booking-outlook-cancel",
                },
              ],
            },
          ],
        });
      return new Response(null, { status: 204 });
    });
    const result = await createBookingCalendarAdapter(env.DB, nango).sync({
      ...calendarInput,
      provider: "outlook",
      id: "booking-outlook-cancel",
      title: "Service only",
      startsAt: "2026-03-01T09:00:00Z",
      endsAt: "2026-03-01T10:00:00Z",
      externalId: null,
      cancelled: true,
    });
    expect(result).toBe("lost-outlook-event");
    expect(requests.map(({ method }) => method)).toEqual(["GET", "DELETE"]);
    expect(requests[1]?.path).toBe("/v1.0/me/events/lost-outlook-event");
  });
});
