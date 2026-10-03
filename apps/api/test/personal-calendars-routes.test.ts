import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Authenticator } from "../src/auth/types";
import { createPersonalIntegrationProviderRegistry } from "../src/personal-integrations/providers";

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
  for (const migration of migrationSqls)
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
    `INSERT OR IGNORE INTO identity_principal (id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)`,
  )
    .bind(
      id,
      "savia:test",
      id,
      `${id}@savia.test`,
      id,
      "2026-10-03T00:00:00.000Z",
      "2026-10-03T00:00:00.000Z",
    )
    .run();
}
function authenticator(principalId: string): Authenticator {
  return {
    async authenticate() {
      return {
        principal: {
          id: principalId,
          issuer: "savia:test",
          subject: principalId,
          email: `${principalId}@savia.test`,
          displayName: principalId,
          isActive: true,
          createdAt: "2026-10-03T00:00:00.000Z",
          updatedAt: "2026-10-03T00:00:00.000Z",
        },
        globalRoles: [],
        memberships: [],
      };
    },
  };
}
function appFor(principalId: string, secret?: string) {
  return createApp(
    env.DB,
    undefined,
    undefined,
    authenticator(principalId),
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
      providers: createPersonalIntegrationProviderRegistry({}),
      calendarSecret: secret,
    },
  );
}
const feed = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:meeting\r\nDTSTART:20261003T120000Z\r\nDTEND:20261003T130000Z\r\nSUMMARY:Private feed event\r\nEND:VEVENT\r\nEND:VCALENDAR`;

describe("personal shared calendar routes", () => {
  beforeAll(applyMigrations);
  beforeEach(async () => {
    await env.DB.exec(
      "DELETE FROM personal_calendar_sources; DELETE FROM user_calendar_preferences; DELETE FROM identity_principal WHERE id IN ('calendar-owner','calendar-other');",
    );
    await seedPrincipal("calendar-owner");
    await seedPrincipal("calendar-other");
  });

  it("stores import source content encrypted and denies access to another principal", async () => {
    const owner = appFor("calendar-owner", "calendar shared test secret");
    const create = await owner.request(
      "https://savia.test/v1/personal-integrations/calendars",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "import",
          name: "Work snapshot",
          content: feed,
          color: "violet",
          timeZone: "America/New_York",
        }),
      },
    );
    expect(create.status).toBe(201);
    const source = (
      (await create.json()) as { data: { id: string; hostname: string | null } }
    ).data;
    expect(source.hostname).toBeNull();
    const stored = await env.DB.prepare(
      "SELECT encrypted_payload FROM personal_calendar_sources WHERE id=?",
    )
      .bind(source.id)
      .first<{ encrypted_payload: string }>();
    expect(stored?.encrypted_payload).not.toContain("Private feed event");

    const ownerEvents = await owner.request(
      `https://savia.test/v1/personal-integrations/calendars/${source.id}/events?from=2026-10-03T00%3A00%3A00.000Z&to=2026-10-04T00%3A00%3A00.000Z&timeZone=UTC`,
    );
    expect(ownerEvents.status).toBe(200);
    expect(await ownerEvents.json()).toMatchObject({
      data: [{ title: "Private feed event", allDay: false }],
      stale: false,
    });

    const other = await appFor(
      "calendar-other",
      "calendar shared test secret",
    ).request(
      `https://savia.test/v1/personal-integrations/calendars/${source.id}/events?from=2026-10-03T00%3A00%3A00.000Z&to=2026-10-04T00%3A00%3A00.000Z&timeZone=UTC`,
    );
    expect(other.status).toBe(404);
  });

  it("works without Nango and persists caller-scoped provider visibility defaults", async () => {
    const app = appFor("calendar-owner", "calendar shared test secret");
    const get = await app.request(
      "https://savia.test/v1/user-preferences/calendar",
    );
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({
      data: { google_calendar: true, outlook: true },
    });
    const put = await app.request(
      "https://savia.test/v1/user-preferences/calendar",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ google_calendar: false, outlook: true }),
      },
    );
    expect(put.status).toBe(200);
    expect(
      await appFor("calendar-other", "calendar shared test secret")
        .request("https://savia.test/v1/user-preferences/calendar")
        .then((response) => response.json()),
    ).toEqual({ data: { google_calendar: true, outlook: true } });
  });

  it("rejects writes when the encryption key is unavailable before storing a source", async () => {
    const response = await appFor("calendar-owner").request(
      "https://savia.test/v1/personal-integrations/calendars",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "import",
          name: "Work snapshot",
          content: feed,
        }),
      },
    );
    expect(response.status).toBe(503);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM personal_calendar_sources WHERE principal_id='calendar-owner'",
    ).first<{ count: number }>();
    expect(row?.count).toBe(0);
  });
});
