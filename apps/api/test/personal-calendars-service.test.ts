import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PersonalCalendarService } from "../src/personal-calendars/service";

const migrationSqls = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);
async function applyMigrations() {
  for (const migration of migrationSqls)
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((x) =>
        x
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
}
async function seed() {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO identity_principal (id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES ('calendar-service','savia:test','calendar-service','calendar-service@savia.test','Calendar service',1,'2026-10-03','2026-10-03')",
  ).run();
}
const feed = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:meeting\r\nDTSTART:20261003T120000Z\r\nDTEND:20261003T130000Z\r\nSUMMARY:Cached event\r\nEND:VEVENT\r\nEND:VCALENDAR`;
function dnsReply(url: URL) {
  return url.hostname === "cloudflare-dns.com"
    ? Response.json({
        Status: 0,
        Answer: [
          {
            type: url.searchParams.get("type") === "A" ? 1 : 28,
            data:
              url.searchParams.get("type") === "A"
                ? "93.184.216.34"
                : "2606:2800:220:1:248:1893:25c8:1946",
          },
        ],
      })
    : null;
}

beforeAll(applyMigrations);
beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM personal_calendar_sources; DELETE FROM identity_principal WHERE id='calendar-service';",
  );
  await seed();
});

describe("personal calendar source refresh", () => {
  it("retains the last valid feed when refresh fails", async () => {
    let feedRequests = 0;
    const fetcher: typeof fetch = async (request) => {
      const url = new URL(String(request));
      const dns = dnsReply(url);
      if (dns) return dns;
      feedRequests++;
      return new Response(feed, { status: 200, headers: { etag: '"one"' } });
    };
    const service = new PersonalCalendarService(env.DB, {
      secret: "calendar service secret",
      fetcher,
    });
    const source = await service.create("calendar-service", {
      kind: "subscription",
      name: "Feed",
      url: "https://feeds.example.org/cal",
      timeZone: "UTC",
    });
    await env.DB.prepare(
      "UPDATE personal_calendar_sources SET last_synced_at='2020-01-01T00:00:00.000Z' WHERE id=?",
    )
      .bind(source.id)
      .run();

    const failed = new PersonalCalendarService(env.DB, {
      secret: "calendar service secret",
      fetcher: async (request) => {
        const url = new URL(String(request));
        const dns = dnsReply(url);
        if (dns) return dns;
        throw new Error("offline");
      },
    });
    const result = await failed.events("calendar-service", source.id, {
      from: "2026-10-03T00:00:00.000Z",
      to: "2026-10-04T00:00:00.000Z",
      timeZone: "UTC",
    });
    expect(feedRequests).toBe(1);
    expect(result).toMatchObject({
      stale: true,
      data: [{ title: "Cached event" }],
    });
    expect(result.error).toMatch(/could not be reached/i);
    await expect(failed.refresh("calendar-service", source.id)).rejects.toThrow(
      /could not be reached/i,
    );
  });

  it("does not report not-found when a concurrent edit only changes source metadata", async () => {
    const initial = new PersonalCalendarService(env.DB, {
      secret: "calendar service secret",
      fetcher: async (request) => {
        const url = new URL(String(request));
        const dns = dnsReply(url);
        if (dns) return dns;
        return new Response(feed, { status: 200 });
      },
    });
    const source = await initial.create("calendar-service", {
      kind: "subscription",
      name: "Feed",
      url: "https://feeds.example.org/cal",
      timeZone: "UTC",
    });
    await env.DB.prepare(
      "UPDATE personal_calendar_sources SET last_synced_at='2020-01-01T00:00:00.000Z' WHERE id=?",
    )
      .bind(source.id)
      .run();
    let reached!: () => void;
    let release!: () => void;
    const atRequest = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = new PersonalCalendarService(env.DB, {
      secret: "calendar service secret",
      fetcher: async (request) => {
        const url = new URL(String(request));
        const dns = dnsReply(url);
        if (dns) return dns;
        reached();
        await blocked;
        return new Response(feed, { status: 200 });
      },
    });
    const eventsPromise = pending.events("calendar-service", source.id, {
      from: "2026-10-03T00:00:00.000Z",
      to: "2026-10-04T00:00:00.000Z",
      timeZone: "UTC",
      refresh: true,
    });
    await atRequest;
    await initial.update("calendar-service", source.id, {
      name: "Renamed feed",
    });
    release();
    await expect(eventsPromise).resolves.toMatchObject({
      stale: true,
      data: [{ title: "Cached event" }],
    });
    const row = await env.DB.prepare(
      "SELECT name,encrypted_payload FROM personal_calendar_sources WHERE id=?",
    )
      .bind(source.id)
      .first<{ name: string; encrypted_payload: string }>();
    expect(row?.name).toBe("Renamed feed");
    expect(row?.encrypted_payload).not.toContain("Cached event");
  });

  it("does not recreate a source deleted while a refresh is pending", async () => {
    const service = new PersonalCalendarService(env.DB, {
      secret: "calendar service secret",
      fetcher: async (request) => {
        const url = new URL(String(request));
        const dns = dnsReply(url);
        if (dns) return dns;
        return new Response(feed, { status: 200 });
      },
    });
    const source = await service.create("calendar-service", {
      kind: "subscription",
      name: "Feed",
      url: "https://feeds.example.org/cal",
      timeZone: "UTC",
    });
    await env.DB.prepare(
      "UPDATE personal_calendar_sources SET last_synced_at='2020-01-01T00:00:00.000Z' WHERE id=?",
    )
      .bind(source.id)
      .run();
    let reached!: () => void;
    let release!: () => void;
    const atRequest = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = new PersonalCalendarService(env.DB, {
      secret: "calendar service secret",
      fetcher: async (request) => {
        const url = new URL(String(request));
        const dns = dnsReply(url);
        if (dns) return dns;
        reached();
        await blocked;
        return new Response(feed, { status: 200 });
      },
    });
    const eventsPromise = pending.events("calendar-service", source.id, {
      from: "2026-10-03T00:00:00.000Z",
      to: "2026-10-04T00:00:00.000Z",
      timeZone: "UTC",
      refresh: true,
    });
    await atRequest;
    await service.delete("calendar-service", source.id);
    release();
    await expect(eventsPromise).rejects.toThrow(/not found/i);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM personal_calendar_sources WHERE id=?",
    )
      .bind(source.id)
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });
});
