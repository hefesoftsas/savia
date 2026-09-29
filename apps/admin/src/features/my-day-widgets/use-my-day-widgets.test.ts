import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMyDayWidgets } from "./use-my-day-widgets";

function createPreferences(widgets: unknown[] = []) {
  return {
    getMyDayWidgets: vi.fn().mockResolvedValue({ version: 1, widgets }),
    saveMyDayWidgets: vi.fn(async (layout: unknown) => layout),
  };
}

describe("useMyDayWidgets", () => {
  it("shows the last layout immediately while refreshing it after remount", async () => {
    const preferences = createPreferences([
      {
        id: "w_saved",
        apiBasePath: "/v1/studio/0",
        collection: "polizas",
        kind: "items",
      },
    ]);
    const first = renderHook(() => useMyDayWidgets(preferences as never));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    let resolveRefresh!: (value: {
      version: number;
      widgets: unknown[];
    }) => void;
    preferences.getMyDayWidgets.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    const second = renderHook(() => useMyDayWidgets(preferences as never));

    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.widgets.map(({ id }) => id)).toEqual([
      "w_saved",
    ]);
    await act(async () => {
      resolveRefresh({ version: 1, widgets: [] });
    });
    await waitFor(() => expect(second.result.current.widgets).toEqual([]));
  });

  it("drops reused layouts when the authenticated session changes", async () => {
    const preferences = createPreferences([
      {
        id: "w_private",
        apiBasePath: "/v1/studio/0",
        collection: "polizas",
        kind: "items",
      },
    ]);
    const first = renderHook(() => useMyDayWidgets(preferences as never));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    window.dispatchEvent(new Event("savia:identity-changed"));
    const second = renderHook(() => useMyDayWidgets(preferences as never));

    expect(second.result.current.loading).toBe(true);
    expect(second.result.current.widgets).toEqual([]);
    await waitFor(() => expect(second.result.current.loading).toBe(false));
  });

  it("reloads a mounted layout after the authenticated identity changes", async () => {
    const preferences = createPreferences([
      {
        id: "w_old_user",
        apiBasePath: "/v1/studio/0",
        collection: "polizas",
        kind: "items",
      },
    ]);
    const { result } = renderHook(() => useMyDayWidgets(preferences as never));
    await waitFor(() => expect(result.current.loading).toBe(false));
    preferences.getMyDayWidgets.mockResolvedValueOnce({
      version: 1,
      widgets: [],
    });

    window.dispatchEvent(new Event("savia:identity-changed"));

    await waitFor(() => expect(result.current.widgets).toEqual([]));
    expect(result.current.loading).toBe(false);
  });

  it("does not show a previous client's layout while the new client loads", async () => {
    const firstPreferences = createPreferences([
      {
        id: "w_first_user",
        apiBasePath: "/v1/studio/0",
        collection: "polizas",
        kind: "items",
      },
    ]);
    const secondPreferences = createPreferences();
    let resolveSecond!: (value: {
      version: number;
      widgets: unknown[];
    }) => void;
    secondPreferences.getMyDayWidgets.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve;
      }),
    );
    const { result, rerender } = renderHook(
      ({ preferences }) => useMyDayWidgets(preferences as never),
      { initialProps: { preferences: firstPreferences } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ preferences: secondPreferences });

    expect(result.current.widgets).toEqual([]);
    expect(result.current.loading).toBe(true);
    await act(async () => resolveSecond({ version: 1, widgets: [] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("persists widgets added to the layout", async () => {
    const preferences = createPreferences([]);
    const { result } = renderHook(() => useMyDayWidgets(preferences as never));

    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok = false;
    await act(async () => {
      ok = await result.current.add({
        id: "w_1",
        apiBasePath: "/v1/studio/0",
        collection: "polizas",
        kind: "summary",
      } as never);
    });
    expect(ok).toBe(true);
    expect(preferences.saveMyDayWidgets).toHaveBeenCalledWith({
      version: 1,
      widgets: [expect.objectContaining({ id: "w_1" })],
    });
  });

  it("reorders widgets with drag and drop order and persists", async () => {
    const preferences = createPreferences([
      {
        id: "w_a",
        apiBasePath: "/v1/studio/0",
        collection: "polizas",
        kind: "items",
      },
      {
        id: "agenda",
        kind: "agenda",
      },
      {
        id: "w_b",
        apiBasePath: "/v1/studio/0",
        collection: "polizas",
        kind: "summary",
      },
    ]);
    const { result } = renderHook(() => useMyDayWidgets(preferences as never));

    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok = false;
    await act(async () => {
      ok = await result.current.reorder("w_a", "w_b");
    });
    expect(ok).toBe(true);
    const saved = preferences.saveMyDayWidgets.mock.calls[0]?.[0] as {
      widgets: Array<{ id: string }>;
    };
    expect(saved.widgets.map((widget) => widget.id)).toEqual([
      "agenda",
      "w_b",
      "w_a",
    ]);
  });
});
