import { QueryClient, dehydrate, hydrate } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { QueryCacheRow } from "./db";
import { shouldPersistQueryKey } from "./persisted-keys";
import { createDexieStorage, createOfflinePersister } from "./query-persister";

function stubTable() {
  const rows = new Map<string, QueryCacheRow>();
  return {
    rows,
    get: async (key: string) => rows.get(key),
    put: async (row: QueryCacheRow) => {
      rows.set(row.key, row);
    },
    delete: async (key: string) => {
      rows.delete(key);
    },
  };
}

describe("createDexieStorage", () => {
  it("round-trips entries through the table", async () => {
    const table = stubTable();
    const storage = createDexieStorage(table);

    expect(await storage.getItem("missing")).toBeNull();
    await storage.setItem("k", "v");
    expect(await storage.getItem("k")).toBe("v");
    expect(table.rows.get("k")?.updatedAt).toEqual(expect.any(Number));
    await storage.removeItem("k");
    expect(await storage.getItem("k")).toBeNull();
  });
});

describe("createOfflinePersister", () => {
  it("restores allowlisted queries and drops the rest", async () => {
    const persister = createOfflinePersister(stubTable());
    const source = new QueryClient();
    source.setQueryData(["users", "getList", {}], {
      data: [{ id: "p-1" }],
      total: 1,
    });
    source.setQueryData(["me"], { id: "p-1" });

    const dehydrated = dehydrate(source, {
      shouldDehydrateQuery: (query) => shouldPersistQueryKey(query.queryKey),
    });
    await persister.persistClient({
      clientState: dehydrated,
      timestamp: Date.now(),
      buster: "",
    });

    const restored = await persister.restoreClient();
    expect(restored).toBeDefined();
    const target = new QueryClient();
    hydrate(target, restored!.clientState);

    expect(target.getQueryData(["users", "getList", {}])).toEqual({
      data: [{ id: "p-1" }],
      total: 1,
    });
    expect(target.getQueryData(["me"])).toBeUndefined();
  });
});
