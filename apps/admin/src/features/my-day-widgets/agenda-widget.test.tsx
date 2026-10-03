import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonalCalendarEvent } from "@/api/personal-integrations-client";
import { useMyDayAgenda, type PersonalIntegrationsLike } from "./agenda-widget";

function event(id: string, title: string): PersonalCalendarEvent {
  return {
    id,
    title,
    startsAt: "2026-09-29T14:00:00.000Z",
    endsAt: "2026-09-29T14:30:00.000Z",
    webLink: null,
  };
}

function integrations(overrides: Partial<PersonalIntegrationsLike> = {}) {
  return {
    listConnections: vi.fn().mockResolvedValue([
      { status: "connected", provider: "google_calendar" },
      { status: "connected", provider: "outlook" },
    ]),
    listEvents: vi.fn(
      async ({ provider }: { provider: "google_calendar" | "outlook" }) =>
        provider === "google_calendar" ? [event("g-1", "Google event")] : [],
    ),
    createCalendarEvent: vi.fn(),
    ...overrides,
  } as unknown as PersonalIntegrationsLike;
}

afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event("savia:session-cleared"));
  vi.restoreAllMocks();
});

describe("useMyDayAgenda", () => {
  it("never publishes a late task from a cleared session", async () => {
    const client = integrations({ listEvents: vi.fn(async () => []) });
    const displayed: string[] = [];
    const { result } = renderHook(() => {
      const agenda = useMyDayAgenda(client);
      displayed.push(...agenda.events.map((event) => event.title ?? ""));
      return agenda;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const lateUpdate = result.current.setEvents;
    vi.mocked(client.listConnections).mockImplementation(
      () => new Promise(() => {}),
    );
    act(() => {
      window.dispatchEvent(new Event("savia:identity-changed"));
      lateUpdate([
        {
          id: "private",
          title: "Previous identity",
          provider: "google_calendar",
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 60000).toISOString(),
          webLink: null,
        },
      ]);
    });
    expect(displayed).not.toContain("Previous identity");
  });
  it("keeps newly created tasks outside the selected range out of its cache", async () => {
    const client = integrations({ listEvents: vi.fn(async () => []) });
    const { result } = renderHook(() =>
      useMyDayAgenda(client, {
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-02T00:00:00Z",
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() =>
      result.current.setEvents((current) => [
        ...current,
        { ...event("today", "New task"), provider: "google_calendar" },
      ]),
    );
    expect(result.current.events).toEqual([]);
  });
  it("refreshes connected providers every five minutes while visible", async () => {
    vi.useFakeTimers();
    try {
      const client = integrations();
      const { unmount } = renderHook(() => useMyDayAgenda(client));
      await act(async () => {
        await Promise.resolve();
      });
      const initialCalls = vi.mocked(client.listEvents).mock.calls.length;
      expect(initialCalls).toBe(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300000);
      });
      expect(client.listEvents).toHaveBeenCalledTimes(initialCalls + 2);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it("reads selected ranges and clears old-range rows before the next response", async () => {
    const client = integrations();
    const october = {
      from: "2026-10-01T00:00:00Z",
      to: "2026-11-01T00:00:00Z",
    };
    const { result, rerender } = renderHook(
      ({ range }) => useMyDayAgenda(client, range),
      { initialProps: { range: october } },
    );
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(client.listEvents).toHaveBeenCalledWith({
      provider: "google_calendar",
      ...october,
    });
    vi.mocked(client.listEvents).mockImplementation(
      () => new Promise(() => {}),
    );
    rerender({
      range: { from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z" },
    });
    expect(result.current.events).toEqual([]);
  });
  it("publishes one calendar as soon as it settles while another provider is pending", async () => {
    let resolveOutlook!: (events: PersonalCalendarEvent[]) => void;
    const client = integrations({
      listEvents: vi.fn(({ provider }: { provider: string }) =>
        provider === "google_calendar"
          ? Promise.resolve([event("g-1", "Google event")])
          : new Promise<PersonalCalendarEvent[]>((resolve) => {
              resolveOutlook = resolve;
            }),
      ),
    });

    const { result } = renderHook(() => useMyDayAgenda(client));

    await waitFor(() => {
      expect(result.current.events.map(({ title }) => title)).toEqual([
        "Google event",
      ]);
    });
    expect(result.current.loading).toBe(false);

    await act(async () => resolveOutlook([]));
    await waitFor(() =>
      expect(result.current.calendarProviders).toHaveLength(2),
    );
  });

  it("reuses the last agenda immediately on remount and refreshes from the server", async () => {
    const client = integrations();
    const first = renderHook(() => useMyDayAgenda(client));
    await waitFor(() => expect(first.result.current.events).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    first.unmount();

    let resolveGoogle!: (events: PersonalCalendarEvent[]) => void;
    vi.mocked(client.listEvents).mockImplementation(({ provider }) =>
      provider === "google_calendar"
        ? new Promise<PersonalCalendarEvent[]>((resolve) => {
            resolveGoogle = resolve;
          })
        : Promise.resolve([]),
    );
    const second = renderHook(() => useMyDayAgenda(client));
    await waitFor(() => expect(client.listEvents).toHaveBeenCalledTimes(4));

    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.events.map(({ title }) => title)).toEqual([
      "Google event",
    ]);
    await act(async () => resolveGoogle([event("g-2", "Fresh event")]));
    await waitFor(() =>
      expect(second.result.current.events.map(({ title }) => title)).toEqual([
        "Fresh event",
      ]),
    );
  });

  it("does not show a previous session agenda after identity changes", async () => {
    const client = integrations({
      listConnections: vi
        .fn()
        .mockResolvedValueOnce([
          { status: "connected", provider: "google_calendar" },
        ])
        .mockResolvedValue([{ status: "connected", provider: "outlook" }]),
    });
    const first = renderHook(() => useMyDayAgenda(client));
    await waitFor(() => expect(first.result.current.events).toHaveLength(1));
    first.unmount();

    window.dispatchEvent(new Event("savia:identity-changed"));
    const second = renderHook(() => useMyDayAgenda(client));

    expect(second.result.current.events).toEqual([]);
    await waitFor(() =>
      expect(second.result.current.calendarProviders).toEqual(["outlook"]),
    );
  });

  it("ignores an old agenda response that arrives after an identity change", async () => {
    let resolveOldConnections!: (
      connections: Array<{ status: string; provider: string }>,
    ) => void;
    const client = integrations({
      listConnections: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveOldConnections = resolve;
            }),
        )
        .mockResolvedValue([{ status: "connected", provider: "outlook" }]),
      listEvents: vi.fn(async ({ provider }: { provider: string }) =>
        provider === "outlook" ? [event("o-1", "Outlook event")] : [],
      ),
    });
    const oldSession = renderHook(() => useMyDayAgenda(client));
    oldSession.unmount();

    window.dispatchEvent(new Event("savia:identity-changed"));
    const currentSession = renderHook(() => useMyDayAgenda(client));
    await waitFor(() =>
      expect(currentSession.result.current.events[0]?.title).toBe(
        "Outlook event",
      ),
    );

    await act(async () =>
      resolveOldConnections([
        { status: "connected", provider: "google_calendar" },
      ]),
    );
    expect(currentSession.result.current.calendarProviders).toEqual([
      "outlook",
    ]);
    expect(
      currentSession.result.current.events.map(({ title }) => title),
    ).toEqual(["Outlook event"]);
  });

  it("keeps a task created while its provider refresh is pending", async () => {
    let resolveGoogle!: (events: PersonalCalendarEvent[]) => void;
    const client = integrations({
      listConnections: vi
        .fn()
        .mockResolvedValue([
          { status: "connected", provider: "google_calendar" },
        ]),
      listEvents: vi.fn(
        () =>
          new Promise<PersonalCalendarEvent[]>((resolve) => {
            resolveGoogle = resolve;
          }),
      ),
    });
    const { result } = renderHook(() =>
      useMyDayAgenda(client, {
        from: "2026-09-29T00:00:00Z",
        to: "2026-09-30T00:00:00Z",
      }),
    );
    await waitFor(() => expect(resolveGoogle).toBeTypeOf("function"));

    act(() => {
      result.current.setEvents((current) => [
        ...current,
        { ...event("created", "New task"), provider: "google_calendar" },
      ]);
    });
    await act(async () => resolveGoogle([event("existing", "Existing event")]));

    expect(result.current.events.map(({ title }) => title)).toEqual([
      "Existing event",
      "New task",
    ]);
  });

  it("does not show events from the previous integrations client during a switch", async () => {
    const firstClient = integrations({
      listConnections: vi
        .fn()
        .mockResolvedValue([
          { status: "connected", provider: "google_calendar" },
        ]),
      listEvents: vi.fn().mockResolvedValue([event("g-1", "Private event")]),
    });
    const secondClient = integrations({
      listConnections: vi
        .fn()
        .mockResolvedValue([{ status: "connected", provider: "outlook" }]),
      listEvents: vi.fn().mockResolvedValue([]),
    });
    const { result, rerender } = renderHook(
      ({ client }) => useMyDayAgenda(client),
      { initialProps: { client: firstClient } },
    );
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    rerender({ client: secondClient });

    expect(result.current.events).toEqual([]);
    expect(result.current.loading).toBe(true);
    await waitFor(() =>
      expect(result.current.calendarProviders).toEqual(["outlook"]),
    );
  });
});
