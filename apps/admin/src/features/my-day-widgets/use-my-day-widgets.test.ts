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
  it("persists widgets added to the layout", async () => {
    const preferences = createPreferences([]);
    const { result } = renderHook(() => useMyDayWidgets(preferences as never));

    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok = false;
    await act(async () => {
      ok = await result.current.add({
        id: "w_1",
        apiBasePath: "/v1/data-domains/platform",
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
        apiBasePath: "/v1/data-domains/platform",
        collection: "polizas",
        kind: "items",
      },
      {
        id: "agenda",
        kind: "agenda",
      },
      {
        id: "w_b",
        apiBasePath: "/v1/data-domains/platform",
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
