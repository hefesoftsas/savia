import { StoreContextProvider, memoryStore } from "ra-core";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarSourcesClient } from "@/api/personal-integrations-client";
import type {
  CalendarOccurrence,
  CalendarSource,
  CalendarSourceEvents,
} from "@savia/studio-shared/calendar-contracts";
import { useCalendarSources } from "./use-calendar-sources";

const range = {
  from: "2026-10-01T00:00:00Z",
  to: "2026-10-08T00:00:00Z",
  timeZone: "UTC",
};
const source: CalendarSource = {
  id: "team",
  kind: "subscription",
  name: "Team",
  color: "blue",
  visible: true,
  timeZone: "UTC",
  hostname: "calendar.test",
  lastSyncedAt: null,
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
};
const event: CalendarOccurrence = {
  id: "meeting",
  sourceId: "team",
  title: "Meeting",
  startsAt: "2026-10-03T09:00:00Z",
  endsAt: "2026-10-03T10:00:00Z",
  allDay: false,
  timeZone: "UTC",
  webLink: null,
};
function client(): CalendarSourcesClient {
  return {
    listCalendarSources: vi.fn(async () => [source]),
    listCalendarSourceEvents: vi.fn(async () => ({
      data: [event],
      stale: false,
      error: null,
      lastSyncedAt: null,
    })),
    getCalendarPreferences: vi.fn(async () => ({
      google_calendar: true,
      outlook: true,
    })),
    createCalendarSource: vi.fn(),
    updateCalendarSource: vi.fn(),
    deleteCalendarSource: vi.fn(async () => {}),
    refreshCalendarSource: vi.fn(),
    saveCalendarPreferences: vi.fn(),
  };
}
afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event("savia:session-cleared"));
  vi.restoreAllMocks();
});
describe("shared calendar lifecycle", () => {
  it("forces a manual refresh even while an automatic read is pending", async () => {
    const service = client();
    vi.mocked(service.listCalendarSourceEvents).mockImplementation(
      async (_id, bounds) => {
        if (!bounds.refresh) return new Promise(() => {});
        return { data: [event], stale: false, error: null, lastSyncedAt: null };
      },
    );
    const { result } = renderHook(() => useCalendarSources(service, range));
    await waitFor(() =>
      expect(service.listCalendarSourceEvents).toHaveBeenCalledWith("team", {
        ...range,
        refresh: false,
      }),
    );
    act(() => {
      void result.current.refresh();
    });
    await waitFor(() =>
      expect(service.listCalendarSourceEvents).toHaveBeenCalledWith("team", {
        ...range,
        refresh: true,
      }),
    );
    expect(result.current.events).toEqual([event]);
  });
  it("refreshes the active range when a mutation finishes after navigation", async () => {
    const service = client();
    let complete!: (source: CalendarSource) => void;
    vi.mocked(service.updateCalendarSource).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ bounds }) => useCalendarSources(service, bounds),
      { initialProps: { bounds: range } },
    );
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    let mutation!: Promise<unknown>;
    act(() => {
      mutation = result.current.updateSource("team", { name: "Updated" });
    });
    const next = {
      ...range,
      from: "2026-11-01T00:00:00Z",
      to: "2026-11-08T00:00:00Z",
    };
    rerender({ bounds: next });
    await waitFor(() =>
      expect(service.listCalendarSourceEvents).toHaveBeenCalledWith("team", {
        ...next,
        refresh: false,
      }),
    );
    vi.mocked(service.listCalendarSourceEvents).mockClear();
    await act(async () => {
      complete({ ...source, name: "Updated" });
      await mutation;
    });
    expect(service.listCalendarSourceEvents).toHaveBeenCalledWith("team", {
      ...next,
      refresh: false,
    });
  });
  it("clears private rows after denied source access", async () => {
    const service = client();
    const { result } = renderHook(() => useCalendarSources(service, range));
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    vi.mocked(service.listCalendarSources).mockRejectedValue(
      Object.assign(new Error("Access denied"), { status: 403 }),
    );
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.sources).toEqual([]);
    expect(result.current.events).toEqual([]);
  });
  it("retains successful events with a stale notice when a source refresh fails", async () => {
    const service = client();
    const { result } = renderHook(() => useCalendarSources(service, range));
    await waitFor(() => expect(result.current.events).toEqual([event]));
    vi.mocked(service.listCalendarSourceEvents).mockRejectedValue(
      new Error("Unavailable"),
    );
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.events).toEqual([event]);
    expect(result.current.errors.team).toBeTruthy();
  });
  it("does not show an old range while a new range is loading", async () => {
    const service = client();
    const { result, rerender } = renderHook(
      ({ bounds }) => useCalendarSources(service, bounds),
      { initialProps: { bounds: range } },
    );
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    vi.mocked(service.listCalendarSourceEvents).mockImplementation(
      () => new Promise(() => {}),
    );
    rerender({
      bounds: {
        ...range,
        from: "2026-11-01T00:00:00Z",
        to: "2026-11-08T00:00:00Z",
      },
    });
    expect(result.current.events).toEqual([]);
  });
  it("does not restore a source deleted during a pending event request", async () => {
    const service = client();
    const { result } = renderHook(() => useCalendarSources(service, range));
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    let resolve!: (page: CalendarSourceEvents) => void;
    vi.mocked(service.listCalendarSourceEvents).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.refresh();
    });
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    await act(async () => {
      await result.current.removeSource("team");
    });
    await act(async () => {
      resolve({ data: [event], stale: false, error: null, lastSyncedAt: null });
      await pending;
    });
    expect(result.current.sources).toEqual([]);
    expect(result.current.events).toEqual([]);
  });
  it("clears private data immediately when the principal changes", async () => {
    const service = client();
    const { result } = renderHook(() => useCalendarSources(service, range));
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    vi.mocked(service.listCalendarSources).mockImplementation(
      () => new Promise(() => {}),
    );
    act(() => window.dispatchEvent(new Event("savia:principal-changed")));
    expect(result.current.sources).toEqual([]);
    expect(result.current.events).toEqual([]);
  });
});

describe("calendar source localization", () => {
  it.each([
    ["en", "Showing the latest available copy. Sync again."],
    ["pt", "Mostramos a última cópia disponível. Sincronize novamente."],
  ])("localizes cached stale-copy warnings in %s", async (locale, text) => {
    const api = client();
    api.listCalendarSourceEvents = vi.fn(async () => ({
      data: [event],
      stale: true,
      error: null,
      lastSyncedAt: null,
    }));
    const store = memoryStore({ locale });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StoreContextProvider value={store}>
        <AppLocaleProvider>{children}</AppLocaleProvider>
      </StoreContextProvider>
    );
    const { result } = renderHook(() => useCalendarSources(api, range), {
      wrapper,
    });
    await waitFor(() => expect(result.current.errors.team).toBe(text));
    act(() => {
      store.setItem("locale", "es");
    });
    await waitFor(() =>
      expect(result.current.errors.team).toBe(
        "Mostramos la última copia disponible. Vuelve a sincronizar.",
      ),
    );
  });
});
