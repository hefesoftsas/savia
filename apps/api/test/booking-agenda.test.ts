import { env } from "cloudflare:workers";
import { beforeAll, expect, it, vi } from "vitest";
import { BookingAgenda } from "../src/bookings/agenda";
import { PersonalCalendarService } from "../src/personal-calendars/service";
import type { PersonalIntegrationNangoClient } from "../src/personal-integrations/contracts";

beforeAll(async () => {
  const migrations = Object.entries(
    import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
      eager: true,
      import: "default",
      query: "?raw",
    }),
  ).sort(([a], [b]) => a.localeCompare(b));
  for (const [, sql] of migrations)
    for (const entry of sql.split("--> statement-breakpoint")) {
      const statement = entry
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (statement) await env.DB.exec(statement);
    }
});
const secret = "booking busy sources secret";
const from = "2026-10-04T00:00:00.000Z",
  to = "2026-10-05T00:00:00.000Z";
const content = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:private",
  "DTSTART:20261004T120000Z",
  "DTEND:20261004T130000Z",
  "SUMMARY:Private meeting",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");
let sequence = 888700;
async function owner() {
  const tenantId = ++sequence,
    principalId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?, 'Agenda tenant',1,'now','now')",
  )
    .bind(tenantId, `agenda-${tenantId}`)
    .run();
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?, 'savia:better-auth', ?, ?, 'Professional',1,'now','now')",
  )
    .bind(principalId, principalId, `${principalId}@example.test`)
    .run();
  return { tenantId, principalId, from, to };
}
async function connect(
  principalId: string,
  provider: "google_calendar" | "outlook",
) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO personal_integration_connections(id,principal_id,provider,nango_connection_id,nango_integration_id,status,scopes,created_at,updated_at) VALUES(?,?,?,?,?,'connected','[]','now','now')",
  )
    .bind(id, principalId, provider, id, provider)
    .run();
  return id;
}

it("combines authorized Google, Outlook and owned calendar imports without meeting metadata", async () => {
  const input = await owner();
  const google = await connect(input.principalId, "google_calendar");
  await connect(input.principalId, "outlook");
  const calendars = new PersonalCalendarService(env.DB, { secret });
  const source = await calendars.create(input.principalId, {
    kind: "import",
    name: "Private source",
    content,
    timeZone: "UTC",
    color: "blue",
  });
  await calendars.update(input.principalId, source.id, { visible: false });
  const proxy = vi.fn(async ({ path }: { path: string }) =>
    path === "/calendar/v3/freeBusy"
      ? Response.json({
          calendars: {
            primary: {
              busy: [
                { start: "2026-10-04T10:00:00Z", end: "2026-10-04T11:00:00Z" },
              ],
            },
          },
        })
      : Response.json({
          value: [
            {
              isCancelled: false,
              showAs: "busy",
              start: { dateTime: "2026-10-04T14:00:00", timeZone: "UTC" },
              end: { dateTime: "2026-10-04T15:00:00", timeZone: "UTC" },
            },
          ],
        }),
  );
  const agenda = new BookingAgenda(env.DB, {
    secret,
    nango: { proxy } as unknown as PersonalIntegrationNangoClient,
  });
  expect(await agenda.busy(input)).toEqual([]);
  expect(proxy).not.toHaveBeenCalled();
  await agenda.authorize(input.tenantId, input.principalId, true);
  expect(await agenda.status(input.tenantId, input.principalId)).toEqual({
    enabled: true,
    sourceCount: 3,
  });
  expect(await agenda.busy(input)).toEqual([
    { start: "2026-10-04T10:00:00.000Z", end: "2026-10-04T11:00:00.000Z" },
    { start: "2026-10-04T14:00:00.000Z", end: "2026-10-04T15:00:00.000Z" },
    { start: "2026-10-04T12:00:00.000Z", end: "2026-10-04T13:00:00.000Z" },
  ]);
  expect(JSON.stringify(await agenda.busy(input))).not.toMatch(
    /Private|title|name|sourceId/,
  );
  const other = await owner();
  expect(
    await agenda.busy({ ...input, principalId: other.principalId }),
  ).toEqual([]);
  await env.DB.prepare(
    "UPDATE personal_integration_connections SET status='reconnect_required' WHERE id=?",
  )
    .bind(google)
    .run();
  await expect(agenda.busy(input)).rejects.toThrow(/unavailable/i);
  await agenda.authorize(input.tenantId, input.principalId, false);
  expect(await agenda.busy(input)).toEqual([]);
});

it("refuses stale subscription availability when refreshing a booking confirmation fails", async () => {
  const input = await owner();
  let unavailable = false;
  let currentContent = content;
  const calendars = new PersonalCalendarService(env.DB, {
    secret,
    fetcher: async (request) => {
      const url = new URL(String(request));
      if (url.hostname === "cloudflare-dns.com")
        return Response.json({
          Status: 0,
          Answer: [
            {
              type: url.searchParams.get("type") === "AAAA" ? 28 : 1,
              data:
                url.searchParams.get("type") === "AAAA"
                  ? "2606:4700:4700::1111"
                  : "1.1.1.1",
            },
          ],
        });
      if (unavailable) throw new Error("Private upstream failure");
      return new Response(currentContent, {
        headers: { "content-type": "text/calendar" },
      });
    },
  });
  await calendars.create(input.principalId, {
    kind: "subscription",
    url: "https://calendar.example.org/private.ics",
    name: "Private source",
    timeZone: "UTC",
    color: "blue",
  });
  const agenda = new BookingAgenda(env.DB, { calendars });
  await agenda.authorize(input.tenantId, input.principalId, true);
  expect(await agenda.busy(input)).toHaveLength(1);
  currentContent = content
    .replace("T120000Z", "T140000Z")
    .replace("T130000Z", "T150000Z");
  expect((await agenda.busy(input))[0].start).toBe("2026-10-04T12:00:00.000Z");
  expect((await agenda.busy({ ...input, refresh: true }))[0].start).toBe(
    "2026-10-04T14:00:00.000Z",
  );
  unavailable = true;
  await expect(agenda.busy({ ...input, refresh: true })).rejects.toThrow(
    /could not be verified/,
  );
});
