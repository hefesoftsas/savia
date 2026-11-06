import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { applyRealtimeListEvent } from "./realtime-list";

function clientWithList() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["users", "getList", {}], {
    data: [
      { id: "p-1", displayName: "Uno" },
      { id: "p-2", displayName: "Dos" },
    ],
    total: 2,
  });
  return queryClient;
}

describe("applyRealtimeListEvent", () => {
  it("removes a deleted row surgically without refetching", () => {
    const queryClient = clientWithList();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    applyRealtimeListEvent(queryClient, "users", {
      topic: "users",
      type: "deleted",
      id: "p-1",
    });

    expect(queryClient.getQueryData(["users", "getList", {}])).toEqual({
      data: [{ id: "p-2", displayName: "Dos" }],
      total: 1,
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("matches numeric and string ids interchangeably", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["tenants", "getList", {}], {
      data: [{ id: 101, name: "Acme" }],
      total: 1,
    });

    applyRealtimeListEvent(queryClient, "tenants", {
      topic: "tenants",
      type: "deleted",
      id: "101",
    });

    expect(queryClient.getQueryData(["tenants", "getList", {}])).toEqual({
      data: [],
      total: 0,
    });
  });

  it("refetches once for creates, updates and unknown ids", () => {
    const queryClient = clientWithList();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    applyRealtimeListEvent(queryClient, "users", {
      topic: "users",
      type: "created",
      id: "p-3",
    });
    applyRealtimeListEvent(queryClient, "users", {
      topic: "users",
      type: "updated",
      id: "p-2",
    });
    applyRealtimeListEvent(queryClient, "users", {
      topic: "users",
      type: "deleted",
      id: "missing",
    });

    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["users"] });
    // Unknown shapes are left untouched for the refetch to fix.
    expect(queryClient.getQueryData(["users", "getList", {}])).toEqual({
      data: [
        { id: "p-1", displayName: "Uno" },
        { id: "p-2", displayName: "Dos" },
      ],
      total: 2,
    });
  });

  it("never throws on malformed caches", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["users", "getList", {}], {
      data: "not-an-array",
      total: 1,
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    expect(() =>
      applyRealtimeListEvent(queryClient, "users", {
        topic: "users",
        type: "deleted",
        id: "p-1",
      }),
    ).not.toThrow();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
