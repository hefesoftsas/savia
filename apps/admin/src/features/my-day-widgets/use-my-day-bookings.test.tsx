import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookingAgendaEntry } from "@savia/studio-shared/booking-agenda-contracts";
import { useMyDayBookings } from "./use-my-day-bookings";

const range = {
  from: "2026-01-03T00:00:00.000Z",
  to: "2026-01-04T00:00:00.000Z",
  timeZone: "UTC",
};
const entry = (id: string): BookingAgendaEntry => ({
  id: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
  tenantId: 7,
  tenantSlug: "centro",
  tenantName: "Centro",
  serviceName: "Consulta",
  professionalName: "Dra. Luna",
  customerName: "Ana Pérez",
  customerEmail: "ana@example.test",
  startsAt: "2026-01-03T14:00:00.000Z",
  endsAt: "2026-01-03T14:30:00.000Z",
  timeZone: "UTC",
  status: "confirmed",
  version: 1,
  externalEvent: null,
});

afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event("savia:session-cleared"));
  vi.restoreAllMocks();
});

describe("useMyDayBookings", () => {
  it("loads through the client receiver without requiring OAuth methods", async () => {
    const client = {
      calls: 0,
      async listBookingAgenda(this: { calls: number }) {
        this.calls += 1;
        return [entry("1")];
      },
    };
    const { result } = renderHook(() => useMyDayBookings(client, range));

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(client.calls).toBe(1);
  });

  it("clears the old range and discards its late response", async () => {
    let resolveOld!: (value: BookingAgendaEntry[]) => void;
    const client = {
      listBookingAgenda: vi
        .fn()
        .mockImplementationOnce(
          () => new Promise((resolve) => (resolveOld = resolve)),
        )
        .mockResolvedValueOnce([entry("2")]),
    };
    const october = { ...range, from: "2026-10-01T00:00:00.000Z" };
    const { result, rerender } = renderHook(
      ({ currentRange }) => useMyDayBookings(client, currentRange),
      { initialProps: { currentRange: range } },
    );
    rerender({ currentRange: october });
    await waitFor(() => expect(result.current.entries).toEqual([entry("2")]));
    await act(async () => resolveOld([entry("1")]));
    expect(result.current.entries).toEqual([entry("2")]);
  });

  it("clears the previous client before loading a replacement", async () => {
    const previous = {
      listBookingAgenda: vi.fn().mockResolvedValue([entry("1")]),
    };
    const replacement = {
      listBookingAgenda: vi.fn().mockResolvedValue([entry("2")]),
    };
    const { result, rerender } = renderHook(
      ({ client }) => useMyDayBookings(client, range),
      { initialProps: { client: previous } },
    );
    await waitFor(() => expect(result.current.entries).toEqual([entry("1")]));

    rerender({ client: replacement });
    expect(result.current.entries).toEqual([]);
    await waitFor(() => expect(result.current.entries).toEqual([entry("2")]));
  });

  it("discards a previous session response after loading the new identity", async () => {
    let resolvePrevious!: (value: BookingAgendaEntry[]) => void;
    const client = {
      listBookingAgenda: vi
        .fn()
        .mockImplementationOnce(
          () => new Promise((resolve) => (resolvePrevious = resolve)),
        )
        .mockResolvedValueOnce([entry("2")]),
    };
    const { result } = renderHook(() => useMyDayBookings(client, range));
    act(() => window.dispatchEvent(new Event("savia:principal-changed")));
    await waitFor(() => expect(result.current.entries).toEqual([entry("2")]));
    await act(async () => resolvePrevious([entry("1")]));
    expect(result.current.entries).toEqual([entry("2")]);
  });

  it("retains same-range rows after a transient failure and replaces them on retry", async () => {
    const client = {
      listBookingAgenda: vi
        .fn()
        .mockResolvedValueOnce([entry("1")])
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce([entry("3")]),
    };
    const { result } = renderHook(() => useMyDayBookings(client, range));
    await waitFor(() => expect(result.current.entries).toEqual([entry("1")]));

    await act(async () => result.current.refresh());
    expect(result.current.error).toBe(true);
    expect(result.current.entries).toEqual([entry("1")]);
    await act(async () => result.current.refresh());
    expect(result.current.entries).toEqual([entry("3")]);
    expect(result.current.error).toBe(false);
  });

  it("clears private rows after principal replacement and authorization failures", async () => {
    const forbidden = Object.assign(new Error("Forbidden"), { status: 403 });
    const client = {
      listBookingAgenda: vi
        .fn()
        .mockResolvedValueOnce([entry("1")])
        .mockRejectedValueOnce(forbidden),
    };
    const { result } = renderHook(() => useMyDayBookings(client, range));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    await act(async () => {
      window.dispatchEvent(new Event("savia:principal-changed"));
    });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.entries).toEqual([]);
  });

  it("coalesces overlapping manual and focus refreshes for the active range", async () => {
    let resolve!: (value: BookingAgendaEntry[]) => void;
    const client = {
      listBookingAgenda: vi
        .fn()
        .mockImplementationOnce(() => new Promise((done) => (resolve = done)))
        .mockResolvedValue([entry("2")]),
    };
    const { result } = renderHook(() => useMyDayBookings(client, range));
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });
    expect(client.listBookingAgenda).toHaveBeenCalledTimes(1);
    await act(async () => resolve([entry("1")]));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
  });

  it("pauses while hidden and cleans up overlapping resume timers on unmount", async () => {
    vi.useFakeTimers();
    let resolvePoll!: (value: BookingAgendaEntry[]) => void;
    const client = {
      listBookingAgenda: vi
        .fn()
        .mockResolvedValueOnce([entry("1")])
        .mockImplementationOnce(
          () => new Promise((resolve) => (resolvePoll = resolve)),
        )
        .mockResolvedValue([entry("2")]),
    };
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    try {
      const { unmount } = renderHook(() => useMyDayBookings(client, range));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(client.listBookingAgenda).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300_000);
      });
      expect(client.listBookingAgenda).toHaveBeenCalledTimes(1);

      visibility.mockReturnValue("visible");
      const online = vi
        .spyOn(navigator, "onLine", "get")
        .mockReturnValue(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300_000);
      });
      expect(client.listBookingAgenda).toHaveBeenCalledTimes(1);
      online.mockReturnValue(true);
      act(() => window.dispatchEvent(new Event("online")));
      expect(client.listBookingAgenda).toHaveBeenCalledTimes(2);
      act(() => {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("online"));
      });
      expect(client.listBookingAgenda).toHaveBeenCalledTimes(2);
      unmount();
      await act(async () => resolvePoll([entry("2")]));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300_000);
      });
      expect(client.listBookingAgenda).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});
