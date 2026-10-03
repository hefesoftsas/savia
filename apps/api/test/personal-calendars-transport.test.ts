import { describe, expect, it, vi } from "vitest";
import {
  fetchCalendar,
  normalizeCalendarUrl,
} from "../src/personal-calendars/transport";

function publicDnsAnd(
  fetchFeed: (
    request: RequestInfo | URL,
    init?: RequestInit,
  ) => Response | Promise<Response>,
) {
  return vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(request));
    if (url.hostname === "cloudflare-dns.com")
      return Response.json({
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
      });
    return fetchFeed(request, init);
  }) as unknown as typeof fetch;
}

describe("calendar subscription transport", () => {
  it("normalizes WebCal and rejects credentialed or private destinations", () => {
    expect(
      normalizeCalendarUrl("webcal://calendar.example.org/feed").protocol,
    ).toBe("https:");
    expect(() =>
      normalizeCalendarUrl("https://user:secret@calendar.example.org/feed"),
    ).toThrow();
    expect(() => normalizeCalendarUrl("https://127.0.0.1/feed")).toThrow();
  });

  it("revalidates redirects and drops conditional headers when the hostname changes", async () => {
    const calls: Array<{ url: URL; headers: Headers }> = [];
    const fetcher = publicDnsAnd((request, init) => {
      const url = new URL(String(request));
      calls.push({ url, headers: new Headers(init?.headers) });
      if (url.hostname === "cloudflare-dns.com")
        return Response.json({
          Status: 0,
          Answer: [{ type: 1, data: "93.184.216.34" }],
        });
      if (url.hostname === "feeds.example.org")
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.org/calendar" },
        });
      return new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR", {
        status: 200,
        headers: { etag: '"new"' },
      });
    });
    const result = await fetchCalendar({
      url: "https://feeds.example.org/calendar",
      validators: { etag: '"old"' },
      fetcher,
    });

    expect(result.status).toBe(200);
    expect(result.validators.etag).toBeUndefined();
    const feedCalls = calls.filter(
      (call) => call.url.hostname !== "cloudflare-dns.com",
    );
    expect(feedCalls[0].headers.get("if-none-match")).toBe('"old"');
    expect(feedCalls[1].headers.has("if-none-match")).toBe(false);
  });

  it("keeps a 304 as a successful conditional response", async () => {
    const fetcher = publicDnsAnd((request) => {
      const url = new URL(String(request));
      return url.hostname === "cloudflare-dns.com"
        ? Response.json({
            Status: 0,
            Answer: [{ type: 1, data: "93.184.216.34" }],
          })
        : new Response(null, { status: 304, headers: { etag: '"same"' } });
    });
    await expect(
      fetchCalendar({ url: "https://feeds.example.org/calendar", fetcher }),
    ).resolves.toMatchObject({ status: 304, validators: { etag: '"same"' } });
  });
});
