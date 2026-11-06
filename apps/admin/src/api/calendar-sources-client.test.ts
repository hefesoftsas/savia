import { describe, expect, it, vi } from "vitest";
import { PersonalIntegrationsClient } from "./personal-integrations-client";
import type { ApiClient } from "./api-client";

describe("calendar source client", () => {
  it("reads source events using an encoded caller-owned ID and selected range", async () => {
    const page = { data: [], stale: false, error: null, lastSyncedAt: null };
    const get = vi.fn().mockResolvedValue(page);
    const client = new PersonalIntegrationsClient({
      get,
    } as unknown as ApiClient);
    expect(
      await client.listCalendarSourceEvents("a/b", {
        from: "2026-10-01T00:00:00Z",
        to: "2026-11-01T00:00:00Z",
        timeZone: "Europe/Madrid",
        refresh: true,
      }),
    ).toEqual(page);
    const [path] = get.mock.calls[0];
    expect(path).toContain("/calendars/a%2Fb/events?");
    const query = new URL(path, "https://savia.test").searchParams;
    expect(query.get("timeZone")).toBe("Europe/Madrid");
    expect(query.get("refresh")).toBe("true");
  });
  it("persists subscriptions, imported copies and visibility through the API", async () => {
    const source = { id: "source" };
    const api = {
      get: vi.fn(async () => ({ data: [] })),
      post: vi.fn(async () => ({ data: source })),
      patch: vi.fn(async () => ({ data: source })),
      put: vi.fn(async () => ({
        data: { google_calendar: false, outlook: true },
      })),
      delete: vi.fn(async () => undefined),
    };
    const client = new PersonalIntegrationsClient(api as unknown as ApiClient);
    const input = {
      kind: "import" as const,
      name: "Team",
      content: "BEGIN:VCALENDAR",
      timeZone: "UTC",
    };
    expect(await client.createCalendarSource(input)).toEqual(source);
    expect(api.post).toHaveBeenCalledWith(
      "/v1/personal-integrations/calendars",
      input,
    );
    await client.updateCalendarSource("source", { visible: false });
    expect(api.patch).toHaveBeenCalledWith(
      "/v1/personal-integrations/calendars/source",
      { visible: false },
    );
    await client.deleteCalendarSource("source");
    expect(api.delete).toHaveBeenCalledWith(
      "/v1/personal-integrations/calendars/source",
    );
    expect(
      await client.saveCalendarPreferences({
        google_calendar: false,
        outlook: true,
      }),
    ).toEqual({ google_calendar: false, outlook: true });
  });
});
